// Real CLI/network acceptance. Uses an isolated workspace and never calls a model.
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import console from "node:console"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import process from "node:process"
import { LncrawlReferenceService } from "../../common/backend/dist/infrastructure/web-research/lncrawl-reference-service.js"
import { NodeWorkspaceAdapter } from "../../common/backend/dist/infrastructure/filesystem/node-workspace-adapter.js"
import { executeSynopsisTool } from "../../common/backend/dist/application/chapters/synopsis-workflow-tools.js"
import { executeSynopsisWorkspaceReads } from "../../common/backend/dist/application/chapters/synopsis-workspace-reads.js"
import { hasOriginalWorkEvidence } from "../../common/backend/dist/application/chapters/original-work-evidence-gate.js"

const title = process.argv[2] ?? "The Long-awaited Mr Han"
const source = process.argv[3] ?? "lightnovelheaven"
const identityTerms = process.argv.slice(4).map((term) => term.trim().toLocaleLowerCase()).filter(Boolean)
const workspaceRootRef = resolve(".worldseed-data/lncrawl-live-check/workspace")
const reportPath = resolve(".worldseed-data/lncrawl-live-check/acceptance-report.json")
await mkdir(workspaceRootRef, { recursive: true })
const runtimeDirectory = process.env.STARSEAFOLIO_LNCRAWL_TEST_RUNTIME
const service = new LncrawlReferenceService(join(workspaceRootRef, "app-data"), {
  ...(runtimeDirectory === undefined ? {} : { runtimeDirectory }),
})
const workspace = new NodeWorkspaceAdapter()
const signal = globalThis.AbortSignal.timeout(420_000)
const visibleMessages = []
const context = { projectId: randomUUID(), sessionId: randomUUID(), chapterSequence: 1,
  workspaceRootRef, signal, maxModelCalls: 0, deadlineMs: 420_000,
  model: { execute() { throw new Error("This acceptance must not call a model") } },
}
const callbacks = {
  searchOriginalWork: (input) => service.search(input.title, input.workspaceRootRef, input.signal, input.source),
  crawlOriginalWork: (input) => service.crawl({ ...input, workspace }),
}
const report = { title, source, startedAt: new Date().toISOString(), stages: [] }
async function tool(name, action, args) {
  const started = Date.now()
  const result = await executeSynopsisTool({ request: { name, action, arguments: JSON.stringify(args) },
    context, callbacks, visibleMessages, listDrafts: async () => [],
  })
  visibleMessages.push({ messageId: randomUUID(), sequence: visibleMessages.length + 1,
    role: "system", kind: "phase_instruction", content: JSON.stringify(result),
  })
  report.stages.push({ name, action, status: result.status, elapsedMs: Date.now() - started })
  console.log(`${name} ${action}: ${result.status} (${Date.now() - started}ms)`)
  assert.notEqual(result.status, "error", JSON.stringify(result))
  return result.result
}
try {
  await tool("original_work_search", "describe")
  const search = await tool("original_work_search", "invoke", { title, source })
  report.candidates = search.candidates
  const match = search.candidates.find((candidate) => {
    const synopsis = candidate.synopsis?.toLocaleLowerCase() ?? ""
    return synopsis.length >= 40 && !/^(completed|ongoing|complete|unknown|n\/?a|none|完结|连载中|已完结|进行中)$/iu.test(synopsis.trim())
      && identityTerms.length > 0 && identityTerms.every((term) => synopsis.includes(term))
  })
  assert.ok(match, "No candidate synopsis matched all explicit identity terms; refusing to download any chapters")
  await tool("original_work_crawl", "describe")
  const imported = await tool("original_work_crawl", "invoke", { title, url: match.url, chapterLimit: 1 })
  const files = imported.importedFiles.filter((path) => !path.endsWith("/README.md"))
  assert.ok(files.length > 0, "Must download chapter text, not just metadata")
  const entries = await Promise.all(files.map(async (relativePath) => {
    const content = await readFile(join(workspaceRootRef, relativePath), "utf8")
    return { relativePath, entryKind: "file", role: "references", size: Buffer.byteLength(content),
      version: 1, digest: createHash("sha256").update(content).digest("hex") }
  }))
  const text = await workspace.readMarkdown(workspaceRootRef, files[0])
  const query = text.split("\n").find((line) => !line.startsWith("#") && line.trim().length > 100)?.trim().slice(0, 60)
  assert.ok(query, "Downloaded chapter needs searchable text")
  const evidence = await executeSynopsisWorkspaceReads({ workspace, workspaceRootRef,
    catalog: { snapshotId: randomUUID(), projectId: context.projectId, createdAtMs: Date.now(), digest: "live-import", entries },
    requests: [{ requestId: randomUUID(), purpose: "Verify downloaded novel evidence", query: {
      sourceKinds: ["reference"], exactKeys: [files[0]], semanticTexts: [query], maxCandidates: 1,
      readMode: "grep", grepKeywords: [query], grepContextLines: 1, grepMaxMatchesPerFile: 2,
    } }], existingEvidence: [], createId: randomUUID,
  })
  assert.ok(evidence.some((item) => item.semanticText.includes(query)))
  assert.ok(hasOriginalWorkEvidence(evidence), "Local chapter read must count as original-work evidence")
  Object.assign(report, { success: true, originalUrl: match.url, importedFiles: imported.importedFiles,
    chapters: files.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    query, evidence: evidence.map((item) => ({ ownerId: item.ownerId, sourceRefs: item.sourceRefs, digest: item.digest })),
  })
  console.log(JSON.stringify({ success: true, matchedSynopsis: match.synopsis, chapters: report.chapters, bytes: report.bytes, query, reportPath }))
} catch (error) {
  Object.assign(report, { success: false, error: String(error) })
  console.error(error)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
}
