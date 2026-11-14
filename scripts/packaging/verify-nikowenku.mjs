import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const bundledDirectory = fileURLToPath(new URL("../../common/tools/nikowenku-archive/", import.meta.url))

export async function verifyNikowenku(directory = bundledDirectory) {
  const manifest = JSON.parse(await readFile(join(directory, "upstream.json"), "utf8"))
  if (manifest.name !== "nikowenku-archive" || manifest.version !== "0.1.4"
    || !Array.isArray(manifest.files) || manifest.files.length !== 8) throw new Error("内置小说书库清单无效")
  const paths = new Set(manifest.files.map(file => file.path))
  for (const required of ["scripts/cli.mjs", "server/library.mjs", "server/text.mjs", "shared/language.mjs", "package.json", "LICENSE", "README.md", "skill/SKILL.md"]) {
    if (!paths.has(required)) throw new Error(`内置小说书库缺少 ${required}`)
  }
  for (const file of manifest.files) {
    if (!/^[\w./-]+$/.test(file.path) || file.path.split("/").some(part => part === ".." || !part)) throw new Error("小说书库清单路径无效")
    const bytes = await readFile(join(directory, file.path))
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`内置小说书库完整性校验失败：${file.path}`)
  }
  return directory
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await verifyNikowenku()
  console.log("Bundled nikowenku-archive 0.1.4 verified; no runtime installation required")
}
