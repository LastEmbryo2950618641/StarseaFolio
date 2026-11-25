import {
  synopsisDiscussArtifactSchema,
  type DiscussTurnWriteScope,
  type SynopsisDiscussArtifact,
} from "@starseafolio/prompt-contracts"

import { ComposeProtocolError } from "./compose-artifact.js"
import { volumePlanningMarkdownHasContent } from "./volume-planning-gate.js"

export type ComposeVolumePlanScope = Pick<DiscussTurnWriteScope,
  "volumeSynopsis" | "volumeOutline" | "volumeTargets" | "volume">

export type ComposeVolumePlanArtifact = Pick<SynopsisDiscussArtifact,
  "assistantMessage" | "finalSelfReview" | "volumeSynopsis" | "arcPlan" | "volumePlanMeta"
  | "volumeChapterPlans" | "planningWriteIntent">

type ChapterPlan = NonNullable<ComposeVolumePlanArtifact["volumeChapterPlans"]>[number]
type MarkdownBlock = "synopsis" | "outline" | "chapter-synopsis" | "chapter-outline"

const protocolMarker = /<\/?compose-/iu
const chapterStart = /^<compose-volume-chapter index="([1-9][0-9]*)">$/u
const chapterEnd = "</compose-volume-chapter>"
const defaultScope: ComposeVolumePlanScope = { volumeSynopsis: true, volumeOutline: true, volumeTargets: true }

/** Optional leading prose, ordered volume blocks selected by scope, then zero or more chapter blocks.
 * Without an explicit scope, all three volume blocks are required and chapter blocks are optional.
 * Chapter indexes are absolute chapter sequences. The host owns authorization and the active volume range.
 */
export function composeVolumePlanArtifactFromText(
  text: string,
  scope?: ComposeVolumePlanScope,
): ComposeVolumePlanArtifact {
  const requested = scope ?? defaultScope
  const reader = new VolumePlanReader(text)
  const prose = reader.readProse()
  const synopsis = requested.volumeSynopsis === true ? reader.readMarkdown("synopsis") : undefined
  const outline = requested.volumeOutline === true ? reader.readMarkdown("outline") : undefined
  const meta = requested.volumeTargets === true ? reader.readMeta() : undefined
  const chapters = scope === undefined || scope.volume === "whole_volume" ? reader.readChapters() : []
  if (requested.volume === "whole_volume" && chapters.length === 0) fail("缺少卷内章计划块")
  reader.finish()

  const artifact: ComposeVolumePlanArtifact = {
    assistantMessage: prose || "已整理本卷规划。",
    finalSelfReview: "卷规划产物已按本轮标签协议解析。",
    ...(synopsis === undefined ? {} : { volumeSynopsis: { markdown: synopsis } }),
    ...(outline === undefined ? {} : { arcPlan: { markdown: outline } }),
    ...(meta === undefined ? {} : { volumePlanMeta: meta }),
    ...(chapters.length === 0 ? {} : {
      volumeChapterPlans: chapters,
      planningWriteIntent: { volume: "whole_volume" },
    }),
  }
  const validated = synopsisDiscussArtifactSchema.safeParse(artifact)
  if (!validated.success) {
    fail(validated.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；"))
  }
  return artifact
}

class VolumePlanReader {
  private readonly lines: string[]
  private cursor = 0

  constructor(text: string) {
    this.lines = text.replaceAll("\r\n", "\n").split("\n")
  }

  readProse(): string {
    const start = this.cursor
    for (let line = this.lines[this.cursor]; line !== undefined; line = this.lines[this.cursor]) {
      if (protocolMarker.test(line) || /^\s*<\/?[a-z][\w-]*\b/iu.test(line)) break
      if (/^\s*(?:`{3,}|~{3,})/u.test(line)) fail("请直接输出标签，不要使用代码围栏包裹响应")
      this.cursor += 1
    }
    return this.lines.slice(start, this.cursor).join("\n").trim()
  }

  readMarkdown(block: MarkdownBlock): string {
    const body = this.readBlock(block)
    if (!volumePlanningMarkdownHasContent(body)) fail(`<compose-volume-${block}> 缺少有效正文`)
    return body
  }

  readMeta(): NonNullable<ComposeVolumePlanArtifact["volumePlanMeta"]> {
    const [countLine, wordsLine, notesLine, ...extra] = this.readBlock("meta").split("\n")
    const targetChapterCount = countLine?.match(/^targetChapterCount: ([1-9][0-9]*)$/u)?.[1]
    const targetWordCount = wordsLine?.match(/^targetWordCount: ([1-9][0-9]*)$/u)?.[1]
    const notes = notesLine?.match(/^notes: (\S.*)$/u)?.[1]?.trim()
    if (targetChapterCount === undefined || targetWordCount === undefined
      || (notesLine !== undefined && notes === undefined) || extra.length > 0) {
      fail("<compose-volume-meta> 需要依次填写 targetChapterCount: 正整数、targetWordCount: 正整数，可选 notes: 备注")
    }
    return {
      targetChapterCount: Number(targetChapterCount),
      targetWordCount: Number(targetWordCount),
      ...(notes === undefined ? {} : { notes }),
    }
  }

  readChapters(): ChapterPlan[] {
    const plans: ChapterPlan[] = []
    const seen = new Set<number>()
    for (let line = this.nextNonBlank(); line !== undefined; line = this.nextNonBlank()) {
      const index = line.match(chapterStart)?.[1]
      if (index === undefined) break
      this.cursor += 1
      const chapterSequence = Number(index)
      if (seen.has(chapterSequence)) fail(`章序号 ${index} 重复`)
      seen.add(chapterSequence)
      const chapterTitle = this.nextNonBlank() === "<compose-volume-chapter-title>"
        ? this.readBlock("chapter-title")
        : undefined
      if (chapterTitle !== undefined && (chapterTitle.length === 0 || chapterTitle.includes("\n"))) {
        fail(`<compose-volume-chapter-title> 需要非空的单行标题（第 ${index} 章）`)
      }
      const synopsisBody = this.readMarkdown("chapter-synopsis")
      const outlineBody = this.readMarkdown("chapter-outline")
      this.expect(chapterEnd)
      plans.push({ chapterSequence, synopsisBody, outlineBody, ...(chapterTitle === undefined ? {} : { chapterTitle }) })
    }
    return plans
  }

  finish(): void {
    if (this.nextNonBlank() !== undefined) fail(`第 ${this.cursor + 1} 行存在额外内容、未授权块或无效标签`)
  }

  private readBlock(block: MarkdownBlock | "meta" | "chapter-title"): string {
    const open = `<compose-volume-${block}>`
    const close = `</compose-volume-${block}>`
    this.expect(open)
    const start = this.cursor
    for (let line = this.lines[this.cursor]; line !== undefined; line = this.lines[this.cursor]) {
      if (line === close) {
        const content = this.lines.slice(start, this.cursor).join("\n").trim()
        this.cursor += 1
        return content
      }
      if (protocolMarker.test(line)) fail(`第 ${this.cursor + 1} 行应闭合 ${open}，标签不能嵌套或写在正文行中`)
      this.cursor += 1
    }
    return fail(`缺少 ${close}`)
  }

  private nextNonBlank(): string | undefined {
    let line = this.lines[this.cursor]
    while (line !== undefined && line.trim().length === 0) {
      this.cursor += 1
      line = this.lines[this.cursor]
    }
    return line
  }

  private expect(tag: string): void {
    if (this.nextNonBlank() !== tag) fail(`第 ${this.cursor + 1} 行应为 ${tag}`)
    this.cursor += 1
  }
}

function fail(message: string): never {
  throw new ComposeProtocolError(`卷规划协议错误：${message}`)
}
