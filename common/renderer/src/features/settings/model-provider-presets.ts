export type ModelProfile = Readonly<{
  id: string
  name: string
  baseUrl: string
  model: string
  credentialRef: string
  apiProtocol: "openai_chat_completions" | "openai_responses" | "anthropic_messages"
  contextWindowTokens: number
  apiKey: string
  hasApiKey: boolean
  thinkingModeEnabled: boolean
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  jsonModeEnabled: boolean
  disableResponseStorage: boolean
  serviceTier: "auto" | "default" | "flex" | "priority" | "fast"
}>

export type ModelApiProtocol = ModelProfile["apiProtocol"]
export type ModelProtocolFamily = "openai" | "anthropic"
export type OpenAIWireStyle = "chat_completions" | "responses"

export type ModelProviderPresetId = "deepseek" | "zhipu" | "openai" | "anthropic" | "custom"

export type ModelProviderPreset = Readonly<{
  id: ModelProviderPresetId
  name: string
  description: string
  defaults: Readonly<{
    name: string
    baseUrl: string
    model: string
    apiProtocol: ModelApiProtocol
    contextWindowTokens: number
    thinkingModeEnabled: boolean
    reasoningEffort: ModelProfile["reasoningEffort"]
    jsonModeEnabled: boolean
    disableResponseStorage: boolean
    serviceTier: ModelProfile["serviceTier"]
  }>
  highlights: readonly string[]
}>

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "官方 API；支持深度思考与模型列表自动拉取",
    defaults: {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "",
      apiProtocol: "openai_chat_completions",
      contextWindowTokens: 1_000_000,
      thinkingModeEnabled: true,
      reasoningEffort: "high",
      jsonModeEnabled: false,
      disableResponseStorage: true,
      serviceTier: "auto",
    },
    highlights: ["OpenAI 协议族 · Chat Completions", "深度思考", "JSON Mode 可选"],
  },
  {
    id: "zhipu",
    name: "智谱",
    description: "智谱 BigModel OpenAI 兼容接口（GLM）",
    defaults: {
      name: "智谱",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash",
      apiProtocol: "openai_chat_completions",
      contextWindowTokens: 128_000,
      thinkingModeEnabled: false,
      reasoningEffort: "none",
      jsonModeEnabled: false,
      disableResponseStorage: true,
      serviceTier: "auto",
    },
    highlights: ["OpenAI 协议族 · Chat Completions", "默认关闭深度思考", "JSON Mode 可选"],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "官方 OpenAI；默认 Responses，可改 Chat Completions",
    defaults: {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5",
      apiProtocol: "openai_responses",
      contextWindowTokens: 1_000_000,
      thinkingModeEnabled: true,
      reasoningEffort: "high",
      jsonModeEnabled: false,
      disableResponseStorage: true,
      serviceTier: "auto",
    },
    highlights: ["OpenAI 协议族 · Responses（可改）", "深度思考", "JSON Mode 可选"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "官方 Claude Messages API",
    defaults: {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      apiProtocol: "anthropic_messages",
      contextWindowTokens: 200_000,
      thinkingModeEnabled: true,
      reasoningEffort: "high",
      jsonModeEnabled: false,
      disableResponseStorage: true,
      serviceTier: "auto",
    },
    highlights: ["Anthropic Messages", "Extended Thinking 可选", "JSON Mode 默认关闭"],
  },
  {
    id: "custom",
    name: "自定义",
    description: "任意兼容服务；填好 Key 与地址即可，可改 OpenAI / Anthropic",
    defaults: {
      name: "自定义服务",
      baseUrl: "",
      model: "",
      apiProtocol: "openai_chat_completions",
      contextWindowTokens: 128_000,
      thinkingModeEnabled: false,
      reasoningEffort: "none",
      jsonModeEnabled: false,
      disableResponseStorage: true,
      serviceTier: "auto",
    },
    highlights: ["先选厂商协议族", "仅需 API Key 即可保存有效配置", "JSON Mode 默认关闭"],
  },
]

export function createProfileFromPreset(presetId: ModelProviderPresetId): ModelProfile {
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.id === presetId) ?? MODEL_PROVIDER_PRESETS[4]!
  return {
    id: crypto.randomUUID(),
    credentialRef: `model-profile:${crypto.randomUUID()}`,
    apiKey: "",
    hasApiKey: false,
    ...preset.defaults,
  }
}

export function protocolFamilyOf(protocol: ModelApiProtocol): ModelProtocolFamily {
  return protocol === "anthropic_messages" ? "anthropic" : "openai"
}

export function openAIWireStyleOf(protocol: ModelApiProtocol): OpenAIWireStyle {
  return protocol === "openai_responses" ? "responses" : "chat_completions"
}

export function apiProtocolFromFamily(
  family: ModelProtocolFamily,
  wireStyle: OpenAIWireStyle = "chat_completions",
): ModelApiProtocol {
  if (family === "anthropic") return "anthropic_messages"
  return wireStyle === "responses" ? "openai_responses" : "openai_chat_completions"
}

export const PROTOCOL_FAMILY_OPTIONS = [
  {
    value: "openai" as const,
    label: "OpenAI",
    hint: "OpenAI 及兼容服务（DeepSeek / 智谱等）",
  },
  {
    value: "anthropic" as const,
    label: "Anthropic",
    hint: "Claude Messages API",
  },
] as const

export const OPENAI_WIRE_STYLE_OPTIONS = [
  {
    value: "chat_completions" as const,
    label: "Chat Completions",
    hint: "广泛兼容 DeepSeek / 智谱 / 多数中转",
  },
  {
    value: "responses" as const,
    label: "Responses",
    hint: "OpenAI Responses 及同能力兼容服务",
  },
] as const

/** @deprecated Prefer PROTOCOL_FAMILY_OPTIONS + OPENAI_WIRE_STYLE_OPTIONS */
export const API_PROTOCOL_OPTIONS = [
  {
    value: "openai_chat_completions" as const,
    label: "Chat Completions",
    hint: "广泛兼容 DeepSeek / 智谱 / 多数中转",
  },
  {
    value: "openai_responses" as const,
    label: "Responses",
    hint: "OpenAI Responses 及同能力兼容服务",
  },
  {
    value: "anthropic_messages" as const,
    label: "Anthropic Messages",
    hint: "Claude Messages API",
  },
] as const
