import type { DiscussAgentMode, DiscussCustomProceedGates, DiscussProceedMode } from "@starseafolio/contracts"
import { mergeCustomProceedGates, resolveDiscussProceedMode } from "@starseafolio/contracts"

import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

export function discussAgentModePromptAppendix(
  mode: DiscussAgentMode,
  options?: Readonly<{
    batchProceed?: boolean
    proceedMode?: DiscussProceedMode
    customProceedGates?: DiscussCustomProceedGates
  }>,
): string {
  const proceedMode = resolveDiscussProceedMode({
    ...(options?.proceedMode === undefined ? {} : { proceedMode: options.proceedMode }),
    ...(options?.batchProceed === undefined ? {} : { batchProceed: options.batchProceed }),
  })
  if (mode === "plan") {
    return renderRuntimePrompt("discuss-agent-policy", "plan")
  }
  if (mode === "accept_edits") {
    return renderRuntimePrompt("discuss-agent-policy", "accept-edits", {
      proceed: acceptEditsProceedAppendix(proceedMode, options?.customProceedGates),
    })
  }
  return renderRuntimePrompt("discuss-agent-policy", "auto", {
    proceed: proceedModePromptAppendix(proceedMode, options?.customProceedGates),
  })
}

function acceptEditsProceedAppendix(
  mode: DiscussProceedMode,
  customGates?: DiscussCustomProceedGates,
): string {
  if (mode === "batch") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "batch-proceed"),
      renderRuntimePrompt("discuss-agent-policy", "accept-edits-batch-choices"),
    ].join("")
  }
  if (mode === "precise") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "step-confirm"),
      renderRuntimePrompt("discuss-agent-policy", "accept-edits-wait"),
    ].join("")
  }
  if (mode === "single") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "single-chapter"),
      renderRuntimePrompt("discuss-agent-policy", "accept-edits-wait"),
    ].join("")
  }
  return [
    proceedModePromptAppendix(mode, customGates),
    renderRuntimePrompt("discuss-agent-policy", "accept-edits-wait"),
  ].join("")
}

function proceedModePromptAppendix(
  mode: DiscussProceedMode,
  customGates?: DiscussCustomProceedGates,
): string {
  if (mode === "batch") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "batch-proceed"),
      renderRuntimePrompt("discuss-agent-policy", "batch-auto-decide"),
    ].join("")
  }
  if (mode === "precise") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "step-confirm"),
      renderRuntimePrompt("discuss-agent-policy", "precise-gates"),
    ].join("")
  }
  if (mode === "single") {
    return [
      renderRuntimePrompt("discuss-agent-policy", "single-chapter"),
      renderRuntimePrompt("discuss-agent-policy", "single-auto-decide"),
    ].join("")
  }
  const gates = mergeCustomProceedGates(customGates)
  const nodes: ReadonlyArray<{ label: string; auto: boolean }> = [
    { label: STAGE_LABEL.chapter_requirements, auto: gates.chapter_requirements },
    {
      label: "构思（梗概+细纲+草稿）",
      auto: gates.synopsis_discuss && gates.outline_discuss && gates.draft_discuss,
    },
    { label: STAGE_LABEL.body_discuss, auto: gates.body_discuss },
  ]
  const autoLabels = nodes.filter((node) => node.auto).map((node) => node.label)
  const stopLabels = nodes.filter((node) => !node.auto).map((node) => node.label)
  return renderRuntimePrompt("discuss-agent-policy", "custom", {
    autoNodes: autoLabels.length > 0
      ? renderRuntimePrompt("discuss-agent-policy", "custom-auto-nodes", { labels: autoLabels.join("、") })
      : renderRuntimePrompt("discuss-agent-policy", "custom-no-auto-nodes"),
    stopNodes: stopLabels.length > 0
      ? renderRuntimePrompt("discuss-agent-policy", "custom-stop-nodes", { labels: stopLabels.join("、") })
      : renderRuntimePrompt("discuss-agent-policy", "custom-no-stop-nodes"),
    bodyGate: gates.body_discuss
      ? renderRuntimePrompt("discuss-agent-policy", "custom-auto-body")
      : renderRuntimePrompt("discuss-agent-policy", "custom-confirm-body"),
    advanceRule: Object.values(gates).every(Boolean)
      ? renderRuntimePrompt("discuss-agent-policy", "custom-auto-advance")
      : renderRuntimePrompt("discuss-agent-policy", "custom-confirm-advance"),
  })
}

const STAGE_LABEL: Record<keyof DiscussCustomProceedGates, string> = {
  chapter_requirements: "新章用户要求",
  synopsis_discuss: "构思（梗概+细纲+草稿）",
  outline_discuss: "构思（梗概+细纲+草稿）",
  draft_discuss: "构思（梗概+细纲+草稿）",
  body_discuss: "正文确认",
}
