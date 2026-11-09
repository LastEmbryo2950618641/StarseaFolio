import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { defaultDeepSeekRuntimeConfig } from "@worldseed/config"
import { PROTOCOL_VERSION, type BackendMethod, type ChapterRevisionReadResult, type RevisionDraftVersion } from "@worldseed/contracts"
import { describe, expect, it } from "vitest"

import { DeepSeekAiModelAdapter, NodePromptResourceAdapter } from "../src/index.js"
import { openChapterHarness, prepareChapterPlanning } from "./helpers/chapter-coordination-harness.js"

describe("chapter review schema repair", () => {
  it.each([
    { name: "repairs an invalid response before saving the review", invalidResponses: 1, maxModelCalls: undefined, succeeds: true, calls: 2 },
    { name: "stops after the bounded default repair attempts", invalidResponses: Infinity, maxModelCalls: undefined, succeeds: false, calls: 3 },
    { name: "respects an explicit one-call budget", invalidResponses: 1, maxModelCalls: 1, succeeds: false, calls: 1 },
  ])("$name", async ({ invalidResponses, maxModelCalls, succeeds, calls }) => {
    let requests = 0
    const model = new DeepSeekAiModelAdapter(defaultDeepSeekRuntimeConfig,
      { getSecret: () => Promise.resolve("test-key") },
      new NodePromptResourceAdapter(fileURLToPath(new URL("../../../common/packages/prompt-contracts/", import.meta.url))),
      { complete: async () => ({
        content: JSON.stringify({
          outcome: "continue",
          requestedReads: [],
          citedReadIds: [],
          unresolvedDependencies: [],
          reason: "Checked the submitted draft.",
          selfReview: "Only the supplied chapter was reviewed.",
          artifact: ++requests <= invalidResponses ? {} : {
            issues: [],
            recommendation: "no_issue",
            finalSelfReview: "No continuity conflicts in the supplied draft.",
          },
        }),
      }) },
    )
    const harness = await openChapterHarness("Review schema recovery", { model })
    const call = async <T>(method: BackendMethod, payload = {}): Promise<T> => {
      const response = await harness.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method,
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef, ...payload } })
      if (!response.ok) throw new Error(response.error.message)
      return response.data as T
    }
    try {
      await prepareChapterPlanning(harness)
      const draft = await call<RevisionDraftVersion>("chapter.draft.start", {
        chapterSequence: 1, heading: "第一章 雨夜旧站台", body: "雨停之前，他提起灯，走向站台。", source: "agent",
      })
      const review = call<ChapterRevisionReadResult>("chapter.reviewRevision", {
        revisionTaskId: draft.revisionTaskId,
        ...(maxModelCalls === undefined ? {} : { maxModelCalls }),
      })
      if (succeeds) await expect(review).resolves.toMatchObject({ review: { recommendation: "no_issue", issues: [] } })
      else await expect(review).rejects.toThrow("could not satisfy the phase contract")
      expect(requests).toBe(calls)
      const persisted = await call<ChapterRevisionReadResult>("chapter.readRevision", { revisionTaskId: draft.revisionTaskId })
      expect(persisted.proposedBody).toContain("雨停之前，他提起灯，走向站台。")
      if (succeeds) expect(persisted.review?.recommendation).toBe("no_issue")
      else {
        expect(persisted.status).toBe("awaiting_user_decision")
        expect(persisted.review).toBeUndefined()
      }
    } finally {
      await harness.container.close()
      await rm(harness.root, { recursive: true, force: true })
    }
  }, 30_000)
})
