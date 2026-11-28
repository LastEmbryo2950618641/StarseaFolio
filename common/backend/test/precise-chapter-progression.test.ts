import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import type { DiscussTurnWriteScope } from "@starseafolio/prompt-contracts"
import type { AIModelPort, DiscussTurnClassificationInput, TurnPhaseInput } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { digest } from "../src/core/index.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import {
  confirmedVolumeStorylineFixture,
  openChapterHarness,
  prepareChapterPlanning,
  type ChapterHarness,
} from "./helpers/chapter-coordination-harness.js"

const EMPTY_SYNOPSIS = "# 第一章 雨夜旧站台 剧情梗概\n\n"
const EMPTY_OUTLINE = "# 第一章 雨夜旧站台 剧情细纲\n\n"

const composeSynopsis = "# 第一章 雨夜旧站台 剧情梗概\n\n林烬在末班车广播前追上失踪者留下的线索。"
const composeOutline = "# 第一章 雨夜旧站台 剧情细纲\n\n- 章定位：雨夜站台的选择。\n- 场1：广播响起，林烬发现车票背面有字。"
const composeDraft = "广播响了三遍。林烬把车票按在掌心，最后上了车。"
const revisedDraft = "广播响了三遍。林烬把车票折好放进口袋，转身走进雨里。"

function composeText(input: Readonly<{ synopsis?: string; outline?: string; draft?: string }>): string {
  return [
    input.synopsis === undefined ? undefined : `<compose-synopsis>\n${input.synopsis}\n</compose-synopsis>`,
    input.outline === undefined ? undefined : `<compose-outline>\n${input.outline}\n</compose-outline>`,
    input.draft === undefined ? undefined : `<compose-draft>\n# 第一章 雨夜旧站台\n\n${input.draft}\n</compose-draft>`,
  ].filter((part): part is string => part !== undefined).join("\n\n")
}

const composeAll = composeText({ synopsis: composeSynopsis, outline: composeOutline, draft: composeDraft })

type DiscussCall = Readonly<{
  chapterSequence: number
  prompt: string
  context: string
  authorMessage: string | null | undefined
}>
type PhaseCall = Readonly<{ phase: string; prompt: string }>

/**
 * Scripted synopsis_discuss model. Non-discuss phases delegate to the deterministic fake so
 * publish/review pipelines keep working. `reply` returns the tagged plain-text response.
 */
function createPreciseModel(input: Readonly<{
  classifier?: (message: string) => DiscussTurnWriteScope
  classifyCalls?: string[]
  discussCalls?: DiscussCall[]
  phaseCalls?: PhaseCall[]
  reply?: (call: DiscussCall) => string | undefined
}>): AIModelPort {
  const delegate = new FakeAiModelAdapter(randomUUID)
  return {
    info: delegate.info,
    ...(input.classifier === undefined ? {} : {
      classifyDiscussTurn(args: DiscussTurnClassificationInput) {
        input.classifyCalls?.push(args.message)
        return Promise.resolve({
          scope: input.classifier!(args.message),
          usage: { inputTokens: 5, outputTokens: 5, latencyMs: 0, modelCalls: 1 },
        })
      },
    }),
    async execute(request, options) {
      if (request.phase !== "synopsis_discuss") {
        input.phaseCalls?.push({ phase: request.phase, prompt: options?.phasePrompt?.text ?? "" })
        return delegate.execute(request, options)
      }
      const discuss = (request.input as TurnPhaseInput).synopsisDiscuss
      const call = {
        chapterSequence: discuss?.chapterSequence ?? 1,
        prompt: options?.phasePrompt?.text ?? "",
        context: (options?.contextMessages ?? []).map((message) => message.content).join("\n"),
        authorMessage: options?.authorMessage,
      }
      input.discussCalls?.push(call)
      synopsisConversationStreamHub.setTodos(request.projectId, [
        { id: "write", content: "核对用户本轮要求", status: "completed" },
      ], Date.now())
      return {
        result: {
          schemaVersion: 1,
          envelopeId: request.envelopeId,
          contextId: request.contextId,
          phase: request.phase,
          outcome: "continue",
          requestedReads: [],
          citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [],
          decisionRecordIds: [],
          unresolvedDependencies: [],
          reason: "Fixture",
          selfReview: "Fixture",
          artifact: {
            assistantMessage: input.reply?.(call) ?? "我们就按当前方向继续讨论。",
            finalSelfReview: "Fixture",
          },
        },
        usage: { inputTokens: 10, outputTokens: 10, latencyMs: 0, modelCalls: 1 },
      }
    },
  }
}

async function invoke<T>(harness: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload },
  })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

async function send(harness: ChapterHarness, payload: Record<string, unknown>): Promise<SynopsisConversationSendResult> {
  return invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", {
    maxModelCalls: 40,
    ...payload,
  })
}

async function expectSendRejects(
  harness: ChapterHarness,
  payload: Record<string, unknown>,
  messagePattern: RegExp,
): Promise<void> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "synopsis.conversation.send",
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, maxModelCalls: 40, ...payload },
  })
  expect(response.ok).toBe(false)
  if (!response.ok) expect(response.error.message).toMatch(messagePattern)
}

async function clearChapterPlanningMaterials(harness: ChapterHarness): Promise<string> {
  const path = (await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.list", {})).session.synopsisPath
  const outlinePath = path.replace("[剧情梗概].md", "[剧情细纲].md")
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, path, EMPTY_SYNOPSIS)
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, outlinePath, EMPTY_OUTLINE)
  const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
  try {
    database.prepare(`
      update synopsis_conversation_sessions
      set synopsis_confirmed_at_ms = null, last_agent_digest = ?, last_outline_agent_digest = ?, focus_kind = 'plot_synopsis'
      where project_id = ? and chapter_sequence = 1
    `).run(digest(EMPTY_SYNOPSIS), digest(EMPTY_OUTLINE), harness.projectId)
  } finally {
    database.close()
  }
  return path
}

async function closeHarness(harness: ChapterHarness): Promise<void> {
  await harness.container.close()
  rmSync(harness.root, { recursive: true, force: true })
}

describe("precise chapter progression", () => {
  it("start_compose bypasses the classifier, carries prior discussion into model history, and writes all three artifacts", async () => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    let replies = 0
    const model = createPreciseModel({
      classifier: (message) => {
        if (message === "开始构思") throw new Error("explicit precise start must bypass the classifier")
        return {}
      },
      classifyCalls,
      discussCalls,
      reply: () => {
        replies += 1
        return replies === 1 ? "本章要写林烬在雨夜站台追查失踪者留下的信。" : composeAll
      },
    })
    const harness = await openChapterHarness("Precise start compose", { model })
    try {
      await prepareChapterPlanning(harness)
      const requirements = "本章要写林烬在雨夜站台追查失踪者留下的信，结尾停在末班车启动。"
      await send(harness, { message: requirements, proceedMode: "precise" })
      const sent = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })

      expect(classifyCalls).toEqual([requirements])
      expect(sent.appendedDraft).toBeDefined()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.proceedProgress).toEqual({ stage: "draft_discuss", status: "waiting" })
      expect(sent.autoContinue).toBeUndefined()
      // The synthetic Start label must not erase the new chapter requirements typed before it.
      expect(discussCalls).toHaveLength(2)
      expect(discussCalls[0]?.authorMessage).toBe(requirements)
      // 讨论底稿始终是完整讨论文档，本身含构思协议；开始构思那一轮再追加构思阶段提示。
      expect(discussCalls[0]?.prompt).toContain("创作台构思的回复协议")
      expect(discussCalls[0]?.prompt).not.toContain("先用当前卷的信息")
      // 点「开始构思」也是用户消息：作者原文照常连同消息前后进入上下文。
      expect(discussCalls[1]?.authorMessage).toBe("开始构思")
      expect(discussCalls[1]?.prompt).toContain("完整构思默认一次交齐")
      expect(discussCalls[1]?.context).toContain("开始构思前的本章要求")
      expect(discussCalls[1]?.context).toContain(requirements)

      const synopsis = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, sent.session.synopsisPath)
      expect(synopsis).toContain("末班车广播前追上失踪者留下的线索")
      const outlinePath = sent.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, outlinePath))
        .toContain("林烬发现车票背面有字")

      const assistant = sent.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("已完成构思")
      expect(assistant?.choices?.map((choice) => choice.action)).toEqual([
        "promote_draft_to_body",
        "discuss_only",
      ])
      expect(assistant?.choices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "promote_draft_to_body",
          publishDraftVersionId: sent.appendedDraft?.draftVersionId,
          chapterSequence: 1,
        }),
        expect.objectContaining({ action: "discuss_only", chapterSequence: 1 }),
      ]))
      expect(assistant?.choices?.some((choice) => choice.action === "start_compose")).toBe(false)
    } finally {
      await closeHarness(harness)
    }
  })

  it("rejects an incomplete start_compose response without writing anything", async () => {
    const model = createPreciseModel({
      reply: () => composeText({ synopsis: composeSynopsis, outline: composeOutline }),
    })
    const harness = await openChapterHarness("Precise incomplete compose", { model })
    try {
      await prepareChapterPlanning(harness)
      const listed = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.list", {})
      const synopsisBefore = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, listed.session.synopsisPath)
      await expectSendRejects(
        harness,
        { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" },
        /梗概|细纲|草稿|构思/u,
      )
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, listed.session.synopsisPath))
        .toBe(synopsisBefore)
      const reloaded = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.list", {})
      expect(reloaded.session.draftVersionId).toBeUndefined()
    } finally {
      await closeHarness(harness)
    }
  })

  it("keeps ordinary precise text inside the stage: AI may offer compose, but does not start missing materials or publish", async () => {
    const classifyCalls: string[] = []
    const model = createPreciseModel({
      classifier: (message) => message.includes("先写梗概") ? { startCompose: true } : {},
      classifyCalls,
      reply: () => "我们先讨论这一章想写什么，暂不落盘。",
    })
    const harness = await openChapterHarness("Precise ordinary text guard", { model })
    try {
      await prepareChapterPlanning(harness)
      const synopsisPath = await clearChapterPlanningMaterials(harness)
      const sent = await send(harness, { message: "先写梗概", proceedMode: "precise" })
      expect(sent.appendedDraft).toBeUndefined()
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, synopsisPath)).toBe(EMPTY_SYNOPSIS)
      const assistant = sent.messages.filter((message) => message.role === "assistant").at(-1)
      expect(classifyCalls).toEqual(["先写梗概"])
      expect(assistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])
      expect(assistant?.choices?.every((choice) => choice.chapterSequence === 1)).toBe(true)

      await send(harness, { message: "发布正文", proceedMode: "precise" })
      expect(classifyCalls).toEqual(["先写梗概", "发布正文"])
      const chapters = await invoke<unknown[]>(harness, "chapter.list", {})
      expect(chapters).toEqual([])
    } finally {
      await closeHarness(harness)
    }
  })

  it.each([false, true])("revises an existing draft in place even when routing also requests synopsis (extra=%s)", async (extra) => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    let replies = 0
    const model = createPreciseModel({
      classifier: () => extra ? { synopsis: "rewrite", draft: "write" } : { draft: "write" },
      classifyCalls,
      discussCalls,
      reply: () => {
        replies += 1
        return replies === 1 ? composeAll : composeText({ draft: revisedDraft })
      },
    })
    const harness = await openChapterHarness("Precise in-stage draft revision", { model })
    try {
      await prepareChapterPlanning(harness)
      const first = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const firstVersion = first.appendedDraft?.draftVersionId
      expect(firstVersion).toBeTruthy()
      const outlinePath = first.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      const outlineBefore = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, outlinePath)
      const synopsisBefore = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, first.session.synopsisPath)

      const revised = await send(harness, { message: "把草稿结尾改冷一点", proceedMode: "precise" })
      expect(classifyCalls).toEqual(["把草稿结尾改冷一点"])
      expect(revised.appendedDraft?.draftVersionId).toBeTruthy()
      expect(revised.appendedDraft?.draftVersionId).not.toBe(firstVersion)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, outlinePath)).toBe(outlineBefore)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, first.session.synopsisPath)).toBe(synopsisBefore)
      // The revision used a draft-only compose scope, not a full re-composition.
      expect(discussCalls.at(-1)?.prompt).toContain("仅可交付")
    } finally {
      await closeHarness(harness)
    }
  })

  it.each(["outline", "both"] as const)("recovers missing planning from an old draft through complete composition (%s)", async (missing) => {
    const classifyCalls: string[] = []
    let draft = composeDraft
    const discussCalls: DiscussCall[] = []
    const model = createPreciseModel({
      classifyCalls,
      discussCalls,
      classifier: () => ({ draft: "write" }),
      reply: ({ prompt }) => prompt.includes("一次生成并交齐")
        ? composeText({ synopsis: composeSynopsis, outline: composeOutline, draft })
        : "我们先核对本章的构思要求。",
    })
    const harness = await openChapterHarness("Precise legacy planning recovery", { model })
    try {
      await prepareChapterPlanning(harness)
      const first = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const oldVersion = first.appendedDraft?.draftVersionId
      expect(oldVersion).toBeDefined()
      const outlinePath = first.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, outlinePath, EMPTY_OUTLINE)
      if (missing === "both") {
        await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, first.session.synopsisPath, EMPTY_SYNOPSIS)
      }
      const callsBeforeRecovery = discussCalls.length
      const recovery = await send(harness, { message: "只改草稿结尾", proceedMode: "precise" })
      expect(discussCalls).toHaveLength(callsBeforeRecovery)
      expect(recovery.appendedDraft).toBeUndefined()
      expect(recovery.messages.filter((message) => message.role === "assistant").at(-1)?.choices?.map((choice) => choice.action))
        .toEqual(["start_compose", "discuss_only"])
      expect(classifyCalls).toEqual([])
      await expectSendRejects(harness, { message: "发布正文", proceedMode: "precise", preciseAction: "publish", publishDraftVersionId: oldVersion }, /构思材料缺失/u)
      draft = revisedDraft
      const recovered = await send(harness, { message: "复原本章", proceedMode: "precise", preciseAction: "start_compose" })
      expect(recovered.appendedDraft?.draftVersionId, recovered.messages.at(-1)?.content).toBeTruthy()
      expect(recovered.appendedDraft?.draftVersionId).not.toBe(oldVersion)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, outlinePath)).toContain("林烬发现车票背面有字")
      expect(recovered.messages.filter((message) => message.role === "assistant").at(-1)?.choices?.[0]?.publishDraftVersionId)
        .toBe(recovered.appendedDraft?.draftVersionId)
    } finally {
      await closeHarness(harness)
    }
  })

  it("keeps 只讨论 as a local acknowledgment with no forced host controls and no model call", async () => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    const model = createPreciseModel({ classifier: () => ({}), classifyCalls, discussCalls })
    const harness = await openChapterHarness("Precise discuss only", { model })
    try {
      await prepareChapterPlanning(harness)
      const sent = await send(harness, { message: "仅讨论", proceedMode: "precise", preciseAction: "discuss_only" })
      expect(discussCalls).toEqual([])
      expect(classifyCalls).toEqual([])
      const assistant = sent.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("仅讨论模式")
      expect(assistant?.choices === undefined || assistant.choices.length === 0).toBe(true)
    } finally {
      await closeHarness(harness)
    }
  })

  it("when classifier detects compose intent, offers start_compose even if a publishable draft already exists", async () => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    const model = createPreciseModel({
      classifier: () => ({ startCompose: true }),
      classifyCalls,
      discussCalls,
      reply: () => composeAll,
    })
    const harness = await openChapterHarness("Precise AI compose offer with draft", { model })
    try {
      await prepareChapterPlanning(harness)
      const composed = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      expect(composed.appendedDraft?.draftVersionId).toBeTruthy()
      const discussCallsBefore = discussCalls.length

      const offered = await send(harness, { message: "整章重写，换成雨夜对峙开场", proceedMode: "precise" })
      expect(classifyCalls).toEqual(["整章重写，换成雨夜对峙开场"])
      expect(discussCalls).toHaveLength(discussCallsBefore)
      expect(offered.appendedDraft).toBeUndefined()
      const assistant = offered.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("已收到本章要求")
      expect(assistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])
      expect(assistant?.choices?.some((choice) => choice.action === "promote_draft_to_body")).toBe(false)
    } finally {
      await closeHarness(harness)
    }
  })

  it("when classifier detects publish intent, offers promote_draft instead of auto-publishing", async () => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    const model = createPreciseModel({
      classifier: () => ({ publish: true }),
      classifyCalls,
      discussCalls,
      reply: () => composeAll,
    })
    const harness = await openChapterHarness("Precise AI publish offer", { model })
    try {
      await prepareChapterPlanning(harness)
      const composed = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const draftVersionId = composed.appendedDraft?.draftVersionId
      expect(draftVersionId).toBeTruthy()
      const discussCallsBefore = discussCalls.length

      const offered = await send(harness, { message: "草稿可以，发布正文", proceedMode: "precise" })
      expect(classifyCalls).toEqual(["草稿可以，发布正文"])
      expect(discussCalls).toHaveLength(discussCallsBefore)
      expect(offered.appendedDraft).toBeUndefined()
      expect(await invoke<unknown[]>(harness, "chapter.list", {})).toEqual([])
      const assistant = offered.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("要发布当前草稿")
      expect(assistant?.choices?.map((choice) => choice.action)).toEqual(["promote_draft_to_body", "discuss_only"])
      expect(assistant?.choices?.[0]).toEqual(expect.objectContaining({
        action: "promote_draft_to_body",
        publishDraftVersionId: draftVersionId,
        chapterSequence: 1,
      }))
      expect(assistant?.choices?.some((choice) => choice.action === "start_compose")).toBe(false)
    } finally {
      await closeHarness(harness)
    }
  })

  it("binds publish to the current version, rejects legacy publish in precise mode, and focuses next without writing", async () => {
    const discussCalls: DiscussCall[] = []
    const phaseCalls: PhaseCall[] = []
    let replies = 0
    const model = createPreciseModel({
      discussCalls,
      phaseCalls,
      reply: () => {
        replies += 1
        return replies === 1 ? composeAll : "第二章先对齐要求：主角下车后沿线索追查。"
      },
    })
    const harness = await openChapterHarness("Precise publish", { model })
    try {
      await prepareChapterPlanning(harness)
      const composed = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const draftVersionId = composed.appendedDraft?.draftVersionId
      expect(draftVersionId).toBeTruthy()
      const discussCallsBeforePublish = discussCalls.length

      // Legacy version-bound publish must not cross the stage in explicit precise mode.
      await expectSendRejects(
        harness,
        { message: "发布正文", proceedMode: "precise", publishDraftVersionId: draftVersionId },
        /精准推进只能通过「发布正文」按钮/u,
      )
      expect(await invoke<unknown[]>(harness, "chapter.list", {})).toEqual([])

      const published = await send(harness, {
        message: "发布正文",
        proceedMode: "precise",
        preciseAction: "publish",
        publishDraftVersionId: draftVersionId,
        chapterSequence: 1,
      })
      expect(published.session.chapterSequence).toBe(2)
      expect(published.session.draftVersionId).toBeUndefined()
      expect((await invoke<unknown[]>(harness, "chapter.list", {})).length).toBe(1)
      // Focus moved but the next chapter was not composed and starts with chapter requirements.
      expect(discussCalls).toHaveLength(discussCallsBeforePublish + 1)
      expect(discussCalls.at(-1)?.chapterSequence).toBe(2)
      expect(discussCalls.at(-1)?.authorMessage).toBeNull()
      expect(discussCalls.at(-1)?.prompt).toContain("先用当前卷的信息")
      expect(discussCalls.at(-1)?.prompt).toContain("主线和支线")
      expect(discussCalls.at(-1)?.prompt).not.toContain("完整构思默认一次交齐")
      expect(phaseCalls.length).toBeGreaterThan(1)
      for (const call of phaseCalls) {
        expect(call.prompt, call.phase).toContain("以作者确认发布的当前章草稿版本为准")
      }
      expect(published.proceedProgress).toEqual({ stage: "chapter_requirements", status: "waiting" })
      const assistant = published.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("已将讨论焦点移到第2章")
      expect(assistant?.content).toContain("新章要求阶段")
      // No Start/publish controls before the user discusses the new chapter requirements.
      expect(assistant?.choices === undefined || assistant.choices.length === 0).toBe(true)
      const chapterTwoOutline = published.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      const outlineExists = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, chapterTwoOutline)
        .catch(() => "")
      expect(outlineExists.trim()).toBe("")

      // 普通讨论不必点选；无分类器意图时不硬挂开始构思/发布。
      const discussed = await send(harness, { message: "第二章要写他下车后沿线索追查", proceedMode: "precise" })
      expect(discussCalls.at(-1)?.authorMessage).toBe("第二章要写他下车后沿线索追查")
      // 新章阶段提示已在上一次代码发起的阶段入口写入链里；讨论链只追加，这里仍能在上下文里看到。
      expect(discussCalls.at(-1)?.context).toContain("先用当前卷的信息")
      expect(discussed.proceedProgress?.stage).toBe("chapter_requirements")
      const discussedAssistant = discussed.messages.filter((message) => message.role === "assistant").at(-1)
      expect(discussedAssistant?.choices?.some((choice) => choice.action === "start_compose")).toBeFalsy()
      expect(discussedAssistant?.choices?.some((choice) => choice.action === "promote_draft_to_body")).toBeFalsy()
    } finally {
      await closeHarness(harness)
    }
  })

  it("keeps the volume-cap guard after publish and never shows Start on the published chapter", async () => {
    const discussCalls: DiscussCall[] = []
    const model = createPreciseModel({ discussCalls, reply: () => composeAll })
    const harness = await openChapterHarness("Precise volume cap", { model })
    try {
      await prepareChapterPlanning(harness)
      await harness.container.workspace.saveUserMarkdown(
        harness.workspaceRootRef,
        "大纲/第一卷 待命名.批量计划.md",
        serializeVolumePlanningState({
          ...confirmedVolumeStorylineFixture,
          volumeFolderName: "第一卷 待命名",
          startSequence: 1,
          targetChapterCount: 1,
          targetWordCount: 3_000,
          synopsisWriteCount: 1,
          outlineWriteCount: 1,
        }),
      )
      const composed = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const published = await send(harness, {
        message: "发布正文",
        proceedMode: "precise",
        preciseAction: "publish",
        publishDraftVersionId: composed.appendedDraft?.draftVersionId,
        chapterSequence: 1,
      })
      // Volume cap keeps focus on the published chapter and issues the existing next-volume prompt.
      expect(published.session.chapterSequence).toBe(1)
      expect(published.autoContinue?.message).toContain("本卷计划章节已全部发布")
      expect(published.autoContinue?.message).toContain("标记卷末")
      const assistant = published.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.choices === undefined || assistant.choices.length === 0).toBe(true)
    } finally {
      await closeHarness(harness)
    }
  })

  it("rejects stale precise actions whose chapter binding no longer matches focus", async () => {
    const model = createPreciseModel({ discussCalls: [], reply: () => composeAll })
    const harness = await openChapterHarness("Precise stale binding", { model })
    try {
      await prepareChapterPlanning(harness)
      await expectSendRejects(
        harness,
        { message: "仅讨论", proceedMode: "precise", preciseAction: "discuss_only", chapterSequence: 2 },
        /已过期/u,
      )
    } finally {
      await closeHarness(harness)
    }
  })

  it("renames the published chapter via rename_chapter without asking choices", async () => {
    const classifyCalls: string[] = []
    const discussCalls: DiscussCall[] = []
    let renameStep = 0
    const model = createPreciseModel({
      classifier: () => ({ chapterTitle: true }),
      classifyCalls,
      discussCalls,
      reply: ({ prompt }) => {
        if (prompt.includes("完整构思") || prompt.includes("一次生成并交齐")) return composeAll
        expect(prompt).toContain("rename_chapter")
        expect(prompt).toContain("直接改当前章标题")
        renameStep += 1
        if (renameStep === 1) {
          return [
            "先改章名。",
            "<tool-request>",
            "name: rename_chapter",
            "action: describe",
            "</tool-request>",
          ].join("\n")
        }
        if (renameStep === 2) {
          return [
            "正在改名。",
            "<tool-request>",
            "name: rename_chapter",
            "action: invoke",
            'arguments: {"title":"圣皇侍院的成立"}',
            "</tool-request>",
          ].join("\n")
        }
        return "已把本章标题改成「圣皇侍院的成立」。"
      },
    })
    const harness = await openChapterHarness("Precise direct chapter title", { model })
    try {
      await prepareChapterPlanning(harness)
      const composed = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })
      const published = await send(harness, {
        message: "发布正文",
        proceedMode: "precise",
        preciseAction: "publish",
        publishDraftVersionId: composed.appendedDraft?.draftVersionId,
        chapterSequence: 1,
      })
      expect((await invoke<Array<{ heading: string }>>(harness, "chapter.list", {})).map((chapter) => chapter.heading))
        .toEqual([expect.stringContaining("雨夜旧站台")])

      // Publish may advance focus; force chapter 1 so rename targets the published body.
      await invoke(harness, "synopsis.conversation.setFocus", { chapterSequence: 1, focusKind: "chapter_body" })
      const renamed = await send(harness, {
        message: "标题不要叫雨夜旧站台，改成圣皇侍院的成立",
        proceedMode: "precise",
        chapterSequence: 1,
      })
      expect(classifyCalls.at(-1)).toContain("圣皇侍院的成立")
      expect(renamed.session.title).toBe("圣皇侍院的成立")
      expect(renamed.session.synopsisPath).toContain("圣皇侍院的成立")
      const chapters = await invoke<Array<{ heading: string; publishPath: string }>>(harness, "chapter.list", {})
      expect(chapters).toHaveLength(1)
      expect(chapters[0]?.heading).toContain("圣皇侍院的成立")
      expect(chapters[0]?.publishPath).toContain("圣皇侍院的成立")
      expect(renameStep).toBeGreaterThanOrEqual(3)
      expect(renamed.session.chapterSequence).toBe(1)
    } finally {
      await closeHarness(harness)
    }
  })
})
