import {
  WORK_STYLE_RULE_PATH,
  assessWorkStyleMarkdown,
  type WorkStyleAssessment,
} from "../../core/workspace/work-style-gate.js"
import type { SynopsisConversationChoice } from "@worldseed/contracts"

export type ColdStartAssistSlice = Readonly<{
  synopsisBody?: string
  outlineBody?: string
  bodyEdits?: unknown
  chapterTitle?: string
  chapterDraftProposal?: unknown
  chapterDraftProposals?: readonly unknown[] | undefined
  appendedDraft?: unknown
  volumeChapterPlans?: readonly unknown[] | undefined
  arcPlanMarkdown?: string | undefined
  continueTurn?: boolean | undefined
  focusChange?: unknown
  choices?: readonly SynopsisConversationChoice[] | undefined
  content?: string
  presentationWrites?: readonly Readonly<{
    relativePath: string
    markdown: string
    mode: "create" | "update"
  }>[] | undefined
}>

type StyleChoiceHistoryMessage = Readonly<{
  role: string
  content: string
  hidden?: boolean | undefined
  choices?: readonly SynopsisConversationChoice[] | undefined
}>

export function resolveColdStartStyleSelectionPath(
  messages: readonly StyleChoiceHistoryMessage[],
  currentUserMessage: string,
  availableProseStylePaths: readonly string[],
  availableNovelMajorCategoryRulePaths: readonly string[],
  availableNovelSubcategoryRulePaths: readonly string[],
): Readonly<{ proseStylePath: string; novelMajorCategoryRulePath: string; novelSubcategoryRulePath: string }> | undefined {
  const explicitSelection = currentUserMessage.match(
    /我选择的风格组合是：小说大类规则「([^」]+)」、小说次大类规则「([^」]+)」、笔风规则「([^」]+)」/u,
  )
  if (explicitSelection !== null) {
    const [majorInput, subcategoryInput, proseInput] = explicitSelection.slice(1).map((path) => path!.replaceAll("\\", "/").trim())
    const novelMajorCategoryRulePath = availableNovelMajorCategoryRulePaths.find((path) => path.replaceAll("\\", "/") === majorInput)
    const novelSubcategoryRulePath = availableNovelSubcategoryRulePaths.find((path) => path.replaceAll("\\", "/") === subcategoryInput)
    const proseStylePath = availableProseStylePaths.find((path) => path.replaceAll("\\", "/") === proseInput)
    return novelMajorCategoryRulePath === undefined || novelSubcategoryRulePath === undefined || proseStylePath === undefined
      ? undefined
      : { novelMajorCategoryRulePath, novelSubcategoryRulePath, proseStylePath }
  }
  const latestAssistant = [...messages].reverse().find((message) => (
    message.role === "assistant" && message.hidden !== true
  ))
  const offeredChoices = (latestAssistant?.choices ?? []).filter((choice) => (
    choice.action === "continue_discuss"
    && choice.workStyleSelection !== undefined
  ))
  const selectedChoice = offeredChoices.find((choice) => choice.label === currentUserMessage.trim())
    ?? (/^按你(?:的)?(?:推荐|判断|安排|来)|^你来定/u.test(currentUserMessage.trim()) ? offeredChoices[0] : undefined)
  if (selectedChoice !== undefined) {
    const selection = selectedChoice.workStyleSelection
    if (selection === undefined) return undefined
    const normalized = selection.proseStyleRulePath.replaceAll("\\", "/")
    const proseStylePath = availableProseStylePaths.find((path) => path.replaceAll("\\", "/") === normalized)
    const novelMajorCategoryRulePath = availableNovelMajorCategoryRulePaths.find((path) => path.replaceAll("\\", "/") === selection.novelMajorCategoryRulePath.replaceAll("\\", "/"))
    const novelSubcategoryRulePath = availableNovelSubcategoryRulePaths.find((path) => path.replaceAll("\\", "/") === selection.novelSubcategoryRulePath.replaceAll("\\", "/"))
    return proseStylePath === undefined || novelMajorCategoryRulePath === undefined || novelSubcategoryRulePath === undefined ? undefined : {
      proseStylePath,
      novelMajorCategoryRulePath,
      novelSubcategoryRulePath,
    }
  }
  return undefined
}

/**
 * Strip jump-ahead writes when 作品风格.md is incomplete.
 * Pending presentationWrites to that path are overlaid before assessment.
 */
export function applyColdStartStyleGate<T extends ColdStartAssistSlice>(input: Readonly<{
  assist: T
  diskStyleMarkdown: string | undefined
  availableProseStylePaths?: readonly string[]
  availableNovelMajorCategoryRulePaths?: readonly string[]
  availableNovelSubcategoryRulePaths?: readonly string[]
  gateReady?: boolean
  styleChoicePending?: boolean
}>): Readonly<{
  assist: T
  assessment: WorkStyleAssessment
  notices: readonly string[]
  blocked: boolean
}> {
  const overlay = overlayStyleFromWrites(input.diskStyleMarkdown, input.assist.presentationWrites)
  const assessment = assessWorkStyleMarkdown(overlay)
  const changesStyleDocument = input.assist.presentationWrites?.some((write) => (
    write.relativePath.replaceAll("\\", "/").replace(/^\.\//u, "") === WORK_STYLE_RULE_PATH
  )) === true
  const blocked = !assessment.complete || input.gateReady !== true || changesStyleDocument
  if (!blocked) {
    return { assist: input.assist, assessment, notices: [], blocked: false }
  }

  const styleWrites = input.styleChoicePending === true
    ? undefined
    : input.assist.presentationWrites?.filter((write) => (
        write.relativePath.replaceAll("\\", "/").replace(/^\.\//u, "") === WORK_STYLE_RULE_PATH
      ))

  const {
    chapterDraftProposal: _d1,
    chapterDraftProposals: _d2,
    appendedDraft: _d3,
    volumeChapterPlans: _d4,
    arcPlanMarkdown: _d5,
    continueTurn: _d6,
    focusChange: _d7,
    synopsisBody: _d8,
    outlineBody: _d9,
    bodyEdits: _d10,
    chapterTitle: _d11,
    presentationWrites: _d12,
    ...rest
  } = input.assist

  const normalizedAvailablePaths = (input.availableProseStylePaths ?? [])
    .map((path) => path.replaceAll("\\", "/").replace(/^\.\//u, ""))
  const availableMajorRulePaths = new Set(input.availableNovelMajorCategoryRulePaths ?? [])
  const availableSubcategoryRulePaths = new Set(input.availableNovelSubcategoryRulePaths ?? [])
  const choices = (input.assist.choices ?? []).filter((choice) => {
    if (choice.action !== "continue_discuss") return false
    if (input.styleChoicePending !== true) return true
    const selection = choice.workStyleSelection
    return selection !== undefined
      && normalizedAvailablePaths.includes(selection.proseStyleRulePath.replaceAll("\\", "/"))
      && availableMajorRulePaths.has(selection.novelMajorCategoryRulePath)
      && availableSubcategoryRulePaths.has(selection.novelSubcategoryRulePath)
  })
  const completeStyleChoices = choices.length > 0 || input.styleChoicePending !== true
    ? choices
    : buildFallbackStyleChoices(
        normalizedAvailablePaths,
        [...availableMajorRulePaths],
        [...availableSubcategoryRulePaths],
      )

  return {
    assist: {
      ...rest,
      ...(styleWrites === undefined || styleWrites.length === 0 ? {} : { presentationWrites: styleWrites }),
      choices: completeStyleChoices,
      ...(typeof rest.content === "string" && rest.content.length > 0
        ? {}
        : { content: "AI尚未给出有效的风格评估，请重试本轮讨论。" }),
    } as unknown as T,
    assessment,
    notices: [],
    blocked: true,
  }
}

function overlayStyleFromWrites(
  disk: string | undefined,
  writes: ColdStartAssistSlice["presentationWrites"],
): string | undefined {
  if (writes === undefined || writes.length === 0) return disk
  for (let index = writes.length - 1; index >= 0; index -= 1) {
    const write = writes[index]
    if (write === undefined) continue
    const path = write.relativePath.replaceAll("\\", "/").replace(/^\.\//u, "")
    if (path === WORK_STYLE_RULE_PATH) return write.markdown
  }
  return disk
}

function buildFallbackStyleChoices(
  prosePaths: readonly string[],
  majorPaths: readonly string[],
  subcategoryPaths: readonly string[],
): SynopsisConversationChoice[] {
  if (prosePaths.length === 0 || majorPaths.length === 0 || subcategoryPaths.length === 0) return []
  return Array.from({ length: 3 }, (_, index) => {
    const prosePath = prosePaths[index % prosePaths.length]!
    const majorPath = majorPaths[index % majorPaths.length]!
    const subcategoryPath = subcategoryPaths[index % subcategoryPaths.length]!
    return {
      label: `${fileLabel(majorPath)} + ${fileLabel(subcategoryPath)}｜${prosePath}（组合推荐）`,
      action: "continue_discuss",
      workStyleSelection: {
        proseStyleRulePath: prosePath,
        novelMajorCategoryRulePath: majorPath,
        novelSubcategoryRulePath: subcategoryPath,
      },
    }
  })
}

function fileLabel(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path
}
