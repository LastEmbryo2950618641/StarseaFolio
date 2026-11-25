import { describe, expect, it } from "vitest"

import {
  extractComposeIntentMarker,
  extractContinueTurnMarker,
  parseComposeHostTags,
} from "../src/application/chapters/compose-artifact.js"
import { parseComposeGoalProposals } from "../src/application/chapters/compose-goal-proposals.js"

describe("compose text host tags", () => {
  it("reads write intent and removes the marker from visible prose", () => {
    const parsed = extractComposeIntentMarker("正文\n<compose-intent synopsis=\"rewrite\" draft=\"write\"/>")
    expect(parsed.text).toBe("正文")
    expect(parsed.intent).toEqual({ synopsis: "rewrite", draft: "write" })
  })

  it("rejects unknown or combined intent fields", () => {
    expect(() => extractComposeIntentMarker('<compose-intent outline="patch" draft="write"/>')).toThrow(/字段组合/u)
    expect(() => extractComposeIntentMarker('<compose-intent mystery="write"/>')).toThrow(/未知或重复/u)
  })

  it("reads chapter title, volume folder and auto-continue markers", () => {
    const tags = parseComposeHostTags("<chapter-title>第一章 来信</chapter-title>\n<volume-folder>第二卷 潮声</volume-folder>\n正文")
    expect(tags).toMatchObject({ chapterTitle: "第一章 来信", volumeFolderName: "第二卷 潮声", text: "正文" })
    expect(extractContinueTurnMarker("完成。\n<continue-turn/>")).toEqual({ text: "完成。", continueTurn: true })
  })

  it("rejects duplicate host tags", () => {
    expect(() => parseComposeHostTags("<chapter-title>甲</chapter-title><chapter-title>乙</chapter-title>")).toThrow(/重复/u)
  })
})

describe("compose goal proposal tags", () => {
  it("parses create and chapter-progress proposals", () => {
    const parsed = parseComposeGoalProposals([
      "说明文字",
      "<goal-proposals>",
      "kind: create",
      "content: 推进矿场线索",
      "narrativeKind: foreshadow",
      "plantChapterSequence: 2",
      "payoffChapterSequence: 5",
      "reason: 由讨论整理",
      "---",
      "kind: set_chapter_progress",
      "goalId: goal-1",
      "chapterSequence: 3",
      "summary: 本章推进旧信线索",
      "</goal-proposals>",
    ].join("\n"))
    expect(parsed.text).toBe("说明文字")
    expect(parsed.goalProposals).toEqual([
      {
        payload: {
          kind: "create",
          content: "推进矿场线索",
          narrativeKind: "foreshadow",
          plantChapterSequence: 2,
          payoffChapterSequence: 5,
        },
        reason: "由讨论整理",
      },
      {
        payload: { kind: "set_chapter_progress", goalId: "goal-1", chapterSequence: 3, summary: "本章推进旧信线索" },
      },
    ])
  })

  it("rejects malformed payloads instead of dropping proposals", () => {
    expect(() => parseComposeGoalProposals("<goal-proposals>\nkind: complete\n</goal-proposals>"))
      .toThrow(/校验/u)
    expect(() => parseComposeGoalProposals("<goal-proposals>\nkind: create\nunknownField: x\n</goal-proposals>"))
      .toThrow(/未知字段/u)
    expect(() => parseComposeGoalProposals("<goal-proposals>\nkind: set_chapter_progress\ngoalId: g\nchapterSequence: 0\nsummary: s\n</goal-proposals>"))
      .toThrow(/正整数/u)
  })
})
