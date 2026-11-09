import { describe, expect, it } from "vitest"

import {
  buildTargetVolumeChapters,
  findFirstIncompleteVolume,
  isVolumeBatchComplete,
  isVolumeOutlineReady,
  parseVolumeBatchPlan,
  volumeBatchPlanPath,
  volumeArtifactWriteStatus,
  volumeOutlinePath,
} from "../src/features/editor/volume-batch-deduction.js"

describe("volumeOutlinePath", () => {
  it("builds flat outline path matching the volume folder name", () => {
    expect(volumeOutlinePath("第一卷 开局即仇敌")).toBe("大纲/第一卷 开局即仇敌.md")
  })
})

describe("volume batch plan", () => {
  it("parses persisted volume targets", () => {
    expect(volumeBatchPlanPath("第一卷 A")).toBe("大纲/第一卷 A.批量计划.md")
    expect(parseVolumeBatchPlan('```json\n{"volumeFolderName":"第一卷 A","targetChapterCount":8,"targetWordCount":24000}\n```'))
      .toEqual({ volumeFolderName: "第一卷 A", targetChapterCount: 8, targetWordCount: 24000, synopsisWriteCount: 0, outlineWriteCount: 0 })
    expect(parseVolumeBatchPlan("no plan")).toBeUndefined()
  })

  it("labels first writes and later updates distinctly", () => {
    expect(volumeArtifactWriteStatus(undefined)).toBe("待写入")
    expect(volumeArtifactWriteStatus(1)).toBe("首次写入")
    expect(volumeArtifactWriteStatus(3)).toBe("写入3次")
  })

  it("creates missing chapter slots and requires every target chapter body", () => {
    const existing = [
      { sequence: 1, label: "第一章", volumeFolderName: "第一卷 A", bodyPath: "1.md" },
      { sequence: 2, label: "第二章", volumeFolderName: "第一卷 A", bodyPath: "2.md" },
    ]
    expect(buildTargetVolumeChapters(existing, "第一卷 A", 4).map((chapter) => chapter.sequence))
      .toEqual([1, 2, 3, 4])
    expect(isVolumeBatchComplete(existing, "第一卷 A", 4)).toBe(false)
    expect(isVolumeBatchComplete([
      ...existing,
      { sequence: 3, label: "第三章", volumeFolderName: "第一卷 A", bodyPath: "3.md" },
      { sequence: 4, label: "第四章", volumeFolderName: "第一卷 A", bodyPath: "4.md" },
    ], "第一卷 A", 4)).toBe(true)
  })
})

describe("isVolumeOutlineReady", () => {
  it("requires chapter markers or enough structure", () => {
    expect(isVolumeOutlineReady("")).toBe(false)
    expect(isVolumeOutlineReady("# 大纲\n短")).toBe(false)
    expect(isVolumeOutlineReady([
      "# 第一卷 开局即仇敌",
      "",
      "主线：女主们觉醒记忆。",
      "",
      "## 第 1 章",
      "天道碎裂，主角逃亡。",
      "",
      "## 第 2 章",
      "顾家势力登场。",
    ].join("\n"))).toBe(true)
  })
})

describe("findFirstIncompleteVolume", () => {
  it("returns the first volume that still lacks a body", () => {
    const found = findFirstIncompleteVolume([
      {
        sequence: 1,
        label: "第一章",
        volumeFolderName: "第一卷 A",
        bodyPath: "章节正文/第一卷 A/第一章.md",
      },
      {
        sequence: 2,
        label: "第二章",
        volumeFolderName: "第一卷 A",
      },
      {
        sequence: 3,
        label: "第三章",
        volumeFolderName: "第二卷 B",
      },
    ])
    expect(found?.volumeFolderName).toBe("第一卷 A")
    expect(found?.chapters).toHaveLength(2)
  })
})
