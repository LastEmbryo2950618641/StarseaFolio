import type { AIPhase, ChapterNarrativeIntent } from "@starseafolio/contracts"

import {
  AUTO_DESCRIPTION_RULE_PATH,
  DEAI_DESCRIPTION_RULE_PATH,
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

/** Inject active creation-desk constraints into prose-writing phases. */
export function chapterPresentationPhaseAppendix(
  presentation: ChapterPresentationBudget | undefined,
  phase: AIPhase,
): string | undefined {
  if (presentation === undefined) return undefined
  const referenceWordCount = Math.round((presentation.minimumWordCount + presentation.maximumWordCount) / 2)
  const proseLengthContract = [
    `## 单章正文长度（${String(presentation.minimumWordCount)}–${String(presentation.maximumWordCount)} 字）`,
    "范围约束 AI 新写或改写的正文主体，标题不计。计数与编辑器一致，移除正文中的全部空白字符后计数，标点计入。",
    `以区间中段约 ${String(referenceWordCount)} 字为篇幅参考，按本章需要调整。动笔前为关键场面分配篇幅，写足相关的关系、反应和氛围。重要情节仍像提要时，先补写场面，再检查总字数。场景切换的速度按叙事需要安排。最终正文必须落入本轮范围，按同一口径计数并报告实数，不能用估算代替。超上限时先缩减重复描写和解释，保留用户指定情节。`,
    "用户提供并明确要求原样保存的全文保持原文；如超出范围，报告实数，不自行扩写或删改。",
  ]
  if (phase === "draft") return proseLengthContract.join("\n")
  if (phase !== "synopsis_discuss") return undefined
  const lines = [
    ...proseLengthContract,
    "",
    "结合卷目标、当前情节容量与场景需要，若当前描写/笔风/字数/节奏/因果焦点设置不合适，可在 artifact.creationDeskSettings 中给出需要调整的字段；用户仍可随时在创作台手动修改。字数调整必须同时给出最小值和最大值。",
    "描写与笔风只能选择本轮工作区实际存在的 `表现输出/描写规则/*.md`、`表现输出/笔风规则/*.md` 路径；只推荐/选择，不改写这些预设文件。",
    "规划弧大纲、估章数、判断是否超单章容量时，**必须**以此为准，不得改用自拟的「每章一两万字」之类默认。",
    "",
    "- 弧大纲中的「节奏与字数」须引用此区间；",
    "- 若情节容量明显超出该区间，应建议拆章 / 先落大纲，而不是暗中提高单章字数。",
  ]
  if (presentation.novelMajorCategoryRulePath !== undefined || presentation.novelSubcategoryRulePath !== undefined) {
    lines.push(
      "",
      "### 小说定位规则（以对应 Markdown 正文为准）",
      `- 小说大类规则：${presentation.novelMajorCategoryRulePath === undefined ? "未选择" : `\`${presentation.novelMajorCategoryRulePath}\``}`,
      `- 小说次大类规则：${presentation.novelSubcategoryRulePath === undefined ? "未选择" : `\`${presentation.novelSubcategoryRulePath}\``}`,
      "- 阅读本轮所选规则正文，理解小说定位与读者期待。结合用户要求与场景取用适合的写法。",
    )
  }
  if (isAutoDescriptionSelection(presentation.descriptionRulePath)) {
    lines.push(
      "",
      "### 描写：自动",
      `- 参考 \`${AUTO_DESCRIPTION_RULE_PATH}\`，按场面选用合适的表现手法。`,
      `- \`${SENSORY_DESCRIPTION_RULE_PATH}\` 与 \`${DEAI_DESCRIPTION_RULE_PATH}\` 提供感官和润色建议。`,
    )
  } else {
    lines.push(
      "",
      `### 描写规则路径：\`${presentation.descriptionRulePath}\``,
      `- 本轮锁定该场面卡作为描写参考，并附带 \`${SENSORY_DESCRIPTION_RULE_PATH}\` 与 \`${DEAI_DESCRIPTION_RULE_PATH}\`。结合场景选用卡内的写法。`,
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
    "- 长期创作方向写入 `表现输出/本作品描写/*.md`（`mode: create|update`），单章氛围写进梗概或细纲。风格文件会立即落盘，单文件最多 4000 字、目录最多 8 个文件。",
    "- 参考作品定位和语感，按情节选择视点、句段和描写密度。作者明确指定的写法按原要求执行。",
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
