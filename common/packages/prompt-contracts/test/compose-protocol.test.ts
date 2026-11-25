import { describe, expect, it } from "vitest"

import {
  COMPOSE_TAGS,
  ComposeStreamParser,
  parseComposeDocument,
  stripComposeTags,
} from "../src/compose-protocol.js"

const full = [
  COMPOSE_TAGS.synopsisStart,
  "梗概正文",
  COMPOSE_TAGS.synopsisEnd,
  COMPOSE_TAGS.outlineStart,
  "细纲正文",
  COMPOSE_TAGS.outlineEnd,
  COMPOSE_TAGS.draftStart,
  "草稿正文",
  COMPOSE_TAGS.draftEnd,
].join("\n")

describe("compose protocol", () => {
  it("parses three ordered sections and strips tags from visible text", () => {
    const parsed = parseComposeDocument(full)
    expect(parsed.errors).toEqual([])
    expect(parsed.sections.synopsis).toContain("梗概正文")
    expect(parsed.sections.outline).toContain("细纲正文")
    expect(parsed.sections.draft).toContain("草稿正文")
    expect(stripComposeTags(full)).not.toContain("<compose-")
  })

  it("survives tags split across streaming chunks and emits stage events", () => {
    const parser = new ComposeStreamParser()
    const events = [
      ...parser.push("<compose-syn"),
      ...parser.push("opsis>\n梗概"),
      ...parser.push("\n</compose-synopsis>\n<compose-outline>"),
      ...parser.push("\n细纲\n</compose-outline>\n<compose-draft>\n草稿\n</compose-draft>"),
      ...parser.finish(),
    ]
    expect(events.filter((event) => event.type === "section_start").map((event) => event.section))
      .toEqual(["synopsis", "outline", "draft"])
    expect(events.filter((event) => event.type === "section_end").map((event) => event.section))
      .toEqual(["synopsis", "outline", "draft"])
    expect(parser.sections().draft).toContain("草稿")
  })

  it("preserves literal less-than characters in discussion and section text", () => {
    const parsed = parseComposeDocument(`a < b\n<compose-synopsis>\n3 < 5\n</compose-synopsis>`)
    expect(parsed.errors).toEqual([])
    expect(parsed.text.trim()).toBe("a < b")
    expect(parsed.sections.synopsis?.trim()).toBe("3 < 5")
  })

  it("rejects out-of-order and unclosed sections", () => {
    const outOfOrder = parseComposeDocument(`${COMPOSE_TAGS.outlineStart}\n细纲\n${COMPOSE_TAGS.outlineEnd}`)
    expect(outOfOrder.errors.length).toBeGreaterThan(0)
    const unclosed = parseComposeDocument(`${COMPOSE_TAGS.synopsisStart}\n只有梗概`)
    expect(unclosed.errors.some((message) => message.includes("未闭合"))).toBe(true)
  })
})
