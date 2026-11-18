import type { PhaseRequestEnvelope, VisibleModelContextMessage } from "@starseafolio/contracts"
import type {
  AIModelPort,
  ModelExecutionOptions,
  PhaseModelExecution,
} from "../turns/ports/ai-model-port.js"
import { estimateModelMessageTokens } from "./context-window-manager.js"

export const CONTEXT_FOLD_SUMMARY_PROTOCOL = "context-fold-summary-v1"
export const CONTEXT_BUDGET_PROTOCOL = "context-budget-v1"

const COMPRESS_PROMPT_RESERVE_TOKENS = 2_500
const COMPRESS_OUTPUT_RESERVE_TOKENS = 4_500
const FOLD_NOTICE = "以下区间已压缩。细节以工作区正文/设定为准，可按需 request_read；勿仅因压缩而反复回读旧章。"

export type ContextFoldMessageDraft = Readonly<{
  role: "user"
  kind: "phase_instruction"
  content: string
}>

export type ContextCompactionEvent = Readonly<{
  reason: "usage_threshold" | "context_length_error"
  observedInputTokens?: number
  estimatedInputTokens?: number
  thresholdTokens: number
  hiddenMessageIds: readonly string[]
  foldMessages: readonly ContextFoldMessageDraft[]
  remainingMessageCount: number
}>

export function readContextLengthError(error: unknown): { inputTokens?: number; limitTokens?: number } | undefined {
  const message = error instanceof Error ? error.message : String(error)
  if (!/context_length_exceeded|maximum context length|context window.{0,60}(exceed|limit)|exceed.{0,60}context|too many tokens/i.test(message)) return undefined
  const inputMatch = message.match(/([\d,]+)\s+in the messages/i)
    ?? message.match(/requested\s+([\d,]+)\s+tokens/i)
  const limitMatch = message.match(/maximum context length(?:\s+is|\s+of)?\s+([\d,]+)\s+tokens/i)
  const inputTokens = inputMatch === null ? undefined : Number(inputMatch[1]?.replaceAll(",", ""))
  const limitTokens = limitMatch === null ? undefined : Number(limitMatch[1]?.replaceAll(",", ""))
  return {
    ...(inputTokens === undefined || !Number.isFinite(inputTokens) ? {} : { inputTokens }),
    ...(limitTokens === undefined || !Number.isFinite(limitTokens) ? {} : { limitTokens }),
  }
}

function textWeight(value: unknown): number {
  if (typeof value === "string") return value.length === 0 ? 0 : estimateModelMessageTokens(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined || serialized.length === 0 || serialized === "{}" ? 0 : estimateModelMessageTokens(serialized)
  } catch {
    return 0
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const REPLAYED_DISCUSS_KEYS = ["synopsisMarkdown", "outlineMarkdown", "latestDraftMarkdown"] as const

/** Match plain text or the JSON-escaped form stored inside phase_request deltas. */
export function valueAppearsIn(value: unknown, haystack: string): boolean {
  if (typeof value === "string") {
    if (value.length === 0) return false
    if (haystack.includes(value)) return true
    try {
      const escaped = JSON.stringify(value)
      if (haystack.includes(escaped)) return true
      const unquoted = escaped.slice(1, -1)
      return unquoted.length > 0 && haystack.includes(unquoted)
    } catch {
      return false
    }
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized !== undefined && serialized.length > 2 && serialized !== "{}" && haystack.includes(serialized)
  } catch {
    return false
  }
}

/** Catalog, evidence, and old planning text already stored in removed history must not be weighed or sent again. */
export function stripReplayedPayload(requestInput: unknown, hiddenContents: readonly string[]): unknown {
  if (requestInput === undefined || hiddenContents.length === 0) return requestInput
  const input = asRecord(requestInput)
  if (Object.keys(input).length === 0) return requestInput
  const hiddenText = hiddenContents.join("\n")
  let changed = false
  const next: Record<string, unknown> = { ...input }
  if (next.workspaceCatalog !== undefined && hiddenText.includes('"workspaceCatalog"')) {
    delete next.workspaceCatalog
    changed = true
  }
  if (Array.isArray(next.readEvidence)) {
    const kept = next.readEvidence.filter((item) => {
      const ownerId = asRecord(item).ownerId
      return typeof ownerId !== "string" || ownerId.length === 0 || !hiddenText.includes(ownerId)
    })
    if (kept.length !== next.readEvidence.length) {
      changed = true
      if (kept.length === 0) delete next.readEvidence
      else next.readEvidence = kept
    }
  }
  const discuss = asRecord(next.synopsisDiscuss)
  if (Object.keys(discuss).length > 0) {
    const nextDiscuss: Record<string, unknown> = { ...discuss }
    let discussChanged = false
    for (const key of REPLAYED_DISCUSS_KEYS) {
      if (valueAppearsIn(nextDiscuss[key], hiddenText)) {
        delete nextDiscuss[key]
        discussChanged = true
      }
    }
    if (discussChanged) {
      changed = true
      if (Object.keys(nextDiscuss).length === 0) delete next.synopsisDiscuss
      else next.synopsisDiscuss = nextDiscuss
    }
  }
  return changed ? next : requestInput
}

/** Keep the footer on the compacted estimate when the provider still reports the pre-compaction prompt. */
export function contextTokensAfterProviderUsage(
  estimate: number | undefined,
  measured: number | undefined,
): number | undefined {
  if (measured === undefined) return estimate
  if (estimate !== undefined && measured > estimate) return estimate
  return measured
}

function payloadWeight(
  requestInput: unknown,
  hiddenContents: readonly string[],
): number {
  const stripped = stripReplayedPayload(requestInput, hiddenContents)
  return textWeight(stripped)
}

function latestToolDescriptionIds(messages: readonly VisibleModelContextMessage[]): Set<string> {
  const latest = new Map<string, VisibleModelContextMessage>()
  for (const message of [...messages].sort((left, right) => left.sequence - right.sequence)) {
    if (message.role !== "system" || message.kind !== "phase_instruction") continue
    try {
      const value = JSON.parse(message.content) as Record<string, unknown>
      if (value.protocol !== "synopsis-tools-v1" || value.action !== "describe" || value.status !== "described") continue
      if (typeof value.name !== "string" || value.name.length === 0) continue
      latest.set(value.name, message)
    } catch {
      // Non-JSON instructions are ordinary history.
    }
  }
  return new Set([...latest.values()].map((message) => message.messageId))
}

function duplicateSystemRulesIds(messages: readonly VisibleModelContextMessage[], currentTurnId: string): Set<string> {
  const latestByContent = new Map<string, string>()
  for (const message of [...messages].sort((left, right) => left.sequence - right.sequence)) {
    if (message.kind !== "system_rules" || message.turnId === currentTurnId) continue
    latestByContent.set(message.content, message.messageId)
  }
  const kept = new Set(latestByContent.values())
  const duplicates = new Set<string>()
  for (const message of messages) {
    if (message.kind !== "system_rules" || message.turnId === currentTurnId) continue
    if (!kept.has(message.messageId)) duplicates.add(message.messageId)
  }
  return duplicates
}

export function isProtectedFoldMessage(message: VisibleModelContextMessage): boolean {
  if (message.kind === "system_rules") return true
  if (message.kind !== "phase_instruction") return false
  try {
    const value: unknown = JSON.parse(message.content)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false
    const protocol = (value as Record<string, unknown>).protocol
    return protocol === "discuss-history-summary-v1"
      || protocol === "discuss-step-failures-v1"
      || protocol === "discuss-progress-v1"
      || protocol === "discuss-gate-v1"
      || protocol === CONTEXT_FOLD_SUMMARY_PROTOCOL
      || protocol === CONTEXT_BUDGET_PROTOCOL
  } catch {
    return false
  }
}

function messageTokens(message: VisibleModelContextMessage): number {
  return estimateModelMessageTokens(message.content)
}

function totalMessageTokens(messages: readonly VisibleModelContextMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0)
}

function compressLimitTokens(windowTokens: number): number {
  return Math.max(1_000, windowTokens - COMPRESS_PROMPT_RESERVE_TOKENS - COMPRESS_OUTPUT_RESERVE_TOKENS)
}

/** Oldest-first slice covering at least half the foldable pool (by tokens). */
export function selectOldestHalfByTokens(
  foldable: readonly VisibleModelContextMessage[],
): VisibleModelContextMessage[] {
  if (foldable.length === 0) return []
  const ordered = [...foldable].sort((left, right) => left.sequence - right.sequence)
  const target = Math.max(1, Math.ceil(totalMessageTokens(ordered) * 0.5))
  const selected: VisibleModelContextMessage[] = []
  let weight = 0
  for (const message of ordered) {
    selected.push(message)
    weight += messageTokens(message)
    if (weight >= target) break
  }
  return selected
}

/** Shrink a chunk until its estimated tokens fit the compress call limit. */
export function shrinkChunkToCompressLimit(
  chunk: readonly VisibleModelContextMessage[],
  limitTokens: number,
): Readonly<{ messages: VisibleModelContextMessage[]; truncatedContent?: string }> {
  let current = [...chunk].sort((left, right) => left.sequence - right.sequence)
  while (current.length > 1 && totalMessageTokens(current) > limitTokens) {
    current = selectOldestHalfByTokens(current)
  }
  if (current.length === 0) return { messages: [] }
  if (totalMessageTokens(current) <= limitTokens) return { messages: current }
  const only = current[0]!
  const ratio = limitTokens / Math.max(1, messageTokens(only))
  const maxChars = Math.max(200, Math.floor(only.content.length * Math.min(1, ratio * 0.9)))
  return {
    messages: [only],
    truncatedContent: only.content.slice(0, maxChars),
  }
}

export function buildFoldSummaryContent(input: {
  summary: string
  foldedMessageCount: number
  foldedMessageIds: readonly string[]
}): string {
  return JSON.stringify({
    protocol: CONTEXT_FOLD_SUMMARY_PROTOCOL,
    notice: FOLD_NOTICE,
    foldedMessageCount: input.foldedMessageCount,
    foldedMessageIds: input.foldedMessageIds,
    summary: input.summary,
  })
}

export function buildContextBudgetContent(input: {
  contextTokens: number
  contextWindowTokens: number
  triggerRatio: number
  targetRatio: number
  foldsApplied: number
}): string {
  return JSON.stringify({
    protocol: CONTEXT_BUDGET_PROTOCOL,
    contextTokens: input.contextTokens,
    contextWindowTokens: input.contextWindowTokens,
    triggerRatio: input.triggerRatio,
    targetRatio: input.targetRatio,
    foldsApplied: input.foldsApplied,
    guidance: [
      `当前上下文约 ${String(input.contextTokens)} / ${String(input.contextWindowTokens)} tokens。`,
      `达到窗口 ${String(Math.round(input.triggerRatio * 100))}% 会触发分段折叠，目标压到约 ${String(Math.round(input.targetRatio * 100))}%。`,
      input.foldsApplied > 0
        ? `已应用 ${String(input.foldsApplied)} 次折叠；不确定时可 request_read 工作区正文，但勿仅因折叠反复回读旧章。`
        : "不确定时可 request_read 工作区正文；勿仅为预防压缩而提前回读大段正文。",
    ].join(" "),
  })
}

export async function foldContextMessages(input: {
  model: AIModelPort
  messages: readonly VisibleModelContextMessage[]
  currentTurnId: string
  windowTokens: number
  targetRatio: number
  observedInputTokens?: number
  signal?: AbortSignal
  createMessageId: () => string
}): Promise<{
  messages: VisibleModelContextMessage[]
  hiddenMessageIds: string[]
  foldMessages: ContextFoldMessageDraft[]
  estimatedInputTokens?: number
  foldsApplied: number
  blocked?: string
}> {
  let messages = [...input.messages].sort((left, right) => left.sequence - right.sequence)
  const hiddenMessageIds: string[] = []
  const foldMessages: ContextFoldMessageDraft[] = []
  let foldsApplied = 0
  const targetTokens = Math.max(1, Math.floor(input.windowTokens * input.targetRatio))
  const limit = compressLimitTokens(input.windowTokens)
  const baselineLocal = totalMessageTokens(messages)
  const outgoingEstimate = (): number => {
    const local = totalMessageTokens(messages)
    if (input.observedInputTokens === undefined || baselineLocal <= 0) return local
    return Math.max(0, Math.ceil(input.observedInputTokens * (local / Math.max(1, baselineLocal))))
  }

  const protectedTokens = (): number => messages
    .filter((message) => message.turnId === input.currentTurnId || isProtectedFoldMessage(message))
    .reduce((sum, message) => sum + messageTokens(message), 0)

  if (protectedTokens() > input.windowTokens) {
    return {
      messages,
      hiddenMessageIds,
      foldMessages,
      foldsApplied,
      blocked: "Protected system rules, current turn, and fold state exceed the model context window",
    }
  }

  for (let round = 0; round < 32; round += 1) {
    input.signal?.throwIfAborted()
    if (outgoingEstimate() <= targetTokens) break
    const keptDescriptions = latestToolDescriptionIds(messages)
    const duplicateRules = duplicateSystemRulesIds(messages, input.currentTurnId)
    const foldable = messages.filter((message) => (
      message.turnId !== input.currentTurnId
      && !isProtectedFoldMessage(message)
      && !keptDescriptions.has(message.messageId)
      && (message.kind !== "system_rules" || duplicateRules.has(message.messageId))
    ))
    if (foldable.length === 0) break

    let chunk = selectOldestHalfByTokens(foldable)
    const shrunk = shrinkChunkToCompressLimit(chunk, limit)
    chunk = shrunk.messages
    if (chunk.length === 0) break

    const texts = shrunk.truncatedContent === undefined
      ? chunk.map((message) => message.content)
      : [shrunk.truncatedContent]
    if (input.model.compressContext === undefined) {
      throw new Error("当前模型未实现上下文分段折叠（compressContext）")
    }
    const compressed = await input.model.compressContext({
      texts,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const foldedIds = chunk.map((message) => message.messageId)
    const foldContent = buildFoldSummaryContent({
      summary: compressed.summary,
      foldedMessageCount: foldedIds.length,
      foldedMessageIds: foldedIds,
    })
    const foldDraft: ContextFoldMessageDraft = {
      role: "user",
      kind: "phase_instruction",
      content: foldContent,
    }
    foldMessages.push(foldDraft)
    const hideSet = new Set(foldedIds)
    const maxSequence = messages.reduce((max, message) => Math.max(max, message.sequence), 0)
    const foldVisible: VisibleModelContextMessage = {
      messageId: input.createMessageId(),
      sequence: maxSequence + 1,
      role: "user",
      kind: "phase_instruction",
      turnId: input.currentTurnId,
      content: foldContent,
    }
    messages = [
      ...messages.filter((message) => !hideSet.has(message.messageId)),
      foldVisible,
    ].sort((left, right) => left.sequence - right.sequence)
    hiddenMessageIds.push(...foldedIds)
    foldsApplied += 1
  }

  const estimatedInputTokens = input.observedInputTokens === undefined || baselineLocal <= 0
    ? undefined
    : Math.max(0, Math.ceil(input.observedInputTokens * (totalMessageTokens(messages) / baselineLocal)))

  return {
    messages,
    hiddenMessageIds,
    foldMessages,
    foldsApplied,
    ...(estimatedInputTokens === undefined ? {} : { estimatedInputTokens }),
  }
}

export async function executeWithContextCompaction(input: {
  model: AIModelPort
  request: PhaseRequestEnvelope
  options: ModelExecutionOptions
  lastRequestInputTokens?: number
  triggerRatio: number
  targetRatio: number
  onReadyToCall?(): void
  onCompacted(event: ContextCompactionEvent): Promise<void>
  createMessageId?: () => string
}): Promise<PhaseModelExecution> {
  let messages = [...(input.options.contextMessages ?? [])]
  let windowTokens = input.model.info?.contextWindowTokens ?? 64_000
  const createMessageId = input.createMessageId ?? (() => `fold-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`)

  const compact = async (reason: ContextCompactionEvent["reason"], observedInputTokens?: number): Promise<boolean> => {
    const folded = await foldContextMessages({
      model: input.model,
      messages,
      currentTurnId: input.request.turnId,
      windowTokens,
      targetRatio: input.targetRatio,
      ...(observedInputTokens === undefined ? {} : { observedInputTokens }),
      ...(input.options.signal === undefined ? {} : { signal: input.options.signal }),
      createMessageId,
    })
    if (folded.blocked !== undefined) {
      throw new Error(folded.blocked)
    }
    if (folded.hiddenMessageIds.length === 0) return false
    const hiddenContents = messages
      .filter((message) => folded.hiddenMessageIds.includes(message.messageId))
      .map((message) => message.content)
    const stripped = stripReplayedPayload(input.request.input, hiddenContents)
    if (stripped !== input.request.input) {
      (input.request as { input?: unknown }).input = stripped
    }
    messages = folded.messages
    await input.onCompacted({
      reason,
      ...(observedInputTokens === undefined ? {} : { observedInputTokens }),
      ...(folded.estimatedInputTokens === undefined ? {} : { estimatedInputTokens: folded.estimatedInputTokens }),
      thresholdTokens: Math.floor(windowTokens * input.triggerRatio),
      hiddenMessageIds: folded.hiddenMessageIds,
      foldMessages: folded.foldMessages,
      remainingMessageCount: messages.length,
    })
    return true
  }

  if (input.lastRequestInputTokens !== undefined && input.lastRequestInputTokens >= windowTokens * input.triggerRatio) {
    await compact("usage_threshold", input.lastRequestInputTokens)
  }
  for (let retry = 0; ; retry += 1) {
    input.options.signal?.throwIfAborted()
    input.onReadyToCall?.()
    try {
      return await input.model.execute(input.request, { ...input.options, contextMessages: messages })
    } catch (error) {
      input.options.signal?.throwIfAborted()
      const overflow = readContextLengthError(error)
      if (overflow === undefined) throw error
      if (overflow.limitTokens !== undefined && overflow.limitTokens > 0) windowTokens = Math.min(windowTokens, overflow.limitTokens)
      if (retry >= 2 || !await compact("context_length_error", overflow.inputTokens)) {
        throw new Error("上下文超限：分段折叠后仍过大，系统规则、当前轮次或本次资料超过模型窗口。请缩小本次输入或更换更大上下文模型后重试。", { cause: error })
      }
      input.options.onSchemaRepair?.()
    }
  }
}

/** @deprecated Prefer foldContextMessages; kept for callers that only need a token estimate. */
export function estimateOutgoingContextWeight(
  messages: readonly VisibleModelContextMessage[],
  requestInput: unknown,
  phasePromptText: string | undefined,
): number {
  return totalMessageTokens(messages) + textWeight(phasePromptText) + payloadWeight(requestInput, [])
}
