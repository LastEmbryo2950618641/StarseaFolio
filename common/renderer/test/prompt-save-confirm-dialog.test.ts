import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  PROMPT_SAVE_CONFIRM_MESSAGE,
  PromptSaveConfirmDialog,
} from "../src/features/editor/PromptSaveConfirmDialog.js"

function renderDialog(path: string): string {
  return renderToStaticMarkup(React.createElement(PromptSaveConfirmDialog, {
    path,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }))
}

describe("PromptSaveConfirmDialog", () => {
  it("explains the global prompt-library impact and offers confirm/cancel", () => {
    const html = renderDialog("提示词/系统规则/写作基调.md")

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-testid="prompt-save-confirm-dialog"')
    expect(html).toContain(PROMPT_SAVE_CONFIRM_MESSAGE)
    expect(html).toContain("保存并生效")
    expect(html).toContain("取消")
    expect(html).toContain("提示词/系统规则/写作基调.md")
    expect(html).toContain("全局提示词库 · 系统规则")
    expect(html).toContain('data-testid="prompt-save-confirm"')
    expect(html).toContain('data-testid="prompt-save-cancel"')
  })

  it("uses the platform-rule label for mirrored rule paths", () => {
    const html = renderDialog("世界推演规则/基础规则/base-rules.md")

    expect(html).toContain("世界推演规则/基础规则/base-rules.md")
    expect(html).toContain("全局提示词库 · 平台规则")
    expect(html).toContain(PROMPT_SAVE_CONFIRM_MESSAGE)
  })

  it("falls back to the plain global-library subtitle for unknown folders", () => {
    const html = renderDialog("提示词/自定义分类/示例.md")

    expect(html).toContain("全局提示词库 · 提示词/自定义分类/示例.md")
    expect(html).not.toContain("· undefined")
  })
})
