import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  AFTER_USER_MESSAGE_PROMPT_DOC,
  BEFORE_USER_MESSAGE_PROMPT_DOC,
  extractPromptDocSection,
  extractPromptDocSectionOrFull,
  INGESTION_STAGE_PROMPT_DOC,
  MESSAGE_WRAPPER_MARKERS,
  NEW_CHAPTER_STAGE_PROMPT_DOC,
  STAGE_ENTRY_MARKERS,
  STAGE_PROMPT_DOCS,
  stagePromptDocForPhase,
  stagePromptDocForSkill,
} from "../src/prompt-docs.js"

function readResource(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

describe("canonical compose stage", () => {
  const composePath = "resources/v1/prompt-docs/stages/02-compose.md"

  it("routes discussion and formal drafting to distinct sections of one document", () => {
    expect(STAGE_PROMPT_DOCS.map((doc) => doc.id)).toEqual(["new-chapter", "compose", "ingestion"])
    expect(stagePromptDocForPhase("synopsis_discuss")?.resourcePath).toBe(composePath)
    expect(stagePromptDocForPhase("draft")?.resourcePath).toBe(composePath)

    const document = readResource(composePath)
    const discussion = extractPromptDocSection(document, "phase:synopsis-discuss")
    expect(discussion).toContain("<compose-synopsis>")
    expect(discussion).toContain("<compose-outline>")
    expect(discussion).toContain("<compose-draft>")
    expect(discussion).not.toContain("输出 JSON：顶层含")

    const legacyDraft = readResource("resources/v1/prompt-docs/stages/03-draft.md")
    expect(extractPromptDocSection(document, "phase:draft")).toBe(extractPromptDocSection(legacyDraft, "phase:draft"))
  })

  it("preserves every migrated skill section and its lookup", () => {
    const document = readResource(composePath)
    const legacySkills = {
      "02-synopsis.md": ["plot-synopsis", "discuss-workflow", "starsea-writing", "user-to-synopsis", "synopsis-to-outline", "book-cold-start"],
      "03-draft.md": ["outline-to-draft"],
    }
    for (const [filename, skills] of Object.entries(legacySkills)) {
      const legacy = readResource(`resources/v1/prompt-docs/stages/${filename}`)
      for (const id of skills) {
        expect(stagePromptDocForSkill(id)?.resourcePath).toBe(composePath)
        const section = extractPromptDocSection(document, `skill:${id}`)
        if (["plot-synopsis", "user-to-synopsis", "synopsis-to-outline"].includes(id)) {
          expect(section).toMatch(/完整构思[^\n]*同一回复/u)
        } else {
          expect(section).toBe(extractPromptDocSection(legacy, `skill:${id}`))
        }
      }
    }
  })

  it("exposes before/after user message markers, stage entry markers, and maps work_style_revision into ingestion", () => {
    expect(stagePromptDocForPhase("work_style_revision")?.resourcePath).toBe(INGESTION_STAGE_PROMPT_DOC)
    expect(extractPromptDocSectionOrFull(readResource(BEFORE_USER_MESSAGE_PROMPT_DOC), MESSAGE_WRAPPER_MARKERS.before))
      .toContain("以下紧邻内容为用户本轮发送的原始消息")
    expect(extractPromptDocSectionOrFull(readResource(AFTER_USER_MESSAGE_PROMPT_DOC), MESSAGE_WRAPPER_MARKERS.after))
      .toContain("以上为用户本轮原始消息")
    expect(extractPromptDocSectionOrFull(readResource(NEW_CHAPTER_STAGE_PROMPT_DOC), STAGE_ENTRY_MARKERS.newChapterEntry))
      .toContain("上一章正文已完成章节入库并落盘")
    expect(extractPromptDocSectionOrFull(readResource(composePath), STAGE_ENTRY_MARKERS.composeRequest))
      .toContain("<request-compose/>")
    expect(extractPromptDocSectionOrFull(readResource(composePath), STAGE_ENTRY_MARKERS.composeEntry))
      .toContain("用户已点击「开始构思」确认进入本章节构思阶段")
    expect(extractPromptDocSectionOrFull(readResource(INGESTION_STAGE_PROMPT_DOC), STAGE_ENTRY_MARKERS.ingestionEntry))
      .toContain("用户已通过「发布正文」确认当前章草稿进入正式章节入库流程")
    expect(extractPromptDocSection(readResource(INGESTION_STAGE_PROMPT_DOC), "phase:work-style-revision"))
      .toContain("# work_style_revision")
    // Plain user-edited markdown without markers still loads cleanly.
    expect(extractPromptDocSectionOrFull("---\ntitle: 自定义\n---\n\n自定义提示词\n", MESSAGE_WRAPPER_MARKERS.before))
      .toBe("自定义提示词")
  })
})
