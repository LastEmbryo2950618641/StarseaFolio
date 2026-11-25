import { synopsisDiscussGoalProposalSchema, type SynopsisDiscussArtifact } from "@starseafolio/prompt-contracts"

import { ComposeProtocolError } from "./compose-artifact.js"

export type ComposeGoalProposals = NonNullable<SynopsisDiscussArtifact["goalProposals"]>

const START = "<goal-proposals>"
const END = "</goal-proposals>"
const TEXT_KEYS = ["content", "goalId", "summary", "reason", "narrativeKind", "scale"] as const
const NUMBER_KEYS = ["chapterSequence", "plantChapterSequence", "payoffChapterSequence"] as const
const KINDS = new Set(["create", "update_content", "complete", "remove", "set_chapter_progress"])

/**
 * Parse the optional goal-proposal text block. `kind` is required per entry; a
 * `---` line separates entries. All payload fields are validated by the same
 * schema used for the host artifact, so unknown or malformed fields reject the
 * whole response instead of silently dropping a proposal.
 */
export function parseComposeGoalProposals(text: string): {
  text: string
  goalProposals?: ComposeGoalProposals
} {
  if (!text.includes(START) && !text.includes(END)) return { text }
  const start = text.indexOf(START)
  const end = text.indexOf(END, start + START.length)
  if (start < 0 || end < 0 || text.indexOf(START, start + START.length) >= 0
    || text.indexOf(END, end + END.length) >= 0) {
    throw new ComposeProtocolError("推演目标提案块不完整或重复。")
  }
  const body = text.slice(start + START.length, end)
  const groups = body.replaceAll("\r\n", "\n").split(/\n\s*---\s*\n/u)
  const proposals: ComposeGoalProposals = []
  for (const group of groups) {
    const entries = new Map<string, string>()
    for (const rawLine of group.split("\n")) {
      const line = rawLine.trim()
      if (line.length === 0) continue
      const match = /^([A-Za-z]+):\s*(\S.*)$/u.exec(line)
      const key = match?.[1]
      const value = match?.[2]
      if (key === undefined || value === undefined || entries.has(key)) {
        throw new ComposeProtocolError("推演目标提案存在重复字段或无效行。")
      }
      entries.set(key, value)
    }
    const kind = entries.get("kind")
    if (kind === undefined || !KINDS.has(kind)) throw new ComposeProtocolError("推演目标提案缺少有效 kind。")
    const payload: Record<string, unknown> = { kind }
    let reason: string | undefined
    for (const [key, value] of entries) {
      if (key === "kind") continue
      if (key === "reason") { reason = value; continue }
      if ((TEXT_KEYS as readonly string[]).includes(key)) payload[key] = value
      else if ((NUMBER_KEYS as readonly string[]).includes(key)) {
        if (!/^[1-9]\d*$/u.test(value)) throw new ComposeProtocolError(`推演目标提案字段 ${key} 必须为正整数。`)
        payload[key] = Number(value)
      } else {
        throw new ComposeProtocolError(`推演目标提案存在未知字段：${key}`)
      }
    }
    const validated = synopsisDiscussGoalProposalSchema.safeParse({
      payload,
      ...(reason === undefined ? {} : { reason }),
    })
    if (!validated.success) {
      throw new ComposeProtocolError(`推演目标提案未通过校验：${validated.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`)
    }
    proposals.push(validated.data)
  }
  if (proposals.length === 0) throw new ComposeProtocolError("推演目标提案块为空。")
  return {
    text: `${text.slice(0, start)}\n${text.slice(end + END.length)}`.trim(),
    goalProposals: proposals,
  }
}
