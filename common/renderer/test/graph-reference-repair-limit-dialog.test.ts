import { describe, expect, it } from "vitest"

import { isGraphReferenceRepairExhaustedError } from "../src/features/status/graph-reference-repair.js"

describe("isGraphReferenceRepairExhaustedError", () => {
  it("recognizes exhausted graph-reference repair errors", () => {
    expect(isGraphReferenceRepairExhaustedError(
      "DeepSeek response could not satisfy the phase contract: Graph references must be owner IDs read in this turn: 第八章·橄榄林散步",
    )).toBe(true)
    expect(isGraphReferenceRepairExhaustedError("budget exhausted")).toBe(false)
    expect(isGraphReferenceRepairExhaustedError(undefined)).toBe(false)
  })
})
