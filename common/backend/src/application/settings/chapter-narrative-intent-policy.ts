import type { AIPhase, ChapterNarrativeIntent } from "@starseafolio/contracts"

import {
  AUTO_DESCRIPTION_RULE_PATH,
  DEAI_DESCRIPTION_RULE_PATH,
  isAutoDescriptionSelection,
  SENSORY_DESCRIPTION_RULE_PATH,
} from "../../core/workspace/work-description-rules.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

export const DEFAULT_CHAPTER_NARRATIVE_INTENT: ChapterNarrativeIntent = {
  boundaryPace: "advance_allowed",
  causalityFocus: "auto",
}

export function resolveChapterNarrativeIntent(
  intent: ChapterNarrativeIntent | undefined,
): ChapterNarrativeIntent {
  return intent ?? DEFAULT_CHAPTER_NARRATIVE_INTENT
}

/** Phase appendix for synopsis_discuss / draft — narrative pace, not world-divergence. */
export function chapterNarrativeIntentPhaseAppendix(
  intent: ChapterNarrativeIntent | undefined,
  phase: AIPhase,
): string | undefined {
  if (phase !== "synopsis_discuss" && phase !== "draft") return undefined
  const resolved = resolveChapterNarrativeIntent(intent)
  const boundary = boundaryPaceSection(resolved.boundaryPace)
  const causality = causalityFocusSection(resolved.causalityFocus, resolved.boundaryPace)
  return renderRuntimePrompt("chapter-settings", "narrative", { boundary, causality })
}

export type ChapterPresentationBudget = Readonly<{
  descriptionRulePath?: string | undefined
  proseStyleRulePath?: string | undefined
  novelMajorCategoryRulePath?: string | undefined
  novelSubcategoryRulePath?: string | undefined
  minimumWordCount: number
  maximumWordCount: number
}>

/** Inject active creation-desk constraints into prose-writing phases. */
export function chapterPresentationPhaseAppendix(
  presentation: ChapterPresentationBudget | undefined,
  phase: AIPhase,
): string | undefined {
  if (presentation === undefined || (phase !== "draft" && phase !== "synopsis_discuss")) return undefined
  const referenceWordCount = Math.round((presentation.minimumWordCount + presentation.maximumWordCount) / 2)
  const proseLengthContract = renderRuntimePrompt("chapter-settings", "length", {
    min: presentation.minimumWordCount,
    max: presentation.maximumWordCount,
    reference: referenceWordCount,
  })
  if (phase === "draft") return proseLengthContract
  const formatPath = (path: string | undefined): string => path === undefined ? "未选择" : "`" + path + "`"
  const lines = [proseLengthContract, "", renderRuntimePrompt("chapter-settings", "discuss")]
  if (presentation.novelMajorCategoryRulePath !== undefined || presentation.novelSubcategoryRulePath !== undefined) {
    lines.push("", renderRuntimePrompt("chapter-settings", "genre", {
      major: formatPath(presentation.novelMajorCategoryRulePath),
      minor: formatPath(presentation.novelSubcategoryRulePath),
    }))
  }
  const baselines = { sensory: SENSORY_DESCRIPTION_RULE_PATH, polish: DEAI_DESCRIPTION_RULE_PATH }
  if (isAutoDescriptionSelection(presentation.descriptionRulePath)) {
    lines.push("", renderRuntimePrompt("chapter-settings", "auto-description", { auto: AUTO_DESCRIPTION_RULE_PATH, ...baselines }))
  } else {
    lines.push("", renderRuntimePrompt("chapter-settings", "selected-description", {
      description: presentation.descriptionRulePath ?? "",
      ...baselines,
    }))
  }
  if (presentation.proseStyleRulePath !== undefined && presentation.proseStyleRulePath.length > 0) {
    lines.push("", renderRuntimePrompt("chapter-settings", "prose-style", { prose: presentation.proseStyleRulePath }))
  }
  lines.push("", renderRuntimePrompt("chapter-settings", "collaboration"))
  return lines.join("\n")
}

function boundaryPaceSection(pace: ChapterNarrativeIntent["boundaryPace"]): string {
  if (pace === "hold_without_resolution") {
    return renderRuntimePrompt("chapter-settings", "pace-hold")
  }
  return renderRuntimePrompt("chapter-settings", "pace-advance")
}

function causalityFocusSection(
  focus: ChapterNarrativeIntent["causalityFocus"],
  pace: ChapterNarrativeIntent["boundaryPace"],
): string {
  const holdNote = pace === "hold_without_resolution"
    ? renderRuntimePrompt("chapter-settings", "focus-hold")
    : undefined
  return [renderRuntimePrompt("chapter-settings", `focus-${focus}`), holdNote].filter(Boolean).join("\n")
}
