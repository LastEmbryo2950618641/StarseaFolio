import { describe, expect, it } from "vitest"

import { scoreCase, summarizeResults, validateBenchmark } from "../lib/knowledge-graph-evaluation.mjs"

const firstQuote = { source_key: "chapter-1", quote: "Mira gave the key to Jun." }
const secondQuote = { source_key: "chapter-2", quote: "Jun gave the key to Ren." }
const alternativeQuote = { source_key: "chapter-2", quote: "Ren now holds the key." }

function positive(overrides = {}) {
  return {
    case_id: "current-key",
    task_type: "state_update",
    question: "Who holds the key after chapter two?",
    snapshot_chapter: 2,
    answerable: true,
    reference_answers: ["Ren"],
    evidence_sets_any_of: [{ all_of: [firstQuote, secondQuote] }],
    ...overrides,
  }
}

function unknown(overrides = {}) {
  return positive({
    case_id: "unknown-key",
    task_type: "unknown",
    question: "What is the key made of?",
    answerable: false,
    reference_answers: [],
    evidence_sets_any_of: [],
    ...overrides,
  })
}

function result(overrides = {}) {
  return {
    answer: "Ren",
    abstain: false,
    evidence: [firstQuote, secondQuote].map(({ source_key, quote }) => ({ source_key, content: quote })),
    contextIsolation: { passed: true },
    ...overrides,
  }
}

function benchmark() {
  return globalThis.structuredClone({
    version: 1,
    annotationStatus: "synthetic-unreviewed",
    books: [{
      book_id: "book-a",
      title: "The key",
      split: "dev",
      chapters: [
        { source_key: "chapter-1", sequence: 1, heading: "Arrival", body: firstQuote.quote },
        { source_key: "chapter-2", sequence: 2, heading: "Transfer", body: `${secondQuote.quote} ${alternativeQuote.quote}` },
      ],
      cases: [positive(), unknown()],
    }],
  })
}

function row(testCase, candidate, book_id = "book-a") {
  return { ...scoreCase(testCase, candidate), case_id: testCase.case_id, book_id, task_type: testCase.task_type }
}

describe("knowledge graph benchmark validation", () => {
  it("reports structural counts without upgrading annotation review status", () => {
    const input = benchmark()
    input.books[0].cases[0].evidence_sets_any_of.push({ all_of: [alternativeQuote] })
    const before = globalThis.structuredClone(input)

    expect(validateBenchmark(input)).toEqual({
      version: 1,
      annotationStatus: "synthetic-unreviewed",
      bookCount: 1,
      chapterCount: 2,
      caseCount: 2,
      answerableCount: 1,
      unknownCount: 1,
      evidenceSetCount: 2,
      evidenceQuoteCount: 3,
    })
    expect(input).toEqual(before)
  })

  it("handles an empty corpus and an empty book without invented counts", () => {
    const input = benchmark()
    input.books = []
    expect(validateBenchmark(input)).toMatchObject({ bookCount: 0, caseCount: 0, chapterCount: 0 })
    input.books = [{ book_id: "empty", title: "Empty", split: "dev", chapters: [], cases: [] }]
    expect(validateBenchmark(input)).toMatchObject({ bookCount: 1, caseCount: 0, chapterCount: 0 })
    input.books[0].cases = [unknown()]
    expect(() => validateBenchmark(input)).toThrow(/snapshot_chapter.*out of range/)
  })

  it.each([
    ["unsupported version", (b) => { b.version = 2 }],
    ["missing annotation status", (b) => { delete b.annotationStatus }],
    ["non-array books", (b) => { b.books = {} }],
    ["blank book id", (b) => { b.books[0].book_id = " " }],
    ["invalid title", (b) => { b.books[0].title = 1 }],
    ["blank split", (b) => { b.books[0].split = "" }],
    ["non-array chapters", (b) => { b.books[0].chapters = null }],
    ["non-array cases", (b) => { b.books[0].cases = null }],
    ["missing heading", (b) => { delete b.books[0].chapters[0].heading }],
    ["blank body", (b) => { b.books[0].chapters[0].body = " " }],
    ["string chapter sequence", (b) => { b.books[0].chapters[0].sequence = "1" }],
    ["gapped chapter sequence", (b) => { b.books[0].chapters[1].sequence = 3 }],
    ["boolean string", (b) => { b.books[0].cases[0].answerable = "true" }],
    ["missing question", (b) => { delete b.books[0].cases[0].question }],
    ["blank task type", (b) => { b.books[0].cases[0].task_type = " " }],
    ["missing references", (b) => { b.books[0].cases[0].reference_answers = [] }],
    ["non-string reference", (b) => { b.books[0].cases[0].reference_answers = [42] }],
    ["blank reference", (b) => { b.books[0].cases[0].reference_answers = [" "] }],
    ["missing evidence", (b) => { b.books[0].cases[0].evidence_sets_any_of = [] }],
    ["empty evidence path", (b) => { b.books[0].cases[0].evidence_sets_any_of = [{ all_of: [] }] }],
    ["bad evidence path", (b) => { b.books[0].cases[0].evidence_sets_any_of = [{ all_of: null }] }],
    ["blank quote", (b) => { b.books[0].cases[0].evidence_sets_any_of = [{ all_of: [{ ...firstQuote, quote: " " }] }] }],
    ["unknown references", (b) => { b.books[0].cases[1].reference_answers = ["unknown"] }],
    ["unknown evidence", (b) => { b.books[0].cases[1].evidence_sets_any_of = [{ all_of: [firstQuote] }] }],
  ])("rejects %s", (_, mutate) => {
    const input = benchmark()
    mutate(input)
    expect(() => validateBenchmark(input)).toThrow(TypeError)
  })

  it.each([
    ["book ids", (b) => { b.books.push(globalThis.structuredClone(b.books[0])) }],
    ["case ids within a book", (b) => { b.books[0].cases.push(positive()) }],
    ["case ids across books", (b) => { b.books.push({ ...globalThis.structuredClone(b.books[0]), book_id: "book-b" }) }],
    ["source ids within a book", (b) => { b.books[0].chapters[1].source_key = "chapter-1" }],
    ["sequences", (b) => { b.books[0].chapters[1].sequence = 1 }],
  ])("rejects duplicate %s", (_, mutate) => {
    const input = benchmark()
    mutate(input)
    expect(() => validateBenchmark(input)).toThrow(/duplicate/)
  })

  it("allows book-local source ids and counts distinct required quotes", () => {
    const input = benchmark()
    input.books[0].cases[0].evidence_sets_any_of[0].all_of.push(globalThis.structuredClone(firstQuote))
    const otherBook = globalThis.structuredClone(input.books[0])
    otherBook.book_id = "book-b"
    otherBook.cases.forEach((item) => { item.case_id += "-b" })
    input.books.push(otherBook)
    expect(validateBenchmark(input)).toMatchObject({ bookCount: 2, evidenceQuoteCount: 4 })
  })

  it.each([0, -1, 3, 1.5, "2", Number.NaN, Number.POSITIVE_INFINITY])("rejects snapshot %s", (snapshot) => {
    const input = benchmark()
    input.books[0].cases[0].snapshot_chapter = snapshot
    expect(() => validateBenchmark(input)).toThrow(/snapshot_chapter/)
  })

  it.each([
    [{ source_key: "absent", quote: firstQuote.quote }, /unknown evidence source/],
    [{ ...firstQuote, quote: "Ren was born here." }, /quote is absent/],
    [{ source_key: "chapter-1", quote: secondQuote.quote }, /quote is absent/],
  ])("rejects ungrounded annotation %j", (evidence, message) => {
    const input = benchmark()
    input.books[0].cases[0].evidence_sets_any_of = [{ all_of: [evidence] }]
    expect(() => validateBenchmark(input)).toThrow(message)
  })

  it("rejects later evidence even in an unused alternative and uses sequence rather than array order", () => {
    const input = benchmark()
    input.books[0].chapters.reverse()
    input.books[0].cases[0].snapshot_chapter = 1
    input.books[0].cases[0].evidence_sets_any_of = [{ all_of: [firstQuote] }]
    expect(validateBenchmark(input).caseCount).toBe(2)
    input.books[0].cases[0].evidence_sets_any_of.push({ all_of: [secondQuote] })
    expect(() => validateBenchmark(input)).toThrow(/later than snapshot/)
  })
})

describe("knowledge graph deterministic case scoring", () => {
  it("passes an exact answer and all distinct necessary evidence with explicit isolation", () => {
    expect(scoreCase(positive(), result())).toEqual({
      status: "pass", answerable: true, abstained: false,
      answerCorrect: true, evidenceRecall: 1, evidenceComplete: true,
      matchedEvidenceCount: 2, requiredEvidenceCount: 2, bestEvidenceSetIndex: 0,
      contextIsolationPassed: true, jointCorrect: true, issues: [],
    })
  })

  it("normalizes whitespace only and accepts alternate canonical answers", () => {
    expect(scoreCase(positive({ reference_answers: ["Ren", "Keeper Ren"] }), result({ answer: " \tKeeper\n Ren  " })).status).toBe("pass")
    expect(scoreCase(positive({ reference_answers: ["韩舟"] }), result({ answer: " 韩舟\n" })).status).toBe("pass")
    expect(scoreCase(positive({ reference_answers: ["韩舟"] }), result({ answer: "韩舟。" })).answerCorrect).toBe(false)
  })

  it.each(["It is not Ren, it is Jun.", "Ren or Jun", "Ren and Mira", "Ren.", "ren", "", "Renowned"])("does not pass substring or noncanonical answer %j", (answer) => {
    expect(scoreCase(positive(), result({ answer }))).toMatchObject({
      status: "fail", answerCorrect: false, evidenceComplete: true, jointCorrect: false,
    })
  })

  it("does not let answerable cases abstain even with the correct text", () => {
    expect(scoreCase(positive(), result({ abstain: true }))).toMatchObject({ answerCorrect: false, jointCorrect: false })
  })

  it("reports partial recall and separates answer correctness from evidence correctness", () => {
    const score = scoreCase(positive(), result({ evidence: [result().evidence[0]] }))
    expect(score).toMatchObject({ status: "fail", answerCorrect: true, evidenceRecall: 0.5, evidenceComplete: false, jointCorrect: false })
  })

  it.each([
    { evidence: [] },
    { evidence: [{ source_key: "unknown-source", content: `${firstQuote.quote} ${secondQuote.quote}` }] },
    { evidence: [{ source_key: "chapter-1", content: secondQuote.quote }, { source_key: "chapter-2", content: firstQuote.quote }] },
    { evidence: [{ source_key: "chapter-1", content: "Mira GAVE the key to Jun." }] },
  ])("does not credit missing, unknown, swapped or altered evidence $evidence", ({ evidence }) => {
    expect(scoreCase(positive(), result({ evidence }))).toMatchObject({
      answerCorrect: true, evidenceRecall: 0, evidenceComplete: false, jointCorrect: false,
    })
  })

  it("matches quotes within longer text but never concatenates separate snippets into a quote", () => {
    const testCase = positive({ evidence_sets_any_of: [{ all_of: [firstQuote] }] })
    expect(scoreCase(testCase, result({ evidence: [{ source_key: "chapter-1", content: `Before. ${firstQuote.quote} After.` }] })).status).toBe("pass")
    expect(scoreCase(testCase, result({ evidence: [
      { source_key: "chapter-1", content: "Mira gave the key " },
      { source_key: "chapter-1", content: "to Jun." },
    ] })).evidenceRecall).toBe(0)
  })

  it("does not inflate recall through duplicate annotations or duplicate candidate evidence", () => {
    const testCase = positive({ evidence_sets_any_of: [{ all_of: [firstQuote, firstQuote, secondQuote] }] })
    const evidence = [result().evidence[0], result().evidence[0], result().evidence[0]]
    expect(scoreCase(testCase, result({ evidence }))).toMatchObject({
      evidenceRecall: 0.5, matchedEvidenceCount: 1, requiredEvidenceCount: 2, evidenceComplete: false,
    })
  })

  it("uses the best alternative's own denominator and accepts any complete proof", () => {
    const testCase = positive({ evidence_sets_any_of: [{ all_of: [firstQuote, secondQuote] }, { all_of: [alternativeQuote] }] })
    expect(scoreCase(testCase, result({ evidence: [{ source_key: "chapter-2", content: alternativeQuote.quote }] }))).toMatchObject({
      status: "pass", bestEvidenceSetIndex: 1, requiredEvidenceCount: 1, matchedEvidenceCount: 1, evidenceRecall: 1,
    })
    expect(scoreCase(testCase, result()).status).toBe("pass")
  })

  it("does not combine incomplete proofs and picks greatest fractional coverage rather than hit count", () => {
    const q3 = { source_key: "chapter-3", quote: "Third." }
    const q4 = { source_key: "chapter-4", quote: "Fourth." }
    const testCase = positive({ evidence_sets_any_of: [
      { all_of: [firstQuote, secondQuote, q3, q4] },
      { all_of: [alternativeQuote, q3, q4] },
    ] })
    const evidence = [
      ...result().evidence,
      { source_key: "chapter-2", content: alternativeQuote.quote },
      { source_key: "chapter-3", content: q3.quote },
    ]
    expect(scoreCase(testCase, result({ evidence }))).toMatchObject({
      evidenceRecall: 0.75, bestEvidenceSetIndex: 0, matchedEvidenceCount: 3, requiredEvidenceCount: 4, jointCorrect: false,
    })
    const unequal = positive({ evidence_sets_any_of: [
      { all_of: [firstQuote, secondQuote, q3, q4] }, { all_of: [alternativeQuote] },
    ] })
    expect(scoreCase(unequal, result({ evidence: evidence.filter((item) => item.content !== q3.quote) }))).toMatchObject({
      evidenceRecall: 1, bestEvidenceSetIndex: 1, matchedEvidenceCount: 1, requiredEvidenceCount: 1,
    })
  })

  it("gives unknown questions no evidence score even with made-up citations", () => {
    const negative = result({ answer: " \n", abstain: true, evidence: [{ source_key: "invented", content: "invented" }] })
    expect(scoreCase(unknown(), negative)).toMatchObject({
      status: "pass", answerCorrect: true, jointCorrect: true,
      evidenceRecall: null, evidenceComplete: null, matchedEvidenceCount: null, requiredEvidenceCount: null,
    })
  })

  it.each([
    { answer: "", abstain: false },
    { answer: "Unknown", abstain: true },
    { answer: "Ren", abstain: false },
  ])("requires explicit abstention AND empty answer for unknowns: %j", (overrides) => {
    expect(scoreCase(unknown(), result(overrides))).toMatchObject({ answerCorrect: false, jointCorrect: false, evidenceRecall: null })
  })

  it.each([true, false])("blocks joint correctness when isolation fails (answerable=%s)", (answerable) => {
    const testCase = answerable ? positive() : unknown()
    const candidate = result({ answer: answerable ? "Ren" : "", abstain: !answerable, contextIsolation: { passed: false } })
    expect(scoreCase(testCase, candidate)).toMatchObject({ status: "fail", answerCorrect: true, contextIsolationPassed: false, jointCorrect: false })
  })

  it.each([
    ["answer", null], ["answer", 123], ["abstain", "false"], ["abstain", 0],
    ["evidence", null], ["evidence", {}], ["evidence", [null]],
    ["evidence", [{ source_key: "chapter-1", content: 42 }]],
    ["evidence", [{ source_key: 1, content: firstQuote.quote }]],
    ["contextIsolation", undefined], ["contextIsolation", null],
    ["contextIsolation", { passed: "true" }], ["contextIsolation", { passed: 1 }],
    ["error", false], ["error", null],
  ])("marks malformed result %s=%j invalid", (field, value) => {
    expect(scoreCase(positive(), result({ [field]: value }))).toMatchObject({ status: "invalid", answerCorrect: false, jointCorrect: false })
  })

  it.each(["timeout", ""])("marks supplied execution errors as error even with otherwise perfect output: %j", (error) => {
    expect(scoreCase(positive(), result({ error }))).toMatchObject({ status: "error", answerCorrect: false, jointCorrect: false, evidenceRecall: 0 })
  })

  it("handles malformed cases/results without throwing or passing", () => {
    expect(scoreCase(positive(), null).status).toBe("invalid")
    expect(scoreCase(null, result())).toMatchObject({ status: "invalid", answerable: null, jointCorrect: false })
    expect(scoreCase(positive({ reference_answers: [] }), result()).status).toBe("invalid")
    expect(scoreCase(positive({ evidence_sets_any_of: [{ all_of: [] }] }), result()).status).toBe("invalid")
    expect(scoreCase(unknown(), result({ answer: "", abstain: true, contextIsolation: undefined }))).toMatchObject({
      status: "invalid", jointCorrect: false, evidenceRecall: null,
    })
  })
})

describe("knowledge graph result summaries", () => {
  it("keeps errors and invalids in denominators, separates unknowns and groups by book/type", () => {
    const rows = [
      row(positive(), result()),
      row(positive({ case_id: "partial" }), result({ evidence: [result().evidence[0]] })),
      row(positive({ case_id: "error" }), result({ error: "timeout" })),
      row(positive({ case_id: "invalid" }), result({ contextIsolation: undefined })),
      row(unknown(), result({ answer: "", abstain: true, evidence: [] }), "book-b"),
      row(unknown({ case_id: "hallucination" }), result(), "book-b"),
      row(unknown({ case_id: "unknown-error" }), result({ error: "timeout" }), "book-b"),
    ]
    const summary = summarizeResults(rows)
    expect(summary).toMatchObject({
      totalCount: 7, passCount: 2, failCount: 2, errorCount: 2, invalidCount: 1,
      answerCorrectCount: 3, answerAccuracy: 3 / 7, jointCorrectCount: 2, jointAccuracy: 2 / 7,
      answerable: { count: 4, answerAccuracy: 0.5, jointAccuracy: 0.25, evidenceRecall: 0.375, evidenceCompleteRate: 0.25 },
      unknown: { count: 3, correctAbstentionRate: 1 / 3, jointAccuracy: 1 / 3, evidenceRecall: null, evidenceCompleteRate: null },
    })
    expect(summary.byBook["book-a"]).toMatchObject({ totalCount: 4, jointAccuracy: 0.25, unknown: { count: 0, correctAbstentionRate: null } })
    expect(summary.byBook["book-b"]).toMatchObject({ totalCount: 3, answerable: { count: 0, evidenceRecall: null } })
    expect(summary.byType.state_update.totalCount).toBe(4)
    expect(summary.byType.unknown.totalCount).toBe(3)
    expect(summary.notImplementedMetrics).toEqual(["claimPrecision", "claimRecall", "claimF1", "faithfulness", "citationSupportRate"])
  })

  it("does not grant stale success flags on error/invalid rows any aggregate credit", () => {
    const scored = row(positive(), result())
    const summary = summarizeResults([{ ...scored, status: "error" }])
    expect(summary).toMatchObject({ answerAccuracy: 0, jointAccuracy: 0, answerable: { evidenceRecall: 0, evidenceCompleteRate: 0 } })
  })

  it("distinguishes correct abstention from isolation and reports false abstention on positives", () => {
    const summary = summarizeResults([
      row(positive(), result({ answer: "", abstain: true })),
      row(unknown(), result({ answer: "", abstain: true, contextIsolation: { passed: false } })),
    ])
    expect(summary.answerable.falseAbstentionRate).toBe(1)
    expect(summary.unknown).toMatchObject({ correctAbstentionRate: 1, jointAccuracy: 0 })
  })

  it("returns null rates for no observations and remains JSON serializable", () => {
    const summary = summarizeResults([])
    expect(summary).toMatchObject({
      totalCount: 0, answerAccuracy: null, jointAccuracy: null, byBook: {}, byType: {},
      answerable: { count: 0, evidenceRecall: null, evidenceCompleteRate: null, falseAbstentionRate: null },
      unknown: { count: 0, correctAbstentionRate: null, evidenceRecall: null },
    })
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary)
  })

  it("includes an unclassifiable invalid case in overall denominators only", () => {
    const invalid = { ...scoreCase(null, null), case_id: "broken", book_id: "book-a", task_type: "broken" }
    expect(summarizeResults([invalid])).toMatchObject({
      totalCount: 1, invalidCount: 1, unclassifiedCount: 1, jointAccuracy: 0,
      answerable: { count: 0 }, unknown: { count: 0 },
    })
  })

  it("handles object prototype names as group keys", () => {
    const input = row(positive({ task_type: "__proto__" }), result(), "constructor")
    const summary = summarizeResults([input])
    expect(summary.byBook.constructor.totalCount).toBe(1)
    expect(summary.byType.__proto__.jointAccuracy).toBe(1)
  })

  it("rejects duplicate case rows and malformed summary input instead of silently dropping them", () => {
    const scored = row(positive(), result())
    expect(() => summarizeResults([scored, scored])).toThrow(/duplicate/)
    expect(() => summarizeResults(null)).toThrow(TypeError)
    expect(() => summarizeResults([{ ...scored, evidenceRecall: Number.NaN }])).toThrow(/evidenceRecall/)
    expect(() => summarizeResults([{ ...scored, status: "success" }])).toThrow(/status/)
  })
})
