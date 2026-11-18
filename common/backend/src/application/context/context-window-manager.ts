import type { ModelContextMessage } from "@starseafolio/contracts"

const MODEL_MESSAGE_OVERHEAD_TOKENS = 8

export type ContextCompactionPlan = Readonly<{
  /** Mechanical drop phases are retired; AI fold runs via foldContextMessages. */
  phase: "none" | "ai_fold_required"
  hiddenMessageIds: readonly string[]
  visibleMessages: readonly ModelContextMessage[]
  estimatedTokens: number
  thresholdTokens: number
  targetTokens: number
  protectedTokens: number
  blocked: boolean
  reason?: string
}>

export type ContextCompactionInput = Readonly<{
  messages: readonly ModelContextMessage[]
  currentTurnId?: string
  contextWindowTokens: number
  triggerRatio: number
  targetRatio: number
  incomingTokenEstimate: number
  force?: boolean
}>

/**
 * Estimates whether AI fold is required. Does not hide messages — use foldContextMessages.
 */
export class ContextWindowManager {
  public plan(input: ContextCompactionInput): ContextCompactionPlan {
    const thresholdTokens = Math.max(1, Math.floor(input.contextWindowTokens * input.triggerRatio))
    const targetTokens = Math.max(1, Math.floor(input.contextWindowTokens * input.targetRatio))
    const currentMessages = [...input.messages].sort((left, right) => left.sequence - right.sequence)
    const protectedMessages = currentMessages.filter((message) => isProtected(message, input.currentTurnId))
    const protectedTokens = sumTokens(protectedMessages) + input.incomingTokenEstimate
    const initialTokens = sumTokens(currentMessages) + input.incomingTokenEstimate

    if (protectedTokens > input.contextWindowTokens) {
      return {
        phase: "none",
        hiddenMessageIds: [],
        visibleMessages: currentMessages,
        estimatedTokens: initialTokens,
        thresholdTokens,
        targetTokens,
        protectedTokens,
        blocked: true,
        reason: "Protected system rules, current turn, and incoming request exceed the model context window",
      }
    }
    if (input.force !== true && initialTokens < thresholdTokens) {
      return {
        phase: "none",
        hiddenMessageIds: [],
        visibleMessages: currentMessages,
        estimatedTokens: initialTokens,
        thresholdTokens,
        targetTokens,
        protectedTokens,
        blocked: false,
      }
    }
    return {
      phase: initialTokens > targetTokens ? "ai_fold_required" : "none",
      hiddenMessageIds: [],
      visibleMessages: currentMessages,
      estimatedTokens: initialTokens,
      thresholdTokens,
      targetTokens,
      protectedTokens,
      blocked: false,
      ...(initialTokens > targetTokens
        ? { reason: "Visible context exceeds the compression target; run AI fold compaction" }
        : {}),
    }
  }
}

function isProtected(message: ModelContextMessage, currentTurnId: string | undefined): boolean {
  return message.kind === "system_rules" || isCurrentTurn(message, currentTurnId)
}

function isCurrentTurn(message: ModelContextMessage, currentTurnId: string | undefined): boolean {
  return currentTurnId !== undefined && message.turnId === currentTurnId
}

function sumTokens(messages: readonly ModelContextMessage[]): number {
  return messages.reduce((total, message) => total + message.tokenEstimate, 0)
}

export function estimateModelMessageTokens(content: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(content).length / 3) + MODEL_MESSAGE_OVERHEAD_TOKENS)
}
