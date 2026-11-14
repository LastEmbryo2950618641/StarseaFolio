import { describe, expect, it } from "vitest"
import { synopsisDiscussArtifactSchema } from "@starseafolio/prompt-contracts"

import { filterDiscussChoices } from "../src/application/chapters/synopsis-conversation-service.js"
import { discussAgentModePromptAppendix } from "../src/application/chapters/discuss-agent-mode.js"

describe("discuss focusChange", () => {
  it("accepts focusChange on discuss artifacts", () => {
    const parsed = synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "第二章已完结，焦点切到第三章继续。",
      finalSelfReview: "已交付 focusChange，无需用户点确认。",
      focusChange: { chapterSequence: 3, focusKind: "plot_synopsis" },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.focusChange).toEqual({
      chapterSequence: 3,
      focusKind: "plot_synopsis",
    })
  })

  it("strips matching set_focus choices after focusChange applies", () => {
    const choices = filterDiscussChoices([
      { label: "是否将焦点调整到第3章", action: "set_focus", chapterSequence: 3 },
      { label: "整卷批量推", action: "continue_discuss" },
      { label: "是否将焦点调整到第4章", action: "set_focus", chapterSequence: 4 },
    ], { focusLocked: false, appliedFocusSequence: 3 })
    expect(choices).toEqual([
      { label: "整卷批量推", action: "continue_discuss" },
      { label: "是否将焦点调整到第4章", action: "set_focus", chapterSequence: 4 },
    ])
  })

  it("removes draft bypass choices when the synopsis has no content", () => {
    expect(filterDiscussChoices([
      { label: "跳过细纲，按梗概开推", action: "start_turn" },
      { label: "用这份梗概写细纲", action: "confirm_synopsis" },
      { label: "再修改梗概", action: "continue_discuss" },
    ], {
      focusLocked: false,
      synopsisReady: false,
      synopsisConfirmed: false,
      outlineReady: false,
    })).toEqual([
      { label: "再修改梗概", action: "continue_discuss" },
    ])
  })

  it("offers the synopsis confirmation first without requiring it to advance", () => {
    const directions = [
      { label: "先核对信使与主角现有人设是否冲突，再决定是否补设定", action: "continue_discuss" as const },
      { label: "保持事件不变，把对白和叙述改得更直白自然", action: "continue_discuss" as const },
    ]
    expect(filterDiscussChoices(directions, {
      focusLocked: false, synopsisReady: true, synopsisConfirmed: false,
      offerSynopsisConfirmation: true,
    })).toEqual([
      { label: "用这份梗概写细纲", action: "confirm_synopsis" },
      ...directions,
    ])
  })

  it("pins a single confirmation without replacing or limiting AI directions", () => {
    const directions = Array.from({ length: 4 }, (_, index) => ({
      label: `贴合当前用户要求的方案${String(index + 1)}`, action: "continue_discuss" as const,
    }))
    expect(filterDiscussChoices([
      directions[0]!,
      { label: "确认当前梗概", action: "confirm_synopsis" },
      ...directions.slice(1),
      { label: "开始写细纲", action: "confirm_synopsis" },
    ], {
      focusLocked: false, synopsisReady: true, synopsisConfirmed: false,
      offerSynopsisConfirmation: true,
    })).toEqual([
      { label: "用这份梗概写细纲", action: "confirm_synopsis" },
      ...directions,
    ])
  })

  it("offers confirmation even when the model omitted choices", () => {
    expect(filterDiscussChoices(undefined, {
      focusLocked: false, synopsisReady: true, synopsisConfirmed: false,
      offerSynopsisConfirmation: true,
    })).toEqual([{ label: "用这份梗概写细纲", action: "confirm_synopsis" }])
  })

  it.each([
    { synopsisReady: false, synopsisConfirmed: false, offerSynopsisConfirmation: true },
    { synopsisReady: true, synopsisConfirmed: true, offerSynopsisConfirmation: true },
    { synopsisReady: true, synopsisConfirmed: false, offerSynopsisConfirmation: false },
  ])("does not force confirmation for other workflow states: %o", (state) => {
    expect(filterDiscussChoices(undefined, { focusLocked: false, ...state })).toBeUndefined()
  })

  it("allows the next workflow action when its prerequisite documents exist", () => {
    expect(filterDiscussChoices([
      { label: "开始推演", action: "start_turn" },
    ], {
      focusLocked: false,
      synopsisReady: true,
      synopsisConfirmed: false,
      outlineReady: true,
    })).toEqual([{ label: "开始推演", action: "start_turn" }])
  })

  it("prompts Auto/Accept to use focusChange instead of confirmation buttons", () => {
    expect(discussAgentModePromptAppendix("auto", { batchProceed: true })).toContain("focusChange")
    expect(discussAgentModePromptAppendix("accept_edits", { batchProceed: true })).toContain("换章用 focusChange")
  })
})
