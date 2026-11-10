import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { expect, it, vi } from "vitest"
import { PROTOCOL_VERSION } from "@starseafolio/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { LncrawlReferenceService } from "../src/infrastructure/web-research/lncrawl-reference-service.js"
import { openChapterHarness } from "./helpers/chapter-coordination-harness.js"
import { CompositeWebResearchAdapter } from "../src/infrastructure/web-research/composite-web-research-adapter.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"

it("shows page rejection details and a failed read status in the actual conversation stream", async () => {
  const page = vi.spyOn(CompositeWebResearchAdapter.prototype, "fetchPageDetailed").mockResolvedValue({
    attempts: [{ provider: "HTTP", status: "error", message: "Web fetch failed (403)" }],
  })
  let calls = 0
  let modelEvidence = ""
  let readStatus: string | undefined
  let readSummary: string | undefined
  const url = "https://example.com/shinji"
  const model: AIModelPort = { execute(request) {
    if (++calls > 1) {
      modelEvidence = JSON.stringify(request.input)
      const read = synopsisConversationStreamHub.peek(request.projectId).searching.find((item) => item.query.includes(url))
      readStatus = read?.status
      readSummary = read?.resultSummary
      throw new Error("STOP_AFTER_WEB_READ_DIAGNOSTIC")
    }
    return Promise.resolve({
      result: { schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId,
        phase: request.phase, outcome: "request_read", artifact: { assistantMessage: "读取原作人物页。", finalSelfReview: "先取证。" },
        requestedReads: [{ requestId: randomUUID(), reason: "Read character source", expectedEvidence: "Character article",
          query: { exactKeys: [url], semanticTexts: [], anchorIds: [], directions: [], maxCandidates: 4, maxDepth: 1,
            sourceKinds: ["web"], readMode: "read_full" } }],
        citedReadIds: [], producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Verify source.", selfReview: "No story writes." },
      usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
    })
  } }
  const harness = await openChapterHarness("Web Read Failure", { model, workStyleGateReady: false, creativeSetupReady: false })
  try {
    await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(),
      method: "synopsis.conversation.send", payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, message: "写 Fate/stay night 同人，先读取人物资料。" } })
    expect(page).toHaveBeenCalledOnce()
    expect(modelEvidence).toContain("403")
    expect(readStatus).toBe("failed")
    expect(readSummary).toContain("403")
    expect(readSummary).toContain(url)
  } finally {
    page.mockRestore()
    await harness.container.close(); await rm(harness.root, { recursive: true, force: true })
  }
}, 20000)

it("can describe and execute original-work research before style confirmation without opening chapter writes", async () => {
  const search = vi.spyOn(LncrawlReferenceService.prototype, "search").mockResolvedValue({ title: "Example", output: "No matching novel", candidateUrls: [], candidates: [] })
  let calls = 0
  const model: AIModelPort = { execute(request) {
    calls++
    if (calls > 2) throw new Error("STOP_AFTER_REFERENCE_TOOL_VERIFICATION")
    return Promise.resolve({
      result: { schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId,
        phase: request.phase, outcome: "continue", artifact: {
          assistantMessage: "先核对原作资料。", finalSelfReview: "只读取外部参考，不写章节或确认风格。",
          toolRequest: { name: "original_work_search", action: calls === 1 ? "describe" : "invoke", arguments: JSON.stringify({ title: "Example" }) },
        }, requestedReads: [], citedReadIds: [], producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Verify reference tool gate.", selfReview: "No story writes." },
      usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
    })
  } }
  const harness = await openChapterHarness("Reference Tools Gate", { model, workStyleGateReady: false, creativeSetupReady: false })
  try {
    const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(),
      method: "synopsis.conversation.send", payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, message: "写 Example 同人，先核对原作。" } })
    expect(search).toHaveBeenCalledOnce()
    expect(response.ok).toBe(false) // Script intentionally ends after the two tool rounds.
  } finally {
    search.mockRestore(); await harness.container.close(); await rm(harness.root, { recursive: true, force: true })
  }
}, 20000)

it("reads newly imported original-work chapters in the same conversation send", async () => {
  const chapterPath = "参考文件/原作资料/Example/章节/001.md"
  const chapterBody = "# Chapter 1\n\nMira returned to the northern harbor on her twenty-second birthday.\n"
  const search = vi.spyOn(LncrawlReferenceService.prototype, "search").mockResolvedValue({
    title: "Example", output: "Example", candidates: [{ title: "Example", url: "https://example.com/novel", synopsis: "The confirmed source synopsis." }],
    candidateUrls: ["https://example.com/novel"],
  })
  const crawl = vi.spyOn(LncrawlReferenceService.prototype, "crawl").mockImplementation(async (input) => {
    await input.workspace.saveUserMarkdown(input.workspaceRootRef, chapterPath, chapterBody)
    return { title: "Example", importedFiles: [chapterPath], output: "Imported one chapter" }
  })
  let calls = 0
  let readBack = ""
  let catalogContainsChapter = false
  const model: AIModelPort = { execute(request) {
    calls++
    if (calls >= 6) {
      const input = request.input as { readEvidence?: readonly { ownerId: string; semanticText: string }[]; workspaceCatalog?: { entries: readonly { relativePath: string }[] } }
      readBack = input.readEvidence?.find((item) => item.ownerId === chapterPath)?.semanticText ?? ""
      catalogContainsChapter = input.workspaceCatalog?.entries.some((entry) => entry.relativePath === chapterPath) === true
      throw new Error("STOP_AFTER_IMPORTED_CHAPTER_READ")
    }
    const toolName = calls <= 2 ? "original_work_search" : "original_work_crawl"
    return Promise.resolve({
      result: { schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId,
        phase: request.phase, outcome: calls === 5 ? "request_read" : "continue", artifact: {
          assistantMessage: "核对原作首章。", finalSelfReview: "读取导入正文后才确认原作事实。",
          ...(calls === 5 ? {} : { toolRequest: { name: toolName, action: calls % 2 === 1 ? "describe" : "invoke",
            arguments: JSON.stringify({ title: "Example", ...(calls === 4 ? { url: "https://example.com/novel", chapterLimit: 1 } : {}) }) } }),
        }, requestedReads: calls === 5 ? [{ requestId: randomUUID(), reason: "Read the imported chapter", expectedEvidence: "Chapter text",
          query: { exactKeys: [chapterPath], semanticTexts: [], anchorIds: [], directions: [], maxCandidates: 4, maxDepth: 1,
            sourceKinds: ["reference"], readMode: "read_full" } }] : [],
        citedReadIds: [], producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Verify imported references.", selfReview: "No story writes." },
      usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
    })
  } }
  const harness = await openChapterHarness("Imported Reference Read", { model, workStyleGateReady: false, creativeSetupReady: false })
  try {
    const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(),
      method: "synopsis.conversation.send", payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, message: "写 Example 同人，下载首章并实际读取原作。" } })
    expect(crawl).toHaveBeenCalledOnce()
    expect(calls, JSON.stringify(response)).toBeGreaterThanOrEqual(6)
    expect(readBack).toContain("Mira returned to the northern harbor")
    expect(catalogContainsChapter).toBe(true)
  } finally {
    search.mockRestore(); crawl.mockRestore()
    await harness.container.close(); await rm(harness.root, { recursive: true, force: true })
  }
}, 20000)
