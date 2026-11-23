/**
 * 提示词路径判定（纯函数）。
 *
 * 平台提示词有两类落点：
 * - 固定顶层目录 `提示词/`（分类：系统规则/阶段提示/运行时提示/写作指南/技能）；
 * - 平台规则在工作区里的镜像：`世界推演规则/总览.md`、`世界推演规则/人物设定.md`、
 *   `世界推演规则/基础规则/**`。
 *
 * 这些文件在侧边栏可编辑，但保存前需要确认「写入全局提示词库」。
 */
import { CHARACTER_RULE_PATH, WORLD_RULES_OVERVIEW_PATH } from "@starseafolio/contracts"

export const PROMPT_DIRECTORY = "提示词"

export const PROMPT_CATEGORIES = ["系统规则", "阶段提示", "运行时提示", "写作指南", "技能"] as const

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

export const PLATFORM_PROMPT_MIRROR_PREFIX = "世界推演规则/基础规则"

const PLATFORM_PROMPT_MIRROR_PATHS: ReadonlySet<string> = new Set([
  WORLD_RULES_OVERVIEW_PATH,
  CHARACTER_RULE_PATH,
])

export function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "")
}

/** True for every editable platform-prompt path (prompt library or platform-rule mirror). */
export function isPromptPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === PROMPT_DIRECTORY || normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return true
  if (PLATFORM_PROMPT_MIRROR_PATHS.has(normalized)) return true
  return normalized === PLATFORM_PROMPT_MIRROR_PREFIX
    || normalized.startsWith(`${PLATFORM_PROMPT_MIRROR_PREFIX}/`)
}

/** 分类名（用于对话框副标题/树徽标 tooltip）；镜像规则归为「平台规则」。 */
export function promptCategoryLabel(path: string): string | undefined {
  const normalized = normalizeWorkspacePath(path)
  if (normalized.startsWith(`${PROMPT_DIRECTORY}/`)) {
    const [category] = normalized.slice(PROMPT_DIRECTORY.length + 1).split("/")
    return category !== undefined && (PROMPT_CATEGORIES as readonly string[]).includes(category)
      ? category
      : undefined
  }
  if (normalized === PLATFORM_PROMPT_MIRROR_PREFIX || normalized.startsWith(`${PLATFORM_PROMPT_MIRROR_PREFIX}/`)) {
    return "平台规则"
  }
  if (PLATFORM_PROMPT_MIRROR_PATHS.has(normalized)) return "平台规则"
  return undefined
}
