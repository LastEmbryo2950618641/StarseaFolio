import type { ModelContextMessage, ModelContextMessageDraft } from "@starseafolio/contracts"

import { digest } from "../../core/index.js"

const OUTPUT_CONTRACT_PREFIX = "MANDATORY OUTPUT CONTRACT"

type DiscussContextMessage = Pick<ModelContextMessage, "kind" | "content" | "role">
  & Partial<Pick<ModelContextMessage, "taskId" | "turnId" | "phase" | "messageId">>

function isEphemeralDiscussRequestMessage(message: DiscussContextMessage): boolean {
  if (message.taskId === undefined || message.turnId === undefined || message.phase !== "synopsis_discuss") {
    return false
  }
  if (message.kind === "phase_protocol") return true
  if (message.kind === "phase_instruction" && message.role === "user") return true
  return message.kind === "phase_request" && message.content?.startsWith(OUTPUT_CONTRACT_PREFIX) === true
}

/** Remove call-scoped prompt copies persisted by older versions of the discussion flow. */
export function findEphemeralDiscussContextMessageIds(
  messages: readonly ModelContextMessage[],
): readonly string[] {
  return messages.flatMap((message) => (
    message.messageId !== undefined && isEphemeralDiscussRequestMessage(message)
      ? [message.messageId]
      : []
  ))
}

/**
 * Static tail messages re-attached on every model call for the wire format.
 * Persisting every copy into the durable chain causes exact-duplicate bloat.
 */
export function isStaticRedundantContextContent(
  kind: ModelContextMessageDraft["kind"] | ModelContextMessage["kind"],
  content: string | undefined,
): boolean {
  if (content === undefined || content.length === 0) return false
  if (kind === "phase_instruction" || kind === "phase_protocol") return true
  if (kind === "phase_request" && content.startsWith(OUTPUT_CONTRACT_PREFIX)) return true
  return false
}

/**
 * 讨论链只追加：跨轮的同文提示仍作为新消息保留，只去掉同一轮 ReAct 内的重复回传。
 * 正式推演链保持原有去重（阶段提示按次重装，历史不重放）。
 */
export function filterNovelContextExchangeMessages(
  existing: readonly Pick<ModelContextMessage, "kind" | "content" | "contentDigest" | "turnId">[],
  drafts: readonly ModelContextMessageDraft[],
  options?: Readonly<{ appendOnly?: boolean }>,
): ModelContextMessageDraft[] {
  const seen = new Set<string>()
  const seenTurnMessages = new Set<string>()
  for (const message of existing) {
    const content = message.content
    if (content === undefined) continue
    if (message.turnId !== undefined) {
      seenTurnMessages.add(`${message.turnId}\u0000${message.kind}\u0000${digest(content)}`)
    }
    if (options?.appendOnly === true) continue
    if (!isStaticRedundantContextContent(message.kind, content)) continue
    seen.add(staticContentKey(message.kind, content, message.contentDigest))
  }

  const kept: ModelContextMessageDraft[] = []
  for (const draft of drafts) {
    const content = draft.content
    if (content === undefined) {
      kept.push(draft)
      continue
    }
    // 同一轮内的重复回传去重；跨轮的同文提示在 appendOnly 下仍作为新消息追加。
    if (draft.turnId !== undefined) {
      const turnKey = `${draft.turnId}\u0000${draft.kind}\u0000${digest(content)}`
      if (seenTurnMessages.has(turnKey)) continue
      seenTurnMessages.add(turnKey)
    }
    if (options?.appendOnly === true) {
      kept.push(draft)
      continue
    }
    if (!isStaticRedundantContextContent(draft.kind, content)) {
      kept.push(draft)
      continue
    }
    const key = staticContentKey(draft.kind, content)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(draft)
  }
  return kept
}

/**
 * Ids of later exact duplicates of static instruction/protocol/output-contract messages.
 * Keeps the earliest sequence for each digest so existing chains can be cleaned.
 */
export function findExactDuplicateStaticMessageIds(
  messages: readonly ModelContextMessage[],
): readonly string[] {
  const seen = new Set<string>()
  const hide: string[] = []
  const sorted = [...messages].sort((left, right) => left.sequence - right.sequence)
  for (const message of sorted) {
    const content = message.content
    if (content === undefined) continue
    if (!isStaticRedundantContextContent(message.kind, content)) continue
    const key = staticContentKey(message.kind, content, message.contentDigest)
    if (seen.has(key)) hide.push(message.messageId)
    else seen.add(key)
  }
  return hide
}

function staticContentKey(
  kind: string,
  content: string,
  contentDigest?: string,
): string {
  return `${kind}:${contentDigest !== undefined && contentDigest.length > 0 ? contentDigest : digest(content)}`
}
