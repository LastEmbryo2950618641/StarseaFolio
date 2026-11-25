import { describe, expect, it } from "vitest"

import { COMPOSE_TAGS } from "@starseafolio/prompt-contracts"
import { composeArtifactFromText } from "../src/application/chapters/compose-artifact.js"

describe("compose artifact conversion", () => {
  it("turns three tagged sections into an artifact without tags", () => {
    const artifact = composeArtifactFromText([
      COMPOSE_TAGS.synopsisStart, "林烬追查线索。", COMPOSE_TAGS.synopsisEnd,
      COMPOSE_TAGS.outlineStart, "- 章定位：追查。", COMPOSE_TAGS.outlineEnd,
      COMPOSE_TAGS.draftStart, "# 第一章 旧站台", "", "雨落在站台。", COMPOSE_TAGS.draftEnd,
    ].join("\n"))
    expect(artifact.synopsisBody).toBe("林烬追查线索。")
    expect(artifact.outlineBody).toBe("- 章定位：追查。")
    expect(artifact.chapterDraftProposal).toMatchObject({ heading: "第一章 旧站台" })
    expect(artifact.assistantMessage).not.toContain("<compose-")
    expect(artifact.planningWriteIntent).toEqual({ synopsis: "create", outline: "create", draft: "write" })
  })

  it("rejects a closed but incomplete response when all three sections were authorized", () => {
    const synopsisOnly = `${COMPOSE_TAGS.synopsisStart}\n梗概正文\n${COMPOSE_TAGS.synopsisEnd}`
    expect(() => composeArtifactFromText(synopsisOnly, { synopsis: "create", outline: "create" })).toThrow(/本次响应不会写入/u)
    expect(composeArtifactFromText("我们先聊人物。").assistantMessage).toBe("我们先聊人物。")
  })

  it("accepts an outline-only rewrite and rejects an unapproved synopsis", () => {
    const outline = `${COMPOSE_TAGS.outlineStart}\n细纲正文\n${COMPOSE_TAGS.outlineEnd}`
    const synopsis = `${COMPOSE_TAGS.synopsisStart}\n梗概正文\n${COMPOSE_TAGS.synopsisEnd}`
    expect(composeArtifactFromText(outline, { outline: "rewrite" })).toMatchObject({
      outlineBody: "细纲正文",
      planningWriteIntent: { outline: "rewrite" },
    })
    expect(() => composeArtifactFromText(`${synopsis}\n${outline}`, { outline: "rewrite" })).toThrow(/构思流协议错误/u)
    expect(() => composeArtifactFromText(synopsis, {})).toThrow(/构思流协议错误/u)
  })

  it("rejects protocol errors instead of writing partial materials", () => {
    expect(() => composeArtifactFromText(`${COMPOSE_TAGS.outlineStart}\n细纲`)).toThrow(/构思流协议错误/u)
  })
})
