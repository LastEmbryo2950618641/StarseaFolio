import type { AIPhase, ChapterNarrativeIntent } from "@worldseed/contracts"

import {
  AUTO_DESCRIPTION_RULE_PATH,
  DEAI_DESCRIPTION_RULE_PATH,
  DESCRIPTION_RULES_DIR,
  isAutoDescriptionSelection,
  SENSORY_DESCRIPTION_RULE_PATH,
} from "../../core/workspace/work-description-rules.js"

export const DEFAULT_CHAPTER_NARRATIVE_INTENT: ChapterNarrativeIntent = {
  boundaryPace: "advance_allowed",
  causalityFocus: "auto",
}

export function resolveChapterNarrativeIntent(
  intent: ChapterNarrativeIntent | undefined,
): ChapterNarrativeIntent {
  return intent ?? DEFAULT_CHAPTER_NARRATIVE_INTENT
}

/** Phase appendix for synopsis_discuss / draft — narrative pace, not world-divergence. */
export function chapterNarrativeIntentPhaseAppendix(
  intent: ChapterNarrativeIntent | undefined,
  phase: AIPhase,
): string | undefined {
  if (phase !== "synopsis_discuss" && phase !== "draft") return undefined
  const resolved = resolveChapterNarrativeIntent(intent)
  const boundary = boundaryPaceSection(resolved.boundaryPace)
  const causality = causalityFocusSection(resolved.causalityFocus, resolved.boundaryPace)
  return [
    "## 章节叙事意图（本轮强制）",
    "说明：本附录管**情节节奏与因果描写重心**，不管设定能否新造（设定发散见项目「推演发散程度」）。",
    "两条选项的共同默认：正文/梗概须大体待在已定梗概与设定边界内。",
    "",
    boundary,
    "",
    causality,
  ].join("\n")
}

export type ChapterPresentationBudget = Readonly<{
  descriptionRulePath?: string | undefined
  proseStyleRulePath?: string | undefined
  novelMajorCategoryRulePath?: string | undefined
  novelSubcategoryRulePath?: string | undefined
  minimumWordCount: number
  maximumWordCount: number
}>

/** Inject creation-desk presentation controls into synopsis discuss (word budget, style paths). */
export function chapterPresentationPhaseAppendix(
  presentation: ChapterPresentationBudget | undefined,
  phase: AIPhase,
): string | undefined {
  if (phase !== "synopsis_discuss" || presentation === undefined) return undefined
  const lines = [
    "## 创作台正文预算（本轮强制）",
    "说明：下列字数是创作台当前的**单章正文主体字数范围**（标题不计入），是可调整的工作参数，不是固定门禁。",
    "结合卷目标、当前情节容量与场景需要，若当前描写/笔风/字数/节奏/因果焦点设置不合适，可在 artifact.creationDeskSettings 中给出需要调整的字段；用户仍可随时在创作台手动修改。字数调整必须同时给出最小值和最大值。",
    "描写与笔风只能选择本轮工作区实际存在的 `表现输出/描写规则/*.md`、`表现输出/笔风规则/*.md` 路径；只推荐/选择，不改写这些预设文件。",
    "规划弧大纲、估章数、判断是否超单章容量时，**必须**以此为准，不得改用自拟的「每章一两万字」之类默认。",
    "",
    `### 单章字数：${String(presentation.minimumWordCount)}–${String(presentation.maximumWordCount)} 字`,
    "- 弧大纲中的「节奏与字数」须引用此区间；",
    "- 若情节容量明显超出该区间，应建议拆章 / 先落大纲，而不是暗中提高单章字数。",
  ]
  if (presentation.novelMajorCategoryRulePath !== undefined || presentation.novelSubcategoryRulePath !== undefined) {
    lines.push(
      "",
      "### 小说定位规则（以对应 Markdown 正文为准）",
      `- 小说大类规则：${presentation.novelMajorCategoryRulePath === undefined ? "未选择" : `\`${presentation.novelMajorCategoryRulePath}\``}`,
      `- 小说次大类规则：${presentation.novelSubcategoryRulePath === undefined ? "未选择" : `\`${presentation.novelSubcategoryRulePath}\``}`,
      "- 必须遵守本轮注入的所选规则文件正文；不要依据文件名自行臆测规则，也不要套用未选择平台的规则。",
    )
  }
  if (isAutoDescriptionSelection(presentation.descriptionRulePath)) {
    lines.push(
      "",
      "### 描写：自动",
      `- 已注入 \`${DESCRIPTION_RULES_DIR}/\` 下全部 Markdown；以 \`${AUTO_DESCRIPTION_RULE_PATH}\` 调度，同一章可按场面切换其他场面卡；`,
      `- \`${SENSORY_DESCRIPTION_RULE_PATH}\` 与 \`${DEAI_DESCRIPTION_RULE_PATH}\` 为**始终生效**基线（感官时机 / 去AI味），不是可切换场面卡；`,
      "- 用户若下拉锁定某一描写文件，则注入该文件 + 上述基线，整章遵守该场面卡，不得再切换其他场面卡。",
    )
  } else {
    lines.push(
      "",
      `### 描写规则路径：\`${presentation.descriptionRulePath}\``,
      `- 本轮锁定该场面卡，并始终附带 \`${SENSORY_DESCRIPTION_RULE_PATH}\` 与 \`${DEAI_DESCRIPTION_RULE_PATH}\`；不得改用同目录其他场面卡。`,
    )
  }
  if (presentation.proseStyleRulePath !== undefined && presentation.proseStyleRulePath.length > 0) {
    lines.push("", `### 笔风规则路径：\`${presentation.proseStyleRulePath}\``)
  }
  lines.push(
    "",
    "### 表现规则协作",
    "- 可用 `request_read` + `sourceKinds: [\"rule\"]` 读取 `表现输出/描写规则/`、`表现输出/笔风规则/` 与 `表现输出/本作品描写/`（可先 `list` 再全文/片段）；",
    "- 下拉选中的描写/笔风是可编辑预设；需要 AI 调整时用 `creationDeskSettings` 返回真实路径，**禁止**用 `presentationWrites` 改写预设文件；",
    "- 只把整部作品持续生效的呈现约束写入 `表现输出/本作品描写/*.md`（`mode: create|update`）；系统立即落盘；单文件不超过 4000 字、最多 8 个文件；",
    "- 单章氛围写梗概/细纲；与选中描写/笔风冲突时以下拉文件为准；不要放进 `stagingPromote`。",
  )
  return lines.join("\n")
}

function boundaryPaceSection(pace: ChapterNarrativeIntent["boundaryPace"]): string {
  if (pace === "hold_without_resolution") {
    return [
      "### 边界节奏：压而不决",
      "- 允许加压、揭示、逼近抉择，以及**过程性选择**；",
      "- **禁止**落地不可逆闭合结果：胜负定局、关系定死、终极目标完成、生死决断等章末定局；",
      "- **错误理解**：把本模式当成「角色不能做任何决定」——不允许；角色可以做过程性选择，只是不收束到不可逆结局。",
    ].join("\n")
  }
  return [
    "### 边界节奏：可推进（仍贴梗概）",
    "- 可设计章内合理行动与阶段性结果；",
    "- 不得无故违背已定梗概与设定边界；",
    "- 允许局部后果，但仍须贴梗概。",
  ].join("\n")
}

function causalityFocusSection(
  focus: ChapterNarrativeIntent["causalityFocus"],
  pace: ChapterNarrativeIntent["boundaryPace"],
): string {
  const holdNote = pace === "hold_without_resolution"
    ? "- 当前为「压而不决」：即使偏落点，也只允许可逆/局部落点，禁止不可逆定局。"
    : undefined
  if (focus === "buildup") {
    return [
      "### 因果焦点：蓄势",
      "- 偏前因、压力、信息铺垫；少写最终收束。",
      ...(holdNote === undefined ? [] : [holdNote]),
    ].join("\n")
  }
  if (focus === "action") {
    return [
      "### 因果焦点：行动",
      "- 偏过程、对抗、旅途、交锋。",
      ...(holdNote === undefined ? [] : [holdNote]),
    ].join("\n")
  }
  if (focus === "payoff") {
    return [
      "### 因果焦点：落点",
      "- 偏后果与阶段性收束。",
      ...(holdNote === undefined ? [] : [holdNote]),
    ].join("\n")
  }
  return [
    "### 因果焦点：自动",
    "- 按梗概与上下文自行分配前因/行动/后果比重；",
    "- 若某一阶段明显过重，可在讨论中建议拆到后续章（正式推演仍一章一轮）。",
    ...(holdNote === undefined ? [] : [holdNote]),
  ].join("\n")
}
