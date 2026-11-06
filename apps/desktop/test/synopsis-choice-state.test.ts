import { describe, expect, it } from "vitest"
import type { SynopsisConversationChoice, SynopsisConversationMessage } from "@worldseed/contracts"

import {
  choiceContribution, choiceIdentity, createChoiceComposer, formatChoiceStyle,
  latestSetupQuestionId, loadChoiceVariant, persistChoiceVariant,
} from "../src/renderer/src/features/editor/synopsis-choice-state.js"

const message: SynopsisConversationMessage = {
  projectId: "project-1", sessionId: "session-1", messageId: "message-1",
  role: "assistant", content: "请选择", createdAtMs: 1,
}
const choice: SynopsisConversationChoice = { label: "原始方向", action: "continue_discuss" }

describe("choice composer ownership", () => {
  it("toggles multiple choices without replacing typed text or another choice", () => {
    const composer = createChoiceComposer()
    composer.editDraft("我手写的内容  \n")
    composer.toggle("a", "方向 A")
    composer.toggle("b", "方向 B")
    expect(composer.getDraft()).toBe("我手写的内容  \n方向 A\n方向 B")
    composer.toggle("a", "方向 A")
    expect(composer.getDraft()).toBe("我手写的内容  \n方向 B")
    expect([...composer.getSelected()]).toEqual(["b"])
    composer.toggle("b", "方向 B")
    expect(composer.getDraft()).toBe("我手写的内容  \n")
  })

  it("never removes manually typed copies of an identical choice", () => {
    const composer = createChoiceComposer()
    composer.editDraft("相同内容")
    composer.toggle("a", "相同内容")
    composer.toggle("b", "相同内容")
    composer.toggle("a", "相同内容")
    expect(composer.getDraft()).toBe("相同内容\n相同内容")
    composer.toggle("b", "相同内容")
    expect(composer.getDraft()).toBe("相同内容")
  })

  it("uses the caret to retain an identical manual prefix or suffix", () => {
    for (const caret of [2, 4]) {
      const composer = createChoiceComposer()
      composer.toggle("a", "甲乙")
      composer.editDraft("甲乙甲乙", caret)
      composer.toggle("a", "甲乙")
      expect(composer.getDraft()).toBe("甲乙")
    }
  })

  it("keeps user insertions inside owned text when deselecting", () => {
    const composer = createChoiceComposer()
    composer.toggle("a", "AB")
    composer.editDraft("A手写B", 3)
    composer.toggle("a", "AB")
    expect(composer.getDraft()).toBe("手写")
  })

  it("preserves manually edited adjacency when replacing a selected contribution", () => {
    const composer = createChoiceComposer()
    composer.toggle("a", "AB")
    composer.editDraft("前言AB", 2)
    composer.editDraft("前言AB后记", 6)
    composer.replaceContribution("a", "新方向")
    expect(composer.getDraft()).toBe("前言新方向后记")
  })

  it("updates selected contributions in place while preserving manual text around and inside them", () => {
    const composer = createChoiceComposer()
    composer.editDraft("手写前言")
    composer.toggle("a", "AB")
    composer.toggle("b", "另一个方向")
    composer.editDraft("手写前言\nA补充B\n另一个方向", 8)
    composer.replaceContribution("a", "修改后的方向")
    expect(composer.getDraft()).toBe("手写前言\n修改后的方向补充\n另一个方向")
    composer.toggle("a", "修改后的方向")
    expect(composer.getDraft()).toBe("手写前言补充\n另一个方向")
  })

  it("drops only generated separators when the first selected choice is removed", () => {
    const composer = createChoiceComposer()
    composer.toggle("a", "A")
    composer.toggle("b", "B")
    composer.toggle("a", "A")
    expect(composer.getDraft()).toBe("B")
    composer.toggle("b", "B")
    expect(composer.getDraft()).toBe("")
  })

  it("allows empty custom ideas to be selected and filled by live editing", () => {
    const composer = createChoiceComposer()
    composer.toggle("idea", "")
    expect(composer.getSelected().has("idea")).toBe(true)
    composer.replaceContribution("idea", "我的想法")
    expect(composer.getDraft()).toBe("我的想法")
    composer.replaceContribution("idea", "")
    expect(composer.getDraft()).toBe("")
    composer.replaceContribution("idea", "新的想法")
    expect(composer.getDraft()).toBe("新的想法")
  })

  it("clears ownership on send/restore/manual clear so future edits cannot delete restored text", () => {
    const composer = createChoiceComposer()
    composer.toggle("a", "方向")
    composer.reset("方向")
    expect(composer.getSelected().size).toBe(0)
    composer.toggle("a", "方向")
    composer.toggle("a", "方向")
    expect(composer.getDraft()).toBe("方向")
    composer.toggle("b", "B")
    composer.editDraft("")
    expect(composer.getSelected().size).toBe(0)
  })

  it("does not modify the draft when an unselected choice is edited", () => {
    const composer = createChoiceComposer()
    composer.editDraft("自定义回答")
    composer.replaceContribution("unselected", "不得插入")
    expect(composer.getDraft()).toBe("自定义回答")
  })
})

describe("choice variants and identities", () => {
  it("isolates workspace, project, session, message, refreshed choice, questionnaire and duplicate identity", () => {
    const base = choiceIdentity("workspace-1", message, choice)
    const alternatives = [
      choiceIdentity("workspace-2", message, choice),
      choiceIdentity("workspace-1", { ...message, projectId: "project-2" }, choice),
      choiceIdentity("workspace-1", { ...message, sessionId: "session-2" }, choice),
      choiceIdentity("workspace-1", { ...message, messageId: "message-2" }, choice),
      choiceIdentity("workspace-1", message, { ...choice, label: "新方向" }),
      choiceIdentity("workspace-1", message, { ...choice, setupQuestionId: "question-1" }),
      choiceIdentity("workspace-1", message, choice, 1),
      choiceIdentity("workspace-1", message, "your-idea"),
    ]
    expect(new Set([base, ...alternatives]).size).toBe(alternatives.length + 1)
  })

  it("persists AI original, autosaved user variant, and active tab independently per identity", () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const identity = choiceIdentity("workspace", message, choice)
    const variant = { original: "原始方向", edited: "用户修改后的方向", active: "user" as const }
    persistChoiceVariant(identity, variant, storage)
    expect(loadChoiceVariant(identity, "原始方向", storage)).toEqual(variant)
    persistChoiceVariant(identity, { ...variant, active: "ai" }, storage)
    expect(loadChoiceVariant(identity, "原始方向", storage)).toEqual({ ...variant, active: "ai" })
    expect(loadChoiceVariant(identity, "被替换的原文", storage)).toEqual({ original: "被替换的原文", edited: "被替换的原文", active: "ai" })
    expect(loadChoiceVariant(`${identity}-other-message`, "原始方向", storage).edited).toBe("原始方向")
  })

  it("handles corrupt or unavailable storage and preserves explicitly empty edits", () => {
    const blocked = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("quota") } }
    expect(loadChoiceVariant("id", "AI", blocked).original).toBe("AI")
    expect(() => { persistChoiceVariant("id", { original: "AI", edited: "", active: "user" }, blocked); }).not.toThrow()
    const invalid = { getItem: () => '{"edited":7}', setItem: () => {} }
    expect(loadChoiceVariant("id", "AI", invalid)).toEqual({ original: "AI", edited: "AI", active: "ai" })
    const empty = { getItem: () => '{"original":"AI","edited":"","active":"user"}', setItem: () => {} }
    expect(loadChoiceVariant("id", "AI", empty).edited).toBe("")
  })
})

describe("choice contribution and explicit questionnaire send", () => {
  it("retains confirmation strings and the complete style rule selection", () => {
    expect(choiceContribution({ label: "确认梗概", action: "confirm_synopsis" })).toBe("用这份梗概写细纲")
    expect(choiceContribution({ label: "开始推演", action: "start_turn" })).toBe("按细纲写正文")
    for (const action of ["promote_staging", "promote_draft_to_body", "set_focus", "confirm_arc_plan"] as const) {
      expect(choiceContribution({ label: `确认 ${action}`, action })).toBe(`确认 ${action}`)
    }
    const selection = { novelMajorCategoryRulePath: "大类.md", novelSubcategoryRulePath: "次类.md", proseStyleRulePath: "笔风.md" }
    expect(choiceContribution({ ...choice, workStyleSelection: selection })).toBe(formatChoiceStyle(selection))
    expect(formatChoiceStyle(selection)).toContain("我选择的风格组合是：小说大类规则「大类.md」")
  })

  it("derives the latest visible assistant question for custom answers without reusing stale questions", () => {
    const question = { ...message, choices: [{ ...choice, setupQuestionId: "question-1" }] } as SynopsisConversationMessage
    expect(latestSetupQuestionId([question])).toBe("question-1")
    expect(latestSetupQuestionId([question, { ...message, role: "user" }])).toBe("question-1")
    expect(latestSetupQuestionId([question, { ...message, hidden: true }])).toBe("question-1")
    expect(latestSetupQuestionId([question, { ...message, messageId: "later-assistant" }])).toBeUndefined()
    expect(latestSetupQuestionId([question, { ...question, choices: [{ ...choice, setupQuestionId: "question-2" }] }])).toBe("question-2")
  })
})
