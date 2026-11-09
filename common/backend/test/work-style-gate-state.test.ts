import { describe, expect, it } from "vitest"

import {
  canProceedPastWorkStyleGate,
  initialWorkStyleGateState,
  transitionWorkStyleGateState,
} from "../src/core/workspace/work-style-gate-state.js"
import { assessWorkStyleMarkdown } from "../src/core/workspace/work-style-gate.js"

const completeStyle = [
  "# 作品风格",
  "## 1. 语体笔风\n小说大类规则：表现输出/小说大类规则/爽文.md。小说次大类规则：表现输出/小说次大类规则/飞卢.md。小说笔风：表现输出/笔风规则/仙侠.md。主锚：表现输出/笔风规则/仙侠.md。语气硬朗冷峻，描写密度适中，感官偏视觉。",
  "## 2. 时代科技生活\n冷兵器与符箓并行；货币用灵石；机构写宗门与城卫，不写现代警察。",
  "## 3. 规则称谓能力\n战力用境界名落笔；技能先效果后名称；称谓按辈分与阵营。",
  "## 4. 命名\n人名双/三音节错开姓与偏旁；常同框禁止同姓墙。正例：林烬、沈砚。反例：凌寒与凌霜同批不合格。势力：正派「×宗/×门」，商会「×阁」。",
  "## 5. 角色声口\n主角短句、少形容词，示例：「先活下来再说。」配角谋士长句带停顿，示例：「若依我看……此局已半输。」",
  "## 6. 尺度意象章钩\n暴力写后果不写虐杀展览；章末钩落在选择代价。",
  "## 7. 人称指称\n第三人称限知，贴林烬；正文以姓名为主。示例句：林烬抬眼，没接话。",
  "## 8. 句子与对话\n句长偏短；对白白话口语；禁对白乒乓，群戏按受损者→权力高位分层。正例：「滚。」反例：全员「我认为我们可以尝试一下」同一书面腔。",
].join("\n\n")

describe("work style gate state machine", () => {
  it("uses a complete style fixture", () => {
    expect(assessWorkStyleMarkdown(completeStyle).complete).toBe(true)
  })

  it("does not let complete file contents skip the initial choice state", () => {
    const state = initialWorkStyleGateState()

    expect(state).toEqual({ status: "awaiting_choice" })
    expect(canProceedPastWorkStyleGate(state)).toBe(false)
  })

  it("cannot complete or write chapters before a style has been selected", () => {
    const state = transitionWorkStyleGateState(initialWorkStyleGateState(), {
      type: "style_document_saved",
      markdown: completeStyle,
      digest: "style-digest-1",
    })

    expect(state).toEqual({ status: "awaiting_choice" })
    expect(canProceedPastWorkStyleGate(state)).toBe(false)
  })

  it("requires a substantive style document after selection before allowing chapter work", () => {
    const selected = transitionWorkStyleGateState(initialWorkStyleGateState(), {
      type: "select_style",
      proseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
    })
    const stillIncomplete = transitionWorkStyleGateState(selected, {
      type: "style_document_saved",
      markdown: "# 作品风格\n\n## 1. 语体笔风\n待定",
      digest: "style-digest-1",
    })

    expect(selected.status).toBe("style_selected")
    expect(stillIncomplete.status).toBe("style_selected")
    expect(canProceedPastWorkStyleGate(stillIncomplete)).toBe(false)

    const ready = transitionWorkStyleGateState(stillIncomplete, {
      type: "style_document_saved",
      markdown: completeStyle,
      digest: "style-digest-2",
    })
    expect(ready).toEqual({
      status: "ready",
      selectedProseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
      styleDigest: "style-digest-2",
    })
    expect(canProceedPastWorkStyleGate(ready)).toBe(true)
  })

  it("does not approve a complete document that ignores the selected prose rule", () => {
    const selected = transitionWorkStyleGateState(initialWorkStyleGateState(), {
      type: "select_style",
      proseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
    })
    const mismatched = transitionWorkStyleGateState(selected, {
      type: "style_document_saved",
      markdown: completeStyle.replace("表现输出/笔风规则/仙侠.md", "表现输出/笔风规则/轻小说.md"),
      digest: "style-digest-mismatch",
    })

    expect(mismatched).toEqual(selected)
    expect(canProceedPastWorkStyleGate(mismatched)).toBe(false)
  })

  it("requires the selected Markdown category rule paths in the saved style document", () => {
    const selected = transitionWorkStyleGateState(initialWorkStyleGateState(), {
      type: "select_style",
      proseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
    })
    const missingCategory = transitionWorkStyleGateState(selected, {
      type: "style_document_saved",
      markdown: completeStyle.replace("小说大类规则：表现输出/小说大类规则/爽文.md。", ""),
      digest: "missing-category",
    })
    expect(missingCategory).toEqual(selected)

    const missingPlatformRule = transitionWorkStyleGateState(selected, {
      type: "style_document_saved",
      markdown: completeStyle.replace("小说次大类规则：表现输出/小说次大类规则/飞卢.md。", ""),
      digest: "missing-platform-rule",
    })
    expect(missingPlatformRule).toEqual(selected)
  })

  it("invalidates readiness when the approved style document changes", () => {
    const ready = {
      status: "ready" as const,
      selectedProseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
      styleDigest: "approved-digest",
    }
    const invalidated = transitionWorkStyleGateState(ready, {
      type: "style_document_changed",
      currentDigest: "modified-digest",
    })

    expect(invalidated).toEqual({
      status: "style_selected",
      selectedProseStylePath: "表现输出/笔风规则/仙侠.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
    })
    expect(canProceedPastWorkStyleGate(invalidated)).toBe(false)
  })

  it("rejects paths outside the preset prose-style directory", () => {
    expect(() => transitionWorkStyleGateState(initialWorkStyleGateState(), {
      type: "select_style",
      proseStylePath: "表现输出/本作品描写/作品风格.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
    })).toThrow("笔风规则")
  })
})
