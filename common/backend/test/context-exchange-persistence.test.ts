import { describe, expect, it } from "vitest"

import {
  filterNovelContextExchangeMessages,
  findEphemeralDiscussContextMessageIds,
  findExactDuplicateStaticMessageIds,
} from "../src/application/context/context-exchange-persistence.js"
import { estimateModelMessageTokens } from "../src/application/context/context-window-manager.js"
import type { ModelContextMessage, ModelContextMessageDraft } from "@starseafolio/contracts"
import { digest } from "../src/core/index.js"

function stored(
  partial: Pick<ModelContextMessage, "kind" | "content" | "sequence"> & Partial<ModelContextMessage>,
): ModelContextMessage {
  const content = partial.content ?? "x"
  return {
    messageId: partial.messageId ?? crypto.randomUUID(),
    chainId: partial.chainId ?? crypto.randomUUID(),
    projectId: partial.projectId ?? "11111111-1111-4111-8111-111111111111",
    sequence: partial.sequence,
    role: partial.role ?? "user",
    kind: partial.kind,
    ...(partial.taskId === undefined ? {} : { taskId: partial.taskId }),
    ...(partial.turnId === undefined ? {} : { turnId: partial.turnId }),
    ...(partial.phase === undefined ? {} : { phase: partial.phase }),
    content,
    contentDigest: digest(content),
    tokenEstimate: estimateModelMessageTokens(content),
    createdAtMs: 1,
  }
}

describe("filterNovelContextExchangeMessages", () => {
  it("keeps the first static instruction and skips later identical copies", () => {
    const instruction = "# synopsis_discuss\n阶段提示"
    const contract = "MANDATORY OUTPUT CONTRACT - this is the final"
    const existing = [
      stored({ kind: "phase_instruction", content: instruction, sequence: 0 }),
      stored({ kind: "phase_request", content: contract, sequence: 1 }),
    ]
    const drafts: ModelContextMessageDraft[] = [
      { role: "user", kind: "phase_request", content: "Worldseed context delta JSON:\n{\"phase\":\"x\"}" },
      { role: "user", kind: "phase_instruction", content: instruction },
      { role: "user", kind: "phase_protocol", content: "protocol" },
      { role: "user", kind: "phase_request", content: contract },
      { role: "assistant", kind: "phase_response", content: "{\"ok\":true}" },
    ]
    const kept = filterNovelContextExchangeMessages(existing, drafts)
    expect(kept.map((message) => message.kind)).toEqual([
      "phase_request",
      "phase_protocol",
      "phase_response",
    ])
  })

  it("finds later exact duplicates for cleanup", () => {
    const instruction = "# synopsis_discuss\n阶段提示"
    const messages = [
      stored({ kind: "phase_instruction", content: instruction, sequence: 0, messageId: "keep" }),
      stored({ kind: "phase_instruction", content: instruction, sequence: 1, messageId: "dup-a" }),
      stored({ kind: "phase_instruction", content: instruction, sequence: 2, messageId: "dup-b" }),
      stored({ kind: "phase_response", content: "reply", sequence: 3, messageId: "reply" }),
    ]
    expect(findExactDuplicateStaticMessageIds(messages)).toEqual(["dup-a", "dup-b"])
  })
})

describe("discussion call-scoped prompt persistence", () => {
  it("keeps the latest call attachments available for usage accounting", () => {
    const messages: ModelContextMessageDraft[] = [
      { role: "user", kind: "phase_request", taskId: "task", turnId: "turn", phase: "synopsis_discuss", content: "Worldseed context delta JSON:\n{\"phase\":\"synopsis_discuss\"}" },
      { role: "user", kind: "phase_instruction", taskId: "task", turnId: "turn", phase: "synopsis_discuss", content: "# synopsis_discuss\n动态阶段提示" },
      { role: "user", kind: "phase_protocol", taskId: "task", turnId: "turn", phase: "synopsis_discuss", content: "Worldseed protocol v1" },
      { role: "user", kind: "phase_request", taskId: "task", turnId: "turn", phase: "synopsis_discuss", content: "MANDATORY OUTPUT CONTRACT\n动态 schema 与引用别名" },
      { role: "assistant", kind: "phase_response", taskId: "task", turnId: "turn", phase: "synopsis_discuss", content: "{\"outcome\":\"continue\",\"artifact\":{\"assistantMessage\":\"已处理\"}}" },
    ]

    expect(filterNovelContextExchangeMessages([], messages).map((message) => message.kind)).toEqual([
      "phase_request",
      "phase_instruction",
      "phase_protocol",
      "phase_request",
      "phase_response",
    ])
  })

  it("cleans old call-scoped prompt copies but keeps default skills and semantic tool results", () => {
    const messages = [
      stored({ kind: "phase_instruction", role: "system", content: "【skill-pack:synopsis_discuss】默认技能", sequence: 0 }),
      stored({ kind: "phase_instruction", role: "user", content: "# synopsis_discuss\n旧阶段提示", sequence: 1, taskId: "task", turnId: "turn", phase: "synopsis_discuss", messageId: "old-prompt" }),
      stored({ kind: "phase_protocol", role: "user", content: "Worldseed protocol v1", sequence: 2, taskId: "task", turnId: "turn", phase: "synopsis_discuss", messageId: "old-protocol" }),
      stored({ kind: "phase_request", role: "user", content: "MANDATORY OUTPUT CONTRACT\n旧 schema", sequence: 3, taskId: "task", turnId: "turn", phase: "synopsis_discuss", messageId: "old-contract" }),
      stored({ kind: "phase_instruction", role: "system", content: "{\"protocol\":\"synopsis-tools-v1\",\"name\":\"todo_write\"}", sequence: 4, messageId: "tool-result" }),
    ]

    expect(findEphemeralDiscussContextMessageIds(messages)).toEqual([
      "old-prompt",
      "old-protocol",
      "old-contract",
    ])
  })
})
