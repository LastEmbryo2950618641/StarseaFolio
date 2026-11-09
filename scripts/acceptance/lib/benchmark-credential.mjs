import { createRequire } from "node:module"
import { execFile } from "node:child_process"
import { join, resolve } from "node:path"
import process from "node:process"

export async function resolveBenchmarkCredential(selection, userData) {
  if (process.env.WORLDSEED_BENCHMARK_API_KEY) return process.env.WORLDSEED_BENCHMARK_API_KEY
  if (selection.apiKey) return selection.apiKey
  if (!userData) throw new Error("Supply --desktop-user-data or WORLDSEED_BENCHMARK_API_KEY for real evaluation")
  const require = createRequire(resolve(import.meta.dirname, "../../../win/desktop/package.json"))
  const electron = require("electron")
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolveSecret, reject) => {
    execFile(electron, [join(import.meta.dirname, "desktop-benchmark-credential.cjs"), userData, selection.credentialRef], {
      env, windowsHide: true, timeout: 20_000, maxBuffer: 64_000,
    }, (error, stdout) => {
      // Child-process errors may contain stdout; do not propagate the original error.
      if (error) return reject(new Error("Desktop benchmark credential helper failed"))
      const line = stdout.split(/\r?\n/u).find(item => item.startsWith("WORLDSEED_BENCHMARK_SECRET:"))
      if (!line) return reject(new Error("Desktop benchmark credential helper returned no credential"))
      try { resolveSecret(JSON.parse(line.slice("WORLDSEED_BENCHMARK_SECRET:".length))) }
      catch { reject(new Error("Desktop benchmark credential helper returned an invalid response")) }
    })
  })
}
