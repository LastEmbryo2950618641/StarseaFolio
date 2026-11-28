import type { SynopsisDiscussArtifact } from "@starseafolio/prompt-contracts"

import { ComposeProtocolError } from "./compose-artifact.js"

export type ComposeToolRequest = NonNullable<SynopsisDiscussArtifact["toolRequest"]>

const TAG_NAMES = ["tool-request", "compose-tool-request", "toolRequest"] as const
const TOOL_NAMES = new Set([
  "chapter_workflow", "publish_draft", "restage_chapter", "bash", "todo_write", "memory_write",
  "load_skill", "conversation_archive", "original_work_search", "original_work_download",
  "character_update", "rename_chapter", "update_work_metadata",
])

/** Parse the optional plain-text tool request block used for non-native tools. */
export function parseComposeToolRequest(text: string): {
  text: string
  toolRequest?: ComposeToolRequest
} {
  const tag = TAG_NAMES.find((name) => text.includes(`<${name}>`))
  if (tag === undefined) return { text }
  const startTag = `<${tag}>`
  const endTag = `</${tag}>`
  const start = text.indexOf(startTag)
  const end = text.indexOf(endTag, start + startTag.length)
  if (start < 0 || end < 0 || text.indexOf(startTag, start + startTag.length) >= 0
    || text.indexOf(endTag, end + endTag.length) >= 0) {
    throw new ComposeProtocolError("工具请求块不完整或重复。")
  }
  const body = text.slice(start + startTag.length, end).trim()
  let parsed: Record<string, unknown>
  if (body.startsWith("{")) {
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      throw new ComposeProtocolError("工具请求 JSON 无法解析。")
    }
  } else {
    parsed = {}
    for (const line of body.split(/\r?\n/u)) {
      const match = /^([A-Za-z]+):\s*([\s\S]*)$/u.exec(line.trim())
      if (match === null || parsed[match[1]!] !== undefined) {
        throw new ComposeProtocolError("工具请求块存在重复字段或无效行。")
      }
      parsed[match[1]!] = match[2]!.trim()
    }
  }
  const name = parsed.name
  const action = parsed.action
  if (typeof name !== "string" || !TOOL_NAMES.has(name)) throw new ComposeProtocolError("工具请求缺少有效工具名。")
  if (action !== "describe" && action !== "invoke") throw new ComposeProtocolError("工具请求的 action 必须为 describe 或 invoke。")
  const rawArguments = parsed.arguments
  const argumentText = rawArguments === undefined
    ? undefined
    : typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments)
  if (action === "invoke" && argumentText !== undefined) {
    try {
      JSON.parse(argumentText)
    } catch {
      throw new ComposeProtocolError("工具请求的 arguments 必须是有效 JSON。")
    }
  }
  if (action === "describe" && argumentText !== undefined) {
    throw new ComposeProtocolError("describe 工具请求不应带 arguments。")
  }
  return {
    text: `${text.slice(0, start)}\n${text.slice(end + endTag.length)}`.trim(),
    toolRequest: {
      name: name as ComposeToolRequest["name"],
      action,
      ...(argumentText === undefined ? {} : { arguments: argumentText }),
    },
  }
}
