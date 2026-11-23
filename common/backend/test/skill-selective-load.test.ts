import { resolve } from "node:path"

import { describe, expect, it } from "vitest"
import {
  PLATFORM_BASE_RULE_RESOURCES,
  SYNOPSIS_DISCUSS_BASE_RULE_RESOURCES,
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
    expect(PLATFORM_BASE_RULE_RESOURCES.some((path) => path.includes("skill-index"))).toBe(false)
    expect(SYNOPSIS_DISCUSS_BASE_RULE_RESOURCES.some((path) => path.includes("skill-index"))).toBe(true)
  })

  it("loads skill bodies and default packs from adapter", async () => {
    const adapter = new NodePromptResourceAdapter(packageRoot)
    const system = await adapter.loadTurnSystemRules()
    const discussSystem = await adapter.loadSynopsisDiscussSystemRules()
    const overview = await adapter.loadWorldRulesOverview()
    expect(system.text).toContain(overview.text.trim())
    expect(discussSystem.text).toContain(overview.text.trim())
    expect(overview.text).toContain("你负责虚构小说的创作与续写")
    expect(system.text).not.toContain("平台 Skill 索引")
    expect(discussSystem.text).toContain("平台 Skill 索引")
    expect(system.text).not.toContain("# 去 AI 味（deslop）")
    expect(system.text).toContain("不得把明确意思改写成抽象概念、象征或口号")
    expect(system.text).toContain("使用现代中文，不擅自转成古白话、文言句法或仿古腔")
    expect(system.text).toContain("把人变成规矩")

    const skill = await adapter.loadSkill("webnovel-deslop", { includeReferences: false })
    expect(skill.skillId).toBe("webnovel-deslop")
    expect(skill.text).toContain("【skill:webnovel-deslop】")
    expect(skill.text).toContain("去 AI 味")

    const pack = await adapter.loadDefaultSkillPack("synopsis_discuss")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toEqual([
      "starsea-writing",
      "discuss-workflow",
      "plot-synopsis",
    ])
    for (const id of defaultSkillIdsForPhase("synopsis_discuss")) {
      expect(pack.text).toContain(`【skill:${id}】`)
    }
    // 阶段 skill 不再进 discuss 默认包（由 service 按本轮动作拼进 phasePrompt）。
    expect(pack.text.match(/【skill:[a-z0-9-]+】/gu)).toHaveLength(3)
    for (const stageSkillId of [
      "user-to-synopsis",
      "synopsis-to-outline",
      "book-cold-start",
      "settings-revision",
      "webnovel-deslop",
      "webnovel-dialogue",
      "outline-to-draft",
    ]) {
      expect(pack.text).not.toContain(`【skill:${stageSkillId}】`)
    }

    const draftPack = await adapter.loadDefaultSkillPack("draft")
    expect(defaultSkillIdsForPhase("draft")).toEqual(["webnovel-deslop", "webnovel-dialogue", "outline-to-draft"])
    for (const id of defaultSkillIdsForPhase("draft")) {
      expect(draftPack.text).toContain(`【skill:${id}】`)
    }

    // settings_extraction 默认挂载《设定集修订规则》，且与 draft 包互不串味。
    const extractionPack = await adapter.loadDefaultSkillPack("settings_extraction")
    expect(defaultSkillIdsForPhase("settings_extraction")).toEqual(["settings-revision"])
    expect(extractionPack.text).toContain("【skill-pack:settings_extraction】")
    expect(extractionPack.text).toContain("【skill:settings-revision】")
    expect(extractionPack.text.match(/【skill:[a-z0-9-]+】/gu)).toHaveLength(1)
    expect(extractionPack.text).toContain("# 设定集修订规则")
    expect(extractionPack.text).toContain("一主题一文件优先")
    for (const id of defaultSkillIdsForPhase("draft")) {
      expect(extractionPack.text).not.toContain(`【skill:${id}】`)
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
