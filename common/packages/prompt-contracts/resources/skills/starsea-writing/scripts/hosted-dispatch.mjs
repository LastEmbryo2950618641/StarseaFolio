/**
 * Skill-owned hosted action dispatcher.
 * StarseaFolio / folio-run inject hostHandlers; this module owns the action → stage flow.
 */
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { emptyUiState } from "./folio-lib.mjs"

const scriptsDir = dirname(fileURLToPath(import.meta.url))

function emptyState() {
  return emptyUiState()
}

async function loadStage(name) {
  const url = pathToFileURL(join(scriptsDir, name)).href
  return import(url)
}

/**
 * @param {{
 *   readUiState: () => Promise<object>,
 *   writeUiState: (state: object) => Promise<object>,
 * }} folio
 * @param {object} action
 * @param {object} handlers
 */
export async function executeHostedAction(folio, action, handlers) {
  const now = Date.now()

  if (action.name === "creationDesk.send" || action.name === "creationDesk.choose") {
    const text = typeof action.input?.text === "string"
      ? action.input.text
      : typeof action.input?.message === "string"
        ? action.input.message
        : typeof action.input?.label === "string"
          ? action.input.label
          : ""
    if (typeof handlers.creationDeskSend === "function") {
      const state = await folio.readUiState().catch(() => emptyState())
      await folio.writeUiState({
        ...state,
        run: { runId: action.actionId, status: "running", phase: "creation_desk", error: null },
        panels: {
          ...state.panels,
          creationDesk: { ...state.panels.creationDesk, status: "running", error: null },
        },
        updatedAtMs: now,
      })
      const result = await handlers.creationDeskSend(action)
      if (typeof handlers.syncCreationDesk === "function") {
        return handlers.syncCreationDesk()
      }
      return appendExchange(folio, result)
    }
    return appendExchange(folio, {
      userText: text,
      assistantText: "已接收创作台输入（starsea-writing / .folio）。",
    })
  }

  if (action.name === "publish.confirm") {
    const ctx = { folio, action, handlers, now }
    const settings = await loadStage("settings-write.mjs")
    await settings.runHosted(ctx)
    const graph = await loadStage("graph-sync.mjs")
    await graph.runHosted(ctx)
    const chapter = await loadStage("chapter-publish.mjs")
    return chapter.runHosted(ctx)
  }

  if (action.name === "graph.cancel") {
    await handlers.graphCancel(action)
    return syncGraph(folio, handlers)
  }
  if (action.name === "graph.rerun") {
    await handlers.graphRerun(action)
    return syncGraph(folio, handlers)
  }
  if (action.name === "graph.continue") {
    await handlers.graphContinue(action)
    return syncGraph(folio, handlers)
  }

  throw new Error(`Unsupported folio action: ${action.name}`)
}

async function appendExchange(folio, input) {
  const current = await folio.readUiState().catch(() => emptyState())
  const t = Date.now()
  return folio.writeUiState({
    ...current,
    updatedAtMs: t,
    run: {
      runId: current.run.runId ?? randomUUID(),
      status: input.error === undefined ? "awaiting_user" : "failed",
      phase: "creation_desk",
      error: input.error ?? null,
    },
    panels: {
      ...current.panels,
      creationDesk: {
        ...current.panels.creationDesk,
        status: input.error === undefined ? "idle" : "failed",
        error: input.error ?? null,
        ...(input.choices === undefined ? {} : { choices: input.choices }),
        ...(input.todos === undefined ? {} : { todos: input.todos }),
        messages: [
          ...current.panels.creationDesk.messages,
          { messageId: randomUUID(), role: "user", content: input.userText, createdAtMs: t },
          {
            messageId: randomUUID(),
            role: "assistant",
            content: input.assistantText,
            ...(input.error === undefined ? {} : { error: input.error }),
            createdAtMs: t + 1,
          },
        ],
      },
    },
  })
}

async function syncGraph(folio, handlers) {
  const tasks = await handlers.listGraphTasks()
  const current = await folio.readUiState().catch(() => emptyState())
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
  const active = folioTasks.find((task) => task.status === "running" || task.status === "failed")
  return folio.writeUiState({
    ...current,
    updatedAtMs: Date.now(),
    run: {
      runId: active?.revisionTaskId ?? current.run.runId,
      status: active?.status === "running"
        ? "running"
        : active?.status === "failed"
          ? "failed"
          : folioTasks.some((task) => task.status === "completed")
            && folioTasks.every((task) => task.status === "completed" || task.status === "retired")
            ? "completed"
            : current.run.status,
      phase: active === undefined ? current.run.phase : "graph_sync",
      error: active?.error ?? null,
    },
    panels: {
      ...current.panels,
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
}
