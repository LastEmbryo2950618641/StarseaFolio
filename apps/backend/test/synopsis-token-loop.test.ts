import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"

import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@worldseed/contracts"

import type { AIModelPort, ModelExecutionOptions, TurnPhaseInput } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { openChapterHarness, prepareChapterPlanning, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

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
  it("honors an explicit call budget, grants one final call, and blocks automatic restart", async () => {
    let calls = 0
    await withScript((call, request) => {
      calls = call
      synopsisConversationStreamHub.setTodos(request.projectId, todos, Date.now())
      return tool("memory_write")
    }, async (_harness, send) => {
      const sent = await send({ maxModelCalls: 6 })
      expect(calls).toBe(7)
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
    }, async (_harness, send) => {
      const sent = await send()
      expect(calls).toBeLessThanOrEqual(7)
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.messages.at(-1)?.content).toContain("重复")
      expect(sent.messages.at(-1)?.todos?.[0]?.status).toBe("in_progress")
      expect(sent.appendedDraft).toBeUndefined()
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
      const sent = await send()
      expect(calls).toBe(5)
      expect(sent.autoContinue).toBeUndefined()
      expect(sent.appendedDraft).toBeUndefined()
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
      return tool("memory_write")
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

  it("still runs draft review and graph governance before publishing through the tools", async () => {
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
      return { choices }
    }, async (harness, send) => {
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Test runtime is not open")
      const settings = await runtime.readSettings()
      await runtime.saveSettings({ ...settings, creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true } })
      const sent = await send({ maxModelCalls: 40, batchProceed: false })
      expect(calls).toBe(8)
      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "chapter.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!response.ok) throw new Error(response.error.message)
      expect(response.data).toHaveLength(1)
      expect(sent.messages.at(-1)?.toolRuns?.some((run) => run.name === "publish_draft" && run.status === "completed")).toBe(true)
    })
  })
})
