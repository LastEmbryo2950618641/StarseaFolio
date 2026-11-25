import { describe, expect, it } from "vitest"

import {
  AGENT_MEMORY_INDEX_MAX_BYTES,
  AGENT_MEMORY_INDEX_MAX_LINES,
  AGENT_MEMORY_INDEX_PATH,
  isAgentMemoryIndexPath,
  isAgentMemoryPath,
  resolveAgentMemoryTopicPath,
  truncateAgentMemoryIndex,
} from "../src/application/chapters/agent-memory.js"

describe("agent memory helpers", () => {
  it("recognizes Agent记忆 paths", () => {
    expect(isAgentMemoryPath(AGENT_MEMORY_INDEX_PATH)).toBe(true)
    expect(isAgentMemoryIndexPath(AGENT_MEMORY_INDEX_PATH)).toBe(true)
    expect(isAgentMemoryPath("提示词/系统记忆/系统提示词/preferences.md")).toBe(true)
    expect(isAgentMemoryPath("设定集/readme.md")).toBe(false)
  })

  it("resolves topic filenames under Agent记忆", () => {
    expect(resolveAgentMemoryTopicPath("preferences.md")).toBe("提示词/系统记忆/系统提示词/preferences.md")
    expect(resolveAgentMemoryTopicPath("提示词/系统记忆/系统提示词/纠错.md"))
      .toBe("提示词/系统记忆/系统提示词/纠错.md")
    expect(() => resolveAgentMemoryTopicPath("MEMORY.md")).toThrow(/不能覆盖 MEMORY/)
    expect(() => resolveAgentMemoryTopicPath("../逃逸.md")).toThrow()
    expect(() => resolveAgentMemoryTopicPath("nested/file.md")).toThrow(/单层/)
  })

  it("truncates oversized MEMORY.md indexes", () => {
    const lines = Array.from({ length: AGENT_MEMORY_INDEX_MAX_LINES + 20 }, (_, index) => `- item ${String(index)}`)
    const result = truncateAgentMemoryIndex(["# index", "", ...lines].join("\n"))
    expect(result.truncated).toBe(true)
    expect(result.text.split("\n").length).toBeLessThanOrEqual(AGENT_MEMORY_INDEX_MAX_LINES + 3)
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(AGENT_MEMORY_INDEX_MAX_BYTES + 200)
  })
})
