import assert from "node:assert/strict"
import { mkdtemp, cp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, it } from "vitest"
import { bundledDirectory, verifyNikowenku } from "../verify-nikowenku.mjs"

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it("verifies bundled portable source and licenses; packaging carries the tool instead of the removed runtime", async () => {
  assert.equal(await verifyNikowenku(), bundledDirectory)
  const config = await readFile(new URL("../../../win/desktop/electron-builder.yml", import.meta.url), "utf8")
  assert.match(config, /from: ..\/..\/common\/tools\/nikowenku-archive/u)
  assert.match(config, /to: tools\/nikowenku-archive/u)
  assert.doesNotMatch(config, /lncrawl/iu)
})

it("rejects altered CLI sources before packaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "starseafolio-bundle-")); roots.push(root)
  await cp(bundledDirectory, root, { recursive: true })
  await writeFile(join(root, "scripts/cli.mjs"), "corrupt")
  await assert.rejects(verifyNikowenku(root), /完整性校验失败/u)
})
