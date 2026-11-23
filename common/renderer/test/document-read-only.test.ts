import { describe, expect, it } from "vitest"

import { isWorkspaceDocumentReadOnly } from "../src/features/editor/document-read-only.js"

describe("workspace document read-only", () => {
  it("keeps only formal chapter bodies read-only", () => {
    expect(isWorkspaceDocumentReadOnly("章节正文/第一卷 起点/第一章 开端.md")).toBe(true)
    expect(isWorkspaceDocumentReadOnly("章节正文/第一章 开端 [已回退].md")).toBe(true)
    expect(isWorkspaceDocumentReadOnly("章节正文/第一章 开端 [剧情梗概].md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("章节正文/第一章 开端 [剧情细纲].md")).toBe(false)
  })

  it("treats prompt and platform rule files as editable", () => {
    expect(isWorkspaceDocumentReadOnly("提示词/系统规则/写作基调.md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("提示词/技能/去AI味.md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("世界推演规则/基础规则/base-rules.md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("世界推演规则/总览.md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("设定集/人物/林照.md")).toBe(false)
    expect(isWorkspaceDocumentReadOnly("章节正文")).toBe(false)
    expect(isWorkspaceDocumentReadOnly(undefined)).toBe(false)
  })
})
