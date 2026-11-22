import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION } from "@starseafolio/contracts"
import type { AIModelPort, TurnPhaseInput } from "../src/application/turns/ports/ai-model-port.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { openChapterHarness } from "./helpers/chapter-coordination-harness.js"

describe("synopsis context compaction integration", () => {
  it.each(["usage", "overflow"] as const)("recovers through %s without duplicating the user message or reattaching removed bootstrap files", async (mode) => {
    const fake = new FakeAiModelAdapter(randomUUID)
    let secondSend = false
    let rejected = false
    let originalTurnId: string | undefined
    let retriedWithSmallerHistory = false
    let beforeCount = 0
    let sawBootstrap = false
    let sawFoldSummary = false
    let compressCalls = 0
    const model: AIModelPort = {
      info: { ...fake.info, contextWindowTokens: 1_000_000 },
      compressContext: async (input) => {
        compressCalls += 1
        return fake.compressContext(input)
      },
      execute: async (request, options) => {
        synopsisConversationStreamHub.setTodos(request.projectId,
          [{ id: "planning", content: "检查本章讨论上下文", status: "completed" }], Date.now())
        const phaseInput = request.input as TurnPhaseInput
        if (!secondSend) originalTurnId = request.turnId
        if (secondSend) {
          const count = options?.contextMessages?.length ?? 0
          if (mode === "overflow" && !rejected) {
            beforeCount = count
            rejected = true
            throw new Error("400 This model's maximum context length is 1048576 tokens. However, you requested 1056215 tokens (1056215 in the messages, 0 in the completion).")
          }
          if (mode === "overflow" && rejected && (
            count <= beforeCount
            || (options?.contextMessages?.some((m) => m.content.includes("context-fold-summary-v1")) ?? false)
          )) {
            retriedWithSmallerHistory = true
          }
          sawFoldSummary ||= options?.contextMessages?.some((m) =>
            m.content.includes("context-fold-summary-v1") && m.content.includes("conversation_archive")) ?? false
          sawBootstrap ||= phaseInput.readEvidence.some((e) => e.ownerId === "设定集/readme.md")
        }
        const result = await fake.execute(request, options)
        return { ...result, usage: { ...result.usage, lastRequestInputTokens: !secondSend && mode === "usage" ? 950_000 : 10_000 } }
      },
    }
    const harness = await openChapterHarness("Compaction", { model })
    try {
      const invoke = async (method: string, extra = {}) => {
        const result = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
          payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...extra } })
        if (!result.ok) throw new Error(JSON.stringify(result.error))
        return result.data as { messages: Array<{ role: string; content: string }> }
      }
      await invoke("synopsis.conversation.start")
      await invoke("synopsis.conversation.send", { message: "从雨夜站台开始" })
      secondSend = true
      const sent = await invoke("synopsis.conversation.send", { message: "继续讨论站台上的线索" })
      expect(sent.messages.filter((m) => m.role === "user" && m.content === "继续讨论站台上的线索")).toHaveLength(1)
      expect(sawBootstrap).toBe(false)
      expect(compressCalls).toBeGreaterThan(0)
      expect(sawFoldSummary || mode === "usage").toBe(true)
      if (mode === "overflow") {
        expect(retriedWithSmallerHistory).toBe(true)
        expect(sawFoldSummary).toBe(true)
      }
      void originalTurnId
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
