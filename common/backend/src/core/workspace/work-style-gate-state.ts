import { assessWorkStyleMarkdown } from "./work-style-gate.js"
import { NOVEL_MAJOR_CATEGORY_RULE_PATH_PATTERN, NOVEL_SUBCATEGORY_RULE_PATH_PATTERN } from "./work-description-rules.js"

export type WorkStyleGateState =
  | Readonly<{ status: "awaiting_choice" }>
  | Readonly<{ status: "style_selected"; selectedProseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string }>
  | Readonly<{ status: "ready"; selectedProseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string; styleDigest: string }>

export type WorkStyleGateEvent =
  | Readonly<{ type: "select_style"; proseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string }>
  | Readonly<{ type: "style_document_saved"; markdown: string; digest: string }>
  | Readonly<{ type: "style_document_changed"; currentDigest: string }>

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
      if (state.status !== "ready" || event.currentDigest === state.styleDigest) return state
      return { status: "style_selected", selectedProseStylePath: state.selectedProseStylePath, novelMajorCategoryRulePath: state.novelMajorCategoryRulePath, novelSubcategoryRulePath: state.novelSubcategoryRulePath }
    }
  }
}

export function canProceedPastWorkStyleGate(state: WorkStyleGateState): boolean {
  return state.status === "ready"
}

export function normalizeProseStylePath(value: string): string | undefined {
  const path = normalizePath(value)
  return path.startsWith("表现输出/笔风规则/") && path.endsWith(".md") && path.length > "表现输出/笔风规则/.md".length
    ? path
    : undefined
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").trim()
}
