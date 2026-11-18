#!/usr/bin/env node
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

export function folioRoot(workspaceRoot) {
  return join(workspaceRoot, ".folio")
}

export function emptyUiState(nowMs = Date.now()) {
  return {
    schemaVersion: 1,
    updatedAtMs: nowMs,
    run: { runId: null, status: "idle", phase: "idle", error: null },
    panels: {
      creationDesk: { messages: [], choices: [], todos: [], status: "idle", error: null },
      graphRevision: { tasks: [], status: "idle", error: null },
      chapter: { focus: null, draftLabel: null, publishStatus: null },
    },
  }
}

export function ensureFolioLayout(workspaceRoot) {
  const root = folioRoot(workspaceRoot)
  mkdirSync(join(root, "actions"), { recursive: true })
  mkdirSync(join(root, "runs"), { recursive: true })
  mkdirSync(join(root, "actions", "done"), { recursive: true })
  const uiPath = join(root, "ui-state.json")
  if (!existsSync(uiPath)) writeUiState(workspaceRoot, emptyUiState())
  return root
}

export function readUiState(workspaceRoot) {
  ensureFolioLayout(workspaceRoot)
  const raw = readFileSync(join(folioRoot(workspaceRoot), "ui-state.json"), "utf8")
  return JSON.parse(raw)
}

export function writeUiState(workspaceRoot, state) {
  const root = folioRoot(workspaceRoot)
  mkdirSync(root, { recursive: true })
  const next = { ...state, updatedAtMs: Date.now() }
  const target = join(root, "ui-state.json")
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  try {
    if (existsSync(target)) unlinkSync(target)
    renameSync(temp, target)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* temp already gone */ }
    throw error
  }
  return next
}

export function writeHost(workspaceRoot, host) {
  ensureFolioLayout(workspaceRoot)
  const path = join(folioRoot(workspaceRoot), "host.json")
  writeFileSync(path, `${JSON.stringify({ ...host, updatedAtMs: Date.now() }, null, 2)}\n`, "utf8")
}

export function enqueueAction(workspaceRoot, action) {
  ensureFolioLayout(workspaceRoot)
  const path = join(folioRoot(workspaceRoot), "actions", `${action.actionId}.json`)
  writeFileSync(path, `${JSON.stringify(action, null, 2)}\n`, "utf8")
  return path
}

export function listPendingActions(workspaceRoot) {
  ensureFolioLayout(workspaceRoot)
  const dir = join(folioRoot(workspaceRoot), "actions")
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name))
}

export function claimAction(workspaceRoot, actionPath) {
  const raw = readFileSync(actionPath, "utf8")
  const action = JSON.parse(raw)
  const done = join(folioRoot(workspaceRoot), "actions", "done", `${action.actionId}.json`)
  renameSync(actionPath, done)
  return action
}

export function parseWorkspaceArg(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--workspace")
  if (index < 0 || argv[index + 1] === undefined) {
    throw new Error("Missing --workspace <path>")
  }
  return argv[index + 1]
}
