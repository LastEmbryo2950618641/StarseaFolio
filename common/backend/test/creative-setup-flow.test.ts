import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { openChapterHarness, prepareChapterPlanning, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const harnesses: ChapterHarness[] = []
afterEach(async () => { for (const h of harnesses.splice(0)) await h.container.close() })

async function invoke<T>(h: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await h.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
    payload: { projectId: h.projectId, workspaceRootRef: h.workspaceRootRef, ...payload } })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

function fixtureModel(inputs: Record<string, unknown>[]): AIModelPort {
  let todoStep = 0
  return {
    info: { provider: "fixture", model: "creative-interview", available: true, contextWindowTokens: 64_000 },
    execute: (request) => {
      const input = request.input as Record<string, unknown>
      inputs.push(input)
      const discussion = input.synopsisDiscuss as Record<string, unknown> | undefined
      const interview = discussion?.creativeSetup as { status: string; pendingQuestion?: { field: string } } | undefined
      const field = interview?.pendingQuestion?.field ?? "complete"
      const artifact = interview === undefined && todoStep < 2 ? {
        assistantMessage: "先建立卷规划任务。",
        toolRequest: todoStep++ === 0 ? { name: "todo_write", action: "describe" }
          : { name: "todo_write", action: "invoke", arguments: JSON.stringify({ merge: false, todos: [
            { id: "plan", content: "依据用户主支线生成卷规划", status: "in_progress" },
            { id: "write", content: "写入卷梗概与大纲", status: "pending" },
          ] }) },
        finalSelfReview: "先登记任务。",
      } : interview === undefined ? {
        assistantMessage: "按已确认的主支线规划本卷。",
        volumePlanMeta: { targetChapterCount: 3, targetWordCount: 9000 },
        creationDeskSettings: { descriptionRulePath: "表现输出/描写规则/自动.md",
          proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md", minimumWordCount: 2500,
          maximumWordCount: 3500, boundaryPace: "advance_allowed", causalityFocus: "action" },
        volumeSynopsis: { markdown: "# 卷梗概\n从矿场脱身，取回信物并抵达宗门。" },
        arcPlan: { markdown: "# 卷大纲\n第一章矿场脱身；第二章争夺信物；第三章抵达宗门。" },
        choices: [{ label: "从第一章梗概继续", action: "continue_discuss" }],
        finalSelfReview: "只提交卷规划。",
        continueTurn: true,
      } : {
        assistantMessage: `请确认${field}，可多选或填写你的想法。`,
        choices: [
          { label: `${field}：修仙题材推荐方案一`, action: "continue_discuss" },
          { label: `${field}：修仙题材推荐方案二`, action: "continue_discuss" },
        ],
        protagonistSupplementMarkdown: interview.status === "awaiting_write" ? "## AI补充\n姓名林烬，习惯随身携带旧铜钱。" : undefined,
        protagonistSupplementFields: interview.status === "awaiting_write" ? {
          姓名: "林烬", 身份: "矿场学徒", 能力: ["修补矿具"], 人物关系: { 沈砚: "矿友" },
        } : undefined,
        // Deliberately invalid side effect: an interview must never leak chapter writes.
        synopsisBody: "# 第一章 非法跳过\n不得写入。",
        continueTurn: true,
        finalSelfReview: "询问用户；不代表用户确认。",
      }
      return Promise.resolve({ result: { schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId,
        phase: request.phase, outcome: "continue", artifact, requestedReads: [], citedReadIds: [...request.committedReadIds],
        producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "fixture", selfReview: "fixture" },
      usage: { inputTokens: 100, outputTokens: 50, latencyMs: 0 } })
    },
  }
}

async function start(): Promise<{ h: ChapterHarness; inputs: Record<string, unknown>[] }> {
  const inputs: Record<string, unknown>[] = []
  const h = await openChapterHarness("Creative interview", { model: fixtureModel(inputs), creativeSetupReady: false })
  harnesses.push(h)
  await invoke(h, "synopsis.conversation.start", {})
  return { h, inputs }
}

async function send(h: ChapterHarness, message: string, setupAnswerTo?: string): Promise<SynopsisConversationSendResult> {
  return invoke(h, "synopsis.conversation.send", { message, batchProceed: true,
    ...(setupAnswerTo === undefined ? {} : { setupAnswerTo }) })
}

function chapterWriteAttemptModel(inputs: Record<string, unknown>[], volumeFolderName?: string): AIModelPort {
  const base = fixtureModel(inputs)
  return { ...base, execute: async (request) => {
    const response = await base.execute(request)
    const artifact = response.result.artifact as Record<string, unknown>
    const tool = artifact["toolRequest"] as { action?: string; arguments?: string } | undefined
    if (tool?.action === "invoke" && tool.arguments !== undefined) {
      const args = JSON.parse(tool.arguments) as { todos: { status: string }[] }
      for (const todo of args.todos) todo.status = "completed"
      tool.arguments = JSON.stringify(args)
    }
    if (artifact["volumePlanMeta"] === undefined) return response
    return { ...response, result: { ...response.result, artifact: {
      assistantMessage: "尝试直接写第一章。", synopsisBody: "# 第一章\n缺卷规划时不应写入这段内容。",
      ...(volumeFolderName === undefined ? {} : { volumeFolderName }),
      choices: [{ label: "继续创作", action: "continue_discuss" }], finalSelfReview: "测试越过实际内容检查。",
    } } }
  } }
}

describe("user-confirmed protagonist and volume state machines", () => {
  it("blocks chapter writes and asks to restore actual volume content even when first-write counters remain", async () => {
    const inputs: Record<string, unknown>[] = []
    const h = await openChapterHarness("Missing actual volume content", { model: chapterWriteAttemptModel(inputs) })
    harnesses.push(h)
    await prepareChapterPlanning(h)
    await h.container.workspace.removeUserMarkdown(h.workspaceRootRef, "大纲/第一卷 待命名.md")
    await invoke(h, "synopsis.conversation.start", {})
    const result = await send(h, "继续批量推进第一章。")
    const context = inputs.findLast(input => (input.synopsisDiscuss as Record<string, unknown> | undefined)?.creativeSetup === undefined)
      ?.synopsisDiscuss as { volumePlanning?: { ready: boolean; missing: string[] } } | undefined
    expect(context?.volumePlanning?.ready).toBe(false)
    expect(context?.volumePlanning?.missing).toContain("卷大纲")
    const saved = await invoke<{ content: string }>(h, "workspace.read", { relativePath: result.session.synopsisPath })
    expect(saved.content).not.toContain("缺卷规划时不应写入这段内容")
  })

  it("requires a new volume interview even when copied planning files claim all first writes are complete", async () => {
    const volume = "第二卷 新的征程"
    const h = await openChapterHarness("Unconfirmed destination volume", { model: chapterWriteAttemptModel([], volume) })
    harnesses.push(h)
    await prepareChapterPlanning(h)
    for (const suffix of [".批量计划.md", ".梗概.md", ".md"]) {
      const source = await h.container.workspace.readMarkdown(h.workspaceRootRef, `大纲/第一卷 待命名${suffix}`)
      await h.container.workspace.saveUserMarkdown(h.workspaceRootRef, `大纲/${volume}${suffix}`, source.replaceAll("第一卷 待命名", volume))
    }
    const result = await send(h, "切换第二卷后继续批量创作。")
    const saved = await invoke<{ content: string }>(h, "workspace.read", { relativePath: result.session.synopsisPath })
    expect(saved.content).not.toContain("缺卷规划时不应写入这段内容")
    const next = await send(h, result.autoContinue?.message ?? "继续批量推进。")
    expect(next.awaitingSetupInput).toMatchObject({ scope: `volume:${volume}`, field: "opening" })
    expect(next.autoContinue).toBeUndefined()
  })

  it("asks for protagonist core before planning and cannot self-confirm on batch continuation", async () => {
    const { h } = await start()
    const first = await send(h, "写一个矿工少年修仙的故事，批量推进。")
    expect(first.awaitingSetupInput).toMatchObject({ scope: "protagonist", field: "personality" })
    expect(first.autoContinue).toBeUndefined()
    const choices = first.messages.filter(m => m.role === "assistant").at(-1)?.choices
    expect(choices?.every(c => c.setupQuestionId === first.awaitingSetupInput?.questionId)).toBe(true)
    const again = await send(h, "继续：自动推进到第一章。")
    expect(again.awaitingSetupInput).toEqual(first.awaitingSetupInput)
    await expect(invoke(h, "workspace.read", { relativePath: "大纲/第一卷 待命名.批量计划.md" })).rejects.toThrow()
    const original = await invoke<{ content: string }>(h, "workspace.read", { relativePath: first.session.synopsisPath })
    expect(original.content).not.toContain("非法跳过")
  })

  it("rejects stale answer identities without advancing the questionnaire", async () => {
    const { h } = await start()
    const first = await send(h, "开始创作。")
    const second = await send(h, "沉稳谨慎，爱好锻造。", first.awaitingSetupInput?.questionId)
    expect(second.awaitingSetupInput?.field).toBe("appearance")
    await expect(send(h, "十七岁", first.awaitingSetupInput?.questionId)).rejects.toThrow(/问题|过期|匹配/u)
    const state = await send(h, "继续：自动推进。")
    expect(state.awaitingSetupInput?.field).toBe("appearance")
  })

  it("persists user core into settings and confirms all volume arcs before first planning writes", async () => {
    const { h, inputs } = await start()
    let result = await send(h, "矿工少年修仙，必须让他靠锻造改变命运。")
    const protagonist = ["谨慎坚韧，喜欢锻造", "黑发灰眼，左手有旧伤", "十七岁", "矿场孤儿，父母失踪", "取回家传信物并寻找父母", "姓名林烬", "不添加其他要求"]
    for (const answer of protagonist) result = await send(h, answer, result.awaitingSetupInput?.questionId)
    expect(result.awaitingSetupInput).toMatchObject({ scope: "volume:第一卷 待命名", field: "opening" })
    const settings = await invoke<{ content: string }>(h, "workspace.read", { relativePath: "设定集/人物/主角.json" })
    for (const answer of protagonist) expect(settings.content).toContain(answer)
    expect(settings.content).toContain("旧铜钱")
    const volume = ["矿场暴雨之夜被迫逃亡", "夺回信物；山门试炼反败为胜", "通过试炼进入宗门，保留父母线索", "开篇救下矿友；中段矿友助他找回信物；卷末分别"]
    for (const answer of volume) result = await send(h, answer, result.awaitingSetupInput?.questionId)
    expect(result.awaitingSetupInput).toBeUndefined()
    const plan = await invoke<{ content: string }>(h, "workspace.read", { relativePath: "大纲/第一卷 待命名.批量计划.md" })
    for (const answer of volume) expect(plan.content).toContain(answer)
    const planningInput = inputs.findLast(input => (input.synopsisDiscuss as Record<string, unknown> | undefined)?.creativeSetup === undefined)
    expect(JSON.stringify(planningInput?.synopsisDiscuss)).toContain(volume[0])
    const secondVolumePath = "章节正文/第二卷 新的征程/第四章 新的起点 [剧情梗概].md"
    await expect(invoke(h, "workspace.save", { relativePath: secondVolumePath, content: "# 第四章\n尝试绕过新卷规划。" })).rejects.toThrow(/主支线|卷|主角/u)
  })
})
