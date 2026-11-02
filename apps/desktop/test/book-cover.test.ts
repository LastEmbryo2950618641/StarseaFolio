import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { readBookCoverDataUrl, readImageFileDataUrl, setBookCoverFromDataUrl } from "../src/main/book-cover.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("book cover storage", () => {
  it("reads a selected image and stores the cropped data URL as the cover", async () => {
    const root = await mkdtemp(join(tmpdir(), "worldseed-cover-"))
    temporaryDirectories.push(root)
    const source = join(root, "source.png")
    await writeFile(source, Buffer.from([0, 1, 2, 3]))

    const sourceDataUrl = await readImageFileDataUrl(source)
    expect(sourceDataUrl).toBe("data:image/png;base64,AAECAw==")

    const saved = await setBookCoverFromDataUrl(root, "data:image/jpeg;base64,AAECAw==")
    expect(saved).toBe("data:image/jpeg;base64,AAECAw==")
    expect(await readFile(join(root, ".worldseed", "cover.jpg"))).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(await readBookCoverDataUrl(root)).toBe(saved)
  })
})
