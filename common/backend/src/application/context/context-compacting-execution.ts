import type { PhaseRequestEnvelope, VisibleModelContextMessage } from "@starseafolio/contracts"
import type { AIModelPort, ModelExecutionOptions, PhaseModelExecution } from "../turns/ports/ai-model-port.js"
import { estimateModelMessageTokens } from "./context-window-manager.js"

export type ContextCompactionEvent = Readonly<{
  reason: "usage_threshold" | "context_length_error"
  observedInputTokens?: number
  estimatedInputTokens?: number
  thresholdTokens: number
  hiddenMessageIds: readonly string[]
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

function valueAppearsIn(value: unknown, haystack: string): boolean {
  if (typeof value === "string") return value.length > 0 && haystack.includes(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized !== undefined && serialized.length > 2 && serialized !== "{}" && haystack.includes(serialized)
  } catch {
    return false
  }
}

/** Catalog, evidence, and old planning text already stored in removed history must not be weighed or sent again. The current chapter body stays once. */
function stripReplayedPayload(requestInput: unknown, hiddenContents: readonly string[]): unknown {
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
  visibleContents: readonly string[],
): number {
  const stripped = stripReplayedPayload(stripReplayedPayload(requestInput, hiddenContents), visibleContents)
  const input = asRecord(stripped)
  const discuss = asRecord(input.synopsisDiscuss)
  if (Object.keys(discuss).length === 0) return textWeight(stripped)
  const nextDiscuss = { ...discuss }
  for (const key of ["chapterBodyMarkdown", "synopsisMarkdown", "outlineMarkdown", "latestDraftMarkdown"] as const) {
    const value = nextDiscuss[key]
    if (typeof value === "string" && value.length > 0 && visibleContents.some((content) => content.includes(value))) {
      delete nextDiscuss[key]
    }
  }
  return textWeight({ ...input, ...(Object.keys(nextDiscuss).length === 0 ? {} : { synopsisDiscuss: nextDiscuss }) })
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

function isChapterBodyMessage(message: VisibleModelContextMessage): boolean {
  return message.kind === "canonical_chapter"
    || message.kind === "chapter_revision"
    || (message.kind === "phase_request" && message.content.includes('"chapterBodyMarkdown"'))
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

function isProtectedDiscussState(message: VisibleModelContextMessage): boolean {
  if (message.kind !== "phase_instruction") return false
  try {
    const value: unknown = JSON.parse(message.content)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false
    const protocol = (value as Record<string, unknown>).protocol
    return (message.role === "user" && protocol === "discuss-history-summary-v1")
      || (message.role === "system" && (
        protocol === "discuss-step-failures-v1"
        || protocol === "discuss-progress-v1"
        || protocol === "discuss-gate-v1"
      ))
  } catch {
    return false
  }
}

// Provider usage decides when to compact. Text weights only choose how much old
// history to remove; they are never reported as measured token counts.
export async function executeWithContextCompaction(input: {
  model: AIModelPort
  request: PhaseRequestEnvelope
  options: ModelExecutionOptions
  lastRequestInputTokens?: number
  triggerRatio: number
  targetRatio: number
  onReadyToCall?(): void
  onCompacted(event: ContextCompactionEvent): Promise<void>
}): Promise<PhaseModelExecution> {
  let messages = [...(input.options.contextMessages ?? [])]
  let windowTokens = input.model.info?.contextWindowTokens ?? 64_000
  const compact = async (reason: ContextCompactionEvent["reason"], observedInputTokens?: number): Promise<boolean> => {
    const keptDescriptions = latestToolDescriptionIds(messages)
    const duplicateRules = duplicateSystemRulesIds(messages, input.request.turnId)
    const removable = messages.filter((message) => (
      message.turnId !== input.request.turnId
      && !isProtectedDiscussState(message)
      && !keptDescriptions.has(message.messageId)
      && (message.kind !== "system_rules" || duplicateRules.has(message.messageId))
    ))
    const weights = new Map(messages.map((message) => [message.messageId, estimateModelMessageTokens(message.content)]))
    const hidden = new Set<string>()
    const outgoingWeight = (): number => {
      const visible = messages.filter((message) => !hidden.has(message.messageId))
      const hiddenContents = messages.filter((message) => hidden.has(message.messageId)).map((message) => message.content)
      const messageWeight = visible.reduce((sum, message) => sum + (weights.get(message.messageId) ?? 0), 0)
      return messageWeight + textWeight(input.options.phasePrompt?.text) + payloadWeight(input.request.input, hiddenContents, visible.map((message) => message.content))
    }
    const baselineWeight = outgoingWeight()
    const targetFraction = observedInputTokens === undefined || observedInputTokens <= 0 || baselineWeight <= 0
      ? 0
      : Math.min(1, windowTokens * input.targetRatio / observedInputTokens)
    const targetWeight = baselineWeight * targetFraction
    for (const message of removable) {
      if (!isChapterBodyMessage(message)) hidden.add(message.messageId)
    }
    for (const message of removable.filter(isChapterBodyMessage).sort((left, right) => left.sequence - right.sequence)) {
      if (outgoingWeight() <= targetWeight) break
      hidden.add(message.messageId)
    }
    if (hidden.size === 0) return false
    const hiddenContents = messages.filter((message) => hidden.has(message.messageId)).map((message) => message.content)
    const stripped = stripReplayedPayload(input.request.input, hiddenContents)
    if (stripped !== input.request.input) {
      (input.request as { input?: unknown }).input = stripped
    }
    const remainingWeight = outgoingWeight()
    messages = messages.filter((message) => !hidden.has(message.messageId))
    const estimatedInputTokens = observedInputTokens === undefined || observedInputTokens <= 0 || baselineWeight <= 0
      ? undefined
      : Math.max(0, Math.ceil(observedInputTokens * (remainingWeight / baselineWeight)))
    await input.onCompacted({
      reason,
      ...(observedInputTokens === undefined ? {} : { observedInputTokens }),
      ...(estimatedInputTokens === undefined ? {} : { estimatedInputTokens }),
      thresholdTokens: Math.floor(windowTokens * input.triggerRatio),
      hiddenMessageIds: [...hidden],
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
        throw new Error("上下文超限：已无法继续裁剪旧历史，系统规则、当前轮次或本次资料仍过大。请缩小本次输入或资料范围后重试。", { cause: error })
      }
      input.options.onSchemaRepair?.()
    }
  }
}
