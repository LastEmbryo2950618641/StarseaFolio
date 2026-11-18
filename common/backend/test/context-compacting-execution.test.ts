import { describe, expect, it, vi } from "vitest"
import type { PhaseRequestEnvelope, VisibleModelContextMessage } from "@starseafolio/contracts"
import type { AIModelPort, PhaseModelExecution } from "../src/application/turns/ports/ai-model-port.js"
import {
  buildFoldSummaryContent,
  CONTEXT_FOLD_SUMMARY_PROTOCOL,
  contextTokensAfterProviderUsage,
  executeWithContextCompaction,
  readContextLengthError,
  selectOldestHalfByTokens,
  shrinkChunkToCompressLimit,
  stripReplayedPayload,
} from "../src/application/context/context-compacting-execution.js"
import { MODEL_CONTEXT_DELTA_HEADER, ModelContextAppender } from "../src/application/context/model-context-appender.js"
import { estimateModelMessageTokens } from "../src/application/context/context-window-manager.js"

const request = { turnId: "current" } as PhaseRequestEnvelope
const result = { usage: { inputTokens: 123, lastRequestInputTokens: 123 } } as PhaseModelExecution
const message = (
  id: string,
  kind: VisibleModelContextMessage["kind"],
  turnId: string,
  sequence: number,
  content = "短文本",
): VisibleModelContextMessage => ({
  messageId: id, kind, turnId, sequence, role: "user", content,
})
const messages = [
  message("system", "system_rules", "old", 0),
  message("old", "phase_response", "old", 1),
  message("chapter", "canonical_chapter", "old", 2),
  message("current", "phase_request", "current", 3),
]

function setup(tokens?: number) {
  const execute = vi.fn<AIModelPort["execute"]>().mockResolvedValue(result)
  const compressContext = vi.fn<NonNullable<AIModelPort["compressContext"]>>().mockImplementation(async (input) => ({
    summary: `折叠摘要:${input.texts.join("|").slice(0, 80)}`,
    usage: { inputTokens: 10, outputTokens: 5, latencyMs: 0, lastRequestInputTokens: 10 },
  }))
  const onCompacted = vi.fn().mockResolvedValue(undefined)
  const input = {
    model: {
      info: { provider: "test", model: "test", available: true, contextWindowTokens: 1_000_000 },
      execute,
      compressContext,
    },
    request,
    options: { contextMessages: messages },
    triggerRatio: 0.9,
    targetRatio: 0.5,
    ...(tokens === undefined ? {} : { lastRequestInputTokens: tokens }),
    onCompacted,
    createMessageId: () => `fold-${String(Math.random()).slice(2, 10)}`,
  }
  return { input, execute, compressContext, onCompacted }
}

describe("AI fold context compaction", () => {
  it("selects the oldest half of foldable messages by tokens", () => {
    const foldable = [
      message("a", "phase_response", "old", 1, "甲".repeat(300)),
      message("b", "phase_response", "old", 2, "乙".repeat(300)),
      message("c", "phase_response", "old", 3, "丙".repeat(300)),
      message("d", "phase_response", "old", 4, "丁".repeat(300)),
    ]
    expect(selectOldestHalfByTokens(foldable).map((item) => item.messageId)).toEqual(["a", "b"])
  })

  it("shrinks oversized chunks by half until they fit the compress limit", () => {
    const huge = message("h1", "phase_response", "old", 1, "章".repeat(20_000))
    const medium = message("h2", "phase_response", "old", 2, "节".repeat(20_000))
    const shrunk = shrinkChunkToCompressLimit([huge, medium], 5_000)
    expect(shrunk.messages).toHaveLength(1)
    expect(shrunk.messages[0]?.messageId).toBe("h1")
    expect(estimateModelMessageTokens(shrunk.truncatedContent ?? shrunk.messages[0]!.content)).toBeLessThanOrEqual(5_000)
  })

  it("folds old history via compressContext and injects a fold summary", async () => {
    const { input, execute, compressContext, onCompacted } = setup(1_000_000)
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      message("old1", "phase_response", "old", 1, "旧历史一".repeat(200)),
      message("old2", "phase_response", "old", 2, "旧历史二".repeat(200)),
      message("old3", "canonical_chapter", "old", 3, "旧章正文".repeat(200)),
      message("current", "phase_request", "current", 4),
    ]
    await executeWithContextCompaction(input)
    expect(compressContext).toHaveBeenCalled()
    expect(onCompacted).toHaveBeenCalledWith(expect.objectContaining({
      reason: "usage_threshold",
      foldMessages: expect.arrayContaining([
        expect.objectContaining({
          kind: "phase_instruction",
          content: expect.stringContaining(CONTEXT_FOLD_SUMMARY_PROTOCOL),
        }),
      ]),
    }))
    const sent = execute.mock.calls[0]?.[1]?.contextMessages ?? []
    expect(sent.some((item) => item.content.includes(CONTEXT_FOLD_SUMMARY_PROTOCOL))).toBe(true)
    expect(sent.map((item) => item.messageId)).not.toContain("old1")
    expect(sent.map((item) => item.messageId)).toContain("system")
    expect(sent.map((item) => item.messageId)).toContain("current")
  })

  it("keeps the latest tool description while folding older history", async () => {
    const { input, execute } = setup(1_000_000)
    const described = (id: string, sequence: number) => ({
      ...message(id, "phase_instruction", "old", sequence),
      role: "system" as const,
      content: JSON.stringify({ protocol: "synopsis-tools-v1", name: "todo_write", action: "describe", status: "described" }),
    })
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      described("old-describe", 1),
      message("old", "phase_response", "old", 2, "旧响应".repeat(400)),
      described("new-describe", 3),
      message("current", "phase_request", "current", 4),
    ]
    await executeWithContextCompaction(input)
    const ids = execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId) ?? []
    expect(ids).toContain("system")
    expect(ids).toContain("new-describe")
    expect(ids).toContain("current")
    expect(ids).not.toContain("old-describe")
    expect(ids).not.toContain("old")
  })

  it("strips multiline synopsis/outline/draft that only appear JSON-escaped in hidden deltas", async () => {
    const { input, execute, onCompacted } = setup(900_000)
    const synopsis = ["# 简介", "", "第一段很长的简介内容，带换行。", "第二段继续说明世界观。"].join("\n")
    const outline = ["## 细纲", "", "1. 开场", "2. 冲突", "3. 收束"].join("\n")
    const draft = ["草稿正文第一段。", "", "草稿正文第二段，仍带换行。"].join("\n")
    const oldDelta = {
      phase: "synopsis_discuss",
      protocolVersion: "1",
      input: {
        synopsisDiscuss: {
          synopsisMarkdown: synopsis,
          outlineMarkdown: outline,
          latestDraftMarkdown: draft,
        },
      },
    }
    input.request = {
      ...request,
      phase: "synopsis_discuss",
      protocolVersion: "1",
      input: {
        synopsisDiscuss: {
          synopsisMarkdown: synopsis,
          outlineMarkdown: outline,
          latestDraftMarkdown: draft,
          chapterBodyMarkdown: "当前聚焦章正文保留一次",
        },
      },
    } as PhaseRequestEnvelope
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      {
        ...message("old-delta", "phase_request", "old", 1),
        content: `${MODEL_CONTEXT_DELTA_HEADER}\n${JSON.stringify(oldDelta)}`,
      },
      message("pad1", "phase_response", "old", 2, "填充".repeat(500)),
      message("pad2", "phase_response", "old", 3, "填充".repeat(500)),
      message("current", "phase_request", "current", 4),
    ]
    await executeWithContextCompaction(input)
    expect(onCompacted).toHaveBeenCalled()
    const sentInput = execute.mock.calls[0]?.[0]?.input as {
      synopsisDiscuss?: {
        synopsisMarkdown?: string
        outlineMarkdown?: string
        latestDraftMarkdown?: string
        chapterBodyMarkdown?: string
      }
    }
    expect(sentInput.synopsisDiscuss?.synopsisMarkdown).toBeUndefined()
    expect(sentInput.synopsisDiscuss?.outlineMarkdown).toBeUndefined()
    expect(sentInput.synopsisDiscuss?.latestDraftMarkdown).toBeUndefined()
    expect(sentInput.synopsisDiscuss?.chapterBodyMarkdown).toBe("当前聚焦章正文保留一次")
    const assembled = new ModelContextAppender().formatDelta(
      new ModelContextAppender().createDelta(
        execute.mock.calls[0]?.[0] as PhaseRequestEnvelope,
        execute.mock.calls[0]?.[0],
        (execute.mock.calls[0]?.[1]?.contextMessages ?? []).filter((item) => item.turnId !== "current"),
      ),
    )
    expect(assembled).not.toContain("第一段很长的简介内容")
    expect(assembled).toContain("当前聚焦章正文保留一次")
  })

  it("preserves discuss history summary and gate counters while folding", async () => {
    const { input, execute } = setup(900_000)
    const summary = {
      ...message("history-summary", "phase_instruction", "old", 1),
      role: "user" as const,
      content: JSON.stringify({ protocol: "discuss-history-summary-v1", userInputs: ["已确认设定"] }),
    }
    const retryState = {
      ...message("retry-state", "phase_instruction", "old", 2),
      role: "system" as const,
      content: JSON.stringify({ protocol: "discuss-gate-v1", failures: { "chapter:1:tool:memory_write:invoke": 2 } }),
    }
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      summary,
      retryState,
      message("old", "phase_response", "old", 3, "旧内容".repeat(500)),
      message("current", "phase_request", "current", 4),
    ]
    await executeWithContextCompaction(input)
    const ids = execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId) ?? []
    expect(ids).toContain("system")
    expect(ids).toContain("history-summary")
    expect(ids).toContain("retry-state")
    expect(ids).toContain("current")
  })

  it("does not substitute estimates for provider usage when below threshold", async () => {
    const { input, execute, onCompacted } = setup(899_999)
    await executeWithContextCompaction(input)
    expect(onCompacted).not.toHaveBeenCalled()
    expect(execute.mock.calls[0]?.[1]?.contextMessages).toHaveLength(4)
  })

  it("folds and resubmits after a reported context overflow", async () => {
    const { input, execute, onCompacted } = setup()
    execute.mockRejectedValueOnce(new Error("DeepSeek request failed: 400 This model's maximum context length is 1048576 tokens. However, you requested 1056215 tokens (1056215 in the messages, 0 in the completion)."))
    await expect(executeWithContextCompaction(input)).resolves.toBe(result)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(onCompacted).toHaveBeenCalledWith(expect.objectContaining({ reason: "context_length_error", observedInputTokens: 1_056_215 }))
  })

  it("fails closed when compressContext is missing", async () => {
    const { input } = setup(1_000_000)
    delete (input.model as { compressContext?: unknown }).compressContext
    await expect(executeWithContextCompaction(input)).rejects.toThrow("compressContext")
  })

  it("honors cancellation between compression and resubmission", async () => {
    const { input, execute, onCompacted, compressContext } = setup()
    const controller = new AbortController()
    execute.mockRejectedValueOnce(new Error("context_length_exceeded"))
    compressContext.mockImplementation(async () => {
      controller.abort()
      return { summary: "x", usage: { inputTokens: 1, outputTokens: 1, latencyMs: 0 } }
    })
    onCompacted.mockImplementation(() => Promise.resolve())
    await expect(executeWithContextCompaction({
      ...input,
      options: { ...input.options, signal: controller.signal },
    })).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("keeps the compacted estimate when the provider reports a larger prompt", () => {
    expect(contextTokensAfterProviderUsage(150_000, 565_700)).toBe(150_000)
    expect(contextTokensAfterProviderUsage(150_000, 140_000)).toBe(140_000)
    expect(contextTokensAfterProviderUsage(undefined, 565_700)).toBe(565_700)
    const sendCompactedEstimate = 150_000
    const compactedEstimate: number | undefined = undefined
    expect(contextTokensAfterProviderUsage(compactedEstimate ?? sendCompactedEstimate, 440_200)).toBe(150_000)
  })

  it("parses comma-separated limits without treating other 400s as overflow", () => {
    expect(readContextLengthError(new Error("maximum context length is 1,048,576 tokens; requested 1,056,215 tokens"))).toEqual({ inputTokens: 1056215, limitTokens: 1048576 })
    expect(readContextLengthError(new Error("400 invalid response format"))).toBeUndefined()
    expect(readContextLengthError(new Error("maximum context length is 100 tokens; requested 110 tokens (95 in the messages, 15 in the completion)"))?.inputTokens).toBe(95)
  })

  it("builds fold summary notice content", () => {
    const content = buildFoldSummaryContent({
      summary: "主角已进城",
      foldedMessageCount: 3,
      foldedMessageIds: ["a", "b", "c"],
    })
    expect(content).toContain(CONTEXT_FOLD_SUMMARY_PROTOCOL)
    expect(content).toContain("勿仅因压缩而反复回读")
    expect(JSON.parse(content).summary).toBe("主角已进城")
  })

  it("stripReplayedPayload matches JSON-escaped multiline values", () => {
    const body = "第一行\n第二行"
    const hidden = JSON.stringify({ synopsisDiscuss: { synopsisMarkdown: body } })
    const next = stripReplayedPayload(
      { synopsisDiscuss: { synopsisMarkdown: body, chapterBodyMarkdown: "当前章" } },
      [hidden],
    ) as { synopsisDiscuss: { synopsisMarkdown?: string; chapterBodyMarkdown?: string } }
    expect(next.synopsisDiscuss.synopsisMarkdown).toBeUndefined()
    expect(next.synopsisDiscuss.chapterBodyMarkdown).toBe("当前章")
  })
})
