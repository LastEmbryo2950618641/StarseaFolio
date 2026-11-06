import { rmSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  incrementVolumePlanningWriteCount,
  parseVolumePlanningState,
  serializeVolumePlanningState,
  volumePlanningGateReady,
} from "../src/application/chapters/volume-planning-gate.js"
import { digest } from "../src/core/identity/digest.js"
import { SqliteCreativeSetupRepository } from "../src/infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import { openProjectDatabase } from "../src/infrastructure/sqlite/sqlite-database.js"
import { confirmedVolumeStorylineFixture, openChapterHarness, prepareChapterPlanning } from "./helpers/chapter-coordination-harness.js"

describe("volume planning first-write gate", () => {
  it("stays blocked until targets, synopsis and outline have recorded first writes", () => {
    expect(volumePlanningGateReady(undefined)).toBe(false)
    const state = {
      ...confirmedVolumeStorylineFixture,
      volumeFolderName: "第一卷 A",
      startSequence: 1,
      targetChapterCount: 8,
      targetWordCount: 24000,
      synopsisWriteCount: 1,
      outlineWriteCount: 0,
    }
    expect(volumePlanningGateReady(state)).toBe(false)
    expect(volumePlanningGateReady({ ...state, outlineWriteCount: 1 })).toBe(true)
  })

  it("increments only the successfully written planning artifact and round-trips persisted state", () => {
    const initial = {
      ...confirmedVolumeStorylineFixture,
      volumeFolderName: "第一卷 A",
      startSequence: 1,
      targetChapterCount: 8,
      targetWordCount: 24000,
      synopsisWriteCount: 0,
      outlineWriteCount: 0,
    }
    const synopsisWritten = incrementVolumePlanningWriteCount(initial, "synopsis")
    const ready = incrementVolumePlanningWriteCount(synopsisWritten, "outline")
    expect(synopsisWritten.synopsisWriteCount).toBe(1)
    expect(synopsisWritten.outlineWriteCount).toBe(0)
    expect(parseVolumePlanningState(serializeVolumePlanningState(ready))).toEqual(ready)
    expect(volumePlanningGateReady(ready)).toBe(true)
  })

  it("keeps legacy first-write counters blocked until the user explicitly confirms the storyline", () => {
    const legacy = {
      volumeFolderName: "第一卷 A", startSequence: 1, targetChapterCount: 8, targetWordCount: 24000,
      synopsisWriteCount: 1, outlineWriteCount: 1,
    }
    expect(volumePlanningGateReady(legacy)).toBe(false)
    expect(volumePlanningGateReady({ ...legacy, storyline: confirmedVolumeStorylineFixture.storyline })).toBe(false)
    expect(volumePlanningGateReady({ ...legacy, ...confirmedVolumeStorylineFixture })).toBe(true)
  })
})

describe("chapter harness creative setup fixtures", () => {
  it("persists both answered interviews and actual Markdown while leaving style and volume first writes closed", async () => {
    const harness = await openChapterHarness("Answered interview fixture", { workStyleGateReady: false })
    try {
      const database = await openProjectDatabase(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        const repository = new SqliteCreativeSetupRepository(database)
        for (const scope of ["protagonist", "volume:第一卷 待命名"]) {
          const state = await repository.find(harness.projectId, scope)
          expect(state?.status).toBe("ready")
          expect(state?.pendingQuestion).toBeUndefined()
          if (state?.settingsPath === undefined) throw new Error(`Missing fixture write: ${scope}`)
          const markdown = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, state.settingsPath)
          expect(state.settingsDigest).toBe(digest(markdown))
          for (const answer of Object.values(state.answers)) expect(markdown).toContain(answer)
        }
      } finally {
        await database.destroy()
      }
      const markdown = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, "大纲/第一卷 待命名.批量计划.md")
      const plan = parseVolumePlanningState(markdown)
      expect(plan).toMatchObject({
        targetChapterCount: 0, targetWordCount: 0, synopsisWriteCount: 0, outlineWriteCount: 0,
        ...confirmedVolumeStorylineFixture,
      })
      expect(volumePlanningGateReady(plan)).toBe(false)
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Fixture runtime was not opened")
      await expect(runtime.assertWorkStyleGateReady()).rejects.toThrow("作品风格门禁尚未通过")
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("leaves both persisted interviews absent when creativeSetupReady is false", async () => {
    const harness = await openChapterHarness("Fresh creative setup fixture", { creativeSetupReady: false })
    try {
      const database = await openProjectDatabase(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        const repository = new SqliteCreativeSetupRepository(database)
        expect(await repository.find(harness.projectId, "protagonist")).toBeUndefined()
        expect(await repository.find(harness.projectId, "volume:第一卷 待命名")).toBeUndefined()
      } finally {
        await database.destroy()
      }
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Fixture runtime was not opened")
      await expect(runtime.assertVolumePlanningGateReady(1)).rejects.toThrow("主角罗盘门禁未通过")
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("prepares real volume synopsis and outline first writes for chapter revision fixtures", async () => {
    const harness = await openChapterHarness("Prepared planning fixture")
    try {
      await prepareChapterPlanning(harness)
      const plan = parseVolumePlanningState(await harness.container.workspace.readMarkdown(
        harness.workspaceRootRef, "大纲/第一卷 待命名.批量计划.md"))
      expect(plan).toMatchObject({
        targetChapterCount: 8, targetWordCount: 24000, synopsisWriteCount: 1, outlineWriteCount: 1,
        ...confirmedVolumeStorylineFixture,
      })
      expect(volumePlanningGateReady(plan)).toBe(true)
      for (const path of ["大纲/第一卷 待命名.梗概.md", "大纲/第一卷 待命名.md"]) {
        expect(await harness.container.workspace.readMarkdown(harness.workspaceRootRef, path)).toContain("旧站台")
      }
      const runtime = harness.container.getCurrentRuntime()
      if (runtime === undefined) throw new Error("Fixture runtime was not opened")
      await expect(runtime.assertVolumePlanningGateReady(1)).resolves.toBeUndefined()
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
