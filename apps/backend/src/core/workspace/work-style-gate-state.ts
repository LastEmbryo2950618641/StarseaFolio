import { assessWorkStyleMarkdown } from "./work-style-gate.js"

export type WorkStyleGateState =
  | Readonly<{ status: "awaiting_choice" }>
  | Readonly<{ status: "style_selected"; selectedProseStylePath: string }>
  | Readonly<{ status: "ready"; selectedProseStylePath: string; styleDigest: string }>

export type WorkStyleGateEvent =
  | Readonly<{ type: "select_style"; proseStylePath: string }>
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
      return { status: "style_selected", selectedProseStylePath: path }
    }
    case "style_document_saved": {
      if (state.status !== "style_selected") return state
      const assessment = assessWorkStyleMarkdown(event.markdown)
      const selectedPath = normalizePath(state.selectedProseStylePath)
      if (!assessment.complete || !normalizePath(event.markdown).includes(selectedPath)) return state
      return {
        status: "ready",
        selectedProseStylePath: state.selectedProseStylePath,
        styleDigest: event.digest,
      }
    }
    case "style_document_changed": {
      if (state.status !== "ready" || event.currentDigest === state.styleDigest) return state
      return { status: "style_selected", selectedProseStylePath: state.selectedProseStylePath }
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
