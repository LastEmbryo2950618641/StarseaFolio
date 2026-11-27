import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION, type PhaseResultEnvelope, type SynopsisConversationSendResult } from "@starseafolio/contracts"

import type { AIModelPort, ModelExecutionOptions, TurnPhaseInput } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { peekSynopsisModelBudgetAdvisory } from "../src/application/chapters/synopsis-model-budget-tracker.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { ChapterRevisionService, RevisionInvalidStateError } from "../src/application/chapters/chapter-revision-service.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { DEFAULT_VOLUME_FOLDER_NAME, deriveSynopsisMarkdownPath, deriveOutlineMarkdownPath, digest, siblingPlanningMarkdownPath } from "../src/core/index.js"
import { confirmedVolumeStorylineFixture, openChapterHarness, prepareChapterPlanning, seedCommittedChapter, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"
import { textFixtureModel } from "./helpers/discuss-fixture-text.js"

const EMPTY_SYNOPSIS = "# 第一章 雨夜旧站台 剧情梗概\n\n"
const EMPTY_OUTLINE = "# 第一章 雨夜旧站台 剧情细纲\n\n"

async function clearChapterPlanningMaterials(harness: ChapterHarness): Promise<string> {
  const listed = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "synopsis.conversation.list",
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
  })
  if (!listed.ok) throw new Error(listed.error.message)
  const synopsisPath = (listed.data as { session: { synopsisPath: string } }).session.synopsisPath
  const outlinePath = siblingPlanningMarkdownPath(synopsisPath, "outline")
  if (outlinePath === undefined) throw new Error("missing outline path")
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, synopsisPath, EMPTY_SYNOPSIS)
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, outlinePath, EMPTY_OUTLINE)
  const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
  try {
    database.prepare(`
      update synopsis_conversation_sessions
      set synopsis_confirmed_at_ms = null,
          last_agent_digest = ?,
          last_outline_agent_digest = ?,
          focus_kind = 'plot_synopsis'
      where project_id = ? and chapter_sequence = 1
    `).run(digest(EMPTY_SYNOPSIS), digest(EMPTY_OUTLINE), harness.projectId)
  } finally {
    database.close()
  }
  return synopsisPath
}

const todos = [{ id: "draft", content: "生成正文草稿", status: "in_progress" as const }]
const draft = { base: "body", heading: "第一章 雨夜旧站台", body: "林烬走进雨夜的旧站台，灯下多了一封没有落款的信。他展开信纸，认出了失踪者的字迹。" }
const choices = [{ label: "检查当前草稿", action: "continue_discuss" }]
const tool = (name: string, action = "describe", args?: unknown) => ({
  toolRequest: { name, action, ...(args === undefined ? {} : { arguments: JSON.stringify(args) }) },
})

async function withScript(
  script: (call: number, request: Parameters<AIModelPort["execute"]>[0], options?: ModelExecutionOptions) => Record<string, unknown> & {
    requestedReads?: PhaseResultEnvelope["requestedReads"]
  },
  run: (harness: ChapterHarness, send: (extra?: Record<string, unknown>) => Promise<SynopsisConversationSendResult>) => Promise<void>,
): Promise<void> {
  let calls = 0
  const fake = new FakeAiModelAdapter(randomUUID)
  const model: AIModelPort = {
    info: { provider: "test", model: "token-loop", available: true, contextWindowTokens: 64_000 },
    async execute(request, options) {
      if (request.phase !== "synopsis_discuss") return fake.execute(request, options)
      const { requestedReads = [], ...scriptedArtifact } = script(++calls, request, options)
      const planning = (request.input as TurnPhaseInput).synopsisDiscuss
      const inferredWriteIntent = {
        ...(typeof scriptedArtifact.synopsisBody === "string" && scriptedArtifact.synopsisBody.length > 0
          ? { synopsis: planning?.synopsisReady === true ? "rewrite" as const : "create" as const }
          : {}),
        ...(scriptedArtifact.bodyEdits === undefined
          ? scriptedArtifact.outlineBody === undefined
            ? {}
            : { outline: planning?.outlineReady === true ? "rewrite" as const : "create" as const }
          : { outline: "patch" as const }),
        ...(scriptedArtifact.chapterDraftProposal === undefined && scriptedArtifact.chapterDraftProposals === undefined
          ? {}
          : { draft: "write" as const }),
        ...(scriptedArtifact.volumeChapterPlans === undefined ? {} : { volume: "whole_volume" as const }),
      }
      const artifact = {
        assistantMessage: "正在处理当前章。",
        finalSelfReview: "Scripted regression.",
        ...scriptedArtifact,
        ...(scriptedArtifact.planningWriteIntent === undefined && Object.keys(inferredWriteIntent).length > 0
          ? { planningWriteIntent: inferredWriteIntent }
          : {}),
      }
      return {
        result: {
          schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
          outcome: requestedReads.length > 0 ? "request_read" : "continue", artifact, requestedReads, citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Regression", selfReview: "Regression",
        },
        usage: { inputTokens: 100, lastRequestInputTokens: 100, outputTokens: 20, latencyMs: 0, modelCalls: 1 },
      }
    },
  }
  const harness = await openChapterHarness("Token loop regression", { model: textFixtureModel(model) })
  try {
    await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.批量计划.md", serializeVolumePlanningState({
      ...confirmedVolumeStorylineFixture,
      volumeFolderName: "第一卷 待命名", startSequence: 1, targetChapterCount: 8, targetWordCount: 24000,
      synopsisWriteCount: 1, outlineWriteCount: 1,
    }))
    await prepareChapterPlanning(harness)
    await run(harness, async (extra = {}) => {
      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "synopsis.conversation.send",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef,
          message: "按细纲写正文草稿", batchProceed: true, ...extra },
      })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as SynopsisConversationSendResult
    })
  } finally {
    await harness.container.close()
    rmSync(harness.root, { recursive: true, force: true })
  }
}

describe("discussion token loop regressions", { timeout: 30_000 }, () => {
  it("repairs a focus-only response instead of requiring the old chapter draft", async () => {
    const message = "把焦点切到第二章，写第二章细纲与正文。"
    let calls = 0
    await withScript((call, request, options) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (call === 1) return { focusChange: { chapterSequence: 2 }, choices }
      const hint = options?.contextMessages?.at(-1)?.content ?? ""
      expect(hint).toContain("userRequestQuote")
      expect(hint).not.toContain("完整正文必交")
      return { focusChange: { chapterSequence: 2, userRequestQuote: message }, continueTurn: true }
    }, async (harness, send) => {
      await seedCommittedChapter(harness)
      const sent = await send({ message, batchProceed: false })
      expect(sent.session.chapterSequence).toBe(2)
      expect(sent.appendedDraft).toBeUndefined()
      expect(sent.autoContinue?.message).toContain(message)
      expect(calls).toBe(2)
    })
  })

  it.each([
    { name: "missing quote", quote: undefined, continueTurn: true },
    { name: "quote copied from old history", quote: "上一轮请切到第二章", continueTurn: true },
    { name: "switch only", quote: undefined, continueTurn: false },
  ])("repairs focus metadata before demanding old-chapter writes ($name)", async ({ quote, continueTurn }) => {
    const message = continueTurn ? "接下来处理第二章，把细纲和正文一起写好。" : "我们转到第二章。"
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? {
        focusChange: { chapterSequence: 2, ...(quote === undefined ? {} : { userRequestQuote: quote }) },
        chapterTitle: "第二章 山村",
        chapterDraftProposal: { ...draft, heading: "第二章 山村", body: "这份目标章文字不能被写入旧焦点。" },
        choices,
      } : {
        focusChange: { chapterSequence: 2, userRequestQuote: message }, continueTurn, choices,
      }
    }, async (harness, send) => {
      await seedCommittedChapter(harness)
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      const countDrafts = () => (db.prepare("select count(*) as count from revision_draft_versions").get() as { count: number }).count
      const before = countDrafts()
      try {
        const sent = await send({ message, batchProceed: false })
        expect(sent.session.chapterSequence).toBe(2)
        expect(sent.appendedDraft).toBeUndefined()
        expect(countDrafts()).toBe(before)
        expect(calls).toBe(2)
        expect(sent.messages.at(-1)?.content).not.toContain("第一章正文已提交")
        if (continueTurn) expect(sent.autoContinue?.message).toContain(message)
        else expect(sent.autoContinue).toBeUndefined()
      } finally { db.close() }
    })
  })

  it.each([false, true])("bounds invalid focus repair and discards old-focus writes (withdrawn=%s)", async (withdrawn) => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        assistantMessage: "第二章焦点已切换，正文已提交。",
        ...(call === 1 || !withdrawn ? { focusChange: { chapterSequence: 2 } } : {}),
        chapterTitle: "第二章 山村", chapterDraftProposal: draft, continueTurn: true, choices,
      }
    }, async (harness, send) => {
      await seedCommittedChapter(harness)
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      const countDrafts = () => (db.prepare("select count(*) as count from revision_draft_versions").get() as { count: number }).count
      const before = countDrafts()
      try {
        const sent = await send({ message: "把焦点转到第二章，继续写细纲与正文。", batchProceed: false })
        expect(sent.session.chapterSequence).toBe(1)
        expect(sent.appendedDraft).toBeUndefined()
        expect(sent.autoContinue).toBeUndefined()
        expect(countDrafts()).toBe(before)
        expect(calls).toBe(2)
        expect(sent.messages.at(-1)?.content).toContain("换章")
        expect(sent.messages.at(-1)?.content).not.toContain("焦点已切换")
      } finally { db.close() }
    })
  })

  it.each([
    { name: "switch only", message: "接下来请看第二章。", continueTurn: false, emptyPlanning: false, emptyOutline: false },
    { name: "switch and write", message: "把焦点切到第二章，写第二章细纲与正文。", continueTurn: true, emptyPlanning: false, emptyOutline: false },
    { name: "switch with missing current planning", message: "我们转到第二章吧。", continueTurn: false, emptyPlanning: true, emptyOutline: false },
    { name: "switch without old outline", message: "把焦点切到第二章，写第二章细纲与正文。", continueTurn: true, emptyPlanning: false, emptyOutline: true },
  ])("honors a user-directed focus change with batch off ($name)", async ({ message, continueTurn, emptyPlanning, emptyOutline }) => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        focusChange: { chapterSequence: 2, focusKind: "plot_synopsis", userRequestQuote: message },
        continueTurn,
        choices,
        // A combined response must never write target-chapter content into the old focus.
        ...(continueTurn ? {
          synopsisBody: "# 第二章\n\n主角沿信件线索前往山村。",
          outlineBody: "# 第二章细纲\n\n主角在山村找到送信人。",
          chapterDraftProposal: { ...draft, heading: "第二章 山村送信人", body: "第二章的文字不能覆盖第一章。" },
        } : {}),
      }
    }, async (harness, send) => {
      await seedCommittedChapter(harness)
      const listed = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(),
        method: "synopsis.conversation.list", payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef } })
      if (!listed.ok) throw new Error(listed.error.message)
      const oldPath = (listed.data as { session: { synopsisPath: string } }).session.synopsisPath
      if (emptyPlanning) await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, oldPath, "")
      if (emptyOutline) await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, siblingPlanningMarkdownPath(oldPath, "outline")!, "")
      const oldSynopsis = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, oldPath)
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      const countDrafts = () => (db.prepare("select count(*) as count from revision_draft_versions").get() as { count: number }).count
      const before = countDrafts()
      try {
        const sent = await send({ message, batchProceed: false })
        expect(sent.session.chapterSequence).toBe(2)
        expect(sent.session.synopsisPath).not.toBe(oldPath)
        expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, oldPath)).toBe(oldSynopsis)
        expect(sent.appendedDraft).toBeUndefined()
        expect(countDrafts()).toBe(before)
        expect(calls).toBe(1)
        if (continueTurn) {
          expect(sent.autoContinue?.message).toContain(message)
          expect(sent.autoContinue?.message).toContain("第2章")
          expect(sent.messages.at(-1)?.content).not.toContain("第1章草稿未落入")
          expect(sent.messages.at(-1)?.content).not.toContain("第1章细纲没有收到")
        } else expect(sent.autoContinue).toBeUndefined()
      } finally { db.close() }
    })
  })

  it.each([false, true])("reloads target-chapter context before continuing only the requested work (repair=%s)", async (repair) => {
    const message = "把焦点切到第二章，写第二章细纲与正文。"
    const title = "山村送信人"
    const synopsis = "# 第二章 山村送信人 剧情梗概\n\n林烬沿信件线索前往山村，找到送信人。\n"
    const outline = "# 第二章 山村送信人 剧情细纲\n\n- 章定位：找到送信人。\n- 分场：沿小路进村，向村民打听消息。\n- 人物准备：林烬和村民。\n"
    let calls = 0
    const switchCall = repair ? 2 : 1
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (repair && call === 1) return {
        focusChange: { chapterSequence: 2 }, chapterDraftProposal: draft, choices,
      }
      if (call === switchCall) return {
        focusChange: { chapterSequence: 2, userRequestQuote: message }, continueTurn: true,
      }
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ chapterSequence: 2, synopsisMarkdown: synopsis })
      return {
        outlineBody: outline,
        planningWriteIntent: { outline: "create", draft: "write" },
        chapterDraftProposal: { base: "body", heading: `第二章 ${title}`, body: "林烬走进山村，向井边的村民打听送信人的住处。" },
        choices,
      }
    }, async (harness, send) => {
      await seedCommittedChapter(harness)
      const synopsisPath = deriveSynopsisMarkdownPath(2, title, DEFAULT_VOLUME_FOLDER_NAME)
      const outlinePath = deriveOutlineMarkdownPath(2, title, DEFAULT_VOLUME_FOLDER_NAME)
      await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, synopsisPath, synopsis)
      const first = await send({ message, batchProceed: false })
      expect(first.session.chapterSequence).toBe(2)
      expect(first.autoContinue?.message).toContain(message)
      const next = await send({ message: first.autoContinue!.message, batchProceed: false })
      expect(next.session.chapterSequence).toBe(2)
      expect(next.appendedDraft?.draftVersionId).toBeTruthy()
      expect(next.autoContinue).toBeUndefined()
      expect((await harness.container.workspace.readMarkdown(harness.workspaceRootRef, outlinePath)).trimEnd()).toBe(outline.trimEnd())
      expect(calls).toBe(switchCall + 2)
      const db = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        const target = db.prepare("select chapter_sequence from chapter_revision_tasks where id = ?").get(next.appendedDraft!.revisionTaskId)
        expect(target).toMatchObject({ chapter_sequence: 2 })
      } finally { db.close() }
    })
  })

  it.each([
    { name: "unsolicited change", quote: undefined, focusLocked: false, published: true },
    { name: "quote absent from this user message", quote: "把焦点切到第二章", focusLocked: false, published: true },
    { name: "locked focus", quote: "检查当前章节材料。", focusLocked: true, published: true },
    { name: "unpublished predecessor", quote: "检查当前章节材料。", focusLocked: false, published: false },
  ])("keeps focus gates for $name", async ({ quote, focusLocked, published }) => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { focusChange: { chapterSequence: 2, ...(quote === undefined ? {} : { userRequestQuote: quote }) }, choices }
    }, async (harness, send) => {
      if (published) await seedCommittedChapter(harness)
      const sent = await send({ message: "检查当前章节材料。", batchProceed: false, focusLocked })
      expect(sent.session.chapterSequence).toBe(1)
      expect(sent.autoContinue).toBeUndefined()
    })
  })

  it("retains a volume plan while repairing only its writing settings", async () => {
    let calls = 0
    const synopsis = "# 第一卷梗概\n主角追查雨夜站台的信件，查明失踪者下落。"
    const outline = "# 第一卷大纲\n第一章发现信件；后续逐步查明失踪真相。"
    await withScript((call, request, options) => {
      calls = call
      expect(options?.outputMode).toBe("text")
      if (call > 1) expect(options?.contextMessages?.some(message => message.content.includes("已保留卷规划。请补齐 <writing-settings>"))).toBe(true)
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? {
        assistantMessage: `已整理规划。\n<compose-volume-synopsis>\n${synopsis}\n</compose-volume-synopsis>\n<compose-volume-outline>\n${outline}\n</compose-volume-outline>\n<compose-volume-meta>\ntargetChapterCount: 8\ntargetWordCount: 24000\n</compose-volume-meta>`,
      } : { assistantMessage: "<writing-settings>\ndescriptionRulePath: 表现输出/描写规则/自动.md\nproseStyleRulePath: 表现输出/笔风规则/默认笔风规则.md\nminimumWordCount: 2500\nmaximumWordCount: 3500\nboundaryPace: advance_allowed\ncausalityFocus: action\n</writing-settings>" }
    }, async (harness, send) => {
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.批量计划.md", serializeVolumePlanningState({
        ...confirmedVolumeStorylineFixture,
        volumeFolderName: "第一卷 待命名", startSequence: 1, targetChapterCount: 8, targetWordCount: 24000,
        synopsisWriteCount: 0, outlineWriteCount: 0,
      }))
      await send({ message: "完成当前卷规划", batchProceed: false })
      expect(calls).toBe(2)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.梗概.md")).toBe(synopsis)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.md")).toBe(outline)
    })
  })

  it("invalidates a retained draft when another tool is invoked", async () => {
    await withScript((call) => {
      if (call === 1) return { chapterDraftProposal: draft, choices }
      if (call === 2) return tool("todo_write")
      if (call === 3) return tool("todo_write", "invoke", {
        todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: false,
      })
      if (call === 4) return tool("memory_write")
      if (call === 5) return tool("memory_write", "invoke", { target: "index", markdown: "# 记忆\n\n修改创作约束。" })
      return { choices }
    }, async (_harness, send) => {
      const sent = await send({ batchProceed: false })
      expect(sent.appendedDraft).toBeUndefined()
    })
  })

  it("retains a complete draft while repairing the checklist", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      if (call === 1) return { chapterDraftProposal: draft, choices }
      if (call === 2) return tool("todo_write")
      if (call === 3) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 4) return { choices }
      if (call === 5) return tool("todo_write", "invoke", {
        todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true,
      })
      return { choices }
    }, async (harness, send) => {
      const sent = await send({ batchProceed: false })
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(calls).toBe(6)
      const saved = await harness.container.getCurrentRuntime()?.createChapterRevisionService()
        .readDraftVersion(sent.appendedDraft!.draftVersionId)
      expect(saved?.body).toBe(draft.body)
    })
  })

  it("keeps the delivered draft without another model call when stop choices are present", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      const sent = await send({ batchProceed: false })
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(calls).toBe(1)
    })
  })

  it("pauses autonomous continuation until the draft is confirmed", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ batchProceed: true, batchAutomation: false })
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, continueTurn: true }
    }, async (_harness, send) => {
      const sent = await send()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.messages.at(-1)?.content).toContain("草稿可以，发布正文")
      expect(sent.messages.at(-1)?.choices?.[0]?.action).toBe("promote_draft_to_body")
      expect(calls).toBe(1)
    })
  })

  it("auto-continues after a batch-written synopsis without forcing the next stage", async () => {
    let calls = 0
    const synopsisBody = "# 第一章 雨夜旧站台 剧情梗概\n主角在旧站台发现一封来自失踪者的信，并决定追查信件来源。"
    await withScript((call, request) => {
      calls = call
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ batchProceed: true })
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody }
    }, async (harness, send) => {
      // Start from empty planning so stage reflects synopsis 入库 only (not a pre-seeded outline).
      await clearChapterPlanningMaterials(harness)
      const sent = await send({ message: "继续推进第一章", batchProceed: true })
      expect(calls).toBe(1)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, sent.session.synopsisPath))
        .toContain("来自失踪者的信")
      expect(sent.proceedProgress?.stage).toBe("synopsis_discuss")
      expect(sent.autoContinue?.message).toContain("剧情梗概已入库")
      expect(sent.autoContinue?.message).toContain("进入构思阶段")
      expect(sent.autoContinue?.message).not.toContain("推进尚未完成的下一步")
    })
  })

  it("continues from a synopsis write in the legacy single-chapter mode", async () => {
    const synopsisBody = "# 第一章 雨夜旧站台 剧情梗概\n主角在旧站台发现一封来自失踪者的信，并决定追查信件来源。"
    await withScript((call, request) => {
      expect(call).toBe(1)
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ batchProceed: true })
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody }
    }, async (harness, send) => {
      await clearChapterPlanningMaterials(harness)
      const sent = await send({ message: "先写这一章的剧情梗概", proceedMode: "single" })
      expect(sent.proceedProgress?.stage).toBe("synopsis_discuss")
      expect(sent.autoContinue?.message).toContain("进入构思阶段")
      expect(sent.autoContinue?.message).toContain("连续完成细纲与草稿")
    })
  })

  it("keeps chapter_requirements on discuss-only turns and does not push next materials", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        assistantMessage: "先对齐本章要写什么：雨夜旧站台与失踪者信件。",
        choices,
        continueTurn: true,
      }
    }, async (harness, send) => {
      await clearChapterPlanningMaterials(harness)
      const sent = await send({
        message: "我们先讨论一下这一章要写什么，先不要落盘。",
        proceedMode: "precise",
        batchProceed: false,
      })
      expect(sent.proceedProgress?.stage).toBe("chapter_requirements")
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.messages.at(-1)?.content ?? "").not.toMatch(/写入(?:本章)?细纲|去写梗概/)
    })
  })

  it("advances proceed stage only after synopsis 入库", async () => {
    const synopsisBody = "# 第一章 雨夜旧站台 剧情梗概\n\n主角在旧站台发现失踪者的信，决定追查来源。"
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody, choices }
    }, async (harness, send) => {
      const synopsisPath = await clearChapterPlanningMaterials(harness)
      const sent = await send({
        message: "把本章梗概写好并入库。",
        proceedMode: "single",
        batchProceed: false,
      })
      expect(sent.proceedProgress?.stage).toBe("synopsis_discuss")
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, synopsisPath))
        .toContain("失踪者的信")
      expect(sent.autoContinue?.message).toContain("剧情梗概已入库")
    })
  })

  it("lists proceedProgress from disk without a send turn", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { choices }
    }, async (harness) => {
      await clearChapterPlanningMaterials(harness)
      const listed = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "synopsis.conversation.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!listed.ok) throw new Error(listed.error.message)
      expect((listed.data as { proceedProgress?: { stage: string } }).proceedProgress?.stage)
        .toBe("chapter_requirements")
    })
  })

  it("does not auto-continue on continueTurn alone without 入库 or open todos", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        assistantMessage: "先对齐本章目标，暂不落盘下一阶段材料。",
        choices,
        continueTurn: true,
      }
    }, async (_harness, send) => {
      const sent = await send({
        message: "我们只讨论一下，先不要继续代发。",
        proceedMode: "single",
        batchProceed: false,
      })
      expect(sent.autoContinue).toBeUndefined()
    })
  })

  it("waits for draft confirmation instead of executing every alternative", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, choices: [
        { label: "发布当前草稿", action: "continue_discuss" },
        { label: "把第一章结尾再改冷一点", action: "continue_discuss" },
      ] }
    }, async (_harness, send) => {
      const sent = await send()
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.messages.at(-1)?.choices?.[0]?.action).toBe("promote_draft_to_body")
      expect(sent.messages.at(-1)?.choices?.some((choice) => choice.label === "把第一章结尾再改冷一点")).toBe(true)
      expect(sent.messages.at(-1)?.content).toContain("中间不再询问")
    })
  })

  it("removes resolved todo repair instructions before asking for the deliverable", async () => {
    let calls = 0
    await withScript((call, _request, options) => {
      calls = call
      if (call === 1 || call === 4) return { chapterDraftProposal: draft, choices }
      if (call === 2) return tool("todo_write")
      if (call === 3) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 5) return tool("todo_write", "invoke", {
        todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true,
      })
      const systemRules = options?.contextMessages?.filter((message) => message.kind === "system_rules") ?? []
      expect(systemRules).toHaveLength(1)
      const reminder = options?.contextMessages?.filter((message) => message.kind === "phase_instruction").at(-1)?.content ?? ""
      expect(reminder).not.toContain("本轮尚未调用 todo_write")
      expect(reminder).not.toContain("本轮 Todo 仍有 pending/in_progress 项")
      expect(reminder).toContain("Todo 已全部结清")
      return { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      expect((await send({ batchProceed: false })).appendedDraft?.draftVersionId).toBeTruthy()
      expect(calls).toBe(6)
    })
  })

  it("throws on the third unchanged todo write", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      return call === 1 ? tool("todo_write") : tool("todo_write", "invoke", { todos, merge: true })
    }, async (_harness, send) => {
      await expect(send({ noProgressGuardEnabled: true })).rejects.toThrow(/todo_no_progress.*3.*停止/)
      expect(calls).toBe(5)
    })
  })

  it("does not hard-stop identical todo writes when no-progress guard is off", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      return call === 1 ? tool("todo_write") : tool("todo_write", "invoke", { todos, merge: true })
    }, async (_harness, send) => {
      const sent = await send({ noProgressGuardEnabled: false, maxModelCalls: 6 })
      expect(calls).toBeGreaterThanOrEqual(5)
      expect(sent.messages.at(-1)?.content).toMatch(/调用预算|预算/)
    })
  })

  it("throws on the third repeated unchanged tool description", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos, Date.now())
      return tool("memory_write")
    }, async (_harness, send) => {
      await expect(send({ noProgressGuardEnabled: true })).rejects.toThrow(/memory_write.*describe_no_progress.*3.*停止/)
      expect(calls).toBe(4)
    })
  })

  it("counts repeated descriptions across sends until the tool is invoked", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call % 2 === 1 ? tool("memory_write") : { choices }
    }, async (_harness, send) => {
      for (let turn = 0; turn < 3; turn += 1) await send({ message: "检查记忆工具", batchProceed: false })
      await expect(send({ message: "检查记忆工具", batchProceed: false, noProgressGuardEnabled: true }))
        .rejects.toThrow(/memory_write.*describe_no_progress.*3.*停止/)
      expect(calls).toBe(7)
    })
  })

  it("throws on the third failed tool invocation without a fourth attempt", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? tool("memory_write") : tool("memory_write", "invoke", { invalid: call })
    }, async (_harness, send) => {
      await expect(send({ message: "检查记忆工具", noProgressGuardEnabled: true })).rejects.toThrow(/memory_write.*3.*停止/)
      expect(calls).toBe(4)
    })
  })

  it("counts failures across sends despite changed arguments and successful descriptions", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (call % 3 === 1) return tool("memory_write")
      return call % 3 === 2 ? tool("memory_write", "invoke", { invalid: call }) : { choices }
    }, async (_harness, send) => {
      const extra = { message: "检查记忆工具", batchProceed: false, noProgressGuardEnabled: true }
      await send(extra)
      await send(extra)
      await expect(send(extra)).rejects.toThrow(/memory_write.*3.*停止/)
      expect(calls).toBe(8)
    })
  })

  it("resets a failed step only after that same step succeeds", async () => {
    await withScript((call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (call === 1) return tool("memory_write")
      if (call === 4) return tool("memory_write", "invoke", { target: "index", markdown: "# 记忆\n\n保留站台线索。" })
      return [2, 6, 8, 10].includes(call) ? tool("memory_write", "invoke", { invalid: call }) : { choices }
    }, async (_harness, send) => {
      const extra = { message: "检查记忆工具", batchProceed: false, noProgressGuardEnabled: true }
      for (let turn = 0; turn < 4; turn += 1) await send(extra)
      await expect(send(extra)).rejects.toThrow(/memory_write.*3.*停止/)
    })
  })

  it("persists completed call usage even if the next call fails", async () => {
    await withScript((call) => {
      if (call > 1) throw new Error("402 Insufficient Balance")
      return tool("todo_write")
    }, async (harness, send) => {
      await expect(send()).rejects.toThrow("402 Insufficient Balance")
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"), { readonly: true })
      try {
        expect(database.prepare("select input_tokens, output_tokens from synopsis_discuss_usage where project_id = ?").get(harness.projectId))
          .toMatchObject({ input_tokens: 100, output_tokens: 20 })
      } finally {
        database.close()
      }
    })
  })

  it("stops automatic continuation across turns that make no durable progress", async () => {
    const stagnant = "# 第一章 剧情梗概\n\n林烬停在站台口，这一句不再推进。"
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      // Rewriting the same body keeps auto-continue via 入库 path, but fingerprint stalls.
      return { synopsisBody: stagnant, choices }
    }, async (_harness, send) => {
      const extra = { message: "继续检查当前进度", noProgressGuardEnabled: true }
      // First rewrite differs from harness seed → progress; later identical rewrites stall.
      expect((await send(extra)).autoContinue).toBeDefined()
      expect((await send(extra)).autoContinue).toBeDefined()
      expect((await send(extra)).autoContinue).toBeDefined()
      await expect(send(extra)).rejects.toThrow(/3.*没有实际内容进展.*停止/)
    })
  })

  it("keeps batch continuation available while real planning content changes", async () => {
    await withScript((call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody: `# 第一章 剧情梗概\n\n林烬发现信后追查线索，当前追查到第${String(call)}处站台。`, choices }
    }, async (_harness, send) => {
      for (let turn = 0; turn < 5; turn += 1) {
        const sent = await send({ message: "继续完善当前章梗概" })
        expect(sent.autoContinue).toBeDefined()
      }
    })
  })

  it("does not count a successful planning update as a failed no-progress turn", async () => {
    const stagnant = "# 第一章 剧情梗概\n\n林烬在旧站台找到信件，并决定追查失踪者。"
    await withScript((call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        synopsisBody: call === 1
          ? stagnant
          : stagnant,
        choices,
      }
    }, async (_harness, send) => {
      const extra = { message: "继续完善当前章规划", noProgressGuardEnabled: true }
      for (let turn = 0; turn < 3; turn += 1) expect((await send(extra)).autoContinue).toBeDefined()
      await expect(send(extra)).rejects.toThrow(/3.*没有实际内容进展.*停止/)
    })
  })

  it("persists batch confirmation before saving a draft from an unconfirmed synopsis", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, choices }
    }, async (harness, send) => {
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      database.prepare("update synopsis_conversation_sessions set synopsis_confirmed_at_ms = null where project_id = ?").run(harness.projectId)
      database.close()
      const sent = await send()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.synopsisConfirmedAtMs).toBeDefined()
      expect(sent.messages.at(-1)?.content).not.toContain("已自动延后")
    })
  })

  it("confirms a synopsis rewritten in the same batch turn before storing its draft", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return {
        synopsisBody: "# 第一章 雨夜旧站台 剧情梗概\n\n林烬在旧站台发现信，必须在列车驶来前决定是否追查失踪者。",
        outlineBody: "# 第一章 雨夜旧站台 剧情细纲\n\n- 章定位：发现信。\n- 分场：进入站台，辨认字迹，决定追查。\n- 人物准备：林烬与失踪者。",
        chapterDraftProposal: draft, choices,
      }
    }, async (_harness, send) => {
      const sent = await send()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.synopsisConfirmedAtMs).toBeDefined()
    })
  })

  it("reports the real draft gate failure and blocks automatic continuation", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, continueTurn: true, choices }
    }, async (_harness, send) => {
      const rejected = vi.spyOn(ChapterRevisionService.prototype, "startForChapterSequence")
        .mockRejectedValueOnce(new RevisionInvalidStateError("本章必须先完成剧情梗概"))
      try {
        const sent = await send()
        expect(sent.appendedDraft).toBeUndefined()
        expect(sent.autoContinue).toBeUndefined()
        expect(sent.messages.at(-1)?.content).toContain("本章必须先完成剧情梗概")
        expect(sent.messages.at(-1)?.content).not.toContain("已自动延后")
        expect(sent.messages.at(-1)?.choices?.length).toBeGreaterThan(0)
      } finally {
        rejected.mockRestore()
      }
    })
  })

  it("continues productive discussion past the advisory and old attempt limits", async () => {
    let calls = 0
    await withScript((call, request, options) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      expect(options?.contextMessages?.some((message) => message.content.includes("这是最后一轮模型调用"))).toBe(false)
      if (call > 33) expect(peekSynopsisModelBudgetAdvisory(request.projectId)?.callsUsed).toBe(call - 1)
      if (call === 1) return tool("memory_write")
      if (call < 76) return tool("memory_write", "invoke", {
        target: "index", markdown: `# 记忆\n\n已经核对第${String(call)}项不同的线索。`,
      })
      return { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      const sent = await send()
      expect(calls).toBe(76)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.budgetAdvisory).toMatchObject({ callsUsed: 76, softLimit: 33 })
      expect(sent.messages.at(-1)?.content).not.toContain("预算已耗尽")
    })
  })

  it("retries one phase-contract error at the advisory threshold and still saves the draft", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      if (call === 34) expect(synopsisConversationStreamHub.peek(request.projectId, request.taskId).todos)
        .toEqual(todos.map((todo) => ({ ...todo, status: "completed" })))
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (call === 1) return tool("memory_write")
      if (call < 33) return tool("memory_write", "invoke", {
        target: "index", markdown: `# 记忆\n\n已经核对第${String(call)}项不同的线索。`,
      })
      if (call === 33) throw Object.assign(new Error("DeepSeek response could not satisfy the phase contract: reason / selfReview missing"), { kind: "schema" })
      return { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      const sent = await send()
      expect(calls).toBe(34)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.budgetAdvisory).toBeDefined()
      expect(sent.messages.at(-1)?.content).not.toContain("混合提交")
    })
  })

  it("counts retrieval rounds separately from productive tool calls", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      if (call === 1) return tool("memory_write")
      if (call < 7) return tool("memory_write", "invoke", {
        target: "index", markdown: `# 记忆\n\n已经核对第${String(call)}项不同的线索。`,
      })
      if (call === 7) return { requestedReads: [{
        requestId: randomUUID(), reason: "读取暂存区说明", expectedEvidence: "暂存区说明",
        query: { exactKeys: ["暂存区/readme.md"], semanticTexts: [], anchorIds: [], directions: ["both"],
          maxCandidates: 2, maxDepth: 1, sourceKinds: ["reference"] },
      }] }
      expect((request.input as TurnPhaseInput).readEvidence.some((item) => item.ownerId === "暂存区/readme.md")).toBe(true)
      return { chapterDraftProposal: draft, choices }
    }, async (harness, send) => {
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Test runtime is not open")
      const settings = await runtime.readSettings()
      await runtime.saveSettings({ ...settings, execution: { ...settings.execution, maxRetrievalRounds: 1 } })
      const sent = await send()
      expect(calls).toBe(8)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.budgetAdvisory).toMatchObject({ softLimit: 4 })
    })
  })

  it("still stops on three consecutive contract failures instead of reporting budget exhaustion", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      throw Object.assign(new Error("DeepSeek response could not satisfy the phase contract: reason / selfReview missing"), { kind: "schema" })
    }, async (_harness, send) => {
      await expect(send({ noProgressGuardEnabled: true })).rejects.toThrow(/model_contract 连续失败 3 次.*reason \/ selfReview missing/)
      expect(calls).toBe(3)
    })
  })

  it("honors an explicit call budget, grants one final call, and blocks automatic restart", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos, Date.now())
      return tool("memory_write")
    }, async (_harness, send) => {
      const sent = await send({ maxModelCalls: 2 })
      expect(calls).toBe(3)
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.messages.at(-1)?.content).toContain("调用预算")
      expect(sent.messages.at(-1)?.todos?.[0]?.status).toBe("in_progress")
    })
  })

  it("stops identical todo updates after one repair and does not mark the work completed", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      return call === 1 ? tool("todo_write") : tool("todo_write", "invoke", { todos, merge: true })
    }, async (harness, send) => {
      await expect(send({ noProgressGuardEnabled: true })).rejects.toThrow(/todo_no_progress.*3.*停止/)
      expect(calls).toBe(5)
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"), { readonly: true })
      try {
        const saved = database.prepare("select todos_json from synopsis_conversation_messages where role = 'assistant' order by created_at_ms desc limit 1")
          .get() as { todos_json: string }
        expect(JSON.parse(saved.todos_json)[0]?.status).toBe("in_progress")
      } finally {
        database.close()
      }
      expect(await harness.container.getCurrentRuntime()?.createChapterRevisionService().listUnpublished(harness.projectId)).toHaveLength(0)
    })
  })

  it("accepts a real draft after the todo repair without automatically reopening the loop", async () => {
    let calls = 0
    await withScript((call, _request, options) => {
      calls = call
      const repairing = options?.contextMessages?.some((message) => message.content.includes("todo_write 已连续")) === true
      if (repairing) return { chapterDraftProposal: draft, choices }
      return call === 1 ? tool("todo_write") : tool("todo_write", "invoke", { todos, merge: true })
    }, async (_harness, send) => {
      const sent = await send({ noProgressGuardEnabled: true })
      expect(calls).toBeLessThanOrEqual(7)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.draftContentState).toBe("ai_written")
      expect(sent.autoContinue).toBeUndefined()
    })
  })

  it("bounds repeated descriptions even when the todo list is empty", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      return tool("todo_write")
    }, async (_harness, send) => {
      await expect(send({ noProgressGuardEnabled: true })).rejects.toThrow(/todo_write.*describe_no_progress.*3.*停止/)
      expect(calls).toBe(4)
    })
  })

  it("bounds continuous todo rewrites even if every rewrite changes the plan", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      return call === 1 ? tool("todo_write") : tool("todo_write", "invoke", {
        todos: [{ ...todos[0], content: `反复整理计划 ${String(call)}` }], merge: false,
      })
    }, async (_harness, send) => {
      const sent = await send({ noProgressGuardEnabled: true })
      expect(calls).toBe(9)
      expect(sent.autoContinue).toBeUndefined()
    })
  })

  it("keeps a workflow-created draft reference when the discussion budget runs out", async () => {
    let calls = 0
    await withScript((call) => {
      calls = call
      if (call === 1) return tool("todo_write")
      if (call === 2) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 3) return tool("chapter_workflow")
      if (call === 4) return tool("chapter_workflow", "invoke", { userInput: "林烬在雨夜站台找到失踪者留下的信。" })
      return call === 5 ? tool("memory_write") : tool("memory_write", "invoke", {
        target: "index", markdown: `# 记忆\n\n当前已核对第${String(call)}项线索。`,
      })
    }, async (harness, send) => {
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Test runtime is not open")
      const settings = await runtime.readSettings()
      await runtime.saveSettings({ ...settings, creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true } })
      const sent = await send({ maxModelCalls: 24 })
      expect(calls).toBe(25)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.draftVersionId).toBe(sent.appendedDraft?.draftVersionId)
      expect(sent.autoContinue).toBeUndefined()
      const drafts = await runtime.createChapterRevisionService().listUnpublished(harness.projectId)
      expect(drafts.some((item) => item.revisionTaskId === sent.appendedDraft?.revisionTaskId)).toBe(true)
    })
  }, 30_000)

  it("allows the last grace call to deliver a valid draft", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? tool("memory_write") : { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      const sent = await send({ maxModelCalls: 1, batchProceed: false })
      expect(calls).toBe(2)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
    })
  })

  it("keeps normal todo, tool, completion, and draft delivery working", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      expect((request.input as TurnPhaseInput).synopsisDiscuss?.synopsisConfirmed).toBe(true)
      if (call === 1) return tool("todo_write")
      if (call === 2) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 3) return tool("memory_write")
      if (call === 4) return tool("todo_write", "invoke", { todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true })
      return { chapterDraftProposal: draft, choices }
    }, async (_harness, send) => {
      const sent = await send({ batchProceed: false })
      expect(calls).toBe(5)
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.draftContentState).toBe("ai_written")
    })
  })

  it("reports a graph execution failure after draft confirmation without another approval", async () => {
    const timeoutMessage = "模型连续 120 秒未返回数据，已停止本次图同步，可重试。"
    await withScript((call) => {
      if (call === 1) return tool("todo_write")
      if (call === 2) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 3) return tool("chapter_workflow")
      if (call === 4) return tool("chapter_workflow", "invoke", { userInput: "在雨夜站台找到一封信。" })
      if (call === 5) return tool("todo_write", "invoke", { todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true })
      return { choices }
    }, async (harness, send) => {
      const original = FakeAiModelAdapter.prototype.execute
      const execution = vi.spyOn(FakeAiModelAdapter.prototype, "execute").mockImplementation(function (request, options) {
        if (request.phase === "graph_governance") return Promise.reject(new Error(timeoutMessage))
        return original.call(this, request, options)
      })
      try {
        const runtime = harness.container.getCurrentRuntime()!
        const settings = await runtime.readSettings()
        await runtime.saveSettings({ ...settings, creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true } })
        const drafted = await send({ maxModelCalls: 40, batchProceed: false })
        expect(drafted.autoContinue).toBeUndefined()
        expect(drafted.messages.at(-1)?.choices?.[0]?.action).toBe("promote_draft_to_body")
        const published = await send({ message: "草稿可以，发布正文",
          publishDraftVersionId: drafted.messages.at(-1)?.choices?.[0]?.publishDraftVersionId,
          maxModelCalls: 40, batchProceed: false })
        expect(published.messages.at(-1)?.content).toContain("无需重复确认正文")
        expect(published.messages.at(-1)?.content).toContain(timeoutMessage)
        expect(published.autoContinue).toBeUndefined()
        expect((await runtime.listGraphRevisionTasks())[0]).toMatchObject({ status: "failed", error: timeoutMessage, blocksTurn: true })
        const chapters = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "chapter.list",
          payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef } })
        expect(chapters.ok && chapters.data).toEqual([])
      } finally { execution.mockRestore() }
    })
  })

  it.each([false, true])("confirms the draft once, then runs review and graph governance before publishing (batchProceed=%s)", async (batchProceed) => {
    await withScript((call) => {
      if (call === 1) return tool("todo_write")
      if (call === 2) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 3) return tool("chapter_workflow")
      if (call === 4) return tool("chapter_workflow", "invoke", { userInput: "林烬在雨夜站台找到失踪者留下的信。" })
      if (call === 5) return tool("todo_write", "invoke", { todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true })
      return { choices }
    }, async (harness, send) => {
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Test runtime is not open")
      const settings = await runtime.readSettings()
      await runtime.saveSettings({ ...settings, creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true } })
      const drafted = await send({ maxModelCalls: 40, batchProceed })
      expect(drafted.autoContinue).toBeUndefined()
      expect(drafted.messages.at(-1)?.choices?.[0]?.action).toBe("promote_draft_to_body")
      const sent = await send({ message: "草稿可以，发布正文",
        publishDraftVersionId: drafted.messages.at(-1)?.choices?.[0]?.publishDraftVersionId, maxModelCalls: 40, batchProceed })
      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "chapter.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!response.ok) throw new Error(response.error.message)
      expect(response.data).toHaveLength(1)
      expect(sent.messages.at(-1)?.content).toContain("正文已落盘")
      expect(sent.messages.at(-1)?.toolRuns?.some((run) => run.name === "publish_draft")).toBeFalsy()
      if (batchProceed) {
        expect(sent.autoContinue?.message).toContain("正文已发布")
        expect(sent.autoContinue?.message).toContain("本轮只切换焦点")
        expect(sent.autoContinue?.message).not.toContain("publish_draft")
      } else {
        expect(sent.autoContinue).toBeUndefined()
      }
    })
  })
})
