const { app, safeStorage } = require("electron")
const { readFile } = require("node:fs/promises")
const { join, resolve } = require("node:path")
const process = require("node:process")
const { Buffer } = require("node:buffer")

const [userData, credentialRef] = process.argv.slice(2)
app.setPath("userData", resolve(userData))
app.whenReady().then(async () => {
  try {
    const vault = JSON.parse(await readFile(join(userData, "runtime", "credentials.json"), "utf8"))
    const encrypted = vault.secrets?.[credentialRef]
    if (!encrypted || !safeStorage.isEncryptionAvailable()) throw new Error("Saved model credential is unavailable")
    const secret = safeStorage.decryptString(Buffer.from(encrypted, "base64"))
    // Captured by the parent process; never forward this private pipe to a log.
    process.stdout.write(`WORLDSEED_BENCHMARK_SECRET:${JSON.stringify(secret)}\n`, () => app.exit(0))
  } catch {
    process.stderr.write("Unable to read selected model credential using Electron safeStorage\n")
    app.exit(1)
  }
})
