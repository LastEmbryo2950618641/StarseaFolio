import type { DeepSeekRuntimeConfig } from "@starseafolio/config"

import type {
  AIModelPort,
  ContextCompressionInput,
  ContextCompressionResult,
  DiscussTurnClassification,
  DiscussTurnClassificationInput,
  ModelExecutionOptions,
  PhaseModelExecution,
  PromptResourcePort,
} from "../../../application/index.js"
import type { PhaseRequestEnvelope } from "@starseafolio/contracts"
import { renderRuntimePrompt } from "../../../core/runtime-prompt.js"

import {
  DeepSeekAiModelAdapter,
  DeepSeekModelError,
  type DeepSeekCompletionClient,
  type DeepSeekCompletionInput,
  type DeepSeekCompletionResponse,
  type DeepSeekMessage,
  type SecretProvider,
} from "../deepseek/deepseek-model-adapter.js"

const ANTHROPIC_VERSION = "2023-06-01"
const ANTHROPIC_USER_AGENT = "StarseaFolio/0.1"
const DEFAULT_MAX_TOKENS = 16_384

export type AnthropicFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<Response>

export type AnthropicMessagesClientOptions = Readonly<{
  baseUrl: string
  getApiKey: () => Promise<string>
  fetchImpl?: AnthropicFetch
  timeoutMs?: number
}>

/**
 * Anthropic Messages HTTP client implementing the shared completion client shape
 * so phase execution / repair / assemble reuse the OpenAI-compatible adapter loop.
 */
export function createAnthropicMessagesClient(
  options: AnthropicMessagesClientOptions,
): DeepSeekCompletionClient {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as AnthropicFetch)
  const baseUrl = options.baseUrl.replace(/\/+$/, "")

  return {
    complete: async (input) => completeAnthropicMessages(fetchImpl, baseUrl, options.getApiKey, input),
  }
}

export class AnthropicMessagesModelAdapter implements AIModelPort {
  private readonly inner: DeepSeekAiModelAdapter
  public readonly info

  public constructor(
    config: DeepSeekRuntimeConfig,
    secrets: SecretProvider,
    prompts: PromptResourcePort,
    fetchImpl?: AnthropicFetch,
  ) {
    const client = createAnthropicMessagesClient({
      baseUrl: config.baseUrl,
      getApiKey: () => secrets.getSecret(config.apiKeyRef),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      timeoutMs: config.timeoutMs,
    })
    this.inner = new DeepSeekAiModelAdapter(config, secrets, prompts, client)
    this.info = this.inner.info
  }

  public compressContext(input: ContextCompressionInput): Promise<ContextCompressionResult> {
    return this.inner.compressContext(input)
  }

  public classifyDiscussTurn(input: DiscussTurnClassificationInput): Promise<DiscussTurnClassification> {
    return this.inner.classifyDiscussTurn(input)
  }

  public execute(request: PhaseRequestEnvelope, options?: ModelExecutionOptions): Promise<PhaseModelExecution> {
    return this.inner.execute(request, options)
  }
}

async function completeAnthropicMessages(
  fetchImpl: AnthropicFetch,
  baseUrl: string,
  getApiKey: () => Promise<string>,
  input: DeepSeekCompletionInput,
): Promise<DeepSeekCompletionResponse> {
  const apiKey = (await getApiKey()).trim()
  if (apiKey.length === 0) {
    throw new DeepSeekModelError("configuration", "Anthropic API key is empty")
  }

  const { system, messages } = toAnthropicMessages(input.messages, input.responseFormat?.type === "json_object")
  const thinkingEnabled = input.thinking?.type === "enabled"
  const budgetTokens = thinkingBudgetTokens(input.reasoningEffort)
  const maxTokens = Math.max(input.maxTokens ?? DEFAULT_MAX_TOKENS, thinkingEnabled ? budgetTokens + 1_024 : 1)

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: maxTokens,
    messages,
    ...(system.length === 0 ? {} : { system }),
    ...(thinkingEnabled
      ? { thinking: { type: "enabled", budget_tokens: budgetTokens } }
      : {}),
    ...(input.onPartial === undefined ? {} : { stream: true }),
  }

  const url = `${baseUrl}/v1/messages`
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "user-agent": ANTHROPIC_USER_AGENT,
  }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (error) {
    throw new DeepSeekModelError(
      "network",
      `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new DeepSeekModelError(
      "response",
      `Anthropic HTTP ${String(response.status)}: ${errorText.slice(0, 500) || response.statusText}`,
      errorText,
    )
  }

  if (input.onPartial !== undefined) {
    return readAnthropicStream(response, input.onPartial)
  }

  const payload = asRecord(await response.json())
  return parseAnthropicMessagePayload(payload)
}

function toAnthropicMessages(
  messages: readonly DeepSeekMessage[],
  jsonMode: boolean,
): Readonly<{ system: string; messages: readonly Readonly<{ role: "user" | "assistant"; content: string }>[] }> {
  const systemParts: string[] = []
  const conversation: Array<{ role: "user" | "assistant"; content: string }> = []

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim().length > 0) systemParts.push(message.content)
      continue
    }
    const role = message.role === "assistant" ? "assistant" as const : "user" as const
    const last = conversation[conversation.length - 1]
    if (last !== undefined && last.role === role) {
      last.content = `${last.content}\n\n${message.content}`
    } else {
      conversation.push({ role, content: message.content })
    }
  }

  if (conversation.length === 0) {
    conversation.push({ role: "user", content: renderRuntimePrompt("provider-auxiliary", "anthropic-empty-conversation") })
  } else if (conversation[0]?.role === "assistant") {
    conversation.unshift({ role: "user", content: renderRuntimePrompt("provider-auxiliary", "anthropic-assistant-first") })
  }

  if (jsonMode) {
    systemParts.push(renderRuntimePrompt("provider-auxiliary", "anthropic-json"))
  }

  return {
    system: systemParts.join("\n\n"),
    messages: conversation,
  }
}

function thinkingBudgetTokens(
  effort: DeepSeekCompletionInput["reasoningEffort"],
): number {
  switch (effort) {
    case "none":
    case "minimal":
      return 1_024
    case "low":
      return 2_048
    case "medium":
      return 4_096
    case "xhigh":
    case "max":
      return 16_384
    case "high":
    default:
      return 8_192
  }
}

async function readAnthropicStream(
  response: Response,
  onPartial: NonNullable<DeepSeekCompletionInput["onPartial"]>,
): Promise<DeepSeekCompletionResponse> {
  if (response.body === null) {
    throw new DeepSeekModelError("response", "Anthropic stream response body is empty")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  let reasoningContent = ""
  let finishReason: string | null | undefined
  let responseId: string | undefined
  let usage: unknown

  const handleEvent = (rawEvent: string): void => {
    const lines = rawEvent.split("\n")
    let eventType = ""
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith("event:")) eventType = line.slice("event:".length).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim())
    }
    if (dataLines.length === 0) return
    const dataText = dataLines.join("\n")
    if (dataText === "[DONE]") return
    let payload: Record<string, unknown>
    try {
      payload = asRecord(JSON.parse(dataText))
    } catch {
      return
    }
    const type = eventType || readString(payload.type) || ""
    if (type === "message_start") {
      const message = asRecord(payload.message)
      responseId = readString(message.id) ?? responseId
      if (message.usage !== undefined) usage = message.usage
      return
    }
    if (type === "content_block_delta") {
      const delta = asRecord(payload.delta)
      const deltaType = readString(delta.type)
      if (deltaType === "text_delta") {
        const text = typeof delta.text === "string" ? delta.text : ""
        if (text.length > 0) {
          content += text
          onPartial({ contentDelta: text })
        }
      } else if (deltaType === "thinking_delta") {
        const thinking = typeof delta.thinking === "string" ? delta.thinking : ""
        if (thinking.length > 0) {
          reasoningContent += thinking
          onPartial({ reasoningDelta: thinking })
        }
      }
      return
    }
    if (type === "message_delta") {
      const delta = asRecord(payload.delta)
      finishReason = readString(delta.stop_reason) ?? finishReason
      if (payload.usage !== undefined) usage = payload.usage
      return
    }
    if (type === "message_stop") {
      finishReason = finishReason ?? "end_turn"
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf("\n\n")
    while (separator >= 0) {
      const rawEvent = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      if (rawEvent.trim().length > 0) handleEvent(rawEvent)
      separator = buffer.indexOf("\n\n")
    }
  }
  if (buffer.trim().length > 0) handleEvent(buffer)

  return {
    content: content.length === 0 ? null : content,
    finishReason: finishReason ?? null,
    ...(responseId === undefined ? {} : { responseId }),
    messageFieldNames: ["content", "thinking"],
    ...(reasoningContent.length === 0
      ? {}
      : { reasoningContent, reasoningKind: "provider_reasoning" as const }),
    ...(usage === undefined ? {} : { usage: normalizeAnthropicUsage(usage) }),
  }
}

function parseAnthropicMessagePayload(payload: Record<string, unknown>): DeepSeekCompletionResponse {
  const contentBlocks = Array.isArray(payload.content) ? payload.content : []
  let content = ""
  let reasoningContent = ""
  for (const block of contentBlocks) {
    const record = asRecord(block)
    const type = readString(record.type)
    if (type === "text" && typeof record.text === "string") content += record.text
    if (type === "thinking" && typeof record.thinking === "string") reasoningContent += record.thinking
  }
  const finishReason = readString(payload.stop_reason) ?? null
  const responseId = readString(payload.id)
  return {
    content: content.length === 0 ? null : content,
    finishReason,
    ...(responseId === undefined ? {} : { responseId }),
    messageFieldNames: Object.keys(payload),
    ...(reasoningContent.length === 0
      ? {}
      : { reasoningContent, reasoningKind: "provider_reasoning" as const }),
    ...(payload.usage === undefined ? {} : { usage: normalizeAnthropicUsage(payload.usage) }),
  }
}

function normalizeAnthropicUsage(usage: unknown): Record<string, unknown> {
  const record = asRecord(usage)
  const inputTokens = typeof record.input_tokens === "number" ? record.input_tokens : undefined
  const outputTokens = typeof record.output_tokens === "number" ? record.output_tokens : undefined
  const cacheRead = typeof record.cache_read_input_tokens === "number" ? record.cache_read_input_tokens : undefined
  const cacheCreation = typeof record.cache_creation_input_tokens === "number"
    ? record.cache_creation_input_tokens
    : undefined
  return {
    ...(inputTokens === undefined ? {} : { prompt_tokens: inputTokens, input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { completion_tokens: outputTokens, output_tokens: outputTokens }),
    ...(cacheRead === undefined ? {} : { prompt_cache_hit_tokens: cacheRead }),
    ...(cacheCreation === undefined ? {} : { prompt_cache_miss_tokens: cacheCreation }),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
