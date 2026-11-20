import type { DiscussWritePermissionMode } from "@starseafolio/contracts"

/** Default matches Cursor/Codex-like Agent: write without secondary confirm. */
export function resolveDiscussWritePermissionMode(
  mode: DiscussWritePermissionMode | undefined,
): DiscussWritePermissionMode {
  return mode ?? "full"
}

export function shouldAutoApproveStagingPromote(
  mode: DiscussWritePermissionMode | undefined,
): boolean {
  return resolveDiscussWritePermissionMode(mode) === "full"
}

/**
 * Prompt appendix overrides the hard「等待确认落盘」guide for discuss.
 * Proceed-mode stops are unchanged and still owned by proceedMode.
 */
export function discussWritePermissionPromptAppendix(
  mode: DiscussWritePermissionMode | undefined,
): string {
  const resolved = resolveDiscussWritePermissionMode(mode)
  if (resolved === "settings_write_confirm") {
    return [
      "【权限模式=设定集写入询问】设定集权威写入必须经用户确认：",
      "产出 stagingPromote（完整 settingsWrites）并在 choices 给出 promote_staging；",
      "确认前不得声称已写入设定集；宿主不会自动升格。",
      "本作品描写仍可用 presentationWrites 立即落盘。",
    ].join("")
  }
  return [
    "【权限模式=完全权限】除推进模式规定的停点外，不要为小写入二次征询：",
    "需要沉淀设定集时直接提交 stagingPromote（完整 settingsWrites）；宿主会立即升格写入，不要再给 promote_staging「确认落盘」按钮，也不要在正文里请用户点确认。",
    "本作品描写用 presentationWrites 立即落盘；暂存区用 stagingDelta。",
    "仍须遵守推进模式（新章要求/正文确认等停等）与 Plan 模式禁写；内容方向真冲突才用 choices。",
  ].join("")
}
