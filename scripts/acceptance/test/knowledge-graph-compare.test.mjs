import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { afterEach, describe, expect, it } from "vitest"

import { compareKnowledgeGraphReports } from "../lib/knowledge-graph-comparison.mjs"
import { scoreCase } from "../lib/knowledge-graph-evaluation.mjs"

const positive = {
  case_id: "positive", task_type: "multi_hop", question: "Who?", snapshot_chapter: 2,
  answerable: true, reference_answers: ["Lin"], evidence_sets_any_of: [{ all_of: [
    { source_key: "s1", quote: "alias" }, { source_key: "s2", quote: "owner" },
  ] }],
}
const unknown = { ...positive, case_id: "unknown", task_type: "unknown", question: "Future?", answerable: false, reference_answers: [], evidence_sets_any_of: [] }
const usage = { modelCalls: 2, attemptedExecutions: 2, executionsWithoutReportedUsage: 0, inputTokens: 100, outputTokens: 20, latencyMs: 8 }
const correct = { answer: "Lin", abstain: false, evidence: [{ source_key: "s1", content: "alias" }, { source_key: "s2", content: "owner" }], contextIsolation: { passed: true } }

function row(testCase, result = correct) {
  return {
    case_id: testCase.case_id, task_type: testCase.task_type, question: testCase.question,
    snapshotChapter: testCase.snapshot_chapter, result: globalThis.structuredClone(result),
    score: scoreCase(testCase, result), elapsedMs: 10, usage: { ...usage },
  }
}

function pair() {
  const report = {
    version: 1, status: "measured", benchmarkDigest: "digest", bookId: "book",
    model: { provider: "test", name: "model", contextWindowTokens: 1000 },
    queryBudget: { maxModelCalls: 30, maxRetrievalRounds: 10, deadlineMs: 300000 },
    annotationStatus: "model_authored_pending_human_review", code: { head: "same" },
    selectedCaseIds: ["positive", "unknown"],
    builds: [{ elapsedMs: 30, usage: { ...usage } }],
    results: [row(positive), row(unknown, { ...correct, answer: "", abstain: true, evidence: [] })],
  }
  return [globalThis.structuredClone({ ...report, retrievalMode: "source-only" }), globalThis.structuredClone({ ...report, retrievalMode: "graph" })]
}

describe("knowledge graph paired comparison", () => {
  it("pairs by ID despite differing result order and recomputes summaries", () => {
    const [b, c] = pair()
    b.results[0] = row(positive, { ...correct, evidence: [correct.evidence[0]] })
    c.selectedCaseIds.reverse()
    c.results.reverse()
    b.summary = { jointAccuracy: 99 }
    const before = globalThis.structuredClone([b, c])
    const result = compareKnowledgeGraphReports(b, c)
    expect(result.cases[0]).toMatchObject({ case_id: "positive", B: { answerCorrect: true, jointCorrect: false, evidenceRecall: 0.5 }, C: { jointCorrect: true }, delta: { jointCorrect: 1, answerCorrect: 0, evidenceRecall: 0.5 } })
    expect(result.summary).toMatchObject({ B: { totalCount: 2, jointAccuracy: 0.5 }, C: { jointAccuracy: 1 }, delta: { jointAccuracy: 0.5 } })
    expect(result.cases[1]).toMatchObject({ answerable: false, B: { evidenceRecall: null, evidenceComplete: null }, delta: { evidenceRecall: null } })
    expect(result.summary.B.unknown.evidenceRecall).toBeNull()
    expect([b, c]).toEqual(before)
  })

  it("keeps JSON contract errors in denominators and distinguishes them from retrieval failure", () => {
    const [b, c] = pair()
    b.status = "execution_failed"
    b.results[0] = row(positive, { error: "Unexpected token 'L', Lin is not valid JSON" })
    const result = compareKnowledgeGraphReports(b, c)
    expect(result.cases[0].B).toMatchObject({ status: "error", answer: null, jointCorrect: false, answerCorrect: false, evidenceRecall: 0, failureKind: "response_format_error" })
    expect(result.summary.B).toMatchObject({ totalCount: 2, errorCount: 1, answerAccuracy: 0.5, jointAccuracy: 0.5, answerable: { count: 1, evidenceRecall: 0 } })
    expect(result.warnings.join(" ")).toContain("do not establish retrieval failure")
  })

  it("gives error and invalid rows no credit even if recorded booleans claim success", () => {
    for (const status of ["error", "invalid"]) {
      const [b, c] = pair()
      b.results[0].score.status = status
      const result = compareKnowledgeGraphReports(b, c)
      expect(result.cases[0].B).toMatchObject({ answerCorrect: false, jointCorrect: false, evidenceRecall: 0, failureKind: "execution_or_validation_error" })
      expect(result.summary.B.jointAccuracy).toBe(0.5)
    }
  })

  it("records incorrect abstention and failed isolation independently", () => {
    const [b, c] = pair()
    b.results[1] = row(unknown, correct)
    c.results[0] = row(positive, { ...correct, contextIsolation: { passed: false } })
    const result = compareKnowledgeGraphReports(b, c)
    expect(result.cases[0].C).toMatchObject({ answerCorrect: true, evidenceComplete: true, jointCorrect: false, contextIsolationPassed: false })
    expect(result.cases[1]).toMatchObject({ B: { abstain: false, answerCorrect: false }, delta: { answerCorrect: 1, jointCorrect: 1 } })
  })

  it("separates build and query time and usage with signed C-minus-B deltas", () => {
    const [b, c] = pair()
    c.builds.push({ elapsedMs: 50, usage: { ...usage, executionsWithoutReportedUsage: 1 } })
    c.results[0].elapsedMs = 5
    c.results[0].usage.inputTokens = 80
    const result = compareKnowledgeGraphReports(b, c)
    expect(result.costs).toMatchObject({
      B: { build: { elapsedMs: 30 }, query: { elapsedMs: 20, usage: { inputTokens: 200 } } },
      C: { build: { elapsedMs: 80, usage: { executionsWithoutReportedUsage: 1 } }, query: { elapsedMs: 15 } },
      delta: { build: { elapsedMs: 50 }, query: { elapsedMs: -5, usage: { inputTokens: -20 } } },
    })
    expect(result.warnings.join(" ")).toContain("actual context token budgets are not controlled")
    expect(result.warnings.join(" ")).toContain("does not establish general graph benefit")
  })

  it("preserves absent telemetry as null and does not fabricate savings", () => {
    const [b, c] = pair()
    delete b.results[0].usage
    delete b.results[0].elapsedMs
    b.builds = []
    const result = compareKnowledgeGraphReports(b, c)
    expect(result.costs.B.query).toMatchObject({ elapsedMs: null, usage: { inputTokens: null } })
    expect(result.costs.delta.query).toMatchObject({ elapsedMs: null, usage: { inputTokens: null } })
    expect(result.costs.B.build).toMatchObject({ entryCount: 0, elapsedMs: 0 })
  })

  it("requires opt-in for legacy mode, records its assumption and propagates sidecar provenance", () => {
    const [b, c] = pair()
    delete c.retrievalMode
    expect(() => compareKnowledgeGraphReports(b, c)).toThrow("retrievalMode")
    const compatible = compareKnowledgeGraphReports(b, c, { assumeLegacyGraph: true })
    expect(compatible.assumptions).toEqual([expect.objectContaining({ field: "C.retrievalMode", assumedValue: "graph" })])
    c.retrievalMode = "graph"
    c.supplementedMetadata = { originalReport: "report.json", verified: true }
    expect(compareKnowledgeGraphReports(b, c).metadataProvenance.C).toEqual(c.supplementedMetadata)
  })

  it.each(["benchmarkDigest", "bookId", "annotationStatus", "model", "queryBudget"])("rejects mismatched %s", (field) => {
    const [b, c] = pair()
    if (field === "model") c.model.name = "other"
    else if (field === "queryBudget") c.queryBudget.deadlineMs++
    else c[field] = "other"
    expect(() => compareKnowledgeGraphReports(b, c)).toThrow(field)
  })

  it.each(["maxModelCalls", "maxRetrievalRounds", "deadlineMs"])("rejects mismatched %s limits", (field) => {
    const [b, c] = pair()
    c.queryBudget[field]++
    expect(() => compareKnowledgeGraphReports(b, c)).toThrow("queryBudget")
  })

  it.each([undefined, null, {}, { maxModelCalls: "30", maxRetrievalRounds: 10, deadlineMs: 1 }])("never infers a missing or invalid budget: %j", (budget) => {
    const [b, c] = pair()
    c.queryBudget = budget
    delete c.retrievalMode
    expect(() => compareKnowledgeGraphReports(b, c, { assumeLegacyGraph: true })).toThrow("queryBudget")
  })

  it.each([
    ["mode", (r) => { r.retrievalMode = "source-only" }, "retrievalMode"],
    ["running", (r) => { r.status = "running" }, "status"],
    ["blocked", (r) => { r.status = "blocked" }, "status"],
    ["empty", (r) => { r.selectedCaseIds = [] }, "nonempty"],
    ["duplicate selection", (r) => { r.selectedCaseIds.push("positive") }, "duplicate"],
    ["missing row", (r) => { r.results.pop() }, "missing"],
    ["duplicate row", (r) => { r.results.push(r.results[0]) }, "duplicate"],
    ["unexpected row", (r) => { r.results[0].case_id = "other" }, "unexpected"],
    ["different selection", (r) => { r.selectedCaseIds[0] = "other"; r.results[0].case_id = "other" }, "selectedCaseIds"],
    ["question", (r) => { r.results[0].question = "Different?" }, "question"],
    ["snapshot", (r) => { r.results[0].snapshotChapter++ }, "snapshotChapter"],
    ["type", (r) => { r.results[0].task_type = "alias" }, "task_type"],
    ["unknown citation credit", (r) => { r.results[1].score.evidenceRecall = 1 }, "unknown evidence"],
    ["unclassified", (r) => { r.results[0].score.answerable = null }, "answerable"],
    ["false pass", (r) => { r.results[0].score.jointCorrect = false }, "joint score"],
    ["absent isolation", (r) => { r.results[0].score.contextIsolationPassed = null }, "isolation"],
    ["invalid recall", (r) => { r.results[0].score.evidenceRecall = 2 }, "evidence"],
    ["negative cost", (r) => { r.results[0].elapsedMs = -1 }, "nonnegative"],
    ["string tokens", (r) => { r.builds[0].usage.inputTokens = "100" }, "nonnegative"],
  ])("rejects %s", (_name, change, message) => {
    const [b, c] = pair()
    change(c)
    expect(() => compareKnowledgeGraphReports(b, c)).toThrow(message)
  })

  it("warns about different code without silently asserting a controlled code baseline", () => {
    const [b, c] = pair()
    c.code.head = "different"
    expect(compareKnowledgeGraphReports(b, c).warnings.join(" ")).toContain("Code identity differs")
  })
})

const directories = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe("knowledge graph comparison CLI", () => {
  const script = resolve("scripts/acceptance/knowledge-graph-compare.mjs")
  function files() {
    const directory = mkdtempSync(join(tmpdir(), "worldseed-kg-compare-"))
    directories.push(directory)
    const paths = [join(directory, "b.json"), join(directory, "c.json")]
    const reports = pair()
    reports.forEach((report, index) => writeFileSync(paths[index], JSON.stringify(report)))
    return { directory, paths, reports }
  }

  it("writes an independent comparison with both absolute report paths", () => {
    const { directory, paths } = files()
    const before = paths.map((path) => readFileSync(path, "utf8"))
    const output = join(directory, "nested", "comparison.json")
    const printed = execFileSync(process.execPath, [script, ...paths, "--output", output], { encoding: "utf8" })
    const result = JSON.parse(printed)
    expect(result.status).toBe("compared")
    expect(result.reportPaths).toEqual({ B: paths[0], C: paths[1] })
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(result)
    expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(before)
  })

  it("rejects incomplete reports and missing budget without emitting a comparison", () => {
    const { paths, reports } = files()
    delete reports[1].queryBudget
    writeFileSync(paths[1], JSON.stringify(reports[1]))
    const result = spawnSync(process.execPath, [script, ...paths, "--assume-legacy-graph"], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr)).toMatchObject({ status: "incomparable", error: expect.stringContaining("queryBudget") })
  })

  it("never overwrites either input report or an existing output", () => {
    const { paths } = files()
    const before = readFileSync(paths[0], "utf8")
    const result = spawnSync(process.execPath, [script, ...paths, "--output", paths[0]], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(readFileSync(paths[0], "utf8")).toBe(before)
    const directory = directories.at(-1)
    const output = join(directory, "existing.json")
    writeFileSync(output, "preserved")
    expect(spawnSync(process.execPath, [script, ...paths, "--output", output], { encoding: "utf8" }).status).toBe(1)
    expect(readFileSync(output, "utf8")).toBe("preserved")
  })
})
