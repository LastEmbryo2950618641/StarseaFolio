import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

import { folioActionNameSchema } from "@starseafolio/contracts"

import { BackendContainer } from "../bootstrap/container.js"

function usage(): never {
  console.error(`Usage:
  node folio-run.js --workspace <path> ensure
  node folio-run.js --workspace <path> drain
  node folio-run.js --workspace <path> enqueue --name <action> [--input <json>] [--no-drain]

Actions: creationDesk.send | creationDesk.choose | publish.confirm | graph.cancel | graph.rerun | graph.continue
`)
  process.exit(2)
}

function readArg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  return argv[index + 1]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const workspace = readArg(argv, "--workspace")
  if (workspace === undefined) usage()
  const command = argv.find((item) => !item.startsWith("--") && item !== workspace)
  if (command === undefined) usage()

  const applicationDataRoot = resolve(
    process.env.WORLDSEED_APP_DATA_ROOT ?? join(process.cwd(), ".worldseed-data"),
  )
  mkdirSync(applicationDataRoot, { recursive: true })
  const promptPackageRoot = resolve(
    process.env.WORLDSEED_PROMPT_ROOT
      ?? fileURLToPath(new URL("../../../packages/prompt-contracts/", import.meta.url)),
  )
  const container = await BackendContainer.open({ applicationDataRoot, promptPackageRoot })
  const project = await container.openProject(resolve(workspace))
  const runtime = await container.getRuntime(project.manifest.id, project.manifest.workspaceRootRef)

  if (command === "ensure") {
    const state = await runtime.ensureFolioHost("codex")
    console.log(JSON.stringify({ ok: true, command, state }, null, 2))
    return
  }

  if (command === "drain") {
    const state = await runtime.drainFolioActions()
    console.log(JSON.stringify({ ok: true, command, state }, null, 2))
    return
  }

  if (command === "enqueue") {
    const nameRaw = readArg(argv, "--name")
    if (nameRaw === undefined) usage()
    const name = folioActionNameSchema.parse(nameRaw)
    const inputRaw = readArg(argv, "--input") ?? "{}"
    const input = JSON.parse(inputRaw) as Record<string, unknown>
    const drain = !argv.includes("--no-drain")
    const state = await runtime.enqueueFolioAction({
      actionId: randomUUID(),
      name,
      input,
      drain,
    })
    console.log(JSON.stringify({ ok: true, command, name, state }, null, 2))
    return
  }

  usage()
}

const currentModule = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(currentModule)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { main as runFolioCli }
