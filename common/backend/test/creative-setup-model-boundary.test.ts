import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultDeepSeekRuntimeConfig } from "@starseafolio/config"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DeepSeekAiModelAdapter, NodePromptResourceAdapter, type DeepSeekCompletionClient } from "../src/index.js"
import { protagonistCreativeSetupFields, protagonistCreativeSetupMarkdownHasContent,
  volumeCreativeSetupFields } from "../src/application/chapters/creative-setup-state.js"
import { parseVolumePlanningState, volumePlanningGateReady } from "../src/application/chapters/volume-planning-gate.js"
import { SqliteCreativeSetupRepository } from "../src/infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import { openProjectDatabase } from "../src/infrastructure/sqlite/sqlite-database.js"
import { openChapterHarness, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

type CompletionMessages = Parameters<DeepSeekCompletionClient["complete"]>[0]["messages"]
type ModelSetup = {
  scope: string
  status: string
  answers: Record<string, string>
  pendingQuestion?: { field: string }
}
type Discussion = { creativeSetup?: ModelSetup; volumePlanning?: unknown }

const harnesses: ChapterHarness[] = []
afterEach(async () => { for (const h of harnesses.splice(0)) await h.container.close() })

async function invoke<T>(h: ChapterHarness, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await h.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
    payload: { projectId: h.projectId, workspaceRootRef: h.workspaceRootRef, ...payload } })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

function latestDiscussion(messages: CompletionMessages): Discussion {
  const header = "Worldseed context delta JSON:"
  for (const message of [...messages].reverse()) {
    if (!message.content.startsWith(header)) continue
    const delta = JSON.parse(message.content.slice(header.length)) as { input?: { synopsisDiscuss?: Discussion } }
    if (delta.input?.synopsisDiscuss !== undefined) return delta.input.synopsisDiscuss
  }
  throw new Error("The real adapter did not send a discussion context")
}

describe("creative setup real model boundary", () => {
  it("keeps question nonces server-side through both interviews and hands off to volume planning", async () => {
    const completions: CompletionMessages[] = []
    const interviews: ModelSetup[] = []
    const planning: Discussion[] = []
    let planningStep = 0
    const complete = vi.fn<DeepSeekCompletionClient["complete"]>((input) => {
      completions.push(input.messages.map(message => ({ ...message })))
      const discussion = latestDiscussion(input.messages)
      const setup = discussion.creativeSetup
      let artifact: Record<string, unknown>
      if (setup !== undefined) {
        interviews.push(setup)
        // This is the actual provider request, after reference projection and context assembly.
        expect(Object.keys(setup).sort()).toEqual([
          "answers", ...(setup.pendingQuestion === undefined ? [] : ["pendingQuestion"]), "scope", "status",
        ].sort())
        if (setup.pendingQuestion !== undefined) expect(Object.keys(setup.pendingQuestion)).toEqual(["field"])
        artifact = setup.status === "awaiting_write" ? {
          assistantMessage: "补充与已确认核心一致的姓名、能力和关系。",
          protagonistSupplementMarkdown: "## AI 补充\n林烬善于修补矿具，与矿友沈砚相互照应。",
          finalSelfReview: "七项核心由用户确认，补充不会覆盖核心。",
        } : {
          assistantMessage: `请确认${setup.pendingQuestion?.field ?? "当前设定"}，可以多选或填写你的想法。`,
          choices: [
            { label: "矿工少年修仙：谨慎追查线索", action: "continue_discuss" },
            { label: "矿工少年修仙：冒险争夺信物", action: "continue_discuss" },
          ],
          // Even schema-valid unsolicited artifacts cannot advance the human gate or write chapters.
          synopsisBody: "# 第一章\n禁止越过问卷写入的内容。",
          volumeSynopsis: { markdown: "# 卷梗概\n禁止越过问卷写入的内容。" },
          arcPlan: { markdown: "# 卷大纲\n禁止越过问卷写入的内容。" },
          continueTurn: true,
          finalSelfReview: "只有显式用户回答才能确认核心。",
        }
      } else {
        planning.push(discussion)
        artifact = planningStep < 2 ? {
          assistantMessage: "登记已确认主支线的卷规划任务。",
          toolRequest: planningStep++ === 0 ? { name: "todo_write", action: "describe" }
            : { name: "todo_write", action: "invoke", arguments: JSON.stringify({ merge: false, todos: [
              { id: "plan", content: "核对用户确认的卷主支线", status: "completed" },
            ] }) },
          finalSelfReview: "先登记规划任务。",
        } : {
          assistantMessage: "按已确认的主支线写入卷规划。",
          volumePlanMeta: { targetChapterCount: 3, targetWordCount: 9000 },
          creationDeskSettings: { descriptionRulePath: "表现输出/描写规则/自动.md",
            proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md", minimumWordCount: 2500,
            maximumWordCount: 3500, boundaryPace: "advance_allowed", causalityFocus: "action" },
          volumeSynopsis: { markdown: "# 卷梗概\n矿工少年雨夜脱身，夺回信物并通过宗门试炼。" },
          arcPlan: { markdown: "# 卷大纲\n第一章逃出矿场，第二章夺回信物，第三章通过试炼进入宗门。" },
          choices: [{ label: "继续讨论第一章", action: "continue_discuss" }],
          finalSelfReview: "主角和卷主支线均已由用户确认，只提交卷规划。",
        }
      }
      return Promise.resolve({ content: JSON.stringify({ outcome: "continue", artifact,
        requestedReads: [], citedReadIds: [], unresolvedDependencies: [], reason: "本地模型边界测试", selfReview: "已核对" }),
      usage: { prompt_tokens: 100, completion_tokens: 50 } })
    })
    const model = new DeepSeekAiModelAdapter({ ...defaultDeepSeekRuntimeConfig, maxSchemaRepairAttempts: 0 },
      { getSecret: () => Promise.resolve("unused-local-fixture-key") },
      new NodePromptResourceAdapter(fileURLToPath(new URL("../../../common/packages/prompt-contracts/", import.meta.url))), { complete })
    // Style is already complete; neither creative setup state is seeded.
    const h = await openChapterHarness("Real adapter creative setup boundary", { model, creativeSetupReady: false })
    harnesses.push(h)
    const database = await openProjectDatabase(join(h.applicationDataRoot, "projects", h.projectId, "project.sqlite"))
    try {
      const repository = new SqliteCreativeSetupRepository(database)
      const volumeFolderName = "第一卷 待命名"
      const volumeScope = `volume:${volumeFolderName}`
      const planPath = `大纲/${volumeFolderName}.批量计划.md`
      const send = (message: string, setupAnswerTo?: string) => invoke<SynopsisConversationSendResult>(h,
        "synopsis.conversation.send", { message, batchProceed: true,
          ...(setupAnswerTo === undefined ? {} : { setupAnswerTo }) })
      const issuedIds = new Set<string>()
      const confirmed = { protagonist: {} as Record<string, string>, volume: {} as Record<string, string> }
      const assertQuestion = async (result: SynopsisConversationSendResult, scope: string, field: string) => {
        const question = result.awaitingSetupInput
        expect(question).toMatchObject({ scope, field })
        if (question === undefined) throw new Error("Expected a server-issued question")
        expect(question.questionId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu)
        expect(issuedIds.has(question.questionId)).toBe(false)
        issuedIds.add(question.questionId)
        const choices = result.messages.filter(message => message.role === "assistant").at(-1)?.choices
        expect(choices).toHaveLength(2)
        for (const choice of choices ?? []) expect(choice).toMatchObject({ action: "continue_discuss", setupQuestionId: question.questionId })
        expect(result.autoContinue).toBeUndefined()
        const state = await repository.find(h.projectId, scope)
        expect(state).toMatchObject({ status: "collecting", pendingQuestion: { id: question.questionId, field },
          answers: scope === "protagonist" ? confirmed.protagonist : confirmed.volume })
        expect(interviews.at(-1)).toEqual({ scope, status: "collecting", pendingQuestion: { field },
          answers: scope === "protagonist" ? confirmed.protagonist : confirmed.volume })
        return question.questionId
      }

      expect(await repository.find(h.projectId, "protagonist")).toBeUndefined()
      expect(await repository.find(h.projectId, volumeScope)).toBeUndefined()
      await invoke(h, "synopsis.conversation.start")
      let result = await send("矿工少年修仙，靠锻造改变命运；先确认主角与本卷设定。")
      expect(complete).toHaveBeenCalledTimes(1)
      const protagonistAnswers = ["谨慎坚韧，喜欢锻造", "黑发灰眼，左手有旧伤", "十七岁", "矿场孤儿，父母失踪",
        "取回家传信物并寻找父母", "姓名林烬", "交给AI"]
      for (const [index, field] of protagonistCreativeSetupFields.entries()) {
        const id = await assertQuestion(result, "protagonist", field.key)
        const answer = protagonistAnswers[index]
        if (answer === undefined) throw new Error("Missing protagonist fixture answer")
        if (index === 0) {
          const calls = complete.mock.calls.length
          // A concrete raw message and an autonomous continuation are both insufficient.
          expect((await send(answer)).awaitingSetupInput).toEqual(result.awaitingSetupInput)
          expect((await send("继续：自动替我确认全部设定并开始写章。")).awaitingSetupInput).toEqual(result.awaitingSetupInput)
          await expect(send(answer, randomUUID())).rejects.toThrow(/问题|过期|匹配/u)
          await expect(send("继续", id)).rejects.toThrow()
          expect(complete).toHaveBeenCalledTimes(calls)
          expect((await repository.find(h.projectId, "protagonist"))?.answers).toEqual({})
          await expect(invoke(h, "workspace.save", { relativePath: "章节正文/第一卷 待命名/第一章 越门.md",
            content: "# 第一章\n不能跳过用户确认。" })).rejects.toThrow(/主角|设定|卷/u)
        }
        await expect(invoke(h, "workspace.read", { relativePath: planPath })).rejects.toThrow()
        const chapter = await invoke<{ content: string }>(h, "workspace.read", { relativePath: result.session.synopsisPath })
        expect(chapter.content).not.toContain("禁止越过问卷写入的内容")
        confirmed.protagonist[field.key] = answer
        result = await send(answer, id)
        expect((await repository.find(h.projectId, "protagonist"))?.answeredQuestions?.[id]).toBe(field.key)
        if (index === 0) {
          const calls = complete.mock.calls.length
          expect((await send(answer, id)).awaitingSetupInput).toEqual(result.awaitingSetupInput)
          expect(complete).toHaveBeenCalledTimes(calls)
          await expect(send("更改旧问题的回答", id)).rejects.toThrow(/问题|过期|确认/u)
        }
      }
      const settings = await invoke<{ content: string }>(h, "workspace.read", { relativePath: "设定集/人物/主角.md" })
      expect(protagonistCreativeSetupMarkdownHasContent(settings.content)).toBe(true)
      for (const answer of protagonistAnswers) expect(settings.content).toContain(answer)
      expect(settings.content).toContain("矿友沈砚")
      expect((await repository.find(h.projectId, "protagonist"))?.status).toBe("ready")
      const unplanned = await invoke<{ content: string }>(h, "workspace.read", { relativePath: planPath }).catch(() => undefined)
      expect(unplanned).toBeUndefined()

      const volumeAnswers = ["矿场暴雨之夜被迫逃亡", "夺回信物；山门试炼反败为胜", "通过试炼进入宗门，保留父母线索", "无支线"]
      for (const [index, field] of volumeCreativeSetupFields.entries()) {
        const id = await assertQuestion(result, volumeScope, field.key)
        const answer = volumeAnswers[index]
        if (answer === undefined) throw new Error("Missing volume fixture answer")
        expect(planning).toHaveLength(0)
        await expect(invoke(h, "workspace.read", { relativePath: planPath })).rejects.toThrow()
        if (field.key === "subplots") {
          expect((await send("继续自动生成卷规划。")).awaitingSetupInput).toEqual(result.awaitingSetupInput)
          expect((await repository.find(h.projectId, volumeScope))?.answers).not.toHaveProperty("subplots")
        }
        confirmed.volume[field.key] = answer
        result = await send(answer, id)
        expect((await repository.find(h.projectId, volumeScope))?.answeredQuestions?.[id]).toBe(field.key)
      }

      expect(result.awaitingSetupInput).toBeUndefined()
      expect(issuedIds.size).toBe(11)
      expect(planning.length).toBeGreaterThan(0)
      expect(JSON.stringify(planning[0]?.volumePlanning)).toContain(volumeAnswers[0])
      const planMarkdown = await invoke<{ content: string }>(h, "workspace.read", { relativePath: planPath })
      const plan = parseVolumePlanningState(planMarkdown.content)
      expect(plan).toMatchObject({ volumeFolderName, storyline: confirmed.volume, targetChapterCount: 3, targetWordCount: 9000 })
      expect(volumePlanningGateReady(plan)).toBe(true)
      expect((await repository.find(h.projectId, volumeScope))?.status).toBe("ready")
      const chapter = await invoke<{ content: string }>(h, "workspace.read", { relativePath: result.session.synopsisPath })
      expect(chapter.content).not.toContain("禁止越过问卷写入的内容")

      expect(interviews.filter(setup => setup.status === "collecting").map(setup => setup.pendingQuestion?.field))
        .toEqual([...protagonistCreativeSetupFields, ...volumeCreativeSetupFields].map(field => field.key))
      expect(interviews.find(setup => setup.status === "awaiting_write"))
        .toEqual({ scope: "protagonist", status: "awaiting_write", answers: confirmed.protagonist })
      for (const messages of completions) {
        const text = JSON.stringify(messages)
        for (const id of issuedIds) expect(text).not.toContain(id)
        expect(text).not.toContain("answeredQuestions")
        expect(text).not.toContain("setupAnswerTo")
        expect(text).not.toContain("setupQuestionId")
      }
    } finally {
      await database.destroy()
    }
  }, 30_000)
})
