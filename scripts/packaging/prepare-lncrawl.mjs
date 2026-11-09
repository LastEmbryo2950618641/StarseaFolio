import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, join, relative, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { clearTimeout, setTimeout } from "node:timers"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import console from "node:console"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const pin = JSON.parse(await readFile(join(root, "third-party/lncrawl/upstream.json"), "utf8"))
export const bundledDirectory = join(root, "apps/desktop/resources/lncrawl")

async function sha256(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

async function fileInventory(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "bundle-manifest.json") continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await fileInventory(path))
    else if (entry.isFile()) paths.push(path)
    else throw new Error(`Unexpected link in bundled LNCrawl: ${path}`)
  }
  return paths
}

export async function validateBundle(directory = bundledDirectory) {
  try {
    const manifest = JSON.parse(await readFile(join(directory, "bundle-manifest.json"), "utf8"))
    if (manifest.version !== pin.version || manifest.installerSha256 !== pin.assetSha256
      || manifest.platform !== pin.platform || manifest.arch !== pin.arch
      || manifest.executable !== "lncrawl.exe" || !Array.isArray(manifest.files)
      || !(await stat(join(directory, "_internal"))).isDirectory()
      || !manifest.files.some((file) => file.path === "source-code.zip")
      || !manifest.files.some((file) => file.path === "LICENSE")) return false
    const actual = await fileInventory(directory)
    if (actual.length !== manifest.files.length) return false
    for (const file of manifest.files) {
      const path = resolve(directory, file.path)
      if (relative(directory, path).startsWith("..") || !actual.includes(path)
        || await sha256(path) !== file.sha256) return false
    }
    return await sha256(join(directory, manifest.executable)) === manifest.executableDigest
  } catch { return false }
}

async function download(url, path, accept) {
  const headers = { "user-agent": "StarseaFolio-build", accept }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const signal = globalThis.AbortSignal.timeout(600_000)
  const response = await globalThis.fetch(url, { headers, signal })
  if (!response.ok || response.body === null) throw new Error(`LNCrawl build download failed: HTTP ${response.status}`)
  await pipeline(response.body, createWriteStream(`${path}.download`), { signal })
  await rename(`${path}.download`, path)
}

async function unpackInstaller(installer, directory) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(installer, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/NOICONS", "/TASKS=", "/CURRENTUSER", `/DIR=${directory}`], { windowsHide: true, stdio: "ignore" })
    const timeout = setTimeout(() => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      killer.on("error", () => child.kill())
      reject(new Error("LNCrawl build extraction exceeded 3 minutes"))
    }, 180_000)
    child.on("error", (error) => { clearTimeout(timeout); reject(error) })
    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) resolveRun()
      else reject(new Error(`LNCrawl build extraction failed: ${code}`))
    })
  })
}

async function removeGeneratedDirectory(path) {
  const target = resolve(path)
  if (target !== resolve(bundledDirectory) && target !== resolve(`${bundledDirectory}.staging`)) throw new Error("Refusing to remove a directory outside generated LNCrawl resources")
  await rm(target, { recursive: true, force: true })
}

export async function prepareLncrawl({ installerPath } = {}) {
  if (process.platform !== pin.platform || process.arch !== pin.arch) throw new Error("LNCrawl Windows bundle must be prepared on Windows x64")
  if (await validateBundle()) { console.log(`Bundled LNCrawl ${pin.version} verified`); return bundledDirectory }
  const cache = join(root, ".worldseed-data/build-tools/lncrawl", pin.version)
  await mkdir(cache, { recursive: true })
  const installer = installerPath ? resolve(installerPath) : join(cache, "installer.exe")
  if (!installerPath && !await stat(installer).catch(() => undefined)) await download(pin.assetUrl, installer, "application/octet-stream")
  if (await sha256(installer) !== pin.assetSha256) throw new Error("LNCrawl official installer SHA-256 mismatch; build stopped")
  const source = join(cache, "source-code.zip")
  if (!await stat(source).catch(() => undefined)) await download(pin.sourceUrl, source, "application/vnd.github+json")
  const extracted = join(cache, "extracted")
  await mkdir(extracted, { recursive: true })
  console.log(`Preparing official LNCrawl ${pin.version} for the application bundle`)
  await unpackInstaller(installer, extracted)
  const staging = `${bundledDirectory}.staging`
  await removeGeneratedDirectory(staging)
  await mkdir(staging, { recursive: true })
  await cp(join(extracted, "lncrawl.exe"), join(staging, "lncrawl.exe"))
  await cp(join(extracted, "_internal"), join(staging, "_internal"), { recursive: true })
  await cp(join(root, "third-party/lncrawl/LICENSE"), join(staging, "LICENSE"))
  await cp(source, join(staging, "source-code.zip"))
  await writeFile(join(staging, "SOURCE.md"), `# Lightnovel Crawler\n\nUpstream: ${pin.repository}\nVersion: ${pin.version}\nUnmodified upstream source: source-code.zip\nLicense: LICENSE (GPL-3.0)\n\nThe original CLI and dependencies run as a separate background process.\n`)
  const files = []
  for (const path of await fileInventory(staging)) files.push({ path: relative(staging, path).replaceAll("\\", "/"), sha256: await sha256(path) })
  await writeFile(join(staging, "bundle-manifest.json"), `${JSON.stringify({ ...pin, installerSha256: pin.assetSha256, executable: "lncrawl.exe", executableDigest: await sha256(join(staging, "lncrawl.exe")), files }, null, 2)}\n`)
  if (!await validateBundle(staging)) throw new Error("Prepared LNCrawl bundle failed validation")
  await removeGeneratedDirectory(bundledDirectory)
  await rename(staging, bundledDirectory)
  console.log(`LNCrawl bundled: ${files.length} files; no user-side runtime installation`)
  return bundledDirectory
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--installer")
  await prepareLncrawl({ installerPath: index < 0 ? undefined : process.argv[index + 1] })
}
