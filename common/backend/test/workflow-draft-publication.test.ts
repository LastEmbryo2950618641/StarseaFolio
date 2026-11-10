import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type BackendMethod, type RevisionDraftVersion, type ChapterRevision, type ChapterRevisionReadResult } from "@starseafolio/contracts"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { confirmedVolumeStorylineFixture, openChapterHarness as openBaseChapterHarness, prepareChapterPlanning, waitForTask, waitForRevisionGraphSync } from "./helpers/chapter-coordination-harness.js"

async function openChapterHarness(...args: Parameters<typeof openBaseChapterHarness>) {
  const harness = await openBaseChapterHarness(...args)
  await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef,
    "大纲/第一卷 待命名.梗概.md", "# 卷梗概\n\n主角从旧站台发现线索，沿途追查失踪者。")
  await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef,
    "大纲/第一卷 待命名.md", "# 卷大纲\n\n前四章发现线索，后四章揭示失踪原因。")
  await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef,
    "大纲/第一卷 待命名.批量计划.md", serializeVolumePlanningState({
      ...confirmedVolumeStorylineFixture,
      volumeFolderName: "第一卷 待命名", startSequence: 1, targetChapterCount: 8, targetWordCount: 24000,
      synopsisWriteCount: 1, outlineWriteCount: 1,
    }))
  return harness
}

describe("workflow drafts and publication", () => {
  it("returns chapter artifact contents and counts each first write and later content change", async () => {
    const harness = await openChapterHarness("Chapter information")
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const first = await call<{
        synopsis: { markdown: string; writeCount: number }
        outline: { markdown: string; writeCount: number }
        body: { markdown: string; writeCount: number }
      }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(first).toMatchObject({
        synopsis: { markdown: expect.stringContaining("旧站台的灯"), writeCount: 1 },
        outline: { markdown: expect.stringContaining("章定位"), writeCount: 1 },
        body: { markdown: "", writeCount: 0 },
      })

      await harness.container.workspace.saveSynopsisMarkdown(
        harness.workspaceRootRef,
        "章节正文/第一卷 待命名/第一章 雨夜旧站台 [剧情细纲].md",
        "# 第一章 雨夜旧站台 剧情细纲\n\n- 章定位：主角收到一封迟来的信。\n",
      )
      const changed = await call<{
        outline: { markdown: string; writeCount: number }
      }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(changed.outline).toMatchObject({ markdown: expect.stringContaining("迟来的信"), writeCount: 2 })

      await call<RevisionDraftVersion>("chapter.draft.start", {
        chapterSequence: 1,
        heading: "第一章 雨夜旧站台",
        body: "正式正文内容。",
        source: "workflow",
      })
      const draftOnly = await call<{ body: { markdown: string; writeCount: number } }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(draftOnly.body).toMatchObject({ markdown: "", writeCount: 0 })
      await harness.container.workspace.publishChapter(
        harness.workspaceRootRef,
        "章节正文/第一卷 待命名/第一章 雨夜旧站台.md",
        "# 第一章 雨夜旧站台\n\n正式正文内容。\n",
      )
      const published = await call<{
        body: { markdown: string; writeCount: number }
      }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(published.body).toMatchObject({ markdown: expect.stringContaining("正式正文内容"), writeCount: 1 })
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)

  it("enforces synopsis confirmation and outline before drafting, then reviews before publication", async () => {
    const harness = await openChapterHarness("Workflow gate")
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      const blocked = await call<{
        readyForDraft: boolean
        blockedReasons: string[]
        synopsis: { contentState: string; ready: boolean }
        outline: { contentState: string; ready: boolean }
        draft: { contentState: string }
      }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(blocked.readyForDraft).toBe(false)
      expect(blocked.blockedReasons).toHaveLength(3)
      expect(blocked).toMatchObject({
        synopsis: { contentState: "empty", ready: false },
        outline: { contentState: "empty", ready: false },
        draft: { contentState: "empty" },
      })
      await expect(call("turn.start", { chapterSequence: 1, userInput: "Blocked" })).rejects.toThrow("剧情梗概")
      await expect(call("chapter.draft.start", {
        chapterSequence: 1,
        heading: "第一章 草稿",
        body: "Blocked",
        source: "workflow",
      })).rejects.toThrow("剧情梗概")

      await prepareChapterPlanning(harness)
      const ready = await call<{
        readyForDraft: boolean
        synopsis: { contentState: string }
        outline: { contentState: string; path?: string }
      }>("chapter.workflowGate.get", { chapterSequence: 1 })
      expect(ready.readyForDraft).toBe(true)
      expect(ready.outline.path).toBeDefined()
      expect(ready.synopsis.contentState).toBe("manual_modified")
      expect(ready.outline.contentState).toBe("manual_modified")
      await harness.container.workspace.saveSynopsisMarkdown(
        harness.workspaceRootRef,
        ready.outline.path!,
        "# 第一章 雨夜旧站台 剧情细纲\n",
      )
      expect(await call("chapter.workflowGate.get", { chapterSequence: 1 })).toMatchObject({
        readyForDraft: false,
        outline: { ready: false },
      })
      await expect(call("chapter.draft.start", {
        chapterSequence: 1,
        heading: "第一章 草稿",
        body: "Placeholder blocked",
        source: "workflow",
      })).rejects.toThrow("剧情细纲")
      await prepareChapterPlanning(harness)
      const draft = await call<RevisionDraftVersion>("chapter.draft.start", {
        chapterSequence: 1,
        heading: "第一章 草稿",
        body: "Reviewed draft",
        source: "workflow",
      })
      const alternative = await call<RevisionDraftVersion>("chapter.revision.draftVersion.append", {
        revisionTaskId: draft.revisionTaskId,
        source: "agent",
        heading: "第一章 备选草稿",
        body: "Alternative draft",
      })
      expect(alternative.isLatest).toBe(true)
      expect(await call("chapter.workflowGate.get", { chapterSequence: 1 })).toMatchObject({
        draft: { contentState: "ai_written", versionId: alternative.versionId },
      })
      await expect(call("chapter.submitRevision", {
        revisionTaskId: draft.revisionTaskId,
        mode: "reviewed",
        forced: false,
      })).rejects.toThrow("审核")
      const reviewed = await call<ChapterRevisionReadResult>("chapter.reviewRevision", {
        revisionTaskId: draft.revisionTaskId,
        draftVersionId: draft.versionId,
      })
      expect(reviewed.review?.recommendation).toBe("no_issue")
      const reviewedRevision = await call<ChapterRevisionReadResult>("chapter.readRevision", {
        revisionTaskId: draft.revisionTaskId,
      })
      expect(reviewedRevision.proposedBody).toContain("Reviewed draft")
      expect(reviewedRevision.proposedBody).not.toContain("Alternative draft")
      const submitted = await call<{ status: string }>("chapter.submitRevision", {
        revisionTaskId: draft.revisionTaskId,
        draftVersionId: draft.versionId,
        mode: "reviewed",
        forced: false,
        reviewId: reviewed.review?.reviewId,
      })
      expect(submitted.status).toBe("graph_sync_pending")
      await waitForRevisionGraphSync(harness.facade, harness.projectId, harness.workspaceRootRef, draft.revisionTaskId)
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)

  it("persists manual edits to the selected current draft and refuses stale version writes", async () => {
    const harness = await openChapterHarness()
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const first = await call<RevisionDraftVersion>("chapter.draft.start", { chapterSequence: 1, heading: "第一章 草稿", body: "First", source: "workflow" })
      await call("chapter.updateRevision", { revisionTaskId: first.revisionTaskId, draftVersionId: first.versionId, heading: first.heading, body: "Edited" })
      expect(await call("chapter.revision.draftVersion.read", { versionId: first.versionId })).toMatchObject({ body: "Edited", source: "manual" })
      expect(await call("chapter.workflowGate.get", { chapterSequence: 1 })).toMatchObject({
        draft: { contentState: "manual_modified", versionId: first.versionId },
      })
      const second = await call<RevisionDraftVersion>("chapter.draft.start", { chapterSequence: 1, heading: first.heading, body: "Second", source: "agent" })
      await expect(call("chapter.updateRevision", { revisionTaskId: first.revisionTaskId, draftVersionId: first.versionId, heading: first.heading, body: "Stale overwrite" })).rejects.toThrow("current working draft")
      expect(await call("chapter.readRevision", { revisionTaskId: second.revisionTaskId })).toMatchObject({ proposedBody: "Second" })
      expect(await call("chapter.list")).toEqual([])
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  })

  it("lists an unfinished revision draft for a chapter that already has正文", async () => {
    const harness = await openChapterHarness("Existing正文 revision")
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const initial = await call<RevisionDraftVersion>("chapter.draft.start", {
        chapterSequence: 1,
        heading: "第一章 正文",
        body: "已有正文",
        source: "workflow",
      })
      const reviewed = await call<ChapterRevisionReadResult>("chapter.reviewRevision", { revisionTaskId: initial.revisionTaskId })
      await call("chapter.submitRevision", {
        revisionTaskId: initial.revisionTaskId,
        mode: "reviewed",
        forced: false,
        reviewId: reviewed.review?.reviewId,
      })
      await waitForRevisionGraphSync(harness.facade, harness.projectId, harness.workspaceRootRef, initial.revisionTaskId)

      const chapter = await call<{ chapterId: string; sourceId: string; heading: string; body: string }>("chapter.read", {
        chapterId: (await call<readonly { chapterId: string }[]>("chapter.list"))[0]!.chapterId,
      })
      const revision = await call<ChapterRevision>("chapter.startRevision", {
        chapterId: chapter.chapterId,
        baseSourceId: chapter.sourceId,
        heading: chapter.heading,
        body: "已有正文的修订草稿",
        inputMode: "agent",
      })
      const drafts = await call<ChapterRevisionReadResult[]>("chapter.draft.list")
      expect(drafts.some((draft) => draft.revisionTaskId === revision.revisionTaskId)).toBe(true)
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)

  it("keeps repeated focused runs as separate drafts and restores their results after reopening", async () => {
    const harness = await openChapterHarness()
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const taskIds: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const started = await call<{ taskId: string }>("turn.start", { chapterSequence: 1, userInput: "Write this chapter" })
        taskIds.push(started.taskId)
        await waitForTask(harness.facade, started.taskId)
      }
      expect(await call("chapter.list")).toEqual([])
      const drafts = await call<ChapterRevisionReadResult[]>("chapter.draft.list")
      expect(drafts).toHaveLength(1)
      const draft = drafts[0]!
      expect(existsSync(join(harness.workspaceRootRef, draft.publishPath!))).toBe(false)
      const listed = await call<{ versions: RevisionDraftVersion[] }>("chapter.revision.draftVersion.list", { revisionTaskId: draft.revisionTaskId })
      expect(listed.versions.map((version) => [version.label, version.source])).toEqual([["v1", "workflow"], ["v2", "workflow"]])
      await expect(call("turn.start", { chapterSequence: 2, userInput: "skip" })).rejects.toThrow("前一章")
      await harness.container.getCurrentRuntime()!.close()
      const latest = await call<{ result: { kind: string; revisionTaskId: string }; phaseRuns: { phase: string }[] }>("turn.latest.get", { chapterSequence: 1 })
      expect(latest.result).toMatchObject({ kind: "draft", revisionTaskId: draft.revisionTaskId })
      expect(latest.phaseRuns.some((run) => run.phase.startsWith("graph"))).toBe(false)
      expect(await call("turn.latest.get", { chapterSequence: 2 })).toBeNull()
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)

  it("lets discussion discover and repeatedly invoke the draft tool without publishing", async () => {
    const fake = new FakeAiModelAdapter(randomUUID)
    let discussCalls = 0
    let graphCalls = 0
    let releaseGraph!: () => void
    const graphGate = new Promise<void>((resolve) => { releaseGraph = resolve })
    let firstDraft: { revisionTaskId: string; draftVersionId: string; body: string } | undefined
    const model: AIModelPort = {
      info: fake.info,
      execute: async (request, options) => {
        if (request.workflow === "revision" && (request.phase === "interpret" || request.phase.startsWith("graph"))) {
          graphCalls += 1
          await graphGate
        }
        const execution = await fake.execute(request, options)
        if (request.phase !== "synopsis_discuss") return execution
        discussCalls += 1
        const results = (options?.contextMessages ?? []).flatMap((message) => {
          try { return [JSON.parse(message.content) as Record<string, unknown>] } catch { return [] }
        })
        if (discussCalls === 5) {
          expect(graphCalls).toBe(0)
          firstDraft = results.find((item) => item.status === "draft_created")?.result as typeof firstDraft
          expect(firstDraft).toBeDefined()
        }
        const toolRequest = discussCalls === 1 ? { name: "todo_write", action: "describe" }
          : discussCalls === 2 ? { name: "todo_write", action: "invoke", arguments: JSON.stringify({
            merge: false,
            todos: [
              { id: "discover", content: "发现正文推演工具并查看调用参数", status: "in_progress" },
              { id: "draft", content: "重复调用工具生成并比较两份章节草稿", status: "pending" },
            ],
          }) }
          : discussCalls === 3 ? { name: "chapter_workflow", action: "describe" }
          : discussCalls === 4 || discussCalls === 5 ? { name: "chapter_workflow", action: "invoke", arguments: JSON.stringify({ userInput: `draft ${String(discussCalls - 3)}` }) }
          : discussCalls === 6 ? { name: "todo_write", action: "invoke", arguments: JSON.stringify({
            merge: true,
            todos: [
              { id: "discover", content: "发现正文推演工具并查看调用参数", status: "completed" },
              { id: "draft", content: "重复调用工具生成并比较两份章节草稿", status: "completed" },
            ],
          }) }
          : undefined
        return { usage: execution.usage, result: { ...execution.result, outcome: "continue", requestedReads: [],
          artifact: { assistantMessage: "Done", finalSelfReview: "OK", ...(toolRequest === undefined
            ? { choices: [{ label: "检查草稿", action: "continue_discuss" }] }
            : { toolRequest }) } } }
      },
    }
    const harness = await openChapterHarness("Workflow discussion", { model })
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const runtime = harness.container.getCurrentRuntime()!
      const settings = await runtime.readSettings()
      await runtime.saveSettings({
        ...settings,
        creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true },
      })
      await call("synopsis.conversation.start")
      await call("synopsis.conversation.send", { message: "Draft twice and leave the first version unpublished", maxModelCalls: 40 })
      expect(discussCalls).toBe(7)
      expect(firstDraft).toBeDefined()
      expect(await call("chapter.list")).toEqual([])
      const drafts = await call<ChapterRevisionReadResult[]>("chapter.draft.list")
      expect(drafts).toHaveLength(1)
      expect(drafts[0]?.revisionTaskId).toBe(firstDraft!.revisionTaskId)
      const versions = await call<{ versions: RevisionDraftVersion[] }>("chapter.revision.draftVersion.list", {
        revisionTaskId: firstDraft!.revisionTaskId,
      })
      expect(versions.versions).toHaveLength(2)
      expect(versions.versions.some((version) => version.body === firstDraft!.body)).toBe(true)
      expect(drafts[0]?.graphSyncStatus).not.toBe("completed")
      expect(existsSync(join(harness.workspaceRootRef, drafts[0]!.publishPath!))).toBe(false)
      expect(graphCalls).toBe(0)
    } finally {
      releaseGraph()
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)

  it("blocks chapter_workflow before starting a model draft when synopsis is empty", async () => {
    const fake = new FakeAiModelAdapter(randomUUID)
    let discussCalls = 0
    let nestedDraftModelCalls = 0
    const model: AIModelPort = {
      info: fake.info,
      execute: async (request, options) => {
        if ((request.input as { workflow?: string }).workflow === "turn") nestedDraftModelCalls += 1
        const execution = await fake.execute(request, options)
        if (request.phase !== "synopsis_discuss") return execution
        discussCalls += 1
        const toolRequest = discussCalls === 1
          ? { name: "todo_write", action: "describe" }
          : discussCalls === 2
            ? { name: "todo_write", action: "invoke", arguments: JSON.stringify({
                merge: false,
                todos: [{ id: "gate", content: "检查正文流程门禁", status: "in_progress" }],
              }) }
            : discussCalls === 3
              ? { name: "chapter_workflow", action: "describe" }
              : discussCalls === 4
                ? { name: "chapter_workflow", action: "invoke", arguments: JSON.stringify({ userInput: "直接写正文" }) }
            : undefined
        return {
          usage: execution.usage,
          result: {
            ...execution.result,
            outcome: "continue",
            requestedReads: [],
            artifact: {
              assistantMessage: "已检查流程门禁",
              finalSelfReview: "OK",
              ...(toolRequest === undefined ? {} : { toolRequest }),
            },
          },
        }
      },
    }
    const harness = await openChapterHarness("Workflow gate before model", { model })
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      const runtime = harness.container.getCurrentRuntime()!
      const settings = await runtime.readSettings()
      await runtime.saveSettings({
        ...settings,
        creationDesk: { ...settings.creationDesk, chapterWorkflowEnabled: true },
      })
      await call("synopsis.conversation.start")
      await expect(call("synopsis.conversation.send", { message: "直接进入正文推演", maxModelCalls: 20 }))
        .rejects.toThrow(/todo_incomplete.*3.*停止/)
      expect(discussCalls).toBeGreaterThanOrEqual(4)
      expect(nestedDraftModelCalls).toBe(0)
      expect(await call("chapter.draft.list")).toEqual([])
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30000)
})
