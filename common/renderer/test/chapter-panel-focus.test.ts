import { describe, expect, it } from "vitest"

import { chapterPanelFocusFromDistance } from "../src/features/editor/chapter-panel-focus.js"

describe("chapterPanelFocusFromDistance", () => {
  it("peaks at the viewport center and softens toward the edges", () => {
    const center = chapterPanelFocusFromDistance(0, 200)
    const edge = chapterPanelFocusFromDistance(200, 200)
    expect(center.scale).toBeGreaterThan(edge.scale)
    expect(center.opacity).toBeGreaterThan(edge.opacity)
    expect(center.scale).toBeCloseTo(1.07, 3)
    expect(edge.opacity).toBeLessThan(0.6)
  })
})
