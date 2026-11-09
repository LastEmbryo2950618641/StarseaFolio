import { describe, expect, it } from "vitest"
import {
  closeEditorDocument,
  openEditorDocument,
  saveEditorDocument,
  updateEditorDocument,
  type EditorDocument,
} from "../src/features/editor/editor-document-tabs.js"

describe("editor document tabs", () => {
  it("keeps independent unsaved buffers when opening and revisiting files", () => {
    let documents = openEditorDocument([], "设定集/甲.md").documents
    documents = updateEditorDocument(documents, "设定集/甲.md", { content: "原文甲", savedContent: "原文甲" })
    documents = updateEditorDocument(documents, "设定集/甲.md", { content: "未保存甲" })
    documents = openEditorDocument(documents, "设定集/乙.md").documents
    documents = updateEditorDocument(documents, "设定集/乙.md", { content: "原文乙", savedContent: "原文乙" })
    const revisited = openEditorDocument(documents, "设定集/甲.md")
    expect(revisited.documents).toHaveLength(2)
    expect(revisited.documents[0]).toEqual({ path: "设定集/甲.md", content: "未保存甲", savedContent: "原文甲" })
    expect(revisited.documents[1]?.content).toBe("原文乙")
  })

  it("blocks an eleventh distinct file, allows revisiting, and frees capacity after closing", () => {
    let documents: readonly EditorDocument[] = []
    for (let i = 1; i <= 10; i += 1) documents = openEditorDocument(documents, `设定集/${String(i)}.md`).documents
    const blocked = openEditorDocument(documents, "设定集/11.md")
    expect(blocked.accepted).toBe(false)
    expect(blocked.documents).toHaveLength(10)
    expect(openEditorDocument(documents, "设定集/1.md").accepted).toBe(true)
    const closed = closeEditorDocument(documents, "设定集/4.md", "设定集/4.md")
    expect(openEditorDocument(closed.documents, "设定集/11.md").accepted).toBe(true)
  })

  it("selects the adjacent file when closing the active file", () => {
    const documents = [{ path: "甲.md" }, { path: "乙.md" }, { path: "丙.md" }]
    expect(closeEditorDocument(documents, "乙.md", "乙.md").activePath).toBe("丙.md")
    expect(closeEditorDocument(documents, "丙.md", "丙.md").activePath).toBe("乙.md")
    expect(closeEditorDocument([{ path: "甲.md" }], "甲.md", "甲.md").activePath).toBeUndefined()
  })

  it("does not navigate when closing a background file or a file from the conversation view", () => {
    const documents = [{ path: "甲.md" }, { path: "乙.md" }]
    expect(closeEditorDocument(documents, "乙.md", "甲.md").activePath).toBe("甲.md")
    expect(closeEditorDocument(documents, "甲.md", undefined).activePath).toBeUndefined()
  })

  it("does not overwrite newer edits when an earlier save completes", () => {
    const documents = [{ path: "甲.md", content: "保存期间的新修改", savedContent: "旧内容" }]
    expect(saveEditorDocument(documents, "甲.md", "本次保存内容")[0]).toEqual({
      path: "甲.md", content: "保存期间的新修改", savedContent: "本次保存内容",
    })
    expect(saveEditorDocument([], "已关闭.md", "保存内容")).toEqual([])
  })
})
