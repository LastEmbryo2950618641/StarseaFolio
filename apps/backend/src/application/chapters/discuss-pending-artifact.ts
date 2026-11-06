import type { SynopsisDiscussArtifact } from "@worldseed/prompt-contracts"

export type PendingDiscussWrites = Omit<SynopsisDiscussArtifact,
  "assistantMessage" | "finalSelfReview" | "toolRequest" | "choices" | "continueTurn" | "focusChange">

export function retainDiscussWrites(artifact: SynopsisDiscussArtifact): PendingDiscussWrites {
  const {
    assistantMessage: _message, finalSelfReview: _review, toolRequest: _tool,
    choices: _choices, continueTurn: _continue, focusChange: _focus, ...writes
  } = artifact
  return writes
}

export function restoreDiscussWrites(
  pending: PendingDiscussWrites | undefined,
  current: SynopsisDiscussArtifact,
  chapterSequence: number,
): SynopsisDiscussArtifact {
  if (pending === undefined || current.toolRequest !== undefined) return current
  if (current.focusChange !== undefined && current.focusChange.chapterSequence !== chapterSequence) return current
  if ((["chapterTitle", "volumeFolderName", "titleAlignTarget"] as const)
    .some((key) => current[key] !== undefined && current[key] !== pending[key])) return current

  const retained = { ...pending }
  // A changed upstream plan invalidates downstream text retained before the repair.
  if (current.synopsisBody !== undefined && current.synopsisBody !== pending.synopsisBody) {
    delete retained.outlineBody
    delete retained.bodyEdits
    delete retained.chapterDraftProposal
    delete retained.chapterDraftProposals
  }
  if ((current.outlineBody !== undefined && current.outlineBody !== pending.outlineBody)
    || (current.bodyEdits !== undefined && JSON.stringify(current.bodyEdits) !== JSON.stringify(pending.bodyEdits))
    || current.volumeChapterPlans !== undefined) {
    delete retained.chapterDraftProposal
    delete retained.chapterDraftProposals
  }
  if (current.outlineBody !== undefined) delete retained.bodyEdits
  if (current.bodyEdits !== undefined) delete retained.outlineBody
  if (current.chapterDraftProposal !== undefined) delete retained.chapterDraftProposals
  if (current.chapterDraftProposals !== undefined) delete retained.chapterDraftProposal
  const supplied = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== undefined))
  return { ...retained, ...supplied } as SynopsisDiscussArtifact
}
