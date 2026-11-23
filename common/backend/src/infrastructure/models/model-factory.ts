import { resolve } from "node:path"

import {
  deepSeekRuntimeConfigSchema,
  deepSeekRuntimeConfigFromEnvironment,
  defaultDeepSeekRuntimeConfig,
  type DeepSeekEnvironment,
} from "@starseafolio/config"

import type { AIModelPort } from "../../application/index.js"
import { AnthropicMessagesModelAdapter } from "./anthropic/anthropic-model-adapter.js"
import { EnvironmentSecretProvider, DeepSeekAiModelAdapter } from "./deepseek/deepseek-model-adapter.js"
import { FakeAiModelAdapter } from "./fake-ai-model-adapter.js"
import { UnavailableAiModelAdapter } from "./unavailable-ai-model-adapter.js"
import { NodePromptResourceAdapter, type PromptLibraryService } from "../prompts/index.js"

export type DeepSeekModelSelection = Readonly<{
  baseUrl: string
  model: string
  apiKey: string
  apiProtocol?: "openai_chat_completions" | "openai_responses" | "anthropic_messages"
  contextWindowTokens: number
  thinkingModeEnabled?: boolean
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  jsonModeEnabled?: boolean
  disableResponseStorage?: boolean
  serviceTier?: "auto" | "default" | "flex" | "priority" | "fast"
}>

export function createModelFromEnvironment(
  promptPackageRoot: string,
  values?: DeepSeekEnvironment,
): AIModelPort
export function createModelFromEnvironment(
  promptPackageRoot: string,
  promptLibrary: PromptLibraryService,
  values?: DeepSeekEnvironment,
): AIModelPort
export function createModelFromEnvironment(
  promptPackageRoot: string,
  promptLibraryOrValues?: PromptLibraryService | DeepSeekEnvironment,
  values: DeepSeekEnvironment = process.env,
): AIModelPort {
  const promptLibrary = isPromptLibrary(promptLibraryOrValues) ? promptLibraryOrValues : undefined
  const environment = promptLibrary === undefined && promptLibraryOrValues !== undefined
    ? promptLibraryOrValues as DeepSeekEnvironment
    : values
  if (environment.WORLDSEED_FAKE_MODEL?.trim() === "1") {
    return new FakeAiModelAdapter()
  }
  const config = deepSeekRuntimeConfigFromEnvironment(environment)
  if (config === undefined) return new UnavailableAiModelAdapter()

  const secrets = new EnvironmentSecretProvider(environment)
  const prompts = new NodePromptResourceAdapter(resolve(promptPackageRoot), promptLibrary)
  if (config.apiProtocol === "anthropic_messages") {
    return new AnthropicMessagesModelAdapter(config, secrets, prompts)
  }
  return new DeepSeekAiModelAdapter(config, secrets, prompts)
}

export function createModelFromSelection(
  promptPackageRoot: string,
  selection: DeepSeekModelSelection,
  promptLibrary: PromptLibraryService | undefined = undefined,
): AIModelPort {
  const apiKey = selection.apiKey.trim()
  if (apiKey.length === 0) throw new Error("DeepSeek API key is empty")
  const config = deepSeekRuntimeConfigSchema.parse({
    ...defaultDeepSeekRuntimeConfig,
    baseUrl: selection.baseUrl.trim(),
    model: selection.model.trim(),
    apiProtocol: selection.apiProtocol ?? defaultDeepSeekRuntimeConfig.apiProtocol,
    apiKeyRef: "turn-api-key",
    contextWindowTokens: selection.contextWindowTokens,
    thinkingModeEnabled: selection.thinkingModeEnabled ?? defaultDeepSeekRuntimeConfig.thinkingModeEnabled,
    reasoningEffort: selection.reasoningEffort ?? defaultDeepSeekRuntimeConfig.reasoningEffort,
    jsonModeEnabled: selection.jsonModeEnabled ?? defaultDeepSeekRuntimeConfig.jsonModeEnabled,
    disableResponseStorage: selection.disableResponseStorage ?? defaultDeepSeekRuntimeConfig.disableResponseStorage,
    serviceTier: selection.serviceTier ?? defaultDeepSeekRuntimeConfig.serviceTier,
  })
  const secrets = { getSecret: (reference: string) => Promise.resolve(reference === "turn-api-key" ? apiKey : "") }
  const prompts = new NodePromptResourceAdapter(resolve(promptPackageRoot), promptLibrary)
  if (config.apiProtocol === "anthropic_messages") {
    return new AnthropicMessagesModelAdapter(config, secrets, prompts)
  }
  return new DeepSeekAiModelAdapter(config, secrets, prompts)
}

function isPromptLibrary(value: PromptLibraryService | DeepSeekEnvironment | undefined): value is PromptLibraryService {
  return value !== undefined && typeof (value as PromptLibraryService).readOverride === "function"
}
