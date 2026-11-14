import { resolve } from "node:path"

import { describe, expect, it } from "vitest"
import {
  PLATFORM_BASE_RULE_RESOURCES,
  WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES,
  defaultSkillIdsForPhase,
} from "@starseafolio/prompt-contracts"

import { resolveWhitelistedSkillScript } from "../src/application/chapters/skill-script-whitelist.js"
import { NodePromptResourceAdapter } from "../src/infrastructure/prompts/node-prompt-resource-adapter.js"

const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")

describe("skill selective loading", () => {
  it("keeps platform system composites free of vendor fulltext", () => {
    for (const vendor of WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES) {
      expect(PLATFORM_BASE_RULE_RESOURCES).not.toContain(vendor)
    }
    expect(PLATFORM_BASE_RULE_RESOURCES.some((path) => path.includes("skill-index"))).toBe(true)
  })

  it("loads skill bodies and default packs from adapter", async () => {
    const adapter = new NodePromptResourceAdapter(packageRoot)
    const system = await adapter.loadTurnSystemRules()
    expect(system.text).toContain("平台 Skill 索引")
    expect(system.text).not.toContain("# 去 AI 味（deslop）")
    expect(system.text).toContain("不得把明确意思改写成抽象概念、象征或口号")
    expect(system.text).toContain("使用现代中文，不擅自转成古白话、文言句法或仿古腔")
    expect(system.text).toContain("把人变成规矩")

    const skill = await adapter.loadSkill("webnovel-deslop", { includeReferences: false })
    expect(skill.skillId).toBe("webnovel-deslop")
    expect(skill.text).toContain("【skill:webnovel-deslop】")
    expect(skill.text).toContain("去 AI 味")

    const pack = await adapter.loadDefaultSkillPack("synopsis_discuss")
    for (const id of defaultSkillIdsForPhase("synopsis_discuss")) {
      expect(pack.text).toContain(`【skill:${id}】`)
    }
  })

  it("loads synopsis choices instructions that follow the user's actual request", async () => {
    const adapter = new NodePromptResourceAdapter(packageRoot)
    const phase = await adapter.loadPhase("synopsis_discuss")
    expect(phase.text).toContain("不要求用户点击确认按钮或使用固定说法")
    expect(phase.text).toContain("用户明确要求提取、补全或继续细纲时")
    expect(phase.text).toContain("但不是门禁")
  })

  it("resolves whitelisted skill scripts only", () => {
    const ok = resolveWhitelistedSkillScript({
      promptPackageRoot: packageRoot,
      skillId: "webnovel-deslop",
      scriptBasename: "scan-template-tells.mjs",
    })
    expect(ok?.replaceAll("\\", "/")).toContain("webnovel-deslop/scripts/scan-template-tells.mjs")
    expect(resolveWhitelistedSkillScript({
      promptPackageRoot: packageRoot,
      skillId: "webnovel-deslop",
      scriptBasename: "../secret.mjs",
    })).toBeUndefined()
  })
})
