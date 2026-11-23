/** This-work presentation overlay: all files inject every turn; AI may write here. */

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { renderRuntimePrompt } from "../runtime-prompt.js"

const require = createRequire(import.meta.url)
// package exports block ./package.json; resolve entry then walk to package root.
const promptContractsEntry = require.resolve("@starseafolio/prompt-contracts")
const promptContractsRoot = dirname(dirname(promptContractsEntry))

export const WORK_DESCRIPTION_RULES_DIR = "表现输出/本作品描写"
export const DESCRIPTION_RULES_DIR = "表现输出/描写规则"
export const PROSE_STYLE_RULES_DIR = "表现输出/笔风规则"
export const NOVEL_MAJOR_CATEGORY_RULES_DIR = "表现输出/小说大类规则"
export const NOVEL_SUBCATEGORY_RULES_DIR = "表现输出/小说次大类规则"
export const NOVEL_MAJOR_CATEGORY_RULE_PATH_PATTERN = /^表现输出\/小说大类规则\/[^/]+\.md$/u
export const NOVEL_SUBCATEGORY_RULE_PATH_PATTERN = /^表现输出\/小说次大类规则\/[^/]+\.md$/u
export function isSharedPresentationPath(path: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(path)
  return [DESCRIPTION_RULES_DIR, PROSE_STYLE_RULES_DIR, NOVEL_MAJOR_CATEGORY_RULES_DIR, NOVEL_SUBCATEGORY_RULES_DIR]
    .some((directory) => normalized === directory || normalized.startsWith(`${directory}/`))
}
export const AUTO_DESCRIPTION_RULE_PATH = `${DESCRIPTION_RULES_DIR}/自动.md`
export const SENSORY_DESCRIPTION_RULE_PATH = `${DESCRIPTION_RULES_DIR}/感官描写.md`
export const DEAI_DESCRIPTION_RULE_PATH = `${DESCRIPTION_RULES_DIR}/去AI味.md`
export const DEFAULT_PROSE_STYLE_RULE_PATH = `${PROSE_STYLE_RULES_DIR}/默认笔风规则.md`
export const WORK_DESCRIPTION_MAX_FILES = 8
export const WORK_DESCRIPTION_MAX_CHARS = 4000

/** Always-on description baselines (after `自动.md`, before scene cards). */
export const ALWAYS_ON_DESCRIPTION_BASELINES = [
  SENSORY_DESCRIPTION_RULE_PATH,
  DEAI_DESCRIPTION_RULE_PATH,
] as const

const WORK_DESCRIPTION_FILE_PATTERN = /^表现输出\/本作品描写\/[^/]+\.md$/u
const DESCRIPTION_RULE_FILE_PATTERN = /^表现输出\/描写规则\/[^/]+\.md$/u
const USER_PRESET_PRESENTATION_FILE_PATTERN = /^表现输出\/(?:描写规则|笔风规则|小说大类规则|小说次大类规则)\/[^/]+\.md$/u

/** Platform seeds share the same files used by the presentation presets. */
export const SENSORY_DESCRIPTION_RULE_MARKDOWN = readFileSync(
  join(promptContractsRoot, "resources/presentation", SENSORY_DESCRIPTION_RULE_PATH),
  "utf8",
)
export const DEAI_DESCRIPTION_RULE_MARKDOWN = readFileSync(
  join(promptContractsRoot, "resources/presentation", DEAI_DESCRIPTION_RULE_PATH),
  "utf8",
)
export const AUTO_DESCRIPTION_RULE_MARKDOWN = readFileSync(
  join(promptContractsRoot, "resources/presentation", AUTO_DESCRIPTION_RULE_PATH),
  "utf8",
)

export function normalizeWorkspaceRelativePath(path: string): string {
  return path.trim().replace(/\\/gu, "/")
}

/** Direct-child Markdown under `表现输出/本作品描写/`. */
export function isWorkDescriptionRulePath(path: string): boolean {
  return WORK_DESCRIPTION_FILE_PATTERN.test(normalizeWorkspaceRelativePath(path))
}

export function isDescriptionRuleMarkdownPath(path: string): boolean {
  return DESCRIPTION_RULE_FILE_PATTERN.test(normalizeWorkspaceRelativePath(path))
}

/** User-owned dropdown presets; AI must not write these. */
export function isUserPresetPresentationRulePath(path: string): boolean {
  return USER_PRESET_PRESENTATION_FILE_PATTERN.test(normalizeWorkspaceRelativePath(path))
}

/** Empty dropdown or the platform `自动.md` path. */
export function isAutoDescriptionSelection(path: string | undefined): boolean {
  const normalized = path?.trim()
  return normalized === undefined
    || normalized.length === 0
    || normalizeWorkspaceRelativePath(normalized) === AUTO_DESCRIPTION_RULE_PATH
}

export function listDescriptionRuleFiles<T extends { relativePath: string; entryKind: string }>(
  entries: readonly T[],
): T[] {
  return entries
    .filter((entry) => entry.entryKind === "file" && isDescriptionRuleMarkdownPath(entry.relativePath))
    .slice()
    .sort((left, right) => {
      const leftPath = normalizeWorkspaceRelativePath(left.relativePath)
      const rightPath = normalizeWorkspaceRelativePath(right.relativePath)
      if (leftPath === AUTO_DESCRIPTION_RULE_PATH) return -1
      if (rightPath === AUTO_DESCRIPTION_RULE_PATH) return 1
      const leftBaseline = ALWAYS_ON_DESCRIPTION_BASELINES.indexOf(
        leftPath as typeof ALWAYS_ON_DESCRIPTION_BASELINES[number],
      )
      const rightBaseline = ALWAYS_ON_DESCRIPTION_BASELINES.indexOf(
        rightPath as typeof ALWAYS_ON_DESCRIPTION_BASELINES[number],
      )
      if (leftBaseline !== -1 || rightBaseline !== -1) {
        if (leftBaseline === -1) return 1
        if (rightBaseline === -1) return -1
        return leftBaseline - rightBaseline
      }
      return leftPath.localeCompare(rightPath, "zh-CN")
    })
}

/**
 * Auto: only `自动.md` + always-on baselines (scene cards on demand via request_read / lock).
 * Locked: selected file + always-on baselines (`感官描写.md`, `去AI味.md`).
 */
export function resolveDescriptionRulePaths(
  descriptionRulePath: string | undefined,
  catalogEntries: readonly { relativePath: string; entryKind: string }[],
): string[] {
  if (!isAutoDescriptionSelection(descriptionRulePath)) {
    const selected = normalizeWorkspaceRelativePath(descriptionRulePath ?? "")
    if (!isDescriptionRuleMarkdownPath(selected)) {
      throw new Error(`Description rule must be inside ${DESCRIPTION_RULES_DIR}: ${descriptionRulePath ?? ""}`)
    }
    return ensureAlwaysOnDescriptionBaselines([selected])
  }
  const catalogPaths = new Set(
    listDescriptionRuleFiles(catalogEntries).map((entry) => normalizeWorkspaceRelativePath(entry.relativePath)),
  )
  if (!catalogPaths.has(AUTO_DESCRIPTION_RULE_PATH) && catalogPaths.size === 0) {
    throw new Error(`Selected presentation rule is missing: ${AUTO_DESCRIPTION_RULE_PATH}`)
  }
  return ensureAlwaysOnDescriptionBaselines([AUTO_DESCRIPTION_RULE_PATH])
}

/** Scene cards under 描写规则 (excludes auto conductor + always-on baselines). */
export function isDescriptionSceneCardPath(path: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(path)
  if (!isDescriptionRuleMarkdownPath(normalized)) return false
  if (normalized === AUTO_DESCRIPTION_RULE_PATH) return false
  if ((ALWAYS_ON_DESCRIPTION_BASELINES as readonly string[]).includes(normalized)) return false
  return true
}

/**
 * Default left-tree filter: keep primary description surfaces; hide scene cards unless expanded.
 */
export function isPrimaryWorkspaceSkillPath(path: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(path)
  if (isDescriptionSceneCardPath(normalized)) return false
  return true
}

/** Keep always-on baselines after auto, before scene cards; force-include even if catalog omitted them. */
export function ensureAlwaysOnDescriptionBaselines(paths: readonly string[]): string[] {
  const baselineSet = new Set<string>(ALWAYS_ON_DESCRIPTION_BASELINES)
  const normalized = paths.map((path) => normalizeWorkspaceRelativePath(path))
  const withoutBaselines = normalized.filter((path) => !baselineSet.has(path))
  const auto = withoutBaselines.filter((path) => path === AUTO_DESCRIPTION_RULE_PATH)
  const rest = withoutBaselines.filter((path) => path !== AUTO_DESCRIPTION_RULE_PATH)
  return [...auto, ...ALWAYS_ON_DESCRIPTION_BASELINES, ...rest]
}

/** @deprecated Use ensureAlwaysOnDescriptionBaselines */
export function ensureSensoryDescriptionAlwaysIncluded(paths: readonly string[]): string[] {
  return ensureAlwaysOnDescriptionBaselines(paths)
}

export function formatDescriptionRuleEvidence(
  relativePath: string,
  content: string,
  autoMode: boolean,
): string {
  const path = normalizeWorkspaceRelativePath(relativePath)
  if (path === SENSORY_DESCRIPTION_RULE_PATH) {
    return renderRuntimePrompt("presentation-evidence", "sensory", { content })
  }
  if (path === DEAI_DESCRIPTION_RULE_PATH) {
    return renderRuntimePrompt("presentation-evidence", "prose-polish", { content })
  }
  if (autoMode) {
    if (path === AUTO_DESCRIPTION_RULE_PATH) {
      return renderRuntimePrompt("presentation-evidence", "auto", { content })
    }
    return renderRuntimePrompt("presentation-evidence", "scene-card", { path, content })
  }
  return renderRuntimePrompt("presentation-evidence", "selected", { content })
}

export function assertWorkDescriptionCharLimit(relativePath: string, content: string): void {
  if (content.length > WORK_DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `本作品描写「${relativePath}」超过 ${String(WORK_DESCRIPTION_MAX_CHARS)} 字（当前 ${String(content.length)} 字）。请拆分或删减后重试。`,
    )
  }
}

export function listWorkDescriptionRuleFiles<T extends { relativePath: string; entryKind: string }>(
  entries: readonly T[],
): T[] {
  const prefix = `${WORK_DESCRIPTION_RULES_DIR}/`
  const unexpected = entries.filter((entry) => (
    entry.relativePath.startsWith(prefix)
    && !(entry.entryKind === "file" && isWorkDescriptionRulePath(entry.relativePath))
  ))
  const firstUnexpected = unexpected[0]
  if (firstUnexpected !== undefined) {
    throw new Error(
      `本作品描写只允许直接放 .md 文件，不能有子文件夹或非 Markdown。发现：${firstUnexpected.relativePath}`,
    )
  }
  const files = entries
    .filter((entry) => entry.entryKind === "file" && isWorkDescriptionRulePath(entry.relativePath))
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
  if (files.length > WORK_DESCRIPTION_MAX_FILES) {
    throw new Error(
      `本作品描写最多 ${String(WORK_DESCRIPTION_MAX_FILES)} 个文件，当前 ${String(files.length)} 个。请合并或删除后再推演。`,
    )
  }
  return files
}

export function formatWorkDescriptionRuleEvidence(relativePath: string, content: string): string {
  assertWorkDescriptionCharLimit(relativePath, content)
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  const isWorkStyle = normalized === `${WORK_DESCRIPTION_RULES_DIR}/作品风格.md`
  if (isWorkStyle) {
    return renderRuntimePrompt("presentation-evidence", "work-style", { content })
  }
  return renderRuntimePrompt("presentation-evidence", "work-description", { content })
}

export function assertWorkDescriptionWriteBatch(input: Readonly<{
  existingPaths: readonly string[]
  writes: readonly Readonly<{ relativePath: string; markdown: string }>[]
}>): void {
  const resulting = new Set(
    input.existingPaths
      .map((path) => normalizeWorkspaceRelativePath(path))
      .filter((path) => isWorkDescriptionRulePath(path)),
  )
  for (const write of input.writes) {
    const path = normalizeWorkspaceRelativePath(write.relativePath)
    if (!isWorkDescriptionRulePath(path)) {
      throw new Error(`表现规则写入路径非法（仅允许 ${WORK_DESCRIPTION_RULES_DIR}/*.md）：${write.relativePath}`)
    }
    assertWorkDescriptionCharLimit(path, write.markdown)
    resulting.add(path)
  }
  if (resulting.size > WORK_DESCRIPTION_MAX_FILES) {
    throw new Error(
      `本作品描写最多 ${String(WORK_DESCRIPTION_MAX_FILES)} 个文件，写入后将达到 ${String(resulting.size)} 个。请合并或删除后再保存。`,
    )
  }
}
