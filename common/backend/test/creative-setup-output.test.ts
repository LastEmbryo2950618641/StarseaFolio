import { describe, expect, it } from "vitest"
import { characterProfileSchema } from "@starseafolio/contracts"
import { initialCreativeSetupState, openCreativeSetupQuestion, answerCreativeSetupQuestion, protagonistCreativeSetupFields } from "../src/application/chapters/creative-setup-state.js"
import { parseCreativeSetupOutput } from "../src/application/chapters/creative-setup-output.js"

describe("creative setup tagged output", () => {
  it("parses reusable choice blocks and discards duplicate or blank choices", () => {
    const state = openCreativeSetupQuestion(initialCreativeSetupState("volume:第一卷", 1), "q-1", 2)
    const result = parseCreativeSetupOutput("先选你更喜欢的走向。\n<creative-choices>\n- 暴雨夜逃离矿场\n- 暴雨夜逃离矿场\n- 留在矿场寻找线索\n</creative-choices>", state)
    expect(result.assistantMessage).toBe("先选你更喜欢的走向。")
    expect(result.choices?.map(choice => choice.label)).toEqual(["暴雨夜逃离矿场", "留在矿场寻找线索"])
    expect(result.choices?.every(choice => choice.action === "continue_discuss")).toBe(true)
  })

  it("validates protagonist supplement fields with the canonical character schema", () => {
    let state = initialCreativeSetupState("protagonist", 1)
    for (const [index, field] of protagonistCreativeSetupFields.entries()) {
      const question = openCreativeSetupQuestion(state, `q-${index}`, index + 2)
      state = answerCreativeSetupQuestion(question, { questionId: `q-${index}`, answer: `confirmed ${field.key}`, now: index + 3 })
    }
    const result = parseCreativeSetupOutput("补充人物姓名与身份。\n<creative-character-json>{\"姓名\":\"林烬\",\"身份\":\"矿工\"}</creative-character-json>", state)
    expect(result.protagonistSupplementFields).toEqual(characterProfileSchema.parse({ schemaVersion: 1, fields: { 姓名: "林烬", 身份: "矿工" } }).fields)
    expect(result.protagonistSupplementMarkdown).toContain("补充人物姓名")
  })

  it.each([
    "没有选项块",
    "<creative-choices>- 单一选项</creative-choices>",
    "<creative-choices>- 重复\n- 重复</creative-choices>",
    "<creative-choices>- A\n- B</creative-choices><creative-choices>- C\n- D</creative-choices>",
  ])("rejects invalid choice block: %s", text => {
    const state = openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "q", 2)
    expect(() => parseCreativeSetupOutput(text, state)).toThrow()
  })

  it("rejects invalid character JSON and misplaced fields", () => {
    let state = initialCreativeSetupState("protagonist", 1)
    for (const [index, field] of protagonistCreativeSetupFields.entries()) {
      const id = `q-${index}`
      state = answerCreativeSetupQuestion(openCreativeSetupQuestion(state, id, index + 2), {
        questionId: id, answer: `confirmed ${field.key}`, now: index + 3,
      })
    }
    expect(() => parseCreativeSetupOutput("<creative-character-json>{bad}</creative-character-json>", state)).toThrow()
    expect(() => parseCreativeSetupOutput("<creative-character-json>{\"forbidden\\nfield\":\"x\"}</creative-character-json>", state)).toThrow()
  })
})
