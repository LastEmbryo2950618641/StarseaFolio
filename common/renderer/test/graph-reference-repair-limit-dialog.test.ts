import { describe, expect, it } from "vitest"

import {
  isGraphReferenceRepairExhaustedError,
  parseInvalidGraphReferenceLabels,
} from "../src/features/status/graph-reference-repair.js"

describe("graph reference repair helpers", () => {
  it("recognizes exhausted graph-reference repair errors", () => {
    expect(isGraphReferenceRepairExhaustedError(
      "DeepSeek response could not satisfy the phase contract: Graph references must be owner IDs read in this turn: 第八章·橄榄林散步",
    )).toBe(true)
    expect(isGraphReferenceRepairExhaustedError("budget exhausted")).toBe(false)
    expect(isGraphReferenceRepairExhaustedError(undefined)).toBe(false)
  })

  it("parses illegal reference labels for the dialog list", () => {
    expect(parseInvalidGraphReferenceLabels(
      "DeepSeek response could not satisfy the phase contract: Graph references must be owner IDs read in this turn: 第八章·橄榄林散步, 雅典娜教徒连走高跟鞋, 第九章午后",
    )).toEqual(["第八章·橄榄林散步", "雅典娜教徒连走高跟鞋", "第九章午后"])
    expect(parseInvalidGraphReferenceLabels("unrelated")).toEqual([])
  })
})
