import type { DiscussAgentMode } from "@worldseed/contracts"

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
        : "批量推进已关闭：即便 Accept edits，梗概/细纲/正文三步仍须停下等用户确认后再进下一步。",
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
  "① 梗概落盘后停止，给出「用这份梗概写细纲」(confirm_synopsis)，禁止同轮 outlineBody/正文；",
  "② 细纲落盘后停止，给出「按细纲写正文」，禁止同轮 chapterDraftProposal；",
  "③ 正文草稿/发布完成后停止，禁止 focusChange/continueTurn 自动进下一章。",
  "标题分叉等非流水线岔路仍可用 choices 征询。",
].join("")

const STEP_CONFIRM_RULE = [
  "【逐步确认】禁止设 continueTurn 来跳过用户确认；禁止一章写完自动开下一章。",
  "每完成梗概 / 细纲 / 正文之一就结束本轮并给出明确确认按钮。",
].join("")

const AUTO_CONTINUE_RULE = [
  "【批量推进】多章/多步任务一轮做不完时：按当前章的梗概→细纲/人物准备→正文草稿→图修订发布顺序推进；本轮做不完时设 continueTurn=true，系统会自动续跑；",
  "当前章完成后才可进入下一章，不要停下来等用户允许。",
  "不要用 choices 询问「是否继续/先做哪个」。任务全部完成时不要设 continueTurn。",
].join("")
