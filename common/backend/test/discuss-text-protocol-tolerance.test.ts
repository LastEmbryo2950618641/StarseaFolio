import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type SynopsisConversationSendResult } from "@starseafolio/contracts"

import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { openChapterHarness, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

function volumeReply(settings: string, trailing = ""): string {
  return [
    "<compose-volume-synopsis>",
    "# 第一卷 梗概",
    "",
    "矿工林烬在暴雨夜矿难后查清父亲失踪的真相。",
    "</compose-volume-synopsis>",
    "<compose-volume-outline>",
    "# 第一卷 大纲",
    "",
    "## 第一章",
    "林烬在废井里找到父亲的旧信。",
    "</compose-volume-outline>",
    "<compose-volume-meta>",
    "targetChapterCount: 8",
    "targetWordCount: 24000",
    "</compose-volume-meta>",
    "<writing-settings>",
    settings,
    "</writing-settings>",
    trailing,
  ].filter((part) => part.length > 0).join("\n")
}

const validSettings = [
  "descriptionRulePath: 表现输出/描写规则/自动.md",
  "proseStyleRulePath: 表现输出/笔风规则/默认笔风规则.md",
  "minimumWordCount: 2500",
  "maximumWordCount: 3500",
  "boundaryPace: advance_allowed",
  "causalityFocus: action",
].join("\n")

async function invoke<T>(harness: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
    payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload },
  })
  if (!response.ok) expect.fail(JSON.stringify(response.error))
  return response.data as T
}

function modelWithReplies(replies: string[]): AIModelPort {
  let call = 0
  return {
    info: { provider: "test", model: "text-protocol-tolerance", available: true, contextWindowTokens: 64_000 },
    async execute(request) {
      const text = replies[Math.min(call, replies.length - 1)]!
      call += 1
      return {
        result: {
          schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
          outcome: "continue", requestedReads: [], citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [],
          reason: "text protocol tolerance", selfReview: "text protocol tolerance",
          artifact: { assistantMessage: text, finalSelfReview: "text protocol tolerance" },
        },
        usage: { inputTokens: 100, outputTokens: 50, latencyMs: 0, modelCalls: 1 },
      }
    },
  }
}

describe("discuss text protocol tolerance", () => {
  it("repairs one malformed writing-settings block instead of failing the volume turn", async () => {
    const attempts: string[] = []
    const model: AIModelPort = {
      info: { provider: "test", model: "settings-repair", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        const text = attempts.length === 0
          ? volumeReply(`${validSettings}\nnovelCategoryRulePath: 表现输出/小说大类规则/仙侠.md`)
          : volumeReply(validSettings)
        attempts.push(text)
        return {
          result: {
            schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
            outcome: "continue", requestedReads: [], citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [],
            reason: "settings repair", selfReview: "settings repair",
            artifact: { assistantMessage: text, finalSelfReview: "settings repair" },
          },
          usage: { inputTokens: 100, outputTokens: 50, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Settings key repair", { model })
    try {
      await invoke(harness, "synopsis.conversation.start", { title: "雨夜矿灯" })
      const sent = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", {
        message: "完成第一卷的卷规划与写作设置。", batchProceed: true, maxModelCalls: 4,
      })
      expect(attempts.length).toBeGreaterThanOrEqual(2)
      expect(attempts[0]).toContain("novelCategoryRulePath")
      expect(sent.creationDeskSettings).toMatchObject({
        proseStyleRulePath: "表现输出/笔风规则/默认笔风规则.md",
        minimumWordCount: 2500,
        maximumWordCount: 3500,
      })
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.梗概.md"))
        .toContain("矿工林烬")
      expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.md"))
        .toContain("废井")
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("keeps trailing prose and stop choices around the volume blocks", async () => {
    const harness = await openChapterHarness("Volume trailing prose", {
      model: modelWithReplies([
        volumeReply(validSettings, [
          "卷规划已整理完毕，接下来可以从第一章剧情梗概开始。",
          "<creative-choices>",
          "- 从第一章剧情梗概开始",
          "- 先调整卷大纲",
          "</creative-choices>",
        ].join("\n")),
      ]),
    })
    try {
      await invoke(harness, "synopsis.conversation.start", { title: "雨夜矿灯" })
      const sent = await invoke<SynopsisConversationSendResult>(harness, "synopsis.conversation.send", {
        message: "完成第一卷的卷规划与写作设置。", batchProceed: true, maxModelCalls: 3,
      })
      const assistant = [...sent.messages].reverse().find((message) => message.role === "assistant")
      expect(assistant?.content).toContain("卷规划首次写入已完成")
      expect(assistant?.content).not.toContain("<compose-volume-")
      expect(assistant?.content).not.toContain("<creative-choices>")
      expect(assistant?.choices?.map((choice) => choice.label)).toEqual(["从第一章剧情梗概开始", "先调整卷大纲"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
