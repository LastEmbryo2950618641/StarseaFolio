import { isDeepStrictEqual } from "node:util"

import { summarizeResults } from "./knowledge-graph-evaluation.mjs"

const usageFields = ["modelCalls", "attemptedExecutions", "executionsWithoutReportedUsage", "inputTokens", "outputTokens", "latencyMs"]

export function compareKnowledgeGraphReports(sourceOnly, graph, { assumeLegacyGraph = false } = {}) {
  const assumptions = []
  const b = validateReport(sourceOnly, "B")
  const c = validateReport(graph, "C")
  check(sourceOnly.retrievalMode === "source-only", "B.retrievalMode must be source-only")
  if (graph.retrievalMode === undefined && assumeLegacyGraph === true) {
    assumptions.push({ field: "C.retrievalMode", assumedValue: "graph", reason: "Explicit legacy compatibility opt-in; original report does not declare its mode." })
  } else {
    check(graph.retrievalMode === "graph", "C.retrievalMode must be graph (legacy reports require explicit assumeLegacyGraph)")
  }
  for (const field of ["benchmarkDigest", "bookId", "model", "queryBudget", "annotationStatus"]) {
    check(isDeepStrictEqual(sourceOnly[field], graph[field]), `Reports differ in ${field}`)
  }
  check(isDeepStrictEqual([...b.keys()].sort(), [...c.keys()].sort()), "Reports differ in selectedCaseIds")
  const warnings = [
    "A single paired run on the selected cases does not establish general graph benefit or statistical significance.",
    "Scores are taken from recorded evaluator results; this comparison does not validate annotation truth, Source mapping, or isolation traces.",
    "Build elapsedMs includes Source seeding and indexing; it does not isolate graph construction time. Missing telemetry remains null, not zero.",
    "queryBudget matches model-call, retrieval-round and deadline limits only; actual context token budgets are not controlled. Token usage is an observed outcome.",
    "Response format errors remain in the selected-case denominator and receive zero credit; they do not establish retrieval failure.",
  ]
  if (!isDeepStrictEqual(sourceOnly.code, graph.code)) warnings.push("Code identity differs between reports; observed deltas may include implementation changes.")
  const cases = sourceOnly.selectedCaseIds.map((id) => {
    const baseline = b.get(id)
    const candidate = c.get(id)
    for (const field of ["question", "task_type", "snapshotChapter"]) {
      check(isDeepStrictEqual(baseline[field], candidate[field]), `${id}: reports differ in ${field}`)
    }
    check(baseline.score.answerable === candidate.score.answerable, `${id}: reports differ in answerable`)
    const B = caseResult(baseline)
    const C = caseResult(candidate)
    return {
      case_id: id, task_type: baseline.task_type, question: baseline.question,
      snapshotChapter: baseline.snapshotChapter, answerable: baseline.score.answerable,
      B, C,
      delta: {
        jointCorrect: Number(C.jointCorrect) - Number(B.jointCorrect),
        answerCorrect: Number(C.answerCorrect) - Number(B.answerCorrect),
        evidenceRecall: difference(B.evidenceRecall, C.evidenceRecall),
        elapsedMs: difference(B.elapsedMs, C.elapsedMs),
        usage: numericDelta(B.usage, C.usage),
      },
    }
  })
  const summaries = [sourceOnly, graph].map((report) => summarizeResults(report.results.map((row) => ({
    ...row.score, case_id: row.case_id, book_id: report.bookId, task_type: row.task_type,
  }))))
  const costs = [sourceOnly, graph].map((report) => ({
    build: stageCost(report.builds), query: stageCost(report.results),
  }))
  return {
    version: 1, status: "compared", deltaDirection: "C minus B",
    identity: {
      benchmarkDigest: sourceOnly.benchmarkDigest, bookId: sourceOnly.bookId,
      model: sourceOnly.model, queryBudget: sourceOnly.queryBudget,
      annotationStatus: sourceOnly.annotationStatus, selectedCaseIds: [...sourceOnly.selectedCaseIds],
    },
    modes: { B: "source-only", C: "graph" }, assumptions, warnings,
    metadataProvenance: { B: sourceOnly.supplementedMetadata ?? null, C: graph.supplementedMetadata ?? null },
    cases,
    summary: { B: summaries[0], C: summaries[1], delta: numericDelta(summaries[0], summaries[1]) },
    costs: {
      B: costs[0], C: costs[1], delta: numericDelta(costs[0], costs[1]),
      buildScope: { B: "Source seeding and lexical indexing", C: "Source seeding, lexical indexing and graph construction" },
    },
  }
}

function validateReport(report, label) {
  object(report, label)
  check(report.version === 1, `${label}.version must be 1`)
  check(["measured", "execution_failed"].includes(report.status), `${label}.status must be measured or execution_failed`)
  for (const field of ["benchmarkDigest", "bookId", "annotationStatus"]) text(report[field], `${label}.${field}`)
  object(report.model, `${label}.model`)
  for (const field of ["provider", "name"]) text(report.model[field], `${label}.model.${field}`)
  object(report.queryBudget, `${label}.queryBudget (required; no inferred budget)`)
  for (const field of ["maxModelCalls", "maxRetrievalRounds", "deadlineMs"]) {
    check(Number.isSafeInteger(report.queryBudget[field]) && report.queryBudget[field] > 0, `${label}.queryBudget.${field} must be a positive integer`)
  }
  check(Array.isArray(report.selectedCaseIds) && report.selectedCaseIds.length > 0, `${label}.selectedCaseIds must be nonempty`)
  const selected = new Set()
  for (const id of report.selectedCaseIds) {
    text(id, `${label}.selectedCaseIds[]`)
    check(!selected.has(id), `${label}.selectedCaseIds contains duplicate ${id}`)
    selected.add(id)
  }
  check(Array.isArray(report.results), `${label}.results must be an array`)
  check(Array.isArray(report.builds), `${label}.builds must be an array`)
  for (const build of report.builds) {
    object(build, `${label}.builds[]`)
    telemetry(build, `${label}.builds[]`)
  }
  const rows = new Map()
  for (const row of report.results) {
    object(row, `${label}.results[]`)
    check(selected.has(row.case_id), `${label}: unexpected result ${row.case_id}`)
    check(!rows.has(row.case_id), `${label}: duplicate result ${row.case_id}`)
    text(row.question, `${label}.${row.case_id}.question`)
    text(row.task_type, `${label}.${row.case_id}.task_type`)
    check(Number.isSafeInteger(row.snapshotChapter) && row.snapshotChapter > 0, `${label}.${row.case_id}.snapshotChapter must be positive`)
    object(row.score, `${label}.${row.case_id}.score`)
    const score = row.score
    check(typeof score.answerable === "boolean", `${label}.${row.case_id}.score.answerable must be boolean`)
    if (score.answerable) {
      check(typeof score.evidenceComplete === "boolean", `${label}.${row.case_id}.score.evidenceComplete must be boolean`)
      check(typeof score.evidenceRecall === "number", `${label}.${row.case_id}.score.evidenceRecall must be numeric`)
    } else {
      check(score.evidenceRecall === null && score.evidenceComplete === null, `${label}.${row.case_id}: unknown evidence scores must be null`)
    }
    check(score.contextIsolationPassed === null || typeof score.contextIsolationPassed === "boolean", `${label}.${row.case_id}: invalid context isolation score`)
    const scored = ["pass", "fail"].includes(score.status)
    if (scored) {
      check(score.contextIsolationPassed !== null, `${label}.${row.case_id}: scored result needs explicit isolation`)
      const joint = score.answerCorrect && score.contextIsolationPassed && (!score.answerable || score.evidenceComplete)
      check(score.jointCorrect === joint && (score.status === "pass") === joint, `${label}.${row.case_id}: inconsistent joint score`)
      if (score.answerable) check(score.evidenceComplete === (score.evidenceRecall === 1), `${label}.${row.case_id}: inconsistent evidence score`)
    }
    telemetry(row, `${label}.${row.case_id}`)
    rows.set(row.case_id, row)
  }
  check(rows.size === selected.size, `${label}: missing selected result rows`)
  // Recompute denominators from rows; never trust a cached report.summary.
  summarizeResults(report.results.map((row) => ({ ...row.score, case_id: row.case_id, book_id: report.bookId, task_type: row.task_type })))
  return rows
}

function caseResult(row) {
  const scored = ["pass", "fail"].includes(row.score.status)
  return {
    status: row.score.status,
    answer: typeof row.result?.answer === "string" ? row.result.answer : null,
    abstain: typeof row.result?.abstain === "boolean" ? row.result.abstain : null,
    answerCorrect: scored && row.score.answerCorrect,
    jointCorrect: scored && row.score.jointCorrect,
    evidenceRecall: row.score.answerable ? (scored ? row.score.evidenceRecall : 0) : null,
    evidenceComplete: row.score.answerable ? (scored && row.score.evidenceComplete) : null,
    contextIsolationPassed: row.score.contextIsolationPassed,
    error: typeof row.result?.error === "string" ? row.result.error : null,
    failureKind: failureKind(row),
    issues: row.score.issues ?? [],
    elapsedMs: row.elapsedMs ?? null,
    usage: Object.fromEntries(usageFields.map((key) => [key, row.usage?.[key] ?? null])),
  }
}

function failureKind(row) {
  if (row.score.status === "pass") return null
  if (row.score.status === "error" || row.score.status === "invalid") {
    const message = [row.result?.error, ...(Array.isArray(row.score.issues) ? row.score.issues : [])].filter((item) => typeof item === "string").join("\n")
    return /not valid JSON|Unexpected token|JSON\.parse|JSON (?:object|parse|syntax)/iu.test(message)
      ? "response_format_error" : "execution_or_validation_error"
  }
  return "scored_failure"
}

function stageCost(rows) {
  const total = (values) => values.some((value) => value === undefined) ? null : values.reduce((sum, value) => sum + value, 0)
  return {
    entryCount: rows.length,
    elapsedMs: total(rows.map((row) => row.elapsedMs)),
    usage: Object.fromEntries(usageFields.map((field) => [field, total(rows.map((row) => row.usage?.[field]))])),
  }
}

function telemetry(row, path) {
  if (row.elapsedMs !== undefined) nonnegative(row.elapsedMs, `${path}.elapsedMs`)
  if (row.usage !== undefined) {
    object(row.usage, `${path}.usage`)
    for (const field of usageFields) if (row.usage[field] !== undefined) nonnegative(row.usage[field], `${path}.usage.${field}`)
  }
}

function numericDelta(b, c) {
  return Object.fromEntries(Object.entries(b).flatMap(([key, value]) => {
    if (value === null || typeof value === "number") return [[key, difference(value, c[key])]]
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return [[key, numericDelta(value, c[key])]]
    return []
  }))
}

function difference(b, c) { return b === null || c === null ? null : c - b }
function nonnegative(value, path) { check(typeof value === "number" && Number.isFinite(value) && value >= 0, `${path} must be a finite nonnegative number`) }
function object(value, path) { check(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be an object`) }
function text(value, path) { check(typeof value === "string" && value.trim().length > 0, `${path} must be nonblank text`) }
function check(condition, message) { if (!condition) throw new TypeError(message) }
