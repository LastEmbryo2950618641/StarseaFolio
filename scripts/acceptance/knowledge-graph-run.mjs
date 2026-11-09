import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, join, dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { execFileSync } from "node:child_process"
import process from "node:process"
import console from "node:console"
import { validateBenchmark, scoreCase, summarizeResults } from "./lib/knowledge-graph-evaluation.mjs"
import { auditQueryIsolation, parseBenchmarkAnswer, sha256, sourceEvidenceFromTrace } from "./lib/knowledge-graph-trace.mjs"
import { connectElectron, readActiveModel } from "./lib/electron-backend.mjs"
import { resolveBenchmarkCredential } from "./lib/benchmark-credential.mjs"

const root = resolve(import.meta.dirname, "../..")
const { values } = parseArgs({ options: {
  "validate-only": { type: "boolean", default: false },
  benchmark: { type: "string", default: "scripts/acceptance/fixtures/knowledge-graph/benchmark.json" },
  book: { type: "string" },
  mode: { type: "string", default: "graph" },
  cases: { type: "string" },
  limit: { type: "string", default: "6" },
  output: { type: "string" },
  cdp: { type: "string", default: "http://127.0.0.1:9333" },
  timeout: { type: "string", default: "300000" },
  "desktop-user-data": { type: "string" },
} })
const benchmarkText = await readFile(resolve(root, values.benchmark), "utf8")
const benchmark = JSON.parse(benchmarkText)
const validation = validateBenchmark(benchmark)
if (values["validate-only"]) {
  console.log(JSON.stringify(validation, null, 2))
} else {
  if (process.env.WORLDSEED_ACCEPTANCE_REAL !== "1") throw new Error("Set WORLDSEED_ACCEPTANCE_REAL=1 to enable paid real-model calls")
  const limit = Number(values.limit)
  const timeoutMs = Number(values.timeout)
  if (!["graph", "source-only"].includes(values.mode)) throw new Error("--mode must be graph or source-only")
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) {
    throw new Error("--limit and --timeout must be positive integers")
  }
  const outputRoot = resolve(root, values.output ?? `.worldseed-data/acceptance/knowledge-graph/${Date.now()}-${randomUUID().slice(0, 8)}`)
  // A fresh directory prevents resuming with future chapters or inherited answers.
  await mkdir(dirname(outputRoot), { recursive: true })
  await mkdir(outputRoot, { recursive: false })
  const books = benchmark.books.filter(book => values.book ? book.book_id === values.book : book.split === "development").slice(0, values.book ? undefined : 1)
  if (books.length !== 1) throw new Error("Select exactly one book with --book; default is the first development book")
  const book = books[0]
  const caseIds = values.cases?.split(",")
  if (caseIds?.some(id => !book.cases.some(item => item.case_id === id))) throw new Error("--cases contains an unknown case ID for this book")
  const selected = (caseIds ? book.cases.filter(item => caseIds.includes(item.case_id)) : book.cases).slice(0, limit)
  const report = {
    version: 1, startedAt: new Date().toISOString(), status: "running",
    evaluationLayer: "isolated_backend_source_graph_query_integration",
    retrievalMode: values.mode,
    queryBudget: { maxModelCalls: 30, maxRetrievalRounds: 10, deadlineMs: timeoutMs },
    annotationStatus: benchmark.annotationStatus,
    benchmarkDigest: sha256(benchmarkText), validation,
    code: codeIdentity(), bookId: book.book_id,
    selectedCaseIds: selected.map(item => item.case_id),
    unexecutedCaseCount: validation.caseCount - selected.length,
    fixtureSetup: "Frozen Source documents and lexical Source indexes are seeded through production repositories. In graph mode graph construction uses the production orchestrator; source-only mode skips graph construction. Both query modes use the same production query orchestrator with a real model. Publication/style/planning UI gates are outside this test.",
    contextIsolation: "Before each query all non-system inherited model messages are hidden in this isolated database; each supplied context message and read evidence is audited.",
    notExecuted: ["DOM publication workflow", "B/C/D paired comparison", "branch isolation", "pending-source attack", "archive/replace/restart/compression recovery", "human gold annotation review"],
    builds: [], results: [],
  }
  let container, database, secret
  const save = async () => {
    report.summary = summarizeResults(report.results.map(item => ({
      ...item.score, case_id: item.case_id, book_id: book.book_id, task_type: item.task_type,
    })))
    await writeFile(join(outputRoot, "report.json"), JSON.stringify(report, null, 2) + "\n")
  }
  await save()
  try {
    const backend = await import(pathToFileURL(join(root, "common/backend/dist/index.js")).href)
    const { browser, page } = await connectElectron(values.cdp)
    let selection
    try { selection = await readActiveModel(page) } finally { await browser.close() }
    secret = await resolveBenchmarkCredential(selection, values["desktop-user-data"])
    selection.apiKey = secret
    const realModel = backend.createModelFromSelection(join(root, "common/packages/prompt-contracts"), selection)
    report.model = { provider: realModel.info?.provider, name: selection.model, contextWindowTokens: selection.contextWindowTokens }
    const calls = []
    const model = {
      info: realModel.info,
      execute: async (request, options) => {
        const call = { request, contextMessages: options?.contextMessages ?? [], startedAt: Date.now() }
        calls.push(call)
        try {
          const result = await realModel.execute(request, options)
          call.usage = result.usage
          call.result = result.result
          call.contextExchange = result.contextExchange
          return result
        } catch (error) { call.error = redact(error, selection.apiKey); throw error }
        finally { call.elapsedMs = Date.now() - call.startedAt }
      },
    }
    container = await backend.BackendContainer.open({
      applicationDataRoot: join(outputRoot, "data"),
      promptPackageRoot: join(root, "common/packages/prompt-contracts"), model,
    })
    const projectId = randomUUID()
    const workspaceRootRef = join(outputRoot, "workspace")
    await container.createProject({ projectId, displayName: `KG benchmark ${book.title}`, workspaceRootRef })
    const runtime = container.getCurrentRuntime()
    database = await backend.openProjectDatabase(runtime.internalStore.projectDatabaseRef)
    const sourceMap = new Map()
    let builtThrough = 0
    let buildError
    for (const testCase of [...selected].sort((a, b) => a.snapshot_chapter - b.snapshot_chapter)) {
      while (!buildError && builtThrough < testCase.snapshot_chapter) {
        const chapter = book.chapters.find(item => item.sequence === builtThrough + 1)
        const build = { source_key: chapter.source_key, sequence: chapter.sequence, startedAt: Date.now() }
        report.builds.push(build)
        calls.length = 0
        try {
          const source = await seedSource(backend, database, container, runtime, chapter, sourceMap)
          if (values.mode === "graph") {
            const orchestrator = runtime.createTurnOrchestrator(model, randomUUID, Date.now)
            build.result = await orchestrator.execute({
              workflow: "revision", adaptiveGraphGovernance: true,
              projectId, workspaceRootRef, internalStore: runtime.internalStore,
              userInput: chapter.body, chapterSequence: chapter.sequence,
              sourceId: source.sourceId, existingSourceUnitIds: source.unitIds,
              taskId: randomUUID(), allowWorkspaceChapterReads: false,
              maxModelCalls: 50, maxRetrievalRounds: 12, deadlineMs: timeoutMs,
              executionOrigin: { kind: "user" },
            }, { signal: globalThis.AbortSignal.timeout(timeoutMs) })
            if (build.result.graphMutationCount === 0) throw new Error("GRAPH_BUILD_EMPTY: no graph mutation was committed for a factual chapter")
          } else build.result = { kind: "source_index_only", graphMutationCount: 0 }
          builtThrough = chapter.sequence
        } catch (error) { buildError = redact(error, selection.apiKey); build.error = buildError }
        build.elapsedMs = Date.now() - build.startedAt
        build.usage = sumUsage(calls)
        await writeFile(join(outputRoot, `build-${chapter.sequence}.json`), JSON.stringify(calls, null, 2) + "\n")
        await save()
      }
      const row = { case_id: testCase.case_id, task_type: testCase.task_type, question: testCase.question, snapshotChapter: testCase.snapshot_chapter, startedAt: Date.now() }
      calls.length = 0
      let result
      if (buildError) result = { error: `Graph construction failed: ${buildError}` }
      else {
        try {
          const isolationSetup = await hideInheritedMessages(backend, database)
          const taskId = randomUUID()
          row.taskId = taskId
          row.isolationSetup = isolationSetup
          const query = await runtime.createTurnOrchestrator(model, randomUUID, Date.now).execute({
            workflow: "query", projectId, workspaceRootRef, internalStore: runtime.internalStore,
            taskId, userInput: benchmarkQuestion(testCase.question), chapterSequence: testCase.snapshot_chapter,
            allowWorkspaceChapterReads: false, ...report.queryBudget, executionOrigin: { kind: "user" },
          }, { signal: globalThis.AbortSignal.timeout(timeoutMs) })
          if (query.kind !== "query") throw new Error("Query returned a non-query result")
          row.rawAnswer = query.answerMarkdown
          row.contextIsolation = auditQueryIsolation(calls, taskId, sourceMap, testCase.snapshot_chapter)
          if (values.mode === "source-only" && calls.some(call => call.request?.input?.readEvidence?.some(item => ["node", "link", "revision"].includes(item.ownerKind)))) {
            throw new Error("SOURCE_ONLY_GRAPH_EVIDENCE: graph evidence appeared in a source-only run")
          }
          result = {
            ...parseBenchmarkAnswer(query.answerMarkdown),
            evidence: sourceEvidenceFromTrace(calls, sourceMap),
            contextIsolation: row.contextIsolation,
          }
        } catch (error) { result = { error: redact(error, selection.apiKey) } }
      }
      row.result = result
      row.score = scoreCase(testCase, result)
      row.elapsedMs = Date.now() - row.startedAt
      row.usage = sumUsage(calls)
      report.results.push(row)
      await writeFile(join(outputRoot, `query-${report.results.length}.json`), JSON.stringify(calls, null, 2) + "\n")
      await save()
      console.log(`${row.case_id}: ${row.score.status} (${row.elapsedMs}ms)`)
    }
    report.status = report.results.some(item => item.score.status === "error" || item.score.status === "invalid") ? "execution_failed" : "measured"
  } catch (error) {
    report.status = "blocked"
    report.error = redact(error, secret ?? process.env.WORLDSEED_BENCHMARK_API_KEY)
  } finally {
    report.finishedAt = new Date().toISOString()
    await database?.destroy()
    await container?.close()
    await save()
    console.log(JSON.stringify({ report: join(outputRoot, "report.json"), status: report.status, summary: report.summary, error: report.error }, null, 2))
    if (report.status !== "measured") process.exitCode = 1
  }
}

async function seedSource(backend, database, container, runtime, chapter, sourceMap) {
  const projectId = runtime.projectId
  const taskId = randomUUID(), scopeId = randomUUID(), sourceId = randomUUID()
  const documents = new backend.SqliteDocumentRepository(database)
  const retrieval = new backend.SqliteRetrievalRepository(database)
  await new backend.SqliteTaskScopeRepository(database).create({
    scopeId, projectId, taskId, turnId: randomUUID(), kind: "revision", status: "running",
    reason: "Isolated benchmark frozen Source fixture", configSnapshot: {}, promptSnapshot: {}, createdAtMs: Date.now(),
  })
  const contentRef = await container.internalStore.writeImmutableDocument(runtime.internalStore, randomUUID(), chapter.body)
  await documents.stageVersion({
    id: randomUUID(), projectId, scopeId, sourceId, chapterId: randomUUID(),
    contentRef, heading: chapter.heading, publishPath: `benchmark/${chapter.sequence}.md`,
    digest: backend.digest(chapter.body), createdAtMs: Date.now(),
  })
  const units = []
  for (const [sequence, body] of chapter.body.split(/\n{2,}/u).map(item => item.trim()).filter(Boolean).entries()) {
    const id = randomUUID()
    const ref = await container.internalStore.writeImmutableDocument(runtime.internalStore, id, body)
    const unit = { id, projectId, sourceId, sequence, contentRef: ref, digest: backend.digest(body), createdAtMs: Date.now() }
    units.push(unit)
    sourceMap.set(id, chapter)
  }
  await documents.stageSourceUnits(units)
  for (const unit of units) {
    const body = await container.internalStore.readDocument(unit.contentRef)
    await retrieval.stageProjection({
      projectionId: randomUUID(), projectId, scopeId, ownerKind: "source", ownerId: unit.id,
      ownerRevisionId: unit.id, exactKeys: backend.buildSourceUnitExactKeys(body), semanticText: body,
      sourceRefs: [{ sourceId, sourceUnitId: unit.id, sequence: unit.sequence }], digest: unit.digest,
    })
  }
  await new backend.SqliteScopeCommitRepository(database).commit(scopeId)
  await new backend.SqliteTurnPersistence(database, randomUUID).updateTask(taskId, "completed", undefined, Date.now())
  return { sourceId, unitIds: units.map(item => item.id) }
}

async function hideInheritedMessages(backend, database) {
  const messages = await database.selectFrom("model_context_messages").select(["id", "chain_id"])
    .where("hidden_at", "is", null).where("kind", "!=", "system_rules").execute()
  const persistence = new backend.SqliteTurnPersistence(database, randomUUID)
  for (const chainId of new Set(messages.map(item => item.chain_id))) {
    await persistence.hideModelContextMessages(chainId, messages.filter(item => item.chain_id === chainId).map(item => item.id), Date.now())
  }
  return { hiddenMessageIds: messages.map(item => item.id) }
}

function benchmarkQuestion(question) {
  return `${question}\n\n请通过图与 Source 检索核实，只回答一个 JSON 对象：{"answer":"最短明确答案","abstain":false}。无法从已有资料确定则回答 {"answer":"","abstain":true}。不要猜测，不要解释，不要添加 Markdown。回答前回查所有必要的 Source 原文；多跳题须读取每一跳。`
}

function sumUsage(calls) {
  return calls.reduce((sum, call) => ({
    modelCalls: sum.modelCalls + (call.usage?.modelCalls ?? (call.usage ? 1 : 0)),
    attemptedExecutions: sum.attemptedExecutions + 1,
    executionsWithoutReportedUsage: sum.executionsWithoutReportedUsage + (call.usage ? 0 : 1),
    inputTokens: sum.inputTokens + (call.usage?.inputTokens ?? 0),
    outputTokens: sum.outputTokens + (call.usage?.outputTokens ?? 0),
    latencyMs: sum.latencyMs + (call.usage?.latencyMs ?? 0),
  }), { modelCalls: 0, attemptedExecutions: 0, executionsWithoutReportedUsage: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 })
}

function codeIdentity() {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  return { head: git("rev-parse", "HEAD"), trackedDiffDigest: sha256(git("diff", "HEAD")), status: git("status", "--short") }
}

function redact(error, secret) {
  const message = error instanceof Error ? error.message : String(error)
  return secret ? message.replaceAll(secret, "[REDACTED]") : message
}
