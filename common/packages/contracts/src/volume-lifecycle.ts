import { z } from "zod"

/** Volume lifecycle stops. Order matters: each one gates the next write step. */
export const VOLUME_LIFECYCLE_PHASES = [
  "volume_start",
  "style_selection",
  "protagonist_selection",
  "mainline_selection",
  "subplot_selection",
  "conception",
  "writing",
  "volume_end",
  "revision",
] as const

export const volumeLifecyclePhaseSchema = z.enum(VOLUME_LIFECYCLE_PHASES)
export type VolumeLifecyclePhase = z.infer<typeof volumeLifecyclePhaseSchema>

export const VOLUME_LIFECYCLE_LABELS: Readonly<Record<VolumeLifecyclePhase, string>> = {
  volume_start: "卷始",
  style_selection: "风格选择",
  protagonist_selection: "主角选择",
  mainline_selection: "主线选择",
  subplot_selection: "支线选择",
  conception: "构思",
  writing: "开始编撰",
  volume_end: "卷末",
  revision: "修订",
}

/** Existing volume plan has no subplot cap; the project cap is a UI/gate constant. */
export const VOLUME_SUBPLOT_LIMIT = 6

export const volumeLifecycleStageSchema = z.object({
  phase: volumeLifecyclePhaseSchema,
  label: z.string().min(1),
  status: z.enum(["done", "current", "pending"]),
})
export type VolumeLifecycleStage = z.infer<typeof volumeLifecycleStageSchema>

export const volumeLifecycleSchema = z.object({
  volumeFolderName: z.string().min(1).optional(),
  phase: volumeLifecyclePhaseSchema,
  stages: z.array(volumeLifecycleStageSchema),
  chapterCount: z.number().int().nonnegative(),
  chapterLimit: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().nonnegative(),
  subplotCount: z.number().int().nonnegative(),
  subplotLimit: z.number().int().positive(),
  ended: z.boolean(),
  revision: z.boolean(),
})
export type VolumeLifecycle = z.infer<typeof volumeLifecycleSchema>

export function countVolumeSubplots(text: string | undefined): number {
  const normalized = text?.trim() ?? ""
  if (normalized.length === 0 || /^(?:无|暂无|没有|不设|待定)[。.!！\s]*$/u.test(normalized)) return 0
  const bySemicolon = normalized.split(/[；;]+/u).map((item) => item.trim()).filter((item) => item.length > 0)
  if (bySemicolon.length > 1) return bySemicolon.length
  const byLine = normalized.split(/\r?\n+/u).map((item) => item.replace(/^[-*]\s*/u, "").trim()).filter((item) => item.length > 0)
  return byLine.length > 1 ? byLine.length : 1
}

export function buildVolumeLifecycle(input: Readonly<{
  started: boolean
  styleReady: boolean
  protagonistReady: boolean
  opening?: string | undefined
  climaxes?: string | undefined
  ending?: string | undefined
  subplots?: string | undefined
  conceptionReady: boolean
  chapterCount: number
  chapterLimit: number
  wordCount?: number
  targetWordCount?: number
  endedAtMs?: number | undefined
  revision?: boolean
}>): VolumeLifecycle {
  const subplotCount = countVolumeSubplots(input.subplots)
  const mainlineReady = [input.opening, input.climaxes, input.ending]
    .every((text) => (text ?? "").trim().length > 0)
  const ended = input.endedAtMs !== undefined
  let phase: VolumeLifecyclePhase
  if (ended) {
    phase = input.revision === true ? "revision" : "volume_end"
  } else if (!input.started) {
    phase = "volume_start"
  } else if (!input.styleReady) {
    phase = "style_selection"
  } else if (!input.protagonistReady) {
    phase = "protagonist_selection"
  } else if (!mainlineReady) {
    phase = "mainline_selection"
  } else if (!input.subplots?.trim()) {
    phase = "subplot_selection"
  } else if (!input.conceptionReady) {
    phase = "conception"
  } else if (input.chapterLimit > 0 && input.chapterCount >= input.chapterLimit) {
    phase = "volume_end"
  } else {
    phase = "writing"
  }
  const activeIndex = VOLUME_LIFECYCLE_PHASES.indexOf(phase)
  const effectiveActive = phase === "revision" ? VOLUME_LIFECYCLE_PHASES.length - 1 : activeIndex
  return {
    phase,
    stages: VOLUME_LIFECYCLE_PHASES.map((stage, index) => ({
      phase: stage,
      label: VOLUME_LIFECYCLE_LABELS[stage],
      status: index < effectiveActive ? "done" : index === effectiveActive ? "current" : "pending",
    })),
    chapterCount: Math.max(0, input.chapterCount),
    chapterLimit: Math.max(0, input.chapterLimit),
    wordCount: Math.max(0, input.wordCount ?? 0),
    targetWordCount: Math.max(0, input.targetWordCount ?? 0),
    subplotCount,
    subplotLimit: VOLUME_SUBPLOT_LIMIT,
    ended,
    revision: input.revision === true,
  }
}
