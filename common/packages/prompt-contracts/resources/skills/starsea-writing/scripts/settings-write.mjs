#!/usr/bin/env node
/**
 * Stage 1 of publish.confirm (skill-owned).
 * Hosted: ui-state phase + handlers.settingsWrite (draft review + settings_extraction → 设定集;
 * artifact cached under `.folio/runs/` so graph-sync skips duplicate extraction).
 * Offline stub: only when STARSEA_FOLIO_ALLOW_STUB=1.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

/** @param {{ folio: { readUiState: Function, writeUiState: Function }, action: object, handlers: object, now: number }} ctx */
export async function runHosted(ctx) {
  const state = await ctx.folio.readUiState()
  await ctx.folio.writeUiState({
    ...state,
    run: { runId: ctx.action.actionId, status: "running", phase: "settings_write", error: null },
    panels: {
      ...state.panels,
      chapter: { ...state.panels.chapter, publishStatus: "settings_write" },
      creationDesk: { ...state.panels.creationDesk, status: "running", error: null },
    },
    updatedAtMs: ctx.now,
  })
  if (typeof ctx.handlers.settingsWrite === "function") {
    const result = await ctx.handlers.settingsWrite(ctx.action)
    if (!result.ok) {
      throw new Error(result.error ?? result.summary ?? "settings-write 失败")
    }
    ctx.action.input = { ...ctx.action.input, settingsWriteDone: true, skipReview: true }
  }
  const after = await ctx.folio.readUiState()
  await ctx.folio.writeUiState({
    ...after,
    panels: {
      ...after.panels,
      chapter: { ...after.panels.chapter, publishStatus: "settings_written" },
    },
    updatedAtMs: Date.now(),
  })
  return { ok: true, stage: "settings-write" }
}

function runCliStub() {
  if (process.env.STARSEA_FOLIO_ALLOW_STUB !== "1") {
    throw new Error("settings-write 需要 folio-run hostHandlers；离线 stub 请设 STARSEA_FOLIO_ALLOW_STUB=1")
  }
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
}

const isDirect = process.argv[1] !== undefined && process.argv[1].replaceAll("\\", "/").endsWith("settings-write.mjs")
if (isDirect) {
  try {
    runCliStub()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
