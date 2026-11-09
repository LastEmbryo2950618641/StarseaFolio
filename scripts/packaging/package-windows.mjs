import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import console from "node:console"
import { repository, runCli } from "./build-utils.mjs"

const options = process.argv.slice(2)
if (options.some((arg) => arg !== "--dir")) throw new Error("Usage: pnpm package:win [--dir]")
if (process.platform !== "win32") throw new Error("Windows packaging requires Windows (or the Windows GitHub Actions job)")
const desktop = join(repository, "win/desktop")
await runCli(repository, "typescript", "tsc", ["-b", "common/backend"])
await runCli(desktop, "electron-vite", "electron-vite", ["build"])
// Publishing is handled explicitly by the release workflow, never by a local package command.
await runCli(desktop, "electron-builder", "electron-builder", ["--win", "--config", "electron-builder.yml", "--publish", "never", ...options])
if (!(await stat(join(desktop, "release/win-unpacked/StarseaFolio.exe"))).isFile()) throw new Error("Windows executable was not generated")
if (!options.includes("--dir")) {
  const { version } = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"))
  for (const target of ["Setup", "Portable"]) {
    const artifact = join(desktop, "release", `Starsea-Folio-${version}-${target}.exe`)
    if (!(await stat(artifact)).isFile()) throw new Error(`Missing installer: ${artifact}`)
  }
}
console.log(`Windows artifacts: ${join(desktop, "release")}`)
