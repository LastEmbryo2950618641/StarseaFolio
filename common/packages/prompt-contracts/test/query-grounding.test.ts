import { describe, expect, it } from "vitest"
import { assertPhaseReferenceContract, responseReviewArtifactSchema } from "../src/index.js"

const review = {
  evidenceClosed: true,
  leaksUnobservedInformation: false,
  requiresWorkflowUpgrade: false,
  queryGrounding: {
    answerDisposition: "supported",
    constraints: [{
      condition: "Custodian on opening day, not the current custodian",
      kind: "fact",
      status: "supported",
      evidenceRefs: ["evidence_1"],
      reason: "The evidence describes the requested event",
    }],
  },
}

describe("query answer grounding", () => {
  it("preserves the structured question-condition audit", () => {
    expect(responseReviewArtifactSchema.parse(review)).toEqual(review)
  })

  it("rejects evidence IDs that the query reviewer did not read", () => {
    expect(() => {
      assertPhaseReferenceContract("response_review", review, {
        readableGraphIds: new Set(), readableEvidenceIds: new Set(), readableWorkspacePaths: new Set(),
      })
    }).toThrow(/Read evidence references/u)
  })

  it("accepts a visible query-grounding reference", () => {
    expect(() => {
      assertPhaseReferenceContract("response_review", review, {
        readableGraphIds: new Set(), readableEvidenceIds: new Set(["evidence_1"]), readableWorkspacePaths: new Set(),
      })
    }).not.toThrow()
  })
})
