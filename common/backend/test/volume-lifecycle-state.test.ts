import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  isVolumeChapterCapReached,
  isVolumeStarted,
  nextVolumeFolderName,
  parseVolumeLifecycleState,
  readVolumeLifecycleState,
  saveVolumeLifecycleState,
  serializeVolumeLifecycleState,
  transitionVolumeLifecycle,
  volumeLifecycleStatePath,
  type VolumeLifecycleState,
  type VolumeLifecycleTransition,
} from "../src/application/chapters/volume-lifecycle-state.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"

const volumeFolderName = "第一卷 起点"
const started = { volumeFolderName, startedAtMs: 0 }
const ended = { ...started, endedAtMs: 10 }
const revised = { ...ended, revisionStartedAtMs: 20 }

function fenced(value: unknown): string {
  return "```json\n" + JSON.stringify(value) + "\n```"
}

function apply(action: VolumeLifecycleTransition["action"], atMs: number, state?: VolumeLifecycleState) {
  return transitionVolumeLifecycle(state, { volumeFolderName, action, atMs })
}

describe("volume lifecycle persistence", () => {
  it("round-trips each state through a single JSON fence, including CRLF Markdown", () => {
    for (const state of [started, ended, revised]) {
      expect(parseVolumeLifecycleState(serializeVolumeLifecycleState(state), volumeFolderName)).toEqual(state)
      expect(parseVolumeLifecycleState(serializeVolumeLifecycleState(state).replaceAll("\n", "\r\n"))).toEqual(state)
    }
  })

  it("rejects malformed, unrelated, and chronologically invalid states", () => {
    for (const value of [
      null, [], { volumeFolderName }, { ...started, volumeFolderName: "../卷" },
      { ...started, volumeFolderName: "第0卷 占位" }, { ...started, startedAtMs: -1 },
      { ...started, startedAtMs: 1.5 }, { ...started, startedAtMs: "0" }, { ...started, endedAtMs: null },
      { ...ended, startedAtMs: 11 }, { ...started, revisionStartedAtMs: 20 },
      { ...revised, revisionStartedAtMs: 9 }, { ...started, startSequence: 1 },
    ]) {
      expect(parseVolumeLifecycleState(fenced(value))).toBeUndefined()
    }
    expect(parseVolumeLifecycleState("```json\n{\n```")).toBeUndefined()
    expect(parseVolumeLifecycleState(`${fenced(started)}\n${fenced(ended)}`)).toBeUndefined()
    expect(parseVolumeLifecycleState(fenced(started), "第二卷 终点")).toBeUndefined()
    expect(() => serializeVolumeLifecycleState({ ...started, revisionStartedAtMs: 20 })).toThrow()
    expect(() => volumeLifecycleStatePath("第一卷 ../起点")).toThrow()
  })

  it("persists workspace Markdown independently for each volume and leaves the planning file intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "volume-lifecycle-"))
    try {
      const workspace = new NodeWorkspaceAdapter()
      const other = { volumeFolderName: "第二卷 终点", startedAtMs: 30 }
      const planPath = `大纲/${volumeFolderName}.批量计划.md`
      await workspace.saveUserMarkdown(root, planPath, "Existing planning data")
      expect(await readVolumeLifecycleState(workspace, root, volumeFolderName)).toBeUndefined()
      await saveVolumeLifecycleState(workspace, root, revised)
      await saveVolumeLifecycleState(workspace, root, other)
      const reopened = new NodeWorkspaceAdapter()
      expect(await readVolumeLifecycleState(reopened, root, volumeFolderName)).toEqual(revised)
      expect(await readVolumeLifecycleState(reopened, root, other.volumeFolderName)).toEqual(other)
      expect(await reopened.readMarkdown(root, planPath)).toBe("Existing planning data")
      const lifecyclePath = volumeLifecycleStatePath(volumeFolderName)
      expect(lifecyclePath).toBe("大纲/第一卷 起点.卷状态.md")
      await reopened.saveUserMarkdown(root, lifecyclePath, serializeVolumeLifecycleState(other))
      await expect(readVolumeLifecycleState(reopened, root, volumeFolderName)).rejects.toThrow("不属于当前卷")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("surfaces storage errors other than missing files", async () => {
    const error = Object.assign(new Error("Workspace read failed"), { code: "EACCES" })
    const workspace = { readMarkdown: vi.fn().mockRejectedValue(error) }
    await expect(readVolumeLifecycleState(workspace, "workspace", volumeFolderName)).rejects.toBe(error)
  })
})

describe("volume lifecycle rules", () => {
  it("explicitly starts, ends, and begins revision once while preserving prior milestones", () => {
    expect(apply("start", 0)).toEqual(started)
    expect(apply("end", 10, started)).toEqual(ended)
    expect(apply("revise", 20, ended)).toEqual(revised)
    expect(apply("start", 1, started)).toBeUndefined()
    expect(apply("end", 1)).toBeUndefined()
    expect(apply("end", 11, ended)).toBeUndefined()
    expect(apply("revise", 1, started)).toBeUndefined()
    expect(apply("revise", 9, ended)).toBeUndefined()
    expect(apply("revise", 21, revised)).toBeUndefined()
    expect(apply("end", 10, { ...started, volumeFolderName: "第二卷 终点" })).toBeUndefined()
  })

  it("uses setup and real plan or chapter evidence only to recognize a legacy start", () => {
    const evidence = { setupReady: true, planningReady: false, hasExistingChapters: false }
    const historicalPlan = { ...evidence, planningReady: true }
    const historicalChapter = { ...evidence, hasExistingChapters: true }
    expect(isVolumeStarted(undefined, evidence)).toBe(false)
    expect(isVolumeStarted(undefined, historicalPlan)).toBe(true)
    expect(isVolumeStarted(undefined, historicalChapter)).toBe(true)
    expect(isVolumeStarted(undefined, { ...historicalChapter, setupReady: false })).toBe(false)
    expect(isVolumeStarted(started)).toBe(true)
    expect(transitionVolumeLifecycle(undefined, { volumeFolderName, action: "revise", atMs: 10, legacyStarted: true })).toBeUndefined()
    expect(transitionVolumeLifecycle(undefined, { volumeFolderName, action: "end", atMs: 10, legacyStarted: true }))
      .toEqual({ volumeFolderName, startedAtMs: 10, endedAtMs: 10 })
  })

  it("allows the final planned chapter and detects the cap for the next one", () => {
    const plan = { startSequence: 9, targetChapterCount: 3 }
    expect(isVolumeChapterCapReached(plan, 11)).toBe(false)
    expect(isVolumeChapterCapReached(plan, 12)).toBe(true)
    expect(isVolumeChapterCapReached(plan, 25)).toBe(true)
    expect(isVolumeChapterCapReached(undefined, 12)).toBe(false)
    expect(isVolumeChapterCapReached({ ...plan, targetChapterCount: 0 }, 12)).toBe(false)
    expect(isVolumeChapterCapReached(plan, 12.5)).toBe(false)
  })

  it("uses the immediate next ordinal and reuses its existing title deterministically", () => {
    expect(nextVolumeFolderName(volumeFolderName, ["第三卷 Later"])).toBe("第二卷 待命名")
    expect(nextVolumeFolderName(volumeFolderName, ["第三卷 Later", "第2卷 Named"])).toBe("第2卷 Named")
    const duplicates = ["第二卷 B", "第二卷 A"]
    expect(nextVolumeFolderName(volumeFolderName, duplicates)).toBe("第二卷 A")
    expect(nextVolumeFolderName(volumeFolderName, [...duplicates].reverse())).toBe("第二卷 A")
    expect(nextVolumeFolderName("第九十九卷 Before", [])).toBe("第100卷 待命名")
    expect(() => nextVolumeFolderName("Bad name", [])).toThrow()
  })
})
