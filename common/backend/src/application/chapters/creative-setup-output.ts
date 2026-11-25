import { characterProfileSchema, type CharacterFieldValue, type SynopsisConversationChoice } from "@starseafolio/contracts"
import type { CreativeSetupState } from "./creative-setup-state.js"

export type CreativeSetupOutput = Readonly<{
  assistantMessage: string
  choices?: readonly SynopsisConversationChoice[]
  workDisplayName?: string
  workDescription?: string
  protagonistSupplementMarkdown?: string
  protagonistSupplementFields?: Record<string, CharacterFieldValue>
}>

const choicesStart = "<creative-choices>"
const choicesEnd = "</creative-choices>"
const supplementStart = "<creative-character-json>"
const supplementEnd = "</creative-character-json>"

/** Parse creative setup's scoped plain-text response. The only JSON channel is a separately validated character-field payload. */
export function parseCreativeSetupOutput(text: string, state: CreativeSetupState): CreativeSetupOutput {
  const { prose, ...metadata } = parseWorkMetadataTags(text)
  if (state.status === "collecting") return { ...parseDiscussChoices(prose), ...metadata }
  if (state.status === "awaiting_write" && state.scope === "protagonist") return { ...parseCharacterSupplement(prose), ...metadata }
  return { assistantMessage: prose.trim() || "已按用户确认推进设定。", ...metadata }
}

export function parseWorkMetadataTags(text: string): { prose: string; workDisplayName?: string; workDescription?: string } {
  const metadata: { workDisplayName?: string; workDescription?: string } = {}
  for (const [tag, field, limit] of [["work-title", "workDisplayName", 120], ["work-description", "workDescription", 300]] as const) {
    const start = `<${tag}>`
    const end = `</${tag}>`
    if (!text.includes(start) && !text.includes(end)) continue
    const block = extractBlock(text, start, end)
    if (!block.content || block.content.length > limit) throw new Error(`无效的 ${start} 内容`)
    metadata[field] = block.content
    text = `${block.before}\n${block.after}`
  }
  return { prose: text, ...metadata }
}

export function extractBlock(text: string, start: string, end: string): { before: string; content: string; after: string } {
  const first = text.indexOf(start)
  if (first < 0) throw new Error(`缺少 ${start} 输出块`)
  const contentStart = first + start.length
  const last = text.indexOf(end, contentStart)
  if (last < 0 || text.indexOf(start, contentStart) >= 0 || text.indexOf(end) !== last || text.indexOf(end, last + end.length) >= 0) {
    throw new Error(`${start} 输出块不完整或重复`)
  }
  return { before: text.slice(0, first), content: text.slice(contentStart, last).trim(), after: text.slice(last + end.length) }
}

export function parseDiscussChoices(text: string): CreativeSetupOutput {
  const block = extractBlock(text, choicesStart, choicesEnd)
  if (text.indexOf(choicesStart, text.indexOf(choicesEnd) + choicesEnd.length) >= 0
    || text.indexOf(choicesEnd) !== text.lastIndexOf(choicesEnd)) throw new Error("创作选项块格式错误")
  const choices = block.content.split(/\r?\n/u).map(line => line.trim())
    .filter(line => /^[-*]\s+\S/u.test(line)).map(line => line.replace(/^[-*]\s+/u, "").trim())
  const unique = [...new Set(choices)]
  if (unique.length < 2) throw new Error("创作设定问答至少需要两个不同选项")
  const prose = `${block.before}${block.after}`.trim()
  return { assistantMessage: prose || "请选择一个方向，或直接告诉我你的想法。",
    choices: unique.map(label => ({ label, action: "continue_discuss" as const })) }
}

function parseCharacterSupplement(text: string): CreativeSetupOutput {
  const block = extractBlock(text, supplementStart, supplementEnd)
  if (block.content.length === 0) throw new Error("人物补充 JSON 不能为空")
  const parsed = JSON.parse(block.content) as unknown
  const fields = characterProfileSchema.parse({ schemaVersion: 1, fields: parsed }).fields as Record<string, CharacterFieldValue>
  if (Object.keys(fields).length === 0) throw new Error("至少提供一个有效的人物补充字段")
  const prose = `${block.before}${block.after}`.trim()
  const markdown = prose || "已依据用户确认的核心设定整理人物补充。"
  return { assistantMessage: markdown, protagonistSupplementMarkdown: markdown, protagonistSupplementFields: fields }
}

