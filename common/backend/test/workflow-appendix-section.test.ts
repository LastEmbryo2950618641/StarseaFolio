import { describe, expect, it } from "vitest"

import { workflowAppendixSection } from "../src/application/turns/turn-orchestrator.js"

describe("workflow appendix selection", () => {
  it("injects only the active draft/source-retrieval workflow branch", () => {
    expect(workflowAppendixSection("draft", "query")).toBe("draft-query")
    expect(workflowAppendixSection("draft", "turn")).toBe("draft-write")
    expect(workflowAppendixSection("draft", "revision")).toBe("draft-write")
    expect(workflowAppendixSection("source_retrieval", "query")).toBe("source-query")
    expect(workflowAppendixSection("source_retrieval", "turn")).toBe("source-write")
    expect(workflowAppendixSection("source_retrieval", "synopsis")).toBe("source-write")
    expect(workflowAppendixSection("interpret", "query")).toBeUndefined()
    expect(workflowAppendixSection("settings_extraction", "turn")).toBeUndefined()
  })
})
