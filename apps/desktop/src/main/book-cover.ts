import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"

const COVER_DIR = ".worldseed"
const COVER_BASENAME = "cover"
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"])

function mimeForExtension(ext: string): string {
  return ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/bmp"
}

function clearExistingCovers(dir: string): Promise<void> {
  return readdir(dir)
    .then((existing) => Promise.all(existing
      .filter((name) => name.toLowerCase().startsWith(`${COVER_BASENAME}.`))
      .map((name) => unlink(join(dir, name)).catch(() => undefined))))
    .then(() => undefined)
    .catch(() => undefined)
}

function coverDir(workspaceRootRef: string): string {
  return join(workspaceRootRef, COVER_DIR)
}

export async function findBookCoverPath(workspaceRootRef: string): Promise<string | undefined> {
  try {
    const entries = await readdir(coverDir(workspaceRootRef))
    const hit = entries.find((name) => {
      const lower = name.toLowerCase()
      return lower.startsWith(`${COVER_BASENAME}.`) && IMAGE_EXT.has(extname(lower))
    })
    return hit === undefined ? undefined : join(coverDir(workspaceRootRef), hit)
  } catch {
    return undefined
  }
}

export async function readBookCoverDataUrl(workspaceRootRef: string): Promise<string | undefined> {
  const path = await findBookCoverPath(workspaceRootRef)
  if (path === undefined) return undefined
  const ext = extname(path).toLowerCase().replace(".", "")
  const mime = mimeForExtension(`.${ext}`)
  const bytes = await readFile(path)
  return `data:${mime};base64,${bytes.toString("base64")}`
}

export async function setBookCoverFromPath(
  workspaceRootRef: string,
  sourcePath: string,
): Promise<string> {
  const ext = extname(sourcePath).toLowerCase()
  if (!IMAGE_EXT.has(ext)) {
    throw new Error("请选择 png / jpg / webp / gif 图片作为封面")
  }
  const dir = coverDir(workspaceRootRef)
  await mkdir(dir, { recursive: true })
  await clearExistingCovers(dir)
  const target = join(dir, `${COVER_BASENAME}${ext === ".jpeg" ? ".jpg" : ext}`)
  await copyFile(sourcePath, target)
  const dataUrl = await readBookCoverDataUrl(workspaceRootRef)
  if (dataUrl === undefined) throw new Error("封面写入后无法读取")
  return dataUrl
}

export async function readImageFileDataUrl(sourcePath: string): Promise<string> {
  const ext = extname(sourcePath).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new Error("请选择 png / jpg / webp / gif 图片作为封面")
  const bytes = await readFile(sourcePath)
  return `data:${mimeForExtension(ext)};base64,${bytes.toString("base64")}`
}

export async function setBookCoverFromDataUrl(
  workspaceRootRef: string,
  dataUrl: string,
): Promise<string> {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl.trim())
  if (match === null) throw new Error("无效的裁剪封面图片")
  const mime = match[1]
  const encoded = match[2]
  if (mime === undefined || encoded === undefined) throw new Error("无效的裁剪封面图片")
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length === 0) throw new Error("裁剪封面图片不能为空")
  const dir = coverDir(workspaceRootRef)
  await mkdir(dir, { recursive: true })
  await clearExistingCovers(dir)
  const extension = mime === "image/jpeg" ? "jpg" : mime.slice("image/".length)
  await writeFile(join(dir, `${COVER_BASENAME}.${extension}`), bytes)
  const result = await readBookCoverDataUrl(workspaceRootRef)
  if (result === undefined) throw new Error("封面写入后无法读取")
  return result
}
