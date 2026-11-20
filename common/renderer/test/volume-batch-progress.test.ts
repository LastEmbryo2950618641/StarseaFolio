import { describe, expect, it } from "vitest"

import {
  buildVolumeBatchProgress,
  PUBLISHING_REVISION_STATUSES,
  volumeBatchProgressStageLabel,
} from "../src/features/editor/volume-batch-deduction.js"

describe("volume batch progress", () => {
  const chapters = [
    { sequence: 1, label: "第一章", bodyPath: "章节正文/卷一/第一章.md" },
    { sequence: 2, label: "第二章", bodyPath: "章节正文/卷一/第二章.md" },
    { sequence: 3, label: "第三章", outlinePath: "章节正文/卷一/第三章 [剧情细纲].md" },
    { sequence: 4, label: "第四章" },
  ]

  it("prefers body on disk over stale publishing flags", () => {
    const rows = buildVolumeBatchProgress(chapters, new Set([3]), new Set([2]))
    expect(rows.map((row) => row.stage)).toEqual(["body", "body", "draft", "empty"])
    expect(rows.filter((row) => row.done)).toHaveLength(2)
    expect(volumeBatchProgressStageLabel("publishing")).toBe("章节入库中")
  })

  it("marks chapters without body as publishing while ingest runs", () => {
    const rows = buildVolumeBatchProgress(
      [
        { sequence: 1, label: "第一章" },
        { sequence: 2, label: "第二章", outlinePath: "章节正文/卷一/第二章 [剧情细纲].md" },
      ],
      new Set([2]),
      new Set([1]),
    )
    expect(rows.map((row) => row.stage)).toEqual(["publishing", "draft"])
  })

  it("treats graph sync statuses as publishing", () => {
    expect(PUBLISHING_REVISION_STATUSES.has("graph_sync_pending")).toBe(true)
    expect(PUBLISHING_REVISION_STATUSES.has("editing")).toBe(false)
  })
})
