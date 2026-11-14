import type { DiscussAgentMode } from "@starseafolio/contracts"

export function discussAgentModePromptAppendix(
  mode: DiscussAgentMode,
  options?: Readonly<{ batchProceed?: boolean }>,
): string {
  const batchProceed = options?.batchProceed === true
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
      batchProceed ? AUTO_CONTINUE_RULE : STEP_CONFIRM_RULE,
      batchProceed
        ? "只有真正需要用户取舍（内容方向冲突）时才停并给 choices。"
        : "批量推进已关闭：默认按阶段停等用户指令；用户明确要求连续步骤或换章时按其请求执行，不要求固定说法。",
    ].join("")
  }
  return [
    "【讨论模式=Auto】按创作台工作流自主选择工具与写入；",
    "用户每条可执行指令须先 todo_write 建 Claude Code 风格清单，再 request_read/bash/章节工具；推进中更新 status；",
    "Todo 由你全权维护：未把全部项标为 completed/cancelled 前禁止结束回合（除非 continueTurn=true 且批量推进开启）；",
    "用户说「记住…」或确认纠错/偏好时用 memory_write 更新 Agent记忆。",
    batchProceed ? AUTO_CONTINUE_RULE : STEP_CONFIRM_RULE,
    batchProceed ? AUTO_SELF_DECIDE_RULE : AUTO_WITH_STEP_GATES_RULE,
  ].join("")
}

/** Auto + 批量推进：跳过征询，连章续跑。 */
const AUTO_SELF_DECIDE_RULE = [
  "【批量推进=开 · Auto 自决】用户开启批量推进，授权你替他做确认与取舍：",
  "凡其它规则要求「先用 choices 征询用户」的（含 confirm_synopsis、换章），一律自行决定并直接执行；",
  "例外：开书冷启动的作品风格未合格时，必须给用户 2–3 个可点击风格 choices；不得自行选风格、自动续跑，或把门禁诊断当作 choices 输出。",
  "按章严格顺序推进：先完成当前章梗概，再完成细纲与人物准备，再写正文草稿并完成图修订发布；当前章未完成前，禁止写入、规划或切换到任何后续章；",
  "普通批量推进一次只处理当前焦点章，不得用 volumeChapterPlans 提前规划后章；只有用户明确要求「卷规划/整卷规划」时才允许一次规划多章；",
  "标题分叉直接输出推荐的 titleAlignTarget；当前章完成后 focusChange 下一章直至任务完成；",
  "除上述风格门槛外，在 assistantMessage 里用一两句说明取舍理由即可；不要输出需要用户点选才能继续的 choices。",
].join("")

/** Auto but 批量推进关闭：可写工具，逐步停。 */
const AUTO_WITH_STEP_GATES_RULE = [
  "【批量推进=关】工具与写入仍可自主，但流水线必须分步停等用户：",
  "① 梗概落盘后，若用户本轮没有明确要求细纲则停止并给出「用这份梗概写细纲」便捷选项；用户已用自然语言要求提取/补全细纲时直接完成，不要求固定确认说法；",
  "② 通常在细纲落盘后停止并给出「按细纲写正文」便捷选项；用户已明确要求连做细纲与正文时，细纲成功写入后可继续草稿，不要求固定确认说法；",
  "③ 正文草稿/发布完成后默认停止，不自行换章；但用户本轮明确要求切换焦点时，输出 focusChange 并在 userRequestQuote 原样摘录本轮换章指令，不要求固定说法或用户手动操作。若还要求在目标章继续工作，同回设置 continueTurn=true；本轮只切焦点，不提交旧焦点的章节写入，系统会重新读目标章后继续原请求。仅换章则不要 continueTurn。",
  "标题分叉等非流水线岔路仍可用 choices 征询。",
].join("")

const STEP_CONFIRM_RULE = [
  "【逐步推进】禁止设 continueTurn 来跳过用户选择；禁止一章写完自动开下一章。",
  "默认分阶段停下并给出下一步按钮；按钮是便捷操作，用户自然语言明确要求下一步或连续多步时，按前置文档实际写入顺序执行，不要求复述按钮文案。",
  "用户明确要求换章也可执行：focusChange.userRequestQuote 必须原样引用本轮换章指令；先只切焦点，目标章任务用 continueTurn=true 交给重新读取该章材料后的下一回合。仅换章时不要续跑。前章未发布、焦点锁定及章节面板批量编排限制仍生效。",
].join("")

const AUTO_CONTINUE_RULE = [
  "【批量推进】多章/多步任务一轮做不完时：按当前章的梗概→细纲/人物准备→正文草稿→图修订发布顺序推进；本轮做不完时设 continueTurn=true，系统会自动续跑；",
  "当前章完成后才可进入下一章，不要停下来等用户允许。",
  "不要用 choices 询问「是否继续/先做哪个」。任务全部完成时不要设 continueTurn。",
  "自决时互斥 choices 只选符合当前阶段的一条；已有合格草稿优先审核发布，只有用户要求修改或审核驳回才返工，不自行反复润色。",
  "运行参数 batchAutomation=false 表示普通讨论批量推进，应由你用 publish_draft 指定已保存版本完成审核、图治理与发布；",
  "只有 batchAutomation=true 才由章节面板编排发布，禁止 Agent 重复发布。不得仅凭用户说「批量」混淆两个通道。",
].join("")
