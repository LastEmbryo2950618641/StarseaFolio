import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { PLATFORM_SKILLS, SKILL_INDEX_RESOURCE } from "../src/index.js"

function readSkillIndex(): string {
  return readFileSync(resolve(process.cwd(), "common/packages/prompt-contracts", SKILL_INDEX_RESOURCE), "utf8")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

describe("static skill index", () => {
  it("stays the single source for the injected index and covers every routed skill exactly once", () => {
    const markdown = readSkillIndex()
    expect(markdown).toContain("# 平台 Skill 索引（按需加载）")

    const rows = [...markdown.matchAll(/^\| `([a-z0-9-]+)` \|/gmu)].map((match) => match[1])
    const skillIds = PLATFORM_SKILLS.map((skill) => skill.id)
    expect(rows).toHaveLength(skillIds.length)
    expect(new Set(rows)).toEqual(new Set(skillIds))

    for (const skill of PLATFORM_SKILLS) {
      const policy = skill.injectPolicy === "default"
        ? `default(${skill.defaultPhases.join(",")})`
        : skill.injectPolicy
      expect(markdown).toMatch(new RegExp(
        `^\\| \`${skill.id}\` \\|[^\\n]*\\| ${escapeRegExp(policy)} \\|`,
        "mu",
      ))
    }
  })
})
