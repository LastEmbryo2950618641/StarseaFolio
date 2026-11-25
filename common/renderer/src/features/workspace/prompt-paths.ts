/**
 * 提示词路径判定（纯函数）。
 *
 * 目标结构：
 * 提示词/{基础规则,用户规则,系统记忆}/{系统提示词,阶段提示词,消息前后}
 * 阶段/消息文件夹内再按阶段/前后分目录；标签由目录确定。
 */
import { CHARACTER_RULE_PATH, WORLD_RULES_OVERVIEW_PATH } from "@starseafolio/contracts"

export const PROMPT_DIRECTORY = "提示词"

export const PROMPT_SCOPES = ["基础规则", "用户规则", "系统记忆"] as const
export const PROMPT_CATEGORIES = ["系统提示词", "阶段提示词", "消息前后"] as const

export type PromptScope = (typeof PROMPT_SCOPES)[number]
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]
export type PromptTag = "系统" | "消息前" | "消息后" | "新章节阶段" | "梗概阶段" | "草稿阶段" | "章节入库阶段"

export const PLATFORM_PROMPT_MIRROR_PREFIX = "世界推演规则/基础规则"

const PLATFORM_PROMPT_MIRROR_PATHS: ReadonlySet<string> = new Set([
  WORLD_RULES_OVERVIEW_PATH,
  CHARACTER_RULE_PATH,
])

const LEGACY_PROMPT_CATEGORIES = new Set(["系统规则", "阶段提示", "运行时提示", "写作指南", "技能"])

export function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "")
}

/** True for every editable prompt path (new library or legacy platform mirror). */
export function isPromptPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === PROMPT_DIRECTORY || normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return true
  if (PLATFORM_PROMPT_MIRROR_PATHS.has(normalized)) return true
  return normalized === PLATFORM_PROMPT_MIRROR_PREFIX
    || normalized.startsWith(`${PLATFORM_PROMPT_MIRROR_PREFIX}/`)
}

/** 旧提示词分类/旧世界规则目录；升级后不再显示。 */
export function isLegacyPromptLibraryPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === "世界推演规则" || normalized.startsWith("世界推演规则/")) return true
  if (!normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return false
  const [category] = normalized.slice(PROMPT_DIRECTORY.length + 1).split("/")
  return category !== undefined && LEGACY_PROMPT_CATEGORIES.has(category)
}

/** 隐藏旧目录，避免升级后侧边栏出现两套提示词。 */
export function filterVisiblePromptEntries<T extends { path: string }>(entries: readonly T[]): readonly T[] {
  return entries.filter((entry) => !isLegacyPromptLibraryPath(entry.path))
}

function segments(path: string): readonly string[] {
  return normalizeWorkspacePath(path).slice(PROMPT_DIRECTORY.length + 1).split("/")
}

function stageTag(value: string): PromptTag | undefined {
  if (value.includes("新章节")) return "新章节阶段"
  if (value.includes("梗概")) return "梗概阶段"
  if (value.includes("草稿")) return "草稿阶段"
  if (value.includes("章节入库")) return "章节入库阶段"
  return undefined
}

/** User/AI may author prompt files only in user/system-memory scopes. */
export function isPromptAuthoringDirectory(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return false
  const [scope, category, stage] = segments(normalized)
  if (scope !== "用户规则" && scope !== "系统记忆") return false
  if (category === "系统提示词") return true
  if (category === "阶段提示词") return true
  if (category === "消息前后") return stage === "用户消息前" || stage === "用户消息后"
  return false
}

/** 文件标签：系统 / 消息前 / 消息后 / xx阶段。 */
export function promptTag(path: string): PromptTag | undefined {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return undefined
  const [scope, category, ...rest] = segments(normalized)
  if (!(PROMPT_SCOPES as readonly string[]).includes(scope ?? "")) return undefined
  if (category === "系统提示词") return "系统"
  if (category === "消息前后") {
    const hint = `${rest[0] ?? ""}/${rest.at(-1) ?? ""}`
    return hint.includes("消息前") ? "消息前" : hint.includes("消息后") ? "消息后" : undefined
  }
  if (category === "阶段提示词") {
    return stageTag(rest[0] ?? "") ?? stageTag(rest.at(-1) ?? "")
  }
  return undefined
}

export function promptScope(path: string): PromptScope | undefined {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized.startsWith(`${PROMPT_DIRECTORY}/`)) return undefined
  const [scope] = segments(normalized)
  return (PROMPT_SCOPES as readonly string[]).includes(scope ?? "") ? scope as PromptScope : undefined
}

/** 分类名（用于对话框副标题/树徽标 tooltip）。 */
export function promptCategoryLabel(path: string): string | undefined {
  const normalized = normalizeWorkspacePath(path)
  if (normalized.startsWith(`${PROMPT_DIRECTORY}/`)) {
    const [scope, category] = segments(normalized)
    return (PROMPT_SCOPES as readonly string[]).includes(scope ?? "")
      && (PROMPT_CATEGORIES as readonly string[]).includes(category ?? "")
      ? `${scope} · ${category}`
      : undefined
  }
  if (normalized === PLATFORM_PROMPT_MIRROR_PREFIX || normalized.startsWith(`${PLATFORM_PROMPT_MIRROR_PREFIX}/`)) {
    return "平台规则"
  }
  if (PLATFORM_PROMPT_MIRROR_PATHS.has(normalized)) return "平台规则"
  return undefined
}
