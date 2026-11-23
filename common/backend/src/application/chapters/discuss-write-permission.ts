import type { DiscussWritePermissionMode } from "@starseafolio/contracts"

import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

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
    return renderRuntimePrompt("discuss-agent-policy", "settings-write-confirm")
  }
  return renderRuntimePrompt("discuss-agent-policy", "full-write-permission")
}
