import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  extractPromptDocSection,
  STAGE_PROMPT_DOCS,
  stagePromptDocForPhase,
  stagePromptDocForSkill,
  sharedStageMarkdown,
  BEFORE_USER_MESSAGE_PROMPT_DOC,
  AFTER_USER_MESSAGE_PROMPT_DOC,
} from "../src/prompt-docs.js"

function readResource(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

describe("user message brackets", () => {
  it("keeps both editable files independent of subphase and query protocols", () => {
    const before = readResource(BEFORE_USER_MESSAGE_PROMPT_DOC)
    const after = readResource(AFTER_USER_MESSAGE_PROMPT_DOC)
    expect(before).toContain("本轮输入原文")
    expect(after).toContain("《去 AI 味与写作声音》")
    expect(after.length).toBeLessThan(150)
    expect(before + after).not.toMatch(/<!--|queryGrounding|work_style_revision/u)
  })

  it("keeps author edits outside legacy subphase appendices on every business-stage request", () => {
    const doc = "# 入库\n\n公共 A\n\n<!-- phase:test -->\n协议\n<!-- /phase:test -->\n公共 B\n"
    expect(sharedStageMarkdown(doc)).toContain("公共 A")
    expect(sharedStageMarkdown(doc)).toContain("公共 B")
    expect(sharedStageMarkdown(doc)).not.toContain("协议")
    expect(sharedStageMarkdown("# 自定义，无标记\n")).toBe("# 自定义，无标记\n")
  })
})

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
})
