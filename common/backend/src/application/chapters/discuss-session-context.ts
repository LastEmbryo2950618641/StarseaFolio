import type {
  ModelContextMessage,
  VisibleModelContextMessage,
  WorkspaceCatalogSnapshot,
} from "@starseafolio/contracts"

import { MODEL_CONTEXT_DELTA_HEADER } from "../context/model-context-appender.js"
import { digest, resolveDescriptionRulePaths, listWorkDescriptionRuleFiles } from "../../core/index.js"
import type { TurnReadEvidence } from "../turns/ports/ai-model-port.js"
import { isPresentationRuleMarkdownPath, listUserRuleMarkdownPaths } from "./synopsis-workspace-reads.js"

export const DISCUSS_HISTORY_SUMMARY_PROTOCOL = "discuss-history-summary-v1"
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

export function compactDiscussContextHistory(messages: readonly ModelContextMessage[]): Readonly<{
  messagesToHide: readonly string[]
  summaryContent: string
  summarizedUserInputCount: number
  retainedTurnCount: number
}> | undefined {
  const ordered = [...messages].sort((left, right) => left.sequence - right.sequence)
  const turnIds = [...new Set(ordered.flatMap((message) => (
    message.kind === "phase_request" && message.turnId !== undefined ? [message.turnId] : []
  )))]
  if (turnIds.length < DISCUSS_HISTORY_COMPACT_AFTER_TURNS) return undefined

  const retainedTurnIds = new Set(turnIds.slice(-DISCUSS_HISTORY_KEEP_RECENT_TURNS))
  const oldTurnIds = new Set(turnIds.filter((turnId) => !retainedTurnIds.has(turnId)))
  if (oldTurnIds.size === 0) return undefined

  const userInputs: string[] = []
  const exchanges: unknown[] = []
  const archivedMessageIds: string[] = []
  const summaryMessageIds: string[] = []
  const addUserInput = (value: string): void => {
    if (value.trim().length === 0) return
    userInputs.push(value)
  }

  for (const message of ordered) {
    if (message.kind === "phase_instruction" && message.content?.startsWith("{\"protocol\":\"discuss-history-summary-v1\"") === true) {
      summaryMessageIds.push(message.messageId)
      try {
        const parsed = JSON.parse(message.content) as { protocol?: unknown; userInputs?: unknown; exchanges?: unknown }
        if (parsed.protocol === DISCUSS_HISTORY_SUMMARY_PROTOCOL && Array.isArray(parsed.userInputs)) {
          for (const item of parsed.userInputs) if (typeof item === "string") addUserInput(item)
          if (Array.isArray(parsed.exchanges)) exchanges.push(...parsed.exchanges)
        }
      } catch {
        // A malformed old summary is left visible and is not treated as recoverable input.
        summaryMessageIds.pop()
      }
      continue
    }
    if (message.turnId === undefined || !oldTurnIds.has(message.turnId) || message.content === undefined) continue
    if (message.kind === "phase_request") {
      const delta = readDiscussRequestDelta(message.content)
      if (delta === undefined) continue
      const input = delta.input as Record<string, unknown>
      if (typeof input.userInput === "string" && input.userInput.trim().length > 0) {
        addUserInput(input.userInput)
        exchanges.push([message.role, {
          ...delta,
          input: { ...input, userInput: { $ref: `#/userInputs/${String(userInputs.length - 1)}` } },
        }])
      } else {
        exchanges.push([message.role, delta])
      }
      archivedMessageIds.push(message.messageId)
    } else if (message.kind === "phase_response") {
      // Keep the complete semantic payload: decisions and evidence may exist only here.
      let content: unknown = message.content
      try { content = JSON.parse(message.content) } catch { /* Preserve non-JSON replies verbatim. */ }
      exchanges.push([message.role, content])
      archivedMessageIds.push(message.messageId)
    }
  }
  if (userInputs.length === 0) return undefined

  const messagesToHide = [...summaryMessageIds, ...archivedMessageIds]
  return {
    messagesToHide,
    summaryContent: JSON.stringify({ protocol: DISCUSS_HISTORY_SUMMARY_PROTOCOL, userInputs, exchanges }),
    summarizedUserInputCount: userInputs.length,
    retainedTurnCount: retainedTurnIds.size,
  }
}

function readDiscussRequestDelta(content: string | undefined): Record<string, unknown> | undefined {
  if (content === undefined || !content.startsWith(`${MODEL_CONTEXT_DELTA_HEADER}\n`)) return undefined
  try {
    const parsed: unknown = JSON.parse(content.slice(MODEL_CONTEXT_DELTA_HEADER.length + 1))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const input = (parsed as Record<string, unknown>).input
    if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
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
