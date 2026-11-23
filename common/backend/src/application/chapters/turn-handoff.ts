import type { TurnHandoffBrief, TurnMonitorPhaseSnapshot } from "@starseafolio/contracts"

import type { StoredPhaseRun } from "../turns/ports/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

const MONITOR_SUMMARY_MAX = 280

export function buildTurnMonitorPhases(
  runs: readonly StoredPhaseRun[],
): readonly TurnMonitorPhaseSnapshot[] {
  return runs.map((run) => ({
    phase: run.phase,
    status: run.status,
    summary: summarizePhaseResult(run),
    ...(run.finishedAtMs === undefined ? {} : { finishedAtMs: run.finishedAtMs }),
  }))
}

export function formatTurnHandoffSystemMessage(brief: TurnHandoffBrief): string {
  const notes = brief.outlineNotes.length === 0
    ? renderRuntimePrompt("turn-context", "handoff-no-outline-note")
    : brief.outlineNotes.map((note) => `- ${note}`).join("\n")
  return renderRuntimePrompt("turn-context", "published-handoff", {
    sequence: brief.chapterSequence,
    heading: brief.chapterHeading,
    path: brief.chapterPath,
    taskId: brief.taskId,
    body: brief.bodyDigest,
    notes,
  })
}

export function truncateChapterBodyDigest(content: string, maxChars = 1_200): string {
  const normalized = content.replace(/\r\n/gu, "\n").trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}…`
}

function summarizePhaseResult(run: StoredPhaseRun): string {
  const result = run.result
  if (result === undefined) return `${run.phase} · ${run.status}`
  if (typeof result === "string") return clip(`${run.phase}: ${result}`, MONITOR_SUMMARY_MAX)
  if (typeof result !== "object" || result === null) return `${run.phase} · ${run.status}`
  const record = result as Record<string, unknown>
  const bits: string[] = [run.phase, run.status]
  for (const key of ["summary", "assistantMessage", "heading", "title", "outcome"] as const) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      bits.push(value.trim())
      break
    }
  }
  return clip(bits.join(" · "), MONITOR_SUMMARY_MAX)
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
