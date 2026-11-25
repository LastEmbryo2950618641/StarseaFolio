import type { SynopsisDiscussArtifact } from "@starseafolio/prompt-contracts"

import { normalizeNewlines } from "./markdown-search-replace.js"

export type ComposeOutlineBodyEdits = NonNullable<SynopsisDiscussArtifact["bodyEdits"]>
type OutlineWriteAuthorization = Pick<NonNullable<SynopsisDiscussArtifact["planningWriteIntent"]>, "outline">

const PATCH_START = "<compose-outline-patch>"
const PATCH_END = "</compose-outline-patch>"
const SEARCH_START = "<search>"
const SEARCH_END = "</search>"
const REPLACE_START = "<replace>"
const REPLACE_END = "</replace>"
const TAGS = new Set([PATCH_START, PATCH_END, SEARCH_START, SEARCH_END, REPLACE_START, REPLACE_END])

// Match the bodyEdits bounds in synopsisDiscussArtifactSchema.
const MAX_OPS = 20
const MAX_SEARCH_LENGTH = 20_000
const MAX_REPLACE_LENGTH = 40_000

export class ComposeOutlinePatchError extends Error {}

/**
 * Parse one patch-only reply. The caller supplies trusted authorization from
 * the current turn and pairs the result with planningWriteIntent.outline="patch".
 * The existing write path checks the actual outline and applies the ops.
 * Delimiters occupy whole lines. Other payload lines keep their whitespace,
 * with line endings normalized the same way as the search/replace applicator.
 */
export function parseComposeOutlinePatch(
  text: string,
  authorizedIntent: OutlineWriteAuthorization | undefined,
): ComposeOutlineBodyEdits {
  if (authorizedIntent?.outline !== "patch") {
    throw new ComposeOutlinePatchError("本轮未授权局部修改细纲。")
  }

  const lines = normalizeNewlines(text).split("\n")
  const ops: ComposeOutlineBodyEdits["ops"] = []
  let cursor = 0

  function fail(message: string): never {
    throw new ComposeOutlinePatchError(`细纲补丁协议错误（第 ${cursor + 1} 行）：${message}`)
  }

  function skipBlankLines(): void {
    while (cursor < lines.length && lines[cursor]!.trim().length === 0) cursor += 1
  }

  function expectTag(tag: string): void {
    if (lines[cursor] !== tag) fail(`应为独占一行的 ${tag}`)
    cursor += 1
  }

  function readPayload(open: string, close: string): string {
    expectTag(open)
    const start = cursor
    while (cursor < lines.length && !TAGS.has(lines[cursor]!)) cursor += 1
    const payload = lines.slice(start, cursor).join("\n")
    expectTag(close)
    return payload
  }

  skipBlankLines()
  expectTag(PATCH_START)
  skipBlankLines()
  while (lines[cursor] !== PATCH_END) {
    if (ops.length === MAX_OPS) fail(`最多允许 ${MAX_OPS} 条替换`)
    const oldText = readPayload(SEARCH_START, SEARCH_END)
    if (oldText.length === 0 || oldText.length > MAX_SEARCH_LENGTH) {
      fail(`搜索原文长度必须为 1–${MAX_SEARCH_LENGTH}`)
    }
    skipBlankLines()
    const newText = readPayload(REPLACE_START, REPLACE_END)
    if (newText.length > MAX_REPLACE_LENGTH) fail(`替换文本长度最多为 ${MAX_REPLACE_LENGTH}`)
    ops.push({ oldText, newText })
    skipBlankLines()
  }
  if (ops.length === 0) fail("至少需要一组搜索和替换标签")
  expectTag(PATCH_END)
  skipBlankLines()
  if (cursor !== lines.length) fail("补丁结束后只能有空白")

  return { target: "outline", ops }
}
