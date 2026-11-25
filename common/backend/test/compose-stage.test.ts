import { describe, expect, it } from "vitest"

import { composeProgressForEvent } from "../src/application/chapters/compose-stage.js"

describe("compose stage mapping", () => {
  it("maps synopsis, outline, draft events onto the discuss bar", () => {
    expect(composeProgressForEvent({ type: "section_start", section: "synopsis" }))
      .toEqual({ stage: "synopsis_discuss", status: "running" })
    expect(composeProgressForEvent({ type: "section_end", section: "outline" }))
      .toEqual({ stage: "outline_discuss", status: "done" })
    expect(composeProgressForEvent({ type: "section_start", section: "draft" }))
      .toEqual({ stage: "draft_discuss", status: "running" })
  })

  it("ignores plain text and protocol errors", () => {
    expect(composeProgressForEvent({ type: "text", text: "正文" })).toBeUndefined()
    expect(composeProgressForEvent({ type: "error", message: "乱序" })).toBeUndefined()
  })
})
