import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ChapterBrowseDetailRail, VolumePlanningInfo } from "../src/renderer/src/features/editor/ChapterBrowseDetailRail.js"
import {
  isVolumeBatchComplete,
  parseVolumeBatchPlan,
  parseVolumePlanInfo,
} from "../src/renderer/src/features/editor/volume-batch-deduction.js"

const storyline = {
  opening: "城门封锁，主角被迫接下护送任务。",
  climaxes: "第一次高潮：同伴身份暴露。\n第二次高潮：城楼决战。",
  ending: "主角救出同伴，却发现幕后主使已经离城。",
  subplots: "开场后：商队失踪。\n决战前：失踪商队带回关键证据。",
}
const confirmedAtMs = 1_793_923_200_000

function planMarkdown(overrides: Record<string, unknown> = {}): string {
  return `# 第一卷 风起\n\n\`\`\`json\n${JSON.stringify({
    volumeFolderName: "第一卷 风起",
    targetChapterCount: 8,
    targetWordCount: 24_000,
    synopsisWriteCount: 1,
    outlineWriteCount: 3,
    storyline,
    storylineConfirmedAtMs: confirmedAtMs,
    ...overrides,
  })}\n\`\`\``
}

describe("volume story planning", () => {
  it("retains confirmed story sections alongside numerical targets and write counters", () => {
    expect(parseVolumeBatchPlan(planMarkdown())).toEqual({
      volumeFolderName: "第一卷 风起",
      targetChapterCount: 8,
      targetWordCount: 24_000,
      synopsisWriteCount: 1,
      outlineWriteCount: 3,
      storyline,
      storylineConfirmedAtMs: confirmedAtMs,
    })
  })

  it("keeps zero-target plans out of batch execution even with a confirmation timestamp", () => {
    expect(parseVolumeBatchPlan(planMarkdown({ targetChapterCount: 0, targetWordCount: 0 })))
      .toBeUndefined()
    expect(isVolumeBatchComplete([], "第一卷 风起", 0)).toBe(false)
    expect(isVolumeBatchComplete([
      { sequence: 1, label: "第一章", volumeFolderName: "第一卷 风起", bodyPath: "第一章.md" },
    ], "第一卷 风起", 0)).toBe(false)
  })

  it("reads confirmed stories before numerical planning without inventing targets", () => {
    expect(parseVolumePlanInfo(planMarkdown({ targetChapterCount: 0, targetWordCount: 0 })))
      .toEqual({
        volumeFolderName: "第一卷 风起",
        targetChapterCount: 0,
        targetWordCount: 0,
        synopsisWriteCount: 1,
        outlineWriteCount: 3,
        storyline,
        storylineConfirmedAtMs: confirmedAtMs,
      })
  })

  it("keeps older plans without story confirmation readable", () => {
    expect(parseVolumePlanInfo(planMarkdown({ storyline: undefined, storylineConfirmedAtMs: undefined })))
      .toEqual({
        volumeFolderName: "第一卷 风起",
        targetChapterCount: 8,
        targetWordCount: 24_000,
        synopsisWriteCount: 1,
        outlineWriteCount: 3,
      })
  })

  it.each([null, [], "主线", {}, { ...storyline, opening: 1 }, { ...storyline, climaxes: [] },
    { ...storyline, ending: null }, { ...storyline, subplots: undefined }].map((value) => [value]))(
    "ignores malformed story sections without losing valid counters: %j",
    (invalidStoryline) => {
      const plan = parseVolumePlanInfo(planMarkdown({ storyline: invalidStoryline }))
      expect(plan?.storyline).toBeUndefined()
      expect(plan).toMatchObject({ targetChapterCount: 8, synopsisWriteCount: 1, outlineWriteCount: 3 })
    },
  )

  it.each([null, 0, -1, 1.5, "1793923200000", Number.MAX_SAFE_INTEGER + 1])(
    "ignores an invalid confirmation timestamp: %j",
    (storylineConfirmedAtMs) => {
      const plan = parseVolumePlanInfo(planMarkdown({ storylineConfirmedAtMs }))
      expect(plan?.storylineConfirmedAtMs).toBeUndefined()
      expect(plan?.storyline).toEqual(storyline)
    },
  )

  it.each([-1, 1.5, 51, "8", null])("rejects invalid chapter targets: %j", (targetChapterCount) => {
    expect(parseVolumePlanInfo(planMarkdown({ targetChapterCount }))).toBeUndefined()
    expect(parseVolumeBatchPlan(planMarkdown({ targetChapterCount }))).toBeUndefined()
  })

  it.each([undefined, "", "not JSON", "```json\n{broken}\n```", "```json\nnull\n```",
    "```json\n[]\n```", "```json\n8\n```"])("handles missing or malformed plan Markdown: %j", (markdown) => {
    expect(parseVolumePlanInfo(markdown)).toBeUndefined()
  })

  it("keeps the maximum target and start sequence for an executable plan", () => {
    expect(parseVolumeBatchPlan(planMarkdown({ targetChapterCount: 50, startSequence: 9 })))
      .toMatchObject({ targetChapterCount: 50, startSequence: 9 })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not complete a batch with an invalid target: %s",
    (targetChapterCount) => {
      expect(isVolumeBatchComplete([], "第一卷 风起", targetChapterCount)).toBe(false)
    },
  )

  it("shows pending human confirmation for a new volume in the info tab", () => {
    const html = renderToStaticMarkup(React.createElement(ChapterBrowseDetailRail, {
      projectId: "project",
      workspaceRootRef: "workspace",
      chapter: undefined,
      volume: { folderName: "第一卷 风起", chapters: [] },
      onOpenBody: vi.fn(),
    }))

    expect(html).toContain("待用户确认")
    expect(html).toContain('data-testid="volume-planning-status"')
    expect(html).toContain('data-testid="volume-detail-tab-info"')
    expect(html).toContain('data-testid="volume-detail-tab-synopsis"')
    expect(html).toContain('data-testid="volume-detail-tab-outline"')
    expect(html).not.toContain('data-testid="chapter-browse-volume-synopsis"')
    expect(html).not.toContain('data-testid="chapter-browse-volume-outline"')
    expect(html).not.toContain("用户已确认")
  })
})

function renderInfo(overrides: Record<string, unknown> = {}, publishedChapterCount = 2, wordCount = 6_200): string {
  return renderToStaticMarkup(React.createElement(VolumePlanningInfo, {
    plan: parseVolumePlanInfo(planMarkdown(overrides)),
    publishedChapterCount,
    wordCount,
    onOpenPlan: vi.fn(),
  }))
}

describe("volume info story display", () => {
  it("shows all confirmed sections as readable multiline text before numerical planning", () => {
    const html = renderInfo({ targetChapterCount: 0, targetWordCount: 0 })

    expect(html).toContain('data-status="confirmed"')
    expect(html).toContain("用户已确认")
    expect(html).toContain("主线开场")
    expect(html).toContain("主线高潮（可多个）")
    expect(html).toContain("主线结局")
    expect(html).toContain("支线时机与事件")
    expect(html).toContain(storyline.opening)
    expect(html).toContain(storyline.climaxes)
    expect(html).toContain(storyline.ending)
    expect(html).toContain(storyline.subplots)
    expect(html).toContain("2/待规划")
    expect(html).toContain("6,200 / 待规划")
    expect(html).not.toContain("0/0")
    expect(html).not.toContain("data-ready")
    expect(html).not.toContain("```json")
  })

  it("preserves planned chapter, word and artifact write counters beside story details", () => {
    const html = renderInfo()

    expect(html).toContain("2/8")
    expect(html).toContain("6,200 / 24,000")
    expect(html).toContain("首次写入")
    expect(html).toContain("写入3次")
    expect(html).toContain(storyline.opening)
  })

  it("caps published progress at the planned target", () => {
    expect(renderInfo({}, 10)).toContain("8/8")
  })

  it("shows pending word planning independently of a positive chapter target", () => {
    const html = renderInfo({ targetWordCount: 0 })
    expect(html).toContain("2/8")
    expect(html).toContain("6,200 / 待规划")
  })

  it.each([
    { storylineConfirmedAtMs: undefined },
    { storylineConfirmedAtMs: 0 },
    { storyline: undefined },
    { storyline: { ...storyline, ending: " \n " } },
    { storyline: { ...storyline, subplots: "" } },
    { storyline: { ...storyline, climaxes: ["高潮"] } },
  ])("requires both complete story sections and a valid timestamp for confirmed display: %j", (overrides) => {
    const html = renderInfo(overrides)
    expect(html).toContain('data-status="pending"')
    expect(html).toContain("待用户确认")
    expect(html).not.toContain("用户已确认")
    expect(html).not.toContain("data-ready")
  })

  it("keeps unconfirmed story text visible for review", () => {
    const html = renderInfo({ storylineConfirmedAtMs: undefined })
    expect(html).toContain(storyline.opening)
    expect(html).toContain(storyline.climaxes)
    expect(html).toContain(storyline.ending)
    expect(html).toContain(storyline.subplots)
  })

  it("offers the existing plan editor without requiring a separate story form", () => {
    const html = renderInfo()
    expect(html).toContain('data-testid="volume-edit-plan"')
    expect(html).toContain("编辑卷规划")
    expect(html).not.toMatch(/<(?:input|textarea|form|select)\b/u)
  })

  it("does not offer to edit a nonexistent plan file", () => {
    const html = renderToStaticMarkup(React.createElement(VolumePlanningInfo, {
      plan: undefined,
      publishedChapterCount: 0,
      wordCount: 0,
      onOpenPlan: vi.fn(),
    }))
    expect(html).toContain('data-status="pending"')
    expect(html).toContain("待写入")
    expect(html).not.toContain('data-testid="volume-edit-plan"')
  })

  it("escapes story text instead of rendering embedded markup", () => {
    const html = renderInfo({ storyline: { ...storyline, opening: "<script>alert('story')</script>" } })
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })
})
