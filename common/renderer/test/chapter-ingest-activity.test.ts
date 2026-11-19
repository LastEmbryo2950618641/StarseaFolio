import { describe, expect, it } from "vitest"
import type { GraphRevisionTask } from "@starseafolio/contracts"

import {
  formatChapterIngestDetail,
  resolveChapterIngestActivity,
} from "../src/features/status/chapter-ingest-activity.js"

function taskFixture(overrides: Partial<GraphRevisionTask> = {}): GraphRevisionTask {
  return {
    revisionTaskId: "revision-1",
    chapterId: "chapter-19",
    heading: "第十九章",
    status: "running",
    blocksTurn: true,
    canCancel: true,
    canRetry: false,
    canContinue: false,
    updatedAtMs: 2,
    progress: {
      phase: "graph_governance",
      completed: 2,
      total: 8,
      phases: [
        { phase: "settings_extraction", status: "completed", attempt: 1 },
        { phase: "work_style_revision", status: "completed", attempt: 1 },
        { phase: "graph_governance", status: "running", attempt: 1 },
      ],
    },
    ...overrides,
  }
}

describe("chapter-ingest-activity", () => {
  it("maps a running revision into chapter_ingest display fields", () => {
    const activity = resolveChapterIngestActivity(taskFixture())
    expect(activity).toEqual({
      heading: "第十九章",
      phaseLabel: "准备修订与证据",
      current: 3,
      total: 8,
    })
    expect(formatChapterIngestDetail(activity!)).toBe("准备修订与证据 · 3/8 · 第十九章")
  })

  it("ignores finished revision tasks", () => {
    expect(resolveChapterIngestActivity(taskFixture({ status: "completed" }))).toBeUndefined()
  })
})
