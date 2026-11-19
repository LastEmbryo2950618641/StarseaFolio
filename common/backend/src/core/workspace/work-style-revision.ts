import { WORK_DESCRIPTION_MAX_CHARS } from "./work-description-rules.js"
import { WORK_STYLE_REQUIRED_HEADINGS, isWorkStyleComplete } from "./work-style-gate.js"

const USER_REQUIREMENT_MAX_CHARS = 12_000
const MIN_QUOTE_CHARS = 4
/** Compact chapter body must be at least this long to count as distillable prose. */
const MIN_BODY_CHARS = 24
const STYLE_ANCHOR_HEADING = "## 1. 语体笔风"
const STYLE_PATH_PATTERN = /表现输出\/(?:笔风规则|小说大类规则|小说次大类规则)\/[^\s，。；;）)]+\.md/gu
const PUBLISH_ONLY_QUOTES = new Set([
  "草稿可以，发布正文",
  "草稿可以,发布正文",
  "发布正文",
  "确认发布",
  "可以发布",
])

export type WorkStyleSectionSource = "user" | "body"

export type WorkStyleSectionUpdate = Readonly<{
  heading: string
  mode: string
  content: string
  userQuote: string
  source?: WorkStyleSectionSource
}>

export type WorkStyleRevisionResult = Readonly<{
  markdown: string
  applied: readonly string[]
  skipped: readonly string[]
}>

/** Recent visible user messages, keeping the tail when the history is long. */
export function collectUserRequirementText(
  messages: readonly Readonly<{ role: string; content: string; hidden?: boolean | undefined }>[],
): string {
  const parts = messages.flatMap((message) => {
    if (message.role !== "user" || message.hidden === true) return []
    const text = message.content.trim()
    return text.length === 0 ? [] : [text]
  })
  const joined = parts.join("\n\n")
  return joined.length <= USER_REQUIREMENT_MAX_CHARS
    ? joined
    : joined.slice(joined.length - USER_REQUIREMENT_MAX_CHARS)
}

/**
 * User-spoken style requirements only.
 * Revision publish stores the chapter body in `userInput`; that body is not returned here.
 */
export function resolveWorkStyleRequirementSource(input: Readonly<{
  workflow?: string
  userInput: string
  userRequirements?: string
}>): string {
  const explicit = input.userRequirements?.trim() ?? ""
  if (explicit.length > 0) return explicit
  if (input.workflow === "revision") return ""
  return input.userInput.trim()
}

/** True when revision `userInput` has enough prose to distill presentation style. */
export function hasWorkStyleBodySource(userInput: string | undefined): boolean {
  if (userInput === undefined) return false
  return compact(userInput).length >= MIN_BODY_CHARS
}

/**
 * Fold presentation constraints into 作品风格.md from user words and/or chapter body.
 * Merge keeps every existing sentence and adds what is new. Replace rewrites one
 * section only when the update is marked as a contradiction (user source only).
 */
export function applyWorkStyleRevision(input: Readonly<{
  current: string
  updates: readonly WorkStyleSectionUpdate[]
  userRequirements: string
  chapterBody?: string
}>): WorkStyleRevisionResult {
  const requirements = input.userRequirements.trim()
  const chapterBody = input.chapterBody?.trim() ?? ""
  if (!isWorkStyleComplete(input.current)) {
    return {
      markdown: input.current,
      applied: [],
      skipped: input.updates.map((update) => `${update.heading}:当前风格未完成`),
    }
  }
  if (requirements.length === 0 && !hasWorkStyleBodySource(chapterBody)) {
    return {
      markdown: input.current,
      applied: [],
      skipped: input.updates.map((update) => `${update.heading}:缺少可用的用户要求或正文`),
    }
  }
  let markdown = input.current.replaceAll("\r\n", "\n")
  const applied: string[] = []
  const skipped: string[] = []
  for (const update of input.updates) {
    const heading = update.heading.trim()
    if (!isRequiredHeading(heading)) {
      skipped.push(`${heading}:不是作品风格的固定小节`)
      continue
    }
    const source: WorkStyleSectionSource = update.source === "body" ? "body" : "user"
    if (source === "body") {
      if (!hasWorkStyleBodySource(chapterBody)) {
        skipped.push(`${heading}:缺少可蒸馏的正文`)
        continue
      }
      if (!quoteIsUsable(update.userQuote, chapterBody)) {
        skipped.push(`${heading}:引用对不上正文`)
        continue
      }
      if (update.mode === "replace") {
        skipped.push(`${heading}:正文蒸馏禁止 replace`)
        continue
      }
    } else if (!quoteIsUsable(update.userQuote, requirements)) {
      skipped.push(`${heading}:引用对不上用户要求`)
      continue
    }
    const content = stripHeading(heading, update.content)
    if (content.length === 0) {
      skipped.push(`${heading}:没有可写入的正文`)
      continue
    }
    // Body distill never supplies new style-rule paths; pass empty requirements for anchors.
    const anchorRequirements = source === "body" ? "" : requirements
    const next = source === "body" || update.mode !== "replace"
      ? applyMerge(markdown, heading, content, anchorRequirements)
      : applyReplace(markdown, heading, content, anchorRequirements)
    if (next === undefined) {
      skipped.push(`${heading}:无法在保留原约束的前提下写入`)
      continue
    }
    if (next === markdown) {
      skipped.push(`${heading}:内容已在该节中`)
      continue
    }
    if (next.length > WORK_DESCRIPTION_MAX_CHARS || !isWorkStyleComplete(next)) {
      skipped.push(`${heading}:写入后会破坏八维门禁或超出字数`)
      continue
    }
    markdown = next
    applied.push(heading)
  }
  return { markdown: applied.length === 0 ? input.current : markdown, applied, skipped }
}

function applyMerge(
  markdown: string,
  heading: string,
  content: string,
  requirements: string,
): string | undefined {
  const oldBody = sectionBody(markdown, heading)
  if (compact(oldBody).includes(compact(content))) return markdown
  const fused = oldLinesSurvive(oldBody, content) && preservesStyleAnchors(heading, oldBody, content, requirements)
  if (fused) return replaceSectionBody(markdown, heading, content)
  const addition = novelLines(oldBody, content)
  if (addition.length === 0) return undefined
  if (!preservesStyleAnchors(heading, oldBody, `${oldBody.trim()}\n\n${addition}`, requirements)) {
    return undefined
  }
  return replaceSectionBody(markdown, heading, `${oldBody.trim()}\n\n${addition}`)
}

function applyReplace(
  markdown: string,
  heading: string,
  content: string,
  requirements: string,
): string | undefined {
  const oldBody = sectionBody(markdown, heading)
  if (!preservesStyleAnchors(heading, oldBody, content, requirements)) return undefined
  if (compact(oldBody) === compact(content)) return markdown
  return replaceSectionBody(markdown, heading, content)
}

function isRequiredHeading(heading: string): boolean {
  return (WORK_STYLE_REQUIRED_HEADINGS as readonly string[]).includes(heading)
}

function quoteIsUsable(quote: string, sourceText: string): boolean {
  const compactQuote = compact(quote)
  if (compactQuote.length < MIN_QUOTE_CHARS) return false
  if (PUBLISH_ONLY_QUOTES.has(compactQuote)) return false
  return compact(sourceText).includes(compactQuote)
}

function preservesStyleAnchors(
  heading: string,
  oldBody: string,
  nextBody: string,
  requirements: string,
): boolean {
  if (heading !== STYLE_ANCHOR_HEADING) return true
  const userSuppliesNewPath = /笔风规则\/|小说大类规则\/|小说次大类规则\//u.test(requirements)
  if (userSuppliesNewPath) return true
  const paths = oldBody.match(STYLE_PATH_PATTERN) ?? []
  return paths.every((path) => nextBody.includes(path))
}

function oldLinesSurvive(oldBody: string, nextBody: string): boolean {
  const lines = substantiveLines(oldBody)
  if (lines.length === 0) return true
  const next = compact(nextBody)
  return lines.every((line) => next.includes(compact(line)))
}

function novelLines(oldBody: string, content: string): string {
  const old = compact(oldBody)
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !old.includes(compact(line)))
    .join("\n")
}

function substantiveLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[（(]须含/u.test(line) && compact(line).length >= 8)
}

function stripHeading(heading: string, content: string): string {
  const trimmed = content.trim()
  return trimmed.startsWith(heading) ? trimmed.slice(heading.length).trim() : trimmed
}

function sectionBody(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading)
  if (start < 0) return ""
  const after = markdown.slice(start + heading.length)
  const next = after.search(/\n##\s/u)
  return (next < 0 ? after : after.slice(0, next)).trim()
}

function replaceSectionBody(markdown: string, heading: string, body: string): string | undefined {
  const start = markdown.indexOf(heading)
  if (start < 0) return undefined
  const head = markdown.slice(0, start + heading.length)
  const after = markdown.slice(start + heading.length)
  const next = after.search(/\n##\s/u)
  const tail = next < 0 ? "" : after.slice(next + 1)
  return `${head}\n\n${body.trim()}${tail.length === 0 ? "\n" : `\n\n${tail}`}`
}

function compact(text: string): string {
  return text.replace(/\s+/gu, "")
}
