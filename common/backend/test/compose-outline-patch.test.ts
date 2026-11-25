import { describe, expect, it } from "vitest"

import { synopsisDiscussArtifactSchema } from "@starseafolio/prompt-contracts"

import {
  ComposeOutlinePatchError,
  parseComposeOutlinePatch,
} from "../src/application/chapters/compose-outline-patch.js"
import { applySearchReplace } from "../src/application/chapters/markdown-search-replace.js"

const authorized = { outline: "patch" } as const

function operation(oldText: string, newText: string): string {
  return `<search>\n${oldText}\n</search>\n<replace>\n${newText ? `${newText}\n` : ""}</replace>`
}

function patch(...ops: string[]): string {
  return ["<compose-outline-patch>", ...ops, "</compose-outline-patch>"].join("\n")
}

const validPatch = patch(operation("旧约定", "新约定"))

describe("parseComposeOutlinePatch", () => {
  it("preserves Markdown whitespace, normalizes line endings, and returns schema-compatible edits", () => {
    const oldText = "\n## 伏笔\n\n  - 旧约定  \n  - 行内 `<search>`\n"
    const newText = "\n## 伏笔\n\n  - 新约定  \n  - 行内 `<search>`\n"
    const wireText = `\n${patch(operation(oldText, newText), "", operation("删除此句", ""))}\n  \n`
    const bodyEdits = parseComposeOutlinePatch(wireText.replaceAll("\n", "\r\n"), authorized)
    expect(bodyEdits).toEqual({
      target: "outline",
      ops: [{ oldText, newText }, { oldText: "删除此句", newText: "" }],
    })
    expect(synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "已提交细纲补丁。",
      finalSelfReview: "已检查搜索锚点。",
      planningWriteIntent: authorized,
      bodyEdits,
    }).success).toBe(true)
  })

  it("applies subsequent operations against the preceding result, including deletion", () => {
    const bodyEdits = parseComposeOutlinePatch(patch(
      operation("- 旧约定", "- 新约定\n- 冗余伏笔"),
      operation("\n- 冗余伏笔", ""),
    ), authorized)
    expect(applySearchReplace("# 细纲\n- 旧约定\n- 保留场景", bodyEdits.ops)).toEqual({
      ok: true,
      content: "# 细纲\n- 新约定\n- 保留场景",
      appliedCount: 2,
    })
  })

  it("requires current-turn patch authorization", () => {
    for (const intent of [undefined, {}, { outline: "create" }, { outline: "rewrite" }] as const) {
      expect(() => parseComposeOutlinePatch(validPatch, intent)).toThrow(/未授权/)
    }
  })

  it.each([
    ["missing envelope", operation("旧", "新")],
    ["repeated envelope", `${validPatch}\n${validPatch}`],
    ["unclosed envelope", validPatch.replace("</compose-outline-patch>", "")],
    ["empty envelope", patch()],
    ["empty search", patch(operation("", "新"))],
    ["missing replacement", patch("<search>\n旧\n</search>")],
    ["out-of-order tags", patch("<replace>\n新\n</replace>\n<search>\n旧\n</search>")],
    ["nested tags", patch(operation("旧\n<search>\n原文", "新"))],
    ["wrong closing tag", validPatch.replace("</search>", "</replace>")],
    ["inline delimiter", validPatch.replace("<search>\n", "<search>")],
    ["text before envelope", `说明\n${validPatch}`],
    ["text between pairs", patch(operation("旧", "新"), "说明", operation("旧二", "新二"))],
    ["text after envelope", `${validPatch}\n说明`],
    ["Markdown fence around envelope", `\`\`\`markdown\n${validPatch}\n\`\`\``],
    ["competing full outline", `${validPatch}\n<compose-outline>\n# 全文\n</compose-outline>`],
  ])("rejects %s", (_label, text) => {
    expect(() => parseComposeOutlinePatch(text, authorized)).toThrow(ComposeOutlinePatchError)
  })

  it("enforces the existing operation count and text length limits", () => {
    const maxSearch = "x".repeat(20_000)
    const maxReplace = "y".repeat(40_000)
    const maxOps = Array.from({ length: 20 }, () => operation(maxSearch, maxReplace))
    expect(parseComposeOutlinePatch(patch(...maxOps), authorized).ops).toHaveLength(20)
    expect(() => parseComposeOutlinePatch(patch(...maxOps, operation("x", "y")), authorized)).toThrow(/20 条/)
    expect(() => parseComposeOutlinePatch(patch(operation(`${maxSearch}x`, "y")), authorized)).toThrow(/20000/)
    expect(() => parseComposeOutlinePatch(patch(operation("x", `${maxReplace}y`)), authorized)).toThrow(/40000/)
  })
})
