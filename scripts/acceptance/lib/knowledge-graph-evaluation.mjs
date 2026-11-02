// Structural validation checks annotations against frozen text, not their factual truth.
export function validateBenchmark(benchmark) {
  object(benchmark, "benchmark")
  requireThat(benchmark.version === 1, "benchmark.version must be 1")
  text(benchmark.annotationStatus, "benchmark.annotationStatus")
  array(benchmark.books, "benchmark.books")
  const summary = {
    version: 1,
    annotationStatus: benchmark.annotationStatus,
    bookCount: benchmark.books.length,
    chapterCount: 0,
    caseCount: 0,
    answerableCount: 0,
    unknownCount: 0,
    evidenceSetCount: 0,
    evidenceQuoteCount: 0,
  }
  const bookIds = new Set()
  const caseIds = new Set()
  for (const [bookIndex, book] of benchmark.books.entries()) {
    const path = `benchmark.books[${bookIndex}]`
    object(book, path)
    uniqueId(book.book_id, bookIds, `${path}.book_id`)
    text(book.title, `${path}.title`)
    text(book.split, `${path}.split`)
    array(book.chapters, `${path}.chapters`)
    array(book.cases, `${path}.cases`)
    const chapters = new Map()
    const sequences = new Set()
    for (const [index, chapter] of book.chapters.entries()) {
      const chapterPath = `${path}.chapters[${index}]`
      object(chapter, chapterPath)
      text(chapter.source_key, `${chapterPath}.source_key`)
      requireThat(!chapters.has(chapter.source_key), `${chapterPath}.source_key is duplicate`)
      positiveInteger(chapter.sequence, `${chapterPath}.sequence`)
      requireThat(chapter.sequence <= book.chapters.length, `${chapterPath}.sequence must be in 1..chapterCount`)
      requireThat(!sequences.has(chapter.sequence), `${chapterPath}.sequence is duplicate`)
      string(chapter.heading, `${chapterPath}.heading`)
      text(chapter.body, `${chapterPath}.body`)
      chapters.set(chapter.source_key, chapter)
      sequences.add(chapter.sequence)
    }
    summary.chapterCount += chapters.size
    for (const [index, testCase] of book.cases.entries()) {
      const casePath = `${path}.cases[${index}]`
      validateCase(testCase, casePath)
      uniqueId(testCase.case_id, caseIds, `${casePath}.case_id`)
      requireThat(testCase.snapshot_chapter <= chapters.size, `${casePath}.snapshot_chapter is out of range`)
      summary.caseCount += 1
      summary[testCase.answerable ? "answerableCount" : "unknownCount"] += 1
      summary.evidenceSetCount += testCase.evidence_sets_any_of.length
      for (const evidenceSet of testCase.evidence_sets_any_of) {
        const required = distinctQuotes(evidenceSet.all_of)
        summary.evidenceQuoteCount += required.length
        for (const evidence of required) {
          const chapter = chapters.get(evidence.source_key)
          requireThat(chapter !== undefined, `${casePath}: unknown evidence source ${evidence.source_key}`)
          requireThat(chapter.sequence <= testCase.snapshot_chapter, `${casePath}: evidence source is later than snapshot`)
          requireThat(chapter.body.includes(evidence.quote), `${casePath}: quote is absent from source ${evidence.source_key}`)
        }
      }
    }
  }
  return summary
}

/**
 * Call validateBenchmark first. Source keys are scoped to a book; case IDs are global.
 * Chapters have contiguous 1-based sequences; snapshot_chapter is an inclusive cutoff.
 * Answers use trim + collapsed whitespace only: punctuation, case and Unicode remain
 * significant. Evidence quotes use exact substring matching within a single mapped
 * source item. Unannotated citations earn no credit; citation precision is not measured.
 * This function cannot independently audit source mapping or model context isolation.
 */
export function scoreCase(testCase, result) {
  const score = {
    status: "invalid",
    answerable: typeof testCase?.answerable === "boolean" ? testCase.answerable : null,
    abstained: typeof result?.abstain === "boolean" ? result.abstain : null,
    answerCorrect: false,
    evidenceRecall: testCase?.answerable === true ? 0 : null,
    evidenceComplete: testCase?.answerable === true ? false : null,
    matchedEvidenceCount: testCase?.answerable === true ? 0 : null,
    requiredEvidenceCount: null,
    bestEvidenceSetIndex: null,
    contextIsolationPassed: null,
    jointCorrect: false,
    issues: [],
  }
  try {
    validateCase(testCase, "testCase")
    object(result, "result")
    if (result.error !== undefined) {
      string(result.error, "result.error")
      score.status = "error"
      score.issues.push(result.error || "result.error was supplied")
      return score
    }
    string(result.answer, "result.answer")
    requireThat(typeof result.abstain === "boolean", "result.abstain must be boolean")
    array(result.evidence, "result.evidence")
    for (const [index, evidence] of result.evidence.entries()) {
      object(evidence, `result.evidence[${index}]`)
      text(evidence.source_key, `result.evidence[${index}].source_key`)
      string(evidence.content, `result.evidence[${index}].content`)
    }
    object(result.contextIsolation, "result.contextIsolation (explicit audit required)")
    requireThat(typeof result.contextIsolation.passed === "boolean", "result.contextIsolation.passed must be boolean")
  } catch (error) {
    score.issues.push(error.message)
    return score
  }

  score.contextIsolationPassed = result.contextIsolation.passed
  const answer = normalizeAnswer(result.answer)
  score.answerCorrect = testCase.answerable
    ? !result.abstain && testCase.reference_answers.some((reference) => normalizeAnswer(reference) === answer)
    : result.abstain && answer === ""
  if (testCase.answerable) {
    // Score each proof independently. Mixing fragments from alternatives cannot form
    // a complete proof, and duplicate returned items cannot increase coverage.
    const candidates = distinctQuotes(result.evidence.map((item) => ({ source_key: item.source_key, quote: item.content })))
    for (const [index, evidenceSet] of testCase.evidence_sets_any_of.entries()) {
      const required = distinctQuotes(evidenceSet.all_of)
      const matched = required.filter((reference) => candidates.some((candidate) =>
        candidate.source_key === reference.source_key && candidate.quote.includes(reference.quote))).length
      const recall = matched / required.length
      if (score.bestEvidenceSetIndex === null || recall > score.evidenceRecall) {
        score.bestEvidenceSetIndex = index
        score.matchedEvidenceCount = matched
        score.requiredEvidenceCount = required.length
        score.evidenceRecall = recall
      }
    }
    score.evidenceComplete = score.evidenceRecall === 1
  }
  score.jointCorrect = score.answerCorrect && score.contextIsolationPassed
    && (!testCase.answerable || score.evidenceComplete)
  score.status = score.jointCorrect ? "pass" : "fail"
  if (!score.answerCorrect) score.issues.push("incorrect_answer_or_abstention")
  if (testCase.answerable && !score.evidenceComplete) score.issues.push("incomplete_evidence")
  if (!score.contextIsolationPassed) score.issues.push("context_isolation_failed")
  return score
}

/** Invalid/error rows stay in all applicable denominators and contribute zero credit.
 * Empty denominators are null. Evidence recall is a macro average over positives only.
 */
export function summarizeResults(rows) {
  array(rows, "rows")
  const caseIds = new Set()
  for (const [index, row] of rows.entries()) {
    const path = `rows[${index}]`
    object(row, path)
    uniqueId(row.case_id, caseIds, `${path}.case_id`)
    text(row.book_id, `${path}.book_id`)
    text(row.task_type, `${path}.task_type`)
    requireThat(["pass", "fail", "invalid", "error"].includes(row.status), `${path}.status is invalid`)
    requireThat(row.answerable === null || typeof row.answerable === "boolean", `${path}.answerable is invalid`)
    for (const field of ["answerCorrect", "jointCorrect"]) {
      requireThat(typeof row[field] === "boolean", `${path}.${field} must be boolean`)
    }
    requireThat(row.evidenceRecall === null || (typeof row.evidenceRecall === "number"
      && Number.isFinite(row.evidenceRecall) && row.evidenceRecall >= 0 && row.evidenceRecall <= 1), `${path}.evidenceRecall is invalid`)
  }
  return {
    ...summarizeGroup(rows),
    byBook: groupResults(rows, "book_id"),
    byType: groupResults(rows, "task_type"),
    notImplementedMetrics: ["claimPrecision", "claimRecall", "claimF1", "faithfulness", "citationSupportRate"],
  }
}

function summarizeGroup(rows) {
  const positive = rows.filter((row) => row.answerable === true)
  const unknown = rows.filter((row) => row.answerable === false)
  const scored = (row) => row.status === "pass" || row.status === "fail"
  const count = (items, predicate) => items.filter((row) => scored(row) && predicate(row)).length
  const answerCorrectCount = count(rows, (row) => row.answerCorrect)
  const jointCorrectCount = count(rows, (row) => row.jointCorrect)
  const positiveAnswers = count(positive, (row) => row.answerCorrect)
  const completeEvidence = count(positive, (row) => row.evidenceComplete === true)
  const correctAbstentions = count(unknown, (row) => row.answerCorrect)
  return {
    totalCount: rows.length,
    passCount: rows.filter((row) => row.status === "pass").length,
    failCount: rows.filter((row) => row.status === "fail").length,
    invalidCount: rows.filter((row) => row.status === "invalid").length,
    errorCount: rows.filter((row) => row.status === "error").length,
    unclassifiedCount: rows.filter((row) => row.answerable === null).length,
    answerCorrectCount,
    answerAccuracy: ratio(answerCorrectCount, rows.length),
    jointCorrectCount,
    jointAccuracy: ratio(jointCorrectCount, rows.length),
    answerable: {
      count: positive.length,
      answerAccuracy: ratio(positiveAnswers, positive.length),
      jointAccuracy: ratio(count(positive, (row) => row.jointCorrect), positive.length),
      evidenceRecall: ratio(positive.reduce((sum, row) => sum + (scored(row) ? row.evidenceRecall ?? 0 : 0), 0), positive.length),
      evidenceCompleteRate: ratio(completeEvidence, positive.length),
      falseAbstentionRate: ratio(positive.filter((row) => row.abstained === true).length, positive.length),
    },
    unknown: {
      count: unknown.length,
      correctAbstentionRate: ratio(correctAbstentions, unknown.length),
      jointAccuracy: ratio(count(unknown, (row) => row.jointCorrect), unknown.length),
      evidenceRecall: null,
      evidenceCompleteRate: null,
    },
  }
}

function groupResults(rows, field) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row[field])) groups.set(row[field], [])
    groups.get(row[field]).push(row)
  }
  return Object.fromEntries([...groups].map(([key, items]) => [key, summarizeGroup(items)]))
}

function validateCase(testCase, path) {
  object(testCase, path)
  text(testCase.case_id, `${path}.case_id`)
  text(testCase.task_type, `${path}.task_type`)
  text(testCase.question, `${path}.question`)
  positiveInteger(testCase.snapshot_chapter, `${path}.snapshot_chapter`)
  requireThat(typeof testCase.answerable === "boolean", `${path}.answerable must be boolean`)
  array(testCase.reference_answers, `${path}.reference_answers`)
  for (const answer of testCase.reference_answers) text(answer, `${path}.reference_answers[]`)
  array(testCase.evidence_sets_any_of, `${path}.evidence_sets_any_of`)
  if (testCase.answerable) {
    requireThat(testCase.reference_answers.length > 0, `${path}: answerable case needs reference answers`)
    requireThat(testCase.evidence_sets_any_of.length > 0, `${path}: answerable case needs necessary evidence`)
  } else {
    requireThat(testCase.reference_answers.length === 0, `${path}: unknown case must have no reference answers`)
    requireThat(testCase.evidence_sets_any_of.length === 0, `${path}: unknown case must have no evidence sets`)
  }
  for (const [index, evidenceSet] of testCase.evidence_sets_any_of.entries()) {
    const setPath = `${path}.evidence_sets_any_of[${index}]`
    object(evidenceSet, setPath)
    array(evidenceSet.all_of, `${setPath}.all_of`)
    requireThat(evidenceSet.all_of.length > 0, `${setPath}.all_of must not be empty`)
    for (const evidence of evidenceSet.all_of) {
      object(evidence, `${setPath}.all_of[]`)
      text(evidence.source_key, `${setPath}.source_key`)
      text(evidence.quote, `${setPath}.quote`)
    }
  }
}

function distinctQuotes(items) {
  return [...new Map(items.map((item) => [JSON.stringify([item.source_key, item.quote]), item])).values()]
}

function normalizeAnswer(value) {
  return value.trim().replace(/\s+/gu, " ")
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function uniqueId(value, ids, path) {
  text(value, path)
  requireThat(!ids.has(value), `${path} is duplicate: ${value}`)
  ids.add(value)
}

function object(value, path) {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be an object`)
}

function string(value, path) {
  requireThat(typeof value === "string", `${path} must be a string`)
}

function text(value, path) {
  string(value, path)
  requireThat(value.trim().length > 0, `${path} must not be blank`)
}

function array(value, path) {
  requireThat(Array.isArray(value), `${path} must be an array`)
}

function positiveInteger(value, path) {
  requireThat(Number.isSafeInteger(value) && value > 0, `${path} must be a positive integer`)
}

function requireThat(condition, message) {
  if (!condition) throw new TypeError(message)
}
