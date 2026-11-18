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
      if (!assessment.complete || !normalizePath(event.markdown).includes(`小说笔风：${selectedPath}`)
        || !normalizePath(event.markdown).includes(`小说大类规则：${state.novelMajorCategoryRulePath}`)
        || !normalizePath(event.markdown).includes(`小说次大类规则：${state.novelSubcategoryRulePath}`)) return state
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
  const major = text.match(/小说大类规则：\s*(表现输出\/小说大类规则\/[^\s，。；;\n]+?\.md)/u)?.[1]
  const subcategory = text.match(/小说次大类规则：\s*(表现输出\/小说次大类规则\/[^\s，。；;\n]+?\.md)/u)?.[1]
  const prose = text.match(/小说笔风：\s*(表现输出\/笔风规则\/[^\s，。；;\n]+?\.md)/u)?.[1]
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
