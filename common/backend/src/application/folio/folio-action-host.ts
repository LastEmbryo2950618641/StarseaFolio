import { randomUUID } from "node:crypto"
import {
  emptyFolioUiState,
  type FolioAction,
  type FolioGraphTask,
  type FolioUiState,
  type GraphRevisionTask,
} from "@starseafolio/contracts"
import { FolioWorkspace } from "./folio-workspace.js"

export function graphRevisionTasksToFolio(tasks: readonly GraphRevisionTask[]): FolioGraphTask[] {
  return tasks.map((task) => ({
    revisionTaskId: task.revisionTaskId,
    chapterId: task.chapterId,
    heading: task.heading,
    ...(task.graphSyncTaskId === undefined ? {} : { graphSyncTaskId: task.graphSyncTaskId }),
    status: task.status,
    canCancel: task.canCancel,
    canRetry: task.canRetry,
    canContinue: task.canContinue,
    blocksTurn: task.blocksTurn,
    ...(task.error === undefined ? {} : { error: task.error }),
    ...(task.activity === undefined ? {} : { activity: task.activity }),
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
}

export async function syncGraphTasksIntoUiState(
  folio: FolioWorkspace,
  tasks: readonly GraphRevisionTask[],
): Promise<FolioUiState> {
  const current = await folio.readUiState().catch(() => emptyFolioUiState())
  const folioTasks = graphRevisionTasksToFolio(tasks)
  const active = folioTasks.find((task) => task.status === "running" || task.status === "failed")
  const next: FolioUiState = {
    ...current,
    updatedAtMs: Date.now(),
    run: {
      runId: active?.revisionTaskId ?? current.run.runId,
      status: active?.status === "running"
        ? "running"
        : active?.status === "failed"
          ? "failed"
          : folioTasks.some((task) => task.status === "completed") && folioTasks.every((task) => (
            task.status === "completed" || task.status === "retired"
          ))
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
  }
  return folio.writeUiState(next)
}

export async function appendCreationDeskExchange(
  folio: FolioWorkspace,
  input: Readonly<{ userText: string; assistantText: string; error?: string }>,
): Promise<FolioUiState> {
  const current = await folio.readUiState().catch(() => emptyFolioUiState())
  const now = Date.now()
  const next: FolioUiState = {
    ...current,
    updatedAtMs: now,
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
        messages: [
          ...current.panels.creationDesk.messages,
          {
            messageId: randomUUID(),
            role: "user",
            content: input.userText,
            createdAtMs: now,
          },
          {
            messageId: randomUUID(),
            role: "assistant",
            content: input.assistantText,
            ...(input.error === undefined ? {} : { error: input.error }),
            createdAtMs: now + 1,
          },
        ],
      },
    },
  }
  return folio.writeUiState(next)
}

export type FolioRuntimeActionHandlers = Readonly<{
  publishConfirm: (action: FolioAction) => Promise<Readonly<{
    ok: boolean
    summary: string
    error?: string
  }>>
  graphCancel: (action: FolioAction) => Promise<void>
  graphRerun: (action: FolioAction) => Promise<void>
  graphContinue: (action: FolioAction) => Promise<void>
  listGraphTasks: () => Promise<readonly GraphRevisionTask[]>
}>

/** Host-side skill action execution: real disk/graph/publish work, then ui-state refresh. */
export async function executeFolioActionWithHost(
  folio: FolioWorkspace,
  action: FolioAction,
  handlers: FolioRuntimeActionHandlers,
): Promise<FolioUiState> {
  const now = Date.now()
  if (action.name === "creationDesk.send" || action.name === "creationDesk.choose") {
    const text = typeof action.input.text === "string"
      ? action.input.text
      : typeof action.input.label === "string"
        ? action.input.label
        : ""
    return appendCreationDeskExchange(folio, {
      userText: text,
      assistantText: "已接收创作台输入（starsea-writing / .folio）。",
    })
  }

  if (action.name === "publish.confirm") {
    const state = await folio.readUiState().catch(() => emptyFolioUiState())
    await folio.writeUiState({
      ...state,
      run: { runId: action.actionId, status: "running", phase: "settings_write", error: null },
      panels: {
        ...state.panels,
        chapter: { ...state.panels.chapter, publishStatus: "settings_write" },
        creationDesk: { ...state.panels.creationDesk, status: "running", error: null },
      },
      updatedAtMs: now,
    })
    const result = await handlers.publishConfirm(action)
    const tasks = await handlers.listGraphTasks()
    await syncGraphTasksIntoUiState(folio, tasks)
    const after = await folio.readUiState()
    return folio.writeUiState({
      ...after,
      run: {
        runId: action.actionId,
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
    })
  }

  if (action.name === "graph.cancel") {
    await handlers.graphCancel(action)
    return syncGraphTasksIntoUiState(folio, await handlers.listGraphTasks())
  }
  if (action.name === "graph.rerun") {
    await handlers.graphRerun(action)
    return syncGraphTasksIntoUiState(folio, await handlers.listGraphTasks())
  }
  if (action.name === "graph.continue") {
    await handlers.graphContinue(action)
    return syncGraphTasksIntoUiState(folio, await handlers.listGraphTasks())
  }

  throw new Error(`Unsupported folio action: ${action.name}`)
}
