import { describe, expect, it } from "vitest"

import {
  PROMPT_CATEGORIES,
  isPromptPath,
  normalizeWorkspacePath,
  promptCategoryLabel,
} from "../src/features/workspace/prompt-paths.js"

describe("prompt paths", () => {
  it("recognizes prompt-library paths, including windows separators", () => {
    expect(isPromptPath("提示词")).toBe(true)
    expect(isPromptPath("提示词/")).toBe(true)
    expect(isPromptPath("提示词/系统规则/写作基调.md")).toBe(true)
    expect(isPromptPath("提示词\\阶段提示\\大纲.md")).toBe(true)
    expect(isPromptPath("./提示词/技能/写作.md")).toBe(true)
  })

  it("recognizes mirrored platform rule paths", () => {
    expect(isPromptPath("世界推演规则/总览.md")).toBe(true)
    expect(isPromptPath("世界推演规则/人物设定.md")).toBe(true)
    expect(isPromptPath("世界推演规则/基础规则")).toBe(true)
    expect(isPromptPath("世界推演规则/基础规则/base-rules.md")).toBe(true)
  })

  it("rejects project content and lookalike names", () => {
    expect(isPromptPath("设定集/人物/林照.md")).toBe(false)
    expect(isPromptPath("世界推演规则/用户规则/我的规则.md")).toBe(false)
    expect(isPromptPath("世界推演规则/总览.md.bak")).toBe(false)
    expect(isPromptPath("提示词备份/旧规则.md")).toBe(false)
    expect(isPromptPath("章节正文/第一章 开端.md")).toBe(false)
    expect(isPromptPath("")).toBe(false)
  })

  it("labels prompt categories and mirrored rules", () => {
    for (const category of PROMPT_CATEGORIES) {
      expect(promptCategoryLabel(`提示词/${category}/示例.md`)).toBe(category)
    }
    expect(promptCategoryLabel("世界推演规则/基础规则/base-rules.md")).toBe("平台规则")
    expect(promptCategoryLabel("世界推演规则/人物设定.md")).toBe("平台规则")
    expect(promptCategoryLabel("世界推演规则/总览.md")).toBe("平台规则")
    expect(promptCategoryLabel("提示词/未知分类/示例.md")).toBeUndefined()
    expect(promptCategoryLabel("设定集/人物/林照.md")).toBeUndefined()
  })

  it("normalizes separators and trailing slashes", () => {
    expect(normalizeWorkspacePath("提示词\\系统规则\\写作基调.md/")).toBe("提示词/系统规则/写作基调.md")
  })
})
