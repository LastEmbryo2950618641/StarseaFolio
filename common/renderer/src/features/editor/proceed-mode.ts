import {
  resolveProceedAutonomy,
  type DiscussAgentMode,
  type DiscussProceedStage,
} from "@starseafolio/contracts"

const MODE_STORAGE_KEY = "worldseed.creation-desk.proceed-mode"
const LEGACY_BATCH_KEY = "worldseed.creation-desk.batch-proceed"

export type ProceedMode = "precise" | "batch"

/** 梗概、细纲与草稿 are one atomic「构思」gate; only publish remains a separate stop. */
export type ProceedDisplayStage = "chapter_requirements" | "compose_discuss" | "body_discuss"

export const PROCEED_DISPLAY_STAGE_ORDER: readonly ProceedDisplayStage[] = [
  "chapter_requirements",
  "compose_discuss",
  "body_discuss",
]

const PROCEED_DISPLAY_STAGE_GROUPS: Readonly<Record<ProceedDisplayStage, readonly DiscussProceedStage[]>> = {
  chapter_requirements: ["chapter_requirements"],
  compose_discuss: ["synopsis_discuss", "outline_discuss", "draft_discuss"],
  body_discuss: ["body_discuss"],
}

export const PROCEED_DISPLAY_STAGE_LABELS: Record<ProceedDisplayStage, string> = {
  chapter_requirements: "新章要求",
  compose_discuss: "构思",
  body_discuss: "正文确认",
}

export function displayStageForProceedStage(stage: DiscussProceedStage): ProceedDisplayStage {
  // Once the draft exists, 构思 (synopsis + outline + draft) is complete and
  // the only remaining stop is publishing the draft as chapter body.
  if (stage === "chapter_requirements") return stage
  if (stage === "synopsis_discuss" || stage === "outline_discuss") return "compose_discuss"
  return "body_discuss"
}

export const PROCEED_MODE_OPTIONS: ReadonlyArray<{
  value: ProceedMode
  label: string
  hint: string
}> = [
  { value: "precise", label: "精准推进", hint: "讨论后手动开始构思（梗概、细纲与草稿），核对草稿后手动发布" },
  { value: "batch", label: "批量推进", hint: "卷内自动连跑，可用对话框 Stop 暂停" },
]

export function displayGateAuto(input: Readonly<{
  stage: ProceedDisplayStage
  mode: ProceedMode
  agentMode?: DiscussAgentMode
}>): boolean {
  return PROCEED_DISPLAY_STAGE_GROUPS[input.stage].every((stage) => resolveProceedAutonomy({
    mode: input.mode,
    stage,
    ...(input.agentMode === undefined ? {} : { agentMode: input.agentMode }),
  }))
}

export function loadProceedMode(): ProceedMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (raw === "precise" || raw === "batch") return raw
    if (raw === "single" || raw === "custom") {
      persistProceedMode("precise")
      return "precise"
    }
    const legacy = window.localStorage.getItem(LEGACY_BATCH_KEY)
    if (legacy === "1" || legacy === "true" || legacy === "0" || legacy === "false") {
      const mode = legacy === "1" || legacy === "true" ? "batch" : "precise"
      persistProceedMode(mode)
      return mode
    }
  } catch {
    // Storage is optional, including during server rendering.
  }
  return "precise"
}

export function persistProceedMode(mode: ProceedMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Storage is optional.
  }
}
