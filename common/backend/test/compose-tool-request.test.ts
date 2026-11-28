import { describe, expect, it } from "vitest"

import { parseComposeToolRequest } from "../src/application/chapters/compose-tool-request.js"

describe("compose tool request protocol", () => {
  it("parses a key-value invoke request and removes the block", () => {
    const parsed = parseComposeToolRequest([
      "先登记任务。",
      "<tool-request>",
      "name: todo_write",
      "action: invoke",
      'arguments: {"merge":false,"todos":[]}',
      "</tool-request>",
    ].join("\n"))
    expect(parsed.text).toBe("先登记任务。")
    expect(parsed.toolRequest).toEqual({
      name: "todo_write",
      action: "invoke",
      arguments: '{"merge":false,"todos":[]}',
    })
  })

  it("accepts the JSON body form and the aliases models emit", () => {
    const parsed = parseComposeToolRequest('<compose-tool-request>\n{"name":"todo_write","action":"describe"}\n</compose-tool-request>')
    expect(parsed.text).toBe("")
    expect(parsed.toolRequest).toEqual({ name: "todo_write", action: "describe" })
    expect(parseComposeToolRequest("<toolRequest>\nname: chapter_workflow\naction: describe\n</toolRequest>").toolRequest)
      .toMatchObject({ name: "chapter_workflow", action: "describe" })
  })

  it("rejects unknown tools, bad actions and mixed compose writes", () => {
    expect(() => parseComposeToolRequest("<tool-request>\nname: nope\naction: describe\n</tool-request>"))
      .toThrow(/工具名/u)
    expect(() => parseComposeToolRequest("<tool-request>\nname: todo_write\naction: run\n</tool-request>"))
      .toThrow(/action/u)
    expect(() => parseComposeToolRequest("<tool-request>\nname: todo_write\naction: invoke\narguments: nope\n</tool-request>"))
      .toThrow(/arguments/u)
  })

  it("accepts rename_chapter and update_work_metadata", () => {
    expect(parseComposeToolRequest([
      "<tool-request>",
      "name: rename_chapter",
      "action: invoke",
      'arguments: {"title":"新章名"}',
      "</tool-request>",
    ].join("\n")).toolRequest).toEqual({
      name: "rename_chapter",
      action: "invoke",
      arguments: '{"title":"新章名"}',
    })
    expect(parseComposeToolRequest(
      '<tool-request>\nname: update_work_metadata\naction: describe\n</tool-request>',
    ).toolRequest).toEqual({ name: "update_work_metadata", action: "describe" })
  })
})
