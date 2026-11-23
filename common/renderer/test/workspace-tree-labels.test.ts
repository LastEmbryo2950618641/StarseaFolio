import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { WorkspaceTree } from "../src/features/workspace/WorkspaceTree.js"
import { BASE_RULE_FILE_DISPLAY_NAMES, workspaceTreeLabel } from "../src/features/workspace/workspace-tree-labels.js"
import { isSharedPresentationRulePath, resolveWorkspaceAbsolutePath } from "../src/features/workspace/workspace-paths.js"

describe("workspace tree labels", () => {
  it("maps platform base rules to readable Chinese names without touching their real paths", () => {
    expect(Object.keys(BASE_RULE_FILE_DISPLAY_NAMES)).toHaveLength(11)
    expect(new Set(Object.values(BASE_RULE_FILE_DISPLAY_NAMES)).size).toBe(11)
    for (const [path, label] of Object.entries(BASE_RULE_FILE_DISPLAY_NAMES)) {
      expect(path.startsWith("世界推演规则/基础规则/")).toBe(true)
      expect(path.endsWith(".md")).toBe(true)
      expect(label.length).toBeGreaterThan(0)
    }
    expect(workspaceTreeLabel("世界推演规则/基础规则/base-rules.md", "base-rules.md")).toBe("基础规则")
    expect(workspaceTreeLabel("世界推演规则/基础规则/outline-to-draft-guide.md", "outline-to-draft-guide.md"))
      .toBe("细纲→正文草稿")
    expect(workspaceTreeLabel("世界推演规则/基础规则/batch-volume-deduction-plan.md", "batch-volume-deduction-plan.md"))
      .toBe("整卷推演规划")
  })

  it("keeps the real file name for unmapped files", () => {
    expect(workspaceTreeLabel("设定集/人物/林照.md", "林照.md")).toBe("林照.md")
    expect(workspaceTreeLabel("世界推演规则/总览.md", "总览.md")).toBe("总览.md")
  })

  it("renders Chinese labels in the tree and keeps the real name in the hover title", () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceTree, {
      entries: [
        { path: "世界推演规则", kind: "directory" },
        { path: "世界推演规则/基础规则", kind: "directory" },
        { path: "世界推演规则/基础规则/base-rules.md", kind: "file" },
      ],
      selectedPath: "世界推演规则/基础规则/base-rules.md",
      onSelect: () => {},
      onSelectLineage: () => {},
      onRefresh: () => {},
    }))
    expect(html).toContain(">基础规则</span>")
    expect(html).toContain('title="基础规则（base-rules.md）"')
    expect(html).not.toContain(">base-rules.md</span>")
  })

  it("resolves absolute paths for project files and shared presentation rules", () => {
    const roots = { workspaceRootRef: "C:\\Books\\雾港纪事", sharedPresentationRoot: "D:\\SharedRules" }
    expect(resolveWorkspaceAbsolutePath("设定集/人物/林照.md", roots))
      .toBe("C:\\Books\\雾港纪事\\设定集\\人物\\林照.md")
    expect(resolveWorkspaceAbsolutePath("表现输出/描写规则/压抑氛围.md", roots))
      .toBe("D:\\SharedRules\\表现输出\\描写规则\\压抑氛围.md")
    expect(resolveWorkspaceAbsolutePath("表现输出/笔风规则/冷硬叙事.md", { workspaceRootRef: "C:\\Books\\雾港纪事" }))
      .toBe("C:\\Books\\雾港纪事\\表现输出\\笔风规则\\冷硬叙事.md")
    expect(isSharedPresentationRulePath("表现输出/描写规则/压抑氛围.md")).toBe(true)
    expect(isSharedPresentationRulePath("表现输出/描写规则")).toBe(false)
    expect(isSharedPresentationRulePath("设定集/人物/林照.md")).toBe(false)
  })
})
