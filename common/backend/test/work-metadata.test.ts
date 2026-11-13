import { randomUUID } from "node:crypto"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import { synopsisDiscussArtifactSchema, workNamingArtifactSchema } from "@starseafolio/prompt-contracts"

import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { openChapterHarness, prepareChapterPlanning, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

async function invoke<T>(harness: ChapterHarness, method: string, extra: Record<string, unknown> = {}): Promise<T> {
  const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...extra } })
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data as T
}

async function withHarness(run: (harness: ChapterHarness) => Promise<void>, options?: Parameters<typeof openChapterHarness>[1]): Promise<void> {
  const harness = await openChapterHarness("潮声纪", options)
  try { await run(harness) } finally {
    await harness.container.close()
    rmSync(harness.root, { recursive: true, force: true })
  }
}

function metadataModel(captured: Array<{ title?: string; description?: string }>): AIModelPort {
  const fake = new FakeAiModelAdapter(randomUUID)
  return {
    async execute(request, options) {
      const result = await fake.execute(request, options)
      if (request.phase !== "synopsis_discuss") return result
      const input = request.input as { synopsisDiscuss?: { currentWorkDisplayName?: string; currentWorkDescription?: string } }
      captured.push({ title: input.synopsisDiscuss?.currentWorkDisplayName, description: input.synopsisDiscuss?.currentWorkDescription })
      synopsisConversationStreamHub.setTodos(request.projectId, [{ id: "metadata", content: "更新作品资料", status: "completed" }], Date.now())
      return { ...result, result: { ...result.result, outcome: "continue", artifact: {
        assistantMessage: "已调整作品资料，接下来可以讨论人物或主线。",
        finalSelfReview: "仅更新整部作品的标题与简介。",
        workDisplayName: "潮声未歇", workDescription: "少年循着一封旧信追查失踪者，在海港的风雨中寻找真相。",
        choices: [
          { label: "讨论人物", action: "continue_discuss", prompt: "讨论人物" },
          { label: "讨论主线", action: "continue_discuss", prompt: "讨论主线" },
        ],
      } } }
    },
  }
}

describe("work title and description", () => {
  it("persists introduction and keeps it when only the title changes", async () => {
    await withHarness(async (harness) => {
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "潮声纪", description: "" })
      await expect(invoke(harness, "workspace.save", { relativePath: "设定集/作品简介.md", content: `# 作品简介\n\n${"字".repeat(301)}` })).rejects.toThrow("300")
      const description = "少年循着旧信，走进一座被潮水隔绝的海港。"
      await invoke(harness, "project.rename", { displayName: "潮声未歇", description })
      expect(readFileSync(join(harness.workspaceRootRef, "设定集/作品简介.md"), "utf8")).toBe(`# 作品简介\n\n${description}\n`)
      await invoke(harness, "project.rename", { displayName: "海港来信" })
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "海港来信", description })
      await invoke(harness, "project.open")
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "海港来信", description })
      await invoke(harness, "project.rename", { displayName: "海港来信", description: "" })
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "海港来信", description: "" })
    })
  })

  it("rejects oversized introductions before changing the title or file", async () => {
    await withHarness(async (harness) => {
      await expect(invoke(harness, "project.rename", { displayName: "不应写入", description: "字".repeat(301) })).rejects.toThrow()
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "潮声纪", description: "" })
      expect(workNamingArtifactSchema.safeParse({ displayName: "潮声", description: "字".repeat(301), finalSelfReview: "验证" }).success).toBe(false)
      expect(synopsisDiscussArtifactSchema.safeParse({ assistantMessage: "简介", workDescription: "字".repeat(301), finalSelfReview: "验证" }).success).toBe(false)
      await invoke(harness, "project.rename", { displayName: "潮声纪", description: "字".repeat(300) })
      expect((await invoke<{ description: string }>(harness, "project.metadata.read")).description).toHaveLength(300)
    })
  })

  it("AI suggestions read the saved introduction without mutating it before apply", async () => {
    await withHarness(async (harness) => {
      const runtime = await harness.container.getRuntime(harness.projectId, harness.workspaceRootRef)
      await runtime.saveWorkDescription("少年在海港追查一封旧信的来历。")
      const fake = new FakeAiModelAdapter(randomUUID)
      let context = ""
      const model: AIModelPort = { execute: async (request, options) => {
        context = JSON.stringify(request.input)
        return fake.execute(request, options)
      } }
      const suggested = await runtime.createWorkNameSuggestService().suggest({ projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, model })
      expect(context).toContain("少年在海港追查一封旧信的来历。")
      expect(suggested.description.length).toBeGreaterThan(0)
      expect(suggested.description.length).toBeLessThanOrEqual(300)
      expect(await runtime.readWorkDescription()).toBe("少年在海港追查一封旧信的来历。")
    })
  })

  it("saves AI metadata during discussion and injects the latest version next turn", async () => {
    const captured: Array<{ title?: string; description?: string }> = []
    await withHarness(async (harness) => {
      await prepareChapterPlanning(harness)
      await invoke(harness, "project.rename", { displayName: "潮声纪", description: "最初的海港故事。" })
      await invoke(harness, "synopsis.conversation.start")
      const sent = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", { message: "根据现有剧情调整标题与作品简介，先不推进章节。" })
      expect(sent.workDescription).toBe("少年循着一封旧信追查失踪者，在海港的风雨中寻找真相。")
      expect(sent.workDisplayName).toBe("潮声未歇")
      expect(captured[0]).toEqual({ title: "潮声纪", description: "最初的海港故事。" })
      await invoke(harness, "synopsis.conversation.send", { message: "继续讨论人物，先不推进章节。" })
      expect(captured.at(-1)).toEqual({ title: "潮声未歇", description: sent.workDescription })
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "潮声未歇", description: sent.workDescription })
    }, { model: metadataModel(captured) })
  })

  it("exposes and saves metadata in protagonist setup questions too", async () => {
    const captured: Array<{ title?: string; description?: string }> = []
    await withHarness(async (harness) => {
      await invoke(harness, "project.rename", { displayName: "潮声纪", description: "海港少年。" })
      await invoke(harness, "synopsis.conversation.start")
      const sent = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", { message: "先讨论主角，顺便根据构思调整书名和简介。" })
      expect(captured[0]).toEqual({ title: "潮声纪", description: "海港少年。" })
      expect(sent.workDescription).toBe("少年循着一封旧信追查失踪者，在海港的风雨中寻找真相。")
      expect(await invoke(harness, "project.metadata.read")).toEqual({ displayName: "潮声未歇", description: sent.workDescription })
    }, { model: metadataModel(captured), creativeSetupReady: false })
  })

  it("updates the introduction after a completed chapter hands back to discussion", async () => {
    const captured: Array<{ title?: string; description?: string }> = []
    await withHarness(async (harness) => {
      await prepareChapterPlanning(harness)
      const runtime = await harness.container.getRuntime(harness.projectId, harness.workspaceRootRef)
      await runtime.saveWorkDescription("章节推进之前的简介。")
      const service = runtime.createSynopsisConversationService()
      const session = await service.start({ projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef })
      // Chapter publication/navigation has its own gate tests; isolate metadata handoff here.
      vi.spyOn(service, "setFocus").mockResolvedValue(session)
      await service.recordTurnHandoff({
        projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, model: metadataModel(captured),
        brief: { taskId: randomUUID(), chapterSequence: 1, chapterPath: "章节正文/第一卷 待命名/第一章 来信.md",
          chapterHeading: "第一章 来信", bodyDigest: "少年在海港找到了失踪者留下的第二封信。", outlineNotes: [], createdAtMs: Date.now() },
      })
      expect(captured[0]).toEqual({ title: "潮声纪", description: "章节推进之前的简介。" })
      expect(await runtime.readWorkDescription()).toBe("少年循着一封旧信追查失踪者，在海港的风雨中寻找真相。")
    })
  })
})
