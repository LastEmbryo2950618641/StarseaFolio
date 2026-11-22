import { describe, expect, it } from "vitest"

import type { ModelContextMessage } from "@starseafolio/contracts"
import { MODEL_CONTEXT_DELTA_HEADER } from "../src/application/context/model-context-appender.js"
import {
  compactDiscussContextHistory,
  DISCUSS_ARCHIVE_NOTICE_PROTOCOL,
  DISCUSS_HISTORY_SUMMARY_PROTOCOL,
  findInvalidDiscussGateMessageIds,
} from "../src/application/chapters/discuss-session-context.js"

function message(input: Partial<ModelContextMessage> & Pick<ModelContextMessage, "kind" | "sequence" | "content">): ModelContextMessage {
  return {
    messageId: `message-${String(input.sequence)}`,
    chainId: "session-1",
    projectId: "project-1",
    role: "user",
    contentDigest: `digest-${String(input.sequence)}`,
    tokenEstimate: 1,
    createdAtMs: input.sequence,
    ...input,
  }
}

function request(turnId: string, sequence: number, userInput: string): ModelContextMessage {
  return message({
    kind: "phase_request",
    turnId,
    sequence,
    content: `${MODEL_CONTEXT_DELTA_HEADER}\n${JSON.stringify({ input: { userInput } })}`,
  })
}

describe("compactDiscussContextHistory", () => {
  it("invalidates legacy sequence gates that defer the very chapter they permit", () => {
    const gates = [1, 2].map((sequence) => message({
      kind: "phase_instruction", role: "system", sequence,
      content: JSON.stringify({ protocol: "discuss-gate-v1", gate: "chapter_sequence_publish", nextSequence: 1, deferredSequences: [sequence] }),
    }))
    expect(findInvalidDiscussGateMessageIds(gates)).toEqual(["message-1"])
  })

  it("folds older exchanges to a short archive notice and retains recent turns and tool instructions", () => {
    const messages: ModelContextMessage[] = [
      message({ kind: "system_rules", role: "system", sequence: 0, content: "authoritative rules" }),
      ...Array.from({ length: 13 }, (_, index) => {
        const turnId = `turn-${String(index + 1)}`
        const sequence = index * 2 + 1
        return [
          request(turnId, sequence, index === 1 ? "保持女主的失踪时间不变。" : `用户第${String(index + 1)}项要求`),
          message({ kind: "phase_response", role: "assistant", turnId, sequence: sequence + 1, content: `assistant response ${String(index + 1)}` }),
        ]
      }).flat(),
      message({ kind: "phase_instruction", role: "system", sequence: 27, content: JSON.stringify({ protocol: "synopsis-tools-v1", status: "completed", result: "authoritative tool result" }) }),
    ]

    const compacted = compactDiscussContextHistory(messages)
    expect(compacted?.retainedTurnCount).toBe(8)
    expect(compacted?.messagesToHide).toEqual(Array.from({ length: 10 }, (_, index) => `message-${index + 1}`))
    expect(JSON.parse(compacted?.noticeContent ?? "{}")).toMatchObject({
      protocol: DISCUSS_ARCHIVE_NOTICE_PROTOCOL,
      notice: expect.stringContaining("conversation_archive"),
    })
    expect(compacted?.noticeContent).not.toContain("保持女主的失踪时间不变。")
    expect(compacted?.noticeContent).not.toContain("assistant response 1")
  })

  it("does not fold short histories", () => {
    expect(compactDiscussContextHistory([request("turn-1", 0, "继续")])).toBeUndefined()
  })

  it("replaces a legacy summary containing verbatim history even in a short session", () => {
    const legacySummary = message({
      kind: "phase_instruction",
      role: "user",
      sequence: 0,
      content: JSON.stringify({ protocol: DISCUSS_HISTORY_SUMMARY_PROTOCOL, userInputs: ["保留旧城名称。"] }),
    })
    const compacted = compactDiscussContextHistory([legacySummary])
    expect(compacted?.messagesToHide).toEqual([legacySummary.messageId])
    expect(compacted?.noticeContent).toContain("已压缩")
    expect(compacted?.noticeContent).not.toContain("保留旧城名称。")
    const notice = message({ kind: "phase_instruction", role: "system", sequence: 1, content: compacted!.noticeContent })
    expect(compactDiscussContextHistory([legacySummary, notice])).toMatchObject({ messagesToHide: [legacySummary.messageId] })
    expect(compactDiscussContextHistory([legacySummary, notice])?.noticeContent).toBeUndefined()
  })
})
