import type { DiscussWritePermissionMode } from "@starseafolio/contracts"

const STORAGE_KEY = "worldseed.creation-desk.discuss-write-permission"

export const DISCUSS_WRITE_PERMISSION_OPTIONS = [
  {
    value: "full",
    label: "完全权限",
    hint: "除推进模式停点外，设定集与其它写入不再二次确认（默认）",
  },
  {
    value: "settings_write_confirm",
    label: "设定集写入询问",
    hint: "设定集升格必须点「确认落盘」后才写入",
  },
] as const satisfies ReadonlyArray<Readonly<{
  value: DiscussWritePermissionMode
  label: string
  hint: string
}>>

export function isDiscussWritePermissionMode(value: string): value is DiscussWritePermissionMode {
  return value === "full" || value === "settings_write_confirm"
}

/** Default: full — Cursor/Codex-like; proceed mode still owns chapter stops. */
export function loadDiscussWritePermissionMode(): DiscussWritePermissionMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? ""
    if (isDiscussWritePermissionMode(raw)) return raw
  } catch {
    // ignore storage failures
  }
  return "full"
}

export function persistDiscussWritePermissionMode(mode: DiscussWritePermissionMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // ignore storage failures
  }
}
