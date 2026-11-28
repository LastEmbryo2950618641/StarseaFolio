import type {
  ModelContextMessage,
  VisibleModelContextMessage,
  WorkspaceCatalogSnapshot,
} from "@starseafolio/contracts"

import { MODEL_CONTEXT_DELTA_HEADER } from "../context/model-context-appender.js"
import { CONTEXT_FOLD_SUMMARY_PROTOCOL } from "../context/context-compacting-execution.js"
import { digest, resolveDescriptionRulePaths, listWorkDescriptionRuleFiles } from "../../core/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import type { TurnReadEvidence } from "../turns/ports/ai-model-port.js"
import { isPresentationRuleMarkdownPath, listUserRuleMarkdownPaths } from "./synopsis-workspace-reads.js"

export const DISCUSS_HISTORY_SUMMARY_PROTOCOL = "discuss-history-summary-v1"
export const DISCUSS_ARCHIVE_NOTICE_PROTOCOL = "discuss-archive-notice-v1"
export const DISCUSS_ARCHIVE_NOTICE = renderRuntimePrompt("discuss-session", "archive-notice")
const DISCUSS_HISTORY_COMPACT_AFTER_TURNS = 12
const DISCUSS_HISTORY_KEEP_RECENT_TURNS = 8
export const DISCUSS_PROGRESS_PROTOCOL = "discuss-progress-v1"
export const DISCUSS_STEP_FAILURE_PROTOCOL = "discuss-step-failures-v1"
export const DISCUSS_STEP_FAILURE_LIMIT = 3

export function readDiscussStepFailures(messages: readonly ModelContextMessage[]): Readonly<{
  obsoleteMessageIds: readonly string[]
  failures: Map<string, number>
}> {
  const obsoleteMessageIds: string[] = []
  let failures = new Map<string, number>()
  for (const message of [...messages].sort((left, right) => left.sequence - right.sequence)) {
    if (message.kind !== "phase_instruction" || message.content === undefined) continue
    try {
      const parsed = JSON.parse(message.content)
      if (parsed?.protocol !== DISCUSS_STEP_FAILURE_PROTOCOL || parsed.failures === null
        || typeof parsed.failures !== "object" || Array.isArray(parsed.failures)) continue
      failures = new Map(Object.entries(parsed.failures).filter((entry): entry is [string, number] => (
        Number.isSafeInteger(entry[1]) && (entry[1] as number) > 0
      )))
      obsoleteMessageIds.push(message.messageId)
    } catch { /* Leave other context instructions unchanged. */ }
  }
  return { obsoleteMessageIds, failures }
}

export function describeRequiredRetryStep(messages: readonly ModelContextMessage[], reason: string): string | undefined {
  let latest: { step: string, reason: string, sequence: number } | undefined
  for (const message of messages) {
    if (message.kind !== "phase_instruction" || message.content === undefined) continue
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>
      if (parsed.protocol !== DISCUSS_STEP_FAILURE_PROTOCOL) continue
      if (typeof parsed.step !== "string" || typeof parsed.reason !== "string") continue
      if (latest === undefined || message.sequence >= latest.sequence) {
        latest = { step: parsed.step, reason: parsed.reason, sequence: message.sequence }
      }
    } catch {
      // Non-JSON instructions are not failure records.
    }
  }
  return latest?.reason === reason ? latest.step : undefined
}

export function findInvalidDiscussGateMessageIds(messages: readonly ModelContextMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.kind !== "phase_instruction" || message.content === undefined) return []
    try {
      const gate = JSON.parse(message.content)
      return gate?.protocol === "discuss-gate-v1" && gate.gate === "chapter_sequence_publish"
        && Number.isSafeInteger(gate.nextSequence) && Array.isArray(gate.deferredSequences)
        && gate.deferredSequences.some((sequence: unknown) => Number.isSafeInteger(sequence)
          && (sequence as number) <= gate.nextSequence)
        ? [message.messageId] : []
    } catch { return [] }
  })
}

export function measureDiscussProgress(messages: readonly ModelContextMessage[], fingerprint: string, fingerprintBeforeTurn: string): Readonly<{
  obsoleteMessageIds: readonly string[]
  consecutiveNoProgressTurns: number
}> {
  const obsoleteMessageIds: string[] = []
  let previous: { fingerprint: string; consecutiveNoProgressTurns: number } | undefined
  for (const message of [...messages].sort((left, right) => left.sequence - right.sequence)) {
    if (message.kind !== "phase_instruction" || message.content === undefined) continue
    try {
      const parsed = JSON.parse(message.content)
      if (parsed?.protocol !== DISCUSS_PROGRESS_PROTOCOL || typeof parsed.fingerprint !== "string"
        || !Number.isSafeInteger(parsed.consecutiveNoProgressTurns) || parsed.consecutiveNoProgressTurns < 0) continue
      obsoleteMessageIds.push(message.messageId)
      previous = parsed
    } catch { /* Non-JSON instructions are not progress records. */ }
  }
  return {
    obsoleteMessageIds,
    consecutiveNoProgressTurns: fingerprint !== fingerprintBeforeTurn ? 0
      : previous?.fingerprint === fingerprint ? previous.consecutiveNoProgressTurns + 1 : 1,
  }
}

const discussHistoryNoticeContent = JSON.stringify({
  protocol: DISCUSS_ARCHIVE_NOTICE_PROTOCOL,
  notice: DISCUSS_ARCHIVE_NOTICE,
})

export function selectActiveDiscussRoutingMessages(
  context: readonly ModelContextMessage[],
  recent: readonly Readonly<{ role: "user" | "assistant" | "system"; content: string }>[],
): readonly Readonly<{ role: "user" | "assistant" | "system"; content: string }>[] {
  const folded = context.some((message) => message.kind === "phase_instruction" && [
    DISCUSS_ARCHIVE_NOTICE_PROTOCOL, DISCUSS_HISTORY_SUMMARY_PROTOCOL, CONTEXT_FOLD_SUMMARY_PROTOCOL,
  ].some((protocol) => message.content?.startsWith(`{"protocol":"${protocol}"`) === true))
  if (!folded) return recent

  const activeTurns = new Map<string, { user?: string; assistant?: string }>()
  for (const message of context) {
    if (message.turnId === undefined || message.content === undefined) continue
    const turn = activeTurns.get(message.turnId) ?? {}
    if (message.kind === "author_message") {
      turn.user = message.content
    } else if (message.kind === "phase_request" && message.content.startsWith(`${MODEL_CONTEXT_DELTA_HEADER}\n`)) {
      const userInput = parseJsonObject(message.content.slice(MODEL_CONTEXT_DELTA_HEADER.length + 1))?.input
      if (userInput !== null && typeof userInput === "object" && "userInput" in userInput
        && typeof userInput.userInput === "string") turn.user = userInput.userInput
    } else if (message.kind === "phase_response") {
      const artifact = parseJsonObject(message.content)?.artifact
      if (artifact !== null && typeof artifact === "object" && "assistantMessage" in artifact
        && typeof artifact.assistantMessage === "string") turn.assistant = artifact.assistantMessage
    }
    activeTurns.set(message.turnId, turn)
  }
  return [...activeTurns.values()].slice(-2).flatMap(({ user, assistant }) => [
    ...(user === undefined ? [] : [{ role: "user" as const, content: user }]),
    ...(assistant === undefined ? [] : [{ role: "assistant" as const, content: assistant }]),
  ])
}

export function compactDiscussContextHistory(messages: readonly ModelContextMessage[]): Readonly<{
  messagesToHide: readonly string[]
  noticeContent?: string
  retainedTurnCount: number
}> | undefined {
  const ordered = [...messages].sort((left, right) => left.sequence - right.sequence)
  const turnIds = [...new Set(ordered.flatMap((message) => (
    message.kind === "phase_request" && message.turnId !== undefined
      && message.content?.startsWith(MODEL_CONTEXT_DELTA_HEADER) === true ? [message.turnId] : []
  )))]
  const retainedTurnIds = turnIds.length >= DISCUSS_HISTORY_COMPACT_AFTER_TURNS
    ? turnIds.slice(-DISCUSS_HISTORY_KEEP_RECENT_TURNS)
    : turnIds
  const oldTurnIds = new Set(turnIds.slice(0, turnIds.length - retainedTurnIds.length))
  const messagesToHide = ordered.flatMap((message) => {
    const isLegacySummary = message.kind === "phase_instruction"
      && message.content?.startsWith(`{"protocol":"${DISCUSS_HISTORY_SUMMARY_PROTOCOL}"`) === true
    const isOldExchange = message.turnId !== undefined && oldTurnIds.has(message.turnId)
      && (message.kind === "phase_request" || message.kind === "phase_response"
        || message.kind === "author_message" || message.kind === "author_bracket")
    return isLegacySummary || isOldExchange ? [message.messageId] : []
  })
  if (messagesToHide.length === 0) return undefined

  const hasNotice = ordered.some((message) => message.kind === "phase_instruction"
    && message.content === discussHistoryNoticeContent)
  return {
    messagesToHide,
    ...(hasNotice ? {} : { noticeContent: discussHistoryNoticeContent }),
    retainedTurnCount: retainedTurnIds.length,
  }
}

export function listSynopsisDiscussBootstrapPaths(input: Readonly<{
  catalog: WorkspaceCatalogSnapshot
  presentation?: Readonly<{
    descriptionRulePath?: string | undefined
    proseStyleRulePath?: string | undefined
    novelMajorCategoryRulePath?: string | undefined
    novelSubcategoryRulePath?: string | undefined
  }>
}>): readonly string[] {
  const descriptionPaths = resolveDescriptionRulePaths(
    input.presentation?.descriptionRulePath,
    input.catalog.entries,
  )
  const prosePath = input.presentation?.proseStyleRulePath?.trim()
  return [
    "设定集/readme.md",
    "参考文件/readme.md",
    ...descriptionPaths,
    ...(prosePath !== undefined && prosePath.length > 0 && isPresentationRuleMarkdownPath(prosePath)
      ? [prosePath]
      : []),
    ...(input.presentation?.novelMajorCategoryRulePath === undefined ? [] : [input.presentation.novelMajorCategoryRulePath]),
    ...(input.presentation?.novelSubcategoryRulePath === undefined ? [] : [input.presentation.novelSubcategoryRulePath]),
    ...listWorkDescriptionRuleFiles(input.catalog.entries).map((entry) => entry.relativePath),
    ...listUserRuleMarkdownPaths(input.catalog.entries),
  ]
}

export function computeDiscussBootstrapDigest(input: Readonly<{
  catalog: WorkspaceCatalogSnapshot
  presentation?: Readonly<{
    descriptionRulePath?: string | undefined
    proseStyleRulePath?: string | undefined
    novelMajorCategoryRulePath?: string | undefined
    novelSubcategoryRulePath?: string | undefined
  }>
}>): string {
  const paths = listSynopsisDiscussBootstrapPaths(input)
  const byPath = new Map(input.catalog.entries.map((entry) => [entry.relativePath, entry]))
  return digest(paths.map((path) => {
    const entry = byPath.get(path)
    return {
      path,
      digest: entry?.digest ?? "",
      version: entry?.version ?? "",
    }
  }))
}

export function collectDiscussReadEvidenceFromContext(
  messages: readonly ModelContextMessage[],
): TurnReadEvidence[] {
  const collected: TurnReadEvidence[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.content === undefined) continue
    const parsed = parseJsonObject(message.content)
    if (parsed === undefined) continue
    for (const item of collectReadEvidenceNodes(parsed)) {
      const readId = typeof item.readId === "string" ? item.readId : undefined
      if (readId === undefined || seen.has(readId)) continue
      seen.add(readId)
      collected.push(item as TurnReadEvidence)
    }
  }
  return collected
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function collectReadEvidenceNodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectReadEvidenceNodes)
  if (value === null || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const nested = Object.values(record).flatMap(collectReadEvidenceNodes)
  if (!Array.isArray(record.readEvidence)) return nested
  return [
    ...record.readEvidence.flatMap((item) => (
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? [item as Record<string, unknown>]
        : []
    )),
    ...nested,
  ]
}

export function toVisibleDiscussContextMessages(
  messages: readonly ModelContextMessage[],
): VisibleModelContextMessage[] {
  return messages.flatMap((message) => {
    if (message.content === undefined) return []
    return [{
      messageId: message.messageId,
      sequence: message.sequence,
      role: message.role,
      kind: message.kind,
      ...(message.taskId === undefined ? {} : { taskId: message.taskId }),
      ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
      ...(message.phase === undefined ? {} : { phase: message.phase }),
      content: message.content,
    }]
  })
}
