import type { DiscussAgentMode, DiscussCustomProceedGates, DiscussProceedMode } from "@starseafolio/contracts"
import { mergeCustomProceedGates, resolveDiscussProceedMode } from "@starseafolio/contracts"

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
    return [
      "【讨论模式=Plan】本轮只做规划与讨论：可 request_read / list / memory_write / 说明步骤与风险；",
      "禁止写入 synopsisBody/outlineBody/bodyEdits/stagingDelta/presentationWrites/chapterDraftProposal，",
      "禁止 invoke chapter_workflow / publish_draft / restage_chapter / bash 修改类操作；",
      "须先 todo_write 建本轮计划清单，再展开说明（Claude Code 风格）。",
    ].join("")
  }
  if (mode === "accept_edits") {
    return [
      "【讨论模式=Accept edits】用户已授权自动接受文件写入：需要落盘时直接执行，",
      "不要反复询问「是否写入」；仍须遵守工作区 bash 与正式正文/图治理专用通道；",
      "可执行任务须先 todo_write 建清单并随进度更新 status；全部项 completed/cancelled 后才能结束回合；",
      "换章用 focusChange 直接切焦点，勿用 set_focus 按钮索要确认；偏好/纠错用 memory_write。",
      acceptEditsProceedAppendix(proceedMode, options?.customProceedGates),
    ].join("")
  }
  return [
    "【讨论模式=Auto】按创作台工作流自主选择工具与写入；",
    "用户每条可执行指令须先 todo_write 建 Claude Code 风格清单，再 request_read/bash/章节工具；推进中更新 status；",
    "Todo 由你全权维护：未把全部项标为 completed/cancelled 前禁止结束回合（除非 continueTurn=true 且当前推进模式允许自动续跑）；",
    "用户说「记住…」或确认纠错/偏好时用 memory_write 更新 Agent记忆。",
    proceedModePromptAppendix(proceedMode, options?.customProceedGates),
  ].join("")
}

function acceptEditsProceedAppendix(
  mode: DiscussProceedMode,
  customGates?: DiscussCustomProceedGates,
): string {
  if (mode === "batch") {
    return [
      AUTO_CONTINUE_RULE,
      "只有真正需要用户取舍（内容方向冲突）时才停并给 choices。",
    ].join("")
  }
  if (mode === "precise") {
    return [STEP_CONFIRM_RULE, "默认按推进模式停点停等用户指令；用户明确要求连续步骤或换章时按其请求执行。"].join("")
  }
  if (mode === "single") {
    return [SINGLE_CHAPTER_RULE, "默认按推进模式停点停等用户指令；用户明确要求连续步骤或换章时按其请求执行。"].join("")
  }
  return [
    proceedModePromptAppendix(mode, customGates),
    "默认按推进模式停点停等用户指令；用户明确要求连续步骤或换章时按其请求执行。",
  ].join("")
}

function proceedModePromptAppendix(
  mode: DiscussProceedMode,
  customGates?: DiscussCustomProceedGates,
): string {
  if (mode === "batch") {
    return [AUTO_CONTINUE_RULE, AUTO_SELF_DECIDE_RULE].join("")
  }
  if (mode === "precise") {
    return [STEP_CONFIRM_RULE, PRECISE_GATES_RULE].join("")
  }
  if (mode === "single") {
    return [SINGLE_CHAPTER_RULE, SINGLE_SELF_DECIDE_RULE].join("")
  }
  const gates = mergeCustomProceedGates(customGates)
  const autoLabels = (Object.entries(gates) as Array<[keyof DiscussCustomProceedGates, boolean]>)
    .filter(([, auto]) => auto)
    .map(([stage]) => STAGE_LABEL[stage])
  const stopLabels = (Object.entries(gates) as Array<[keyof DiscussCustomProceedGates, boolean]>)
    .filter(([, auto]) => !auto)
    .map(([stage]) => STAGE_LABEL[stage])
  return [
    "【推进模式=自定义】按用户为各节点配置的自动/停等执行：",
    autoLabels.length > 0 ? `自动节点：${autoLabels.join("、")}；` : "无自动节点；",
    stopLabels.length > 0 ? `停等节点：${stopLabels.join("、")}。` : "无停等节点。",
    gates.body_discuss
      ? "正文确认节点为自动时，草稿可写入后可按宿主规则推进；仍不要自行 publish_draft。"
      : "正文确认节点为停等时，草稿写好后必须停下请用户确认「草稿可以，发布正文」。",
    Object.values(gates).every(Boolean)
      ? "全部节点均为自动：当前章完成后可 focusChange 下一章并设 continueTurn=true。"
      : "未全开自动时禁止一章写完自动开下一章；用户明确要求换章除外。",
  ].join("")
}

const STAGE_LABEL: Record<keyof DiscussCustomProceedGates, string> = {
  chapter_requirements: "新章用户要求",
  synopsis_discuss: "梗概讨论",
  outline_discuss: "细纲讨论",
  draft_discuss: "草稿讨论",
  body_discuss: "正文确认",
}

/** Auto + 批量推进：跳过征询，连章续跑。 */
const AUTO_SELF_DECIDE_RULE = [
  "【推进模式=批量 · Auto 自决】用户开启批量推进，授权你替他做确认与取舍：",
  "凡其它规则要求「先用 choices 征询用户」的（含 confirm_synopsis、换章），一律自行决定并直接执行；",
  "例外：开书冷启动的作品风格未合格时，必须给用户 2–3 个可点击风格 choices；不得自行选风格、自动续跑，或把门禁诊断当作 choices 输出。",
  "按章严格顺序推进：先完成当前章梗概，再完成细纲与人物准备，再写正文草稿并完成图修订发布；当前章未完成前，禁止写入、规划或切换到任何后续章；",
  "普通批量推进一次只处理当前焦点章，不得用 volumeChapterPlans 提前规划后章；只有用户明确要求「卷规划/整卷规划」时才允许一次规划多章；",
  "标题分叉直接输出推荐的 titleAlignTarget；当前章完成后 focusChange 下一章直至任务完成；",
  "除上述风格门槛外，在 assistantMessage 里用一两句说明取舍理由即可；不要输出需要用户点选才能继续的 choices。",
].join("")

const PRECISE_GATES_RULE = [
  "【推进模式=精准】工具与写入仍可自主，但流水线每步都停等用户：",
  "① 梗概落盘后停止并给出「用这份梗概写细纲」便捷选项；",
  "② 细纲落盘后停止并给出「按细纲写正文」便捷选项；",
  "③ 正文草稿/发布完成后默认停止，不自行换章；用户本轮明确要求切换焦点时除外。",
  "标题分叉等非流水线岔路仍可用 choices 征询。",
].join("")

const SINGLE_CHAPTER_RULE = [
  "【推进模式=单章】本章内梗概→细纲→草稿自动连跑；新章用户要求与正文落入确认前必须停等。",
  "梗概/细纲落盘后不要停等确认按钮，直接继续下一步；草稿写好后必须停下，只请用户确认「草稿可以，发布正文」。",
  "确认前不要 publish_draft，也不要进入下一章。用户明确要求换章时可 focusChange。",
  "禁止设 continueTurn 仅用于跳到下一章；本章内未完成的下一步可用 continueTurn=true。",
].join("")

const SINGLE_SELF_DECIDE_RULE = [
  "【单章 · Auto 自决】梗概确认、细纲确认可自行决定并继续；",
  "正文发布确认与新章要求不可自决；开书冷启动风格门槛仍必须给用户 choices。",
].join("")

const STEP_CONFIRM_RULE = [
  "【逐步推进】禁止设 continueTurn 来跳过用户选择；禁止一章写完自动开下一章。",
  "默认分阶段停下并给出下一步按钮；按钮是便捷操作，用户自然语言明确要求下一步或连续多步时，按前置文档实际写入顺序执行，不要求复述按钮文案。",
  "用户明确要求换章也可执行：focusChange.userRequestQuote 必须原样引用本轮换章指令；先只切焦点，目标章任务用 continueTurn=true 交给重新读取该章材料后的下一回合。仅换章时不要续跑。前章未发布、焦点锁定及章节面板批量编排限制仍生效。",
].join("")

const AUTO_CONTINUE_RULE = [
  "【推进模式=批量】多章/多步任务一轮做不完时：按当前章的梗概→细纲/人物准备→正文草稿顺序推进；本轮做不完时设 continueTurn=true，系统会自动续跑；",
  "草稿写好后必须停下，只请用户确认「草稿可以，发布正文」。确认前不要进入下一章，也不要自行 publish_draft。确认后由宿主自动完成设定抽取、图治理和正文落盘。",
  "不要用 choices 询问「是否继续/先做哪个」。任务全部完成时不要设 continueTurn。",
  "自决时互斥 choices 只选符合当前阶段的一条；草稿写好后只请用户确认「草稿可以，发布正文」，确认前不要 publish_draft，确认后由宿主自动完成设定抽取、图治理和正文落盘。只有用户要求修改或审核驳回才返工，不自行反复润色。",
  "运行参数 batchAutomation=false 仍须先让用户确认草稿；不要自行 publish_draft。",
  "只有 batchAutomation=true 才由章节面板编排发布，禁止 Agent 重复发布。不得仅凭用户说「批量」混淆两个通道。",
].join("")
