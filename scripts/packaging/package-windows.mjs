import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import console from "node:console"
import { createRequire } from "node:module"
import { repository, runCli } from "./build-utils.mjs"
import { assertProductVersion } from "./version.mjs"
import { windowsBuildIdentity } from "./release-version.mjs"

const options = process.argv.slice(2)
if (options.some((arg) => arg !== "--dir")) throw new Error("Usage: pnpm package:win [--dir]")
if (process.platform !== "win32") throw new Error("Windows packaging requires Windows (or the Windows GitHub Actions job)")
const desktop = join(repository, "win/desktop")
const baseVersion = await assertProductVersion()
const buildInfoPath = join(desktop, "build-info.json")
const originalBuildInfo = await readFile(buildInfoPath, "utf8")
const buildInfo = JSON.parse(originalBuildInfo)
if (process.env.CI && !process.env.BUILD_NUMBER) throw new Error("CI must allocate BUILD_NUMBER through Release Windows")
const identity = windowsBuildIdentity(baseVersion, process.env.BUILD_NUMBER ?? buildInfo.buildNumber)
try {
  await writeFile(buildInfoPath, `${JSON.stringify(identity, null, 2)}\n`)
  await runCli(repository, "typescript", "tsc", ["-b", "common/backend"])
  await runCli(desktop, "electron-vite", "electron-vite", ["build"])
  // Publishing is handled explicitly by the release workflow, never by a local package command.
  await runCli(desktop, "electron-builder", "electron-builder", ["--win", "--config", "electron-builder.yml", "--publish", "never",
    `--config.extraMetadata.version=${identity.version}`, `--config.buildVersion=${identity.windowsVersion}`, ...options])
  if (!(await stat(join(desktop, "release/win-unpacked/StarseaFolio.exe"))).isFile()) throw new Error("Windows executable was not generated")
  const desktopRequire = createRequire(join(desktop, "package.json"))
  const builderRequire = createRequire(desktopRequire.resolve("electron-builder"))
  const { extractFile } = builderRequire("@electron/asar")
  const archive = join(desktop, "release/win-unpacked/resources/app.asar")
  const packedManifest = JSON.parse(extractFile(archive, "package.json").toString("utf8"))
  const packedIdentity = JSON.parse(extractFile(archive, "build-info.json").toString("utf8"))
  if (packedManifest.version !== identity.version || packedIdentity.version !== identity.version || packedIdentity.buildNumber !== identity.buildNumber) {
    throw new Error("Packaged version differs from release identity")
  }
  if (!options.includes("--dir")) {
    for (const target of ["Setup", "Portable"]) {
      const artifact = join(desktop, "release", `Starsea-Folio-${identity.version}-${target}.exe`)
      if (!(await stat(artifact)).isFile()) throw new Error(`Missing installer: ${artifact}`)
    }
  }
} finally {
  await writeFile(buildInfoPath, originalBuildInfo)
}
console.log(`Windows artifacts: ${join(desktop, "release")}`)
