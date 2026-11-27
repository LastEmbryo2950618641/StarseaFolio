import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { defaultDeepSeekRuntimeConfig } from "@starseafolio/config"
import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  phaseRequestEnvelopeSchema,
  type SynopsisConversationSendResult,
  type VisibleModelContextMessage,
} from "@starseafolio/contracts"
import {
  AFTER_USER_MESSAGE_PROMPT_DOC,
  BEFORE_USER_MESSAGE_PROMPT_DOC,
  COMPOSE_STAGE_PROMPT_DOC,
  INGESTION_STAGE_PROMPT_DOC,
  NEW_CHAPTER_STAGE_PROMPT_DOC,
  stagePromptDocForPhase,
} from "@starseafolio/prompt-contracts"

import type {
  AIModelPort,
  DiscussTurnClassificationInput,
  ModelExecutionOptions,
  PhaseModelExecution,
} from "../src/application/index.js"
import {
  STAGE_PROMPT_REINJECT_PROTOCOL,
  executeWithContextCompaction,
} from "../src/application/context/context-compacting-execution.js"
import { isUserRuleMarkdownPath } from "../src/application/chapters/synopsis-workspace-reads.js"
import { DeepSeekAiModelAdapter } from "../src/infrastructure/models/deepseek/deepseek-model-adapter.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { NodePromptResourceAdapter } from "../src/infrastructure/prompts/node-prompt-resource-adapter.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { openChapterHarness, prepareChapterPlanning } from "./helpers/chapter-coordination-harness.js"

const promptPackageRoot = resolve(fileURLToPath(new URL("../../packages/prompt-contracts", import.meta.url)))

function createNodePrompts(): NodePromptResourceAdapter {
  return new NodePromptResourceAdapter(promptPackageRoot)
}

const composeSynopsis = `# 第1章 站台来信

## 本章定位
林烬在雨夜站台追查失踪者留下的信。

## 核心事件
1. 林烬在末班车广播前找到车票背面的密信。
2. 车门合拢前，他在月台尽头看到可疑身影。

## 本章结束状态
末班车启动，林烬决定上车追查。`

const composeOutline = `# 第1章 站台来信

## 场次 1：雨夜站台
- 地点：旧城站台
- 人物：林烬
- 动作：林烬检查车票背面，发现失踪者的字迹。

## 场次 2：末班车启动
- 地点：站台尽头
- 人物：林烬
- 动作：广播响起，林烬在车门关闭前迈入车厢。`

const composeDraft = `# 第1章 站台来信

雨丝顺着站台顶棚的铁皮边缘滑落，在昏黄灯柱下织成一片冷雾。林烬站在三号检票口外，指腹摩挲着那张发潮的旧车票。

背面果然有铅笔留下的细字，被雨水晕开了一角，仍能辨认出半行地址和今晚末班车的发车时刻。远处铁轨传来低沉震动，广播里女声平稳地提醒旅客尽快登车。

林烬抬眼望向月台尽头，一个撑着黑伞的人影正收伞跨进尾节车厢。车门警报急促响起，林烬把车票塞进风衣内袋，迎着雨幕冲进即将合拢的车门。`

const composeAll = [
  "已完成构思。",
  "<compose-synopsis>",
  composeSynopsis,
  "</compose-synopsis>",
  "<compose-outline>",
  composeOutline,
  "</compose-outline>",
  "<compose-draft>",
  composeDraft,
  "</compose-draft>",
].join("\n")

async function invoke<T>(harness: Awaited<ReturnType<typeof openChapterHarness>>, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload },
  })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

async function send(
  harness: Awaited<ReturnType<typeof openChapterHarness>>,
  params: Record<string, unknown>,
): Promise<SynopsisConversationSendResult> {
  return invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", params)
}

async function closeHarness(harness: Awaited<ReturnType<typeof openChapterHarness>>): Promise<void> {
  await harness.container.close()
  rmSync(harness.root, { recursive: true, force: true })
}

function makeFakeRequest(phase: "settings_extraction" | "work_style_revision" | "synopsis_discuss" = "settings_extraction") {
  return phaseRequestEnvelopeSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    envelopeId: randomUUID(),
    projectId: randomUUID(),
    taskId: randomUUID(),
    turnId: randomUUID(),
    contextId: randomUUID(),
    scopeId: randomUUID(),
    phase,
    protocolVersion: PROTOCOL_VERSION,
    promptRef: `v1:${phase}`,
    promptDigest: "digest-1",
    contextViewRef: "view-1",
    committedReadIds: [],
    visiblePendingIds: [],
    remainingBudget: {
      maxCalls: 8,
      remainingCalls: 8,
      maxInputTokens: 64_000,
      remainingInputTokens: 64_000,
      maxOutputTokens: 8_000,
      remainingOutputTokens: 8_000,
      deadlineAtMs: Date.now() + 60_000,
    },
    input: {
      workflow: phase === "synopsis_discuss" ? "synopsis" : "revision",
      userInput: "请按本章要求执行。",
      chapterSequence: 1,
      allowWorkspaceChapterReads: false,
      sourceUnitIds: [],
      phaseRunIds: [],
      readEvidence: [],
      retrievalGaps: [],
      artifacts: {},
    },
  })
}

describe("five prompt contracts end-to-end verification", () => {
  it("loads all five canonical prompt docs and routes work_style_revision into 04-ingestion.md", async () => {
    const prompts = createNodePrompts()
    const [systemRules, before, after, newChapter, composeReq, composeEntry, ingestion, workStyle] = await Promise.all([
      prompts.loadSynopsisDiscussSystemRules(),
      prompts.loadBeforeUserMessagePrompt(),
      prompts.loadAfterUserMessagePrompt(),
      prompts.loadStageEntryPrompt("new-chapter"),
      prompts.loadStageEntryPrompt("compose-request"),
      prompts.loadStageEntryPrompt("compose"),
      prompts.loadStageEntryPrompt("ingestion"),
      prompts.loadPhase("work_style_revision"),
    ])

    expect(systemRules.text.length).toBeGreaterThan(100)
    expect(before.ref).toContain(BEFORE_USER_MESSAGE_PROMPT_DOC)
    expect(before.text).toContain("以下紧邻内容为用户本轮发送的原始消息")
    expect(after.ref).toContain(AFTER_USER_MESSAGE_PROMPT_DOC)
    expect(after.text).toContain("以上为用户本轮原始消息")
    expect(newChapter.ref).toContain(NEW_CHAPTER_STAGE_PROMPT_DOC)
    expect(newChapter.text).toContain("主线与支线收尾衔接")
    expect(composeReq.ref).toContain(COMPOSE_STAGE_PROMPT_DOC)
    expect(composeReq.text).toContain("<request-compose/>")
    expect(composeEntry.ref).toContain(COMPOSE_STAGE_PROMPT_DOC)
    expect(composeEntry.text).toContain("<compose-synopsis>")
    expect(ingestion.ref).toContain(INGESTION_STAGE_PROMPT_DOC)
    expect(ingestion.text).toContain("正式章节入库流程")
    expect(stagePromptDocForPhase("work_style_revision")?.resourcePath).toBe(INGESTION_STAGE_PROMPT_DOC)
    expect(workStyle.text).toContain("# work_style_revision")

    expect(isUserRuleMarkdownPath("提示词/用户规则/系统提示词/用户规则.md")).toBe(true)
    expect(isUserRuleMarkdownPath("提示词/系统记忆/系统提示词/系统记忆.md")).toBe(true)
    expect(isUserRuleMarkdownPath("世界推演规则/用户规则/自定义.md")).toBe(true)
  })

  it("places fixed system prompt first (even if omitted/reordered) and wraps user message with before/after md prompts in DeepSeekAiModelAdapter", async () => {
    const prompts = createNodePrompts()
    const [beforePrompt, afterPrompt, ingestionPrompt] = await Promise.all([
      prompts.loadBeforeUserMessagePrompt(),
      prompts.loadAfterUserMessagePrompt(),
      prompts.loadStageEntryPrompt("ingestion"),
    ])

    let capturedMessages: Array<{ role: string; content: string }> = []
    const adapter = new DeepSeekAiModelAdapter(
      { ...defaultDeepSeekRuntimeConfig, maxSchemaRepairAttempts: 0, maxTransportRetries: 0, thinkingModeEnabled: false },
      { getSecret: async () => "test-key" },
      prompts,
      {
        async complete(input) {
          capturedMessages = input.messages.map((message) => ({ role: message.role, content: message.content }))
          return {
            content: "纯文本回复",
            finishReason: "stop",
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }
        },
      },
    )

    const request = makeFakeRequest("synopsis_discuss")
    // Intentionally place system_rules after a history item to verify it is forced back to index 0.
    const contextMessages: VisibleModelContextMessage[] = [
      { messageId: "m-hist", sequence: 1, role: "user", kind: "phase_request", content: "历史消息" },
      { messageId: "m-sys", sequence: 0, role: "system", kind: "system_rules", content: "FIXED_SYSTEM_PROMPT_V1" },
    ]
    await adapter.execute(request, {
      contextChainId: "chain-1",
      contextMessages,
      beforeUserMessagePrompt: beforePrompt,
      afterUserMessagePrompt: afterPrompt,
      stagePrompt: ingestionPrompt,
      phasePrompt: { ref: "p", version: "1", digest: "d", text: "PHASE_BODY" },
      outputMode: "text",
    })

    // 1. Fixed system prompt is ALWAYS index 0 with role "system", and no other message has role "system".
    expect(capturedMessages[0]).toEqual({ role: "system", content: "FIXED_SYSTEM_PROMPT_V1" })
    expect(capturedMessages.slice(1).every((message) => message.role !== "system")).toBe(true)

    // 2. Before-user-message is immediately before user delta, and after-user-message is immediately after user delta.
    const deltaIndex = capturedMessages.findIndex((message) => message.content.startsWith("Worldseed context delta JSON:"))
    expect(deltaIndex).toBeGreaterThan(1)
    expect(capturedMessages[deltaIndex - 1]?.content).toBe(beforePrompt.text.trim())
    expect(capturedMessages[deltaIndex + 1]?.content).toBe(afterPrompt.text.trim())
    expect(capturedMessages[deltaIndex + 2]?.content).toBe(ingestionPrompt.text.trim())
  })

  it("never compresses the fixed leading system prompt even when tail reminders exist, and always re-injects 章节入库阶段 prompt after compaction", async () => {
    const prompts = createNodePrompts()
    const ingestionStagePrompt = await prompts.loadStageEntryPrompt("ingestion")

    const observedCalls: Array<{
      contextMessages: readonly VisibleModelContextMessage[]
      stagePrompt?: string
      phasePrompt?: string
    }> = []
    let attempt = 0

    const mockModel: AIModelPort = {
      info: { provider: "test", model: "test-small", available: true, contextWindowTokens: 12_000 },
      async compressContext() {
        return {
          summary: "压缩后的历史摘要",
          usage: { inputTokens: 100, outputTokens: 50, latencyMs: 1 },
        }
      },
      async execute(request, options) {
        attempt += 1
        observedCalls.push({
          contextMessages: [...(options?.contextMessages ?? [])],
          stagePrompt: options?.stagePrompt?.text,
          phasePrompt: options?.phasePrompt?.text,
        })
        if (attempt === 1) {
          throw new Error("context_length_exceeded: maximum context length is 12000 tokens, requested 15000 tokens")
        }
        return {
          result: {
            schemaVersion: SCHEMA_VERSION,
            envelopeId: randomUUID(),
            contextId: request.contextId,
            phase: request.phase,
            protocolVersion: PROTOCOL_VERSION,
            outcome: "continue",
            producedArtifactIds: [],
            decisionRecordIds: [],
            citedReadIds: [],
            requestedReads: [],
            unresolvedDependencies: [],
            reason: "ok",
            selfReview: "ok",
            artifact: { summary: "ok", proposals: [] },
          },
          usage: { inputTokens: 800, outputTokens: 120, latencyMs: 1 },
        }
      },
    }

    const request = makeFakeRequest("settings_extraction")
    const largeFiller = "旧剧情与旧证据内容。".repeat(300)
    const initialContext: VisibleModelContextMessage[] = [
      { messageId: "sys-0", sequence: 0, role: "system", kind: "system_rules", content: "FIXED_LEADING_SYSTEM_RULES" },
      { messageId: "old-1", sequence: 1, role: "user", kind: "phase_request", turnId: "prev-turn-1", content: largeFiller },
      { messageId: "old-2", sequence: 2, role: "assistant", kind: "phase_response", turnId: "prev-turn-1", content: largeFiller },
      { messageId: "old-3", sequence: 3, role: "user", kind: "phase_instruction", turnId: "prev-turn-2", content: `旧阶段提示\n${largeFiller}` },
      { messageId: "old-4", sequence: 4, role: "assistant", kind: "phase_response", turnId: "prev-turn-2", content: largeFiller },
      { messageId: "tail-reminder", sequence: 5, role: "system", kind: "phase_instruction", turnId: request.turnId, content: "本轮提醒（非 system_rules）" },
    ]

    let compactedEvents = 0
    await executeWithContextCompaction({
      model: mockModel,
      request,
      triggerRatio: 0.85,
      targetRatio: 0.45,
      onCompacted: async () => {
        compactedEvents += 1
      },
      options: {
        contextMessages: initialContext,
        stagePrompt: ingestionStagePrompt,
        reinjectStagePromptOnCompaction: true,
        phasePrompt: {
          ref: "v1:settings_extraction",
          version: "1",
          digest: "d",
          text: `${ingestionStagePrompt.text}\n\n# settings_extraction`,
        },
      },
    })

    expect(compactedEvents).toBe(1)
    expect(observedCalls).toHaveLength(2)

    const afterCompaction = observedCalls[1]!
    // 1. Fixed leading system prompt was NEVER folded/hidden.
    expect(afterCompaction.contextMessages[0]?.messageId).toBe("sys-0")
    expect(afterCompaction.contextMessages[0]?.kind).toBe("system_rules")
    expect(afterCompaction.contextMessages[0]?.content).toBe("FIXED_LEADING_SYSTEM_RULES")

    // 2. 章节入库阶段 prompt was freshly re-injected after compaction (in contextMessages, stagePrompt, AND phasePrompt).
    const reinjected = afterCompaction.contextMessages.find((message) => (
      message.kind === "phase_instruction" && message.content.includes(STAGE_PROMPT_REINJECT_PROTOCOL)
    ))
    expect(reinjected).toBeDefined()
    expect(reinjected?.content).toContain("章节入库阶段")
    expect(afterCompaction.stagePrompt).toContain("章节入库阶段")
    expect(afterCompaction.phasePrompt).toContain("章节入库阶段")
  })

  it("re-injects 章节入库阶段 prompt on usage_threshold compaction and sends it cleanly without duplication through DeepSeekAiModelAdapter", async () => {
    const prompts = createNodePrompts()
    const ingestionStagePrompt = await prompts.loadStageEntryPrompt("ingestion")
    const wirePayloads: Array<Array<{ role: string; content: string }>> = []

    const adapter = new DeepSeekAiModelAdapter(
      { ...defaultDeepSeekRuntimeConfig, contextWindowTokens: 12_000, maxSchemaRepairAttempts: 0, maxTransportRetries: 0, thinkingModeEnabled: false },
      { getSecret: async () => "test-key" },
      prompts,
      {
        async complete(input) {
          if (input.messages[0]?.content.includes("压缩") || input.messages.some((m) => m.content.includes("片段"))) {
            return { content: "章节入库前文摘要。", finishReason: "stop", usage: { prompt_tokens: 100, completion_tokens: 30 } }
          }
          wirePayloads.push(input.messages.map((message) => ({ role: message.role, content: message.content })))
          return {
            content: JSON.stringify({
              outcome: "continue",
              citedReadIds: [],
              requestedReads: [],
              unresolvedDependencies: [],
              reason: "ok",
              selfReview: "ok",
              artifact: { summary: "ok", proposals: [] },
            }),
            finishReason: "stop",
            usage: { prompt_tokens: 400, completion_tokens: 60 },
          }
        },
      },
    )

    const request = makeFakeRequest("settings_extraction")
    const largeHistory = "长篇历史正文与旧设定。".repeat(250)
    const contextMessages: VisibleModelContextMessage[] = [
      { messageId: "sys-0", sequence: 0, role: "system", kind: "system_rules", content: "FIXED_SYSTEM_PROMPT_NEVER_FOLDED" },
      { messageId: "h-1", sequence: 1, role: "user", kind: "phase_request", turnId: "prev-1", content: largeHistory },
      { messageId: "h-2", sequence: 2, role: "assistant", kind: "phase_response", turnId: "prev-1", content: largeHistory },
      { messageId: "h-3", sequence: 3, role: "user", kind: "phase_request", turnId: "prev-2", content: largeHistory },
      { messageId: "h-4", sequence: 4, role: "assistant", kind: "phase_response", turnId: "prev-2", content: largeHistory },
    ]

    let compactedReason: string | undefined
    await executeWithContextCompaction({
      model: adapter,
      request,
      lastRequestInputTokens: 11_000,
      triggerRatio: 0.8,
      targetRatio: 0.4,
      onCompacted: async (event) => {
        compactedReason = event.reason
      },
      options: {
        contextChainId: "ingestion-chain-1",
        contextMessages,
        stagePrompt: ingestionStagePrompt,
        reinjectStagePromptOnCompaction: true,
        phasePrompt: {
          ref: "v1:settings_extraction",
          version: "1",
          digest: "d",
          text: `${ingestionStagePrompt.text}\n\n# settings_extraction`,
        },
      },
    })

    expect(compactedReason).toBe("usage_threshold")
    expect(wirePayloads).toHaveLength(1)
    const sent = wirePayloads[0]!
    // Fixed system prompt remains at index 0 untouched after compaction.
    expect(sent[0]).toEqual({ role: "system", content: "FIXED_SYSTEM_PROMPT_NEVER_FOLDED" })
    // Ingestion stage prompt appears cleanly (deduplicated from stage-prompt-reinject-v1 marker) on the post-compaction wire request.
    const matches = sent.filter((message) => message.content.includes("正式章节入库流程"))
    expect(matches).toHaveLength(1)
    expect(sent.some((message) => message.content.includes(STAGE_PROMPT_REINJECT_PROTOCOL))).toBe(false)
  })

  it("enforces full lifecycle: message before/after, AI-semantic compose gate (no regex), start_compose prompt, ingestion prompt, and post-publish 新章节阶段 handoff", async () => {
    const fake = new FakeAiModelAdapter(randomUUID)
    const recordedCalls: Array<{
      phase: string
      discussTrigger?: string
      before?: string
      after?: string
      stagePrompt?: string
      phasePrompt?: string
      systemRulesCount: number
      firstSystemRole?: string
      firstSystemContent?: string
    }> = []
    let classifyReply: Record<string, unknown> = {}
    let discussReplyQueue: string[] = []

    const model: AIModelPort = {
      info: { provider: "test", model: "five-contracts-model", available: true, contextWindowTokens: 64_000 },
      async classifyDiscussTurn(_input: DiscussTurnClassificationInput) {
        return {
          scope: classifyReply as never,
          usage: { modelCalls: 1, inputTokens: 10, outputTokens: 10, latencyMs: 1 },
        }
      },
      async execute(request, options?: ModelExecutionOptions): Promise<PhaseModelExecution> {
        const ctx = options?.contextMessages ?? []
        const sysMessages = ctx.filter((message) => message.kind === "system_rules")
        const discuss = (request.input as { synopsisDiscuss?: { discussTrigger?: string } }).synopsisDiscuss
        recordedCalls.push({
          phase: request.phase,
          ...(discuss?.discussTrigger === undefined ? {} : { discussTrigger: discuss.discussTrigger }),
          ...(options?.beforeUserMessagePrompt === undefined ? {} : { before: options.beforeUserMessagePrompt.text }),
          ...(options?.afterUserMessagePrompt === undefined ? {} : { after: options.afterUserMessagePrompt.text }),
          ...(options?.stagePrompt === undefined ? {} : { stagePrompt: options.stagePrompt.text }),
          ...(options?.phasePrompt === undefined ? {} : { phasePrompt: options.phasePrompt.text }),
          systemRulesCount: sysMessages.length,
          firstSystemRole: ctx[0]?.role,
          firstSystemContent: ctx[0]?.content,
        })
        if (request.phase === "synopsis_discuss") {
          synopsisConversationStreamHub.setTodos(request.projectId, [
            { id: "write", content: "核对本轮要求", status: "completed" },
          ], Date.now())
          const reply = discussReplyQueue.shift() ?? "好的，我们继续讨论。"
          return {
            result: {
              schemaVersion: SCHEMA_VERSION,
              envelopeId: randomUUID(),
              contextId: request.contextId,
              phase: "synopsis_discuss",
              protocolVersion: PROTOCOL_VERSION,
              outcome: "continue",
              producedArtifactIds: [],
              decisionRecordIds: [],
              citedReadIds: [...request.committedReadIds],
              requestedReads: [],
              unresolvedDependencies: [],
              reason: "ok",
              selfReview: "ok",
              artifact: { assistantMessage: reply, finalSelfReview: "ok" },
            },
            usage: { modelCalls: 1, inputTokens: 120, outputTokens: 80, latencyMs: 1 },
          }
        }
        return fake.execute(request, options)
      },
    }

    const harness = await openChapterHarness("Five Prompt Contracts E2E", { model })
    try {
      await prepareChapterPlanning(harness)

      // Add project-level custom prompts for 消息前/消息后/新章节阶段/构思阶段/章节入库阶段.
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "提示词/用户规则/消息前后/用户消息前.md", "CUSTOM_BEFORE_USER_RULE")
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "提示词/用户规则/消息前后/用户消息后.md", "CUSTOM_AFTER_USER_RULE")
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "提示词/用户规则/阶段提示词/新章节阶段.md", "CUSTOM_NEW_CHAPTER_STAGE_RULE")
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "提示词/用户规则/阶段提示词/构思阶段.md", "CUSTOM_COMPOSE_STAGE_RULE")
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "提示词/用户规则/阶段提示词/章节入库阶段.md", "CUSTOM_INGESTION_STAGE_RULE")

      // Step 1: User message mentions "构思/草稿" ONLY as a negation/question.
      // Because AI returns {} and no <request-compose/>, host must NOT pop up「开始构思」(proving no regex!).
      classifyReply = {}
      discussReplyQueue.push("明白，我们先把线索节奏理顺，先不写草稿。\n<creative-choices>\n- 先定反派动机\n- 先定站台细节\n</creative-choices>")
      const discussOnly = await send(harness, {
        message: "先别开始构思也别写草稿，我们只讨论一下站台的悬疑氛围",
        proceedMode: "precise",
      })
      const firstCall = recordedCalls.at(-1)!
      // System prompt fixed at index 0 with exactly one system_rules entry (tail reminders are NOT system_rules).
      expect(firstCall.firstSystemRole).toBe("system")
      expect(firstCall.systemRulesCount).toBe(1)
      // Message before/after md prompts ALWAYS injected with both bundled and workspace overrides.
      expect(firstCall.before).toContain("以下紧邻内容为用户本轮发送的原始消息")
      expect(firstCall.before).toContain("CUSTOM_BEFORE_USER_RULE")
      expect(firstCall.after).toContain("以上为用户本轮原始消息")
      expect(firstCall.after).toContain("CUSTOM_AFTER_USER_RULE")
      // Compose-request prompt injected during pre-compose discussion.
      expect(firstCall.stagePrompt).toContain("<request-compose/>")
      // No Start button popped up because AI did not detect compose intent!
      const discussAssistant = discussOnly.messages.filter((message) => message.role === "assistant").at(-1)
      expect(discussAssistant?.choices?.some((choice) => choice.action === "start_compose")).not.toBe(true)
      expect(discussAssistant?.choices?.every((choice) => choice.action === "continue_discuss")).toBe(true)

      // Step 2: User expresses natural-language intent to start writing without magic keywords;
      // AI semantic classifier recognizes compose intent -> host pops up「开始构思」&「仅讨论」without writing yet.
      classifyReply = { synopsis: "create", outline: "create", draft: "write" }
      discussReplyQueue.push("好，思路已经清晰，你可以点击下方按钮开始构思本章。")
      const intentDetected = await send(harness, {
        message: "嗯，就按刚才聊的这个方向落下来吧",
        proceedMode: "precise",
      })
      expect(intentDetected.appendedDraft).toBeUndefined()
      const intentAssistant = intentDetected.messages.filter((message) => message.role === "assistant").at(-1)
      expect(intentAssistant?.choices?.map((choice) => choice.action)).toEqual(["start_compose", "discuss_only"])

      // Step 3: User clicks「开始构思」-> injects 构思阶段 prompt (bundled + project override) and authors 梗概+细纲+草稿,
      // then pops up「发布正文」&「仅讨论」.
      discussReplyQueue.push(composeAll)
      const composed = await send(harness, {
        message: "开始构思（梗概+细纲+草稿）",
        proceedMode: "precise",
        preciseAction: "start_compose",
      })
      const composeCall = recordedCalls.at(-1)!
      expect(composeCall.stagePrompt).toContain("用户已点击「开始构思」确认进入本章节构思阶段")
      expect(composeCall.stagePrompt).toContain("CUSTOM_COMPOSE_STAGE_RULE")
      expect(composeCall.before).toContain("以下紧邻内容为用户本轮发送的原始消息")
      expect(composeCall.after).toContain("以上为用户本轮原始消息")
      const draftVersionId = composed.appendedDraft?.draftVersionId
      expect(draftVersionId).toBeTruthy()
      const composeAssistant = composed.messages.filter((message) => message.role === "assistant").at(-1)
      expect(composeAssistant?.choices?.map((choice) => choice.action)).toEqual(["promote_draft_to_body", "discuss_only"])

      // Step 4: User clicks「发布正文」-> enters 章节入库阶段 (injecting 章节入库阶段 prompt into revision_review and every TurnOrchestrator revision phase)
      // -> after publish completes, host invokes AI with 新章节阶段 prompt to wrap up main/sub-plots, goals, and volume info!
      const callsBeforePublish = recordedCalls.length
      discussReplyQueue.push([
        "已完成第1章主线/支线收尾、推演目标更新与卷进度核对，第2章可围绕列车内的神秘乘客展开。",
        "<handoff-outline>",
        "# 第一卷大纲（第1章后更新）\n- 主线：林烬已登上末班车，第2章进入车厢追查黑伞人。",
        "</handoff-outline>",
        "<goal-proposals>",
        "kind: create",
        "content: 查明车厢尾节黑伞人的真实身份与车票来源",
        "narrativeKind: foreshadow",
        "scale: short",
        "plantChapterSequence: 1",
        "payoffChapterSequence: 2",
        "reason: 第1章结尾已埋下黑伞人线索，第2章推进核查。",
        "</goal-proposals>",
        "<creative-choices>",
        "- 第2章先从车厢偶遇黑伞人切入",
        "- 第2章先从车票暗码破译切入",
        "</creative-choices>",
      ].join("\n"))

      const published = await send(harness, {
        message: "发布正文",
        proceedMode: "precise",
        preciseAction: "publish",
        publishDraftVersionId: draftVersionId,
        chapterSequence: 1,
      })

      const publishCalls = recordedCalls.slice(callsBeforePublish)
      const revisionCalls = publishCalls.filter((call) => call.phase !== "synopsis_discuss")
      expect(revisionCalls.length).toBeGreaterThanOrEqual(2)
      // Every chapter ingestion phase (including revision_review & TurnOrchestrator phases) received 章节入库阶段 prompt!
      for (const call of revisionCalls) {
        expect(call.stagePrompt, `phase ${call.phase} must receive ingestion stage prompt`).toContain("正式章节入库流程")
        expect(call.stagePrompt, `phase ${call.phase} must receive project ingestion rule`).toContain("CUSTOM_INGESTION_STAGE_RULE")
      }

      // Post-publish 新章节阶段 call fired by code with 新章节阶段 prompt + project override!
      const newChapterCall = publishCalls.find((call) => call.phase === "synopsis_discuss")
      expect(newChapterCall).toBeDefined()
      expect(newChapterCall?.discussTrigger).toBe("new_chapter_entry")
      expect(newChapterCall?.stagePrompt).toContain("上一章正文已完成章节入库并落盘")
      expect(newChapterCall?.stagePrompt).toContain("CUSTOM_NEW_CHAPTER_STAGE_RULE")

      // Volume outline & deduction goals were updated by the 新章节阶段 wrap-up!
      expect(published.session.chapterSequence).toBe(2)
      expect(published.proceedProgress).toEqual({ stage: "chapter_requirements", status: "waiting" })
      const updatedArcPlan = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "暂存区/弧线规划.md")
      expect(updatedArcPlan).toContain("第1章后更新")
      const goals = await invoke<{ goals: Array<{ content: string }> }>(harness, "deduction.goals.list", {})
      expect(goals.goals.some((goal) => goal.content.includes("黑伞人"))).toBe(true)

      // Post-publish choices only contain discussion directions (never start_compose/publish yet).
      const publishAssistant = published.messages.filter((message) => message.role === "assistant").at(-1)
      expect(publishAssistant?.choices?.some((choice) => choice.action === "start_compose")).not.toBe(true)
      expect(publishAssistant?.choices?.some((choice) => choice.action === "promote_draft_to_body")).not.toBe(true)
      expect(publishAssistant?.choices?.map((choice) => choice.label)).toEqual([
        "第2章先从车厢偶遇黑伞人切入",
        "第2章先从车票暗码破译切入",
      ])
    } finally {
      await closeHarness(harness)
    }
  })
})
