#!/usr/bin/env node
import { parseWorkspaceArg, enqueueAction } from "./folio-lib.mjs"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const workspace = parseWorkspaceArg()
const action = {
  actionId: randomUUID(),
  name: "graph.rerun",
  createdAtMs: Date.now(),
  input: {},
}
enqueueAction(workspace, action)
const apply = join(dirname(fileURLToPath(import.meta.url)), "apply-action.mjs")
const result = spawnSync(process.execPath, [apply, "--workspace", workspace], { encoding: "utf8" })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
