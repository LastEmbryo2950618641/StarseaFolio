import { describe, expect, it } from "vitest"

import {
  API_PROTOCOL_OPTIONS,
  OPENAI_WIRE_STYLE_OPTIONS,
  PROTOCOL_FAMILY_OPTIONS,
  apiProtocolFromFamily,
  createProfileFromPreset,
  openAIWireStyleOf,
  protocolFamilyOf,
  MODEL_PROVIDER_PRESETS,
} from "../src/features/settings/model-provider-presets.js"

describe("model provider presets", () => {
  it("exposes OpenAI/Anthropic family with OpenAI wire styles", () => {
    expect(PROTOCOL_FAMILY_OPTIONS.map((item) => item.value)).toEqual(["openai", "anthropic"])
    expect(OPENAI_WIRE_STYLE_OPTIONS.map((item) => item.value)).toEqual([
      "chat_completions",
      "responses",
    ])
    expect(API_PROTOCOL_OPTIONS.map((item) => item.value)).toEqual([
      "openai_chat_completions",
      "openai_responses",
      "anthropic_messages",
    ])
    expect(apiProtocolFromFamily("openai", "chat_completions")).toBe("openai_chat_completions")
    expect(apiProtocolFromFamily("openai", "responses")).toBe("openai_responses")
    expect(apiProtocolFromFamily("anthropic")).toBe("anthropic_messages")
    expect(protocolFamilyOf("anthropic_messages")).toBe("anthropic")
    expect(openAIWireStyleOf("openai_responses")).toBe("responses")
  })

  it("auto-fills differentiated vendor defaults without forcing JSON mode", () => {
    expect(MODEL_PROVIDER_PRESETS.map((item) => item.id)).toEqual([
      "deepseek",
      "zhipu",
      "openai",
      "anthropic",
      "custom",
    ])
    expect(createProfileFromPreset("deepseek")).toMatchObject({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiProtocol: "openai_chat_completions",
      thinkingModeEnabled: true,
      jsonModeEnabled: false,
    })
    expect(createProfileFromPreset("zhipu")).toMatchObject({
      name: "智谱",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiProtocol: "openai_chat_completions",
      thinkingModeEnabled: false,
      jsonModeEnabled: false,
    })
    expect(createProfileFromPreset("openai")).toMatchObject({
      apiProtocol: "openai_responses",
      jsonModeEnabled: false,
    })
    expect(createProfileFromPreset("anthropic")).toMatchObject({
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiProtocol: "anthropic_messages",
      model: "claude-sonnet-4-5",
      thinkingModeEnabled: true,
      jsonModeEnabled: false,
    })
    expect(createProfileFromPreset("custom")).toMatchObject({
      name: "自定义服务",
      baseUrl: "",
      apiProtocol: "openai_chat_completions",
      thinkingModeEnabled: false,
      jsonModeEnabled: false,
      hasApiKey: false,
      apiKey: "",
    })
  })
})
