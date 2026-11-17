import { describe, expect, it } from "vitest"

import { isWorkStyleComplete } from "../src/core/workspace/work-style-gate.js"
import {
  applyWorkStyleRevision,
  collectUserRequirementText,
  resolveWorkStyleRequirementSource,
} from "../src/core/workspace/work-style-revision.js"

function completeStyle(): string {
  return [
    "# 作品风格",
    "",
    "## 1. 语体笔风",
    "",
    "小说大类：爽文。小说次大类：飞卢。小说笔风：表现输出/笔风规则/东方玄幻.md。主锚：表现输出/笔风规则/东方玄幻.md。语气硬朗冷峻，描写密度适中，感官偏视觉。",
    "",
    "## 2. 时代科技生活",
    "",
    "冷兵器与符箓并行；货币用灵石；机构写宗门与城卫，不写现代警察。",
    "",
    "## 3. 规则称谓能力",
    "",
    "战力用境界名落笔；技能先效果后名称；称谓按辈分与阵营。",
    "",
    "## 4. 命名",
    "",
    "人名双/三音节错开姓与偏旁；常同框禁止同姓墙。",
    "正例：林烬、沈砚。反例：凌寒与凌霜同批不合格。",
    "势力：正派「×宗/×门」，商会「×阁」。",
    "",
    "## 5. 角色声口",
    "",
    "主角短句、少形容词，示例：「先活下来再说。」",
    "配角谋士长句带停顿，示例：「若依我看……此局已半输。」",
    "",
    "## 6. 尺度意象章钩",
    "",
    "暴力写后果不写虐杀展览；章末钩落在选择代价。",
    "",
    "## 7. 人称指称",
    "",
    "第三人称限知，贴林烬；正文以姓名为主。示例句：林烬抬眼，没接话。",
    "",
    "## 8. 句子与对话",
    "",
    "句长偏短；对白白话口语；禁对白乒乓，群戏按受损者→权力高位分层。",
    "正例：「滚。」反例：全员「我认为我们可以尝试一下」同一书面腔。",
    "",
  ].join("\n")
}

describe("work style revision", () => {
  it("appends a new user requirement without dropping the existing section", () => {
    const current = completeStyle()
    const result = applyWorkStyleRevision({
      current,
      userRequirements: "意象只用书、水和门，而且必须落到实物上。",
      updates: [{
        heading: "## 6. 尺度意象章钩",
        mode: "merge",
        content: "意象固定为书、水、门，并落在实物上。",
        userQuote: "意象只用书、水和门",
      }],
    })
    expect(result.applied).toEqual(["## 6. 尺度意象章钩"])
    expect(result.markdown).toContain("暴力写后果不写虐杀展览；章末钩落在选择代价。")
    expect(result.markdown).toContain("意象固定为书、水、门，并落在实物上。")
    expect(result.markdown).toContain("## 4. 命名")
    expect(isWorkStyleComplete(result.markdown)).toBe(true)
  })

  it("uses a fused section when every existing sentence is kept", () => {
    const current = completeStyle()
    const result = applyWorkStyleRevision({
      current,
      userRequirements: "章末钩之外，意象只用书、水和门。",
      updates: [{
        heading: "## 6. 尺度意象章钩",
        mode: "merge",
        content: "暴力写后果不写虐杀展览；章末钩落在选择代价。意象固定为书、水、门。",
        userQuote: "意象只用书、水和门",
      }],
    })
    expect(result.markdown).toContain("意象固定为书、水、门。")
    expect(result.markdown.match(/暴力写后果不写虐杀展览/gu)).toHaveLength(1)
  })

  it("replaces only the contradictory section", () => {
    const current = completeStyle()
    const result = applyWorkStyleRevision({
      current,
      userRequirements: "不要章末钩，这一章的收束改成留一个未完成的动作。",
      updates: [{
        heading: "## 6. 尺度意象章钩",
        mode: "replace",
        content: "暴力写后果。章末不设钩，只留一个未完成的动作。",
        userQuote: "不要章末钩",
      }],
    })
    expect(result.applied).toEqual(["## 6. 尺度意象章钩"])
    expect(result.markdown).not.toContain("章末钩落在选择代价")
    expect(result.markdown).toContain("只留一个未完成的动作")
    expect(result.markdown).toContain("第三人称限知")
  })

  it("rejects a quote that is not in the user requirements", () => {
    const current = completeStyle()
    const result = applyWorkStyleRevision({
      current,
      userRequirements: "草稿可以，发布正文",
      updates: [{
        heading: "## 6. 尺度意象章钩",
        mode: "merge",
        content: "从草稿里看见的灯影要写成固定意象。",
        userQuote: "灯影要写成固定意象",
      }],
    })
    expect(result.markdown).toBe(current)
    expect(result.applied).toEqual([])
  })

  it("does not mine the draft during revision publish", () => {
    expect(resolveWorkStyleRequirementSource({
      workflow: "revision",
      userInput: "正文里出现了新的门意象。",
      userRequirements: "对话再短一点。",
    })).toBe("对话再短一点。")
    expect(resolveWorkStyleRequirementSource({
      workflow: "revision",
      userInput: "正文里出现了新的门意象。",
    })).toBe("")
    expect(resolveWorkStyleRequirementSource({
      workflow: "turn",
      userInput: "以后对白都用短句。",
    })).toBe("以后对白都用短句。")
  })

  it("keeps the prose-style path unless the user supplies a new one", () => {
    const current = completeStyle()
    const blocked = applyWorkStyleRevision({
      current,
      userRequirements: "语气改得再冷一点。",
      updates: [{
        heading: "## 1. 语体笔风",
        mode: "replace",
        content: "语气改冷，不再使用原来的笔风文件。",
        userQuote: "语气改得再冷一点",
      }],
    })
    expect(blocked.markdown).toBe(current)

    const changed = applyWorkStyleRevision({
      current,
      userRequirements: "笔风改成表现输出/笔风规则/轻小说.md，语气放软。",
      updates: [{
        heading: "## 1. 语体笔风",
        mode: "replace",
        content: "小说笔风：表现输出/笔风规则/轻小说.md。主锚：表现输出/笔风规则/轻小说.md。语气放软，描写密度仍适中。",
        userQuote: "表现输出/笔风规则/轻小说.md",
      }],
    })
    expect(changed.applied).toEqual(["## 1. 语体笔风"])
    expect(changed.markdown).toContain("表现输出/笔风规则/轻小说.md")
    expect(isWorkStyleComplete(changed.markdown)).toBe(true)
  })

  it("collects visible user messages and keeps the latest tail", () => {
    const text = collectUserRequirementText([
      { role: "assistant", content: "我建议改意象" },
      { role: "user", content: "先不要改", hidden: true },
      { role: "user", content: "意象只用书、水和门" },
    ])
    expect(text).toBe("意象只用书、水和门")
    expect(text).not.toContain("我建议改意象")
  })
})
