import { z } from "zod"

import { idSchema } from "./ids.js"

/** UI-facing status for an evolution frontier projection. */
export const evolutionProjectionStatusSchema = z.enum([
  "committed",
  "reached_prose",
  "deferred",
  "archived",
])
export type EvolutionProjectionStatus = z.infer<typeof evolutionProjectionStatusSchema>

export const evolutionProjectionSchema = z.object({
  frontierId: idSchema,
  frontierAnchorRef: z.string().min(1),
  title: z.string().min(1),
  status: evolutionProjectionStatusSchema,
  /** What happened / why this frontier exists. */
  occurrence: z.string().min(1),
  timeLabel: z.string().min(1).optional(),
  locationLabel: z.string().min(1).optional(),
  /** Traceable basis refs (scene / correspondence / etc.). */
  basisRefs: z.array(z.string().min(1)).max(32),
  /** Cognitive / prose impact note for the panel. */
  impact: z.string().min(1),
  revisitCondition: z.string().min(1).optional(),
  lastProcessedAtMs: z.number().int().nonnegative(),
})
export type EvolutionProjection = z.infer<typeof evolutionProjectionSchema>

export const evolutionWorldClockSchema = z.object({
  summary: z.string().min(1),
  timeLabel: z.string().min(1).optional(),
  locationLabel: z.string().min(1).optional(),
})
export type EvolutionWorldClock = z.infer<typeof evolutionWorldClockSchema>

export const worldEvolutionListResultSchema = z.object({
  clock: evolutionWorldClockSchema,
  projections: z.array(evolutionProjectionSchema).max(64),
})
export type WorldEvolutionListResult = z.infer<typeof worldEvolutionListResultSchema>
