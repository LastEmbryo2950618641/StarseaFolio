import { describe, expect, it } from "vitest"

import { synopsisDiscussArtifactSchema } from "@starseafolio/prompt-contracts"
import { ComposeProtocolError } from "../src/application/chapters/compose-artifact.js"
import { composeVolumePlanArtifactFromText } from "../src/application/chapters/compose-volume-plan.js"

const block = (name: string, content: string) => `<compose-volume-${name}>\n${content}\n</compose-volume-${name}>`
const synopsis = block("synopsis", "# 卷梗概\n\n林烬寻找遗失的航图。")
const outline = block("outline", "- 开场：旧港断电。\n- 结局：航路重新开启。")
const targets = "targetChapterCount: 3\ntargetWordCount: 9000"
const meta = block("meta", targets)
const chapterSynopsis = block("chapter-synopsis", "林烬错过末班渡船。")
const chapterOutline = block("chapter-outline", "- 起因：旧港封锁。\n- 后果：改走水路。")
const chapter = (index: string | number, content = `${chapterSynopsis}\n${chapterOutline}`) =>
  `<compose-volume-chapter index="${index}">\n${content}\n</compose-volume-chapter>`
const volume = [synopsis, outline, meta].join("\n\n")

describe("compose volume plan artifact", () => {
  it("maps the complete volume plan to the discuss artifact and keeps leading prose visible", () => {
    const input = ["这卷以失落航图为主线。", "", synopsis, outline, block("meta", `${targets}\nnotes: 节奏偏紧。`)]
      .join("\r\n")
    const artifact = composeVolumePlanArtifactFromText(input)
    expect(artifact).toEqual({
      assistantMessage: "这卷以失落航图为主线。",
      finalSelfReview: expect.any(String),
      volumeSynopsis: { markdown: "# 卷梗概\n\n林烬寻找遗失的航图。" },
      arcPlan: { markdown: "- 开场：旧港断电。\n- 结局：航路重新开启。" },
      volumePlanMeta: { targetChapterCount: 3, targetWordCount: 9000, notes: "节奏偏紧。" },
    })
    expect(synopsisDiscussArtifactSchema.safeParse(artifact).success).toBe(true)
  })

  it("uses absolute indexes and synthesizes the batch planning intent", () => {
    const input = `${volume}\n${chapter(12, `${block("chapter-title", "旧站台")}\n${chapterSynopsis}\n${chapterOutline}`)}\n${chapter(14)}`
    const artifact = composeVolumePlanArtifactFromText(input)
    expect(artifact.assistantMessage).toBe("已整理本卷规划。")
    expect(artifact.planningWriteIntent).toEqual({ volume: "whole_volume" })
    expect(artifact.volumeChapterPlans).toEqual([
      { chapterSequence: 12, chapterTitle: "旧站台", synopsisBody: "林烬错过末班渡船。", outlineBody: "- 起因：旧港封锁。\n- 后果：改走水路。" },
      { chapterSequence: 14, synopsisBody: "林烬错过末班渡船。", outlineBody: "- 起因：旧港封锁。\n- 后果：改走水路。" },
    ])
    expect(synopsisDiscussArtifactSchema.safeParse(artifact).success).toBe(true)
  })

  it("requires precisely the blocks selected by host scope", () => {
    expect(composeVolumePlanArtifactFromText(outline, { volumeOutline: true })).toMatchObject({
      arcPlan: { markdown: "- 开场：旧港断电。\n- 结局：航路重新开启。" },
    })
    expect(composeVolumePlanArtifactFromText(chapter(12), { volume: "whole_volume" }).volumeChapterPlans)
      .toHaveLength(1)
    expect(() => composeVolumePlanArtifactFromText(outline, { volumeOutline: true, volumeTargets: true })).toThrow(/meta/u)
    expect(() => composeVolumePlanArtifactFromText(`${outline}\n${meta}`, { volumeOutline: true })).toThrow(/未授权/u)
    expect(() => composeVolumePlanArtifactFromText(`${outline}\n${chapter(12)}`, { volumeOutline: true })).toThrow(/未授权/u)
    expect(() => composeVolumePlanArtifactFromText("", { volume: "whole_volume" })).toThrow(/缺少卷内章计划块/u)
  })

  it.each([
    ["missing volume block", `${synopsis}\n${meta}`],
    ["out-of-order volume blocks", `${outline}\n${synopsis}\n${meta}`],
    ["duplicate volume block", `${volume}\n${meta}`],
    ["unclosed volume block", `${synopsis}\n<compose-volume-outline>\n正文`],
    ["mismatched close", volume.replace("</compose-volume-outline>", "</compose-volume-synopsis>")],
    ["nested tags", `${block("synopsis", outline)}\n${outline}\n${meta}`],
    ["unknown protocol tag", volume.replace("林烬寻找遗失的航图。", "<compose-volume-other>")],
    ["inline tags", volume.replace("<compose-volume-synopsis>\n", "<compose-volume-synopsis>")],
    ["code fence wrapper", `\`\`\`text\n${volume}\n\`\`\``],
    ["trailing prose", `${volume}\n卷规划完成。`],
    ["heading and placeholder", `${block("synopsis", "# 卷梗概\n\nTBD")}\n${outline}\n${meta}`],
    ["empty Markdown", `${synopsis}\n${block("outline", "   ")}\n${meta}`],
    ["raw JSON response", '{"volumePlanMeta":{"targetChapterCount":3,"targetWordCount":9000}}'],
  ])("rejects %s", (_description, input) => {
    expect(() => composeVolumePlanArtifactFromText(input)).toThrow(ComposeProtocolError)
  })

  it.each([
    "targetChapterCount: 3",
    "targetWordCount: 9000\ntargetChapterCount: 3",
    "targetChapterCount: 0\ntargetWordCount: 9000",
    "targetChapterCount: 03\ntargetWordCount: 9000",
    "targetChapterCount: 3.5\ntargetWordCount: 9e3",
    "targetChapterCount: 51\ntargetWordCount: 9000",
    "targetChapterCount: 3\ntargetWordCount: 10000001",
    `${targets}\nnotes:    `,
    `${targets}\nnotes: ${"长".repeat(2001)}`,
    `${targets}\ntargetChapterCount: 4`,
    '{"targetChapterCount":3,"targetWordCount":9000}',
  ])("rejects invalid or oversized metadata %j", (invalidMeta) => {
    expect(() => composeVolumePlanArtifactFromText(`${synopsis}\n${outline}\n${block("meta", invalidMeta)}`))
      .toThrow(/卷规划协议错误/u)
  })

  it.each([
    ["zero index", chapter(0)],
    ["fractional index", chapter(1.5)],
    ["out-of-schema index", chapter(10_001)],
    ["malformed chapter attributes", chapter(12).replace('index="12"', 'index="12" title="x"')],
    ["duplicate index", `${chapter(12)}\n${chapter(12)}`],
    ["missing outline", chapter(12, chapterSynopsis)],
    ["reversed fields", chapter(12, `${chapterOutline}\n${chapterSynopsis}`)],
    ["placeholder synopsis", chapter(12, `${block("chapter-synopsis", "# 第十二章 剧情梗概")}\n${chapterOutline}`)],
    ["empty title", chapter(12, `${block("chapter-title", "")}\n${chapterSynopsis}\n${chapterOutline}`)],
    ["unclosed chapter", chapter(12).replace("</compose-volume-chapter>", "")],
  ])("rejects chapter batches with %s", (_description, invalidBatch) => {
    expect(() => composeVolumePlanArtifactFromText(`${volume}\n${invalidBatch}`)).toThrow(ComposeProtocolError)
  })

  it("enforces host bounds for chapter batches and volume Markdown", () => {
    const manyChapters = Array.from({ length: 51 }, (_, index) => chapter(index + 1)).join("\n")
    expect(() => composeVolumePlanArtifactFromText(manyChapters, { volume: "whole_volume" })).toThrow(/volumeChapterPlans/u)
    expect(() => composeVolumePlanArtifactFromText(block("synopsis", "文".repeat(20_001)), { volumeSynopsis: true }))
      .toThrow(/volumeSynopsis.markdown/u)
  })
})
