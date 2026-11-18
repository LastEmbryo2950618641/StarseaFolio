import { describe, expect, it, vi } from "vitest"
import type { ProjectId, WorkspaceCatalogSnapshot } from "@starseafolio/contracts"

import {
  executeSynopsisTemporalReads,
  formatTemporalSearchLabel,
  validateTemporalChapterSequence,
} from "../src/application/chapters/synopsis-temporal-reads.js"

describe("synopsis temporal reads", () => {
  it("formats as-of search labels", () => {
    const label = formatTemporalSearchLabel({
      requestId: "22222222-2222-4222-8222-222222222222",
      reason: "flashback",
      expectedEvidence: "old lore",
      query: {
        exactKeys: ["设定集/人物/林照.md"],
        semanticTexts: ["林照"],
        anchorIds: [],
        directions: ["both"],
        maxCandidates: 2,
        maxDepth: 0,
        sourceKinds: ["reference"],
        purpose: "as_of_chapter",
        asOfChapterSequence: 8,
      },
    })
    expect(label).toContain("第8章")
    expect(label).toContain("林照")
  })

  it("validates chapter sequence against session cursor", () => {
    expect(validateTemporalChapterSequence({ asOfChapterSequence: 3, sessionChapterSequence: 12 })).toBe(true)
    expect(validateTemporalChapterSequence({ asOfChapterSequence: 12, sessionChapterSequence: 12 })).toBe(false)
    expect(validateTemporalChapterSequence({ asOfChapterSequence: 0, sessionChapterSequence: 5 })).toBe(false)
    expect(validateTemporalChapterSequence({
      asOfChapterSequence: 1,
      sessionChapterSequence: 1,
      purpose: "past_chapter_text",
    })).toBe(true)
    expect(validateTemporalChapterSequence({
      asOfChapterSequence: 1,
      sessionChapterSequence: 1,
      purpose: "as_of_chapter",
    })).toBe(false)
  })

  it("falls back to the workspace publish path when no archive exists", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111" as ProjectId
    const publishPath = "章节正文/第一卷/第一章 开篇.md"
    const body = "# 第一章\n\n雨夜站台上只剩一盏无人认领的灯。"
    const evidence = await executeSynopsisTemporalReads({
      projectId,
      sessionChapterSequence: 9,
      workspaceRootRef: "ws-ref",
      workspace: {
        readMarkdown: vi.fn().mockResolvedValue(body),
      } as never,
      catalog: { entries: [] } as WorkspaceCatalogSnapshot,
      requests: [{
        requestId: "22222222-2222-4222-8222-222222222222",
        reason: "continuity",
        expectedEvidence: "chapter 1 body",
        query: {
          exactKeys: [],
          semanticTexts: [],
          anchorIds: [],
          directions: ["both"],
          maxCandidates: 1,
          maxDepth: 0,
          sourceKinds: ["source"],
          purpose: "past_chapter_text",
          asOfChapterSequence: 1,
        },
      }],
      existingEvidence: [],
      settingsLineage: {} as never,
      chapterIndex: {
        findBySequence: vi.fn().mockResolvedValue({
          currentSourceId: "source-1",
          currentPublishPath: publishPath,
        }),
      } as never,
      documents: {
        findStoredVersion: vi.fn().mockResolvedValue(undefined),
      } as never,
      internalStore: {} as never,
      chapterTemporal: {
        resolve: vi.fn().mockResolvedValue(undefined),
      } as never,
      createId: () => "33333333-3333-4333-8333-333333333333",
    })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.semanticText).toContain("工作区已发布定稿回退")
    expect(evidence[0]?.semanticText).toContain("无人认领的灯")
    expect(evidence[0]?.exactKeys).toContain(publishPath)
  })
})
