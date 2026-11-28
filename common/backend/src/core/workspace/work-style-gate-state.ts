import { assessWorkStyleMarkdown, isWorkStyleComplete } from "./work-style-gate.js"
import { NOVEL_MAJOR_CATEGORY_RULE_PATH_PATTERN, NOVEL_SUBCATEGORY_RULE_PATH_PATTERN } from "./work-description-rules.js"

export type WorkStyleGateState =
  | Readonly<{ status: "awaiting_choice" }>
  | Readonly<{ status: "style_selected"; selectedProseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string }>
  | Readonly<{ status: "ready"; selectedProseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string; styleDigest: string }>

export type WorkStyleGateEvent =
  | Readonly<{ type: "select_style"; proseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string }>
  | Readonly<{ type: "style_document_saved"; markdown: string; digest: string }>
  | Readonly<{ type: "style_document_changed"; currentDigest: string; markdown?: string }>

export function initialWorkStyleGateState(): WorkStyleGateState {
  return { status: "awaiting_choice" }
}

export function transitionWorkStyleGateState(
  state: WorkStyleGateState,
  event: WorkStyleGateEvent,
): WorkStyleGateState {
  switch (event.type) {
    case "select_style": {
      const path = normalizeProseStylePath(event.proseStylePath)
      if (path === undefined) throw new Error("必须选择表现输出/笔风规则目录中的笔风规则")
      const majorPath = normalizePath(event.novelMajorCategoryRulePath)
      const subcategoryPath = normalizePath(event.novelSubcategoryRulePath)
      if (!NOVEL_MAJOR_CATEGORY_RULE_PATH_PATTERN.test(majorPath) || !NOVEL_SUBCATEGORY_RULE_PATH_PATTERN.test(subcategoryPath)) {
        throw new Error("风格门禁必须选择小说大类和小说次大类规则")
      }
      return { status: "style_selected", selectedProseStylePath: path, novelMajorCategoryRulePath: majorPath, novelSubcategoryRulePath: subcategoryPath }
    }
    case "style_document_saved": {
      if (state.status !== "style_selected") return state
      const assessment = assessWorkStyleMarkdown(event.markdown)
      const selectedPath = normalizePath(state.selectedProseStylePath)
      const normalizedMarkdown = normalizePath(event.markdown)
      // The model sometimes writes「小说大类规则路径：」or a list item「- 小说大类规则：」instead of the canonical anchor.
      const hasAnchor = (label: string, path: string): boolean => {
        const wanted = normalizePath(path)
        const pattern = new RegExp(`${label}(?:路径)?[：:]`, "gu")
        for (const match of normalizedMarkdown.matchAll(pattern)) {
          const rest = normalizedMarkdown.slice(match.index + match[0].length, match.index + match[0].length + 200)
          if (rest.replace(/^[\s>*`_"'【\[]+/u, "").startsWith(wanted)) return true
        }
        return false
      }
      if (!assessment.complete || !hasAnchor("小说笔风", selectedPath)
        || !hasAnchor("小说大类规则", state.novelMajorCategoryRulePath)
        || !hasAnchor("小说次大类规则", state.novelSubcategoryRulePath)) return state
      return {
        status: "ready",
        selectedProseStylePath: state.selectedProseStylePath,
        novelMajorCategoryRulePath: state.novelMajorCategoryRulePath,
        novelSubcategoryRulePath: state.novelSubcategoryRulePath,
        styleDigest: event.digest,
      }
    }
    case "style_document_changed": {
      // Style may be adjusted after the gate passes. Keep ready whenever the
      // document is still complete; only demote when it becomes incomplete.
      if (state.status !== "ready" || event.currentDigest === state.styleDigest) return state
      if (event.markdown !== undefined && !isWorkStyleComplete(event.markdown)) {
        return {
          status: "style_selected",
          selectedProseStylePath: state.selectedProseStylePath,
          novelMajorCategoryRulePath: state.novelMajorCategoryRulePath,
          novelSubcategoryRulePath: state.novelSubcategoryRulePath,
        }
      }
      return { ...state, styleDigest: event.currentDigest }
    }
  }
}

export function canProceedPastWorkStyleGate(state: WorkStyleGateState): boolean {
  return state.status === "ready"
}

/** Soft guidance when style has never been chosen — discuss should offer choices, not a hard stop banner. */
export const WORK_STYLE_SELECTION_PENDING_MESSAGE = "尚未选择文风：请先在创作台讨论中选择小说大类、次大类与笔风规则，选好后再继续。"

export function normalizeProseStylePath(value: string): string | undefined {
  const path = normalizePath(value)
  return path.startsWith("表现输出/笔风规则/") && path.endsWith(".md") && path.length > "表现输出/笔风规则/.md".length
    ? path
    : undefined
}

/** Recover selection paths from an already-written complete 作品风格.md. */
export function extractWorkStyleSelectionFromMarkdown(markdown: string): Readonly<{
  proseStylePath: string
  novelMajorCategoryRulePath: string
  novelSubcategoryRulePath: string
}> | undefined {
  const text = normalizePath(markdown)
  // 容忍「- 小说大类规则：路径」「* 小说笔风: 路径」等清单/加粗写法。
  const stripDecoration = (value: string): string => value.replace(/^[\s>*`_"'【\[]+/u, "").replace(/[`_"'】\]]+$/u, "").trim()
  const matchPath = (label: string): string | undefined => {
    const pattern = new RegExp(`${label}(?:路径)?[：:]\\s*([^\\s，。；;\\n]+?\\.md)`, "u")
    const found = text.match(pattern)?.[1]
    return found === undefined ? undefined : stripDecoration(found)
  }
  const major = matchPath("小说大类规则")
  const subcategory = matchPath("小说次大类规则")
  const prose = matchPath("小说笔风")
  if (major === undefined || subcategory === undefined || prose === undefined) return undefined
  if (!NOVEL_MAJOR_CATEGORY_RULE_PATH_PATTERN.test(major) || !NOVEL_SUBCATEGORY_RULE_PATH_PATTERN.test(subcategory)) {
    return undefined
  }
  const proseStylePath = normalizeProseStylePath(prose)
  if (proseStylePath === undefined) return undefined
  return {
    proseStylePath,
    novelMajorCategoryRulePath: major,
    novelSubcategoryRulePath: subcategory,
  }
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").trim()
}
