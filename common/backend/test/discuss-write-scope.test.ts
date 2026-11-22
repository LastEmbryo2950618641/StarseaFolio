import { randomUUID } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { digest } from "../src/core/index.js"
import { openChapterHarness, prepareChapterPlanning, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const synopsis = "# 第一章 雨夜旧站台\n\n林烬听见即将发车的广播，带着车票上了末班车。"
const outline = "# 第一章 雨夜旧站台\n\n林烬从车窗看见熟悉的身影。"
const choices = [{ label: "核对本章节奏", action: "continue_discuss" }] as const

async function send(harness: ChapterHarness, message: string, extra = {}) {
  return harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "synopsis.conversation.send",
    payload: {
      projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef,
      message, proceedMode: "precise", maxModelCalls: 12, ...extra,
    },
  })
}

type Execute = AIModelPort["execute"]
function modelReply(request: Parameters<Execute>[0], fields: Record<string, unknown>) {
  synopsisConversationStreamHub.setTodos(request.projectId, [
    { id: "write", content: "核对用户本轮要求", status: "completed" },
  ], Date.now())
  return {
    result: {
      schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
      outcome: "continue", requestedReads: [], citedReadIds: [], producedArtifactIds: [],
      decisionRecordIds: [], unresolvedDependencies: [], reason: "Fixture", selfReview: "Fixture",
      artifact: { assistantMessage: "已处理本章请求。", finalSelfReview: "Fixture", choices, ...fields },
    },
    usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0, modelCalls: 1 },
  } satisfies Awaited<ReturnType<Execute>>
}

describe("discussion authorizes and verifies current-turn writes", () => {
  it("refreshes an upgraded session's skills and retries when the requested synopsis was replaced by an outline", async () => {
    let rewrite = false
    let rewriteCalls = 0
    const model = {
      classifyDiscussTurn() {
        return Promise.resolve({ scope: rewrite ? { synopsis: "rewrite" as const } : {}, usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0 } })
      },
      execute(request, options) {
        if (!rewrite) return Promise.resolve(modelReply(request, {}))
        const pack = options?.contextMessages?.filter(item => item.content.startsWith("【skill-pack:synopsis_discuss】"))
        expect(pack).toHaveLength(1)
        expect(pack?.[0]?.content).toContain("通读并抽正典清单")
        expect(pack?.[0]?.content).toContain("# 用户要求 + 梗概 → 剧情细纲")
        rewriteCalls += 1
        return Promise.resolve(modelReply(request, rewriteCalls === 1
          ? { planningWriteIntent: { outline: "rewrite" }, outlineBody: outline }
          : { planningWriteIntent: { synopsis: "rewrite" }, synopsisBody: synopsis }))
      },
    } satisfies AIModelPort
    const harness = await openChapterHarness("Sticky synopsis scope", { model })
    try {
      await prepareChapterPlanning(harness)
      const first = await send(harness, "先聊聊这个故事。")
      if (!first.ok) throw new Error(first.error.message)
      const path = (first.data as SynopsisConversationSendResult).session.synopsisPath
      const outlinePath = path.replace("[剧情梗概].md", "[剧情细纲].md")
      const legacy = "【skill-pack:synopsis_discuss】旧包\n\n{\"protocol\":\"synopsis-skills-v1\",\"kind\":\"default_pack\",\"skillIds\":[\"plot-synopsis\"]}"
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        db.prepare("UPDATE synopsis_discuss_context_messages SET content_text = ?, content_digest = ? WHERE content_text LIKE '【skill-pack:synopsis_discuss】%'")
          .run(legacy, digest(legacy))
      } finally { db.close() }
      rewrite = true
      const result = await send(harness, "把现在这一章的故事概括换成他直接上末班车。")
      if (!result.ok) throw new Error(result.error.message)
      expect(result).toMatchObject({ ok: true })
      expect(rewriteCalls).toBe(2)
      expect(await harness.workspace.readMarkdown(harness.workspaceRootRef, path)).toContain("带着车票上了末班车")
      // Synopsis rewrite demotes the chapter: old outline must not keep the proceed bar ahead.
      expect(existsSync(join(harness.workspaceRootRef, outlinePath))).toBe(false)
      expect((result.data as SynopsisConversationSendResult).messages.at(-1)?.content)
        .toMatch(/回退到梗概/)
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("preserves a manually edited outline when batch planning proposes a replacement", async () => {
    const model: AIModelPort = {
      info: { provider: "test", model: "batch-planning", available: true, contextWindowTokens: 64_000 },
      execute(request) {
        return Promise.resolve(modelReply(request, {
          planningWriteIntent: { volume: "whole_volume" },
          volumePlanMeta: { targetChapterCount: 1, targetWordCount: 2000 },
          volumeChapterPlans: [{ chapterSequence: 1, synopsisBody: synopsis, outlineBody: outline }],
        }))
      },
    }
    const harness = await openChapterHarness("Batch manual outline", { model })
    try {
      await prepareChapterPlanning(harness)
      const original = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "synopsis.conversation.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!original.ok) throw new Error(original.error.message)
      const path = (original.data as SynopsisConversationSendResult).session.synopsisPath
      const outlinePath = path.replace("[剧情梗概].md", "[剧情细纲].md")
      const manual = "# 第一章 雨夜旧站台\n\n手改细纲：留下车票，空手离开。"
      await harness.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, outlinePath, manual)
      const sent = await send(harness, "按卷准备章节材料。", {
        automation: "batch_chapter", automationStep: "volume_plan",
      })
      if (!sent.ok) throw new Error(sent.error.message)
      expect(await harness.workspace.readMarkdown(harness.workspaceRootRef, outlinePath)).toBe(manual)
      expect((sent.data as SynopsisConversationSendResult).messages.at(-1)?.content).toContain("有手改规划，已保留")
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("keeps quoted publication wording in discussion and retries a short draft before saving", async () => {
    let draftCalls = 0
    let discussOnly = false
    const model = {
      classifyDiscussTurn() {
        return Promise.resolve({ scope: discussOnly ? {} : { draft: "write" as const }, usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0 } })
      },
      execute(request) {
        if (discussOnly) return Promise.resolve(modelReply(request, {}))
        draftCalls += 1
        const body = draftCalls === 1 ? "林烬走了。" : "林烬听见广播，抓紧车票，从雨中穿过站台。"
        return Promise.resolve(modelReply(request, {
          chapterDraftProposal: { base: "body", heading: "雨夜旧站台", body },
          planningWriteIntent: { draft: "write" },
        }))
      },
    } satisfies AIModelPort
    const harness = await openChapterHarness("Bounded draft", { model })
    try {
      await prepareChapterPlanning(harness)
      const result = await send(harness, "先不要点「草稿可以，发布正文」，请把末班车一幕写成草稿。", {
        presentation: { minimumWordCount: 12, maximumWordCount: 25 },
      })
      if (!result.ok) throw new Error(result.error.message)
      const data = result.data as SynopsisConversationSendResult
      expect(data.appendedDraft?.draftVersionId).toBeTruthy()
      expect(draftCalls).toBe(2)
      expect(data.messages.at(-1)?.choices?.[0]?.publishDraftVersionId).toBe(data.appendedDraft?.draftVersionId)
      discussOnly = true
      const denied = await send(harness, "先不要点「草稿可以，发布正文」，我还在检查句子。")
      expect(denied.ok).toBe(true)
      expect(await harness.container.getCurrentRuntime()?.createChapterRevisionService().listUnpublished(harness.projectId))
        .toHaveLength(1)
      const stale = await send(harness, "发布旧草稿", { publishDraftVersionId: randomUUID() })
      if (stale.ok) throw new Error("A stale release confirmation was accepted")
      expect(stale.error.message).toContain("草稿已变更")
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
