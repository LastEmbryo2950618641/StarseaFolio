import {
  resolveProceedAutonomy,
  type DiscussAgentMode,
  type DiscussCustomProceedGates,
  type DiscussProceedMode,
  type DiscussProceedStage,
} from "@starseafolio/contracts"

const MODE_STORAGE_KEY = "worldseed.creation-desk.proceed-mode"
const GATES_STORAGE_KEY = "worldseed.creation-desk.custom-proceed-gates"
/** Legacy boolean toggle; migrated once into MODE_STORAGE_KEY. */
const LEGACY_BATCH_KEY = "worldseed.creation-desk.batch-proceed"

const PROCEED_MODES = ["precise", "single", "batch", "custom"] as const satisfies readonly DiscussProceedMode[]

export const DEFAULT_CUSTOM_PROCEED_GATES: DiscussCustomProceedGates = {
  chapter_requirements: false,
  synopsis_discuss: true,
  outline_discuss: true,
  draft_discuss: true,
  body_discuss: false,
}

export const DISCUSS_PROCEED_STAGE_ORDER: readonly DiscussProceedStage[] = [
  "chapter_requirements",
  "synopsis_discuss",
  "outline_discuss",
  "draft_discuss",
  "body_discuss",
]

/** 梗概、细纲与草稿 are one atomic「构思」gate; only publish remains a separate stop. */
export type ProceedDisplayStage = "chapter_requirements" | "compose_discuss" | "body_discuss"

export const PROCEED_DISPLAY_STAGE_ORDER: readonly ProceedDisplayStage[] = [
  "chapter_requirements",
  "compose_discuss",
  "body_discuss",
]

export const PROCEED_DISPLAY_STAGE_GROUPS: Readonly<Record<ProceedDisplayStage, readonly DiscussProceedStage[]>> = {
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
  if (stage === "synopsis_discuss" || stage === "outline_discuss") return "compose_discuss"
  return "body_discuss"
}

export const PROCEED_MODE_OPTIONS: ReadonlyArray<{
  value: DiscussProceedMode
  label: string
  hint: string
}> = [
  { value: "precise", label: "精准推进", hint: "每步确认：构思（梗概+细纲+草稿）与正文停等" },
  { value: "single", label: "单章推进", hint: "构思（梗概+细纲+草稿）自动；新章要求与正文落入前停" },
  { value: "batch", label: "批量推进", hint: "卷内自动连跑，可用对话框 Stop 暂停" },
  { value: "custom", label: "自定义推进", hint: "三个节点各自开关自动 / 停等（构思含梗概、细纲与草稿）" },
]

export function displayGateAuto(input: Readonly<{
  stage: ProceedDisplayStage
  mode: DiscussProceedMode
  customGates?: Partial<DiscussCustomProceedGates> | null
  agentMode?: DiscussAgentMode
}>): boolean {
  return PROCEED_DISPLAY_STAGE_GROUPS[input.stage].every((stage) => resolveProceedAutonomy({
    mode: input.mode,
    stage,
    ...(input.agentMode === undefined ? {} : { agentMode: input.agentMode }),
    ...(input.customGates === undefined ? {} : { customGates: input.customGates }),
  }))
}

function isProceedMode(value: unknown): value is DiscussProceedMode {
  return typeof value === "string" && (PROCEED_MODES as readonly string[]).includes(value)
}

function mergeCustomProceedGates(
  partial?: Partial<DiscussCustomProceedGates> | null,
): DiscussCustomProceedGates {
  return {
    ...DEFAULT_CUSTOM_PROCEED_GATES,
    ...(partial ?? {}),
  }
}

function parseCustomGates(raw: unknown): DiscussCustomProceedGates | undefined {
  if (raw === null || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const next: Partial<DiscussCustomProceedGates> = {}
  for (const stage of DISCUSS_PROCEED_STAGE_ORDER) {
    if (typeof record[stage] === "boolean") next[stage] = record[stage]
  }
  return mergeCustomProceedGates(next)
}

export function loadProceedMode(): DiscussProceedMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (isProceedMode(raw)) return raw
    const legacy = window.localStorage.getItem(LEGACY_BATCH_KEY)
    if (legacy === "1" || legacy === "true") {
      persistProceedMode("batch")
      return "batch"
    }
    if (legacy === "0" || legacy === "false") {
      persistProceedMode("single")
      return "single"
    }
  } catch {
    // ignore
  }
  return "single"
}

export function persistProceedMode(mode: DiscussProceedMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function loadCustomProceedGates(): DiscussCustomProceedGates {
  try {
    const raw = window.localStorage.getItem(GATES_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CUSTOM_PROCEED_GATES }
    const parsed = parseCustomGates(JSON.parse(raw) as unknown)
    if (parsed !== undefined) return parsed
  } catch {
    // ignore
  }
  return { ...DEFAULT_CUSTOM_PROCEED_GATES }
}

export function persistCustomProceedGates(gates: DiscussCustomProceedGates): void {
  try {
    window.localStorage.setItem(GATES_STORAGE_KEY, JSON.stringify(mergeCustomProceedGates(gates)))
  } catch {
    // ignore
  }
}
