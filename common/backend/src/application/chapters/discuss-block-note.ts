import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

/** Labels for structured writes that a gate refused or has not committed yet. */
export function describeDiscussWrites(source: unknown): string[] {
  if (source === null || typeof source !== "object") return []
  const record = source as Record<string, unknown>
  const labels: string[] = []
  const text = (key: string): void => {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) labels.push(`${key}（${String(value.trim().length)}字）`)
  }
  text("synopsisBody")
  text("outlineBody")
  if (Array.isArray(record.bodyEdits) && record.bodyEdits.length > 0) {
    labels.push(`bodyEdits（${String(record.bodyEdits.length)}处）`)
  }
  const proposal = record.chapterDraftProposal
  if (proposal !== null && typeof proposal === "object") {
    const body = (proposal as { body?: unknown }).body
    labels.push(typeof body === "string" && body.trim().length > 0
      ? `chapterDraftProposal（${String(body.trim().length)}字）`
      : "chapterDraftProposal")
  }
  if (Array.isArray(record.chapterDraftProposals) && record.chapterDraftProposals.length > 0) {
    labels.push(`chapterDraftProposals（${String(record.chapterDraftProposals.length)}章）`)
  }
  if (Array.isArray(record.volumeChapterPlans) && record.volumeChapterPlans.length > 0) {
    labels.push(`volumeChapterPlans（${String(record.volumeChapterPlans.length)}章）`)
  }
  if (record.appendedDraft !== undefined) labels.push("appendedDraft")
  if (record.stagingDelta !== undefined) labels.push("stagingDelta")
  if (record.stagingPromote !== undefined) labels.push("stagingPromote")
  if (Array.isArray(record.presentationWrites) && record.presentationWrites.length > 0) {
    labels.push(`presentationWrites（${String(record.presentationWrites.length)}份）`)
  }
  if (record.arcPlan !== undefined) labels.push("arcPlan")
  if (record.volumeSynopsis !== undefined) labels.push("volumeSynopsis")
  if (record.volumePlanMeta !== undefined) labels.push("volumePlanMeta")
  if (Array.isArray(record.goalProposals) && record.goalProposals.length > 0) {
    labels.push(`goalProposals（${String(record.goalProposals.length)}条）`)
  }
  if (record.creationDeskSettings !== undefined) labels.push("creationDeskSettings")
  const focus = record.focusChange
  if (focus !== null && typeof focus === "object" && typeof (focus as { chapterSequence?: unknown }).chapterSequence === "number") {
    labels.push(`focusChange（第${String((focus as { chapterSequence: number }).chapterSequence)}章）`)
  }
  return labels
}

export function formatDiscussBlockNote(input: Readonly<{
  message: string
  discarded?: readonly string[]
  disposition?: "rejected" | "held" | "noted"
}>): string {
  const discarded = input.discarded ?? []
  const disposition = input.disposition ?? (discarded.length > 0 ? "rejected" : "noted")
  if (discarded.length === 0 || disposition === "noted") return input.message
  return renderRuntimePrompt("discuss-block-notes", disposition, {
    message: input.message,
    items: discarded.join("、"),
  })
}
