import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult, type SynopsisConversationStartResult } from "@starseafolio/contracts"
import { readVolumeLifecycleState, saveVolumeLifecycleState } from "../src/application/chapters/volume-lifecycle-state.js"
import { parseVolumePlanningState, serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { DEFAULT_VOLUME_FOLDER_NAME } from "../src/core/chapters/chapter-volume.js"
import { assembleSynopsisPlaceholderDocument, deriveSynopsisMarkdownPath } from "../src/core/chapters/synopsis-path.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { openChapterHarness, seedCommittedChapter, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

const harnesses: ChapterHarness[] = []

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.container.close()
})

function boundaryFixture(...replies: string[]) {
  const delegate = new FakeAiModelAdapter(randomUUID)
  const prompts: string[] = []
  const model: AIModelPort = {
    info: delegate.info,
    async execute(request, options) {
      const prompt = options?.phasePrompt?.text ?? ""
      if (!/^【(?:卷始|卷末|修订)门禁】/u.test(prompt)) return delegate.execute(request, options)

      const assistantMessage = replies.shift()
      if (assistantMessage === undefined) throw new Error("Unexpected volume boundary model call")
      prompts.push(prompt)
      return {
        result: {
          schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId,
          phase: request.phase, outcome: "continue", requestedReads: [], citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "fixture", selfReview: "fixture",
          artifact: { assistantMessage },
        },
        usage: { inputTokens: 10, outputTokens: 2, latencyMs: 0 },
      }
    },
  }
  return { model, prompts }
}

async function openHarness(name: string, model: AIModelPort, creativeSetupReady = true): Promise<ChapterHarness> {
  const harness = await openChapterHarness(name, { model, creativeSetupReady })
  harnesses.push(harness)
  return harness
}

function request(harness: ChapterHarness, method: string, payload: Record<string, unknown> = {}) {
  return harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload },
  })
}

async function send(harness: ChapterHarness, message: string): Promise<SynopsisConversationSendResult> {
  const response = await request(harness, "synopsis.conversation.send", { message, batchProceed: true })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as SynopsisConversationSendResult
}

async function start(harness: ChapterHarness): Promise<SynopsisConversationStartResult> {
  const response = await request(harness, "synopsis.conversation.start")
  if (!response.ok) throw new Error(response.error.message)
  return response.data as SynopsisConversationStartResult
}

function readLifecycle(harness: ChapterHarness) {
  return readVolumeLifecycleState(harness.workspace, harness.workspaceRootRef, DEFAULT_VOLUME_FOLDER_NAME)
}

async function seedCappedVolume(harness: ChapterHarness): Promise<void> {
  await seedCommittedChapter(harness)
  const planPath = `大纲/${DEFAULT_VOLUME_FOLDER_NAME}.批量计划.md`
  const plan = parseVolumePlanningState(await harness.workspace.readMarkdown(harness.workspaceRootRef, planPath))
  if (plan === undefined) throw new Error("Volume planning fixture is missing")
  await harness.workspace.saveUserMarkdown(harness.workspaceRootRef, planPath, serializeVolumePlanningState({
    ...plan, targetChapterCount: 1,
  }))
}

describe("volume boundary marker handshake", () => {
  it("starts an unstarted volume when the model returns the standalone start marker", async () => {
    const { model, prompts } = boundaryFixture("<volume-start/>")
    const harness = await openHarness("Accepted volume start", model, false)
    const message = "开始新卷并继续。"

    expect((await start(harness)).session.volumeLifecycle?.phase).toBe("volume_start")
    const result = await send(harness, message)

    expect(prompts).toEqual([expect.stringMatching(/^【卷始门禁】.*独立一行输出 <volume-start\/>。/u)])
    expect(result.session.volumeLifecycle?.phase).toBe("protagonist_selection")
    expect(result.autoContinue).toEqual({ message })
    expect(await readLifecycle(harness)).toEqual({
      volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME,
      startedAtMs: expect.any(Number),
    })
  })

  it("keeps the start gate closed when the model adds prose to the start marker", async () => {
    const { model, prompts } = boundaryFixture("确认开始。\n<volume-start/>")
    const harness = await openHarness("Rejected volume start", model, false)

    const result = await send(harness, "开始新卷并继续。")

    expect(prompts).toEqual([expect.stringMatching(/^【卷始门禁】.*独立一行输出 <volume-start\/>。/u)])
    expect(result.session.volumeLifecycle?.phase).toBe("volume_start")
    expect(result.autoContinue).toBeUndefined()
    expect(await readLifecycle(harness)).toBeUndefined()
  })

  it("blocks forward focus at the chapter cap until the model ends the volume", async () => {
    const { model, prompts } = boundaryFixture("确认结束。\n<volume-end/>", "<volume-end/>")
    const harness = await openHarness("Capped volume", model)
    await seedCappedVolume(harness)
    const placeholderPath = deriveSynopsisMarkdownPath(2, "", DEFAULT_VOLUME_FOLDER_NAME)
    await harness.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, placeholderPath, assembleSynopsisPlaceholderDocument(2, ""))
    const focusNext = () => request(harness, "synopsis.conversation.setFocus", { chapterSequence: 2 })
    const focusBlocked = { ok: false, error: { message: expect.stringContaining("<volume-end/>") } }

    expect(await focusNext()).toMatchObject(focusBlocked)
    const rejected = await send(harness, "结束本卷。")
    expect(rejected.session).toMatchObject({
      chapterSequence: 1,
      volumeLifecycle: {
        volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME, phase: "volume_end", chapterCount: 1, chapterLimit: 1, ended: false,
      },
    })
    expect(rejected.autoContinue).toBeUndefined()
    expect(await focusNext()).toMatchObject(focusBlocked)
    expect(await readLifecycle(harness)).toBeUndefined()

    const accepted = await send(harness, "结束本卷。")
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toMatch(/^【卷末门禁】.*独立一行输出 <volume-end\/>。/u)
    expect(accepted.autoContinue).toBeUndefined()
    expect(accepted.session).toMatchObject({
      chapterSequence: 2,
      volumeLifecycle: { volumeFolderName: expect.stringMatching(/^第二卷 /u), phase: "volume_start", ended: false },
    })
    expect(await focusNext()).toMatchObject({
      ok: true, data: { session: { chapterSequence: 2, synopsisPath: accepted.session.synopsisPath } },
    })
    const ended = await readLifecycle(harness)
    expect(ended).toMatchObject({
      volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME,
      endedAtMs: expect.any(Number),
    })
    const revisedOutline = "# 卷大纲\n\n修订结局，主角在旧站台找到失踪的同伴。"
    expect(await request(harness, "workspace.save", {
      relativePath: `大纲/${DEFAULT_VOLUME_FOLDER_NAME}.md`, content: revisedOutline,
    })).toMatchObject({ ok: true })
    const revised = await start(harness)
    expect(revised.session).toMatchObject({ chapterSequence: 1, volumeLifecycle: {
      volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME, phase: "revision", ended: true,
    } })
    expect(await readLifecycle(harness)).toMatchObject({ endedAtMs: ended?.endedAtMs, revisionStartedAtMs: expect.any(Number) })
  })

  it("enters revision when the model returns the standalone revision marker", async () => {
    const { model, prompts } = boundaryFixture("<volume-revise/>")
    const harness = await openHarness("Accepted volume revision", model)
    await start(harness)
    await saveVolumeLifecycleState(harness.workspace, harness.workspaceRootRef, {
      volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME, startedAtMs: 1, endedAtMs: 2,
    })
    const message = "修订当前卷规划。"

    const result = await send(harness, message)

    expect(prompts).toEqual([expect.stringMatching(/^【修订门禁】.*独立一行输出 <volume-revise\/>。/u)])
    expect(result.session.volumeLifecycle).toMatchObject({ phase: "revision", ended: true, revision: true })
    expect(result.autoContinue).toEqual({ message })
    expect(await readLifecycle(harness)).toMatchObject({ endedAtMs: 2, revisionStartedAtMs: expect.any(Number) })
  })
})
