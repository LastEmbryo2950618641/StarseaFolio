import type { SynopsisConversationTodo } from "@starseafolio/contracts"

import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

export const DISCUSS_TODO_REQUIRED_HINT = renderRuntimePrompt("discuss-repairs", "todo-required")

export const DISCUSS_TODO_INCOMPLETE_HINT = renderRuntimePrompt("discuss-repairs", "todo-incomplete")

export const DISCUSS_TODO_NO_PROGRESS_HINT = renderRuntimePrompt("discuss-repairs", "todo-no-progress")

export const DISCUSS_TOOL_EXCLUSIVE_GATE_HINT = renderRuntimePrompt("discuss-repairs", "tool-exclusive")

/** Sequential chapter-index gate: cannot open draft N+2 before N is published. */
export function discussChapterSequenceGateHint(
  nextSequence: number,
  deferredSequences: readonly number[],
): string {
  const deferred = deferredSequences.length === 0
    ? "跳号章"
    : deferredSequences.map((sequence) => `第${String(sequence)}章`).join("、")
  return renderRuntimePrompt("discuss-repairs", "chapter-sequence", { nextSequence, deferred })
}

export function isPrecedingChapterPublishGateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Publish the preceding chapter before drafting the next chapter")
    || message.includes("前一章尚未经过图修订发布为正文")
    || message.includes("当前章尚未经过图修订发布为正文，不能进入下一章")
}

/** Keep sequences that are already published or equal to the next open slot. */
export function partitionChapterDraftSequences(
  sequences: readonly number[],
  nextSequence: number,
  indexedSequences: ReadonlySet<number>,
): Readonly<{ allowed: readonly number[]; deferred: readonly number[] }> {
  const allowed: number[] = []
  const deferred: number[] = []
  for (const sequence of sequences) {
    if (indexedSequences.has(sequence) || sequence <= nextSequence) allowed.push(sequence)
    else deferred.push(sequence)
  }
  return { allowed, deferred }
}

export function shouldRetryDeferredChapterDraft(input: Readonly<{
  hadDraftIntent: boolean
  hasAllowedDraft: boolean
  deferredSequences: readonly number[]
  remainingCalls: number
}>): boolean {
  return input.hadDraftIntent
    && !input.hasAllowedDraft
    && input.deferredSequences.length > 0
    && input.remainingCalls > 1
}

const WRITE_LIKE_TODO = /写|草稿|落盘|发布|推演|焦点|梗概|细纲|大纲|设定|focus|draft|publish|synopsis|outline/iu
const TOOL_LIKE_TODO = /工具|读取|request_read|bash|todo|describe|invoke|列目录|本机/iu
const CHAPTER_SEQ_IN_TODO = /第\s*(\d+)\s*章/u

/** Todo bootstrap and read-only reference retrieval do not authorize story writes. */
export function isDiscussTodoBootstrapTool(name: string): boolean {
  return name === "todo_write" || name === "conversation_archive"
    || name === "original_work_search" || name === "original_work_download"
}

/**
 * Align Todo panel after the tool-exclusive gate deferred write fields.
 * - Ensure a tool step is in_progress
 * - Park premature write/focus steps back to pending
 */
export function alignTodosForToolExclusiveGate(
  todos: readonly SynopsisConversationTodo[],
  strippedKeys: readonly string[],
): readonly SynopsisConversationTodo[] {
  if (strippedKeys.length === 0) return todos
  if (todos.length === 0) {
    return [
      { id: "gate-tool", content: "先单独调用工具并等待结果", status: "in_progress" },
      {
        id: "gate-write",
        content: `工具返回后再交付：${strippedKeys.slice(0, 6).join("、")}`,
        status: "pending",
      },
    ]
  }
  const next = todos.map((item) => ({ ...item }))
  for (const item of next) {
    if (item.status === "in_progress" && WRITE_LIKE_TODO.test(item.content) && !TOOL_LIKE_TODO.test(item.content)) {
      item.status = "pending"
    }
  }
  const deferredLabel = `延后交付：${strippedKeys.slice(0, 6).join("、")}`
  if (!next.some((item) => item.content.includes("延后交付"))) {
    next.push({
      id: `gate-deferred-${String(strippedKeys.length)}`,
      content: deferredLabel,
      status: "pending",
    })
  }
  const hasInProgress = next.some((item) => item.status === "in_progress")
  if (!hasInProgress) {
    // Prefer a real tool step; never re-promote the write/focus work we just deferred.
    const toolStep = next.find((item) => (
      item.status === "pending" && TOOL_LIKE_TODO.test(item.content)
    )) ?? next.find((item) => (
      item.status === "pending"
      && !WRITE_LIKE_TODO.test(item.content)
      && !item.content.includes("延后交付")
    ))
    if (toolStep !== undefined) {
      toolStep.status = "in_progress"
    } else {
      next.unshift({
        id: "gate-tool",
        content: "先单独调用工具并等待结果",
        status: "in_progress",
      })
    }
  }
  // Enforce at most one in_progress.
  let seenInProgress = false
  for (const item of next) {
    if (item.status !== "in_progress") continue
    if (!seenInProgress) {
      seenInProgress = true
      continue
    }
    item.status = "pending"
  }
  return next
}

/**
 * Align Todo after sequential draft gate deferred ahead chapters.
 * Parks jump-ahead draft items; makes "finish/publish nextSequence" in_progress.
 */
export function alignTodosForChapterSequenceGate(
  todos: readonly SynopsisConversationTodo[],
  nextSequence: number,
  deferredSequences: readonly number[],
): readonly SynopsisConversationTodo[] {
  if (deferredSequences.length === 0) return todos
  const deferredSet = new Set(deferredSequences)
  const next = todos.length === 0
    ? []
    : todos.map((item) => ({ ...item }))
  for (const item of next) {
    const match = CHAPTER_SEQ_IN_TODO.exec(item.content)
    const seq = match?.[1] === undefined ? undefined : Number(match[1])
    if (seq !== undefined && deferredSet.has(seq) && item.status === "in_progress") {
      item.status = "pending"
    }
  }
  const publishLabel = `先完成第${String(nextSequence)}章草稿并图修订发布为正文`
  const deferredLabel = `延后跳号草稿：${deferredSequences.map((sequence) => `第${String(sequence)}章`).join("、")}`
  if (!next.some((item) => item.content.includes("延后跳号草稿"))) {
    next.push({
      id: `gate-seq-deferred-${deferredSequences.join("-")}`,
      content: deferredLabel,
      status: "pending",
    })
  }
  let publishStep = next.find((item) => item.content.includes("图修订发布为正文") && item.content.includes(`第${String(nextSequence)}章`))
  if (publishStep === undefined) {
    publishStep = {
      id: `gate-seq-publish-${String(nextSequence)}`,
      content: publishLabel,
      status: "in_progress",
    }
    next.unshift(publishStep)
  } else if (publishStep.status === "pending" || publishStep.status === "cancelled") {
    publishStep.status = "in_progress"
  }
  // Prefer the publish step as the sole in_progress.
  for (const item of next) {
    if (item === publishStep) continue
    if (item.status === "in_progress") item.status = "pending"
  }
  publishStep.status = "in_progress"
  return next
}

/**
 * The tool-exclusive gate inserts a bookkeeping "gate-tool" step. Once a tool actually ran,
 * that step is done; the model only owns its real work items.
 */
export function settleToolGateTodos(
  todos: readonly SynopsisConversationTodo[],
): readonly SynopsisConversationTodo[] | undefined {
  const gateIndex = todos.findIndex((item) => item.id === "gate-tool" && item.status !== "completed")
  if (gateIndex < 0) return undefined
  const next = todos.map((item, index) => (
    index === gateIndex ? { ...item, status: "completed" as const } : { ...item }
  ))
  if (!next.some((item) => item.status === "in_progress")) {
    const promote = next.find((item) => item.status === "pending" && !item.content.includes("延后"))
      ?? next.find((item) => item.status === "pending")
    if (promote !== undefined) promote.status = "in_progress"
  }
  return next
}

export function discussTurnHasTodos(todos: readonly SynopsisConversationTodo[]): boolean {
  return todos.length > 0
}

/** Last assistant list the desk already showed. The in-memory hub is empty after a restart. */
export function latestSavedDiscussTodos(
  messages: readonly { role: string; todos?: readonly SynopsisConversationTodo[] | undefined }[],
): readonly SynopsisConversationTodo[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "assistant") continue
    if (message.todos !== undefined && message.todos.length > 0) {
      return message.todos.map((item) => ({ ...item }))
    }
  }
  return []
}

/** True when every todo is completed or cancelled (or the list is empty). */
export function discussTodosAreSettled(todos: readonly SynopsisConversationTodo[]): boolean {
  if (todos.length === 0) return true
  return todos.every((item) => item.status === "completed" || item.status === "cancelled")
}

/** Final artifacts that count as executable work and therefore require a prior todo list. */
export function discussArtifactRequiresTodos(artifact: Readonly<{
  synopsisBody?: unknown
  outlineBody?: unknown
  bodyEdits?: unknown
  stagingDelta?: unknown
  stagingPromote?: unknown
  presentationWrites?: unknown
  arcPlan?: unknown
  chapterDraftProposal?: unknown
  chapterDraftProposals?: unknown
  volumeChapterPlans?: unknown
  goalProposals?: unknown
  toolRequest?: unknown
}>): boolean {
  if (artifact.toolRequest !== undefined) return true
  if (artifact.synopsisBody !== undefined) return true
  if (artifact.outlineBody !== undefined) return true
  if (artifact.bodyEdits !== undefined) return true
  if (artifact.stagingDelta !== undefined) return true
  if (artifact.stagingPromote !== undefined) return true
  if (artifact.presentationWrites !== undefined) return true
  if (artifact.arcPlan !== undefined) return true
  if (artifact.chapterDraftProposal !== undefined) return true
  if (artifact.chapterDraftProposals !== undefined) return true
  if (artifact.volumeChapterPlans !== undefined) return true
  if (artifact.goalProposals !== undefined) return true
  return false
}
