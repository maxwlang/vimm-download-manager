export interface CheatEntry {
    title: string
    url: string
    serial: string
    cheats?: Buffer
}

export interface GameEntry {
    title: string
    cheatEntries: CheatEntry[]
}

export interface GameData extends CheatEntry {
    cheats?: Buffer
}
