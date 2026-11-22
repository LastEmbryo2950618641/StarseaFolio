import { randomUUID } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { PROTOCOL_VERSION } from "@starseafolio/contracts"
import { siblingPlanningMarkdownPath } from "../src/core/chapters/synopsis-path.js"
import { openChapterHarness, prepareChapterPlanning } from "./helpers/chapter-coordination-harness.js"

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe("restageChapter clears sibling outline", () => {
  it("removes outline beside synopsis", async () => {
    const harness = await openChapterHarness("Restage clears outline")
    temporaryRoots.push(harness.root)
    await prepareChapterPlanning(harness)
    const listed = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "synopsis.conversation.list",
      payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
    })
    if (!listed.ok) throw new Error(listed.error.message)
    const synopsisPath = (listed.data as { session: { synopsisPath: string; chapterSequence: number } }).session.synopsisPath
    const chapterSequence = (listed.data as { session: { chapterSequence: number } }).session.chapterSequence
    const outlinePath = siblingPlanningMarkdownPath(synopsisPath, "outline")!
    expect(existsSync(join(harness.workspaceRootRef, outlinePath))).toBe(true)

    const runtime = harness.container.getCurrentRuntime()
    if (runtime === undefined) throw new Error("no runtime")
    const result = await runtime.createChapterSynopsisService().restageChapter({
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
      chapterSequence,
      targetStage: "synopsis",
      reason: "test restage clears outline",
    })
    expect(result.clearedOutlinePath).toBeTruthy()
    expect(existsSync(join(harness.workspaceRootRef, outlinePath))).toBe(false)
    await harness.container.close()
  }, 20_000)
})
