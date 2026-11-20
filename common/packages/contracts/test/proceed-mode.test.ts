import { describe, expect, it } from "vitest"

import {
  DEFAULT_CUSTOM_PROCEED_GATES,
  resolveDiscussProceedMode,
  resolveProceedAutonomy,
  resolveProceedNextChapterAutonomy,
  synopsisConversationSendPayloadSchema,
  synopsisConversationSendResultSchema,
  synopsisConversationStreamSnapshotSchema,
} from "../src/index.js"

const projectId = "00000000-0000-4000-8000-000000000010"
const workspaceRootRef = "C:\\Worldseed\\Proceed"

describe("discuss proceed mode contracts", () => {
  it("defaults missing proceedMode to single and maps legacy batchProceed", () => {
    expect(resolveDiscussProceedMode({})).toBe("single")
    expect(resolveDiscussProceedMode({ batchProceed: true })).toBe("batch")
    expect(resolveDiscussProceedMode({ batchProceed: false })).toBe("precise")
    expect(resolveDiscussProceedMode({ proceedMode: "precise", batchProceed: true })).toBe("precise")
  })

  it("resolves per-stage autonomy for single / precise / batch / custom", () => {
    expect(resolveProceedAutonomy({ mode: "precise", stage: "synopsis_discuss" })).toBe(false)
    expect(resolveProceedAutonomy({ mode: "single", stage: "synopsis_discuss" })).toBe(true)
    expect(resolveProceedAutonomy({ mode: "single", stage: "body_discuss" })).toBe(false)
    expect(resolveProceedAutonomy({ mode: "single", stage: "chapter_requirements" })).toBe(false)
    expect(resolveProceedAutonomy({ mode: "batch", stage: "body_discuss" })).toBe(true)
    expect(resolveProceedAutonomy({
      mode: "custom",
      stage: "body_discuss",
      customGates: { ...DEFAULT_CUSTOM_PROCEED_GATES, body_discuss: true },
    })).toBe(true)
    expect(resolveProceedAutonomy({
      mode: "custom",
      stage: "body_discuss",
      customGates: { ...DEFAULT_CUSTOM_PROCEED_GATES, body_discuss: false },
    })).toBe(false)
    expect(resolveProceedAutonomy({
      mode: "batch",
      stage: "synopsis_discuss",
      agentMode: "plan",
    })).toBe(false)
  })

  it("only auto-continues next chapter in batch or fully-auto custom", () => {
    expect(resolveProceedNextChapterAutonomy({ mode: "single" })).toBe(false)
    expect(resolveProceedNextChapterAutonomy({ mode: "precise" })).toBe(false)
    expect(resolveProceedNextChapterAutonomy({ mode: "batch" })).toBe(true)
    expect(resolveProceedNextChapterAutonomy({
      mode: "custom",
      customGates: DEFAULT_CUSTOM_PROCEED_GATES,
    })).toBe(false)
    expect(resolveProceedNextChapterAutonomy({
      mode: "custom",
      customGates: {
        chapter_requirements: true,
        synopsis_discuss: true,
        outline_discuss: true,
        draft_discuss: true,
        body_discuss: true,
      },
    })).toBe(true)
  })

  it("accepts proceedMode on send payload and migrates legacy batchProceed", () => {
    const withMode = synopsisConversationSendPayloadSchema.parse({
      projectId,
      workspaceRootRef,
      message: "继续写第一章",
      proceedMode: "single",
    })
    expect(withMode.proceedMode).toBe("single")

    const legacy = synopsisConversationSendPayloadSchema.parse({
      projectId,
      workspaceRootRef,
      message: "继续写第一章",
      batchProceed: true,
    })
    expect(legacy.batchProceed).toBe(true)
    expect(resolveDiscussProceedMode(legacy)).toBe("batch")

    const custom = synopsisConversationSendPayloadSchema.parse({
      projectId,
      workspaceRootRef,
      message: "继续写第一章",
      proceedMode: "custom",
      customProceedGates: {
        ...DEFAULT_CUSTOM_PROCEED_GATES,
        body_discuss: true,
      },
    })
    expect(custom.customProceedGates?.body_discuss).toBe(true)
  })

  it("carries proceedProgress on stream snapshot and send result", () => {
    const stream = synopsisConversationStreamSnapshotSchema.parse({
      status: "running",
      updatedAtMs: 1,
      proceedProgress: { stage: "outline_discuss", status: "running" },
    })
    expect(stream.proceedProgress).toEqual({ stage: "outline_discuss", status: "running" })

    const result = synopsisConversationSendResultSchema.pick({ proceedProgress: true }).parse({
      proceedProgress: { stage: "body_discuss", status: "waiting" },
    })
    expect(result.proceedProgress?.status).toBe("waiting")
  })
})
