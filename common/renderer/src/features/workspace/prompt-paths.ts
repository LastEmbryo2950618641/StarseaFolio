/**
 * 提示词路径判定（纯函数）。
 *
 * 目标结构：
 * 提示词/{基础规则,用户规则,系统记忆}/{系统提示词,阶段提示词,消息前后}
 * 阶段提示词和消息前后直接存放 Markdown；标签由文件名确定。
 */
import { CHARACTER_RULE_PATH, WORLD_RULES_OVERVIEW_PATH } from "@starseafolio/contracts"

export const PROMPT_DIRECTORY = "提示词"

export const PROMPT_SCOPES = ["基础规则", "用户规则", "系统记忆"] as const
export const PROMPT_CATEGORIES = ["系统提示词", "阶段提示词", "消息前后"] as const

export type PromptScope = (typeof PROMPT_SCOPES)[number]
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]
const STAGE_PROMPT_TYPES = ["新章节阶段", "构思阶段", "章节入库阶段"] as const
export type PromptTag = "系统" | "消息前" | "消息后" | (typeof STAGE_PROMPT_TYPES)[number]

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
  if (value.includes("构思") || value.includes("梗概") || value.includes("细纲") || value.includes("草稿")) return "构思阶段"
  if (value.includes("章节入库")) return "章节入库阶段"
  return undefined
}

export const USER_PROMPT_ROOT = `${PROMPT_DIRECTORY}/用户规则`

const USER_PROMPT_TYPES: Record<PromptCategory, readonly string[]> = {
  系统提示词: ["系统提示词"],
  阶段提示词: STAGE_PROMPT_TYPES,
  消息前后: ["用户消息前", "用户消息后"],
}

export function userPromptCategory(path: string): PromptCategory | undefined {
  const normalized = normalizeWorkspacePath(path)
  return PROMPT_CATEGORIES.find((category) => normalized === `${USER_PROMPT_ROOT}/${category}`)
}

export function userPromptTypes(category: PromptCategory): readonly string[] {
  return USER_PROMPT_TYPES[category]
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
    return scope !== undefined && category !== undefined
      && (PROMPT_SCOPES as readonly string[]).includes(scope)
      && (PROMPT_CATEGORIES as readonly string[]).includes(category)
      ? `${scope} · ${category}`
      : undefined
  }
  if (normalized === PLATFORM_PROMPT_MIRROR_PREFIX || normalized.startsWith(`${PLATFORM_PROMPT_MIRROR_PREFIX}/`)) {
    return "平台规则"
  }
  if (PLATFORM_PROMPT_MIRROR_PATHS.has(normalized)) return "平台规则"
  return undefined
}

export type WorkspaceDirectoryBadge = Readonly<{
  label: string
  tooltip: string
}>

/** 文件夹侧徽标：标明该目录内提示词/规则在何范围生效或于何阶段注入。 */
export function workspaceDirectoryBadge(path: string): WorkspaceDirectoryBadge | undefined {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === "表现输出/描写规则" || normalized === "表现输出/笔风规则") {
    return {
      label: "共享",
      tooltip: "所有作品共享，修改会对所有作品生效",
    }
  }
  if (normalized === "表现输出/本作品描写") {
    return {
      label: "构思阶段",
      tooltip: "本文件夹内提示词在构思阶段全部注入讨论与生成",
    }
  }
  return undefined
}
