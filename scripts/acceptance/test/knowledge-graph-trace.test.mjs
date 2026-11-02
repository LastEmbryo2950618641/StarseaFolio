import { describe, expect, it } from "vitest"
import { auditQueryIsolation, parseBenchmarkAnswer, sourceEvidenceFromTrace } from "../lib/knowledge-graph-trace.mjs"

const sourceMap = new Map([
  ["unit-1", { source_key: "ch1", sequence: 1, body: "The key is copper.\n\nLin carries it." }],
  ["unit-2", { source_key: "ch2", sequence: 2, body: "The key was handed to Mei." }],
])
const sourceRead = (overrides = {}) => ({
  readId: "read-1", visibility: "committed", ownerKind: "source", ownerId: "unit-1",
  semanticText: "The key is copper.", digest: "digest-1", ...overrides,
})
const call = (reads = [], messages = []) => ({ request: { input: { readEvidence: reads } }, contextMessages: messages })

describe("benchmark answer parsing", () => {
  it("accepts strict JSON and an outer JSON fence", () => {
    expect(parseBenchmarkAnswer('```json\n{"answer":"copper","abstain":false}\n```')).toEqual({ answer: "copper", abstain: false })
  })
  it.each(["null", "[]", "{}", '{"answer":3,"abstain":false}', '{"answer":"yes","abstain":"false"}', 'Answer: {"answer":"yes","abstain":false}'])("rejects invalid output %s", value => {
    expect(() => parseBenchmarkAnswer(value)).toThrow()
  })
})

describe("actual Source evidence", () => {
  it("counts only supplied original text and deduplicates repeated reads", () => {
    expect(sourceEvidenceFromTrace([call([sourceRead(), sourceRead({ digest: "other" })])], sourceMap))
      .toEqual([{ source_key: "ch1", content: "The key is copper." }])
  })
  it("does not expand graph references into unread original chapters", () => {
    expect(sourceEvidenceFromTrace([call([sourceRead({ ownerKind: "node", sourceRefs: [{ sourceUnitId: "unit-1" }] })])], sourceMap)).toEqual([])
  })
  it.each([
    { ownerId: "missing" }, { semanticText: "invented" }, { semanticText: "" }, { semanticText: null },
  ])("rejects unmapped, forged or empty text %j", overrides => {
    expect(sourceEvidenceFromTrace([call([sourceRead(overrides)])], sourceMap)).toEqual([])
  })
  it("does not award a whole chapter when only one sentence was supplied", () => {
    const evidence = sourceEvidenceFromTrace([call([sourceRead()])], sourceMap)
    expect(evidence[0].content).not.toContain("Lin carries it.")
  })
})

describe("query context isolation", () => {
  it("allows current-task messages and system rules", () => {
    expect(auditQueryIsolation([call([sourceRead()], [{ taskId: "query", kind: "user" }, { taskId: "old", kind: "system_rules" }])], "query", sourceMap, 1).passed).toBe(true)
  })
  it("requires a real model call to be audited", () => {
    expect(auditQueryIsolation([], "query", sourceMap, 1).issues).toContain("no_model_calls_audited")
  })
  it("rejects inherited and canonical chapter messages", () => {
    const result = auditQueryIsolation([call([], [{ taskId: "old", messageId: "old-1", kind: "user" }, { taskId: "query", kind: "canonical_chapter" }])], "query", sourceMap, 1)
    expect(result.issues).toEqual(["inherited_message:old-1", "canonical_chapter_in_context"])
  })
  it.each([
    [sourceRead({ visibility: "pending" }), "uncommitted_evidence:read-1"],
    [sourceRead({ ownerId: "missing" }), "unmapped_source:missing"],
    [sourceRead({ ownerId: "unit-2" }), "future_source:ch2"],
    [sourceRead({ ownerKind: "workspace", ownerId: "chapters/1.md" }), "workspace_chapter_read:chapters/1.md"],
    [sourceRead({ ownerKind: "workspace:chapters", ownerId: "正文/1.md" }), "workspace_chapter_read:正文/1.md"],
  ])("rejects prohibited evidence %j", (read, issue) => {
    expect(auditQueryIsolation([call([read])], "query", sourceMap, 1).issues).toContain(issue)
  })
})
