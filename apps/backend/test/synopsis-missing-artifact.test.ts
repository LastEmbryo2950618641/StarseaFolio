import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION } from "@worldseed/contracts"

import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { serializeVolumePlanningState } from "../src/application/chapters/volume-planning-gate.js"
import { confirmedVolumeStorylineFixture, openChapterHarness, prepareChapterPlanning } from "./helpers/chapter-coordination-harness.js"

describe("synopsis discuss missing artifact recovery", () => {
  it.each(["missing_artifact", "repeated_contract_failure", "recovered_contract"] as const)("bounds %s with the actual service and repositories", async (mode) => {
    let calls = 0
    const model: AIModelPort = {
      info: { provider: "test", model: "contract-retry", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        calls += 1
        if (mode === "repeated_contract_failure" || (mode === "recovered_contract" && calls < 3)) {
          throw new Error("phase contract: toolRequest 不可与章节写入同回")
        }
        synopsisConversationStreamHub.setTodos(request.projectId,
          [{ id: "check", content: "检查设定索引", status: "completed" }], Date.now())
        return {
          result: {
            schemaVersion: 1, envelopeId: request.envelopeId, contextId: request.contextId, phase: request.phase,
            outcome: "continue", requestedReads: [], citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [], decisionRecordIds: [], unresolvedDependencies: [], reason: "Regression", selfReview: "Regression",
            ...(mode === "missing_artifact" && calls === 1 ? {} : { artifact: {
              assistantMessage: "已根据设定索引整理第一章方向。", finalSelfReview: "Recovered after contract repair.",
              choices: [{ label: "继续完善当前规划", action: "continue_discuss" }],
            } }),
          },
          usage: { inputTokens: 100, outputTokens: 20, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Contract retries", { model })
    try {
      await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.批量计划.md",
        serializeVolumePlanningState({ volumeFolderName: "第一卷 待命名", startSequence: 1,
          ...confirmedVolumeStorylineFixture,
          targetChapterCount: 8, targetWordCount: 24000, synopsisWriteCount: 1, outlineWriteCount: 1 }))
      await prepareChapterPlanning(harness)
      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "synopsis.conversation.send",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef,
          message: "检查设定索引", maxModelCalls: 12 },
      })
      if (mode === "repeated_contract_failure") {
        expect(response.ok).toBe(false)
        if (!response.ok) expect(response.error.message).toMatch(/model_contract.*3.*停止/)
        expect(calls).toBe(3)
      } else {
        expect(response.ok).toBe(true)
        expect(calls).toBe(mode === "missing_artifact" ? 2 : 3)
      }
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
