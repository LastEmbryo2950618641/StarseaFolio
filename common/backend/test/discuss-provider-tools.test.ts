import { describe, expect, it } from "vitest"

import { DISCUSS_PROVIDER_TOOL_NAMES, DISCUSS_PROVIDER_TOOLS } from "../src/application/chapters/discuss-provider-tools.js"

describe("discuss provider tools", () => {
  it("exposes every discuss tool with a valid provider schema", () => {
    expect(DISCUSS_PROVIDER_TOOLS).toHaveLength(DISCUSS_PROVIDER_TOOL_NAMES.length)
    for (const tool of DISCUSS_PROVIDER_TOOLS) {
      expect(tool.type).toBe("function")
      const parameters = tool.function.parameters as {
        required: readonly string[]
        properties: Record<string, unknown>
      }
      if (tool.function.name === "request_read") {
        expect(parameters.required).toContain("reads")
      } else {
        expect(parameters.required).toContain("action")
        expect((parameters.properties.arguments as { type: string }).type).toBe("string")
      }
    }
  })
})
