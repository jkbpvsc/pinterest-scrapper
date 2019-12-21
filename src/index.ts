import { createWriteStream, existsSync, lstatSync, fstatSync } from 'fs'
import axios from 'axios';
import * as puppeteer from 'puppeteer';

import probe = require('probe-image-size');


export const IMAGE_URL_REGEX: RegExp = /i\.pinimg\.com(.)*/g;
export const IMAGE_URL_REGEX1: RegExp = /image_(\w)*_url/g;

interface ImageObject {
    image_src: string;
    title: string;
}

export interface ProbedImageObject extends ImageObject {
    probe: {
        width: number;
        height: number;
        type: string;
        mime: string;
        wUnits: string;
        hUnits: string;
        length: number;
        url: string;
    };
}

export async function scrape(
    query: string,
): Promise<ProbedImageObject[]> {
    const browser: puppeteer.Browser = await puppeteer.launch({ headless: true });
    const page: puppeteer.Page = await browser.newPage();

    await page.setViewport({
        width: 1200,
        height: 800
    });

    await page.goto(`https://www.pinterest.com/search/pins/?q=${query}`)

    await scrollHandler(page, 250);

    const images: ImageObject[] = await page.evaluate((): ImageObject[] => {
        const pinElements = document.querySelectorAll('div.Grid__Item');

        function transformImgSrc(src: string): string {
            return src.replace(/\d+x\d*/, 'originals')
        }

        return Array
            .from(pinElements)
            .map((elm: Element) => {
                const imageElement: Element | null = elm.querySelector('img')
                const titleElement: Element | null = elm.querySelector('.PinAttributionTitle__title')

                let tags: string = (imageElement ? imageElement.getAttribute('alt') || '' : '').trim().replace(/\s+/g, ' ');
                const imageUrl: string = imageElement ? imageElement.getAttribute('src') || '' : '';
                const title: string = titleElement ? titleElement.innerHTML.trim().replace(/\s+/g, ' ') : '';

                return {
                    image_src: transformImgSrc(imageUrl),
                    title: title !== '' ? title : tags.split(',')[0],
                }
            })
    })

    await browser.close();

    //@ts-ignore
    const probedImages: ProbedImageObject[] = (await Promise.all(images.map(probeImages))).filter((a: ProbedImageObject | null) => !!(a));

    return probedImages
        .filter((a: ImageObject | null) => !!a);
}

async function scrollHandler(
    page: puppeteer.Page,
    nImages: number,
): Promise<any> {
    return page.evaluate(
        (N: number) => new Promise((res: Function) => {
            var interval = setInterval(function() {
                scrollTo(0, document.body.scrollHeight);

                var pins = document.getElementsByClassName('Grid__Item');
                if (pins.length > N) {
                    clearInterval(interval);
                    res();
                }
            })
        }),
        nImages
    );
}

async function probeImages(image: ImageObject): Promise<ProbedImageObject | null> {

    try {
        //@ts-ignore
        const probeResponse = await probe(image.image_src);
        return {
            ...image,
            probe: probeResponse,
        }
    } catch (e) {
        return null
    }
}



import { join } from 'path';

async function downloadImage(
    image: ProbedImageObject,
    downloadLocation: string
): Promise<string> {

    const formattedTitle = encodeURIComponent(image.title.substring(0, 20))

    console.log(`Downloading ${formattedTitle}`);

    const filename: string = formattedTitle + '.' + image.probe.type;
    const path: string = join(downloadLocation, filename);
    const writer = createWriteStream(path);
    const response = await axios({
        url: image.image_src,
        method: 'GET',
        responseType: 'stream'
    })

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(path))
        writer.on('error', reject)
    })
}

async function main(
    query: string,
    output: string,
): Promise<void> {
    console.log(`Query: ${query}, output: ${output}`)
    const outputPath: string = join(__dirname, output)

    if (
        !query || !output
    ) {
        throw new Error('Input parameters missing')
    }

    if (
        !existsSync(outputPath)
        || !lstatSync(outputPath).isDirectory()
    ) {
        throw new Error('Output directory cannot be found')
    }

    const images = await scrape(query);

    await Promise.all(
        images.map((image: ProbedImageObject) => downloadImage(image, output))
    )

    console.log('Done');
}

import * as yargs from 'yargs';

main(
    yargs.argv.query as string,
    yargs.argv.output as string,
);

