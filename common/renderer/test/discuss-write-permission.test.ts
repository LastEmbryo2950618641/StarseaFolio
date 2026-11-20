import { describe, expect, it } from "vitest"

import {
  DISCUSS_WRITE_PERMISSION_OPTIONS,
  isDiscussWritePermissionMode,
} from "../src/features/editor/discuss-write-permission.js"

describe("discuss write permission UI", () => {
  it("lists full first as the default option", () => {
    expect(DISCUSS_WRITE_PERMISSION_OPTIONS.map((item) => item.value)).toEqual([
      "full",
      "settings_write_confirm",
    ])
    expect(DISCUSS_WRITE_PERMISSION_OPTIONS[0]?.label).toBe("完全权限")
    expect(DISCUSS_WRITE_PERMISSION_OPTIONS[1]?.label).toBe("设定集写入询问")
    expect(isDiscussWritePermissionMode("full")).toBe(true)
    expect(isDiscussWritePermissionMode("settings_write_confirm")).toBe(true)
    expect(isDiscussWritePermissionMode("auto")).toBe(false)
  })
})
