import { synopsisStagingPromoteArtifactSchema, type SynopsisDiscussArtifact } from "@starseafolio/prompt-contracts"

import { ComposeProtocolError } from "./compose-artifact.js"

export type ComposeStagingPromote = NonNullable<SynopsisDiscussArtifact["stagingPromote"]>

const START = "<staging-promote>"
const END = "</staging-promote>"
const WRITE_START = /^<staging-write\s+([^>]*)>$/u
const WRITE_END = "</staging-write>"
const ATTRIBUTE = /([a-zA-Z]+)="([^"]*)"/gu

/**
 * Parse the optional settings-promote proposal block. Each `<staging-write>`
 * carries entry/path/mode attributes plus a Markdown body; the final
 * `reason: ...` line is optional. The whole block is validated by the same
 * schema that the host uses before creating pending proposals.
 */
export function parseComposeStagingPromote(text: string): {
  text: string
  stagingPromote?: ComposeStagingPromote
} {
  if (!text.includes(START) && !text.includes(END)) return { text }
  const start = text.indexOf(START)
  const end = text.indexOf(END, start + START.length)
  if (start < 0 || end < 0 || text.indexOf(START, start + START.length) >= 0
    || text.indexOf(END, end + END.length) >= 0) {
    throw new ComposeProtocolError("设定集落盘提案块不完整或重复。")
  }
  const lines = text.slice(start + START.length, end).replaceAll("\r\n", "\n").split("\n")
  const writes: ComposeStagingPromote["settingsWrites"] = []
  let reason: string | undefined
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!.trim()
    if (line.length === 0) { index += 1; continue }
    if (line.startsWith("reason:")) {
      reason = line.slice("reason:".length).trim()
      if (reason.length === 0) throw new ComposeProtocolError("设定集落盘提案的 reason 不能为空。")
      index += 1
      continue
    }
    const header = WRITE_START.exec(line)
    if (header === null) throw new ComposeProtocolError(`设定集落盘提案存在无效行：${line.slice(0, 40)}`)
    const attributes = new Map<string, string>()
    for (const match of header[1]!.matchAll(ATTRIBUTE)) attributes.set(match[1]!, match[2]!)
    const entryId = attributes.get("entry")
    const relativePath = attributes.get("path")
    const mode = attributes.get("mode")
    const readmeEntry = attributes.get("readme")
    if (attributes.size > 4 || entryId === undefined || relativePath === undefined || mode === undefined) {
      throw new ComposeProtocolError("设定集落盘提案需要 entry、path、mode 属性。")
    }
    const body: string[] = []
    index += 1
    while (index < lines.length && lines[index]!.trim() !== WRITE_END) {
      body.push(lines[index]!)
      index += 1
    }
    if (index >= lines.length) throw new ComposeProtocolError("设定集落盘提案缺少 </staging-write>。")
    index += 1
    const markdown = body.join("\n").trim()
    if (markdown.length === 0) throw new ComposeProtocolError("设定集落盘提案的正文不能为空。")
    writes.push({
      entryId,
      relativePath,
      markdown,
      mode: mode as "create" | "update",
      ...(readmeEntry === undefined || readmeEntry.length === 0 ? {} : { readmeEntry }),
    })
  }
  if (writes.length === 0) throw new ComposeProtocolError("设定集落盘提案块为空。")
  const validated = synopsisStagingPromoteArtifactSchema.safeParse({
    settingsWrites: writes,
    ...(reason === undefined ? {} : { reason }),
  })
  if (!validated.success) {
    throw new ComposeProtocolError(`设定集落盘提案未通过校验：${validated.error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`)
  }
  return {
    text: `${text.slice(0, start)}\n${text.slice(end + END.length)}`.trim(),
    stagingPromote: validated.data,
  }
}
