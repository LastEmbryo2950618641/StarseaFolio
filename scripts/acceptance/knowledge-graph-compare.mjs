import console from "node:console"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"

import { compareKnowledgeGraphReports } from "./lib/knowledge-graph-comparison.mjs"

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: "string" },
    "assume-legacy-graph": { type: "boolean", default: false },
  } })
  if (positionals.length !== 2) throw new Error("Usage: node knowledge-graph-compare.mjs <source-only-report.json> <graph-report.json> [--output comparison.json] [--assume-legacy-graph]")
  const reportPaths = positionals.map((path) => resolve(path))
  const [b, c] = await Promise.all(reportPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))))
  const comparison = {
    ...compareKnowledgeGraphReports(b, c, { assumeLegacyGraph: values["assume-legacy-graph"] }),
    reportPaths: { B: reportPaths[0], C: reportPaths[1] },
  }
  const serialized = `${JSON.stringify(comparison, null, 2)}\n`
  if (values.output !== undefined) {
    const output = resolve(values.output)
    if (reportPaths.includes(output)) throw new Error("--output must not overwrite an input report")
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, serialized, { encoding: "utf8", flag: "wx" })
  }
  process.stdout.write(serialized)
} catch (error) {
  console.error(JSON.stringify({ status: "incomparable", error: error.message }))
  process.exitCode = 1
}
