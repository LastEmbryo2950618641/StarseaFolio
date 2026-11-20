import { describe, expect, it } from "vitest"

import {
  discussWritePermissionPromptAppendix,
  resolveDiscussWritePermissionMode,
  shouldAutoApproveStagingPromote,
} from "../src/application/chapters/discuss-write-permission.js"

describe("discuss write permission", () => {
  it("defaults to full permission", () => {
    expect(resolveDiscussWritePermissionMode(undefined)).toBe("full")
    expect(shouldAutoApproveStagingPromote(undefined)).toBe(true)
    expect(shouldAutoApproveStagingPromote("full")).toBe(true)
    expect(shouldAutoApproveStagingPromote("settings_write_confirm")).toBe(false)
  })

  it("prompt appendix tells the model whether to ask for 设定集 confirm", () => {
    expect(discussWritePermissionPromptAppendix("full")).toContain("完全权限")
    expect(discussWritePermissionPromptAppendix("full")).toContain("不要再给 promote_staging")
    expect(discussWritePermissionPromptAppendix("settings_write_confirm")).toContain("设定集写入询问")
    expect(discussWritePermissionPromptAppendix("settings_write_confirm")).toContain("promote_staging")
  })
})
