# GameHacking.org Cheat Scraper

This Typescript project scrapes the GameHacking.org website for cheats and exports them to swiss-ready text based cheat files.

![image](./running.png)

## Why?

No bulk export option make angry

## How to use

1. Clone this repo
2. Run `yarn`
3. Run `yarn dev
4. Wait

-- OR --

1. Have docker
2. Run `docker run -it --rm --cap-add=SYS_ADMIN -v $(pwd)/downloaded:/app/downloaded ghcr.io/maxwlang/gamehacking-scraper:v1.1.0`

## Environment Variables

| Variable                       | Description                                                        | Default                                     |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------- |
| `GH_SCRAPER_DOWNLOAD_FOLDER`   | The location to place all content created by the script            | `"./downloaded"` (relative, in project dir) |
| `GH_SCRAPER_IGNORE_STATE_FILE` | Whether or not to ignore the state file and re-download everything | `false`                                     |
