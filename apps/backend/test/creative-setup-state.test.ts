import { describe, expect, it } from "vitest"

import {
  answerCreativeSetupQuestion,
  buildCreativeSetupPrompt,
  initialCreativeSetupState,
  invalidateCreativeSetupWritten,
  markCreativeSetupWritten,
  nextCreativeSetupField,
  openCreativeSetupQuestion,
  parseCreativeSetupState,
  protagonistCreativeSetupFields,
  protagonistCreativeSetupMarkdownHasContent,
  serializeProtagonistCreativeSetupMarkdown,
  serializeVolumeCreativeSetupText,
  volumeCreativeSetupFields,
  type CreativeSetupScope,
  type CreativeSetupState,
} from "../src/application/chapters/creative-setup-state.js"

const protagonistAnswers = ["外冷内热，守诺", "黑发灰眼，左眉有疤", "二十七岁", "失去行医资格的边城医师", "找到失踪的妹妹", "无", "交给AI"]
const volumeAnswers = ["边城义诊发现疫病", "查出药商投毒，医馆遭围攻", "救下病人但线索指向王都", "无支线"]

function completed(scope: CreativeSetupScope = "protagonist"): CreativeSetupState {
  let state = initialCreativeSetupState(scope, 1)
  for (const [index, answer] of (scope === "protagonist" ? protagonistAnswers : volumeAnswers).entries()) {
    const id = `question-${String(index)}`
    state = openCreativeSetupQuestion(state, id, index + 2)
    state = answerCreativeSetupQuestion(state, { questionId: id, answer, now: index + 3 })
  }
  return state
}

describe("documented protagonist core", () => {
  it("accepts later substantive edits without demanding an unchanged whole-file digest", () => {
    const markdown = serializeProtagonistCreativeSetupMarkdown(completed(), { aiAdditions: "姓名沈砚，随身带药箱。" })
    expect(protagonistCreativeSetupMarkdownHasContent(markdown)).toBe(true)
    expect(protagonistCreativeSetupMarkdownHasContent(markdown.replace("二十七岁", "二十八岁"))).toBe(true)
  })

  it("rejects unrelated, missing-field and placeholder-only replacements", () => {
    const markdown = serializeProtagonistCreativeSetupMarkdown(completed())
    expect(protagonistCreativeSetupMarkdownHasContent("# 主角设定\n一段不包含核心信息的说明。")).toBe(false)
    expect(protagonistCreativeSetupMarkdownHasContent(markdown.replace("### 年龄\n> 二十七岁", ""))).toBe(false)
    expect(protagonistCreativeSetupMarkdownHasContent(markdown.replace("二十七岁", "待定"))).toBe(false)
  })
})

describe("creative setup state machine", () => {
  it("collects every protagonist field in order without mutating prior states", () => {
    const initial = initialCreativeSetupState("protagonist", 1)
    expect(initial).toEqual({ version: 1, scope: "protagonist", status: "collecting", answers: {}, updatedAtMs: 1 })
    let state = initial
    for (const [index, key] of ["personality", "appearance", "age", "background", "goal", "other", "remarks"].entries()) {
      expect(nextCreativeSetupField(state)?.key).toBe(key)
      state = openCreativeSetupQuestion(state, `q-${String(index)}`, 2)
      expect(state.pendingQuestion).toEqual({ id: `q-${String(index)}`, field: key })
      const answer = protagonistAnswers[index]
      if (answer === undefined) throw new Error("Missing protagonist fixture answer")
      state = answerCreativeSetupQuestion(state, { questionId: `q-${String(index)}`, answer, now: 3 })
      expect(state.pendingQuestion).toBeUndefined()
      expect(state.status).toBe(index === 6 ? "awaiting_write" : "collecting")
    }
    expect(initial.answers).toEqual({})
    expect(nextCreativeSetupField(state)).toBeUndefined()
    expect(state.settingsPath).toBeUndefined()
    expect(state.settingsDigest).toBeUndefined()
    expect(protagonistCreativeSetupFields.map((field) => field.required)).toEqual([true, true, true, true, true, false, false])
  })

  it("reuses a pending question on retry and rejects stale or unsolicited answers", () => {
    const state = openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "original", 2)
    expect(openCreativeSetupQuestion(state, "retry", 3)).toEqual(state)
    expect(() => answerCreativeSetupQuestion(state, { questionId: "retry", answer: "冷静", now: 4 })).toThrow()
    const answered = answerCreativeSetupQuestion(state, { questionId: "original", answer: " 冷静 ", now: 4 })
    expect(answered.answers).toEqual({ personality: "冷静" })
    expect(state.answers).toEqual({})
    expect(() => answerCreativeSetupQuestion(answered, { questionId: "original", answer: "勇敢", now: 5 })).toThrow()
  })

  it("records answered question IDs and preserves them when opening or retrying the next question", () => {
    const initial = initialCreativeSetupState("protagonist", 1)
    expect(initial.answeredQuestions).toBeUndefined()
    const first = answerCreativeSetupQuestion(openCreativeSetupQuestion(initial, "personality-id", 2), {
      questionId: "personality-id", answer: "冷静", now: 3,
    })
    expect(first.answeredQuestions).toEqual({ "personality-id": "personality" })
    expect(first.answers[first.answeredQuestions?.["personality-id"] ?? ""]).toBe("冷静")
    expect(() => openCreativeSetupQuestion(first, "personality-id", 4)).toThrow()
    const pending = openCreativeSetupQuestion(first, "appearance-id", 4)
    expect(pending.answeredQuestions).toEqual({ "personality-id": "personality" })
    expect(openCreativeSetupQuestion(pending, "retry-id", 5)).toEqual(pending)
    expect(() => answerCreativeSetupQuestion(pending, { questionId: "personality-id", answer: "冷静", now: 5 })).toThrow()
    expect(() => answerCreativeSetupQuestion(pending, { questionId: "personality-id", answer: "勇敢", now: 5 })).toThrow()
    const second = answerCreativeSetupQuestion(pending, { questionId: "appearance-id", answer: "黑发灰眼", now: 5 })
    expect(second.answeredQuestions).toEqual({ "personality-id": "personality", "appearance-id": "appearance" })
    expect(first.answeredQuestions).toEqual({ "personality-id": "personality" })
    expect(initial.answers).toEqual({})
  })

  it("preserves answered question metadata through completion, acknowledgement, invalidation, and JSON round trips", () => {
    const state = completed("volume:第一卷")
    const mapping = { "question-0": "opening", "question-1": "climaxes", "question-2": "ending", "question-3": "subplots" }
    expect(state.answeredQuestions).toEqual(mapping)
    const ready = markCreativeSetupWritten(state, { path: "大纲/第一卷.批量计划.md", digest: "written", now: 20 })
    expect(ready.answeredQuestions).toEqual(mapping)
    const invalidated = invalidateCreativeSetupWritten(ready, 21)
    expect(invalidated.answeredQuestions).toEqual(mapping)
    expect(invalidated.status).toBe("awaiting_write")
    expect(parseCreativeSetupState(JSON.parse(JSON.stringify(invalidated)))).toEqual(invalidated)
  })

  it.each([null, [], "q", { "": "personality" }, { " ": "personality" }, { q: 1 }, { q: "appearance" }, { q: "unknown" }])(
    "rejects malformed answered-question maps or mappings to unanswered fields: %j", (answeredQuestions) => {
      const state = { ...initialCreativeSetupState("protagonist", 1), answers: { personality: "冷静" }, answeredQuestions }
      expect(() => parseCreativeSetupState(state)).toThrow()
    },
  )

  it("rejects a pending question ID already used for an answered field", () => {
    const state = { ...initialCreativeSetupState("protagonist", 1), answers: { personality: "冷静" },
      answeredQuestions: { reused: "personality" }, pendingQuestion: { id: "reused", field: "appearance" } }
    expect(() => parseCreativeSetupState(state)).toThrow()
  })

  it("keeps legacy version-one JSON without answered-question metadata valid", () => {
    const legacy = completed()
    delete legacy.answeredQuestions
    expect(parseCreativeSetupState(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy)
    const ready = markCreativeSetupWritten(legacy, { path: "主角.md", digest: "written", now: 20 })
    expect(ready.answeredQuestions).toBeUndefined()
    expect(invalidateCreativeSetupWritten(ready, 21).answeredQuestions).toBeUndefined()
  })

  it("round-trips arbitrary nonempty server IDs without mutating object prototypes", () => {
    const pending = openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "__proto__", 2)
    const answered = answerCreativeSetupQuestion(pending, { questionId: "__proto__", answer: "冷静", now: 3 })
    const parsed = parseCreativeSetupState(JSON.parse(JSON.stringify(answered)))
    expect(parsed.answeredQuestions).toEqual(Object.fromEntries([["__proto__", "personality"]]))
    expect(Object.hasOwn(parsed.answeredQuestions ?? {}, "__proto__")).toBe(true)
  })

  it.each(["", "   ", "…", "？！", "继续", "好的。", "可以！", "下一步", "你的想法"])("rejects placeholder %j without advancing", (answer) => {
    const state = openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "q", 2)
    expect(() => answerCreativeSetupQuestion(state, { questionId: "q", answer, now: 3 })).toThrow()
    expect(state.pendingQuestion?.id).toBe("q")
    expect(state.answers).toEqual({})
  })

  it.each(["无", "没有", "暂无", "交给AI", "交给 AI。", "无/交给AI", "随便", "待定", "不知道", "你决定"])("requires substantive answers for each of the first five fields: %j", (answer) => {
    let state = initialCreativeSetupState("protagonist", 1)
    for (let index = 0; index < 5; index++) {
      state = openCreativeSetupQuestion(state, `q-${String(index)}`, 2)
      expect(() => answerCreativeSetupQuestion(state, { questionId: `q-${String(index)}`, answer, now: 3 })).toThrow()
      const validAnswer = protagonistAnswers[index]
      if (validAnswer === undefined) throw new Error("Missing protagonist fixture answer")
      state = answerCreativeSetupQuestion(state, { questionId: `q-${String(index)}`, answer: validAnswer, now: 3 })
    }
  })

  it("requires an explicit answer even for optional fields", () => {
    const state = completed()
    expect(state.answers.other).toBe("无")
    expect(state.answers.remarks).toBe("交给AI")
    const answers = { ...state.answers }
    delete answers.remarks
    const answeredQuestions = { ...state.answeredQuestions }
    delete answeredQuestions["question-6"]
    const incomplete = { ...state, answers, answeredQuestions, status: "collecting" as const }
    expect(nextCreativeSetupField(incomplete)?.key).toBe("remarks")
    expect(() => markCreativeSetupWritten(incomplete, { path: "主角.md", digest: "digest", now: 10 })).toThrow()
    const pending = openCreativeSetupQuestion(incomplete, "remarks", 9)
    expect(() => answerCreativeSetupQuestion(pending, { questionId: "remarks", answer: "继续", now: 10 })).toThrow()
  })

  it("asks all volume fields and waits for the user's explicit no-subplot answer", () => {
    expect(volumeCreativeSetupFields.map((field) => field.key)).toEqual(["opening", "climaxes", "ending", "subplots"])
    const state = completed("volume:第一卷")
    expect(state.scope).toBe("volume:第一卷")
    expect(state.answers.subplots).toBe("无支线")
    expect(state.status).toBe("awaiting_write")
    expect(state.pendingQuestion).toBeUndefined()
    const answers = { ...state.answers }
    delete answers.subplots
    const answeredQuestions = { ...state.answeredQuestions }
    delete answeredQuestions["question-3"]
    expect(nextCreativeSetupField({ ...state, answers, answeredQuestions, status: "collecting" })?.key).toBe("subplots")
  })

  it("only marks validated completed answers ready after an explicit write acknowledgement", () => {
    const state = completed()
    expect(() => openCreativeSetupQuestion(state, "extra", 20)).toThrow()
    expect(() => markCreativeSetupWritten(initialCreativeSetupState("protagonist", 1), { path: "existing.md", digest: "existing", now: 20 })).toThrow()
    for (const input of [{ path: "", digest: "digest", now: 20 }, { path: "主角.md", digest: " ", now: 20 }, { path: "主角.md", digest: "digest", now: NaN }]) {
      expect(() => markCreativeSetupWritten(state, input)).toThrow()
    }
    const ready = markCreativeSetupWritten(state, { path: "设定/主角.md", digest: "sha256:written", now: 20 })
    expect(ready).toEqual({ ...state, status: "ready", settingsPath: "设定/主角.md", settingsDigest: "sha256:written", updatedAtMs: 20 })
    expect(() => markCreativeSetupWritten(ready, { path: "elsewhere.md", digest: "other", now: 21 })).toThrow()
    expect(invalidateCreativeSetupWritten(ready, 21)).toEqual({ ...state, updatedAtMs: 21 })
    expect(ready.status).toBe("ready")
  })

  it.each([
    null,
    { version: 2 },
    { scope: "volume:" },
    { scope: "other" },
    { updatedAtMs: -1 },
    { updatedAtMs: Infinity },
    { answers: { personality: 123 } },
    { answers: { goal: "寻找妹妹" } },
    { answers: { unknown: "不属于本问卷" } },
    { answers: { personality: "交给AI" } },
    { status: "ready" },
    { status: "awaiting_write" },
    { settingsPath: "existing.md", settingsDigest: "existing" },
    { pendingQuestion: { id: "q", field: "goal" } },
    { pendingQuestion: { id: "", field: "personality" } },
  ])("fails closed for malformed persisted state %j", (patch) => {
    const value = patch === null ? null : { ...initialCreativeSetupState("protagonist", 1), ...patch }
    expect(() => parseCreativeSetupState(value)).toThrow()
  })

  it("validates ready metadata and pending/completion invariants", () => {
    const state = completed()
    expect(parseCreativeSetupState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(() => parseCreativeSetupState({ ...state, status: "collecting" })).toThrow()
    expect(() => parseCreativeSetupState({ ...state, pendingQuestion: { id: "extra", field: "remarks" } })).toThrow()
    expect(() => parseCreativeSetupState({ ...state, status: "ready", settingsPath: "主角.md" })).toThrow()
    expect(() => initialCreativeSetupState("volume:", 1)).toThrow()
    expect(() => openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), " ", 2)).toThrow()
  })
})

describe("creative setup prompts and serialization", () => {
  it("prompts only the current question with confirmed answers and constrained discussion choices", () => {
    let state = initialCreativeSetupState("protagonist", 1)
    state = openCreativeSetupQuestion(state, "personality-question", 2)
    state = answerCreativeSetupQuestion(state, { questionId: "personality-question", answer: "外冷内热，守诺", now: 3 })
    const prompt = buildCreativeSetupPrompt(openCreativeSetupQuestion(state, "appearance-question", 4))
    expect(prompt).not.toContain("appearance-question")
    expect(prompt).toContain("appearance")
    expect(prompt).toContain("外冷内热，守诺")
    expect(prompt).toContain("continue_discuss")
    expect(prompt).toContain("2-4")
    expect(prompt).toContain("题材")
    expect(prompt).toContain("你的想法")
    expect(prompt).toContain("UI")
    expect(prompt).toContain("不可修改")
    expect(prompt).toContain("禁止")
    expect(prompt).toContain("工具")
    expect(buildCreativeSetupPrompt(initialCreativeSetupState("volume:第一卷", 1), "瘟疫之城")).toContain("瘟疫之城")
    expect(() => buildCreativeSetupPrompt(completed("volume:第一卷"))).toThrow()
  })

  it("requests only a protagonist supplement after all seven answers without shortening or changing the core", () => {
    const state = completed()
    state.answers.personality = "谨慎，喜欢收集旧药方；".repeat(30)
    const before = JSON.stringify(state)
    const prompt = buildCreativeSetupPrompt(state)
    for (const answer of Object.values(state.answers)) expect(prompt).toContain(answer)
    expect(prompt).toContain("artifact.protagonistSupplementMarkdown")
    expect(prompt).toContain("姓名")
    expect(prompt).toContain("能力")
    expect(prompt).toContain("关系")
    expect(prompt).toContain("题材")
    expect(prompt).toContain("仅")
    expect(prompt).toContain("不可修改")
    expect(prompt).toContain("禁止")
    expect(prompt).toContain("工具")
    expect(prompt).toContain("章节")
    expect(prompt).not.toContain("continue_discuss")
    expect(JSON.stringify(state)).toBe(before)
    const ready = markCreativeSetupWritten(state, { path: "设定集/人物/主角.md", digest: "written", now: 20 })
    expect(() => buildCreativeSetupPrompt(ready)).toThrow()
  })

  it("asks specific volume questions and offers multiple selections for climaxes and subplots", () => {
    const questions = [
      ["主角本卷开场场景", "边城义诊发现疫病"],
      ["本卷一个或多个高潮", "查出药商投毒，医馆遭围攻"],
      ["本卷结束结果", "救下病人但线索指向王都"],
      ["遭遇事件与起止时机", "无支线"],
    ] as const
    let state = initialCreativeSetupState("volume:第一卷", 1)
    for (const [index, [description, answer]] of questions.entries()) {
      const questionId = `q-${String(index)}`
      state = openCreativeSetupQuestion(state, questionId, 2)
      const prompt = buildCreativeSetupPrompt(state)
      expect(prompt).toContain(description)
      if (index === 1 || index === 3) expect(prompt).toContain("多选")
      if (index === 3) {
        expect(prompt).toContain("起因")
        expect(prompt).toContain("高潮")
        expect(prompt).toContain("结局")
        expect(prompt).toContain("无支线")
      }
      state = answerCreativeSetupQuestion(state, { questionId, answer, now: 3 })
    }
  })

  it("bounds the immutable protagonist core separately from optional AI additions", () => {
    const state = completed()
    const markdown = serializeProtagonistCreativeSetupMarkdown(state, { aiAdditions: "他习惯在雨天整理药箱。" })
    expect(markdown).toContain("<!-- creative-setup:protagonist:user-core:start -->")
    expect(markdown).toContain("<!-- creative-setup:protagonist:user-core:end -->")
    expect(markdown).toContain("用户核心设定（不可修改）")
    expect(markdown).toContain("外冷内热，守诺")
    expect(markdown).toContain("二十七岁")
    expect(markdown).toContain("AI 补充")
    expect(markdown.indexOf("他习惯")).toBeGreaterThan(markdown.indexOf("<!-- creative-setup:protagonist:user-core:end -->"))
    expect(state.status).toBe("awaiting_write")
    expect(() => serializeProtagonistCreativeSetupMarkdown(initialCreativeSetupState("protagonist", 1))).toThrow()
    expect(() => serializeProtagonistCreativeSetupMarkdown(completed("volume:第一卷"))).toThrow()
  })

  it("upserts only bounded sections and preserves surrounding Markdown and prior AI additions", () => {
    const state = completed()
    const first = serializeProtagonistCreativeSetupMarkdown(state, { aiAdditions: "旧补充" })
    const existingMarkdown = `# 原有标题\r\n\r\n保留前言\r\n${first}\r\n保留尾注\r\n`
    const updated = serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown })
    expect(updated).toBe(existingMarkdown)
    const replaced = serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown, aiAdditions: "新补充" })
    expect(replaced.startsWith("# 原有标题\r\n\r\n保留前言\r\n")).toBe(true)
    expect(replaced.endsWith("\r\n保留尾注\r\n")).toBe(true)
    expect(replaced).toContain("新补充")
    expect(replaced).not.toContain("旧补充")
    expect(serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown: "# 已有设定\n独立内容\n" })).toMatch(/^# 已有设定\n独立内容\n/)
  })

  it("fails closed on ambiguous or broken section boundaries", () => {
    const state = completed()
    const section = serializeProtagonistCreativeSetupMarkdown(state)
    expect(() => serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown: section + "\n" + section })).toThrow()
    expect(() => serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown: "<!-- creative-setup:protagonist:user-core:start -->\nunfinished" })).toThrow()
    expect(() => serializeProtagonistCreativeSetupMarkdown(state, { aiAdditions: "<!-- creative-setup:protagonist:user-core:end -->" })).toThrow()
    const nested = "<!-- creative-setup:protagonist:user-core:start -->\n<!-- creative-setup:protagonist:ai-additions:start -->\n<!-- creative-setup:protagonist:ai-additions:end -->\n<!-- creative-setup:protagonist:user-core:end -->"
    expect(() => serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown: nested })).toThrow()
  })

  it("keeps multiline user Markdown inside the core even when it includes boundary text", () => {
    const state = completed()
    state.answers.personality = "守诺\n<!-- creative-setup:protagonist:user-core:end -->\n多疑"
    const markdown = serializeProtagonistCreativeSetupMarkdown(state)
    expect(markdown).toContain("> <!-- creative-setup:protagonist:user-core:end -->")
    expect(serializeProtagonistCreativeSetupMarkdown(state, { existingMarkdown: markdown })).toBe(markdown)
  })

  it("serializes volume answers separately without changing readiness", () => {
    const state = completed("volume:第一卷")
    expect(serializeVolumeCreativeSetupText(state)).toBe("开篇：边城义诊发现疫病\n高潮：查出药商投毒，医馆遭围攻\n结尾：救下病人但线索指向王都\n支线：无支线")
    expect(state.status).toBe("awaiting_write")
    expect(() => serializeVolumeCreativeSetupText(completed())).toThrow()
    expect(() => serializeVolumeCreativeSetupText(initialCreativeSetupState("volume:第一卷", 1))).toThrow()
  })
})
