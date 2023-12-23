import puppeteer from 'puppeteer-extra'
import { Page } from 'puppeteer'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import fs from 'fs-extra'
import * as R from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { CheatEntry, GameData, GameEntry } from './types'

async function getPagination(
    page: Page,
    uriBase: string,
    gameSystem: string
): Promise<string[]> {
    const allList = `${uriBase}/system/${gameSystem}/all`
    await page.goto(`${allList}`)

    const filteredLinks = await page.evaluate(
        (gameSystem: string): string[] => {
            const links = document.querySelectorAll(
                `a[href*="/system/${gameSystem}/all"]`
            )

            return Array.from(links)
                .map(link => link.getAttribute('href'))
                .filter(link => link !== null) as string[]
        },
        gameSystem
    )

    return R.uniq(filteredLinks)
}

async function getGameEntries(
    page: Page,
    uriBase: string,
    paginationLink: string
): Promise<GameEntry[]> {
    await page.goto(`${uriBase}${paginationLink}`)
    const gameEntries = await page.evaluate((uriBase: string): GameEntry[] => {
        const tableRows = document.querySelectorAll('tbody tr')

        const gameEntries: GameEntry[] = []
        let gameEntry: GameEntry | undefined

        // @ts-expect-error whatever
        for (const tableRow of tableRows) {
            if (tableRow.querySelector('th')) {
                if (gameEntry && Object.keys(gameEntry).length > 0) {
                    gameEntries.push(gameEntry)
                }

                gameEntry = {
                    title: tableRow.querySelector('th')?.textContent?.trim(),
                    cheatEntries: []
                }
            } else if (tableRow.querySelector('td a[href*="/game/"]')) {
                const gameLink = tableRow.querySelector('td a[href*="/game/"]')
                const gameSerial = tableRow
                    .querySelector('td:nth-child(2)')
                    .textContent.trim()
                const gameLinkHref = gameLink.getAttribute('href')
                const gameLinkText = gameLink.textContent.trim()

                const cheatEntry = {
                    title: gameLinkText,
                    url: `${uriBase}${gameLinkHref}`,
                    serial: gameSerial
                }

                // @ts-expect-error whatever
                gameEntry['cheatEntries'].push(cheatEntry)
            }
        }

        return gameEntries
    }, uriBase)

    return gameEntries
}

async function getCheatBuffer(
    page: Page,
    uriBase: string,
    cheatEntry: CheatEntry
): Promise<undefined | Buffer> {
    return new Promise(async res => {
        const filename = encodeURIComponent(cheatEntry.title)

        const cheatData = await page.evaluate(
            async (
                uriBase: string,
                filename: string,
                cheatEntry: CheatEntry
            ): Promise<string | undefined> => {
                const sysId = document
                    .querySelector('input[name="sysID"]')
                    ?.getAttribute('value')

                const gameCode = document
                    .querySelector('input[name="gamID"]')
                    ?.getAttribute('value')

                if (!sysId) {
                    console.log(`Missing sysId for ${cheatEntry.url}`)
                    return undefined
                }

                if (!gameCode) {
                    console.log(`Missing gameCodeInput for ${cheatEntry.url}`)
                    return undefined
                }

                const download = await fetch(
                    `${uriBase}/inc/sub.exportCodes.php`,
                    {
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        referrer: cheatEntry.url,
                        body: `format=Text&codID=&filename=${filename}&sysID=${sysId}&gamID=${gameCode}&download=true`,
                        method: 'POST',
                        mode: 'cors'
                    }
                )

                return download?.text()
            },
            uriBase,
            filename,
            cheatEntry
        )

        if (!cheatData) return res(undefined)

        const cheatBuffer = Buffer.from(cheatData, 'utf8')
        res(cheatBuffer)
    })
}

async function getGameData(
    page: Page,
    uriBase: string,
    cheatEntry: CheatEntry
): Promise<GameData> {
    await page.goto(`${cheatEntry.url}`)

    const fileBuffer = await getCheatBuffer(page, uriBase, cheatEntry)

    return {
        ...cheatEntry,
        cheats: fileBuffer
    }
}

;(async (): Promise<void> => {
    const uriBase = 'https://gamehacking.org'
    const gameSystem = 'ngc'
    const downloadFolder =
        process.env['GH_SCRAPER_DOWNLOAD_FOLDER'] ?? './downloaded'
    const gamesStateFile = `${downloadFolder}/games.json`
    const cheatsFolder = `${downloadFolder}/cheats`
    const noSerialFolder = `${downloadFolder}/no-serial`

    const browser = await puppeteer
        .use(StealthPlugin())
        .launch({ headless: 'new' })

    const page = await browser.newPage()
    // await page.setViewport({ width: 1080, height: 1024 })

    const pagination = await getPagination(page, uriBase, gameSystem)

    let gameEntries: GameEntry[] = []
    const hasGamesStateFile = await fs.exists(gamesStateFile)
    const ignoreStateFile = process.env['GH_SCRAPER_IGNORE_STATE_FILE'] ?? false

    if (hasGamesStateFile && !ignoreStateFile) {
        console.log('Using cached games')
        gameEntries = fs.readJsonSync(gamesStateFile)
        console.log(`Loaded ${gameEntries.length} games`)
    } else {
        console.log('Fetching games')
        for (const paginationLink of pagination) {
            let fetchedGameEntries = await getGameEntries(
                page,
                uriBase,
                paginationLink
            )

            if (fetchedGameEntries.length === 0) {
                let retries = 0
                while (fetchedGameEntries.length === 0) {
                    console.log(`Retrying: ${paginationLink}`)
                    retries++
                    fetchedGameEntries = await getGameEntries(
                        page,
                        uriBase,
                        paginationLink
                    )

                    if (fetchedGameEntries.length > 0) {
                        console.log(`Success: ${paginationLink}`)
                        continue
                    }

                    if (retries > 3) {
                        console.log(`Too many retries: ${paginationLink}`)
                        continue
                    }

                    await new Promise(r => setTimeout(r, 2000))
                }
            }

            gameEntries.push(...fetchedGameEntries)
            console.log({ gameLinks: gameEntries.length })
            await new Promise(r => setTimeout(r, 2000))
        }
    }

    await fs.mkdir(downloadFolder).catch(e => e)
    await fs.rm(cheatsFolder, { recursive: true }).catch(e => e)
    await fs.mkdir(cheatsFolder)
    if (!hasGamesStateFile) {
        await fs.writeFile(gamesStateFile, JSON.stringify(gameEntries, null, 2))
    }

    for (const [index, gameEntry] of gameEntries.entries()) {
        console.log(
            `Getting game data for: ${gameEntry.title} (${index + 1} / ${
                gameEntries.length
            })`
        )
        for (const cheatEntry of gameEntry.cheatEntries) {
            console.log(`Getting cheat data for: ${cheatEntry.title}`)
            const gameData = await getGameData(page, uriBase, cheatEntry)
            if (!gameData.cheats) continue

            if (gameData.serial.length === 0) {
                console.log(`No serial, storing in ${noSerialFolder}`)
                if (!fs.existsSync(noSerialFolder)) {
                    await fs.mkdir(noSerialFolder)
                }

                await fs.writeFile(
                    `${noSerialFolder}/${uuidv4()}.txt`,
                    gameData.cheats,
                    'utf8'
                )
            } else {
                await fs.writeFile(
                    `${cheatsFolder}/${gameData.serial}.txt`,
                    gameData.cheats,
                    'utf8'
                )
            }

            await new Promise(r => setTimeout(r, 2000))
        }
    }

    await browser.close()
})()
