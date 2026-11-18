import { describe, expect, it } from "vitest"

import { describeDiscussWrites, formatDiscussBlockNote } from "../src/application/chapters/discuss-block-note.js"

describe("discuss block notes", () => {
  it("names a dropped chapter draft by its body length", () => {
    expect(describeDiscussWrites({
      chapterDraftProposal: { heading: "第八章", body: "正文十二字" },
      assistantMessage: "已保存",
    })).toEqual(["chapterDraftProposal（5字）"])
  })

  it("tells the model a rejected write was not saved and must be submitted again", () => {
    const note = formatDiscussBlockNote({
      message: "同人原作还没有读进证据，请先 request_read。",
      discarded: ["chapterDraftProposal（5661字）"],
    })
    expect(note).toContain("同人原作还没有读进证据")
    expect(note).toContain("未保存：chapterDraftProposal（5661字）")
    expect(note).toContain("不得声称已写入")
    expect(note).toContain("重新提交")
  })

  it("tells the model a held write is not on disk yet", () => {
    const note = formatDiscussBlockNote({
      message: "先写 Todo。",
      discarded: ["chapterDraftProposal（5661字）"],
      disposition: "held",
    })
    expect(note).toContain("已暂存、尚未落盘")
    expect(note).toContain("不必重贴")
    expect(note).toContain("暂存会取消")
  })
})
