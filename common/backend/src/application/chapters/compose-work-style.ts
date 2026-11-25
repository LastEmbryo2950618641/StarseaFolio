import { synopsisDiscussArtifactSchema, type SynopsisDiscussArtifact } from "@starseafolio/prompt-contracts"

import { WORK_STYLE_REQUIRED_HEADINGS, WORK_STYLE_RULE_PATH } from "../../core/workspace/work-style-gate.js"
import { ComposeProtocolError } from "./compose-artifact.js"

export type ComposeWorkStyleGate = Readonly<{
  status: "awaiting_choice" | "style_selected"
  selectedProseStylePath?: string | undefined
  novelMajorCategoryRulePath?: string | undefined
  novelSubcategoryRulePath?: string | undefined
}>

export type ComposeWorkStyleOptions = ComposeWorkStyleGate & Readonly<{
  availableProseStylePaths: readonly string[]
  availableNovelMajorCategoryRulePaths: readonly string[]
  availableNovelSubcategoryRulePaths: readonly string[]
  hasExistingWorkStyle: boolean
}>

export type ComposeWorkStyleArtifact = Pick<SynopsisDiscussArtifact,
  "assistantMessage" | "finalSelfReview" | "choices" | "presentationWrites">

type Choice = NonNullable<ComposeWorkStyleArtifact["choices"]>[number]

const choicesTag = "compose-work-style-choices"
const markdownTag = "compose-work-style"
const choiceKeys = ["label", "novelMajorCategoryRulePath", "novelSubcategoryRulePath", "proseStyleRulePath"] as const

export function buildComposeWorkStylePrompt(gate: ComposeWorkStyleGate): string {
  const choicesFormat = [
    "比较候选规则正文与用户构思，按适配度推荐 2–3 个不同组合。候选不足时只给真实可用的组合，没有组合时保留空块。",
    "标签各占一行，每组以下四行，组间空一行。label 写明三个规则文件名、适配点和需规避的风险。三个路径逐项照抄本轮真实候选路径，不加引号或反引号。",
    `<${choicesTag}>`,
    `${choiceKeys[0]}: 推荐选项的显示文字`,
    `${choiceKeys[1]}: 小说大类规则的完整路径`,
    `${choiceKeys[2]}: 小说次大类规则的完整路径`,
    `${choiceKeys[3]}: 笔风规则的完整路径`,
    `</${choicesTag}>`,
  ]
  const phase = gate.status === "awaiting_choice"
    ? [
        "【作品风格门禁：尚未选择文风】",
        "先告诉用户尚未选择文风，需先选定小说大类、次大类和笔风，再继续创作。简述比较依据和推荐顺序，随后只输出推荐块。",
        ...choicesFormat,
      ]
    : [
        "【作品风格门禁：审核已选规则】",
        `小说大类规则：${gate.novelMajorCategoryRulePath ?? "（缺失）"}`,
        `小说次大类规则：${gate.novelSubcategoryRulePath ?? "（缺失）"}`,
        `小说笔风：${gate.selectedProseStylePath ?? "（缺失）"}`,
        `如适配，简述审核结果，随后只输出一个作品风格块。块内是「${WORK_STYLE_RULE_PATH}」的完整 Markdown，以 # 作品风格 起首，逐节填写八个小节。首节用「小说大类规则：」「小说次大类规则：」「小说笔风：」保留所选三条完整路径。`,
        "命名节给出正例和反例或禁止取法，角色声口节给出示例台词，人称指称节写明人称和视角，句子与对话节写明句长、口语程度和对白组织。每节都须有具体内容，不得留待定。",
        `<${markdownTag}>`,
        "# 作品风格",
        ...WORK_STYLE_REQUIRED_HEADINGS,
        `</${markdownTag}>`,
        "如不适配，说明冲突并请用户改选，只输出推荐块。必须在作品风格块和推荐块中二选一。",
        ...choicesFormat,
      ]
  return [
    ...phase,
    "根据本轮 readEvidence 中候选规则正文判断适配度，不能只看规则文件名或题材关键词。",
    "本轮用纯文本回复。用户可见说明在前，唯一的标签块在最后。不要包在代码围栏中，不要输出 JSON、调用工具或 Todo，也不要生成梗概、大纲、草稿或正文。由系统处理写入，请勿声称文件已写入。",
  ].join("\n")
}

/** Translate the scoped text response. The existing gate still decides whether a style document is complete and can be applied. */
export function composeWorkStyleArtifactFromText(text: string, options: ComposeWorkStyleOptions): ComposeWorkStyleArtifact {
  const normalized = text.replaceAll("\r\n", "\n")
  const choiceBlocks = [...normalized.matchAll(/<compose-work-style-choices>([\s\S]*?)<\/compose-work-style-choices>/gu)]
  const markdownBlocks = [...normalized.matchAll(/<compose-work-style>([\s\S]*?)<\/compose-work-style>/gu)]
  if (choiceBlocks.length > 0 && markdownBlocks.length > 0) {
    fail("作品风格块与风格推荐块不能同时出现。")
  }
  if (choiceBlocks.length > 0) {
    const prose = stripChoiceBlocks(normalized)
    if (prose.split("\n").some((line) => /^\s*(?:`{3,}|~{3,})/u.test(line))) fail("回复不要使用代码围栏。")
    // Models often emit each recommendation group as its own block; merge in order.
    const bodies = choiceBlocks.map((match) => match[1]!.trim()).filter((body) => body.length > 0)
    if (bodies.length === 0) fail("风格推荐块为空。")
    const artifact: ComposeWorkStyleArtifact = {
      assistantMessage: prose || "请先选择适合本书的小说大类、次大类与笔风组合。",
      finalSelfReview: "已解析作品风格推荐。",
      choices: parseChoices(bodies.join("\n\n"), options),
    }
    return validateArtifact(artifact)
  }
  if (markdownBlocks.length === 1 && options.status === "style_selected") {
    const prose = normalized.replace(/<compose-work-style>[\s\S]*?<\/compose-work-style>/gu, "").trim()
    if (prose.split("\n").some((line) => /^\s*(?:`{3,}|~{3,})/u.test(line))) fail("回复不要使用代码围栏。")
    const body = stripCodeFence(markdownBlocks[0]![1]!.trim())
    if (body.length === 0) fail("作品风格块为空。")
    return validateArtifact({
      assistantMessage: prose || "已整理作品风格方案。",
      finalSelfReview: "已解析作品风格方案。",
      presentationWrites: [{
        relativePath: WORK_STYLE_RULE_PATH,
        markdown: body,
        mode: options.hasExistingWorkStyle ? "update" : "create",
      }],
    })
  }
  fail("缺少当前阶段允许的完整输出块，或块外存在额外标签或内容。")
}

function stripChoiceBlocks(text: string): string {
  return text.replace(/<compose-work-style-choices>[\s\S]*?<\/compose-work-style-choices>/gu, "").trim()
}

function stripCodeFence(text: string): string {
  const lines = text.split("\n")
  const first = lines.findIndex((line) => line.trim().length > 0)
  const last = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim().length > 0)
  if (first < 0 || last <= first) return text
  if (!/^```[a-zA-Z]*\s*$/u.test(lines[first]!.trim()) || lines[last]!.trim() !== "```") return text
  return lines.slice(first + 1, last).join("\n").trim()
}

function validateArtifact(artifact: ComposeWorkStyleArtifact): ComposeWorkStyleArtifact {
  const validated = synopsisDiscussArtifactSchema.safeParse(artifact)
  if (!validated.success) {
    fail(validated.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；"))
  }
  return artifact
}

function parseChoices(text: string, options: ComposeWorkStyleOptions): Choice[] {
  const majorPaths = new Set(options.availableNovelMajorCategoryRulePaths.map(normalizePath))
  const subcategoryPaths = new Set(options.availableNovelSubcategoryRulePaths.map(normalizePath))
  const prosePaths = new Set(options.availableProseStylePaths.map(normalizePath))
  const minimum = Math.min(2, majorPaths.size, subcategoryPaths.size, prosePaths.size)
  const groups = text ? text.split(/\n[\t ]*\n\s*/u) : []
  if (groups.length < minimum || groups.length > 3) fail("风格推荐数量与可用候选不符。")

  const labels = new Set<string>()
  const combinations = new Set<string>()
  return groups.map((group) => {
    const lines = group.split("\n")
    const [label, majorPath, subcategoryPath, prosePath] = choiceKeys.map((key, index) => {
      const line = lines[index]?.trim()
      const prefix = `${key}:`
      return line?.startsWith(prefix) ? line.slice(prefix.length).trim() : undefined
    })
    if (lines.length !== choiceKeys.length || !label || !majorPath || !subcategoryPath || !prosePath) {
      fail("每个推荐必须依次填写 label 和三条非空规则路径。")
    }
    const novelMajorCategoryRulePath = normalizePath(majorPath)
    const novelSubcategoryRulePath = normalizePath(subcategoryPath)
    const proseStyleRulePath = normalizePath(prosePath)
    if (!majorPaths.has(novelMajorCategoryRulePath) || !subcategoryPaths.has(novelSubcategoryRulePath) || !prosePaths.has(proseStyleRulePath)) {
      fail("风格推荐须使用对应类别的真实候选规则路径。")
    }
    const combination = JSON.stringify([novelMajorCategoryRulePath, novelSubcategoryRulePath, proseStyleRulePath])
    if (labels.has(label) || combinations.has(combination)) fail("推荐标签和路径组合不能重复。")
    labels.add(label)
    combinations.add(combination)
    return {
      label,
      action: "continue_discuss",
      workStyleSelection: { novelMajorCategoryRulePath, novelSubcategoryRulePath, proseStyleRulePath },
    }
  })
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/")
}

function fail(message: string): never {
  throw new ComposeProtocolError(`作品风格协议错误：${message}`)
}
