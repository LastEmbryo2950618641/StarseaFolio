#!/usr/bin/env node
import { ensureFolioLayout, parseWorkspaceArg, writeHost, emptyUiState, writeUiState, readUiState } from "./folio-lib.mjs"

const workspace = parseWorkspaceArg()
ensureFolioLayout(workspace)
const host = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1]
  : "codex"
writeHost(workspace, { host, workspaceRoot: workspace, skillId: "starsea-writing" })
const state = readUiState(workspace)
if (state.schemaVersion !== 1) writeUiState(workspace, emptyUiState())
console.log(JSON.stringify({ ok: true, workspace, host }, null, 2))
