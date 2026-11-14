const { pathToFileURL } = require("node:url")
const { join } = require("node:path")

module.exports = async function beforePack() {
  const { verifyNikowenku } = await import(pathToFileURL(join(__dirname, "verify-nikowenku.mjs")).href)
  await verifyNikowenku()
}
