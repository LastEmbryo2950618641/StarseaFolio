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

    const assistant = sent.messages.find((message) => message.role === "assistant")
    expect(assistant?.content).toContain("逐份对照预定义笔风规则")
    expect(assistant?.choices?.length).toBeGreaterThan(0)
    expect(assistant?.choices?.some((choice) => (
      choice.label.includes("表现输出/笔风规则/") && choice.label.includes(".md」")
    ))).toBe(true)
    expect(modelRequests.some((request) => request.phase === "synopsis_discuss")).toBe(true)
    expect(modelRequests.some((request) => (
      request.phase === "synopsis_discuss"
      && (request.input as { readEvidence: Array<{ ownerKind: string; ownerId: string; semanticText: string }> })
        .readEvidence.some((evidence) => evidence.ownerKind === "workspace:prose_style_candidate"
          && evidence.ownerId.startsWith("表现输出/笔风规则/")
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
    }>(harness, "synopsis.conversation.send", {
      ...base,
      message: assistant!.choices![0]!.label,
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
    const selectedPath = assistant!.choices![0]!.label.match(/表现输出\/笔风规则\/[^」]+/u)?.[0]
    expect(selectedPath).toBeDefined()
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
    expect(assistant?.content).toContain("逐份对照预定义笔风规则")
    expect(assistant?.content).not.toContain("正式输出")
    expect(assistant?.choices).toHaveLength(3)
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
