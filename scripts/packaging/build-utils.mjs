import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export async function run(command, args, { cwd = repository, env = process.env } = {}) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) done()
      else reject(new Error(`${command} failed (${signal ?? code})`))
    })
  })
}

export async function runCli(directory, packageName, binary, args, env) {
  const require = createRequire(resolve(directory, "package.json"))
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binary]
  if (!entry) throw new Error(`Missing ${binary} in ${packageName}; install dependencies first`)
  await run(process.execPath, [resolve(dirname(manifestPath), entry), ...args], { cwd: directory, ...(env ? { env } : {}) })
}
