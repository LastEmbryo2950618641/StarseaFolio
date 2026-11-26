import OpenAI from "openai"
import { createHash } from "node:crypto"
import { ProxyAgent } from "undici"

import {
  PROTOCOL_VERSION,
  type AIPhase,
  type ModelReasoningKind,
  type ModelContextMessageDraft,
  type PhaseRequestEnvelope,
  phaseResultEnvelopeSchema,
  type VisibleModelContextMessage,
} from "@starseafolio/contracts"
import type { DeepSeekRuntimeConfig } from "@starseafolio/config"
import {
  discussTurnWriteScopeSchema,
  FictionDeliveryError,
  internalDraftArtifactSchema,
  inspectPhaseFictionDelivery,
  isFictionDeliveryPhase,
} from "@starseafolio/prompt-contracts"

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
import { ModelContextAppender } from "../../../application/index.js"
import { DISCUSS_PROVIDER_TOOLS } from "../../../application/chapters/discuss-provider-tools.js"
import { renderRuntimePrompt } from "../../../core/runtime-prompt.js"
import {
  assembleModelPhaseResult,
  phaseModelResultJsonSchema,
  parseModelPhaseResult,
  UnreadableCitationError,
} from "./model-phase-result-assembler.js"
import { createModelReferenceView, type ModelReferenceView } from "./model-reference-view.js"
import { errorDetails, runtimeLog } from "../../diagnostics/index.js"

const OPENAI_COMPATIBLE_USER_AGENT = "StarseaFolio/0.1"
// The context store also uses this marker to recognize persisted output reminders.
const OUTPUT_CONTRACT_PREFIX = "MANDATORY OUTPUT CONTRACT"

export type SecretProvider = Readonly<{
  getSecret(reference: string): Promise<string>
}>

export type DeepSeekCompletionClient = Readonly<{
  complete(input: DeepSeekCompletionInput): Promise<DeepSeekCompletionResponse>
}>

export type DeepSeekCompletionInput = Readonly<{
  model: string
  messages: readonly DeepSeekMessage[]
  responseFormat?: { type: "json_object" }
  maxTokens?: number
  signal?: AbortSignal
  thinking?: { type: "enabled" | "disabled" }
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  onPartial?: (partial: Readonly<{ reasoningDelta?: string; contentDelta?: string }>) => void
  tools?: readonly unknown[]
}>

export type DeepSeekMessage = Readonly<{
  role: "system" | "user" | "assistant"
  content: string
}>

type PromptSnapshot = Readonly<{
  phase: string
  serialized: string
  messageDigests: readonly string[]
}>

type DeepSeekToolCall = Readonly<{ name: string; arguments: string }>

export type DeepSeekCompletionResponse = Readonly<{
  content: string | null
  reasoningContent?: string | null
  reasoningKind?: ModelReasoningKind
  finishReason?: string | null
  responseId?: string
  messageFieldNames?: readonly string[]
  toolCalls?: readonly DeepSeekToolCall[]
  usage?: unknown
}>

export class DeepSeekModelError extends Error {
  public constructor(
    public readonly kind: "configuration" | "network" | "response" | "schema",
    message: string,
    public readonly rawResponse?: string,
  ) {
    super(message)
  }
}

export class DeepSeekAiModelAdapter implements AIModelPort {
  private readonly clientPromise: Promise<DeepSeekCompletionClient>
  private readonly previousPromptByChain = new Map<string, PromptSnapshot>()
  private readonly contextAppender = new ModelContextAppender()
  public readonly info

  public constructor(
    private readonly config: DeepSeekRuntimeConfig,
    private readonly secrets: SecretProvider,
    private readonly prompts: PromptResourcePort,
    client?: DeepSeekCompletionClient,
  ) {
    this.info = {
      provider: config.provider,
      model: config.model,
      available: true,
      contextWindowTokens: config.contextWindowTokens,
    } as const
    this.clientPromise = client === undefined ? this.createClient() : Promise.resolve(client)
  }

  public async compressContext(input: ContextCompressionInput): Promise<ContextCompressionResult> {
    input.signal?.throwIfAborted()
    const client = await this.clientPromise
    const body = input.texts.map((text, index) => (
      renderRuntimePrompt("provider-auxiliary", "compression-fragment", { index: index + 1, text })
    )).join("\n\n")
    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: renderRuntimePrompt("provider-auxiliary", "compression-system"),
      },
      {
        role: "user",
        content: renderRuntimePrompt("provider-auxiliary", "compression-request", { body }),
      },
    ]
    const startedAt = Date.now()
    const response = await this.completeWithRetry(client, {
      model: this.config.model,
      messages,
      thinking: { type: "disabled" },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      maxTokens: 4_096,
    })
    const summary = (response.content ?? "").trim()
    if (summary.length === 0) {
      throw new DeepSeekModelError("response", "Context compression returned empty content", response.content ?? undefined)
    }
    const usage = readUsage(response.usage)
    return {
      summary,
      usage: {
        inputTokens: usage.inputTokens,
        lastRequestInputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Math.max(0, Date.now() - startedAt),
        ...(usage.cacheHitInputTokens === undefined ? {} : { cacheHitInputTokens: usage.cacheHitInputTokens }),
        ...(usage.cacheMissInputTokens === undefined ? {} : { cacheMissInputTokens: usage.cacheMissInputTokens }),
        provider: this.info.provider,
        model: this.info.model,
      },
    }
  }

  public async classifyDiscussTurn(input: DiscussTurnClassificationInput): Promise<DiscussTurnClassification> {
    const { signal, ...context } = input
    signal?.throwIfAborted()
    const client = await this.clientPromise
    const startedAt = Date.now()
    const response = await this.completeWithRetry(client, {
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: renderRuntimePrompt("provider-auxiliary", "discuss-write-scope"),
        },
        { role: "user", content: JSON.stringify(context) },
      ],
      thinking: { type: "disabled" },
      ...(this.config.jsonModeEnabled ? { responseFormat: { type: "json_object" as const } } : {}),
      ...(signal === undefined ? {} : { signal }),
      maxTokens: 512,
    })
    const parsed = discussTurnWriteScopeSchema.parse(JSON.parse((response.content ?? "").trim()
      .replace(/^```(?:json)?\s*|\s*```$/giu, "")))
    const usage = readUsage(response.usage)
    return {
      scope: parsed,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Math.max(0, Date.now() - startedAt),
        ...(usage.cacheHitInputTokens === undefined ? {} : { cacheHitInputTokens: usage.cacheHitInputTokens }),
        ...(usage.cacheMissInputTokens === undefined ? {} : { cacheMissInputTokens: usage.cacheMissInputTokens }),
      },
    }
  }

  public async execute(request: PhaseRequestEnvelope, options?: ModelExecutionOptions): Promise<PhaseModelExecution> {
    const referenceView = createModelReferenceView(request)
    runtimeLog("debug", "deepseek-model", "execution.started", {
      taskId: request.taskId,
      phase: request.phase,
      envelopeId: request.envelopeId,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      modelReferenceAliasCount: referenceView.aliasCount,
      deadlineRemainingMs: request.remainingBudget.deadlineAtMs - Date.now(),
    })
    const [baseRules, phasePrompt, client] = await Promise.all([
      options?.contextMessages === undefined ? this.prompts.loadTurnSystemRules() : Promise.resolve(undefined),
      options?.phasePrompt === undefined
        ? this.prompts.loadPhase(request.phase)
        : Promise.resolve(options.phasePrompt),
      this.clientPromise,
    ])
    const textOutput = options?.outputMode === "text"
    const protocolMessage = renderRuntimePrompt("provider-protocol", textOutput ? "text-phase-protocol" : "phase-protocol", {
      version: PROTOCOL_VERSION,
      phase: request.phase,
    })
    const modelRequest = this.contextAppender.createDelta(
      request,
      referenceView.request,
      options?.contextMessages ?? [],
    )
    const modelRequestText = this.contextAppender.formatDelta(modelRequest)
    const outputContractPrefix = textOutput ? undefined : buildOutputContractPrefix(request)
    const outputReminder = textOutput
      ? "按本轮阶段提示使用普通文本及指定标签。需要资料时，使用当前提供的原生读取工具。"
      : buildOutputReminder(request, referenceView)
    const requestMessages: ModelContextMessageDraft[] = [
      {
        role: "user",
        kind: "phase_request",
        taskId: request.taskId,
        turnId: request.turnId,
        phase: request.phase,
        content: modelRequestText,
      },
      {
        role: "user",
        kind: "phase_instruction",
        taskId: request.taskId,
        turnId: request.turnId,
        phase: request.phase,
        content: phasePrompt.text,
      },
      {
        role: "user",
        kind: "phase_protocol",
        taskId: request.taskId,
        turnId: request.turnId,
        phase: request.phase,
        content: protocolMessage,
      },
      {
        role: "user",
        kind: "phase_request",
        taskId: request.taskId,
        turnId: request.turnId,
        phase: request.phase,
        content: outputReminder,
      },
    ]
    const inheritedMessages = options?.contextMessages === undefined
      ? [{ role: "system" as const, content: baseRules?.text ?? "" }]
      : normalizeContextMessages(options.contextMessages, request.phase, phasePrompt.text, textOutput)
    // Keep only the locked leading system rules as prefix. Phase instruction,
    // protocol, schema, and reminder stay at the request tail so adjacent phases
    // share a byte-identical KV prefix through the inherited chain.
    const leadingSystem = inheritedMessages.filter((message) => message.role === "system")
    const inheritedHistory = inheritedMessages.filter((message) => message.role !== "system")
    const messages: DeepSeekMessage[] = [
      ...leadingSystem,
      ...inheritedHistory,
      { role: "user", content: modelRequestText },
      { role: "user", content: phasePrompt.text },
      { role: "user", content: protocolMessage },
      ...(outputContractPrefix === undefined ? [] : [{ role: "user" as const, content: outputContractPrefix }]),
      { role: "user", content: outputReminder },
    ]
    const promptSnapshot = createPromptSnapshot(request.phase, messages)
    const continuityKey = options?.contextChainId ?? request.taskId
    const previousPrompt = this.previousPromptByChain.get(continuityKey)
    const promptContinuity = comparePromptSnapshots(previousPrompt, promptSnapshot)
    this.previousPromptByChain.set(continuityKey, promptSnapshot)
    runtimeLog("debug", "deepseek-model", "completion.prompt_profiled", {
      taskId: request.taskId,
      phase: request.phase,
      envelopeId: request.envelopeId,
      totalCharacters: promptSnapshot.serialized.length,
      messages: profileMessages(messages),
      modelRequestSections: profileModelRequestSections(modelRequest, referenceView.request),
      outputReminderCharacters: outputReminder.length,
      ...promptContinuity,
    })
    let lastError: unknown
    let totalInputTokens = 0
    let lastRequestInputTokens: number | undefined
    let totalOutputTokens = 0
    let cacheHitInputTokens = 0
    let cacheMissInputTokens = 0
    let hasCacheHit = false
    let hasCacheMiss = false
    let lastRawResponse: string | undefined
    const startedAt = Date.now()
    let citationRepairUsed = false
    let graphReferenceRepairUsed = false
    const schemaRepairs: string[] = []

    for (let repairAttempt = 0; repairAttempt <= this.config.maxSchemaRepairAttempts + 1; repairAttempt += 1) {
      options?.signal?.throwIfAborted()
      if (repairAttempt >= request.remainingBudget.remainingCalls
        || Date.now() >= request.remainingBudget.deadlineAtMs
        || Date.now() >= (request.remainingBudget.modelRequestDeadlineAtMs ?? Infinity)) {
        lastError ??= new Error("Model execution budget exhausted before a valid phase result was received")
        break
      }
      if (repairAttempt > 0) options?.onSchemaRepair?.()
      const requestStartedAtMs = Date.now()
      const timeoutMs = Math.min(
        this.config.timeoutMs,
        request.remainingBudget.modelRequestDeadlineAtMs === undefined
          ? Number.MAX_SAFE_INTEGER
          : Math.max(1, request.remainingBudget.modelRequestDeadlineAtMs - Date.now()),
        Math.max(1, request.remainingBudget.deadlineAtMs - Date.now()),
      )
      const thinkingEnabled = options?.forceThinking === true || this.config.thinkingModeEnabled
      const completionInput: DeepSeekCompletionInput = {
        model: this.config.model,
        messages,
        ...(!textOutput && this.config.jsonModeEnabled ? { responseFormat: { type: "json_object" as const } } : {}),
        signal: mergeExecutionSignals(options?.signal, AbortSignal.timeout(timeoutMs)),
        thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
        ...(thinkingEnabled ? { reasoningEffort: this.config.reasoningEffort } : {}),
        ...(options?.onPartial === undefined ? {} : { onPartial: options.onPartial }),
        ...(textOutput ? { tools: DISCUSS_PROVIDER_TOOLS } : {}),
      }
      runtimeLog("debug", "deepseek-model", "completion.requested", {
        taskId: request.taskId,
        phase: request.phase,
        envelopeId: request.envelopeId,
        repairAttempt: repairAttempt + 1,
        messageCount: messages.length,
        messageCharacters: messages.reduce((total, message) => total + message.content.length, 0),
        timeoutMs,
        thinkingEnabled,
        reasoningEffort: thinkingEnabled ? this.config.reasoningEffort : undefined,
        jsonModeEnabled: this.config.jsonModeEnabled,
        streaming: options?.onPartial !== undefined,
        maxTokens: completionInput.maxTokens,
      })
      const response = await this.completeWithRetry(client, completionInput)
      const usage = readUsage(response.usage)
      runtimeLog("debug", "deepseek-model", "completion.received", {
        taskId: request.taskId,
        phase: request.phase,
        envelopeId: request.envelopeId,
        repairAttempt: repairAttempt + 1,
        elapsedMs: Date.now() - requestStartedAtMs,
        contentCharacters: response.content?.length ?? 0,
        reasoningCharacters: response.reasoningContent?.length ?? 0,
        contentState: response.content === null ? "null" : response.content.trim().length === 0 ? "empty" : "present",
        finishReason: response.finishReason,
        responseId: response.responseId,
        messageFieldNames: response.messageFieldNames,
        ...((response.content === null || response.content.trim().length === 0) && response.reasoningContent
          ? { emptyContentReasoningTail: response.reasoningContent.slice(-2_000) }
          : {}),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        estimatedContentTokens: Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0)),
        completionTokenDetailKeys: usage.completionTokenDetailKeys,
        cacheHitInputTokens: usage.cacheHitInputTokens,
        cacheMissInputTokens: usage.cacheMissInputTokens,
        cacheHitRate: ratio(usage.cacheHitInputTokens, usage.inputTokens),
        reasoningTokenRate: ratio(usage.reasoningTokens, usage.outputTokens),
        inputCharacterRatio: usage.inputTokens === 0
          ? undefined
          : promptSnapshot.serialized.length / usage.inputTokens,
      })
      if (response.finishReason === "length") {
        runtimeLog("warn", "deepseek-model", "completion.output_truncated", {
          taskId: request.taskId,
          phase: request.phase,
          envelopeId: request.envelopeId,
          repairAttempt: repairAttempt + 1,
          maxTokens: completionInput.maxTokens,
          contentCharacters: response.content?.length ?? 0,
          reasoningCharacters: response.reasoningContent?.length ?? 0,
          estimatedContentTokens: Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0)),
          contentPrefix: response.content?.slice(0, 1_000) ?? "",
          contentSuffix: response.content?.slice(-1_000) ?? "",
        })
      }
      totalInputTokens += usage.inputTokens
      if (response.usage !== undefined && response.usage !== null) lastRequestInputTokens = usage.inputTokens
      totalOutputTokens += usage.outputTokens
      if (usage.cacheHitInputTokens !== undefined) {
        cacheHitInputTokens += usage.cacheHitInputTokens
        hasCacheHit = true
      }
      if (usage.cacheMissInputTokens !== undefined) {
        cacheMissInputTokens += usage.cacheMissInputTokens
        hasCacheMiss = true
      }
      const reasoningContent = nonEmptyReasoning(response.reasoningContent)
      const providerReasoning = reasoningContent === undefined ? {} : {
        reasoningContent,
        reasoningKind: response.reasoningKind
          ?? (this.config.apiProtocol === "openai_responses" ? "provider_summary" : "provider_reasoning"),
      } as const
      try {
        if (textOutput) {
          if (response.finishReason === "length" || response.finishReason === "content_filter") {
            throw new Error("讨论输出未完整结束，本次响应不会写入。")
          }
          const raw = (response.content ?? "").trim()
          if (/^(?:```(?:json)?\s*)?\{\s*"(?:outcome|artifact|requestedReads|assistantMessage)"\s*:/iu.test(raw)) {
            throw new Error("讨论响应必须使用纯文本或约定标签，本次响应不会写入。")
          }
          const toolCalls = response.toolCalls ?? []
          const toolCall = toolCalls[0]
          const readCalls = toolCalls.filter((call) => call.name === "request_read")
          if (readCalls.length > 0 && readCalls.length !== toolCalls.length) {
            throw new Error("request_read cannot be combined with other tools in one response")
          }
          const toolArgs = toolCall === undefined || readCalls.length > 0
            ? undefined
            : JSON.parse(toolCall.arguments) as { action?: "describe" | "invoke"; arguments?: string }
          const readMessage = raw || "正在读取资料。"
          if (raw.length === 0 && toolCall === undefined) throw new Error("Pure-text compose response was empty")
          const textResult = readCalls.length > 0
            ? phaseResultEnvelopeSchema.parse({
                ...assembleModelPhaseResult(
                  referenceView.restore(parseModelPhaseResult({
                    outcome: "request_read",
                    requestedReads: readCalls.flatMap((call) => parseNativeReadArguments(call.arguments)),
                    reason: "Native request_read tool requested additional evidence.",
                    selfReview: "The host will execute the requested reads before the next phase turn.",
                  }, request.phase)),
                  request,
                ),
                artifact: { assistantMessage: readMessage, finalSelfReview: "已请求补充资料，等待宿主读取。" },
              })
            : phaseResultEnvelopeSchema.parse({
                schemaVersion: request.schemaVersion,
                envelopeId: request.envelopeId,
                contextId: request.contextId,
                phase: request.phase,
                outcome: "continue",
                artifact: toolCall === undefined
                  ? { assistantMessage: raw }
                  : {
                      assistantMessage: raw.length === 0 ? "正在调用工具。" : raw,
                      finalSelfReview: "等待宿主校验并处理工具请求。",
                      toolRequest: {
                        name: toolCall.name,
                        action: toolArgs?.action ?? "invoke",
                        ...(toolArgs?.arguments === undefined ? {} : { arguments: toolArgs.arguments }),
                      },
                    },
                requestedReads: [],
                citedReadIds: [...request.committedReadIds],
                producedArtifactIds: [],
                decisionRecordIds: [],
                unresolvedDependencies: [],
                reason: "Pure-text compose response",
                selfReview: "Protocol tags are parsed by the host before persistence.",
              })
          return {
            result: textResult,
            contextExchange: {
              requestMessages,
              responseMessage: {
                role: "assistant",
                kind: "phase_response",
                taskId: request.taskId,
                turnId: request.turnId,
                phase: request.phase,
                content: raw,
              },
            },
            usage: {
              modelCalls: repairAttempt + 1,
              inputTokens: totalInputTokens,
              ...(lastRequestInputTokens === undefined ? {} : { lastRequestInputTokens }),
              outputTokens: totalOutputTokens,
              latencyMs: Math.max(0, Date.now() - startedAt),
              ...(hasCacheHit ? { cacheHitInputTokens } : {}),
              ...(hasCacheMiss ? { cacheMissInputTokens } : {}),
              provider: "deepseek",
              model: this.config.model,
              ...providerReasoning,
            },
          }
        }
        if (response.finishReason === "length") {
          throw new SyntaxError("Provider stopped at the output token limit before completing a bounded phase result")
        }
        const selectedOutput = selectModelOutput(response, request.phase)
        lastRawResponse = selectedOutput.raw
        if (selectedOutput.source === "reasoning") {
          runtimeLog("warn", "deepseek-model", "completion.reasoning_fallback_accepted", {
            taskId: request.taskId,
            phase: request.phase,
            envelopeId: request.envelopeId,
            repairAttempt: repairAttempt + 1,
            jsonCharacters: selectedOutput.raw.length,
          })
        }
        const modelResult = selectedOutput.modelResult
        const result = assembleModelPhaseResult(referenceView.restore(modelResult), request)
        const delivery = inspectPhaseFictionDelivery(request.phase, result.artifact, result.outcome)
        if (!delivery.ok) {
          runtimeLog("warn", "deepseek-model", "fiction.delivery.rejected", {
            taskId: request.taskId,
            phase: request.phase,
            envelopeId: request.envelopeId,
            repairAttempt: repairAttempt + 1,
            verdict: delivery.verdict,
            matched: delivery.matched,
          })
          throw new FictionDeliveryError(delivery)
        }
        if (request.phase === "draft" && result.outcome !== "request_read") {
          const presentation = asRecord(asRecord(request.input).presentation)
          const minimum = presentation.minimumWordCount
          const maximum = presentation.maximumWordCount
          if (typeof minimum === "number" && typeof maximum === "number") {
            const { contentMarkdown } = internalDraftArtifactSchema.parse(result.artifact)
            const count = contentMarkdown.replace(/^\s*#\s+[^\n]+\n/u, "").replace(/\s+/gu, "").length
            if (count < minimum || count > maximum) {
              throw new Error(renderRuntimePrompt("provider-repair", "draft-word-count", { count, minimum, maximum }))
            }
          }
        }
        runtimeLog("debug", "deepseek-model", "execution.completed", {
          taskId: request.taskId,
          phase: request.phase,
          envelopeId: request.envelopeId,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          repairAttempts: repairAttempt,
          outcome: result.outcome,
          requestedReadCount: result.requestedReads.length,
          citedReadCount: result.citedReadIds.length,
        })
        return {
          result,
          ...(schemaRepairs.length === 0 ? {} : { schemaRepairs }),
          contextExchange: {
            requestMessages,
            responseMessage: {
              role: "assistant",
              kind: "phase_response",
              taskId: request.taskId,
              turnId: request.turnId,
              phase: request.phase,
              content: selectedOutput.raw,
            },
          },
          usage: {
            modelCalls: repairAttempt + 1,
            inputTokens: totalInputTokens,
            ...(lastRequestInputTokens === undefined ? {} : { lastRequestInputTokens }),
            outputTokens: totalOutputTokens,
            latencyMs: Math.max(0, Date.now() - startedAt),
            ...(hasCacheHit ? { cacheHitInputTokens } : {}),
            ...(hasCacheMiss ? { cacheMissInputTokens } : {}),
            provider: "deepseek",
            model: this.config.model,
            ...providerReasoning,
          },
        }
      } catch (error) {
        lastError = error
        const dedicatedCitationRepair = repairAttempt >= this.config.maxSchemaRepairAttempts
          && request.phase === "synopsis_discuss" && error instanceof UnreadableCitationError && !citationRepairUsed
        const dedicatedGraphReferenceRepair = repairAttempt >= this.config.maxSchemaRepairAttempts
          && isGraphReferenceValidationError(error) && !graphReferenceRepairUsed
        const canRepair = !textOutput && (repairAttempt < this.config.maxSchemaRepairAttempts
          || dedicatedCitationRepair
          || dedicatedGraphReferenceRepair)
          && repairAttempt + 1 < request.remainingBudget.remainingCalls
          && Date.now() < request.remainingBudget.deadlineAtMs
          && Date.now() < (request.remainingBudget.modelRequestDeadlineAtMs ?? Infinity)
          && options?.signal?.aborted !== true
        runtimeLog(canRepair ? "warn" : "error", "deepseek-model", "response.validation_failed", {
          taskId: request.taskId,
          phase: request.phase,
          envelopeId: request.envelopeId,
          repairAttempt: repairAttempt + 1,
          maxSchemaRepairAttempts: this.config.maxSchemaRepairAttempts,
          error: errorDetails(error),
        })
        options?.signal?.throwIfAborted()
        if (!canRepair) break
        schemaRepairs.push(formatValidationError(error).replace(/\s+/g, " ").slice(0, 500))
        if (dedicatedCitationRepair) citationRepairUsed = true
        if (dedicatedGraphReferenceRepair) graphReferenceRepairUsed = true
        const validationText = formatValidationError(error)
        const modelValidationText = referenceView.toModelText(validationText)
        const repairReason = error instanceof FictionDeliveryError
          ? "fiction-delivery-failure"
          : error instanceof SyntaxError
            ? "incomplete-response"
            : validationText.includes("toolRequest 不可与")
              ? "exclusive-tool-request"
              : isGraphReferenceValidationError(error)
                ? "invalid-graph-reference"
                : "validation-failure"
        const repairMessage = {
          role: "user" as const,
          content: [
            renderRuntimePrompt("provider-repair", repairReason),
            renderRuntimePrompt("provider-repair", "validation-error", { error: modelValidationText }),
            buildRepairReminder(request, error, modelValidationText, referenceView),
          ].join("\n"),
        }
        messages.push(repairMessage)
      }
    }
    runtimeLog("error", "deepseek-model", "execution.failed", {
      taskId: request.taskId,
      phase: request.phase,
      envelopeId: request.envelopeId,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      error: errorDetails(lastError),
    })
    throw new DeepSeekModelError(
      "schema",
      `DeepSeek response could not satisfy the phase contract: ${formatError(lastError)}`,
      lastRawResponse,
    )
  }

  private async createClient(): Promise<DeepSeekCompletionClient> {
    const apiKey = await this.secrets.getSecret(this.config.apiKeyRef)
    if (apiKey.trim().length === 0) {
      throw new DeepSeekModelError("configuration", "DeepSeek API key is empty")
    }
    const dispatcher = this.config.proxyUrl === undefined ? undefined : new ProxyAgent(this.config.proxyUrl)
    const clientOptions = {
      apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeoutMs,
      maxRetries: 0,
      defaultHeaders: { "User-Agent": OPENAI_COMPATIBLE_USER_AGENT },
      ...(dispatcher === undefined ? {} : { fetchOptions: { dispatcher } }),
    } as unknown as ConstructorParameters<typeof OpenAI>[0]
    const client = new OpenAI(clientOptions)
    return {
      complete: async (input) => {
        if (this.config.apiProtocol === "openai_responses") {
          const readTools = input.tools?.flatMap((tool) => {
            const definition = asRecord(asRecord(tool).function)
            if (definition.name !== "request_read") return []
            return [{ type: "function" as const, ...definition, strict: false }]
          }) ?? []
          const body = {
            model: input.model,
            input: input.messages.map((message) => ({ role: message.role, content: message.content })),
            ...(input.responseFormat === undefined ? {} : { text: { format: input.responseFormat } }),
            ...(input.maxTokens === undefined ? {} : { max_output_tokens: input.maxTokens }),
            ...(input.thinking?.type === "enabled"
              ? { reasoning: { effort: input.reasoningEffort, summary: "detailed" as const } }
              : {}),
            ...(readTools.length === 0 ? {} : { tools: readTools, tool_choice: "auto" as const }),
          } as OpenAI.Responses.ResponseCreateParamsNonStreaming
          const requestOptions = input.signal === undefined ? undefined : { signal: input.signal }
          if (readTools.length > 0 && input.onPartial !== undefined) {
            const stream = await client.responses.create({ ...body, stream: true }, requestOptions)
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                input.onPartial({ contentDelta: event.delta })
              } else if (event.type === "response.reasoning_summary_text.delta") {
                input.onPartial({ reasoningDelta: event.delta })
              } else if (event.type === "response.completed") {
                // The terminal response includes the fully assembled function arguments for every output item.
                return readResponsesCompletion(event.response, true)
              } else if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
                throw new Error(`OpenAI Responses stream ended with ${event.type}`)
              }
            }
            throw new Error("OpenAI Responses stream closed without a completed response")
          }
          const response = await client.responses.create(body, requestOptions)
          return readResponsesCompletion(response, readTools.length > 0)
        }
        // Node OpenAI SDK has no Python-style extra_body; DeepSeek expects `thinking` at the top level.
        const requestBody = {
          model: input.model,
          messages: [...input.messages],
          ...(input.responseFormat === undefined ? {} : { response_format: input.responseFormat }),
          ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
          ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
          ...(input.reasoningEffort === undefined ? {} : { reasoning_effort: input.reasoningEffort }),
          ...(input.tools === undefined ? {} : { tools: [...input.tools], tool_choice: "auto" }),
        }
        if (input.onPartial !== undefined) {
          const stream = await client.chat.completions.create(
            {
              ...requestBody,
              stream: true,
              stream_options: { include_usage: true },
            } as Parameters<typeof client.chat.completions.create>[0],
            input.signal === undefined ? undefined : { signal: input.signal },
          ) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          let content = ""
          let reasoningContent = ""
          let finishReason: string | null | undefined
          let responseId: string | undefined
          let usage: unknown
          const toolCalls = new Map<number, DeepSeekToolCall>()
          for await (const chunk of stream) {
            const chunkRecord = asRecord(chunk)
            if (responseId === undefined) responseId = readString(chunkRecord.id)
            if (chunkRecord.usage !== undefined) usage = chunkRecord.usage
            const choice = asRecord(Array.isArray(chunkRecord.choices) ? chunkRecord.choices[0] : undefined)
            const delta = asRecord(choice?.delta)
            const reasoningDelta = readString(delta?.reasoning_content)
            const contentDelta = typeof delta?.content === "string" ? delta.content : undefined
            if (reasoningDelta !== undefined && reasoningDelta.length > 0) {
              reasoningContent += reasoningDelta
              input.onPartial({ reasoningDelta })
            }
            if (contentDelta !== undefined && contentDelta.length > 0) {
              content += contentDelta
              input.onPartial({ contentDelta })
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const raw of delta.tool_calls as readonly unknown[]) {
                const call = asRecord(raw)
                const fn = asRecord(call.function)
                const index = typeof call.index === "number" ? call.index : 0
                const current = toolCalls.get(index)
                toolCalls.set(index, {
                  name: (current?.name ?? "") + (readString(fn.name) ?? ""),
                  arguments: (current?.arguments ?? "") + (readString(fn.arguments) ?? ""),
                })
              }
            }
            const chunkFinish = readString(choice?.finish_reason)
            if (chunkFinish !== undefined) finishReason = chunkFinish
          }
          return {
            content: content.length === 0 ? null : content,
            finishReason: finishReason ?? null,
            ...(responseId === undefined ? {} : { responseId }),
            messageFieldNames: ["content", "reasoning_content"],
            ...(toolCalls.size === 0 ? {} : {
              toolCalls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call),
            }),
            ...(reasoningContent.length === 0
              ? {}
              : { reasoningContent, reasoningKind: "provider_reasoning" as const }),
            ...(usage === undefined ? {} : { usage }),
          }
        }
        const response = await client.chat.completions.create(
          requestBody as Parameters<typeof client.chat.completions.create>[0],
          input.signal === undefined ? undefined : { signal: input.signal },
        ) as OpenAI.Chat.Completions.ChatCompletion
        const message = asRecord(response.choices[0]?.message)
        const reasoningContent = nonEmptyReasoning(readString(message.reasoning_content))
        const toolCalls = response.choices[0]?.message.tool_calls?.flatMap((call) => (
          call.type === "function" ? [{ name: call.function.name, arguments: call.function.arguments }] : []
        ))
        return {
          content: response.choices[0]?.message.content ?? null,
          ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
          finishReason: response.choices[0]?.finish_reason ?? null,
          responseId: response.id,
          messageFieldNames: Object.keys(message),
          ...(reasoningContent === undefined ? {} : { reasoningContent, reasoningKind: "provider_reasoning" as const }),
          usage: response.usage,
        }
      },
    }
  }

  private async completeWithRetry(
    client: DeepSeekCompletionClient,
    input: DeepSeekCompletionInput,
  ): Promise<DeepSeekCompletionResponse> {
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        return await client.complete(input)
      } catch (error) {
        runtimeLog(input.signal?.aborted || attempt >= this.config.maxAttempts || !isRetryable(error) ? "error" : "warn", "deepseek-model", "completion.attempt_failed", {
          model: input.model,
          attempt,
          maxAttempts: this.config.maxAttempts,
          aborted: input.signal?.aborted ?? false,
          retryable: isRetryable(error),
          error: errorDetails(error),
        })
        if (input.signal?.aborted || attempt >= this.config.maxAttempts || !isRetryable(error)) {
          throw new DeepSeekModelError("network", `DeepSeek request failed: ${formatError(error)}`)
        }
      }
    }
  }
}

function parseNativeReadArguments(raw: string): readonly unknown[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error("request_read arguments must be valid JSON", { cause: error })
  }
  const args = asRecord(value)
  if (Object.keys(args).length !== 1 || !Array.isArray(args.reads) || args.reads.length === 0) {
    throw new Error("request_read arguments must contain only a non-empty reads array")
  }
  return args.reads
}

function readResponsesCompletion(value: unknown, readToolOffered: boolean): DeepSeekCompletionResponse {
  const response = asRecord(value)
  const output = Array.isArray(response.output) ? response.output.map(asRecord) : []
  const status = readString(response.status)
  const incompleteReason = readString(asRecord(response.incomplete_details).reason)
  const finishReason = incompleteReason ?? status
  const responseId = readString(response.id)
  const reasoningContent = nonEmptyReasoning(readResponsesReasoning(output))
  const usage = normalizeResponsesUsage(response.usage)
  const toolCalls = readToolOffered ? output.flatMap((item) => {
    if (item.type !== "function_call") return []
    if (item.name !== "request_read") throw new Error("OpenAI Responses returned an unoffered function tool")
    if (status !== "completed" || (item.status !== undefined && item.status !== "completed")) {
      throw new Error("OpenAI Responses returned an incomplete request_read call")
    }
    const args = readString(item.arguments)
    if (args === undefined) throw new Error("OpenAI Responses request_read call has no arguments")
    return [{ name: item.name, arguments: args }]
  }) : []
  const outputText = readString(response.output_text) ?? output.flatMap((item) => (
    item.type === "message" && item.role === "assistant" && Array.isArray(item.content)
      ? item.content.map(asRecord).flatMap((part) => part.type === "output_text" && typeof part.text === "string" ? [part.text] : [])
      : []
  )).join("")
  return {
    content: outputText || null,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(responseId === undefined ? {} : { responseId }),
    messageFieldNames: Object.keys(response),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(reasoningContent === undefined ? {} : { reasoningContent, reasoningKind: "provider_summary" }),
    ...(usage === undefined ? {} : { usage }),
  }
}

function readResponsesReasoning(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const sections = value.flatMap((item) => {
    const record = asRecord(item)
    if (record.type !== "reasoning") return []
    return [...readTextParts(record.summary), ...readTextParts(record.content)]
  })
  return sections.length === 0 ? undefined : sections.join("\n\n")
}

function readTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = asRecord(item).text
    return typeof text === "string" && text.trim().length > 0 ? [text] : []
  })
}

function normalizeResponsesUsage(value: unknown): Record<string, unknown> | undefined {
  const usage = asRecord(value)
  if (Object.keys(usage).length === 0) return undefined
  const inputDetails = asRecord(usage.input_tokens_details)
  const outputDetails = asRecord(usage.output_tokens_details)
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    prompt_tokens_details: { cached_tokens: inputDetails.cached_tokens },
    completion_tokens_details: { reasoning_tokens: outputDetails.reasoning_tokens },
  }
}

function normalizeContextMessages(
  contextMessages: readonly VisibleModelContextMessage[],
  currentPhase: AIPhase,
  currentPhaseInstruction: string,
  textOutput: boolean,
): DeepSeekMessage[] {
  const inherited = contextMessages.filter((message) => {
    if (textOutput && message.phase === currentPhase && (message.kind === "phase_protocol" || message.kind === "phase_instruction")) return false
    if (message.taskId === undefined || message.turnId === undefined || message.phase !== currentPhase) return true
    if (message.kind === "phase_protocol") return false
    if (message.kind === "phase_instruction" && message.content === currentPhaseInstruction) return false
    return !(message.kind === "phase_request" && message.content.startsWith(OUTPUT_CONTRACT_PREFIX))
  })
  return inherited.map((message, index) => {
    const role = message.role === "system" && index > 0 ? "user" as const : message.role
    return { role, content: message.content }
  })
}

function mergeExecutionSignals(executionSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  return executionSignal === undefined ? timeoutSignal : AbortSignal.any([executionSignal, timeoutSignal])
}

function buildModelResultRules(request: PhaseRequestEnvelope, referenceView: ModelReferenceView): string {
  const promptFile = "provider-protocol"
  const stageProjection = asRecord(asRecord(request.input).stageProjection)
  const declaredLocalReferences = collectDeclaredLocalReferences(request)
  const mayDeclareLocalReferences = request.phase === "graph_governance"
    || request.phase === "graph_structure_plan"
    || request.phase === "graph_capacity_rewrite"
  const localReferenceRule = mayDeclareLocalReferences
    ? renderRuntimePrompt(promptFile, "declare-local-reference")
    : declaredLocalReferences.length > 0
      ? renderRuntimePrompt(promptFile, "reuse-local-reference", { references: declaredLocalReferences.join(", ") })
      : renderRuntimePrompt(promptFile, "no-local-references")
  const graphReferenceRule = mayDeclareLocalReferences
    || request.phase === "graph_spacetime_settlement"
    || request.phase === "graph_retrieval_design"
    || request.phase === "graph_governance_review"
    ? [
        renderRuntimePrompt(promptFile, request.phase === "graph_governance_review"
          ? "review-stage-projection"
          : "graph-output-limit"),
        renderRuntimePrompt(promptFile, "graph-reference-rules", {
          revisionReadTokens: referenceView.revisionReadTokens.join(", ") || "none",
        }),
      ].join("\n")
    : renderRuntimePrompt(promptFile, "evidence-and-graph-references")
  const stageProjectionRule = Object.keys(stageProjection).length === 0
    ? renderRuntimePrompt(promptFile, "no-stage-projection")
    : renderRuntimePrompt(promptFile, "stage-projection", { kind: String(stageProjection.kind) })
  return renderRuntimePrompt(promptFile, "model-result-rules", {
    phase: request.phase,
    localReferenceRule,
    graphReferenceRule,
    stageProjectionRule,
    crossPhaseChecklist: buildCrossPhaseChecklist(request),
    graphReferencePairs: referenceView.graphReferencePairs.join(", ") || "none",
    committedReadTokens: referenceView.committedReadTokens.join(", ") || "none",
    visiblePendingTokens: referenceView.visiblePendingTokens.join(", ") || "none",
  })
}

function collectDeclaredLocalReferences(request: PhaseRequestEnvelope): string[] {
  const input = asRecord(request.input)
  const artifacts = Object.keys(asRecord(input.validationArtifacts)).length === 0
    ? asRecord(input.artifacts)
    : asRecord(input.validationArtifacts)
  const governance = asRecord(artifacts.graph_governance)
  const structure = asRecord(artifacts.graph_structure_plan)
  const structureProposals = Array.isArray(structure.proposals) ? structure.proposals : []
  const structureMutations = structureProposals.map((proposal) => asRecord(asRecord(proposal).mutation))
  const mutations = [
    ...(Array.isArray(governance.mutations) ? governance.mutations.map(asRecord) : []),
    ...structureMutations,
  ]
  return mutations.flatMap((mutation) => {
    return (mutation.operation === "create_node" || mutation.operation === "create_link")
      && typeof mutation.ref === "string"
      && mutation.ref.startsWith("local:")
      ? [mutation.ref]
      : []
  })
}

function buildCrossPhaseChecklist(request: PhaseRequestEnvelope): string {
  const promptFile = "provider-phase-checklists"
  const input = asRecord(request.input)
  if (request.phase === "synopsis_discuss") {
    const evidenceCount = Array.isArray(input.readEvidence) ? input.readEvidence.length : 0
    return renderRuntimePrompt(promptFile, "synopsis-discuss", {
      evidenceRule: evidenceCount > 0
        ? renderRuntimePrompt(promptFile, "synopsis-discuss-evidence", { evidenceCount })
        : renderRuntimePrompt(promptFile, "synopsis-discuss-no-evidence"),
    })
  }
  const artifacts = Object.keys(asRecord(input.validationArtifacts)).length === 0
    ? asRecord(input.artifacts)
    : asRecord(input.validationArtifacts)
  if (request.phase === "dependency_audit") {
    const workflow = input.workflow === "evolution" ? "evolution" : input.workflow === "query" ? "query" : "turn"
    const sourceUnitIds = Array.isArray(input.sourceUnitIds) ? input.sourceUnitIds : []
    return renderRuntimePrompt(promptFile, "dependency-audit", {
      workflow,
      sourceUnitCount: sourceUnitIds.length,
      sceneRule: sourceUnitIds.length > 0
        ? renderRuntimePrompt(promptFile, "dependency-narrative-sources", { sourceIndexes: indexList(sourceUnitIds.length) })
        : renderRuntimePrompt(promptFile, workflow === "evolution"
          ? "dependency-background-evolution"
          : "dependency-no-narrative-sources"),
    })
  }
  if (request.phase === "rule_assembly") {
    const readableWorkspacePathCount = Array.isArray(input.readEvidence)
      ? input.readEvidence.filter((evidence) => {
          const record = asRecord(evidence)
          return typeof record.ownerKind === "string" && record.ownerKind.startsWith("workspace:")
        }).length
      : 0
    return renderRuntimePrompt(promptFile, "rule-assembly", { readableWorkspacePathCount })
  }
  if (request.phase === "semantic_review") {
    const governance = asRecord(artifacts.graph_governance)
    const frontiers = Array.isArray(governance.affectedFrontierRefs)
      ? governance.affectedFrontierRefs.filter((value): value is string => typeof value === "string")
      : []
    const verificationProbeIndexes = Array.isArray(input.verificationProbeExecutions)
      ? input.verificationProbeExecutions.flatMap((execution) => {
          const probeIndex = asRecord(execution).probeIndex
          return typeof probeIndex === "number" ? [probeIndex] : []
        })
      : []
    return renderRuntimePrompt(promptFile, "semantic-review", {
      frontiers: frontiers.join(", ") || "none",
      probeRule: verificationProbeIndexes.length === 0
        ? renderRuntimePrompt(promptFile, "semantic-review-no-probes")
        : renderRuntimePrompt(promptFile, "semantic-review-probes", { probeIndexes: verificationProbeIndexes.join(", ") }),
    })
  }
  if (request.phase === "graph_governance_review") {
    const verificationProbeExecutions = Array.isArray(input.verificationProbeExecutions)
      ? input.verificationProbeExecutions.map(asRecord)
      : []
    const verificationProbeIndexes = verificationProbeExecutions.flatMap((execution) => (
      typeof execution.probeIndex === "number" ? [execution.probeIndex] : []
    ))
    const temporalEvidenceRule = renderRuntimePrompt(promptFile, "temporal-evidence-references")
    return verificationProbeIndexes.length === 0
      ? renderRuntimePrompt(promptFile, "governance-review-no-probes", { temporalEvidenceRule })
      : renderRuntimePrompt(promptFile, "governance-review-probes", {
          probeIndexes: verificationProbeIndexes.join(", "),
          probeRecords: verificationProbeExecutions.map(formatVerificationProbeExecution).join("\n"),
          temporalEvidenceRule,
        })
  }
  if (request.phase === "graph_spacetime_settlement") {
    const dependency = asRecord(artifacts.dependency_audit)
    const structure = asRecord(artifacts.graph_structure_plan)
    const scenes = Array.isArray(dependency.sceneContinuity) ? dependency.sceneContinuity : []
    const temporalClaims = Array.isArray(dependency.temporalClaims) ? dependency.temporalClaims : []
    const proposals = Array.isArray(structure.proposals) ? structure.proposals : []
    const sourceUnitIds = Array.isArray(input.sourceUnitIds) ? input.sourceUnitIds : []
    const sceneIndexes = scenes.flatMap((value) => {
      const sceneIndex = asRecord(value).sceneIndex
      return typeof sceneIndex === "number" ? [sceneIndex] : []
    })
    return renderRuntimePrompt(promptFile, "graph-spacetime-settlement", {
      sceneIndexes: numberList(sceneIndexes),
      sourceIndexes: indexList(sourceUnitIds.length),
      sourceRule: renderRuntimePrompt(promptFile, sourceUnitIds.length === 0
        ? "background-scene-sources"
        : "spacetime-narrative-scene-sources"),
      sceneRequirements: scenes.map((value, index) => {
        const scene = asRecord(value)
        const sceneIndex = typeof scene.sceneIndex === "number" ? scene.sceneIndex : index
        const predecessorSceneIndexes = Array.isArray(scene.predecessorSceneIndexes)
          ? scene.predecessorSceneIndexes.filter((item): item is number => typeof item === "number")
          : []
        const requirements = [
          renderRuntimePrompt(promptFile, "spacetime-scene-predecessors", {
            sceneIndex,
            predecessorSceneIndexes: predecessorSceneIndexes.join(", "),
          }),
        ]
        if (scene.predecessorRequired === true) {
          if (predecessorSceneIndexes.length === 0) requirements.push(renderRuntimePrompt(promptFile, "spacetime-scene-predecessor-anchors"))
          requirements.push(renderRuntimePrompt(promptFile, "spacetime-scene-transition-path"))
        }
        if (scene.correspondenceRequired === true) requirements.push(renderRuntimePrompt(promptFile, "spacetime-scene-correspondence"))
        return renderRuntimePrompt(promptFile, "spacetime-scene-requirements", {
          requirements: requirements.join("; "),
        }) + "\n"
      }).join(""),
      proposalRefs: proposals.flatMap((value) => {
        const proposalRef = asRecord(value).proposalRef
        return typeof proposalRef === "string" ? [proposalRef] : []
      }).join(", ") || "none",
      temporalClaims: temporalClaims.flatMap((value) => {
        const claim = asRecord(value)
        return typeof claim.claimRef === "string" && typeof claim.sceneIndex === "number"
          ? [`${claim.claimRef}->scene ${String(claim.sceneIndex)}`]
          : []
      }).join(", ") || "none",
    })
  }
  if (request.phase === "graph_governance") {
    const dependency = asRecord(artifacts.dependency_audit)
    const scenes = Array.isArray(dependency.sceneContinuity) ? dependency.sceneContinuity : []
    const sourceUnitIds = Array.isArray(input.sourceUnitIds) ? input.sourceUnitIds : []
    return renderRuntimePrompt(promptFile, "graph-governance", {
      sceneIndexes: indexList(scenes.length),
      sourceIndexes: indexList(sourceUnitIds.length),
      sourceRule: renderRuntimePrompt(promptFile, sourceUnitIds.length === 0
        ? "background-scene-sources"
        : "governance-narrative-scene-sources"),
    })
  }
  if (request.phase === "graph_structure_plan") {
    return renderRuntimePrompt(promptFile, "graph-structure-plan")
  }
  if (request.phase === "frontier_settlement") {
    const projection = asRecord(input.stageProjection)
    const review = asRecord(artifacts.semantic_review)
    const approvedFrontiers = Array.isArray(projection.affectedFrontierRefs)
      ? projection.affectedFrontierRefs.filter((value): value is string => typeof value === "string")
      : Array.isArray(review.approvedAffectedFrontierRefs)
      ? review.approvedAffectedFrontierRefs.filter((value): value is string => typeof value === "string")
      : []
    const approvedSceneBindings = Array.isArray(projection.approvedSceneBindings)
      ? projection.approvedSceneBindings.map(asRecord)
      : []
    const priorFrontierStates = Array.isArray(projection.priorFrontierStates)
      ? projection.priorFrontierStates.map(asRecord)
      : []
    return renderRuntimePrompt(promptFile, "frontier-settlement", {
      approvedFrontiers: approvedFrontiers.join(", ") || "none",
      approvedFrontierCount: approvedFrontiers.length,
      lengthRule: approvedFrontiers.length === 0
        ? renderRuntimePrompt(promptFile, "frontier-empty")
        : renderRuntimePrompt(promptFile, "frontier-length", { approvedFrontierCount: approvedFrontiers.length }),
      approvedFrontierRequirements: approvedFrontiers.map((reference, index) => (
        renderRuntimePrompt(promptFile, "frontier-position", { index, reference: JSON.stringify(reference) }) + "\n"
      )).join(""),
      anchorRule: renderRuntimePrompt(promptFile, approvedSceneBindings.length > 0
        ? "frontier-scene-anchors"
        : "frontier-prior-anchors"),
      priorFrontierStates: priorFrontierStates.map((state) => (
        "\n" + renderRuntimePrompt(promptFile, "frontier-prior-state", {
          frontierAnchorRef: String(state.frontierAnchorRef),
          lastSceneAnchorRefs: formatReferenceList(state.lastSceneAnchorRefs),
          lastTimeAnchorRefs: formatReferenceList(state.lastTimeAnchorRefs),
          lastLocationAnchorRefs: formatReferenceList(state.lastLocationAnchorRefs),
          correspondenceRefs: formatReferenceList(state.correspondenceRefs),
        })
      )).join(""),
    })
  }
  return renderRuntimePrompt(promptFile, "default-checklist")
}

function formatVerificationProbeExecution(execution: Record<string, unknown>): string {
  return renderRuntimePrompt("provider-phase-checklists", "executed-probe", {
    probeIndex: String(execution.probeIndex),
    status: String(execution.status),
    returnedReadRefs: formatReferenceList(execution.returnedReadRefs),
    returnedGraphRefs: formatReferenceList(execution.returnedGraphRefs),
    returnedProposalRefs: formatReferenceList(execution.returnedProposalRefs),
    resultDigest: String(execution.resultDigest),
  })
}

function formatReferenceList(value: unknown): string {
  return `[${Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(",") : ""}]`
}

function indexList(length: number): string {
  return length === 0 ? "none" : Array.from({ length }, (_, index) => String(index)).join(", ")
}

function numberList(values: readonly number[]): string {
  return values.length === 0 ? "none" : values.join(", ")
}

function buildOutputContractPrefix(request: PhaseRequestEnvelope): string {
  return renderRuntimePrompt("provider-protocol", "output-schema", {
    schema: JSON.stringify(phaseModelResultJsonSchema(request.phase)),
    phase: request.phase,
  })
}

function buildOutputReminder(request: PhaseRequestEnvelope, referenceView: ModelReferenceView): string {
  return [
    renderRuntimePrompt("provider-protocol", "output-reminder", {
      contractPrefix: OUTPUT_CONTRACT_PREFIX,
      phase: request.phase,
      rules: buildModelResultRules(request, referenceView),
    }),
    ...(isFictionDeliveryPhase(request.phase) ? [renderRuntimePrompt("provider-protocol", "fiction-delivery")] : []),
  ].join("\n")
}

function buildRepairReminder(
  request: PhaseRequestEnvelope,
  error: unknown,
  validationText: string,
  referenceView: ModelReferenceView,
): string {
  const promptFile = "provider-repair"
  const input = asRecord(request.input)
  const sourceUnitCount = Array.isArray(input.sourceUnitIds) ? input.sourceUnitIds.length : 0
  const phase = request.phase
  const lastSourceIndex = Math.max(0, sourceUnitCount - 1)
  const coverageHint = validationText.includes("Scene source coverage")
    ? renderRuntimePrompt(promptFile, "scene-source-coverage", { lastSourceIndex })
    : validationText.includes("Source unit settlement records")
      ? renderRuntimePrompt(promptFile, "source-settlement-coverage", { lastSourceIndex })
      : undefined
  const errorHint = error instanceof FictionDeliveryError
    ? renderRuntimePrompt(promptFile, "fiction-delivery-hint")
    : error instanceof UnreadableCitationError
      ? renderRuntimePrompt(promptFile, "citation-hint", {
          citationAllowlist: JSON.stringify([...referenceView.committedReadTokens, ...referenceView.visiblePendingTokens]),
        })
      : isGraphReferenceValidationError(error)
        ? renderRuntimePrompt(promptFile, "graph-reference-hint", {
            graphReferencePairs: referenceView.graphReferencePairs.join(", ") || "none",
          })
        : error instanceof SyntaxError
          ? renderRuntimePrompt(promptFile, "syntax-hint")
          : undefined
  return [
    renderRuntimePrompt(promptFile, "repair-contract"),
    errorHint,
    coverageHint,
    renderRuntimePrompt(promptFile, "original-phase", { phase }),
    ...(isFictionDeliveryPhase(phase) ? [renderRuntimePrompt("provider-protocol", "fiction-delivery")] : []),
    renderRuntimePrompt(promptFile, "close-result"),
  ].filter((part) => part !== undefined).join("\n")
}

export function isGraphReferenceValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Graph references must be owner IDs read in this turn")
}

function parseFirstJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const start = raw.search(/\S/u)
    if (start < 0 || raw[start] !== "{") throw error
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === "\\") escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
      } else if (character === "{") {
        depth += 1
      } else if (character === "}") {
        depth -= 1
        if (depth === 0) {
          const firstObjectEnd = index + 1
          const trailing = raw.slice(firstObjectEnd).trim()
          if (trailing.startsWith(",")) {
            try {
              return JSON.parse(raw.slice(start, index) + trailing)
            } catch {
              return JSON.parse(raw.slice(start, firstObjectEnd))
            }
          }
          return JSON.parse(raw.slice(start, firstObjectEnd))
        }
      }
    }
    throw error
  }
}

function selectModelOutput(response: DeepSeekCompletionResponse, phase: AIPhase): {
  raw: string
  modelResult: ReturnType<typeof parseModelPhaseResult>
  source: "content" | "reasoning"
} {
  const content = response.content?.trim()
  if (content !== undefined && content.length > 0) {
    const value = parseFirstJsonObject(content)
    const modelResult = parseModelPhaseResult(value, phase)
    return {
      raw: hasMisplacedPhaseField(value, phase) ? JSON.stringify(modelResult) : content,
      modelResult,
      source: "content",
    }
  }

  const reasoning = response.reasoningContent?.trim()
  if (reasoning !== undefined && reasoning.length > 0) {
    const fallback = parseLastValidModelResult(reasoning, phase)
    if (fallback !== undefined) return { ...fallback, source: "reasoning" }
  }

  throw new DeepSeekModelError(
    "response",
    "DeepSeek returned reasoning without final content",
  )
}

function parseLastValidModelResult(raw: string, phase: AIPhase): {
  raw: string
  modelResult: ReturnType<typeof parseModelPhaseResult>
} | undefined {
  const objectEnd = raw.lastIndexOf("}")
  if (objectEnd < 0) return undefined
  let objectStart = raw.lastIndexOf("{", objectEnd)
  while (objectStart >= 0) {
    const candidate = raw.slice(objectStart, objectEnd + 1)
    try {
      const value: unknown = JSON.parse(candidate)
      const modelResult = parseModelPhaseResult(value, phase)
      return {
        raw: hasMisplacedPhaseField(value, phase) ? JSON.stringify(modelResult) : candidate,
        modelResult,
      }
    } catch {
      // Continue toward the enclosing object until the complete phase result is found.
    }
    if (objectStart === 0) break
    objectStart = raw.lastIndexOf("{", objectStart - 1)
  }
  return undefined
}

function hasMisplacedPhaseField(value: unknown, phase: AIPhase): boolean {
  return (phase === "synopsis_discuss" && asRecord(value).finalSelfReview !== undefined)
    || (phase === "graph_governance" && asRecord(value).executionMode !== undefined)
}

function formatValidationError(error: unknown): string {
  return formatError(error)
}

export class EnvironmentSecretProvider implements SecretProvider {
  public constructor(private readonly values: NodeJS.ProcessEnv = process.env) {}

  public getSecret(reference: string): Promise<string> {
    const value = reference === "deepseek-api-key" ? this.values.DEEPSEEK_API_KEY : this.values[reference]
    return Promise.resolve(value ?? "")
  }
}

function readUsage(value: unknown): {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  completionTokenDetailKeys?: readonly string[]
  cacheHitInputTokens?: number
  cacheMissInputTokens?: number
} {
  const usage = asRecord(value)
  const promptTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.input_tokens) ?? 0
  const completionTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.output_tokens) ?? 0
  const promptTokenDetails = asRecord(usage.prompt_tokens_details)
  const completionTokenDetails = asRecord(usage.completion_tokens_details)
  const reasoningTokens = readNumber(completionTokenDetails.reasoning_tokens)
  const cacheHit = readNumber(usage.prompt_cache_hit_tokens) ?? readNumber(promptTokenDetails.cached_tokens)
  const explicitCacheMiss = readNumber(usage.prompt_cache_miss_tokens)
  const cacheMiss = explicitCacheMiss ?? (cacheHit === undefined ? undefined : Math.max(0, promptTokens - cacheHit))
  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(Object.keys(completionTokenDetails).length === 0 ? {} : { completionTokenDetailKeys: Object.keys(completionTokenDetails) }),
    ...(cacheHit === undefined ? {} : { cacheHitInputTokens: cacheHit }),
    ...(cacheMiss === undefined ? {} : { cacheMissInputTokens: cacheMiss }),
  }
}

function createPromptSnapshot(phase: string, messages: readonly DeepSeekMessage[]): PromptSnapshot {
  return {
    phase,
    serialized: messages.map((message) => `${message.role}\n${message.content}`).join("\n\u0000\n"),
    messageDigests: messages.map((message) => digestText(`${message.role}\n${message.content}`)),
  }
}

function profileMessages(messages: readonly DeepSeekMessage[]): readonly Record<string, unknown>[] {
  const sections = ["base_rules", "phase_prompt", "protocol", "turn_request"]
  return messages.map((message, index) => ({
    index,
    section: sections[index] ?? `message_${String(index)}`,
    role: message.role,
    characters: message.content.length,
    digest: digestText(`${message.role}\n${message.content}`),
  }))
}

function profileModelRequestSections(value: unknown, fullValue: unknown): Record<string, unknown> {
  const request = asRecord(value)
  const input = asRecord(request.input)
  const fullInput = asRecord(asRecord(fullValue).input)
  const {
    readEvidence,
    retrievalGaps,
    workspaceCatalog,
    artifacts,
    projectSettings,
    stageProjection,
    ...coreInput
  } = input
  const { input: ignoredInput, ...envelope } = request
  void ignoredInput
  return {
    envelopeCharacters: serializedLength(envelope),
    coreInputCharacters: serializedLength(coreInput),
    projectSettingsCharacters: serializedLength(projectSettings),
    workspaceCatalogCharacters: serializedLength(workspaceCatalog),
    readEvidenceCharacters: serializedLength(readEvidence),
    readEvidenceCount: Array.isArray(readEvidence) ? readEvidence.length : 0,
    visibleEvidenceCharacters: serializedLength(fullInput.readEvidence),
    visibleEvidenceCount: Array.isArray(fullInput.readEvidence) ? fullInput.readEvidence.length : 0,
    deduplicatedEvidenceCharacters: Math.max(
      0,
      serializedLength(fullInput.readEvidence) - serializedLength(readEvidence),
    ),
    retrievalGapCharacters: serializedLength(retrievalGaps),
    retrievalGapCount: Array.isArray(retrievalGaps) ? retrievalGaps.length : 0,
    artifactCharacters: serializedLength(artifacts),
    artifactCount: typeof artifacts === "object" && artifacts !== null && !Array.isArray(artifacts)
      ? Object.keys(artifacts).length
      : 0,
    stageProjectionCharacters: serializedLength(stageProjection),
    stageProjectionKind: asRecord(stageProjection).kind,
    stageProjectionDigest: asRecord(stageProjection).projectionDigest,
  }
}

function comparePromptSnapshots(
  previous: PromptSnapshot | undefined,
  current: PromptSnapshot,
): Record<string, unknown> {
  if (previous === undefined) {
    return {
      previousPhase: undefined,
      commonPrefixCharacters: 0,
      commonPrefixRatio: 0,
      exactMessagePrefixCount: 0,
    }
  }
  const commonPrefixCharacters = countCommonPrefixCharacters(previous.serialized, current.serialized)
  let exactMessagePrefixCount = 0
  while (exactMessagePrefixCount < previous.messageDigests.length
    && exactMessagePrefixCount < current.messageDigests.length
    && previous.messageDigests[exactMessagePrefixCount] === current.messageDigests[exactMessagePrefixCount]) {
    exactMessagePrefixCount += 1
  }
  return {
    previousPhase: previous.phase,
    previousPromptCharacters: previous.serialized.length,
    commonPrefixCharacters,
    commonPrefixRatio: current.serialized.length === 0 ? 0 : commonPrefixCharacters / current.serialized.length,
    exactMessagePrefixCount,
  }
}

function countCommonPrefixCharacters(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

function serializedLength(value: unknown): number {
  if (value === undefined) return 0
  return JSON.stringify(value).length
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function ratio(numerator: number | undefined, denominator: number): number | undefined {
  if (numerator === undefined || denominator === 0) return undefined
  return numerator / denominator
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function nonEmptyReasoning(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim().length === 0 ? undefined : value
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) return true
  if (error instanceof TypeError) return true
  if (!(error instanceof OpenAI.APIError)) return false
  return error.status === 408
    || error.status === 409
    || error.status === 429
    || (error.status !== undefined && error.status >= 500)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
