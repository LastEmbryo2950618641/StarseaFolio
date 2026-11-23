import { describe, expect, it, vi } from "vitest"

import { saveWorkspaceFile } from "../src/features/editor/prompt-save.js"

describe("saveWorkspaceFile", () => {
  it("asks for confirmation before persisting a prompt file", async () => {
    const calls: string[] = []
    const confirmPromptSave = vi.fn(() => {
      calls.push("confirm")
      return Promise.resolve(true)
    })
    const persist = vi.fn(() => {
      calls.push("persist")
      return Promise.resolve()
    })

    const result = await saveWorkspaceFile({
      path: "提示词/阶段提示/大纲.md",
      content: "# 新大纲",
      confirmPromptSave,
      persist,
    })

    expect(result).toBe("saved")
    expect(confirmPromptSave).toHaveBeenCalledWith({ path: "提示词/阶段提示/大纲.md", content: "# 新大纲" })
    expect(calls).toEqual(["confirm", "persist"])
    expect(persist).toHaveBeenCalledWith("提示词/阶段提示/大纲.md", "# 新大纲")
  })

  it("does not persist when the prompt confirmation is cancelled", async () => {
    const confirmPromptSave = vi.fn(() => Promise.resolve(false))
    const persist = vi.fn(() => Promise.resolve())

    const result = await saveWorkspaceFile({
      path: "世界推演规则/基础规则/base-rules.md",
      content: "# 改动",
      confirmPromptSave,
      persist,
    })

    expect(result).toBe("cancelled")
    expect(confirmPromptSave).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it("saves ordinary workspace files without a confirmation", async () => {
    const confirmPromptSave = vi.fn(() => Promise.resolve(true))
    const persist = vi.fn(() => Promise.resolve())

    const result = await saveWorkspaceFile({
      path: "设定集/人物/林照.md",
      content: "# 林照",
      confirmPromptSave,
      persist,
    })

    expect(result).toBe("saved")
    expect(confirmPromptSave).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith("设定集/人物/林照.md", "# 林照")
  })

  it("treats platform rule mirrors as prompt paths", async () => {
    const confirmPromptSave = vi.fn(() => Promise.resolve(true))
    const persist = vi.fn(() => Promise.resolve())

    const result = await saveWorkspaceFile({
      path: "世界推演规则/总览.md",
      content: "# 总览",
      confirmPromptSave,
      persist,
    })

    expect(result).toBe("saved")
    expect(confirmPromptSave).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith("世界推演规则/总览.md", "# 总览")
  })

  it("propagates persist failures to the caller", async () => {
    const confirmPromptSave = vi.fn(() => Promise.resolve(true))
    const persist = vi.fn(() => Promise.reject(new Error("disk full")))

    await expect(saveWorkspaceFile({
      path: "提示词/系统规则/写作基调.md",
      content: "# x",
      confirmPromptSave,
      persist,
    })).rejects.toThrow("disk full")
  })
})
