import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@worldseed/contracts"

import type { AIModelPort, ModelExecutionOptions, TurnPhaseInput } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { ChapterRevisionService, RevisionInvalidStateError } from "../src/application/chapters/chapter-revision-service.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { confirmedVolumeStorylineFixture, openChapterHarness, prepareChapterPlanning, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const todos = [{ id: "draft", content: "生成正文草稿", status: "in_progress" as const }]
const draft = { base: "body", heading: "第一章 雨夜旧站台", body: "林烬走进雨夜的旧站台，灯下多了一封没有落款的信。他展开信纸，认出了失踪者的字迹。" }
const choices = [{ label: "检查当前草稿", action: "continue_discuss" }]
const tool = (name: string, action = "describe", args?: unknown) => ({
  toolRequest: { name, action, ...(args === undefined ? {} : { arguments: JSON.stringify(args) }) },
})

async function withScript(
  script: (call: number, request: Parameters<AIModelPort["execute"]>[0], options?: ModelExecutionOptions) => Record<string, unknown>,
  run: (harness: ChapterHarness, send: (extra?: Record<string, unknown>) => Promise<SynopsisConversationSendResult>) => Promise<void>,
): Promise<void> {
  let calls = 0
  const fake = new FakeAiModelAdapter(randomUUID)
  const model: AIModelPort = {
    info: { provider: "test", model: "token-loop", available: true, contextWindowTokens: 64_000 },
    async execute(request, options) {
      if (request.phase !== "synopsis_discuss") return fake.execute(request, options)
      const artifact = { assistantMessage: "正在处理当前章。", finalSelfReview: "Scripted regression.", ...script(++calls, request, options) }
      return {
        result: {
          schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
          outcome: "continue", artifact, requestedReads: [], citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Regression", selfReview: "Regression",
        },
        usage: { inputTokens: 100, lastRequestInputTokens: 100, outputTokens: 20, latencyMs: 0, modelCalls: 1 },
      }
    },
  }
  const harness = await openChapterHarness("Token loop regression", { model })
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
  it("retains a volume plan while repairing only its writing settings", async () => {
    let calls = 0
    const synopsis = "# 第一卷梗概\n主角追查雨夜站台的信件，查明失踪者下落。"
    const outline = "# 第一卷大纲\n第一章发现信件；后续逐步查明失踪真相。"
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? {
        volumePlanMeta: { targetChapterCount: 8, targetWordCount: 24000 },
        volumeSynopsis: { markdown: synopsis }, arcPlan: { markdown: outline }, choices,
      } : { creationDeskSettings: {
        descriptionRulePath: "表现输出/描写规则/自动.md",
        proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md",
        minimumWordCount: 2500, maximumWordCount: 3500, boundaryPace: "advance_allowed", causalityFocus: "action",
      }, choices }
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

  it("retains a complete draft when the next response only supplies stop choices", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return call === 1 ? { chapterDraftProposal: draft } : { choices }
    }, async (_harness, send) => {
      const sent = await send({ batchProceed: false })
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(calls).toBe(2)
    })
  })

  it("does not request stop choices during autonomous continuation", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ batchProceed: true, batchAutomation: false })
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, continueTurn: true }
    }, async (_harness, send) => {
      const sent = await send()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.autoContinue).toBeDefined()
      expect(calls).toBe(1)
    })
  })

  it("auto-continues to the outline after a batch-written synopsis without model continuation flags", async () => {
    let calls = 0
    const synopsisBody = "# 第一章 雨夜旧站台 剧情梗概\n主角在旧站台发现一封来自失踪者的信，并决定追查信件来源。"
    await withScript((call, request) => {
      calls = call
      expect((request.input as TurnPhaseInput).synopsisDiscuss).toMatchObject({ batchProceed: true })
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody }
    }, async (harness, send) => {
      const sent = await send({ message: "继续推进第一章", batchProceed: true })
      expect(calls).toBe(1)
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, sent.session.synopsisPath))
        .toContain("来自失踪者的信")
      expect(sent.autoContinue?.message).toContain("剧情梗概已写入并通过状态门禁")
      expect(sent.autoContinue?.message).toContain("写入本章细纲")
    })
  })

  it("continues with the saved draft instead of executing every alternative", async () => {
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { chapterDraftProposal: draft, choices: [
        { label: "发布当前草稿", action: "continue_discuss" },
        { label: "把第一章结尾再改冷一点", action: "continue_discuss" },
      ] }
    }, async (_harness, send) => {
      const sent = await send()
      expect(sent.autoContinue?.message).toContain(sent.appendedDraft!.draftVersionId)
      expect(sent.autoContinue?.message).toContain(sent.appendedDraft!.revisionTaskId)
      expect(sent.autoContinue?.message).toContain("publish_draft")
      expect(sent.autoContinue?.message).not.toContain("可依次全部完成")
      expect(sent.autoContinue?.message).not.toContain("把第一章结尾再改冷一点")
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
      const reminder = options?.contextMessages?.filter((message) => message.kind === "system_rules").at(-1)?.content ?? ""
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
      await expect(send()).rejects.toThrow(/todo_no_progress.*3.*停止/)
      expect(calls).toBe(5)
    })
  })

  it("throws on the third repeated unchanged tool description", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos, Date.now())
      return tool("memory_write")
    }, async (_harness, send) => {
      await expect(send()).rejects.toThrow(/memory_write.*describe_no_progress.*3.*停止/)
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
      await expect(send({ message: "检查记忆工具", batchProceed: false }))
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
      await expect(send({ message: "检查记忆工具" })).rejects.toThrow(/memory_write.*3.*停止/)
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
      const extra = { message: "检查记忆工具", batchProceed: false }
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
      const extra = { message: "检查记忆工具", batchProceed: false }
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
    await withScript((_call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { choices, continueTurn: true }
    }, async (_harness, send) => {
      const results = []
      for (let turn = 0; turn < 2; turn += 1) results.push(await send({ message: "继续检查当前进度" }))
      expect(results[0]?.autoContinue).toBeDefined()
      await expect(send({ message: "继续检查当前进度" })).rejects.toThrow(/3.*没有实际内容进展.*停止/)
    })
  })

  it("keeps batch continuation available while real planning content changes", async () => {
    await withScript((call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { synopsisBody: `# 第一章 剧情梗概\n\n林烬发现信后追查线索，当前追查到第${String(call)}处站台。`, choices, continueTurn: true }
    }, async (_harness, send) => {
      for (let turn = 0; turn < 5; turn += 1) {
        const sent = await send({ message: "继续完善当前章梗概" })
        expect(sent.autoContinue).toBeDefined()
      }
    })
  })

  it("does not count a successful planning update as a failed no-progress turn", async () => {
    await withScript((call, request) => {
      synopsisConversationStreamHub.setTodos(request.projectId, todos.map((todo) => ({ ...todo, status: "completed" })), Date.now())
      return { ...(call === 1 ? { synopsisBody: "# 第一章 剧情梗概\n\n林烬在旧站台找到信件，并决定追查失踪者。" } : {}), choices, continueTurn: true }
    }, async (_harness, send) => {
      const extra = { message: "继续完善当前章规划" }
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
        .mockRejectedValueOnce(new RevisionInvalidStateError("剧情梗概必须先确认"))
      try {
        const sent = await send()
        expect(sent.appendedDraft).toBeUndefined()
        expect(sent.autoContinue).toBeUndefined()
        expect(sent.messages.at(-1)?.content).toContain("剧情梗概必须先确认")
        expect(sent.messages.at(-1)?.content).not.toContain("已自动延后")
        expect(sent.messages.at(-1)?.choices?.length).toBeGreaterThan(0)
      } finally {
        rejected.mockRestore()
      }
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
      await expect(send()).rejects.toThrow(/todo_no_progress.*3.*停止/)
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
      const sent = await send()
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
      await expect(send()).rejects.toThrow(/todo_write.*describe_no_progress.*3.*停止/)
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
      const sent = await send()
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

  it.each([
    { batchProceed: false, changeFocus: false },
    { batchProceed: true, changeFocus: false },
    { batchProceed: true, changeFocus: true },
  ])("still runs review and graph governance before publishing ($batchProceed, $changeFocus)", async ({ batchProceed, changeFocus }) => {
    let calls = 0
    await withScript((call, _request, options) => {
      calls = call
      if (call === 1) return tool("todo_write")
      if (call === 2) return tool("todo_write", "invoke", { todos, merge: false })
      if (call === 3) return tool("chapter_workflow")
      if (call === 4) return tool("chapter_workflow", "invoke", { userInput: "林烬在雨夜站台找到失踪者留下的信。" })
      if (call === 5) return tool("publish_draft")
      if (call === 6) {
        const created = options?.contextMessages?.flatMap((message) => {
          try {
            const value = JSON.parse(message.content) as { status?: string; result?: unknown }
            return value.status === "draft_created" ? [value.result] : []
          } catch { return [] }
        }).at(-1) as { revisionTaskId: string; draftVersionId: string } | undefined
        if (created === undefined) throw new Error("Workflow tool did not return a draft")
        return tool("publish_draft", "invoke", { revisionTaskId: created.revisionTaskId, draftVersionId: created.draftVersionId })
      }
      if (call === 7) return tool("todo_write", "invoke", { todos: todos.map((todo) => ({ ...todo, status: "completed" })), merge: true })
      return { choices, ...(changeFocus ? { focusChange: { chapterSequence: 2 } } : {}) }
    }, async (harness, send) => {
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Test runtime is not open")
      const settings = await runtime.readSettings()
      await runtime.saveSettings({ ...settings, creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true } })
      const sent = await send({ maxModelCalls: 40, batchProceed })
      expect(calls).toBe(8)
      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "chapter.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!response.ok) throw new Error(response.error.message)
      expect(response.data).toHaveLength(1)
      expect(sent.messages.at(-1)?.toolRuns?.some((run) => run.name === "publish_draft" && run.status === "completed")).toBe(true)
      if (batchProceed) {
        expect(sent.autoContinue?.message).toContain("正文已发布")
        expect(sent.autoContinue?.message).not.toContain("publish_draft")
        if (changeFocus) {
          expect(sent.session.chapterSequence).toBe(2)
          expect(sent.autoContinue?.message).toContain("第2章")
          expect(sent.autoContinue?.message).not.toContain("先切换")
        } else {
          expect(sent.autoContinue?.message).toContain("本轮只切换焦点")
        }
      }
    })
  })
})
