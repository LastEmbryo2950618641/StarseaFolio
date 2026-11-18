import { describe, expect, it } from "vitest"
import { modelApiProtocolSchema } from "@starseafolio/contracts"

describe("modelApiProtocolSchema", () => {
  it("accepts legacy OpenAI values and anthropic_messages", () => {
    expect(modelApiProtocolSchema.parse("openai_chat_completions")).toBe("openai_chat_completions")
    expect(modelApiProtocolSchema.parse("openai_responses")).toBe("openai_responses")
    expect(modelApiProtocolSchema.parse("anthropic_messages")).toBe("anthropic_messages")
  })

  it("rejects unknown protocols", () => {
    expect(() => modelApiProtocolSchema.parse("gemini")).toThrow()
  })
})
