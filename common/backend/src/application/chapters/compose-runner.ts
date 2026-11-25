import type { PhaseRequestEnvelope } from "@starseafolio/contracts"
import {
  ComposeStreamParser,
  type ComposeEvent,
} from "@starseafolio/prompt-contracts"

import type {
  AIModelPort,
  ModelExecutionOptions,
  PhaseModelExecution,
  PromptResource,
} from "../turns/ports/ai-model-port.js"
import { composeProgressForEvent } from "./compose-stage.js"
import { composeArtifactFromText, type ComposeArtifact } from "./compose-artifact.js"

export type ComposeRunnerResult = Readonly<{
  rawText: string
  artifact: ComposeArtifact
  execution: PhaseModelExecution
  events: readonly ComposeEvent[]
}>

/**
 * Execute one discussion turn in pure-text compose mode.
 * The model must use compose-synopsis/outline/draft tags; the host converts the
 * final text into the existing artifact shape and reports stage transitions.
 */
export async function runComposeTurn(input: Readonly<{
  model: AIModelPort
  request: PhaseRequestEnvelope
  phasePrompt: PromptResource
  onPartial?: ModelExecutionOptions["onPartial"]
  onStage?: (event: ComposeEvent) => void
  options?: Omit<ModelExecutionOptions, "outputMode" | "phasePrompt" | "onPartial">
}>): Promise<ComposeRunnerResult> {
  const parser = new ComposeStreamParser()
  const events: ComposeEvent[] = []
  const execution = await input.model.execute(input.request, {
    ...input.options,
    phasePrompt: input.phasePrompt,
    outputMode: "text",
    onPartial: (partial) => {
      input.onPartial?.(partial)
      if (partial.contentDelta === undefined) return
      for (const event of parser.push(partial.contentDelta)) {
        events.push(event)
        input.onStage?.(event)
      }
    },
  })
  for (const event of parser.finish()) {
    events.push(event)
    input.onStage?.(event)
  }
  const rawText = typeof execution.result.artifact === "object"
    && execution.result.artifact !== null
    && "assistantMessage" in execution.result.artifact
    && typeof execution.result.artifact.assistantMessage === "string"
    ? execution.result.artifact.assistantMessage
    : ""
  if (rawText.trim().length === 0) throw new Error("纯文本构思响应为空")
  return {
    rawText,
    artifact: composeArtifactFromText(rawText),
    execution,
    events,
  }
}

/** Convenience: report stage transitions through the existing progress mapper. */
export function composeStageProgress(event: ComposeEvent): ReturnType<typeof composeProgressForEvent> {
  return composeProgressForEvent(event)
}
