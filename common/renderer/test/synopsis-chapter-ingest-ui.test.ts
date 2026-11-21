import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("../src/features/status/chapter-ingest-activity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/features/status/chapter-ingest-activity.js")>()
  return {
    ...actual,
    useChapterIngestActivity: () => ({
      heading: "第十九章",
      phaseLabel: "准备修订与证据",
      current: 3,
      total: 8,
    }),
  }
})

vi.mock("../src/features/editor/use-deduction-goals.js", () => ({
  useDeductionGoals: () => ({
    snapshot: { goals: [], progress: [], pendingProposals: [] },
    refresh: async () => undefined,
    addGoal: async () => undefined,
    updateGoal: async () => undefined,
    completeGoal: async () => undefined,
    removeGoal: async () => undefined,
    setProgress: async () => undefined,
    reviewProgress: async () => undefined,
    approveProposals: async () => undefined,
    rejectProposals: async () => undefined,
  }),
}))

import { SynopsisConversationComposer } from "../src/features/editor/SynopsisConversationComposer.js"

describe("synopsis chapter_ingest stream blocks", () => {
  it("shows chapter_ingest in 思考与工具 instead of muted thinking while busy", () => {
    const html = renderToStaticMarkup(React.createElement(SynopsisConversationComposer, {
      projectId: "project-test",
      workspaceRootRef: "C:\\Worldseed\\test",
      session: undefined,
      messages: [],
      busy: true,
      running: false,
      pendingStagingPromotes: [],
      onSend: async () => undefined,
      onRefreshChoices: async () => undefined,
      onPromoteStaging: async () => undefined,
      onStartTurn: () => undefined,
      modelProfiles: [{
        id: "model-1",
        name: "测试模型",
        model: "test-model",
        baseUrl: "http://localhost",
        credentialRef: "cred-1",
        apiKey: "",
        hasApiKey: true,
        reasoningEffort: "medium",
      }],
      activeModelProfileId: "model-1",
      onActiveModelIdChange: () => undefined,
      onReasoningEffortChange: () => undefined,
      descriptionRule: "",
      proseRule: "",
      novelMajorCategoryRulePath: "",
      novelSubcategoryRulePath: "",
      minimumWordCount: "2000",
      maximumWordCount: "3000",
      wordCountValid: true,
      descriptionRules: [],
      proseRules: [],
      novelMajorCategoryRules: [],
      novelSubcategoryRules: [],
      boundaryPace: "advance_allowed",
      causalityFocus: "auto",
      onDescriptionRuleChange: () => undefined,
      onProseRuleChange: () => undefined,
      onNovelMajorCategoryRuleChange: () => undefined,
      onNovelSubcategoryRuleChange: () => undefined,
      onMinimumWordCountChange: () => undefined,
      onMaximumWordCountChange: () => undefined,
      onBoundaryPaceChange: () => undefined,
      onCausalityFocusChange: () => undefined,
    }))

    expect(html).toContain("data-testid=\"agent-stream-activity\"")
    expect(html).toContain("agent-stream-activity-meta\">chapter_ingest")
    expect(html).toContain("进行中")
    expect(html).not.toContain("agent-stream-chapter-ingest")
    expect(html).not.toContain("准备修订与证据 · 3/8 · 第十九章")
    expect(html).not.toContain("深度思考中…")
  })

  it("shows compression when the discuss stream is compacting", () => {
    const html = renderToStaticMarkup(React.createElement(SynopsisConversationComposer, {
      projectId: "project-test",
      workspaceRootRef: "C:\\Worldseed\\test",
      session: undefined,
      messages: [],
      busy: true,
      stream: {
        status: "running",
        thinking: "",
        thinkingRounds: [],
        content: "",
        searching: [],
        editing: [],
        toolRuns: [],
        todos: [],
        compacting: true,
        updatedAtMs: 1,
      },
      running: false,
      pendingStagingPromotes: [],
      onSend: async () => undefined,
      onRefreshChoices: async () => undefined,
      onPromoteStaging: async () => undefined,
      onStartTurn: () => undefined,
      modelProfiles: [{
        id: "model-1",
        name: "测试模型",
        model: "test-model",
        baseUrl: "http://localhost",
        credentialRef: "cred-1",
        apiKey: "",
        hasApiKey: true,
        reasoningEffort: "medium",
      }],
      activeModelProfileId: "model-1",
      onActiveModelIdChange: () => undefined,
      onReasoningEffortChange: () => undefined,
      descriptionRule: "",
      proseRule: "",
      novelMajorCategoryRulePath: "",
      novelSubcategoryRulePath: "",
      minimumWordCount: "2000",
      maximumWordCount: "3000",
      wordCountValid: true,
      descriptionRules: [],
      proseRules: [],
      novelMajorCategoryRules: [],
      novelSubcategoryRules: [],
      boundaryPace: "advance_allowed",
      causalityFocus: "auto",
      onDescriptionRuleChange: () => undefined,
      onProseRuleChange: () => undefined,
      onNovelMajorCategoryRuleChange: () => undefined,
      onNovelSubcategoryRuleChange: () => undefined,
      onMinimumWordCountChange: () => undefined,
      onMaximumWordCountChange: () => undefined,
      onBoundaryPaceChange: () => undefined,
      onCausalityFocusChange: () => undefined,
    }))

    expect(html).toContain("data-testid=\"agent-stream-activity\"")
    expect(html).toContain("agent-stream-activity-meta\">compression · chapter_ingest")
    expect(html).not.toContain("agent-stream-compression")
    expect(html).not.toContain("上下文压缩中")
    expect(html).not.toContain("agent-stream-chapter-ingest")
  })
})
