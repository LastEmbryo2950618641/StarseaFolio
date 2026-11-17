#!/usr/bin/env node
/**
 * Consume one Folio action and update ui-state.
 * Full model/settings/graph work lands in later scripts; this entry routes names.
 */
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import {
  claimAction,
  ensureFolioLayout,
  listPendingActions,
  parseWorkspaceArg,
  readUiState,
  writeUiState,
} from "./folio-lib.mjs"

const workspace = parseWorkspaceArg()
ensureFolioLayout(workspace)

const actionArgIndex = process.argv.indexOf("--action")
const actionPath = actionArgIndex >= 0
  ? process.argv[actionArgIndex + 1]
  : listPendingActions(workspace)[0]

if (actionPath === undefined) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "no_pending_action" }, null, 2))
  process.exit(0)
}

const normalized = actionPath.replaceAll("\\", "/")
const action = normalized.includes("/actions/done/")
  ? JSON.parse(readFileSync(actionPath, "utf8"))
  : claimAction(workspace, actionPath)

const state = readUiState(workspace)
const now = Date.now()

function appendAssistant(content, error) {
  state.panels.creationDesk.messages.push({
    messageId: randomUUID(),
    role: "assistant",
    content,
    ...(error === undefined ? {} : { error }),
    createdAtMs: now,
  })
}

switch (action.name) {
  case "creationDesk.send":
  case "creationDesk.choose": {
    const text = typeof action.input?.text === "string" ? action.input.text : action.input?.label
    state.panels.creationDesk.messages.push({
      messageId: randomUUID(),
      role: "user",
      content: String(text ?? ""),
      createdAtMs: now,
    })
    state.panels.creationDesk.status = "running"
    state.run = { runId: action.actionId, status: "running", phase: "creation_desk", error: null }
    appendAssistant("（starsea-writing）已接收创作台输入；后续由模型与脚本继续。")
    state.panels.creationDesk.status = "idle"
    state.run.status = "awaiting_user"
    break
  }
  case "publish.confirm": {
    state.run = { runId: action.actionId, status: "running", phase: "settings_write", error: null }
    state.panels.chapter.publishStatus = "settings_write"
    appendAssistant("开始设定抽取 → 图治理 → 正文落盘（脚本链路）。")
    // Chain markers for hosts; real work is in dedicated scripts.
    state.panels.chapter.publishStatus = "awaiting_scripts"
    state.run.phase = "settings_write"
    break
  }
  case "graph.cancel": {
    for (const task of state.panels.graphRevision.tasks) {
      task.status = "cancelled"
      task.canCancel = false
      task.canRetry = true
      task.canContinue = false
      task.updatedAtMs = now
    }
    state.panels.graphRevision.status = "idle"
    state.run = { runId: action.actionId, status: "idle", phase: "idle", error: null }
    break
  }
  case "graph.rerun": {
    for (const task of state.panels.graphRevision.tasks) {
      task.status = "running"
      task.canCancel = true
      task.canRetry = false
      task.canContinue = false
      task.progress = {
        completed: 0,
        total: 6,
        phase: "graph_governance",
        phases: [{ phase: "graph_governance", status: "running", attempt: 1 }],
      }
      task.updatedAtMs = now
    }
    state.panels.graphRevision.status = "running"
    state.run = { runId: action.actionId, status: "running", phase: "graph_sync", error: null }
    break
  }
  case "graph.continue": {
    for (const task of state.panels.graphRevision.tasks) {
      const failed = task.progress.phases.find((phase) => phase.status === "failed")
      if (failed !== undefined) {
        failed.status = "running"
        failed.attempt += 1
        task.status = "running"
        task.canContinue = false
        task.canRetry = false
        task.canCancel = true
        task.progress.phase = failed.phase
      }
      task.updatedAtMs = now
    }
    state.panels.graphRevision.status = "running"
    state.run = { runId: action.actionId, status: "running", phase: "graph_sync", error: null }
    break
  }
  default:
    throw new Error(`Unsupported action: ${action.name}`)
}

writeUiState(workspace, state)
console.log(JSON.stringify({ ok: true, actionId: action.actionId, name: action.name }, null, 2))
