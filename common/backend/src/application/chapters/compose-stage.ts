import type { ComposeEvent, ComposeSection } from "@starseafolio/prompt-contracts"
import type { DiscussProceedProgress, DiscussProceedStage } from "@starseafolio/contracts"

/** Map a compose protocol event to the existing discuss stage bar. */
export function composeProgressForEvent(
  event: ComposeEvent,
): DiscussProceedProgress | undefined {
  if (event.type === "error") return undefined
  if (event.type === "text") return undefined
  if (event.type === "section_delta") return undefined
  const stage = stageForSection(event.section)
  return {
    stage,
    status: event.type === "section_start" ? "running" : "done",
  }
}

export function stageForSection(section: ComposeSection): DiscussProceedStage {
  switch (section) {
    case "synopsis": return "synopsis_discuss"
    case "outline": return "outline_discuss"
    case "draft": return "draft_discuss"
  }
}
