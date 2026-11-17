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
  input: Readonly<{
    userText: string
    assistantText: string
    error?: string
    choices?: FolioUiState["panels"]["creationDesk"]["choices"]
    todos?: FolioUiState["panels"]["creationDesk"]["todos"]
  }>,
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
        ...(input.choices === undefined ? {} : { choices: input.choices }),
        ...(input.todos === undefined ? {} : { todos: input.todos }),
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

export type FolioCreationDeskSendResult = Readonly<{
  userText: string
  assistantText: string
  error?: string
  choices?: FolioUiState["panels"]["creationDesk"]["choices"]
  todos?: FolioUiState["panels"]["creationDesk"]["todos"]
}>

/** Replace creation-desk panel snapshot from host conversation history (Codex + StarseaFolio share). */
export async function syncCreationDeskPanel(
  folio: FolioWorkspace,
  input: Readonly<{
    messages: FolioUiState["panels"]["creationDesk"]["messages"]
    choices?: FolioUiState["panels"]["creationDesk"]["choices"]
    todos?: FolioUiState["panels"]["creationDesk"]["todos"]
    status?: FolioUiState["panels"]["creationDesk"]["status"]
    error?: string | null
  }>,
): Promise<FolioUiState> {
  const current = await folio.readUiState().catch(() => emptyFolioUiState())
  return folio.writeUiState({
    ...current,
    updatedAtMs: Date.now(),
    run: {
      runId: current.run.runId ?? randomUUID(),
      status: input.error ? "failed" : current.run.status === "idle" ? "awaiting_user" : current.run.status,
      phase: "creation_desk",
      error: input.error ?? null,
    },
    panels: {
      ...current.panels,
      creationDesk: {
        messages: input.messages,
        choices: input.choices ?? current.panels.creationDesk.choices,
        todos: input.todos ?? current.panels.creationDesk.todos,
        status: input.status ?? "idle",
        error: input.error ?? null,
      },
    },
  })
}

export type FolioRuntimeActionHandlers = Readonly<{
  /** Stage 1: draft review + settings_extraction (writes 设定集; caches artifact for graph-sync). */
  settingsWrite?: (action: FolioAction) => Promise<Readonly<{
    ok: boolean
    summary: string
    error?: string
  }>>
  /** Stage 2–3 core: graph governance + chapter body publish (after settingsWrite). */
  publishConfirm: (action: FolioAction) => Promise<Readonly<{
    ok: boolean
    summary: string
    error?: string
  }>>
  /** Real discuss turn; when omitted, host only mirrors stub text into ui-state. */
  creationDeskSend?: (action: FolioAction) => Promise<FolioCreationDeskSendResult>
  /** After a real send, rewrite creation-desk panel from conversation (avoids append drift). */
  syncCreationDesk?: () => Promise<FolioUiState>
  graphCancel: (action: FolioAction) => Promise<void>
  graphRerun: (action: FolioAction) => Promise<void>
  graphContinue: (action: FolioAction) => Promise<void>
  listGraphTasks: () => Promise<readonly GraphRevisionTask[]>
}>

/**
 * @deprecated Prefer FolioSkillRunner.dispatchHostedAction — skill `hosted-dispatch.mjs` owns the flow.
 * Kept for direct unit tests that inject FolioWorkspace + handlers.
 */
export async function executeFolioActionWithHost(
  folio: FolioWorkspace,
  action: FolioAction,
  handlers: FolioRuntimeActionHandlers,
): Promise<FolioUiState> {
  const { FolioSkillRunner } = await import("./folio-skill-runner.js")
  const runner = new FolioSkillRunner({
    workspaceRoot: folio.workspaceRoot,
    folio,
    hostHandlers: handlers,
  })
  return runner.dispatchHostedAction(action, handlers)
}
