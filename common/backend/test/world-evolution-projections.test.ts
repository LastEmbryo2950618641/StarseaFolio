import { describe, expect, it } from "vitest"

import {
  buildWorldEvolutionListResult,
  summarizeGraphNodeContent,
} from "../src/application/world/world-evolution-projections.js"
import type { FrontierRecord } from "../src/application/turns/ports/turn-persistence.js"

const baseFrontier = (overrides: Partial<FrontierRecord> = {}): FrontierRecord => ({
  id: "frontier_1",
  projectId: "project_1",
  scopeId: "scope_1",
  frontierAnchorRef: "node_scene",
  disposition: "active",
  lastSceneAnchorRefs: ["node_scene"],
  lastTimeAnchorRefs: ["node_time"],
  lastLocationAnchorRefs: ["node_place"],
  correspondenceRefs: ["node_clue"],
  lastProcessedAt: 1_700_000_000_000,
  reason: "旧港通行限制扩大到内河码头",
  ...overrides,
})

describe("world evolution projections", () => {
  it("summarizes string and object graph content", () => {
    expect(summarizeGraphNodeContent("  旧港码头  ")).toBe("旧港码头")
    expect(summarizeGraphNodeContent({ title: "盐雾城历·第 42 日" })).toBe("盐雾城历·第 42 日")
    expect(summarizeGraphNodeContent({})).toBeUndefined()
  })

  it("maps active frontiers to committed projections and builds a clock", async () => {
    const labels: Record<string, string> = {
      node_scene: "盐雾城局部",
      node_time: "第 42 日 18:20",
      node_place: "旧港",
    }
    const result = await buildWorldEvolutionListResult({
      frontiers: [baseFrontier()],
      resolveLabel: async (ref) => labels[ref],
    })
    expect(result.clock.summary).toBe("第 42 日 18:20 / 旧港")
    expect(result.projections).toEqual([expect.objectContaining({
      title: "盐雾城局部",
      status: "committed",
      occurrence: "旧港通行限制扩大到内河码头",
      timeLabel: "第 42 日 18:20",
      locationLabel: "旧港",
      impact: "已提交到世界图；主角是否接触取决于后续正文",
    })])
  })

  it("marks deferred frontiers and related anchors as reached_prose", async () => {
    const deferred = await buildWorldEvolutionListResult({
      frontiers: [baseFrontier({
        id: "frontier_deferred",
        disposition: "deferred",
        revisitCondition: "主角进入东侧渡口",
      })],
      resolveLabel: async () => undefined,
    })
    expect(deferred.projections[0]).toMatchObject({
      status: "deferred",
      impact: "主角进入东侧渡口",
      revisitCondition: "主角进入东侧渡口",
    })

    const reached = await buildWorldEvolutionListResult({
      frontiers: [baseFrontier({ id: "frontier_related" })],
      relatedAnchorIds: ["node_clue"],
      resolveLabel: async () => undefined,
    })
    expect(reached.projections[0]?.status).toBe("reached_prose")
  })
})
