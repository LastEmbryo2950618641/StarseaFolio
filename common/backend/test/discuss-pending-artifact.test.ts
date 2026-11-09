import { describe, expect, it } from "vitest"
import { synopsisDiscussArtifactSchema } from "@worldseed/prompt-contracts"
import { retainDiscussWrites, restoreDiscussWrites } from "../src/application/chapters/discuss-pending-artifact.js"

const draft = { base: "body" as const, heading: "第一章 雨夜", body: "旧稿正文" }
const artifact = (fields: Record<string, unknown>) => synopsisDiscussArtifactSchema.parse({
  assistantMessage: "当前进度", finalSelfReview: "checked", ...fields,
})
const pending = retainDiscussWrites(artifact({ synopsisBody: "梗概", outlineBody: "大纲", chapterDraftProposal: draft }))

describe("pending discussion writes", () => {
  it("retains writing fields without carrying old choices or continuation decisions", () => {
    const retained = retainDiscussWrites(artifact({ chapterDraftProposal: draft, continueTurn: true, choices: [] }))
    expect(retained).toEqual({ chapterDraftProposal: draft })
    const restored = restoreDiscussWrites(retained, artifact({ choices: [{ label: "查看草稿", action: "continue_discuss" }] }), 1)
    expect(restored.chapterDraftProposal).toEqual(draft)
    expect(restored.continueTurn).toBeUndefined()
    expect(synopsisDiscussArtifactSchema.safeParse(restored).success).toBe(true)
  })

  it("never merges a writing proposal into a tool request", () => {
    const current = artifact({ toolRequest: { name: "todo_write", action: "describe" } })
    expect(restoreDiscussWrites(pending, current, 1)).toEqual(current)
  })

  it("discards the retained proposal when focus or chapter identity changes", () => {
    for (const fields of [{ focusChange: { chapterSequence: 2 } }, { chapterTitle: "新标题" }, { volumeFolderName: "第二卷 雨后" }]) {
      const current = artifact(fields)
      expect(restoreDiscussWrites(pending, current, 1)).toEqual(current)
    }
  })

  it("invalidates downstream writing after a synopsis change", () => {
    const restored = restoreDiscussWrites(pending, artifact({ synopsisBody: "新梗概" }), 1)
    expect(restored.synopsisBody).toBe("新梗概")
    expect(restored.outlineBody).toBeUndefined()
    expect(restored.chapterDraftProposal).toBeUndefined()
  })

  it("invalidates a draft after an outline change and keeps outline edit modes exclusive", () => {
    const restored = restoreDiscussWrites(pending, artifact({ bodyEdits: { target: "outline", ops: [{ oldText: "旧", newText: "新" }] } }), 1)
    expect(restored.outlineBody).toBeUndefined()
    expect(restored.bodyEdits).toBeDefined()
    expect(restored.chapterDraftProposal).toBeUndefined()
    expect(synopsisDiscussArtifactSchema.safeParse(restored).success).toBe(true)
  })

  it("uses an explicit replacement draft instead of the retained version", () => {
    const replacement = { ...draft, body: "新稿正文" }
    expect(restoreDiscussWrites(pending, artifact({ chapterDraftProposal: replacement }), 1).chapterDraftProposal).toEqual(replacement)
  })
})
