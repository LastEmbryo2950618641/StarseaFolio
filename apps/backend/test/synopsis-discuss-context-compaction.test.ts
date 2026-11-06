import { describe, expect, it } from "vitest"

import type { ModelContextMessage } from "@worldseed/contracts"
import { MODEL_CONTEXT_DELTA_HEADER } from "../src/application/context/model-context-appender.js"
import {
  compactDiscussContextHistory,
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

  it("preserves source evidence, planning content, assistant decisions, and repeated user constraints", () => {
    const history = Array.from({ length: 13 }, (_, index) => [
      request(`turn-${String(index)}`, index * 2 + 1, "主角不能知道凶手身份。"),
      message({ kind: "phase_response", role: "assistant", turnId: `turn-${String(index)}`,
        sequence: index * 2 + 2, content: JSON.stringify({ artifact: { assistantMessage: `保留决策${String(index)}。` } }) }),
    ]).flat()
    history[0] = message({ ...history[0]!, content: `${MODEL_CONTEXT_DELTA_HEADER}\n${JSON.stringify({ input: {
      userInput: "主角不能知道凶手身份。",
      readEvidence: [{ readId: "source-1", text: "失踪发生于五月初三，不可更改。" }],
      synopsisDiscuss: { synopsisMarkdown: "只有读者见过凶手。", outlineMarkdown: "主角只找到钥匙。" },
    } })}` })
    const result = compactDiscussContextHistory(history)
    expect(result?.summaryContent).toContain("失踪发生于五月初三，不可更改。")
    expect(result?.summaryContent).toContain("只有读者见过凶手。")
    expect(result?.summaryContent).toContain("主角只找到钥匙。")
    expect(result?.summaryContent).toContain("保留决策0。")
    const summary = JSON.parse(result!.summaryContent)
    expect(summary.userInputs).toHaveLength(5)
    const merged = compactDiscussContextHistory([
      message({ kind: "phase_instruction", sequence: 0, content: result!.summaryContent }),
      ...Array.from({ length: 12 }, (_, index) => request(`next-${String(index)}`, index + 1, "继续")),
    ])
    expect(merged?.summaryContent).toContain("失踪发生于五月初三，不可更改。")
    expect(merged?.summaryContent).toContain("保留决策0。")
  })

  it("keeps all user instructions verbatim while folding old exchanges and retaining recent turns", () => {
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

    expect(compacted).toBeDefined()
    expect(compacted?.retainedTurnCount).toBe(8)
    expect(compacted?.summarizedUserInputCount).toBe(5)
    expect(compacted?.messagesToHide).toContain("message-1")
    expect(compacted?.messagesToHide).toContain("message-10")
    expect(compacted?.messagesToHide).not.toContain("message-11")
    expect(compacted?.messagesToHide).not.toContain("message-12")
    expect(compacted?.messagesToHide).not.toContain("message-27")
    const summary = JSON.parse(compacted?.summaryContent ?? "{}") as { protocol?: string; userInputs?: string[] }
    expect(summary.protocol).toBe(DISCUSS_HISTORY_SUMMARY_PROTOCOL)
    expect(summary.userInputs).toContain("保持女主的失踪时间不变。")
    expect(summary.userInputs).toContain("用户第1项要求")
    expect(summary.userInputs).toContain("用户第5项要求")
    expect(summary.userInputs).not.toContain("用户第13项要求")
  })

  it("does not alter short histories or histories without recoverable user messages", () => {
    const short = [request("turn-1", 0, "继续")]
    expect(compactDiscussContextHistory(short)).toBeUndefined()

    const noUserInput = Array.from({ length: 13 }, (_, index) => message({
      kind: "phase_response",
      role: "assistant",
      turnId: `turn-${String(index + 1)}`,
      sequence: index,
      content: "response",
    }))
    expect(compactDiscussContextHistory(noUserInput)).toBeUndefined()
  })

  it("merges an earlier lossless summary instead of dropping its user constraints", () => {
    const priorSummary = message({
      kind: "phase_instruction",
      role: "user",
      sequence: 0,
      content: JSON.stringify({ protocol: DISCUSS_HISTORY_SUMMARY_PROTOCOL, userInputs: ["保留旧城名称。"] }),
    })
    const messages = [priorSummary, ...Array.from({ length: 12 }, (_, index) => {
      const turnId = `turn-${String(index + 1)}`
      return [
        request(turnId, index * 2 + 1, `新要求${String(index + 1)}`),
        message({ kind: "phase_response", role: "assistant", turnId, sequence: index * 2 + 2, content: "response" }),
      ]
    }).flat()]

    const compacted = compactDiscussContextHistory(messages)
    const summary = JSON.parse(compacted?.summaryContent ?? "{}") as { userInputs?: string[] }

    expect(compacted?.messagesToHide).toContain(priorSummary.messageId)
    expect(summary.userInputs).toContain("保留旧城名称。")
    expect(summary.userInputs).toContain("新要求1")
    expect(summary.userInputs).toContain("新要求4")
    expect(summary.userInputs).not.toContain("新要求12")
  })
})
