import { describe, expect, it } from "vitest"

import { COMPOSE_TAGS } from "@starseafolio/prompt-contracts"
import { runComposeTurn } from "../src/application/chapters/compose-runner.js"
import { composeProgressForEvent } from "../src/application/chapters/compose-stage.js"

describe("compose runner", () => {
  it("streams tags into stage events and returns a parsed artifact", async () => {
    const chunks = [
      `${COMPOSE_TAGS.synopsisStart}\n梗概\n${COMPOSE_TAGS.synopsisEnd}\n`,
      `<compose-outl`,
      `ine>\n细纲\n${COMPOSE_TAGS.outlineEnd}\n${COMPOSE_TAGS.draftStart}\n# 第一章\n正文\n${COMPOSE_TAGS.draftEnd}`,
    ]
    const stageEvents: string[] = []
    const result = await runComposeTurn({
      model: {
        execute: async (_request, options) => {
          for (const chunk of chunks) options?.onPartial?.({ contentDelta: chunk })
          return {
            result: { artifact: { assistantMessage: chunks.join("") } },
            usage: { inputTokens: 10, outputTokens: 20, latencyMs: 1 },
          } as never
        },
      },
      request: { phase: "synopsis_discuss" } as never,
      phasePrompt: { ref: "test", version: "v1", digest: "x", text: "compose" },
      onStage: (event) => {
        const progress = composeProgressForEvent(event)
        if (progress !== undefined) stageEvents.push(`${progress.stage}:${progress.status}`)
      },
    })
    expect(result.artifact.synopsisBody).toBe("梗概")
    expect(result.artifact.outlineBody).toBe("细纲")
    expect(result.artifact.chapterDraftProposal?.heading).toBe("第一章")
    expect(stageEvents).toEqual([
      "synopsis_discuss:running",
      "synopsis_discuss:done",
      "outline_discuss:running",
      "outline_discuss:done",
      "draft_discuss:running",
      "draft_discuss:done",
    ])
  })
})
