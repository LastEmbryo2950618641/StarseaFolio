import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { defaultDeepSeekRuntimeConfig } from "@starseafolio/config"
import { PROTOCOL_VERSION, type PhaseRequestEnvelope } from "@starseafolio/contracts"
import { describe, expect, it } from "vitest"

import {
  AnthropicMessagesModelAdapter,
  createAnthropicMessagesClient,
  createModelFromSelection,
  FakeAiModelAdapter,
  NodePromptResourceAdapter,
} from "../src/index.js"

const promptRoot = fileURLToPath(new URL("../../../common/packages/prompt-contracts/", import.meta.url))

describe("AnthropicMessagesModelAdapter", () => {
  it("posts Messages API payloads and assembles a phase result with usage", async () => {
    const request = createRequest()
    const fake = await new FakeAiModelAdapter().execute(request)
    const modelJson = JSON.stringify({
      outcome: fake.result.outcome,
      ...(fake.result.artifact === undefined ? {} : { artifact: fake.result.artifact }),
      requestedReads: fake.result.requestedReads.map((item) => ({
        reason: item.reason,
        expectedEvidence: item.expectedEvidence,
        query: item.query,
      })),
      citedReadIds: fake.result.citedReadIds,
      unresolvedDependencies: fake.result.unresolvedDependencies.map((dependency) => ({
        description: dependency.description,
        requiredFor: dependency.requiredFor,
        disposition: dependency.disposition,
      })),
      reason: fake.result.reason,
      selfReview: fake.result.selfReview,
    })

    let capturedBody: Record<string, unknown> | undefined
    const fetchImpl = async (_url: string, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
      return new Response(JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: modelJson }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 120,
          output_tokens: 40,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    const adapter = new AnthropicMessagesModelAdapter(
      {
        ...defaultDeepSeekRuntimeConfig,
        apiProtocol: "anthropic_messages",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5",
        maxAttempts: 1,
        maxSchemaRepairAttempts: 0,
      },
      { getSecret: () => Promise.resolve("anthropic-test-key") },
      new NodePromptResourceAdapter(promptRoot),
      fetchImpl,
    )

    const execution = await adapter.execute(request)
    expect(execution.result.outcome).toBe(fake.result.outcome)
    expect(execution.usage.inputTokens).toBeGreaterThan(0)
    expect(execution.usage.outputTokens).toBeGreaterThan(0)
    expect(capturedBody?.model).toBe("claude-sonnet-4-5")
    expect(typeof capturedBody?.max_tokens).toBe("number")
    expect(Array.isArray(capturedBody?.messages)).toBe(true)
    expect(typeof capturedBody?.system).toBe("string")
  })

  it("createModelFromSelection routes anthropic_messages to Anthropic adapter", () => {
    const adapter = createModelFromSelection(promptRoot, {
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      apiKey: "anthropic-key",
      apiProtocol: "anthropic_messages",
      contextWindowTokens: 200_000,
    })
    expect(adapter).toBeInstanceOf(AnthropicMessagesModelAdapter)
    expect(adapter.info.model).toBe("claude-sonnet-4-5")
  })

  it("merges system roles and keeps alternating user/assistant turns", async () => {
    const client = createAnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      getApiKey: () => Promise.resolve("key"),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init?.body ?? "{}") as {
          system?: string
          messages: Array<{ role: string; content: string }>
        }
        expect(body.system).toContain("sys-a")
        expect(body.system).toContain("sys-b")
        expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"])
        expect(body.messages[0]?.content).toContain("u1")
        expect(body.messages[0]?.content).toContain("u2")
        return new Response(JSON.stringify({
          id: "msg_merge",
          content: [{ type: "text", text: "{\"ok\":true}" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
    })

    const response = await client.complete({
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "sys-a" },
        { role: "system", content: "sys-b" },
        { role: "user", content: "u1" },
        { role: "user", content: "u2" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u3" },
      ],
    })
    expect(response.content).toContain("ok")
  })
})

function createRequest(overrides: Partial<PhaseRequestEnvelope> = {}): PhaseRequestEnvelope {
  const projectId = randomUUID()
  const taskId = randomUUID()
  return {
    schemaVersion: 1,
    envelopeId: randomUUID(),
    projectId,
    taskId,
    turnId: randomUUID(),
    contextId: randomUUID(),
    scopeId: randomUUID(),
    phase: "interpret",
    protocolVersion: PROTOCOL_VERSION,
    promptRef: "v1:interpret",
    promptDigest: "prompt-digest",
    contextViewRef: "context-digest",
    committedReadIds: [],
    visiblePendingIds: [],
    remainingBudget: {
      maxCalls: 12,
      remainingCalls: 12,
      maxInputTokens: 1000,
      remainingInputTokens: 1000,
      maxOutputTokens: 1000,
      remainingOutputTokens: 1000,
      deadlineAtMs: Date.now() + 10_000,
    },
    input: {
      workflow: "turn",
      userInput: "test",
      chapterSequence: 1,
      sourceId: randomUUID(),
      sourceUnitIds: [],
      phaseRunIds: [],
      readEvidence: [],
      retrievalGaps: [],
      artifacts: {},
    },
    ...overrides,
  }
}
