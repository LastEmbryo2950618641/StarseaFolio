import type { TurnReadEvidence } from "../turns/ports/ai-model-port.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

export type OriginalWorkEvidenceStage =
  | "none"
  | "web_attempted"
  | "archive_searched"
  | "archive_candidate_rejected"
  | "archive_imported"
  | "archive_unavailable"

type ContextMessage = Readonly<{
  role?: string | undefined
  kind?: string | undefined
  content?: string | undefined
}>

const originalWorkSignalPattern = /同人|原作|二创|衍生作|衍生小说|fan\s*fiction|fanfic|based\s+on/iu
const referencePathPattern = /(?:^|[\\/])参考文件[\\/]原作资料(?:[\\/]|$)/u
const borrowedUniverseMarkers = ["间桐", "远坂", "卫宫", "冬木市", "圣杯战争", "御主", "从者", "令咒", "刻印虫"]

/** Detects the mode only. It does not decide whether an individual canon claim is true. */
export function detectsOriginalWorkContext(input: Readonly<{
  userMessage?: string
  heading?: string
  currentWorkDisplayName?: string
  synopsisMarkdown?: string
  outlineMarkdown?: string
  chapterBodyMarkdown?: string
  latestDraftMarkdown?: string
}>): boolean {
  const text = [
    input.userMessage,
    input.heading,
    input.currentWorkDisplayName,
    input.synopsisMarkdown,
    input.outlineMarkdown,
    input.chapterBodyMarkdown,
    input.latestDraftMarkdown,
  ].filter((value): value is string => value !== undefined).join("\n")
  if (originalWorkSignalPattern.test(text)) return true
  // Some projects identify the borrowed universe only through its canonical
  // names. Requiring two independent markers avoids treating an ordinary name
  // collision as fanfiction mode.
  return borrowedUniverseMarkers.filter((marker) => text.includes(marker)).length >= 2
}

export function hasOriginalWorkEvidence(evidence: readonly TurnReadEvidence[]): boolean {
  return evidence.some((item) => {
    const identifiers = [
      item.ownerId,
      ...item.exactKeys,
      ...item.sourceRefs.filter((value): value is string => typeof value === "string"),
    ]
    if (item.ownerKind === "web:diagnostic" || item.ownerKind === "web:disabled"
      || item.ownerKind === "web:search" || item.ownerKind.endsWith(":partial") || item.ownerKind.includes("catalog")) return false
    if (/^matches:\s*0\s*$/mu.test(item.semanticText)) return false
    const isImportedReference = identifiers.some((value) => referencePathPattern.test(value)
      && !/(?:^|[\\/])(?:readme|index)\.md(?:#|$)/iu.test(value))
    const isSettings = item.ownerKind.startsWith("workspace:settings")
      && identifiers.some((value) => /(?:^|[\\/])设定集[\\/]/u.test(value)
        && !/(?:^|[\\/])(?:readme|index)\.md(?:#|$)/iu.test(value))
    const isWebReference = item.ownerKind === "web:page"
    const actualContent = item.semanticText.replace(/^#.*$/gmu, "").trim()
    return (isImportedReference || isSettings || isWebReference) && actualContent.length > 0
  })
}

export function readOriginalWorkEvidenceStage(messages: readonly ContextMessage[]): OriginalWorkEvidenceStage {
  let stage: OriginalWorkEvidenceStage = "none"
  for (const message of messages) {
    if (message.role !== "system" || message.kind !== "phase_instruction") continue
    try {
      const value = JSON.parse(message.content ?? "") as Record<string, unknown>
      if (value.protocol === "original-work-evidence-gate-v1") {
        // Preserve old saved sessions as historical state; never reactivate the removed tool.
        const next = value.stage === "lncrawl_imported" ? "archive_imported"
          : typeof value.stage === "string" && value.stage.startsWith("lncrawl_") ? "web_attempted" : value.stage
        if (next === "web_attempted" || next === "archive_searched" || next === "archive_imported" || next === "archive_unavailable") {
          stage = next
        }
        continue
      }
      if (value.protocol !== "synopsis-tools-v1") continue
      if (value.status === "reference_candidates_found") {
        const result = value.result as { candidateUrls?: unknown } | undefined
        stage = Array.isArray(result?.candidateUrls) && result.candidateUrls.length === 0 ? "archive_unavailable" : "archive_searched"
      }
      if (value.status === "reference_candidate_rejected") stage = "archive_candidate_rejected"
      if (value.status === "reference_search_empty"
        || ((value.name === "original_work_search" || value.name === "original_work_download" || value.name === "original_work_crawl")
          && value.action === "invoke" && value.code === "tool_failed")) stage = "archive_unavailable"
      if (value.status === "reference_imported") stage = "archive_imported"
    } catch {
      // Historical context can contain ordinary non-JSON instructions.
    }
  }
  return stage
}

export function originalWorkEvidenceRepairHint(input: Readonly<{
  stage: OriginalWorkEvidenceStage
  hasWebResearch: boolean
  hasArchive: boolean
}>): string {
  const fallback = renderRuntimePrompt("original-work-evidence", "unavailable")
  if (input.stage === "archive_unavailable") return fallback
  if (input.stage === "archive_candidate_rejected") {
    return renderRuntimePrompt("original-work-evidence", "candidate-mismatch")
  }
  if (input.stage === "none" && input.hasWebResearch) {
    return renderRuntimePrompt("original-work-evidence", "web-lookup")
  }
  if (input.stage === "archive_searched" && input.hasArchive) {
    return renderRuntimePrompt("original-work-evidence", "archive-candidates")
  }
  if (input.stage !== "archive_imported" && input.hasArchive) {
    return renderRuntimePrompt("original-work-evidence", "archive-search")
  }
  return fallback
}
