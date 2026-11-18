import { describe, expect, it, vi } from "vitest"
import type { PhaseRequestEnvelope, VisibleModelContextMessage } from "@starseafolio/contracts"
import type { AIModelPort, PhaseModelExecution } from "../src/application/turns/ports/ai-model-port.js"
import { executeWithContextCompaction, readContextLengthError } from "../src/application/context/context-compacting-execution.js"

const request = { turnId: "current" } as PhaseRequestEnvelope
const result = { usage: { inputTokens: 123, lastRequestInputTokens: 123 } } as PhaseModelExecution
const message = (id: string, kind: VisibleModelContextMessage["kind"], turnId: string, sequence: number): VisibleModelContextMessage => ({
  messageId: id, kind, turnId, sequence, role: "user", content: "短文本",
})
const messages = [message("system", "system_rules", "old", 0), message("old", "phase_response", "old", 1), message("chapter", "canonical_chapter", "old", 2), message("current", "phase_request", "current", 3)]
function setup(tokens?: number) {
  const execute = vi.fn<AIModelPort["execute"]>().mockResolvedValue(result)
  const onCompacted = vi.fn().mockResolvedValue(undefined)
  const input = {
    model: { info: { provider: "test", model: "test", available: true, contextWindowTokens: 1_000_000 }, execute },
    request, options: { contextMessages: messages }, triggerRatio: 0.9, targetRatio: 0.5,
    ...(tokens === undefined ? {} : { lastRequestInputTokens: tokens }), onCompacted,
  }
  return { input, execute, onCompacted }
}

describe("provider-measured context compaction", () => {
  it("keeps the latest tool description while compacting older history", async () => {
    const { input, execute } = setup(1_000_000)
    const described = (id: string, sequence: number) => ({
      ...message(id, "phase_instruction", "old", sequence),
      role: "system" as const,
      content: JSON.stringify({ protocol: "synopsis-tools-v1", name: "todo_write", action: "describe", status: "described" }),
    })
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      described("old-describe", 1),
      message("old", "phase_response", "old", 2),
      described("new-describe", 3),
      message("current", "phase_request", "current", 4),
    ]
    await executeWithContextCompaction(input)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId))
      .toEqual(["system", "new-describe", "current"])
  })
  it("keeps removing old chapters until the scaled input is within half the window", async () => {
    const { input, execute } = setup(1_000_000)
    const chapter = (id: string, sequence: number) => message(id, "canonical_chapter", "old", sequence)
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      chapter("c1", 1), chapter("c2", 2), chapter("c3", 3), chapter("c4", 4), chapter("c5", 5),
      message("current", "phase_request", "current", 6),
    ]
    await executeWithContextCompaction(input)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId)).toEqual(["system", "c5", "current"])
  })
  it("drops replayed catalog and evidence, and old phase-request chapters, before the model call", async () => {
    const { input, execute, onCompacted } = setup(1_000_000)
    const catalog = { entries: ["章节正文/第一章.md", "设定集/readme.md"] }
    const evidence = [{ ownerId: "设定集/readme.md", semanticText: "旧资料不应在压缩后再次装回本次请求里。" }]
    const removedChapter = `第一章正文${"章".repeat(80)}`
    input.request = {
      ...request,
      input: { workspaceCatalog: catalog, readEvidence: evidence, synopsisDiscuss: { chapterBodyMarkdown: "当前章仍保留" } },
    } as PhaseRequestEnvelope
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      { ...message("old-delta", "phase_request", "old", 1), content: `旧请求 ${JSON.stringify({ workspaceCatalog: catalog, readEvidence: evidence })}` },
      { ...message("old-chapter", "phase_request", "old", 2), content: JSON.stringify({ chapterBodyMarkdown: removedChapter }) },
      { ...message("newer-chapter", "phase_request", "old", 3), content: JSON.stringify({ chapterBodyMarkdown: "较新的一章" }) },
      message("current", "phase_request", "current", 4),
    ]
    const order: string[] = []
    onCompacted.mockImplementation(async () => { order.push("compact") })
    input.onReadyToCall = () => { order.push("think") }
    execute.mockImplementation(async () => {
      order.push("model")
      return result
    })
    await executeWithContextCompaction(input)
    const sent = execute.mock.calls[0]?.[1]?.contextMessages ?? []
    expect(sent.map((item) => item.messageId)).not.toContain("old-delta")
    expect(sent.some((item) => item.content.includes(removedChapter))).toBe(false)
    expect(sent.map((item) => item.messageId)).toContain("current")
    const sentInput = execute.mock.calls[0]?.[0]?.input as { workspaceCatalog?: unknown, readEvidence?: unknown, synopsisDiscuss?: { chapterBodyMarkdown?: string } }
    expect(sentInput.workspaceCatalog).toBeUndefined()
    expect(sentInput.readEvidence).toBeUndefined()
    expect(sentInput.synopsisDiscuss?.chapterBodyMarkdown).toBe("当前章仍保留")
    expect(onCompacted.mock.calls[0]?.[0]?.estimatedInputTokens).toBeLessThanOrEqual(500_000)
    expect(order).toEqual(["compact", "think", "model"])
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it("drops older copies of the same system rules", async () => {
    const { input, execute } = setup(1_000_000)
    input.options.contextMessages = [
      { ...message("rules-old", "system_rules", "old", 0), content: "相同规则" },
      { ...message("rules-new", "system_rules", "old", 1), content: "相同规则" },
      message("old", "phase_response", "old", 2),
      message("current", "phase_request", "current", 3),
    ]
    await executeWithContextCompaction(input)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId)).toEqual(["rules-new", "current"])
  })
  it("calls the model once when only the current turn remains above the target", async () => {
    const { input, execute } = setup(1_000_000)
    input.options.contextMessages = [
      message("old", "phase_response", "old", 1),
      { ...message("current", "phase_request", "current", 2), content: "章".repeat(100_000) },
    ]
    await executeWithContextCompaction(input)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId)).toEqual(["current"])
  })
  it("keeps removing old chapters when the request body still holds the input above half the window", async () => {
    const { input, execute } = setup(1_000_000)
    input.request = { ...request, input: { synopsis: "设定".repeat(20) } } as PhaseRequestEnvelope
    const chapter = (id: string, sequence: number) => message(id, "canonical_chapter", "old", sequence)
    input.options.contextMessages = [
      message("system", "system_rules", "old", 0),
      chapter("c1", 1), chapter("c2", 2), chapter("c3", 3), chapter("c4", 4), chapter("c5", 5),
      message("current", "phase_request", "current", 6),
    ]
    await executeWithContextCompaction(input)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId)).toEqual(["system", "current"])
  })
  it("triggers at 90% even when local text estimates are tiny", async () => {
    const { input, execute, onCompacted } = setup(900_000)
    await executeWithContextCompaction(input)
    expect(onCompacted).toHaveBeenCalledWith(expect.objectContaining({ reason: "usage_threshold", observedInputTokens: 900_000, thresholdTokens: 900_000 }))
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((m) => m.messageId)).toEqual(["system", "current"])
  })
  it("preserves the lossless discuss history summary during later context compaction", async () => {
    const { input, execute } = setup(900_000)
    const summary = {
      ...message("history-summary", "phase_instruction", "old", 1),
      role: "user" as const,
      content: JSON.stringify({ protocol: "discuss-history-summary-v1", userInputs: ["已确认设定"] }),
    }
    input.options.contextMessages = [messages[0]!, summary, messages[1]!, messages[2]!, messages[3]!]

    await executeWithContextCompaction(input)

    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId))
      .toEqual(["system", "history-summary", "current"])
  })
  it.each(["discuss-step-failures-v1", "discuss-progress-v1", "discuss-gate-v1"])("keeps %s counters across context compaction", async (protocol) => {
    const { input, execute } = setup(900_000)
    const retryState = { ...message("retry-state", "phase_instruction", "old", 1),
      role: "system" as const, content: JSON.stringify({ protocol, failures: { "chapter:1:tool:memory_write:invoke": 2 }, consecutiveNoProgressTurns: 2 }) }
    input.options.contextMessages = [messages[0]!, retryState, ...messages.slice(1)]
    await executeWithContextCompaction(input)
    expect(execute.mock.calls[0]?.[1]?.contextMessages?.map((item) => item.messageId))
      .toEqual(["system", "retry-state", "current"])
  })
  it.each([undefined, 899_999])("does not substitute estimates for provider usage (%s)", async (tokens) => {
    const { input, execute, onCompacted } = setup(tokens)
    input.options.contextMessages = messages.map((m) => ({ ...m, content: "世界".repeat(100_000) }))
    await executeWithContextCompaction(input)
    expect(onCompacted).not.toHaveBeenCalled()
    expect(execute.mock.calls[0]?.[1]?.contextMessages).toHaveLength(4)
  })
  it("compacts and resubmits the same user request after the reported 400", async () => {
    const { input, execute, onCompacted } = setup()
    execute.mockRejectedValueOnce(new Error("DeepSeek request failed: 400 This model's maximum context length is 1048576 tokens. However, you requested 1056215 tokens (1056215 in the messages, 0 in the completion)."))
    await expect(executeWithContextCompaction(input)).resolves.toBe(result)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toBe(request)
    expect(execute.mock.calls[1]?.[1]?.contextMessages?.map((m) => m.messageId)).toEqual(["system", "current"])
    expect(onCompacted).toHaveBeenCalledWith(expect.objectContaining({ reason: "context_length_error", observedInputTokens: 1_056_215 }))
  })
  it("forces compaction even when the provider reports no token count", async () => {
    const { input, execute } = setup()
    execute.mockRejectedValueOnce(new Error("400 context_length_exceeded"))
    await executeWithContextCompaction(input)
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it("stops when only protected content remains instead of retrying unchanged input", async () => {
    const { input, execute } = setup()
    execute.mockRejectedValue(new Error("400 context_length_exceeded"))
    await expect(executeWithContextCompaction(input)).rejects.toThrow("已无法继续裁剪")
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it("does not retry unrelated API errors", async () => {
    const { input, execute, onCompacted } = setup()
    execute.mockRejectedValue(new Error("401 Invalid API key"))
    await expect(executeWithContextCompaction(input)).rejects.toThrow("401")
    expect(execute).toHaveBeenCalledTimes(1)
    expect(onCompacted).not.toHaveBeenCalled()
  })
  it("honors cancellation between compression and resubmission", async () => {
    const { input, execute, onCompacted } = setup()
    const controller = new AbortController()
    execute.mockRejectedValueOnce(new Error("context_length_exceeded"))
    onCompacted.mockImplementation(() => { controller.abort(); return Promise.resolve() })
    await expect(executeWithContextCompaction({ ...input, options: { ...input.options, signal: controller.signal } })).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it("parses comma-separated limits without treating other 400s as overflow", () => {
    expect(readContextLengthError(new Error("maximum context length is 1,048,576 tokens; requested 1,056,215 tokens"))).toEqual({ inputTokens: 1056215, limitTokens: 1048576 })
    expect(readContextLengthError(new Error("400 invalid response format"))).toBeUndefined()
    expect(readContextLengthError(new Error("maximum context length is 100 tokens; requested 110 tokens (95 in the messages, 15 in the completion)"))?.inputTokens).toBe(95)
  })
})
