#!/usr/bin/env node
/** Stub: real extraction will call model + write 设定集. Updates ui-state progress. */
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

const workspace = parseWorkspaceArg()
ensureFolioLayout(workspace)
const settingsDir = join(workspace, "设定集")
mkdirSync(settingsDir, { recursive: true })
const marker = join(settingsDir, ".starsea-writing-settings-write.json")
writeFileSync(marker, `${JSON.stringify({ ok: true, at: Date.now(), stub: true }, null, 2)}\n`, "utf8")
if (!existsSync(join(settingsDir, "readme.md"))) {
  writeFileSync(join(settingsDir, "readme.md"), "# 设定集\n\n（starsea-writing settings-write stub）\n", "utf8")
}

const state = readUiState(workspace)
state.run = { runId: state.run.runId ?? "settings-write", status: "running", phase: "settings_write", error: null }
state.panels.chapter.publishStatus = "settings_written"
writeUiState(workspace, state)
console.log(JSON.stringify({ ok: true, stub: true, marker }, null, 2))
