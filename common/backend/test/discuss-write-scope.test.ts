import { randomUUID } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { digest } from "../src/core/index.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { openChapterHarness, prepareChapterPlanning, seedCommittedChapter, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const synopsis = "# 第一章 雨夜旧站台\n\n林烬听见即将发车的广播，带着车票上了末班车。"
const outline = "# 第一章 雨夜旧站台\n\n林烬从车窗看见熟悉的身影。"
const choices = [{ label: "核对本章节奏", action: "continue_discuss" }] as const

function tagged(section: "synopsis" | "outline" | "draft", markdown: string) {
  return `<compose-${section}>\n${markdown}\n</compose-${section}>`
}

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
  it("recovers folded writing requirements through the conversation archive before drafting", async () => {
    const originalRequest = "本章结尾要分别写出两地守军及其领队接到消息后的反应。"
    const rewriteRequest = "按细纲重写本章草稿。"
    const fake = new FakeAiModelAdapter(randomUUID)
    let drafting = false
    let archiveReads = 0
    let originalMessageId: string
    const model: AIModelPort = {
      info: fake.info,
      async classifyDiscussTurn(input) {
        if (drafting) expect(JSON.stringify(input.recentMessages)).not.toContain(originalRequest)
        return { scope: drafting ? { draft: "write" } : {}, usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0 } }
      },
      async execute(request, options) {
        if (request.phase !== "synopsis_discuss") return fake.execute(request, options)
        if (!drafting) return modelReply(request, { assistantMessage: "我建议只改开场。" })
        const context = options?.contextMessages ?? []
        const archived = context.flatMap((message) => {
          try {
            const payload = JSON.parse(message.content)
            return payload.name === "conversation_archive" ? [payload] : []
          } catch { return [] }
        })
        const replyWithTool = (action: "describe" | "invoke", args?: object) => modelReply(request, {
          choices: undefined,
          toolRequest: { name: "conversation_archive", action, ...(args === undefined ? {} : { arguments: JSON.stringify(args) }) },
        })
        expect(JSON.stringify(request.input)).not.toContain(originalRequest)
        if (!archived.some((result) => result.status === "described")) {
          expect(context.map((message) => message.content).join("\n")).not.toContain(originalRequest)
          expect(context.some((message) => message.content.includes("已压缩") && message.content.includes("conversation_archive"))).toBe(true)
          return replyWithTool("describe")
        }
        const latest = archived.at(-1)
        if (latest.status === "described") {
          return replyWithTool("invoke", { operation: "search", query: "守军", role: "user" })
        }
        if (latest.status === "archive_matches") {
          expect(latest.result.matches).toMatchObject([{ messageId: originalMessageId, role: "user" }])
          expect(latest.result.matches).toHaveLength(1)
          return replyWithTool("invoke", { operation: "read", messageId: originalMessageId })
        }
        expect(latest.status).toBe("archive_message")
        expect(latest.result).toMatchObject({ messageId: originalMessageId, role: "user", content: originalRequest })
        archiveReads += 1
        if (archiveReads === 1) return replyWithTool("invoke", { operation: "read", messageId: originalMessageId })
        return modelReply(request, {
          assistantMessage: tagged("draft", "# 第一章 雨夜旧站台\n\n消息传来后，东门领队派人疏散百姓，西门守卫把接应信号改成了三盏灯。"),
        })
      },
    }
    const harness = await openChapterHarness("Keep author directions across draft turns", { model })
    try {
      await seedCommittedChapter(harness)
      await prepareChapterPlanning(harness)
      const original = await send(harness, originalRequest)
      if (!original.ok) throw new Error(original.error.message)
      const { session, messages } = original.data as SynopsisConversationSendResult
      originalMessageId = messages.find((message) => message.role === "user" && message.content === originalRequest)!.messageId
      expect(await send(harness, rewriteRequest)).toMatchObject({ ok: true })
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        db.prepare("UPDATE synopsis_discuss_context_messages SET hidden_at = ? WHERE kind IN ('phase_request', 'phase_response')")
          .run(Date.now())
        db.prepare(`INSERT INTO synopsis_discuss_context_messages
          (id, session_id, project_id, sequence_no, role, kind, content_text, content_digest, token_estimate, created_at_ms)
          SELECT ?, ?, ?, COALESCE(MAX(sequence_no), 0) + 1, 'user', 'phase_instruction', ?, ?, 100, ?
          FROM synopsis_discuss_context_messages WHERE session_id = ?`)
          .run(randomUUID(), session.sessionId, harness.projectId,
            JSON.stringify({ protocol: "discuss-history-summary-v1", userInputs: [originalRequest, rewriteRequest], exchanges: [] }),
            "legacy-history", Date.now(), session.sessionId)
      } finally { db.close() }

      drafting = true
      const result = await send(harness, "继续")
      if (!result.ok) throw new Error(result.error.message)
      expect((result.data as SynopsisConversationSendResult).appendedDraft).toBeDefined()
      expect(archiveReads).toBe(2)
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

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
        // 刷新后的基础包只含 3 个共同 skill；梗概改写阶段 skill 只挂在本次 phasePrompt。
        expect(pack?.[0]?.content).toContain("【skill:discuss-workflow】")
        expect(pack?.[0]?.content).toContain("【skill:plot-synopsis】")
        expect(pack?.[0]?.content).not.toContain("【skill:user-to-synopsis】")
        expect(options?.phasePrompt?.text).toContain("【skill:user-to-synopsis】")
        expect(options?.phasePrompt?.text).toContain("通读并抽正典清单")
        expect(options?.phasePrompt?.text).not.toContain("【skill:synopsis-to-outline】")
        rewriteCalls += 1
        return Promise.resolve(modelReply(request, rewriteCalls === 1
          ? { assistantMessage: tagged("outline", outline) }
          : { assistantMessage: tagged("synopsis", synopsis) }))
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
      execute(request, options) {
        expect(options?.outputMode).toBe("text")
        return Promise.resolve(modelReply(request, {
          assistantMessage: [
            "<compose-volume-meta>", "targetChapterCount: 1", "targetWordCount: 2000", "</compose-volume-meta>",
            '<compose-volume-chapter index="1">',
            "<compose-volume-chapter-synopsis>", synopsis.trim(), "</compose-volume-chapter-synopsis>",
            "<compose-volume-chapter-outline>", outline.trim(), "</compose-volume-chapter-outline>",
            "</compose-volume-chapter>",
          ].join("\n"),
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

  it("does not present an older draft as ready to publish after a synopsis-only rewrite", async () => {
    const model = {
      classifyDiscussTurn() {
        return Promise.resolve({
          scope: { synopsis: "rewrite" as const },
          usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0 },
        })
      },
      execute(request) {
        return Promise.resolve(modelReply(request, {
          assistantMessage: tagged("synopsis", synopsis),
          choices: [
            { label: "用新梗概重写细纲", action: "confirm_synopsis" },
          ],
        }))
      },
    } satisfies AIModelPort
    const harness = await openChapterHarness("Synopsis rewrite with an existing draft", { model })
    try {
      await prepareChapterPlanning(harness)
      const revisions = harness.container.getCurrentRuntime()?.createChapterRevisionService()
      if (revisions === undefined) throw new Error("Missing revision service")
      const oldDraft = await revisions.startForChapterSequence({
        projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, chapterSequence: 1,
        heading: "第一章 雨夜旧站台", body: "林烬把车票留在窗台，转身离开。",
        volumeFolderName: "第一卷 待命名", source: "agent",
      })
      const result = await send(harness, "重写梗概，这次让林烬赶上末班车。")
      if (!result.ok) throw new Error(result.error.message)
      const data = result.data as SynopsisConversationSendResult
      const reply = data.messages.at(-1)
      expect(reply?.content).not.toContain("草稿已经写好")
      expect(reply?.choices?.map((choice) => choice.action)).toEqual(["confirm_synopsis"])
      expect(data.proceedProgress).toEqual({ stage: "synopsis_discuss", status: "done" })
      expect(data.appendedDraft).toBeUndefined()
      expect((await revisions.listDraftVersions(oldDraft.revisionTaskId)).versions.map((draft) => draft.versionId))
        .toEqual([oldDraft.versionId])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("adds a publish choice for a new draft but not for an unchanged draft", async () => {
    const fake = new FakeAiModelAdapter(randomUUID)
    const draft = {
      base: "body", heading: "第一章 雨夜旧站台",
      body: "林烬站在窗边望着站台。广播响了一声，他拿起车票往外走。",
    }
    const model: AIModelPort = {
      info: fake.info,
      classifyDiscussTurn() {
        return Promise.resolve({ scope: { draft: "write" }, usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0 } })
      },
      execute(request, options) {
        if (request.phase !== "synopsis_discuss") return fake.execute(request, options)
        return Promise.resolve(modelReply(request, {
          assistantMessage: tagged("draft", `# ${draft.heading}\n\n${draft.body}`),
        }))
      },
    }
    const harness = await openChapterHarness("Unchanged draft", { model })
    try {
      await seedCommittedChapter(harness)
      const first = await send(harness, "修改第一章草稿。")
      if (!first.ok) throw new Error(first.error.message)
      const firstData = first.data as SynopsisConversationSendResult
      const saved = firstData.appendedDraft
      if (saved === undefined) throw new Error("Expected a saved draft")
      expect(firstData.messages.at(-1)?.choices?.find((choice) => choice.action === "promote_draft_to_body")
        ?.publishDraftVersionId).toBe(saved.draftVersionId)

      const revisions = harness.container.getCurrentRuntime()?.createChapterRevisionService()
      if (revisions === undefined) throw new Error("Missing revision service")
      const before = await revisions.listDraftVersions(saved.revisionTaskId)
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const repeated = await send(harness, "再核对并修改第一章草稿。")
        if (!repeated.ok) throw new Error(repeated.error.message)
        const data = repeated.data as SynopsisConversationSendResult
        const reply = data.messages.at(-1)
        expect(reply?.content).toContain("草稿未变")
        expect(reply?.content).not.toContain("草稿已经写好")
        expect(reply?.content).not.toContain("草稿未落入草稿版本")
        expect(reply?.choices?.some((choice) => choice.action === "promote_draft_to_body")).toBe(false)
        expect(data.appendedDraft).toBeUndefined()
      }
      const after = await revisions.listDraftVersions(saved.revisionTaskId)
      expect(after.versions.map((draft) => draft.versionId)).toEqual(before.versions.map((draft) => draft.versionId))
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
          assistantMessage: tagged("draft", `# 雨夜旧站台\n\n${body}`),
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
