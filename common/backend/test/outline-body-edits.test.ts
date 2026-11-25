import { createHash, randomUUID } from "node:crypto"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { PROTOCOL_VERSION, type PhaseRequestEnvelope } from "@starseafolio/contracts"
import { synopsisDiscussArtifactSchema } from "@starseafolio/prompt-contracts"

import { applySearchReplace } from "../src/application/chapters/markdown-search-replace.js"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { textFixtureModel } from "./helpers/discuss-fixture-text.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import {
  openChapterHarness,
  prepareChapterPlanning,
  prepareVolumePlanning,
  type ChapterHarness,
} from "./helpers/chapter-coordination-harness.js"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function withHarness(
  run: (harness: ChapterHarness) => Promise<void>,
  options?: Readonly<{ model?: AIModelPort }>,
): Promise<void> {
  const harness = await openChapterHarness("Outline Body Edits Test", options?.model === undefined
    ? options
    : { ...options, model: textFixtureModel(options.model) })
  temporaryRoots.push(harness.root)
  try {
    await prepareVolumePlanning(harness)
    await run(harness)
  } finally {
    await harness.container.close()
  }
}

async function invoke<T>(harness: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload,
  })
  if (!response.ok) expect.fail(JSON.stringify(response.error))
  return response.data as T
}

function outlinePathFromSynopsis(synopsisPath: string): string {
  return synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

describe("synopsisDiscussArtifactSchema bodyEdits", () => {
  it("rejects outlineBody and bodyEdits in the same artifact", () => {
    const parsed = synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "同时交两通道",
      outlineBody: "# 细纲\n\n内容",
      bodyEdits: {
        target: "outline",
        ops: [{ oldText: "内容", newText: "改" }],
      },
      finalSelfReview: "mutex",
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts bodyEdits alone", () => {
    const parsed = synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "局部改",
      planningWriteIntent: { outline: "patch" },
      bodyEdits: {
        target: "outline",
        ops: [{ oldText: "旧", newText: "新" }],
      },
      finalSelfReview: "ok",
    })
    expect(parsed.success).toBe(true)
  })
})

describe("outline bodyEdits integration", () => {
  it("writes full outline on confirm, then applies bodyEdits without wiping other sections", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      await invoke(harness, "synopsis.conversation.send", {
        ...base,
        message: "雨夜站台，林序追查名单",
      })
      const confirmed = await invoke<{
        session: { synopsisPath: string }
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })
      const outlineRel = outlinePathFromSynopsis(confirmed.session.synopsisPath)
      const outlineAbs = join(harness.workspaceRootRef, outlineRel)
      const firstOutline = readFileSync(outlineAbs, "utf8")
      expect(firstOutline).toContain("### 场 1 开场")
      expect(firstOutline).toContain("### 场 2 推进")
      expect(firstOutline).toContain("### 场 3 落点")

      const patched = await invoke<{
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "再修改细纲：收紧场2张力",
      })
      const assistant = [...patched.messages].reverse().find((message) => message.role === "assistant")
      expect(assistant?.content).toMatch(/已局部更新细纲/)
      const nextOutline = readFileSync(outlineAbs, "utf8")
      expect(nextOutline).toContain("### 场 1 开场")
      expect(nextOutline).toContain("### 场 3 落点")
      expect(nextOutline).toContain("按用户要求收紧")
      expect(nextOutline).not.toBe(firstOutline)
    })
  })

  it("keeps a hand-edited outline unchanged when the user only wants to discuss it", async () => {
    const delegate = new FakeAiModelAdapter(randomUUID)
    const model: AIModelPort = {
      info: delegate.info,
      async execute(request, options) {
        if ((request.input as { userInput?: string }).userInput === "先讨论怎么收紧场2张力，暂不修改细纲文件") {
          const assistantMessage = "可以收紧第二场的信息推进。我先只讨论方案，暂不修改细纲。"
          return {
            result: {
              schemaVersion: 1,
              envelopeId: request.envelopeId,
              contextId: request.contextId,
              phase: request.phase,
              outcome: "continue",
              requestedReads: [],
              citedReadIds: [...request.committedReadIds],
              producedArtifactIds: [],
              decisionRecordIds: [],
              unresolvedDependencies: [],
              reason: "The user asked to discuss a possible outline adjustment without editing the file.",
              selfReview: "No planning document write was requested.",
              artifact: {
                assistantMessage,
                choices: [
                  { label: "先讨论第二场的冲突安排", action: "continue_discuss" as const },
                  { label: "暂不修改细纲", action: "continue_discuss" as const },
                ],
                finalSelfReview: "The hand-edited outline remains untouched.",
              },
            },
            usage: { inputTokens: 100, outputTokens: 50, latencyMs: 0, modelCalls: 1 },
          }
        }
        return delegate.execute(request, options)
      },
      compressContext(input) {
        return delegate.compressContext(input)
      },
    }
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      await invoke(harness, "synopsis.conversation.send", {
        ...base,
        message: "雨夜站台，林序追查名单",
      })
      const confirmed = await invoke<{
        session: { synopsisPath: string }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })
      const outlineRel = outlinePathFromSynopsis(confirmed.session.synopsisPath)
      const outlineAbs = join(harness.workspaceRootRef, outlineRel)
      const handEdited = `${readFileSync(outlineAbs, "utf8").trim()}\n\n> 作者手改标记\n`
      writeFileSync(outlineAbs, handEdited, "utf8")

      const sent = await invoke<{
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "先讨论怎么收紧场2张力，暂不修改细纲文件",
      })
      const assistant = [...sent.messages].reverse().find((message) => message.role === "assistant")
      expect(assistant?.content).toContain("先只讨论方案")
      expect(assistant?.content).not.toContain("已局部更新细纲")
      expect(readFileSync(outlineAbs, "utf8")).toBe(handEdited)
    }, { model })
  })

  it("applies a model-interpreted local edit to the hand-edited outline", async () => {
    const delegate = new FakeAiModelAdapter(randomUUID)
    const model: AIModelPort = {
      info: delegate.info,
      async classifyDiscussTurn({ message }) {
        return { scope: message.startsWith("再修改细纲") ? { outline: "patch" } : { advance: true }, usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 } }
      },
      async execute(request, options) {
        const result = await delegate.execute(request, options)
        if (request.phase !== "synopsis_discuss" || !options?.phasePrompt?.text.includes("<compose-outline-patch>")
          || result.result.outcome === "request_read") return result
        expect(options.outputMode).toBe("text")
        return {
          ...result,
          result: {
            ...result.result,
            artifact: {
              assistantMessage: "<compose-outline-patch>\n<search>\n> 作者手改标记\n</search>\n<replace>\n> 作者手改标记\n\n场2按用户要求收紧\n</replace>\n</compose-outline-patch>",
            },
          },
        }
      },
      compressContext(input) {
        return delegate.compressContext(input)
      },
    }
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      await invoke(harness, "synopsis.conversation.send", {
        ...base,
        message: "雨夜站台，林序追查名单",
      })
      const confirmed = await invoke<{
        session: { synopsisPath: string }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })
      const outlineRel = outlinePathFromSynopsis(confirmed.session.synopsisPath)
      const outlineAbs = join(harness.workspaceRootRef, outlineRel)
      const handEdited = `${readFileSync(outlineAbs, "utf8").trim()}\n\n> 作者手改标记\n`
      writeFileSync(outlineAbs, handEdited, "utf8")

      const sent = await invoke<{
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "再修改细纲：收紧场2张力",
      })
      const updatedOutline = readFileSync(outlineAbs, "utf8")
      const assistant = [...sent.messages].reverse().find((message) => message.role === "assistant")

      expect(assistant?.content).toMatch(/已局部更新细纲/)
      expect(updatedOutline).toContain("作者手改标记")
      expect(updatedOutline).toContain("按用户要求收紧")
      expect(updatedOutline).not.toBe(handEdited)
    }, { model })
  })

  it("replaces a hand-edited outline only when the user explicitly requests a full rewrite", async () => {
    const rewrittenOutline = "# 第一章 雨夜旧站台 剧情细纲\n\n## 章定位\n按用户最新要求重新组织本章。\n\n## 分场节拍\n- 旧站台：林烬按新的主线调查名单。\n\n## 信息边界\n保留用户指定的揭示节奏。\n\n## 风险与待决\n无待决。\n"
    const model: AIModelPort = {
      info: { provider: "test", model: "explicit-outline-rewrite", available: true, contextWindowTokens: 64_000 },
      async execute(request: PhaseRequestEnvelope) {
        const planning = (request.input as { synopsisDiscuss?: { userEditedOutlineSinceAgent?: boolean } }).synopsisDiscuss
        expect(planning?.userEditedOutlineSinceAgent).toBe(true)
        return {
          result: {
            schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
            outcome: "continue", requestedReads: [], citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [],
            reason: "The user explicitly requested a complete outline rewrite.",
            selfReview: "The full outline follows the current user request.",
            artifact: {
              assistantMessage: "我已根据你最新要求重写了整篇细纲。",
              outlineBody: rewrittenOutline,
              planningWriteIntent: { outline: "rewrite" as const },
              choices: [{ label: "检查新细纲覆盖的场景", action: "continue_discuss" as const }],
              finalSelfReview: "The complete outline replaced the hand-edited version as requested.",
            },
          },
          usage: { inputTokens: 100, outputTokens: 50, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    await withHarness(async (harness) => {
      await prepareChapterPlanning(harness)
      const listed = await invoke<{ session: { synopsisPath: string } }>(harness, "synopsis.conversation.list", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      const outlineRel = outlinePathFromSynopsis(listed.session.synopsisPath)
      const outlineAbs = join(harness.workspaceRootRef, outlineRel)
      const handEdited = `${readFileSync(outlineAbs, "utf8").trim()}\n\n> 作者手改标记\n`
      writeFileSync(outlineAbs, handEdited, "utf8")

      const sent = await invoke<{
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "使用这个重新写整篇细纲",
      })
      const assistant = [...sent.messages].reverse().find((message) => message.role === "assistant")

      expect(readFileSync(outlineAbs, "utf8").trimEnd()).toBe(rewrittenOutline.trimEnd())
      expect(assistant?.content).not.toContain("保留原文")
    }, { model })
  })

  it("fails loud without writing when oldText is missing", () => {
    const source = "## 分场节拍\n场1：旧冲突\n## 信息边界\n可写：A\n"
    const beforeDigest = digestText(source)
    const result = applySearchReplace(source, [{ oldText: "不存在的锚点", newText: "新" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("找不到要替换的原文")
    expect(digestText(source)).toBe(beforeDigest)
  })
})
