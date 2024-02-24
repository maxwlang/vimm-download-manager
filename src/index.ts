import puppeteer from 'puppeteer-extra'
import { Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY, Page } from 'puppeteer'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import fs from 'fs-extra'
import { Downloads, FormData, FormInputs } from './types'
import pino, { Logger } from 'pino'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { basename } from 'path'

import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker' // Ads are slow

async function downloadGameBuffer(
    page: Page,
    log: Logger
): Promise<{ fileName: string; stream: NodeJS.ReadableStream } | undefined> {
    return new Promise(async res => {
        const formData = await page.evaluate(async (): Promise<FormData> => {
            const formInputFields = document.querySelectorAll<HTMLInputElement>(
                'form#download_form input'
            )
            const formAction =
                document.querySelector<HTMLFormElement>('form#download_form')
                    ?.action

            if (!formAction) {
                throw new Error('form action not found')
            }

            const formInputs: FormInputs = []
            formInputFields.forEach(input => {
                formInputs.push({
                    name: input.name,
                    value: input.value
                })
            })

            return {
                formAction,
                formInputs
            }
        })

        const mediaId = formData.formInputs.find(
            input => input.name === 'mediaId'
        )?.value

        if (!mediaId) {
            const error = new Error('mediaId not found')
            log.error(error)
            throw error
        }

        const downloadURIBase = formData.formAction
        log.debug({ downloadURIBase })

        axios
            .get(`${downloadURIBase}?mediaId=${mediaId}`, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
                    'Accept':
                        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': page.url(),
                    'Connection': 'keep-alive',
                    'Cookie': 'counted=1',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'same-site',
                    'Sec-Fetch-User': '?1',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                },
                onDownloadProgress: progressEvent => {
                    let progress
                    if (progressEvent.total) {
                        progress = `${(
                            (progressEvent.loaded * 100) /
                            progressEvent.total
                        ).toFixed(2)}%`
                    } else {
                        progress = `Unknown`
                    }

                    let eta
                    if (progressEvent.estimated) {
                        const time =
                            progressEvent.estimated > 60 ? 'min(s)' : 'sec(s)'
                        const amount =
                            progressEvent.estimated > 60
                                ? progressEvent.estimated / 60
                                : progressEvent.estimated
                        eta = `${amount.toFixed(0)} ${time} left`
                    } else {
                        eta = 'Unknown'
                    }

                    log.info({
                        progress,
                        bytes: `${progressEvent.loaded}/${progressEvent.total}`,
                        eta
                    })
                },
                responseType: 'stream'
            })
            .then(response => {
                const fileName = response.headers['content-disposition']
                    .split('filename="')[1]
                    .split('"')[0]
                log.debug({ fileName })

                res({ fileName, stream: response.data })
            })
            .catch(error => {
                log.error({
                    msg: 'Download failed',
                    error
                })
                res(undefined)
            })
    })
}

async function downloadGame(
    browser: Browser,
    page: Page,
    log: Logger,
    downloadFolder: string,
    fileNameOverride?: string,
    isRetry?: boolean
): Promise<boolean> {
    return new Promise(async res => {
        const gameBuffer = await downloadGameBuffer(page, log)

        if (isRetry && !gameBuffer) {
            log.error('Download failed, no buffer again, bad game..')
            return res(false)
        } else if (!gameBuffer) {
            log.error(
                'Download failed, no buffer, canceling any downloads and retrying..'
            )

            const page2 = await browser.newPage()
            await page2.goto('https://download2.vimm.net/download/cancel.php')
            await page2.close()

            log.info('Retrying download in 2 seconds..')
            await new Promise(resolve => setTimeout(resolve, 2000))

            return downloadGame(
                browser,
                page,
                log,
                downloadFolder,
                fileNameOverride,
                true
            )
        }

        const tmpSuffix = `.tmp-${uuidv4()}`
        const tmpFilePath = `${downloadFolder}${
            fileNameOverride
                ? fileNameOverride
                : `${gameBuffer.fileName}${tmpSuffix}`
        }`

        const writer = fs.createWriteStream(tmpFilePath)
        gameBuffer.stream.pipe(writer)

        writer.on('finish', async () => {
            const realPath = tmpFilePath.replace(tmpSuffix, '')
            await fs.rename(tmpFilePath, realPath)
            log.info('File saved: %s', realPath)
            const downloadsJson = await getDownloads(log)
            await fs
                .writeJson(
                    './downloads.json',
                    downloadsJson.map(download => {
                        if (download.uri === page.url()) {
                            return (download = {
                                ...download,
                                filePath: realPath
                            })
                        }
                        return download
                    }),
                    { spaces: 2 }
                )
                .then(() => log.info('downloads.json updated'))
                .then(() => res(true))
        })

        writer.on('error', error => {
            log.error(error)
            res(false)
        })
    })
}

async function getDownloads(log: Logger): Promise<Downloads> {
    log.info('Parse downloads.json')
    return await fs.readJson('./downloads.json').catch(err => {
        log.error(err)
        throw err
    })
}

;(async (): Promise<void> => {
    const logsFolder = process.env['VIMM_SCRAPER_LOGS_FOLDER'] ?? './logs'
    const downloadFolder =
        process.env['VIMM_SCRAPER_DOWNLOAD_FOLDER'] ?? './downloads'

    await fs.ensureDir(logsFolder)
    await fs.ensureDir(downloadFolder)

    const transport = pino.transport({
        targets: [
            {
                level: 'trace',
                target: 'pino/file',
                options: {
                    destination: `${logsFolder}/${new Date().toISOString()}.log`
                }
            },
            {
                level: 'trace',
                target: 'pino-pretty',
                options: {}
            }
        ]
    })

    const log = pino(
        {
            level: process.env['VIMM_SCRAPER_LOG_LEVEL'] ?? 'info'
        },
        process.env['NODE_ENV'] !== 'production' ? transport : undefined
    )

    log.info('Download folder: %s', downloadFolder)
    log.info('Logs folder: %s', logsFolder)

    const browser = await puppeteer
        .use(StealthPlugin())
        .use(
            AdblockerPlugin({
                interceptResolutionPriority:
                    DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
            })
        )
        // .launch({ headless: false })
        .launch({ headless: 'new' })

    const page = await browser.newPage()

    const downloads = await getDownloads(log)
    for (const download of downloads) {
        if (download.filePath !== null && fs.existsSync(download.filePath)) {
            log.info(`File already downloaded: ${basename(download.filePath)}`)
        } else {
            log.info('Access page: %s', download.uri)
            await page.goto(download.uri)
            const success = await downloadGame(
                browser,
                page,
                log,
                downloadFolder,
                download.fileName !== null ? download.fileName : undefined
            ).catch(e => log.error(e))

            if (!success) {
                log.error('Download failed')
            }

            log.info('Waiting 3 seconds..')
            await new Promise(resolve => setTimeout(resolve, 3000))
        }
    }

    await browser.close()
    log.info('Done.')
})()
