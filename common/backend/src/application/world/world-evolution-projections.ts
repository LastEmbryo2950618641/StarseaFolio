import type {
  EvolutionProjection,
  EvolutionProjectionStatus,
  EvolutionWorldClock,
  WorldEvolutionListResult,
} from "@starseafolio/contracts"

import type { FrontierRecord } from "../turns/ports/turn-persistence.js"

export type GraphLabelResolver = (ref: string) => Promise<string | undefined>

export async function buildWorldEvolutionListResult(input: Readonly<{
  frontiers: readonly FrontierRecord[]
  relatedAnchorIds?: readonly string[]
  resolveLabel: GraphLabelResolver
}>): Promise<WorldEvolutionListResult> {
  const related = new Set(input.relatedAnchorIds ?? [])
  const projections: EvolutionProjection[] = []
  for (const frontier of input.frontiers) {
    projections.push(await projectFrontier(frontier, related, input.resolveLabel))
  }
  return {
    clock: await buildWorldClock(projections, input.resolveLabel),
    projections,
  }
}

async function projectFrontier(
  frontier: FrontierRecord,
  relatedAnchorIds: ReadonlySet<string>,
  resolveLabel: GraphLabelResolver,
): Promise<EvolutionProjection> {
  const title = (await resolveLabel(frontier.frontierAnchorRef))
    ?? shortRef(frontier.frontierAnchorRef)
  const timeLabel = await firstLabel(frontier.lastTimeAnchorRefs, resolveLabel)
  const locationLabel = await firstLabel(frontier.lastLocationAnchorRefs, resolveLabel)
  const basisRefs = uniqueRefs([
    ...frontier.lastSceneAnchorRefs,
    ...frontier.correspondenceRefs,
  ])
  const status = resolveStatus(frontier, relatedAnchorIds)
  return {
    frontierId: frontier.id,
    frontierAnchorRef: frontier.frontierAnchorRef,
    title,
    status,
    occurrence: frontier.reason.trim().length > 0 ? frontier.reason.trim() : "已提交的演化前沿",
    ...(timeLabel === undefined ? {} : { timeLabel }),
    ...(locationLabel === undefined ? {} : { locationLabel }),
    basisRefs,
    impact: impactCopy(status, frontier),
    ...(frontier.revisitCondition === undefined || frontier.revisitCondition.trim().length === 0
      ? {}
      : { revisitCondition: frontier.revisitCondition.trim() }),
    lastProcessedAtMs: frontier.lastProcessedAt,
  }
}

function resolveStatus(
  frontier: FrontierRecord,
  relatedAnchorIds: ReadonlySet<string>,
): EvolutionProjectionStatus {
  if (frontier.disposition === "deferred") return "deferred"
  if (frontier.disposition === "archived") return "archived"
  const touchesRelated = relatedAnchorIds.size > 0 && [
    frontier.frontierAnchorRef,
    ...frontier.lastSceneAnchorRefs,
    ...frontier.lastLocationAnchorRefs,
    ...frontier.correspondenceRefs,
  ].some((ref) => relatedAnchorIds.has(ref))
  return touchesRelated ? "reached_prose" : "committed"
}

function impactCopy(status: EvolutionProjectionStatus, frontier: FrontierRecord): string {
  if (status === "deferred") {
    return frontier.revisitCondition?.trim() || "缺少可用路径，保留在演化前沿"
  }
  if (status === "archived") return "该局部已归档，不再自动调度"
  if (status === "reached_prose") return "与当前任务锚点相关，可进入本轮正文检索"
  return "已提交到世界图；主角是否接触取决于后续正文"
}

async function buildWorldClock(
  projections: readonly EvolutionProjection[],
  resolveLabel: GraphLabelResolver,
): Promise<EvolutionWorldClock> {
  const active = projections.find((item) => item.status === "reached_prose" || item.status === "committed")
  if (active === undefined) {
    return { summary: "随已提交章节与前沿推进" }
  }
  const timeLabel = active.timeLabel
  const locationLabel = active.locationLabel
  const parts = [timeLabel, locationLabel].filter((part): part is string => part !== undefined && part.length > 0)
  if (parts.length === 0) {
    const fallback = (await resolveLabel(active.frontierAnchorRef)) ?? active.title
    return { summary: `前沿：${fallback}` }
  }
  return {
    summary: parts.join(" / "),
    ...(timeLabel === undefined ? {} : { timeLabel }),
    ...(locationLabel === undefined ? {} : { locationLabel }),
  }
}

async function firstLabel(
  refs: readonly string[],
  resolveLabel: GraphLabelResolver,
): Promise<string | undefined> {
  for (const ref of refs) {
    const label = await resolveLabel(ref)
    if (label !== undefined && label.trim().length > 0) return label.trim()
  }
  return refs[0] === undefined ? undefined : shortRef(refs[0])
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.filter((ref) => ref.trim().length > 0))].slice(0, 32)
}

function shortRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length <= 36) return trimmed
  return `${trimmed.slice(0, 33)}…`
}

export function summarizeGraphNodeContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.replace(/\s+/gu, " ").trim()
    return text.length === 0 ? undefined : truncateLabel(text)
  }
  if (content !== null && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    for (const key of ["content", "label", "title", "name", "summary"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim().length > 0) return truncateLabel(value.trim())
    }
  }
  return undefined
}

function truncateLabel(text: string): string {
  return text.length <= 48 ? text : `${text.slice(0, 47)}…`
}
