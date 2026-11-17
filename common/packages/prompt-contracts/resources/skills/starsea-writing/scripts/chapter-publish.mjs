#!/usr/bin/env node
/**
 * Stage 3 of publish.confirm (skill-owned).
 * Hosted: finalizes ui-state from publishConfirm result (body already written by host pipeline).
 * Offline stub: only when STARSEA_FOLIO_ALLOW_STUB=1.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

/** @param {{ folio: { readUiState: Function, writeUiState: Function }, action: object, handlers: object, _publishResult?: { ok: boolean, summary: string, error?: string } }} ctx */
export async function runHosted(ctx) {
  const result = ctx._publishResult ?? { ok: false, summary: "publish pipeline 未执行", error: "missing publish result" }
  const after = await ctx.folio.readUiState()
  return ctx.folio.writeUiState({
    ...after,
    run: {
      runId: ctx.action.actionId,
      status: result.ok ? "completed" : "failed",
      phase: result.ok ? "chapter_publish" : "graph_sync",
      error: result.error ?? null,
    },
    panels: {
      ...after.panels,
      chapter: {
        ...after.panels.chapter,
        publishStatus: result.ok ? "published" : "failed",
      },
      creationDesk: {
        ...after.panels.creationDesk,
        status: result.ok ? "idle" : "failed",
        error: result.error ?? null,
        messages: [
          ...after.panels.creationDesk.messages,
          {
            messageId: randomUUID(),
            role: "assistant",
            content: result.summary,
            ...(result.error === undefined ? {} : { error: result.error }),
            createdAtMs: Date.now(),
          },
        ],
      },
    },
    updatedAtMs: Date.now(),
  })
}

function runCliStub() {
  if (process.env.STARSEA_FOLIO_ALLOW_STUB !== "1") {
    throw new Error("chapter-publish 需要 folio-run hostHandlers；离线 stub 请设 STARSEA_FOLIO_ALLOW_STUB=1")
  }
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
}

const isDirect = process.argv[1] !== undefined && process.argv[1].replaceAll("\\", "/").endsWith("chapter-publish.mjs")
if (isDirect) {
  try {
    runCliStub()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
