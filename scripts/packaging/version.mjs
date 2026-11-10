import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { repository } from "./build-utils.mjs"

export async function assertProductVersion() {
  const read = async (path) => JSON.parse(await readFile(join(repository, path), "utf8"))
  const { version } = await read("package.json")
  const manifests = [
    "win/desktop/package.json", "android/mobile/package.json", "common/backend/package.json",
    "common/renderer/package.json", "common/web/package.json", "common/packages/config/package.json",
    "common/packages/contracts/package.json", "common/packages/prompt-contracts/package.json",
  ]
  for (const path of manifests) {
    if ((await read(path)).version !== version) throw new Error(`Product version mismatch: ${path}; expected ${version}`)
  }
  if ((await read("android/mobile/app.json")).expo.version !== version) throw new Error("Expo version differs from product version")
  const lock = await read("android/mobile/package-lock.json")
  if ([lock.version, lock.packages[""].version, lock.packages["../../common/packages/contracts"].version].some((value) => value !== version)) {
    throw new Error("Android lockfile version differs from product version")
  }
  return version
}
