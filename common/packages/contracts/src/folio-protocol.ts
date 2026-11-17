import { z } from "zod"

export const folioHostKindSchema = z.enum(["starseafolio", "codex", "claude"])
export type FolioHostKind = z.infer<typeof folioHostKindSchema>

export const folioHostSchema = z.object({
  host: folioHostKindSchema,
  workspaceRoot: z.string().min(1),
  skillId: z.string().min(1).default("starsea-writing"),
  updatedAtMs: z.number().int().nonnegative(),
})
export type FolioHost = z.infer<typeof folioHostSchema>

export const folioRunStatusSchema = z.enum([
  "idle",
  "running",
  "awaiting_user",
  "failed",
  "completed",
])
export type FolioRunStatus = z.infer<typeof folioRunStatusSchema>

export const folioRunPhaseSchema = z.enum([
  "creation_desk",
  "settings_write",
  "graph_sync",
  "chapter_publish",
  "idle",
])
export type FolioRunPhase = z.infer<typeof folioRunPhaseSchema>

export const folioCreationDeskMessageSchema = z.object({
  messageId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  error: z.string().min(1).optional(),
  createdAtMs: z.number().int().nonnegative(),
})
export type FolioCreationDeskMessage = z.infer<typeof folioCreationDeskMessageSchema>

export const folioCreationDeskChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  action: z.string().min(1).optional(),
})
export type FolioCreationDeskChoice = z.infer<typeof folioCreationDeskChoiceSchema>

export const folioTodoSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
})
export type FolioTodo = z.infer<typeof folioTodoSchema>

export const folioGraphPhaseSchema = z.object({
  phase: z.string().min(1),
  status: z.string().min(1),
  attempt: z.number().int().positive().default(1),
})
export type FolioGraphPhase = z.infer<typeof folioGraphPhaseSchema>

export const folioGraphTaskSchema = z.object({
  revisionTaskId: z.string().min(1),
  heading: z.string().min(1),
  status: z.string().min(1),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  canContinue: z.boolean(),
  error: z.string().optional(),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    phase: z.string().optional(),
    phases: z.array(folioGraphPhaseSchema),
  }),
  updatedAtMs: z.number().int().nonnegative(),
})
export type FolioGraphTask = z.infer<typeof folioGraphTaskSchema>

export const folioUiStateSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAtMs: z.number().int().nonnegative(),
  run: z.object({
    runId: z.string().min(1).nullable(),
    status: folioRunStatusSchema,
    phase: folioRunPhaseSchema,
    error: z.string().nullable(),
  }),
  panels: z.object({
    creationDesk: z.object({
      messages: z.array(folioCreationDeskMessageSchema),
      choices: z.array(folioCreationDeskChoiceSchema),
      todos: z.array(folioTodoSchema),
      status: z.enum(["idle", "running", "failed"]),
      error: z.string().nullable(),
    }),
    graphRevision: z.object({
      tasks: z.array(folioGraphTaskSchema),
      status: z.enum(["idle", "running", "failed", "completed"]),
      error: z.string().nullable(),
    }),
    chapter: z.object({
      focus: z.string().nullable(),
      draftLabel: z.string().nullable(),
      publishStatus: z.string().nullable(),
    }),
  }),
})
export type FolioUiState = z.infer<typeof folioUiStateSchema>

export const folioActionNameSchema = z.enum([
  "creationDesk.send",
  "creationDesk.choose",
  "publish.confirm",
  "graph.cancel",
  "graph.rerun",
  "graph.continue",
])
export type FolioActionName = z.infer<typeof folioActionNameSchema>

export const folioActionSchema = z.object({
  actionId: z.string().min(1),
  name: folioActionNameSchema,
  createdAtMs: z.number().int().nonnegative(),
  input: z.record(z.string(), z.unknown()).default({}),
})
export type FolioAction = z.infer<typeof folioActionSchema>

export function emptyFolioUiState(nowMs = Date.now()): FolioUiState {
  return {
    schemaVersion: 1,
    updatedAtMs: nowMs,
    run: {
      runId: null,
      status: "idle",
      phase: "idle",
      error: null,
    },
    panels: {
      creationDesk: {
        messages: [],
        choices: [],
        todos: [],
        status: "idle",
        error: null,
      },
      graphRevision: {
        tasks: [],
        status: "idle",
        error: null,
      },
      chapter: {
        focus: null,
        draftLabel: null,
        publishStatus: null,
      },
    },
  }
}
