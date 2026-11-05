import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"

import { PROTOCOL_VERSION, type PhaseRequestEnvelope } from "@worldseed/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { assessWorkStyleMarkdown, WORK_STYLE_RULE_PATH } from "../src/core/workspace/work-style-gate.js"

import { openChapterHarness, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const harnesses: ChapterHarness[] = []

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.container.close()
  }
})

async function invoke<T>(harness: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload,
  })
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data as T
}

describe("cold-start style gate flow", () => {
  it("guides the agent into first-volume planning and returns the active volume panel state", async () => {
    const phasePrompts: string[] = []
    const discussInputs: Array<Record<string, unknown>> = []
    const modelResponses: unknown[] = []
    let todoStep = 0
    let settingsResponseCount = 0
    const model: AIModelPort = {
      info: { provider: "fixture", model: "volume-planner", available: true, contextWindowTokens: 64_000 },
      execute: async (request, options) => {
        phasePrompts.push(options?.phasePrompt?.text ?? "")
        discussInputs.push(request.input as Record<string, unknown>)
        let artifact: Record<string, unknown>
        if (todoStep === 0) {
          todoStep = 1
          artifact = {
            assistantMessage: "我先建立卷规划任务清单。",
            toolRequest: { name: "todo_write", action: "describe" },
            finalSelfReview: "先建立规划任务清单，再提交卷规划。",
          }
        } else if (todoStep === 1) {
          todoStep = 2
          artifact = {
            assistantMessage: "我已建立卷规划任务清单。",
            toolRequest: {
              name: "todo_write",
              action: "invoke",
              arguments: JSON.stringify({
                merge: false,
                todos: [
                  { id: "plan-volume", content: "规划并写入第一卷目标、梗概与大纲", status: "in_progress" },
                  { id: "show-volume", content: "显示第一卷规划面板并核对写入状态", status: "pending" },
                ],
              }),
            },
            finalSelfReview: "已通过 Todo 工具建立卷规划任务。",
          }
        } else if (todoStep === 2) {
          todoStep = 3
          artifact = {
            assistantMessage: "先提交规划方案。",
            creationDeskSettings: {
              descriptionRulePath: "表现输出/描写规则/自动.md",
              proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md",
              minimumWordCount: 2500,
              maximumWordCount: 3500,
              boundaryPace: "advance_allowed",
              causalityFocus: "action",
            },
            volumePlanMeta: { targetChapterCount: 8, targetWordCount: 24_000 },
            volumeSynopsis: { markdown: "# 第一卷梗概\n主角从边城崛起，逐步查明灵潮异变的源头。\n" },
            arcPlan: {
              markdown: "# 第一卷大纲\n\n## 第一章\n主角发现异变并作出选择。\n\n## 第二章\n主角进入边城势力冲突。\n",
            },
            finalSelfReview: "已分别提交卷目标、卷梗概与卷大纲，未写章节材料。",
          }
        } else if (todoStep === 3) {
          todoStep = 4
          artifact = {
            assistantMessage: "卷规划方案已完成，现在结清任务状态。",
            toolRequest: {
              name: "todo_write",
              action: "invoke",
              arguments: JSON.stringify({
                merge: true,
                todos: [
                  { id: "plan-volume", content: "规划并写入第一卷目标、梗概与大纲", status: "completed" },
                  { id: "show-volume", content: "显示第一卷规划面板并核对写入状态", status: "completed" },
                ],
              }),
            },
            finalSelfReview: "卷规划已完成，正在结清任务状态。",
          }
        } else {
          settingsResponseCount += 1
          artifact = {
            assistantMessage: settingsResponseCount === 1
              ? "我已切换笔风并完成卷规划。"
              : "我已按现有构思规划并写入第一卷，章节数与字数可继续调整。",
            ...(settingsResponseCount === 1 ? {} : { creationDeskSettings: {
              descriptionRulePath: "表现输出/描写规则/自动.md",
              proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md",
              minimumWordCount: 2500,
              maximumWordCount: 3500,
              boundaryPace: "advance_allowed",
              causalityFocus: "action",
            } }),
            volumePlanMeta: { targetChapterCount: 8, targetWordCount: 24_000 },
            volumeSynopsis: { markdown: "# 第一卷梗概\n主角从边城崛起，逐步查明灵潮异变的源头。\n" },
            arcPlan: {
              markdown: "# 第一卷大纲\n\n## 第一章\n主角发现异变并作出选择。\n\n## 第二章\n主角进入边城势力冲突。\n",
            },
            finalSelfReview: "已分别提交卷目标、卷梗概与卷大纲，未写章节材料。",
          }
        }
        modelResponses.push(artifact)
        return {
          result: {
            schemaVersion: 1,
            envelopeId: request.envelopeId,
            contextId: request.contextId,
            phase: request.phase,
            outcome: "continue",
            artifact,
            requestedReads: [],
            citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [],
            decisionRecordIds: [],
            unresolvedDependencies: [],
            reason: "Fixture planned and persisted the current volume",
            selfReview: "The fixture wrote all required first-volume planning artifacts.",
          },
          usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0 },
        }
      },
    }
    const harness = await openChapterHarness("Volume Planning Guidance Test", { model })
    harnesses.push(harness)
    const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
    await invoke(harness, "synopsis.conversation.start", base)
    const sent = await invoke<{
      volumePlanningStage?: boolean
      autoContinue?: { message: string }
      creationDeskSettings?: {
        descriptionRulePath?: string
        proseStyleRulePath?: string
        minimumWordCount?: number
        maximumWordCount?: number
        boundaryPace?: string
        causalityFocus?: string
      }
      messages: Array<{ role: string; content: string; choices?: Array<{
        label: string
        action: string
        workStyleSelection?: {
          proseStyleRulePath: string
          novelMajorCategoryRulePath: string
          novelSubcategoryRulePath: string
        }
      }> }>
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: "根据我的构思规划第一卷。",
      batchProceed: true,
    })

    expect(phasePrompts.at(-1)).toContain("当前阶段：第一卷卷级规划")
    expect(phasePrompts.at(-1)).toContain("你必须主动完成卷规划")
    expect(phasePrompts.some((prompt) => prompt.includes("creationDeskSettings")))
      .toBe(true)
    expect(discussInputs.at(-1)?.synopsisDiscuss).toMatchObject({
      volumePlanning: {
        volumeFolderName: "第一卷 待命名",
        ready: false,
        missing: ["章节总数", "预计总字数", "卷梗概", "卷大纲"],
      },
    })
    expect(sent.volumePlanningStage).toBe(true)
    expect(sent.autoContinue?.message).toContain("当前卷首次规划已通过写入门禁")
    expect(modelResponses.at(-1)).toMatchObject({
      creationDeskSettings: { minimumWordCount: 2500, maximumWordCount: 3500 },
    })
    expect(modelResponses.some((response) => (
      typeof response === "object" && response !== null
      && "creationDeskSettings" in response
      && (response as { creationDeskSettings?: unknown }).creationDeskSettings !== undefined
    ))).toBe(true)
    expect(sent.creationDeskSettings).toEqual({
      descriptionRulePath: "表现输出/描写规则/自动.md",
      proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md",
      minimumWordCount: 2500,
      maximumWordCount: 3500,
      boundaryPace: "advance_allowed",
      causalityFocus: "action",
    })
    expect(sent.messages.filter((message) => message.role === "assistant").at(-1)?.content)
      .toContain("卷规划首次写入已完成")
    expect(sent.messages.filter((message) => message.role === "assistant").at(-1)?.content)
      .toContain("写作设置已同步")
    expect(sent.messages.filter((message) => message.role === "assistant").at(-1)?.choices?.length)
      .toBeGreaterThanOrEqual(2)
    const plan = await invoke<{ content: string }>(harness, "workspace.read", {
      ...base,
      relativePath: "大纲/第一卷 待命名.批量计划.md",
    })
    const synopsis = await invoke<{ content: string }>(harness, "workspace.read", {
      ...base,
      relativePath: "大纲/第一卷 待命名.梗概.md",
    })
    const outline = await invoke<{ content: string }>(harness, "workspace.read", {
      ...base,
      relativePath: "大纲/第一卷 待命名.md",
    })
    expect(plan.content).toContain('"targetChapterCount": 8')
    expect(plan.content).toContain('"targetWordCount": 24000')
    expect(plan.content).toContain('"synopsisWriteCount": 1')
    expect(plan.content).toContain('"outlineWriteCount": 1')
    expect(synopsis.content).toContain("主角从边城崛起")
    expect(outline.content).toContain("主角进入边城势力冲突")
  })

  it("blocks formal chapter deduction until the volume first-write plan gate is ready", async () => {
    const delegate = new FakeAiModelAdapter(randomUUID)
    const model: AIModelPort = {
      info: delegate.info,
      execute: async (request, options) => {
        const execution = await delegate.execute(request, options)
        if (request.phase !== "synopsis_discuss") return execution
        return {
          ...execution,
          result: {
            ...execution.result,
            artifact: {
              ...execution.result.artifact,
              assistantMessage: "第一章剧情梗概已完成并写入。",
              chapterTitle: "第一章 越门",
              synopsisBody: "# 第一章 越门 剧情梗概\n这段内容必须被卷规划门禁拦截。\n",
            },
          },
        }
      },
    }
    const harness = await openChapterHarness("Volume First Write Gate Test", { model })
    harnesses.push(harness)
    const response = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "turn.start",
      payload: {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        userInput: "生成第一章",
        chapterSequence: 1,
      },
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.message).toContain("卷级首次写入门禁")

    const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
    const directChapterSave = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "workspace.save",
      payload: {
        ...base,
        relativePath: "章节正文/第一卷 待命名/第一章 开始.md",
        content: "# 第一章\n不能绕过卷规划门禁。\n",
      },
    })
    expect(directChapterSave.ok).toBe(false)
    if (!directChapterSave.ok) expect(directChapterSave.error.message).toContain("卷级首次写入门禁")

    const directDraftStart = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "chapter.draft.start",
      payload: {
        ...base,
        chapterSequence: 1,
        heading: "第一章 开始",
        body: "不能绕过卷规划门禁的草稿。",
        source: "manual",
        volumeFolderName: "第一卷 待命名",
      },
    })
    expect(directDraftStart.ok).toBe(false)
    if (!directDraftStart.ok) expect(directDraftStart.error.message).toContain("卷级首次写入门禁")

    await invoke(harness, "synopsis.conversation.start", base)
    const discussion = await invoke<{
      session: { synopsisPath: string }
      messages: Array<{ role: string; content: string }>
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: "先完成剧情梗概。",
    })
    const assistant = discussion.messages.filter((message) => message.role === "assistant").at(-1)
    expect(assistant?.content).toContain("当前卷规划仍未完成")
    expect(assistant?.content).not.toContain("第一章剧情梗概已完成并写入")
    const blockedSynopsis = await invoke<{ content: string }>(harness, "workspace.read", {
      ...base,
      relativePath: discussion.session.synopsisPath,
    })
    expect(blockedSynopsis.content).not.toContain("这段内容必须被卷规划门禁拦截")

    const plan = {
      volumeFolderName: "第一卷 待命名",
      startSequence: 1,
      targetChapterCount: 8,
      targetWordCount: 24000,
      synopsisWriteCount: 0,
      outlineWriteCount: 0,
    }
    await invoke(harness, "workspace.save", {
      ...base,
      relativePath: "大纲/第一卷 待命名.批量计划.md",
      content: `# 第一卷规划\n\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\n`,
    })
    await invoke(harness, "workspace.save", {
      ...base,
      relativePath: "大纲/第一卷 待命名.梗概.md",
      content: "# 卷梗概\n主线与结局。\n",
    })
    await invoke(harness, "workspace.save", {
      ...base,
      relativePath: "大纲/第一卷 待命名.md",
      content: "# 卷大纲\n第一章与第二章的关键转折。\n",
    })
    const afterPlanning = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "turn.start",
      payload: { ...base, userInput: "生成第一章", chapterSequence: 1 },
    })
    expect(afterPlanning.ok).toBe(false)
    if (!afterPlanning.ok) {
      expect(afterPlanning.error.message).not.toContain("卷级首次写入门禁")
      expect(afterPlanning.error.message).toContain("剧情梗概")
    }
  })

  it("requires a style choice in a newly created book before formal deduction", async () => {
    const delegate = new FakeAiModelAdapter(randomUUID)
    const modelRequests: PhaseRequestEnvelope[] = []
    const modelResponses: unknown[] = []
    const model: AIModelPort = {
      info: delegate.info,
      execute: async (request, options) => {
        modelRequests.push(request)
        const execution = await delegate.execute(request, options)
        modelResponses.push(execution.result.artifact)
        return execution
      },
    }
    const harness = await openChapterHarness("Fresh Book Gate Test", {
      workStyleGateReady: false,
      model,
    })
    harnesses.push(harness)
    const base = {
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
    }
    const started = await invoke<{ session: { synopsisPath: string } }>(
      harness,
      "synopsis.conversation.start",
      base,
    )
    let seededStyle: string | undefined
    try {
      seededStyle = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, WORK_STYLE_RULE_PATH)
    } catch {
      seededStyle = undefined
    }
    expect(assessWorkStyleMarkdown(seededStyle).complete).toBe(false)
    const sent = await invoke<{
      session: { synopsisPath: string }
      messages: Array<{ role: string; content: string; choices?: Array<{ label: string; action: string }> }>
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: "灾变来临前，主角发现自己能预知危险。",
    })

    const assistant = sent.messages.filter((message) => message.role === "assistant").at(-1)
    expect(assistant?.choices?.length).toBeGreaterThan(0)
    expect(assistant?.choices?.every((choice) => (
      choice.workStyleSelection?.proseStyleRulePath.startsWith("表现输出/笔风规则/") === true
      && choice.workStyleSelection.novelMajorCategoryRulePath.startsWith("表现输出/小说大类规则/")
      && choice.workStyleSelection.novelSubcategoryRulePath.startsWith("表现输出/小说次大类规则/")
    ))).toBe(true)
    expect(modelRequests.some((request) => request.phase === "synopsis_discuss")).toBe(true)
    expect(modelRequests.some((request) => (
      request.phase === "synopsis_discuss"
      && (request.input as { readEvidence: Array<{ ownerKind: string; ownerId: string; semanticText: string }> })
        .readEvidence.some((evidence) => evidence.ownerKind === "workspace:presentation_style_candidate"
          && evidence.ownerId.startsWith("表现输出/")
          && evidence.semanticText.length > 0)
    ))).toBe(true)
    expect(sent.session.synopsisPath).toBe(started.session.synopsisPath)
    const synopsis = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, started.session.synopsisPath)
    expect(synopsis).not.toContain("主角发现自己能预知危险")

    const turn = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "turn.start",
      payload: { ...base, userInput: "开始正式推演", chapterSequence: 1 },
    })
    expect(turn.ok).toBe(false)
    if (!turn.ok) expect(turn.error.message).toContain("作品风格门禁尚未通过")

    const requestsBeforeSelection = modelRequests.length
    const selected = await invoke<{
      messages: Array<{ role: string; content: string }>
      creationDeskSettings?: { proseStyleRulePath?: string }
      autoContinue?: { message: string }
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: "按你的推荐来定风格",
      batchProceed: true,
    })
    expect(selected.messages.find((message) => message.role === "assistant")?.content).toContain("审核")
    expect(modelRequests.at(-1)?.input).toMatchObject({
      synopsisDiscuss: { workStyleGate: { status: "style_selected" } },
    })
    expect(modelRequests.length - requestsBeforeSelection).toBe(1)
    expect(modelResponses.at(-1)).toMatchObject({
      presentationWrites: [{ relativePath: WORK_STYLE_RULE_PATH }],
    })
    const returnedStyle = (modelResponses.at(-1) as {
      presentationWrites: Array<{ markdown: string }>
    }).presentationWrites[0]!.markdown
    expect(assessWorkStyleMarkdown(returnedStyle)).toMatchObject({ complete: true })
    const styleMarkdown = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, WORK_STYLE_RULE_PATH)
    expect(assessWorkStyleMarkdown(styleMarkdown).complete).toBe(true)
    const selectedPath = assistant!.choices![0]!.workStyleSelection?.proseStyleRulePath
    expect(selectedPath).toBeDefined()
    expect(selected.creationDeskSettings?.proseStyleRulePath).toBe(selectedPath)
    expect(selected.autoContinue?.message).toContain("当前卷的章节数")
    expect(styleMarkdown).toContain(selectedPath)
    expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, started.session.synopsisPath))
      .not.toContain("主角发现自己能预知危险")
    const runtime = harness.container.getCurrentRuntime()
    expect(runtime).toBeDefined()
    await expect(runtime!.assertWorkStyleGateReady()).resolves.toBeUndefined()
  })

  it("requires a choice even when the style file is complete but no choice was made", async () => {
    const harness = await openChapterHarness("Cold Start Gate Test", { workStyleGateReady: false })
    harnesses.push(harness)
    await harness.container.workspace.saveUserMarkdown(
      harness.workspaceRootRef,
      "表现输出/本作品描写/作品风格.md",
      [
        "# 作品风格",
        "## 1. 语体笔风\n主锚：表现输出/笔风规则/仙侠.md。语气克制，密度适中。",
        "## 2. 时代科技生活\n冷兵器与符箓并行，使用灵石，宗门按名册管理。",
        "## 3. 规则称谓能力\n能力有明确代价，称谓按辈分与阵营区分。",
        "## 4. 命名\n人名错开姓与音节，正例：林烬、沈砚；反例：林寒、林涵同场混淆。势力以宗门、商会命名。",
        "## 5. 角色声口\n主角短句少形容，示例：先活下来再说。配角说话更周全，句式有所区分。",
        "## 6. 尺度意象章钩\n暴力写后果，章末落在选择代价。",
        "## 7. 人称指称\n第三人称限知，只写主角当下能感知的内容。",
        "## 8. 句子与对话\n句长偏短，对话口语化；群戏避免乒乓对白，主角对白示例：先活下来。对白按照人物地位区分，不用同一种书面腔。",
      ].join("\n\n"),
    )
    const base = {
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
    }
    const started = await invoke<{ session: { synopsisPath: string } }>(
      harness,
      "synopsis.conversation.start",
      base,
    )

    const sent = await invoke<{
      session: { synopsisPath: string }
      messages: Array<{
        role: string
        content: string
        choices?: Array<{ label: string; action: string }>
      }>
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: "重生回到灾变前，我提前囤满物资。",
      batchProceed: true,
    })

    const assistant = sent.messages.find((message) => message.role === "assistant")
    expect(assistant?.content).not.toContain("正式输出")
    expect(assistant?.choices?.length).toBeGreaterThanOrEqual(2)
    expect(assistant?.choices?.length).toBeLessThanOrEqual(3)
    expect(assistant?.choices?.every((choice) => choice.action === "continue_discuss")).toBe(true)
    expect(sent.session.synopsisPath).toBe(started.session.synopsisPath)
    expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, started.session.synopsisPath))
      .toContain("# 第一章")
    const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
    try {
      const gateState = database.prepare(
        "SELECT status, selected_prose_style_path, style_digest FROM work_style_gate_states WHERE project_id = ?",
      ).get(harness.projectId) as { status: string; selected_prose_style_path: string | null; style_digest: string | null } | undefined
      expect(gateState).toEqual({
        status: "awaiting_choice",
        selected_prose_style_path: null,
        style_digest: null,
      })
    } finally {
      database.close()
    }
    const runtime = harness.container.getCurrentRuntime()
    expect(runtime).toBeDefined()
    await expect(runtime!.assertWorkStyleGateReady()).rejects.toThrow("作品风格门禁尚未通过")
  })
})
