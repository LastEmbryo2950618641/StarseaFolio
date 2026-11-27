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

type DiscussCall = Readonly<{ chapterSequence: number; prompt: string; context: string }>

/**
 * Scripted synopsis_discuss model. Non-discuss phases delegate to the deterministic fake so
 * publish/review pipelines keep working. `reply` returns the tagged plain-text response.
 */
function createPreciseModel(input: Readonly<{
  classifier?: (message: string) => DiscussTurnWriteScope
  classifyCalls?: string[]
  discussCalls?: DiscussCall[]
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
      if (request.phase !== "synopsis_discuss") return delegate.execute(request, options)
      const discuss = (request.input as TurnPhaseInput).synopsisDiscuss
      const call = {
        chapterSequence: discuss?.chapterSequence ?? 1,
        prompt: options?.phasePrompt?.text ?? "",
        context: (options?.contextMessages ?? []).map((message) => message.content).join("\n"),
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
      classifier: () => {
        throw new Error("explicit precise start must bypass the classifier")
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
      const classifyCallsBeforeStart = classifyCalls.length
      const sent = await send(harness, { message: "开始构思", proceedMode: "precise", preciseAction: "start_compose" })

      // Explicit start_compose must bypass the classifier.
      expect(classifyCalls).toHaveLength(classifyCallsBeforeStart)
      expect(sent.appendedDraft).toBeDefined()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.proceedProgress).toEqual({ stage: "draft_discuss", status: "waiting" })
      expect(sent.autoContinue).toBeUndefined()
      // The synthetic Start label must not erase the new chapter requirements typed before it.
      expect(discussCalls).toHaveLength(2)
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

  it("keeps ordinary precise text inside the stage: offers Start only when AI detects compose intent, never writes or publishes without confirmation", async () => {
    const classifyCalls: string[] = []
    let replies = 0
    const model = createPreciseModel({
      classifier: () => {
        throw new Error("router failure must fall back to main AI semantic intent")
      },
      classifyCalls,
      reply: () => {
        replies += 1
        return replies === 1
          ? "我们先讨论这一章想写什么，暂不落盘。"
          : replies === 2
            ? "收到，既然你准备开始落笔，我已准备好进入构思阶段。\n<request-compose/>"
            : "草稿尚未生成，不能直接发布正文。"
      },
    })
    const harness = await openChapterHarness("Precise ordinary text guard", { model })
    try {
      await prepareChapterPlanning(harness)
      const synopsisPath = await clearChapterPlanningMaterials(harness)
      // Pure brainstorming without AI-detected compose intent must NOT pop up Start/Discuss controls.
      const brainstorm = await send(harness, { message: "先聊聊第一章气氛该偏冷还是偏急", proceedMode: "precise" })
      expect(brainstorm.appendedDraft).toBeUndefined()
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, synopsisPath)).toBe(EMPTY_SYNOPSIS)
      const brainstormAssistant = brainstorm.messages.filter((message) => message.role === "assistant").at(-1)
      expect(brainstormAssistant?.choices?.some((choice) => choice.action === "start_compose")).not.toBe(true)

      // When AI semantically recognizes compose/drafting intent (<request-compose/>), host offers Start + Discuss-only without writing.
      const readyToCompose = await send(harness, { message: "方向定好了，我们开始构思落笔吧", proceedMode: "precise" })
      expect(readyToCompose.appendedDraft).toBeUndefined()
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, synopsisPath)).toBe(EMPTY_SYNOPSIS)
      const readyAssistant = readyToCompose.messages.filter((message) => message.role === "assistant").at(-1)
      expect(readyAssistant?.content).not.toContain("<request-compose/>")
      expect(readyAssistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])
      expect(readyAssistant?.choices?.every((choice) => choice.chapterSequence === 1)).toBe(true)

      await send(harness, { message: "发布正文", proceedMode: "precise" })
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

  it("keeps 只讨论 as a local acknowledgment with host controls and no model call", async () => {
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
      expect(assistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])
      expect(assistant?.choices?.every((choice) => choice.chapterSequence === 1)).toBe(true)
    } finally {
      await closeHarness(harness)
    }
  })

  it("binds publish to the current version, rejects legacy publish in precise mode, and focuses next without writing", async () => {
    const discussCalls: DiscussCall[] = []
    let replies = 0
    const model = createPreciseModel({
      discussCalls,
      reply: () => {
        replies += 1
        if (replies === 1) return composeAll
        if (replies === 2) return "已完成第1章主线、目标与卷进度收尾，第2章可从下车后追查线索切入。"
        return "第二章要求已对齐，可以开始构思。\n<request-compose/>"
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
      // Focus moved and host triggered the 新章节阶段 wrap-up/transition call without composing chapter 2.
      expect(discussCalls).toHaveLength(discussCallsBeforePublish + 1)
      expect(discussCalls.at(-1)?.chapterSequence).toBe(2)
      expect(discussCalls.at(-1)?.prompt).toContain("上一章正文已完成章节入库并落盘")
      expect(published.proceedProgress).toEqual({ stage: "chapter_requirements", status: "waiting" })
      const assistant = published.messages.filter((message) => message.role === "assistant").at(-1)
      expect(assistant?.content).toContain("已将讨论焦点移到第2章")
      expect(assistant?.content).toContain("新章要求阶段")
      expect(assistant?.content).toContain("已完成第1章主线、目标与卷进度收尾")
      // No Start/publish controls before the user discusses the new chapter requirements.
      expect(assistant?.choices === undefined || assistant.choices.length === 0).toBe(true)
      const chapterTwoOutline = published.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      const outlineExists = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, chapterTwoOutline)
        .catch(() => "")
      expect(outlineExists.trim()).toBe("")

      // After the user expresses compose intent for chapter 2, the assistant result offers Start.
      const discussed = await send(harness, { message: "第二章要写他下车后沿线索追查，按这个开始构思吧", proceedMode: "precise" })
      expect(discussed.proceedProgress?.stage).toBe("chapter_requirements")
      const discussedAssistant = discussed.messages.filter((message) => message.role === "assistant").at(-1)
      expect(discussedAssistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])
      expect(discussedAssistant?.choices?.every((choice) => choice.chapterSequence === 2)).toBe(true)
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
})
