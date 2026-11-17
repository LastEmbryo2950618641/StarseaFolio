#!/usr/bin/env node
/** Stub graph sync: records a running/completed graph task in ui-state. */
import { randomUUID } from "node:crypto"
import { parseWorkspaceArg, readUiState, writeUiState, ensureFolioLayout } from "./folio-lib.mjs"

const workspace = parseWorkspaceArg()
ensureFolioLayout(workspace)
const state = readUiState(workspace)
const now = Date.now()
const fail = process.argv.includes("--fail-at")
  ? process.argv[process.argv.indexOf("--fail-at") + 1]
  : undefined

const phases = [
  "settings_extraction",
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
if (status === "completed") state.panels.chapter.publishStatus = "graph_synced"
writeUiState(workspace, state)
console.log(JSON.stringify({ ok: status === "completed", stub: true, status, fail }, null, 2))
process.exit(status === "completed" ? 0 : 1)
