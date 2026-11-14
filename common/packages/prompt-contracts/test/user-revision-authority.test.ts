import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { BASE_RULES_RESOURCE, promptDefinitions } from "../src/index.js"

describe("user revision authority", () => {
  it("prioritizes explicit revisions and requires dependent planning to be updated through native writes", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const baseRules = readFileSync(resolve(packageRoot, BASE_RULES_RESOURCE), "utf8")
    const discussion = readFileSync(resolve(packageRoot, promptDefinitions.synopsis_discuss.resourcePath), "utf8")
    expect(baseRules).toContain("用户最新明确的创作或修订指令")
    expect(baseRules).toContain("旧答案、旧设定、旧规划和历史 AI 提案")
    expect(baseRules).toContain("不得将规划目标当成已发生事实")
    expect(baseRules).toContain("不能以“已确认”或“图中已有”为由拒绝用户修订")
    expect(discussion).toContain("同步更新受影响的设定、卷信息、梗概和大纲")
    expect(discussion).toContain("不能只口头同意")
    expect(discussion).toContain("既有结构化字段或专用工具")
    expect(discussion).toContain("含义不清")
  })
})
