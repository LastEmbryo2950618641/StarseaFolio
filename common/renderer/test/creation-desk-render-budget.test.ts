import { describe, expect, it } from "vitest"

import {
  CREATION_DESK_MESSAGE_WINDOW,
  truncateThinkingForLiveRender,
  windowCreationDeskMessages,
} from "../src/features/editor/creation-desk-render-budget.js"

describe("creation-desk-render-budget", () => {
  it("windows long message lists unless expanded", () => {
    const messages = Array.from({ length: CREATION_DESK_MESSAGE_WINDOW + 5 }, (_, index) => index)
    expect(windowCreationDeskMessages(messages, false)).toEqual({
      visible: messages.slice(-CREATION_DESK_MESSAGE_WINDOW),
      hiddenCount: 5,
    })
    expect(windowCreationDeskMessages(messages, true)).toEqual({
      visible: messages,
      hiddenCount: 0,
    })
  })

  it("keeps only the live thinking tail while streaming long text", () => {
    const text = "a".repeat(5_000)
    const truncated = truncateThinkingForLiveRender(text, true)
    expect(truncated.truncated).toBe(true)
    expect(truncated.text.length).toBe(2_500)
    expect(truncated.text).toBe(text.slice(-2_500))
    expect(truncateThinkingForLiveRender(text, false)).toEqual({ text, truncated: false })
  })
})
