const { pathToFileURL } = require("node:url")
const { join } = require("node:path")

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== "win32") return
  const { prepareLncrawl } = await import(pathToFileURL(join(__dirname, "prepare-lncrawl.mjs")).href)
  await prepareLncrawl()
}
