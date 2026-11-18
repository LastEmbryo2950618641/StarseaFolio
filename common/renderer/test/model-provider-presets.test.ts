import { describe, expect, it } from "vitest"

import {
  API_PROTOCOL_OPTIONS,
  createProfileFromPreset,
  MODEL_PROVIDER_PRESETS,
} from "../src/features/settings/model-provider-presets.js"

describe("model provider presets", () => {
  it("offers both API protocols for any vendor profile", () => {
    expect(API_PROTOCOL_OPTIONS.map((item) => item.value)).toEqual([
      "openai_chat_completions",
      "openai_responses",
    ])
    expect(API_PROTOCOL_OPTIONS.every((item) => item.label.includes("协议"))).toBe(true)
  })

  it("auto-fills differentiated vendor defaults without forcing JSON mode", () => {
    expect(MODEL_PROVIDER_PRESETS.map((item) => item.id)).toEqual([
      "deepseek",
      "zhipu",
      "openai",
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
