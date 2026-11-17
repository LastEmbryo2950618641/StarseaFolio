#!/usr/bin/env node
/** Stub: writes a chapter body marker file and updates ui-state. */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

const workspace = parseWorkspaceArg()
ensureFolioLayout(workspace)
const dir = join(workspace, "章节正文")
mkdirSync(dir, { recursive: true })
const path = join(dir, "第一章（starsea-writing-stub）.md")
writeFileSync(path, "# 第一章\n\n（chapter-publish stub — replace with real publish）\n", "utf8")

const state = readUiState(workspace)
state.panels.chapter.publishStatus = "published"
state.run = { runId: state.run.runId ?? "chapter-publish", status: "completed", phase: "chapter_publish", error: null }
writeUiState(workspace, state)
console.log(JSON.stringify({ ok: true, stub: true, path }, null, 2))
