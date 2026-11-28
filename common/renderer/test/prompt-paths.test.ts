import { describe, expect, it } from "vitest"

import {
  PROMPT_CATEGORIES,
  userPromptCategory,
  userPromptTypes,
  isPromptPath,
  normalizeWorkspacePath,
  promptCategoryLabel,
  promptTag,
  workspaceDirectoryBadge,
} from "../src/features/workspace/prompt-paths.js"

describe("prompt paths", () => {
  it("recognizes new prompt-library paths, including windows separators", () => {
    expect(isPromptPath("提示词")).toBe(true)
    expect(isPromptPath("提示词/")).toBe(true)
    expect(isPromptPath("提示词/基础规则/系统提示词/写作基调.md")).toBe(true)
    expect(isPromptPath("提示词\\用户规则\\阶段提示词\\梗概阶段\\我的规则.md")).toBe(true)
    expect(isPromptPath("提示词/系统记忆/消息前后/用户消息后/规则.md")).toBe(true)
  })

  it("still recognizes legacy platform mirrors for compatibility", () => {
    expect(isPromptPath("世界推演规则/总览.md")).toBe(true)
    expect(isPromptPath("世界推演规则/人物设定.md")).toBe(true)
    expect(isPromptPath("世界推演规则/基础规则")).toBe(true)
    expect(isPromptPath("世界推演规则/基础规则/base-rules.md")).toBe(true)
  })

  it("rejects project content and lookalike names", () => {
    expect(isPromptPath("设定集/人物/林照.md")).toBe(false)
    expect(isPromptPath("世界推演规则/用户规则/我的规则.md")).toBe(false)
    expect(isPromptPath("世界推演规则/总览.md.bak")).toBe(false)
    expect(isPromptPath("提示词备份/旧规则.md")).toBe(false)
    expect(isPromptPath("章节正文/第一章 开端.md")).toBe(false)
    expect(isPromptPath("")).toBe(false)
  })

  it("labels prompt scopes and categories", () => {
    for (const category of PROMPT_CATEGORIES) {
      expect(promptCategoryLabel(`提示词/基础规则/${category}/示例.md`)).toBe(`基础规则 · ${category}`)
    }
    expect(promptCategoryLabel("世界推演规则/基础规则/base-rules.md")).toBe("平台规则")
    expect(promptCategoryLabel("提示词/未知分类/示例.md")).toBeUndefined()
  })

  it("tags fixed, message-relative and stage documents", () => {
    expect(promptTag("提示词/基础规则/系统提示词/03-去AI味与写作声音.md")).toBe("系统")
    expect(promptTag("提示词/用户规则/系统提示词/我的规则.md")).toBe("系统")
    expect(promptTag("提示词/基础规则/消息前后/用户消息前/01-用户消息前.md")).toBe("消息前")
    expect(promptTag("提示词/系统记忆/消息前后/用户消息后/规则.md")).toBe("消息后")
    expect(promptTag("提示词/基础规则/阶段提示词/新章节阶段/01.md")).toBe("新章节阶段")
    expect(promptTag("提示词/基础规则/阶段提示词/02-构思阶段.md")).toBe("构思阶段")
    expect(promptTag("提示词\\用户规则\\阶段提示词\\构思阶段.md")).toBe("构思阶段")
    expect(promptTag("提示词/系统记忆/阶段提示词/构思阶段.md")).toBe("构思阶段")
    expect(promptTag("提示词/用户规则/阶段提示词/梗概阶段/规则.md")).toBe("构思阶段")
    expect(promptTag("提示词/系统记忆/阶段提示词/草稿阶段-旧规则.md")).toBe("构思阶段")
    expect(promptTag("提示词/基础规则/阶段提示词/章节入库阶段/01.md")).toBe("章节入库阶段")
  })

  it("recognizes user rule categories and their selectable prompt types", () => {
    expect(userPromptCategory("提示词/用户规则")).toBeUndefined()
    expect(userPromptCategory("提示词/用户规则/阶段提示词")).toBe("阶段提示词")
    expect(userPromptCategory("提示词/系统记忆/消息前后")).toBeUndefined()
    expect(userPromptTypes("阶段提示词")).toEqual(["新章节阶段", "构思阶段", "章节入库阶段"])
    expect(userPromptTypes("消息前后")).toEqual(["用户消息前", "用户消息后"])
    expect(promptTag("提示词/基础规则/消息前后/01-用户消息前.md")).toBe("消息前")
  })

  it("normalizes separators and trailing slashes", () => {
    expect(normalizeWorkspacePath("提示词\\系统规则\\写作基调.md/")).toBe("提示词/系统规则/写作基调.md")
  })

  it("labels presentation directories that inject or share prompt overlays", () => {
    expect(workspaceDirectoryBadge("表现输出/本作品描写")).toEqual({
      label: "构思阶段",
      tooltip: "本文件夹内提示词在构思阶段全部注入讨论与生成",
    })
    expect(workspaceDirectoryBadge("表现输出\\本作品描写")).toEqual({
      label: "构思阶段",
      tooltip: "本文件夹内提示词在构思阶段全部注入讨论与生成",
    })
    expect(workspaceDirectoryBadge("表现输出/描写规则")?.label).toBe("共享")
    expect(workspaceDirectoryBadge("表现输出/笔风规则")?.label).toBe("共享")
    expect(workspaceDirectoryBadge("表现输出/本作品描写/作品风格.md")).toBeUndefined()
    expect(workspaceDirectoryBadge("设定集")).toBeUndefined()
  })
})
