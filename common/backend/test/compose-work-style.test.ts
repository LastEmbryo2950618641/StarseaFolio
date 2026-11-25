import { describe, expect, it } from "vitest"

import {
  buildComposeWorkStylePrompt,
  composeWorkStyleArtifactFromText,
  type ComposeWorkStyleOptions,
} from "../src/application/chapters/compose-work-style.js"

const options: ComposeWorkStyleOptions = {
  status: "awaiting_choice",
  availableProseStylePaths: ["表现输出/笔风规则/仙侠.md", "表现输出/笔风规则/悬疑.md"],
  availableNovelMajorCategoryRulePaths: ["表现输出/小说大类规则/仙侠.md", "表现输出/小说大类规则/悬疑.md"],
  availableNovelSubcategoryRulePaths: ["表现输出/小说次大类规则/修真.md", "表现输出/小说次大类规则/推理.md"],
  hasExistingWorkStyle: false,
}

const choicesText = `先比较可用的规则组合。
<compose-work-style-choices>
label: 仙侠 + 修真 + 仙侠笔风
novelMajorCategoryRulePath: 表现输出/小说大类规则/仙侠.md
novelSubcategoryRulePath: 表现输出/小说次大类规则/修真.md
proseStyleRulePath: 表现输出/笔风规则/仙侠.md

label: 悬疑 + 推理 + 悬疑笔风
novelMajorCategoryRulePath: 表现输出/小说大类规则/悬疑.md
novelSubcategoryRulePath: 表现输出/小说次大类规则/推理.md
proseStyleRulePath: 表现输出/笔风规则/悬疑.md
</compose-work-style-choices>`

describe("compose work style text protocol", () => {
  it("states the style gate and both allowed blocks in the prompt", () => {
    const prompt = buildComposeWorkStylePrompt(options)
    expect(prompt).toContain("尚未选择文风")
    expect(prompt).toContain("<compose-work-style-choices>")
    expect(prompt).toContain("本轮用纯文本回复")
  })

  it("maps verified labels and rule paths to discuss choices", () => {
    const parsed = composeWorkStyleArtifactFromText(choicesText, options)
    expect(parsed.assistantMessage).toBe("先比较可用的规则组合。")
    expect(parsed.choices).toEqual([
      {
        label: "仙侠 + 修真 + 仙侠笔风",
        action: "continue_discuss",
        workStyleSelection: {
          novelMajorCategoryRulePath: "表现输出/小说大类规则/仙侠.md",
          novelSubcategoryRulePath: "表现输出/小说次大类规则/修真.md",
          proseStyleRulePath: "表现输出/笔风规则/仙侠.md",
        },
      },
      expect.objectContaining({ label: "悬疑 + 推理 + 悬疑笔风" }),
    ])
  })

  it("rejects a fabricated rule path", () => {
    expect(() => composeWorkStyleArtifactFromText(
      choicesText.replace("表现输出/笔风规则/仙侠.md", "表现输出/笔风规则/不存在.md"),
      options,
    )).toThrow(/真实候选/u)
  })

  it("maps the selected markdown block to one presentation write", () => {
    const markdown = ["# 作品风格", "## 1. 语体笔风", "克制。", "## 8. 禁止项", "无。"].join("\n")
    const parsed = composeWorkStyleArtifactFromText(
      `已按所选规则审核。\n<compose-work-style>\n${markdown}\n</compose-work-style>`,
      { ...options, status: "style_selected", hasExistingWorkStyle: true },
    )
    expect(parsed.presentationWrites).toEqual([{
      relativePath: "表现输出/本作品描写/作品风格.md",
      markdown,
      mode: "update",
    }])
  })

  it("merges several recommendation blocks emitted one group at a time", () => {
    const split = choicesText.replace("</compose-work-style-choices>", "</compose-work-style-choices>\n<compose-work-style-choices>")
    const parsed = composeWorkStyleArtifactFromText(split, options)
    expect(parsed.choices?.map((choice) => choice.label)).toEqual(["仙侠 + 修真 + 仙侠笔风", "悬疑 + 推理 + 悬疑笔风"])
  })

  it("accepts a style document wrapped in one Markdown fence", () => {
    const markdown = ["# 作品风格", "## 1. 语体笔风", "克制。", "## 8. 禁止项", "无。"].join("\n")
    const parsed = composeWorkStyleArtifactFromText(
      `已审核。\n<compose-work-style>\n\`\`\`markdown\n${markdown}\n\`\`\`\n</compose-work-style>`,
      { ...options, status: "style_selected", hasExistingWorkStyle: false },
    )
    expect(parsed.presentationWrites?.[0]?.markdown).toBe(markdown)
    expect(parsed.presentationWrites?.[0]?.mode).toBe("create")
  })

  it("rejects a markdown write before the style is selected", () => {
    expect(() => composeWorkStyleArtifactFromText(
      "说明\n<compose-work-style>\n# 作品风格\n</compose-work-style>",
      options,
    )).toThrow(/允许的完整输出块/u)
  })
})
