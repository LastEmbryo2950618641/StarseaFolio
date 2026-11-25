import type { AIModelPort } from "../../src/application/turns/ports/ai-model-port.js"

/**
 * Wrap a fixture model so legacy artifact-shaped synopsis_discuss replies are
 * delivered as the tagged plain-text response the phase now requires.
 */
export function textFixtureModel(model: AIModelPort): AIModelPort {
  return {
    ...model,
    execute: async (request, options) => {
      const execution = await model.execute(request, options)
      if (request.phase !== "synopsis_discuss") return execution
      const artifact = execution.result.artifact
      if (artifact === null || typeof artifact !== "object") return execution
      const record = artifact as Record<string, unknown>
      if (typeof record.assistantMessage !== "string" || "toolRequest" in record) return execution
      const finalSelfReview = typeof record.finalSelfReview === "string" ? record.finalSelfReview : "纯文本讨论响应。"
      return {
        ...execution,
        result: { ...execution.result, artifact: { assistantMessage: fixtureDiscussText(record), finalSelfReview } },
      }
    },
  }
}

/**
 * Test-only bridge: turn a legacy fixture-shaped discussion artifact into the
 * plain-text tagged reply the production phase now expects. Fixtures should
 * eventually emit these tags directly; this keeps the migration mechanical.
 */
export function fixtureDiscussText(artifact: Record<string, unknown>): string {  const parts: string[] = []
  const prose = typeof artifact.assistantMessage === "string" ? artifact.assistantMessage.trim() : ""
  if (/<\/?(?:compose-|creative-|chapter-title\b|volume-folder\b|chapter-focus\b|work-title\b|work-description\b|goal-proposals\b|continue-turn)/u.test(prose)) {
    return prose
  }
  if (prose.length > 0) parts.push(prose)

  const intent = artifact.planningWriteIntent as Record<string, string> | undefined
  if (intent !== undefined) {
    const attributes = ["synopsis", "outline", "draft", "volume"]
      .filter((key) => typeof intent[key] === "string")
      .map((key) => `${key}="${intent[key]!}"`)
    if (attributes.length > 0) parts.push(`<compose-intent ${attributes.join(" ")}/>`)
  }

  if (typeof artifact.chapterTitle === "string") parts.push(`<chapter-title>${artifact.chapterTitle}</chapter-title>`)
  if (typeof artifact.volumeFolderName === "string") parts.push(`<volume-folder>${artifact.volumeFolderName}</volume-folder>`)
  const focus = artifact.focusChange as { chapterSequence?: number; userRequestQuote?: string; focusKind?: string } | undefined
  if (focus?.chapterSequence !== undefined) {
    parts.push([
      "<chapter-focus>",
      String(focus.chapterSequence),
      ...(focus.userRequestQuote === undefined ? [] : [focus.userRequestQuote]),
      ...(focus.focusKind === undefined ? [] : [`focusKind: ${focus.focusKind}`]),
      "</chapter-focus>",
    ].join("\n"))
  }
  if (typeof artifact.workDisplayName === "string") parts.push(`<work-title>${artifact.workDisplayName}</work-title>`)
  if (typeof artifact.workDescription === "string") parts.push(`<work-description>${artifact.workDescription}</work-description>`)

  if (typeof artifact.synopsisBody === "string" && artifact.synopsisBody.length > 0) {
    parts.push(`<compose-synopsis>\n${artifact.synopsisBody}\n</compose-synopsis>`)
  }
  if (typeof artifact.outlineBody === "string" && artifact.outlineBody.length > 0) {
    parts.push(`<compose-outline>\n${artifact.outlineBody}\n</compose-outline>`)
  }
  const draft = artifact.chapterDraftProposal as { heading?: string; body?: string } | undefined
  if (draft !== undefined) {
    parts.push(`<compose-draft>\n# ${draft.heading ?? "正文"}\n${draft.body ?? ""}\n</compose-draft>`)
  }
  const bodyEdits = artifact.bodyEdits as { ops?: Array<{ oldText?: string; newText?: string }> } | undefined
  if (bodyEdits !== undefined) {
    parts.push(`<compose-outline-patch>\n${(bodyEdits.ops ?? []).map((op) => (
      `<search>\n${op.oldText ?? ""}\n</search>\n<replace>\n${op.newText ?? ""}\n</replace>`
    )).join("\n")}\n</compose-outline-patch>`)
  }

  const choices = artifact.choices as Array<{ label?: string }> | undefined
  const labels = Array.isArray(choices) ? choices.filter((choice) => typeof choice.label === "string").map((choice) => choice.label!) : []
  if (labels.length > 1) {
    parts.push(`<creative-choices>\n${labels.map((label) => `- ${label}`).join("\n")}\n</creative-choices>`)
  }
  if (artifact.continueTurn === true) parts.push("<continue-turn/>")
  return parts.join("\n\n")
}
