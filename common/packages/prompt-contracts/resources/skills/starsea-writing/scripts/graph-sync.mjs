#!/usr/bin/env node
/**
 * Stage 2 of publish.confirm / standalone graph stub (skill-owned).
 * Hosted: invokes handlers.publishConfirm (graph governance + body; settings_extraction
 * already done in settings-write and preloaded from `.folio/runs/` when present).
 * Offline stub: only when STARSEA_FOLIO_ALLOW_STUB=1.
 */
import { randomUUID } from "node:crypto"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

/** @param {{ folio: { readUiState: Function, writeUiState: Function }, action: object, handlers: object, now: number }} ctx */
export async function runHosted(ctx) {
  const state = await ctx.folio.readUiState()
  await ctx.folio.writeUiState({
    ...state,
    run: { runId: ctx.action.actionId, status: "running", phase: "graph_sync", error: null },
    panels: {
      ...state.panels,
      chapter: { ...state.panels.chapter, publishStatus: "graph_sync" },
    },
    updatedAtMs: Date.now(),
  })
  ctx._publishResult = await ctx.handlers.publishConfirm(ctx.action)
  const tasks = await ctx.handlers.listGraphTasks()
  const folioTasks = tasks.map((task) => ({
    revisionTaskId: task.revisionTaskId,
    chapterId: task.chapterId,
    heading: task.heading,
    status: task.status,
    canCancel: task.canCancel,
    canRetry: task.canRetry,
    canContinue: task.canContinue,
    blocksTurn: task.blocksTurn,
    ...(task.error === undefined ? {} : { error: task.error }),
    progress: {
      completed: task.progress.completed,
      total: task.progress.total,
      ...(task.progress.phase === undefined ? {} : { phase: task.progress.phase }),
      phases: task.progress.phases.map((phase) => ({
        phase: phase.phase,
        status: phase.status,
        attempt: phase.attempt,
      })),
    },
    updatedAtMs: task.updatedAtMs,
  }))
  const after = await ctx.folio.readUiState()
  const active = folioTasks.find((task) => task.status === "running" || task.status === "failed")
  await ctx.folio.writeUiState({
    ...after,
    updatedAtMs: Date.now(),
    panels: {
      ...after.panels,
      graphRevision: {
        tasks: folioTasks,
        status: active?.status === "running"
          ? "running"
          : active?.status === "failed"
            ? "failed"
            : folioTasks.length === 0
              ? "idle"
              : "completed",
        error: active?.error ?? null,
      },
    },
  })
  return { ok: true, stage: "graph-sync" }
}

function runCliStub() {
  if (process.env.STARSEA_FOLIO_ALLOW_STUB !== "1") {
    throw new Error("graph-sync 需要 folio-run hostHandlers；离线 stub 请设 STARSEA_FOLIO_ALLOW_STUB=1")
  }
  const workspace = parseWorkspaceArg()
  ensureFolioLayout(workspace)
  const state = readUiState(workspace)
  const now = Date.now()
  const fail = process.argv.includes("--fail-at")
    ? process.argv[process.argv.indexOf("--fail-at") + 1]
    : undefined

  // settings_extraction belongs to settings-write; stub graph stages only.
  const phases = [
    "graph_governance",
    "dependency_audit",
    "graph_structure_plan",
    "graph_governance_review",
    "frontier_settlement",
    "commit_review",
  ].map((phase) => ({ phase, status: "completed", attempt: 1 }))

  let status = "completed"
  let error
  if (fail !== undefined) {
    const index = phases.findIndex((item) => item.phase === fail)
    if (index >= 0) {
      for (let i = index; i < phases.length; i += 1) phases[i].status = i === index ? "failed" : "idle"
      phases[index].status = "failed"
      status = "failed"
      error = `Stub failure at ${fail}`
    }
  }

  const task = {
    revisionTaskId: randomUUID(),
    heading: "图治理（starsea-writing）",
    status,
    canCancel: status === "failed",
    canRetry: status === "failed",
    canContinue: status === "failed",
    ...(error === undefined ? {} : { error }),
    progress: {
      completed: phases.filter((phase) => phase.status === "completed").length,
      total: phases.length,
      phase: phases.find((phase) => phase.status === "failed" || phase.status === "running")?.phase
        ?? phases.at(-1)?.phase,
      phases: phases.filter((phase) => phase.status !== "idle"),
    },
    updatedAtMs: now,
  }

  state.panels.graphRevision.tasks = [task, ...state.panels.graphRevision.tasks]
  state.panels.graphRevision.status = status === "completed" ? "completed" : "failed"
  state.panels.graphRevision.error = error ?? null
  state.run = {
    runId: task.revisionTaskId,
    status: status === "completed" ? "running" : "failed",
    phase: "graph_sync",
    error: error ?? null,
  }
  writeUiState(workspace, state)
  console.log(JSON.stringify({ ok: status !== "failed", stub: true, status }, null, 2))
  if (status === "failed") process.exit(1)
}

const isDirect = process.argv[1] !== undefined && process.argv[1].replaceAll("\\", "/").endsWith("graph-sync.mjs")
if (isDirect) {
  try {
    runCliStub()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
