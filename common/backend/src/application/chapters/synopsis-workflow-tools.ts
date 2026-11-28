import type {
  ChapterNarrativeIntent,
  ConversationArchiveQuery,
  ProjectId,
  SynopsisConversationTodo,
  VisibleModelContextMessage,
} from "@starseafolio/contracts"
import { characterUpdateSchema, conversationArchiveQuerySchema, type CharacterUpdate } from "@starseafolio/contracts"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import type { AIModelPort } from "../turns/ports/ai-model-port.js"
import type { SynopsisBashResult } from "./synopsis-host-bash.js"

export type SynopsisToolContext = Readonly<{
  projectId: ProjectId
  workspaceRootRef: string
  sessionId: string
  chapterSequence: number
  model: AIModelPort
  chapterIntent?: ChapterNarrativeIntent
  presentation?: Readonly<{
    descriptionRulePath?: string | undefined
    proseStyleRulePath?: string | undefined
    minimumWordCount: number
    maximumWordCount: number
  }>
  maxModelCalls?: number
  deadlineMs?: number
  signal?: AbortSignal
}>

export type SynopsisWorkflowToolInput = SynopsisToolContext & Readonly<{
  userInput: string
  heading?: string
  /** When set, generate drafts for these chapters (one model turn pipeline per chapter; results returned together). */
  chapterSequences?: readonly number[]
}>
export type SynopsisWorkflowToolResult = Readonly<{
  revisionTaskId: string
  chapterId: string
  draftVersionId: string
  draftLabel: string
  heading: string
  body: string
  summary?: string
  chapterSequence?: number
  drafts?: readonly Readonly<{
    revisionTaskId: string
    chapterId: string
    draftVersionId: string
    draftLabel: string
    heading: string
    body: string
    chapterSequence: number
  }>[]
}>
export type SynopsisPublishDraftInput = SynopsisToolContext & Readonly<{ revisionTaskId: string; draftVersionId: string }>
export type SynopsisPublishDraftResult = Readonly<{
  revisionTaskId: string
  chapterId: string
  draftVersionId: string
  status: string
  summary?: string
  graphSyncStatus?: string
  error?: string
}>
export type SynopsisRestageInput = SynopsisToolContext & Readonly<{
  targetStage: "synopsis" | "outline"
  reason: string
}>
export type SynopsisRestageResult = Readonly<{
  chapterSequence: number
  targetStage: "synopsis" | "outline"
  reason: string
  synopsisConfirmedCleared: boolean
  clearedOutlinePath?: string
  archivedBodyPath?: string
  retiredBodyPath?: string
  focusKind: "plot_synopsis" | "plot_outline"
  synopsisPath?: string
  outlinePath?: string
}>
export type SynopsisBashInput = SynopsisToolContext & Readonly<{
  command: string
  cwd?: string
  timeoutMs?: number
}>
export type SynopsisTodoWriteInput = SynopsisToolContext & Readonly<{
  todos: readonly SynopsisConversationTodo[]
  merge?: boolean
}>
export type SynopsisTodoWriteResult = Readonly<{
  todos: readonly SynopsisConversationTodo[]
  merge: boolean
}>
export type SynopsisMemoryWriteInput = SynopsisToolContext & Readonly<{
  target: "index" | "topic"
  markdown: string
  /** Required when target=topic; basename or path under 世界推演规则/Agent记忆/ */
  filename?: string
}>
export type SynopsisMemoryWriteResult = Readonly<{
  relativePath: string
  target: "index" | "topic"
  truncated: boolean
  byteLength: number
}>
export type SynopsisLoadSkillInput = SynopsisToolContext & Readonly<{
  skillId: string
  includeReferences?: boolean
}>
export type SynopsisLoadSkillResult = Readonly<{
  skillId: string
  name: string
  includeReferences: boolean
  text: string
  digest: string
}>
export type SynopsisReferenceSearchInput = SynopsisToolContext & Readonly<{ title: string }>
export type SynopsisReferenceDownloadInput = SynopsisToolContext & Readonly<{ bookId: string; title: string; chapterLimit?: number; startChapter?: number }>
export type SynopsisReferenceCandidate = Readonly<{ bookId?: string; title: string; url: string; synopsis?: string; author?: string; originalTitle?: string; language?: string; source?: string }>
export type SynopsisReferenceResult = Readonly<{
  title: string
  output: string
  candidates?: readonly SynopsisReferenceCandidate[]
  importedFiles?: readonly string[]
  candidateUrls?: readonly string[]
}>
export type SynopsisRenameChapterInput = SynopsisToolContext & Readonly<{ title: string }>
export type SynopsisRenameChapterResult = Readonly<{
  chapterSequence: number
  title: string
  previousTitle: string
  synopsisPath: string
  notices: readonly string[]
}>
export type SynopsisUpdateWorkMetadataInput = SynopsisToolContext & Readonly<{
  title?: string
  description?: string
}>
export type SynopsisUpdateWorkMetadataResult = Readonly<{
  workDisplayName?: string
  workDescription?: string
}>
export type SynopsisWorkflowToolCallbacks = Readonly<{
  updateCharacter?: (input: SynopsisToolContext & { update: CharacterUpdate }) => Promise<{ relativePath: string; content: string }>
  renameChapter?: (input: SynopsisRenameChapterInput) => Promise<SynopsisRenameChapterResult>
  updateWorkMetadata?: (input: SynopsisUpdateWorkMetadataInput) => Promise<SynopsisUpdateWorkMetadataResult>
  executeWorkflowTool?: (input: SynopsisWorkflowToolInput) => Promise<SynopsisWorkflowToolResult>
  publishDraft?: (input: SynopsisPublishDraftInput) => Promise<SynopsisPublishDraftResult>
  restageChapter?: (input: SynopsisRestageInput) => Promise<SynopsisRestageResult>
  runBash?: (input: SynopsisBashInput) => Promise<SynopsisBashResult>
  writeTodos?: (input: SynopsisTodoWriteInput) => Promise<SynopsisTodoWriteResult>
  writeMemory?: (input: SynopsisMemoryWriteInput) => Promise<SynopsisMemoryWriteResult>
  loadSkill?: (input: SynopsisLoadSkillInput) => Promise<SynopsisLoadSkillResult>
  searchOriginalWork?: (input: SynopsisReferenceSearchInput) => Promise<SynopsisReferenceResult>
  downloadOriginalWork?: (input: SynopsisReferenceDownloadInput) => Promise<SynopsisReferenceResult>
  readConversationArchive?: (input: SynopsisToolContext & ConversationArchiveQuery) => Promise<object | undefined>
}>
export type SynopsisToolName =
  | "character_update"
  | "rename_chapter"
  | "update_work_metadata"
  | "chapter_workflow"
  | "publish_draft"
  | "restage_chapter"
  | "bash"
  | "todo_write"
  | "memory_write"
  | "load_skill"
  | "original_work_search"
  | "original_work_download"
  | "conversation_archive"
export type SynopsisToolRequest = Readonly<{
  name: SynopsisToolName
  action: "describe" | "invoke"
  arguments?: string | undefined
}>
export type SynopsisDraftReference = Readonly<{
  revisionTaskId: string
  draftVersionId: string
  draftLabel: string
  heading: string
}>

const protocol = "synopsis-tools-v1"
export const DESCRIBE_REQUIRED_MESSAGE = renderRuntimePrompt("discuss-tools", "describe-required")
const descriptions = {
  character_update: {
    parameters: {
      relativePath: renderRuntimePrompt("discuss-tools", "character-update-parameter-relative-path"),
      mode: renderRuntimePrompt("discuss-tools", "character-update-parameter-mode"),
      operations: renderRuntimePrompt("discuss-tools", "character-update-parameter-operations"),
      expectedContent: renderRuntimePrompt("discuss-tools", "character-update-parameter-expected-content"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "character-update-guide"),
  },
  rename_chapter: {
    parameters: {
      title: renderRuntimePrompt("discuss-tools", "rename-chapter-parameter-title"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "rename-chapter-guide"),
  },
  update_work_metadata: {
    parameters: {
      title: renderRuntimePrompt("discuss-tools", "update-work-metadata-parameter-title"),
      description: renderRuntimePrompt("discuss-tools", "update-work-metadata-parameter-description"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "update-work-metadata-guide"),
  },
  chapter_workflow: {
    parameters: {
      userInput: renderRuntimePrompt("discuss-tools", "chapter-workflow-parameter-user-input"),
      heading: renderRuntimePrompt("discuss-tools", "chapter-workflow-parameter-heading"),
      chapterSequences: renderRuntimePrompt("discuss-tools", "chapter-workflow-parameter-chapter-sequences"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "chapter-workflow-guide"),
  },
  publish_draft: {
    parameters: {
      revisionTaskId: renderRuntimePrompt("discuss-tools", "publish-draft-parameter-revision-task-id"),
      draftVersionId: renderRuntimePrompt("discuss-tools", "publish-draft-parameter-draft-version-id"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "publish-draft-guide"),
  },
  restage_chapter: {
    parameters: {
      targetStage: renderRuntimePrompt("discuss-tools", "restage-chapter-parameter-target-stage"),
      reason: renderRuntimePrompt("discuss-tools", "restage-chapter-parameter-reason"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "restage-chapter-guide"),
  },
  bash: {
    parameters: {
      command: renderRuntimePrompt("discuss-tools", "bash-parameter-command"),
      cwd: renderRuntimePrompt("discuss-tools", "bash-parameter-cwd"),
      timeoutMs: renderRuntimePrompt("discuss-tools", "bash-parameter-timeout-ms"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "bash-guide"),
  },
  todo_write: {
    parameters: {
      todos: renderRuntimePrompt("discuss-tools", "todo-write-parameter-todos"),
      merge: renderRuntimePrompt("discuss-tools", "todo-write-parameter-merge"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "todo-write-guide"),
  },
  memory_write: {
    parameters: {
      target: renderRuntimePrompt("discuss-tools", "memory-write-parameter-target"),
      markdown: renderRuntimePrompt("discuss-tools", "memory-write-parameter-markdown"),
      filename: renderRuntimePrompt("discuss-tools", "memory-write-parameter-filename"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "memory-write-guide"),
  },
  load_skill: {
    parameters: {
      skillId: renderRuntimePrompt("discuss-tools", "load-skill-parameter-skill-id"),
      includeReferences: renderRuntimePrompt("discuss-tools", "load-skill-parameter-include-references"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "load-skill-guide"),
  },
  conversation_archive: {
    parameters: {
      operation: renderRuntimePrompt("discuss-tools", "conversation-archive-parameter-operation"),
      query: renderRuntimePrompt("discuss-tools", "conversation-archive-parameter-query"),
      role: renderRuntimePrompt("discuss-tools", "conversation-archive-parameter-role"),
      messageId: renderRuntimePrompt("discuss-tools", "conversation-archive-parameter-message-id"),
      offset: renderRuntimePrompt("discuss-tools", "conversation-archive-parameter-offset"),
    },
    writingGuide: renderRuntimePrompt("discuss-tools", "conversation-archive-guide"),
  },
  original_work_search: {
    parameters: { title: renderRuntimePrompt("discuss-tools", "original-work-search-parameter-title") },
    writingGuide: renderRuntimePrompt("discuss-tools", "original-work-search-guide"),
  },
  original_work_download: {
    parameters: { title: renderRuntimePrompt("discuss-tools", "original-work-download-parameter-title"), bookId: renderRuntimePrompt("discuss-tools", "original-work-download-parameter-book-id"), chapterLimit: renderRuntimePrompt("discuss-tools", "original-work-download-parameter-chapter-limit"), startChapter: renderRuntimePrompt("discuss-tools", "original-work-download-parameter-start-chapter") },
    writingGuide: renderRuntimePrompt("discuss-tools", "original-work-download-guide"),
  },
} as const

function callbackForTool(
  name: SynopsisToolName,
  callbacks: SynopsisWorkflowToolCallbacks,
): ((input: never) => Promise<unknown>) | undefined {
  if (name === "character_update") return callbacks.updateCharacter
  if (name === "rename_chapter") return callbacks.renameChapter as ((input: never) => Promise<unknown>) | undefined
  if (name === "update_work_metadata") {
    return callbacks.updateWorkMetadata as ((input: never) => Promise<unknown>) | undefined
  }
  if (name === "chapter_workflow") return callbacks.executeWorkflowTool as ((input: never) => Promise<unknown>) | undefined
  if (name === "publish_draft") return callbacks.publishDraft as ((input: never) => Promise<unknown>) | undefined
  if (name === "restage_chapter") return callbacks.restageChapter as ((input: never) => Promise<unknown>) | undefined
  if (name === "bash") return callbacks.runBash as ((input: never) => Promise<unknown>) | undefined
  if (name === "todo_write") return callbacks.writeTodos as ((input: never) => Promise<unknown>) | undefined
  if (name === "memory_write") return callbacks.writeMemory as ((input: never) => Promise<unknown>) | undefined
  if (name === "load_skill") return callbacks.loadSkill as ((input: never) => Promise<unknown>) | undefined
  if (name === "conversation_archive") return callbacks.readConversationArchive
  if (name === "original_work_search") return callbacks.searchOriginalWork
  return callbacks.downloadOriginalWork
}

export function synopsisToolCatalog(callbacks: SynopsisWorkflowToolCallbacks, archiveNotice?: string): string {
  return JSON.stringify({
    protocol,
    instruction: renderRuntimePrompt("discuss-tools", "catalog-instruction"),
    ...(callbacks.readConversationArchive !== undefined && archiveNotice !== undefined
      ? { notice: archiveNotice } : {}),
    tools: [
      ...(callbacks.updateCharacter === undefined ? [] : [{
        name: "character_update", displayName: "人物字段工具",
        definition: renderRuntimePrompt("discuss-tools", "character-update-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "character-update-scenario"),
      }]),
      ...(callbacks.renameChapter === undefined ? [] : [{
        name: "rename_chapter", displayName: "章节改名",
        definition: renderRuntimePrompt("discuss-tools", "rename-chapter-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "rename-chapter-scenario"),
      }]),
      ...(callbacks.updateWorkMetadata === undefined ? [] : [{
        name: "update_work_metadata", displayName: "作品元数据",
        definition: renderRuntimePrompt("discuss-tools", "update-work-metadata-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "update-work-metadata-scenario"),
      }]),
      ...(callbacks.executeWorkflowTool === undefined ? [] : [{
        name: "chapter_workflow",
        displayName: "正文推演工具",
        definition: renderRuntimePrompt("discuss-tools", "chapter-workflow-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "chapter-workflow-scenario"),
      }]),
      ...(callbacks.publishDraft === undefined ? [] : [{
        name: "publish_draft",
        displayName: "图治理工具",
        definition: renderRuntimePrompt("discuss-tools", "publish-draft-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "publish-draft-scenario"),
      }]),
      ...(callbacks.restageChapter === undefined ? [] : [{
        name: "restage_chapter",
        displayName: "章节阶段回退",
        definition: renderRuntimePrompt("discuss-tools", "restage-chapter-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "restage-chapter-scenario"),
      }]),
      ...(callbacks.runBash === undefined ? [] : [{
        name: "bash",
        displayName: "工作区 Bash",
        definition: renderRuntimePrompt("discuss-tools", "bash-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "bash-scenario"),
      }]),
      ...(callbacks.writeTodos === undefined ? [] : [{
        name: "todo_write",
        displayName: "Todo 清单",
        definition: renderRuntimePrompt("discuss-tools", "todo-write-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "todo-write-scenario"),
      }]),
      ...(callbacks.writeMemory === undefined ? [] : [{
        name: "memory_write",
        displayName: "Agent 记忆",
        definition: renderRuntimePrompt("discuss-tools", "memory-write-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "memory-write-scenario"),
      }]),
      ...(callbacks.loadSkill === undefined ? [] : [{
        name: "load_skill",
        displayName: "加载 Skill",
        definition: renderRuntimePrompt("discuss-tools", "load-skill-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "load-skill-scenario"),
      }]),
      ...(callbacks.readConversationArchive === undefined ? [] : [{
        name: "conversation_archive", displayName: "会话存档",
        definition: renderRuntimePrompt("discuss-tools", "conversation-archive-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "conversation-archive-scenario"),
      }]),
      ...(callbacks.searchOriginalWork === undefined ? [] : [{
        name: "original_work_search", displayName: "同人原作资料搜索",
        definition: renderRuntimePrompt("discuss-tools", "original-work-search-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "original-work-search-scenario"),
      }]),
      ...(callbacks.downloadOriginalWork === undefined ? [] : [{
        name: "original_work_download", displayName: "原作小说下载",
        definition: renderRuntimePrompt("discuss-tools", "original-work-download-definition"),
        scenario: renderRuntimePrompt("discuss-tools", "original-work-download-scenario"),
      }]),
    ],
  })
}

// Only a currently visible, system-authored description grants invocation access.
// The latest grant for each tool stays visible through context compaction.
export function hasVisibleToolDescription(messages: readonly VisibleModelContextMessage[], name: SynopsisToolName): boolean {
  return messages.some((message) => {
    if (message.role !== "system" || message.kind !== "phase_instruction") return false
    try {
      const result = JSON.parse(message.content) as Record<string, unknown>
      return result.protocol === protocol && result.name === name
        && result.action === "describe" && result.status === "described"
    } catch {
      return false
    }
  })
}

function parseArguments(raw: string | undefined, keys: readonly string[]): Record<string, unknown> {
  const value: unknown = JSON.parse(raw ?? "{}")
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments 必须为 JSON 对象")
  const args = value as Record<string, unknown>
  if (Object.keys(args).some((key) => !keys.includes(key))) throw new Error("arguments 含未披露参数；不能覆盖章节、模型或项目")
  return args
}

function requiredText(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${key} 必须为非空字符串`)
  return value.trim()
}

/** File body: non-empty after trim, but preserve intentional trailing newlines. */
function requiredMarkdownBody(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${key} 必须为非空字符串`)
  return value.replaceAll("\r\n", "\n")
}

function requiredTargetStage(args: Record<string, unknown>): "synopsis" | "outline" {
  const value = args.targetStage
  if (value !== "synopsis" && value !== "outline") {
    throw new Error("targetStage 必须为 \"synopsis\" 或 \"outline\"")
  }
  return value
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key]
  if (typeof value !== "boolean") throw new Error(`${key} 必须为布尔值`)
  return value
}

function optionalPositiveIntArray(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("chapterSequences 必须为非空正整数数组")
  }
  const sequences: number[] = []
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1) {
      throw new Error("chapterSequences 每项必须为正整数")
    }
    sequences.push(item)
  }
  return sequences
}

function requiredTodos(raw: unknown): SynopsisConversationTodo[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("todos 必须为非空数组")
  const todos: SynopsisConversationTodo[] = []
  const seen = new Set<string>()
  let inProgress = 0
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("todos 每项必须为对象")
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id.trim() : ""
    const content = typeof record.content === "string" ? record.content.trim() : ""
    const status = record.status
    if (id.length === 0 || content.length === 0) throw new Error("todos.id/content 不能为空")
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "cancelled") {
      throw new Error("todos.status 非法")
    }
    if (seen.has(id)) throw new Error(`todos.id 重复：${id}`)
    seen.add(id)
    if (status === "in_progress") inProgress += 1
    todos.push({ id, content, status })
  }
  if (inProgress > 1) throw new Error("同一时刻最多一个 in_progress todo")
  return todos
}

export async function executeSynopsisTool(input: Readonly<{
  request: SynopsisToolRequest
  context: SynopsisToolContext
  callbacks: SynopsisWorkflowToolCallbacks
  visibleMessages: readonly VisibleModelContextMessage[]
  listDrafts: () => Promise<readonly SynopsisDraftReference[]>
  /** False until the user confirms the draft. Host publication does not use this tool. */
  allowPublish?: boolean
}>): Promise<Record<string, unknown>> {
  const { request, context, callbacks } = input
  const envelope = { protocol, name: request.name, action: request.action, chapterSequence: context.chapterSequence }
  context.signal?.throwIfAborted()
  try {
    const available = callbackForTool(request.name, callbacks)
    if (available === undefined) {
      const message = request.name === "chapter_workflow"
        ? renderRuntimePrompt("discuss-tools", "chapter-workflow-unavailable")
        : "该工具当前不可用"
      return { ...envelope, status: "error", code: "tool_unavailable", message }
    }
    if (request.action === "describe") {
      return { ...envelope, status: "described", ...descriptions[request.name],
        ...(request.name === "publish_draft" ? { drafts: await input.listDrafts() } : {}) }
    }
    // The prompt may ask for describe first. todo_write arguments are validated
    // directly; a missing describe must not block the invocation.
    if (request.name !== "todo_write" && !hasVisibleToolDescription(input.visibleMessages, request.name)) {
      return { ...envelope, status: "error", code: "describe_required", message: DESCRIBE_REQUIRED_MESSAGE }
    }
    if (request.name === "character_update") {
      const update = characterUpdateSchema.parse(JSON.parse(request.arguments ?? "{}"))
      if (callbacks.updateCharacter === undefined) throw new Error("人物字段工具不可用")
      const result = await callbacks.updateCharacter({ ...context, update })
      return { ...envelope, status: "character_updated", result }
    }
    if (request.name === "rename_chapter") {
      const args = parseArguments(request.arguments, ["title"])
      if (callbacks.renameChapter === undefined) throw new Error("章节改名工具不可用")
      const result = await callbacks.renameChapter({ ...context, title: requiredText(args, "title") })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "chapter_renamed", result }
    }
    if (request.name === "update_work_metadata") {
      const args = parseArguments(request.arguments, ["title", "description"])
      if (callbacks.updateWorkMetadata === undefined) throw new Error("作品元数据工具不可用")
      const title = args.title === undefined ? undefined : requiredText(args, "title")
      const description = args.description === undefined
        ? undefined
        : (typeof args.description === "string" ? args.description.replaceAll("\r\n", "\n") : (() => {
          throw new Error("description 必须为字符串")
        })())
      if (title === undefined && description === undefined) {
        throw new Error("须提供 title 或 description 至少一个")
      }
      if (description !== undefined && description.trim().length > 300) {
        throw new Error("作品简介最多 300 字")
      }
      const result = await callbacks.updateWorkMetadata({
        ...context,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
      })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "work_metadata_updated", result }
    }
    if (request.name === "chapter_workflow") {
      const args = parseArguments(request.arguments, ["userInput", "heading", "chapterSequences"])
      const chapterSequences = optionalPositiveIntArray(args.chapterSequences)
      const result = await callbacks.executeWorkflowTool!({
        ...context,
        userInput: requiredText(args, "userInput"),
        ...(args.heading === undefined ? {} : { heading: requiredText(args, "heading") }),
        ...(chapterSequences === undefined ? {} : { chapterSequences }),
      })
      context.signal?.throwIfAborted()
      const multi = result.drafts !== undefined && result.drafts.length > 1
      return {
        ...envelope,
        status: multi ? "drafts_created" : "draft_created",
        result,
        ...(multi ? { chapterCount: result.drafts!.length } : {}),
      }
    }
    if (request.name === "restage_chapter") {
      const args = parseArguments(request.arguments, ["targetStage", "reason"])
      const result = await callbacks.restageChapter!({
        ...context,
        targetStage: requiredTargetStage(args),
        reason: requiredText(args, "reason"),
      })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "restaged", result }
    }
    if (request.name === "bash") {
      const args = parseArguments(request.arguments, ["command", "cwd", "timeoutMs"])
      const timeoutRaw = args.timeoutMs
      const timeoutMs = timeoutRaw === undefined
        ? undefined
        : (typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
          ? Math.trunc(timeoutRaw)
          : (() => { throw new Error("timeoutMs 必须为数字") })())
      const result = await callbacks.runBash!({
        ...context,
        command: requiredText(args, "command"),
        ...(args.cwd === undefined ? {} : { cwd: requiredText(args, "cwd") }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "bash_completed", result }
    }
    if (request.name === "todo_write") {
      const args = parseArguments(request.arguments, ["todos", "merge"])
      const todos = requiredTodos(args.todos)
      const merge = args.merge === undefined ? false : requiredBoolean(args, "merge")
      const result = await callbacks.writeTodos!({
        ...context,
        todos,
        merge,
      })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "todos_updated", result }
    }
    if (request.name === "memory_write") {
      const args = parseArguments(request.arguments, ["target", "markdown", "filename"])
      const target = args.target
      if (target !== "index" && target !== "topic") {
        throw new Error('target 必须为 "index" 或 "topic"')
      }
      const markdown = requiredMarkdownBody(args, "markdown")
      const filename = args.filename === undefined ? undefined : requiredText(args, "filename")
      if (target === "topic" && filename === undefined) {
        throw new Error("target=topic 时必须提供 filename")
      }
      const result = await callbacks.writeMemory!({
        ...context,
        target,
        markdown,
        ...(filename === undefined ? {} : { filename }),
      })
      context.signal?.throwIfAborted()
      return { ...envelope, status: "memory_written", result }
    }
    if (request.name === "load_skill") {
      const args = parseArguments(request.arguments, ["skillId", "includeReferences"])
      const skillId = requiredText(args, "skillId")
      const includeReferences = args.includeReferences === undefined
        ? false
        : requiredBoolean(args, "includeReferences")
      const result = await callbacks.loadSkill!({
        ...context,
        skillId,
        includeReferences,
      })
      context.signal?.throwIfAborted()
      return {
        ...envelope,
        status: "skill_loaded",
        protocol: "synopsis-skills-v1",
        skillId: result.skillId,
        result,
      }
    }
    if (request.name === "conversation_archive") {
      const query = conversationArchiveQuerySchema.parse(JSON.parse(request.arguments ?? "{}"))
      const result = await callbacks.readConversationArchive?.({ ...context, ...query })
      return result === undefined
        ? { ...envelope, status: "error", code: "archive_message_not_found", message: "当前会话存档中没有这条消息。" }
        : { ...envelope, status: query.operation === "read" ? "archive_message" : "archive_matches", result }
    }
    if (request.name === "original_work_search") {
      const args = parseArguments(request.arguments, ["title"])
      if (callbacks.searchOriginalWork === undefined) throw new Error("原作搜索不可用")
      const result = await callbacks.searchOriginalWork({ ...context, title: requiredText(args, "title") })
      return { ...envelope, status: result.candidateUrls?.length === 0 ? "reference_search_empty" : "reference_candidates_found", result }
    }
    if (request.name === "original_work_download") {
      const args = parseArguments(request.arguments, ["title", "bookId", "chapterLimit", "startChapter"])
      if (typeof args.chapterLimit !== "number" || !Number.isSafeInteger(args.chapterLimit) || args.chapterLimit < 1 || args.chapterLimit > 20_000) throw new Error("chapterLimit 必须为 1..20000 的整数；必须限定导入范围")
      if (args.startChapter !== undefined && (typeof args.startChapter !== "number" || !Number.isSafeInteger(args.startChapter) || args.startChapter < 1 || args.startChapter > 20_000)) throw new Error("startChapter 必须为 1..20000 的整数")
      if (callbacks.downloadOriginalWork === undefined) throw new Error("原作下载不可用")
      const result = await callbacks.downloadOriginalWork({ ...context, title: requiredText(args, "title"), bookId: requiredText(args, "bookId"), chapterLimit: args.chapterLimit, ...(args.startChapter === undefined ? {} : { startChapter: args.startChapter }) })
      return { ...envelope, status: "reference_imported", result }
    }
    if (input.allowPublish === false) {
      return {
        ...envelope,
        status: "error",
        code: "draft_confirmation_required",
        message: renderRuntimePrompt("discuss-tools", "publish-confirmation-required"),
      }
    }
    const args = parseArguments(request.arguments, ["revisionTaskId", "draftVersionId"])
    const revisionTaskId = requiredText(args, "revisionTaskId")
    const draftVersionId = requiredText(args, "draftVersionId")
    const drafts = await input.listDrafts()
    if (!drafts.some((draft) => draft.revisionTaskId === revisionTaskId && draft.draftVersionId === draftVersionId)) {
      return { ...envelope, status: "error", code: "draft_not_in_focus", message: renderRuntimePrompt("discuss-tools", "draft-not-in-focus") }
    }
    context.signal?.throwIfAborted()
    const result = await callbacks.publishDraft!({ ...context, revisionTaskId, draftVersionId })
    context.signal?.throwIfAborted()
    if (result.error !== undefined) {
      return { ...envelope, status: "error", code: "publication_failed", message: result.error, result }
    }
    return { ...envelope, status: "publication_submitted", result }
  } catch (error) {
    context.signal?.throwIfAborted()
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (request.name === "original_work_download"
      && /只能下载本次原作搜索返回|没有可核对的作品简介|书籍详情与搜索候选不匹配/iu.test(errorMessage)) {
      return { ...envelope, status: "reference_candidate_rejected", code: "candidate_not_verified", message: errorMessage }
    }
    return { ...envelope, status: "error", code: "tool_failed", message: errorMessage }
  }
}
