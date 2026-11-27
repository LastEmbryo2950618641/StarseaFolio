import { parseComposeDocument, type ComposeSection } from "@starseafolio/prompt-contracts"

const FOCUS_START = "<chapter-focus>"
const FOCUS_END = "</chapter-focus>"
const FOCUS_KIND = new Set(["plot_synopsis", "outline_discuss", "draft_discuss", "chapter_body"])

/** Read the optional chapter-focus request block; sequence is mandatory, quote and kind are optional. */
export function parseComposeFocusTag(text: string): {
  text: string
  focusChange?: { chapterSequence: number; userRequestQuote?: string; focusKind?: string }
} {
  if (!text.includes(FOCUS_START) && !text.includes(FOCUS_END)) return { text }
  const first = text.indexOf(FOCUS_START)
  const last = text.indexOf(FOCUS_END, first + FOCUS_START.length)
  if (first < 0 || last < 0 || text.indexOf(FOCUS_START, first + FOCUS_START.length) >= 0
    || text.indexOf(FOCUS_END, last + FOCUS_END.length) >= 0) {
    throw new ComposeProtocolError("换章标签不完整或重复。")
  }
  const lines = text.slice(first + FOCUS_START.length, last).replaceAll("\r\n", "\n")
    .split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  const sequence = lines[0]
  if (sequence === undefined || !/^[1-9]\d{0,4}$/u.test(sequence) || Number(sequence) > 10_000) {
    throw new ComposeProtocolError("换章标签缺少有效的章序号。")
  }
  let focusKind: string | undefined
  const quoteLines: string[] = []
  for (const line of lines.slice(1)) {
    const kind = /^focusKind:\s*(\S+)$/u.exec(line)?.[1]
    if (kind !== undefined) {
      if (!FOCUS_KIND.has(kind) || focusKind !== undefined) throw new ComposeProtocolError("换章标签的 focusKind 无效或重复。")
      focusKind = kind
    } else {
      quoteLines.push(line)
    }
  }
  const userRequestQuote = quoteLines.join("\n").trim()
  return {
    text: `${text.slice(0, first)}\n${text.slice(last + FOCUS_END.length)}`.trim(),
    focusChange: {
      chapterSequence: Number(sequence),
      ...(userRequestQuote.length === 0 ? {} : { userRequestQuote }),
      ...(focusKind === undefined ? {} : { focusKind }),
    },
  }
}

const CHAPTER_TITLE_BLOCK = /^<chapter-title>([^\n<]{1,120})<\/chapter-title>$/mu
const VOLUME_FOLDER_BLOCK = /^<volume-folder>([^\n<]{1,120})<\/volume-folder>$/mu

/** Read the host-owned chapter title and target volume tags; values must already be plain text. */
export function parseComposeHostTags(text: string): { text: string; chapterTitle?: string; volumeFolderName?: string } {
  const titles = text.match(/<chapter-title>/gu) ?? []
  const volumes = text.match(/<volume-folder>/gu) ?? []
  if (titles.length === 0 && volumes.length === 0) return { text }
  let remaining = text
  let chapterTitle: string | undefined
  let volumeFolderName: string | undefined
  if (titles.length > 0) {
    const match = CHAPTER_TITLE_BLOCK.exec(text)
    if (match === null || titles.length > 1) throw new ComposeProtocolError(`章节标题标签格式错误或重复（${String(titles.length)} 次）。`)
    chapterTitle = match[1]!.trim()
    if (chapterTitle.length === 0) throw new ComposeProtocolError("章节标题不能为空。")
    remaining = remaining.replace(match[0], "").trim()
  }
  if (volumes.length > 0) {
    const match = VOLUME_FOLDER_BLOCK.exec(remaining)
    if (match === null || volumes.length > 1) throw new ComposeProtocolError(`卷目录标签格式错误或重复（${String(volumes.length)} 次）。`)
    volumeFolderName = match[1]!.trim()
    if (volumeFolderName.length === 0) throw new ComposeProtocolError("卷目录不能为空。")
    remaining = remaining.replace(match[0], "").trim()
  }
  return { text: remaining, ...(chapterTitle === undefined ? {} : { chapterTitle }), ...(volumeFolderName === undefined ? {} : { volumeFolderName }) }
}

export class ComposeProtocolError extends Error {}

const CONTINUE_TURN_TAG = "<continue-turn/>"
const REQUEST_COMPOSE_TAG = "<request-compose/>"
const INTENT_MARKER = /^<compose-intent((?:\s+[a-z]+="(?:create|rewrite|write|whole_volume|patch)")*)\s*\/>$/u
const INTENT_ATTRIBUTE = /([a-z]+)="(create|rewrite|write|whole_volume|patch)"/gu
const INTENT_FIELDS = new Set(["synopsis", "outline", "draft", "volume"])

/** Read the optional machine-readable write-intent marker; it never reaches visible prose. */
export function extractComposeIntentMarker(text: string): {
  text: string
  intent?: { synopsis?: "create" | "rewrite"; outline?: "create" | "rewrite" | "patch"; draft?: "write"; volume?: "whole_volume" }
} {
  const lines = text.replaceAll("\r\n", "\n").split("\n")
  const markerIndex = lines.findIndex((line) => INTENT_MARKER.test(line.trim()))
  if (markerIndex < 0) return { text }
  const marker = lines[markerIndex]!.trim()
  const attributes = marker.match(INTENT_ATTRIBUTE) ?? []
  const intent: Record<string, string> = {}
  for (const attribute of attributes) {
    const [, key, value] = attribute.match(/([a-z]+)="([^"]+)"/u) ?? []
    if (key === undefined || value === undefined || !INTENT_FIELDS.has(key) || intent[key] !== undefined) {
      throw new ComposeProtocolError("构思写入意图标记存在未知或重复字段。")
    }
    intent[key] = value
  }
  if (Object.keys(intent).length === 0) throw new ComposeProtocolError("构思写入意图标记缺少有效字段。")
  if ((intent.outline === "patch" && Object.keys(intent).length > 1)
    || (intent.draft !== undefined && intent.draft !== "write")) {
    throw new ComposeProtocolError("构思写入意图标记的字段组合无效。")
  }
  return { text: lines.filter((_, index) => index !== markerIndex).join("\n").trim(), intent: intent as never }
}

/** Remove the optional auto-continue marker from visible prose and report it. */
export function extractContinueTurnMarker(text: string): { text: string; continueTurn?: true } {
  const lines = text.replaceAll("\r\n", "\n").split("\n")
  let found = false
  const kept = lines.filter((line) => {
    if (line.trim() !== CONTINUE_TURN_TAG) return true
    found = true
    return false
  })
  return found ? { text: kept.join("\n").trim(), continueTurn: true } : { text }
}

/** Remove the optional semantic compose-stage entry request marker from visible prose. */
export function extractRequestComposeMarker(text: string): { text: string; requestComposeStage?: true } {
  const lines = text.replaceAll("\r\n", "\n").split("\n")
  let found = false
  const kept = lines.filter((line) => {
    if (line.trim() !== REQUEST_COMPOSE_TAG) return true
    found = true
    return false
  })
  return found ? { text: kept.join("\n").trim(), requestComposeStage: true } : { text }
}

type ComposeWriteIntent = Readonly<{ synopsis?: "create" | "rewrite"; outline?: "create" | "rewrite"; draft?: "write" }>

export function composeSections(intent: ComposeWriteIntent): ComposeSection[] {
  return (["synopsis", "outline", "draft"] as const).filter((section) => intent[section] !== undefined)
}

export type ComposeArtifact = Readonly<{
  assistantMessage: string
  finalSelfReview: string
  synopsisBody?: string
  outlineBody?: string
  chapterDraftProposal?: Readonly<{ base: "body"; heading: string; body: string }>
  planningWriteIntent?: Readonly<{ synopsis?: "create" | "rewrite"; outline?: "create" | "rewrite"; draft?: "write" }>
}>

/**
 * Convert a pure-text compose response into the existing discuss artifact shape.
 * Protocol tags are stripped; the remaining prose is the visible assistant message.
 */
export function composeArtifactFromText(
  text: string,
  authorizedIntent?: ComposeWriteIntent,
): ComposeArtifact {
  const expected = authorizedIntent === undefined
    ? (["synopsis", "outline", "draft"] as const).filter((section) => text.includes(`<compose-${section}>`))
    : composeSections(authorizedIntent)
  const parsed = parseComposeDocument(text, expected)
  if (parsed.errors.length > 0) {
    throw new ComposeProtocolError(`构思流协议错误：${parsed.errors.join("；")}`)
  }
  const synopsisBody = parsed.sections.synopsis?.trim()
  const outlineBody = parsed.sections.outline?.trim()
  const draftText = parsed.sections.draft?.trim()
  const draft = draftText === undefined ? undefined : splitDraft(draftText)
  const bodies = { synopsis: synopsisBody, outline: outlineBody, draft: draft?.body }
  if (authorizedIntent !== undefined && expected.some((section) => !bodies[section])) {
    throw new ComposeProtocolError("构思响应缺少完整的梗概、细纲或草稿正文，本次响应不会写入。")
  }
  const visible = parsed.text.trim()
  const planningWriteIntent = {
    ...(synopsisBody === undefined ? {} : { synopsis: authorizedIntent?.synopsis ?? "create" as const }),
    ...(outlineBody === undefined ? {} : { outline: authorizedIntent?.outline ?? "create" as const }),
    ...(draft === undefined ? {} : { draft: "write" as const }),
  }
  const hasDeliverables = Object.keys(planningWriteIntent).length > 0
  return {
    assistantMessage: visible.length > 0 ? visible : "已完成构思。",
    finalSelfReview: hasDeliverables ? "构思产物已按本轮标签协议解析。" : "讨论文本已解析。",
    ...(synopsisBody === undefined ? {} : { synopsisBody }),
    ...(outlineBody === undefined ? {} : { outlineBody }),
    ...(draft === undefined ? {} : { chapterDraftProposal: draft }),
    ...(Object.keys(planningWriteIntent).length === 0 ? {} : { planningWriteIntent }),
  }
}

function splitDraft(text: string): Readonly<{ base: "body"; heading: string; body: string }> {
  const lines = text.split("\n")
  const headingIndex = lines.findIndex((line) => /^#\s+\S/u.test(line))
  if (headingIndex < 0) return { base: "body", heading: "正文", body: text }
  return {
    base: "body",
    heading: lines[headingIndex]!.replace(/^#\s+/u, "").trim(),
    body: [...lines.slice(0, headingIndex), ...lines.slice(headingIndex + 1)].join("\n").trim(),
  }
}
