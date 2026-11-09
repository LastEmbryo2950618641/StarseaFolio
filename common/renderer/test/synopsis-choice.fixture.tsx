import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { SynopsisConversationChoice, SynopsisConversationMessage } from "@worldseed/contracts"

import { SynopsisConversationComposer } from "../src/features/editor/SynopsisConversationComposer.js"
import "../src/styles/global.css"

type FixtureContext = {
  projectId: string
  sessionId: string
  messageId: string
  questionId: string | undefined
  busy: boolean
  running: boolean
  emptyChoices: boolean
  focusLocked: boolean
  chapterWorkflowEnabled: boolean
}

export type ChoiceFixture = {
  sent: { message: string; options: unknown }[]
  actions: string[]
  configure(patch: Partial<FixtureContext>): void
  restore(text: string): void
}

declare global {
  interface Window { choiceFixture: ChoiceFixture }
}

window.choiceFixture = { sent: [], actions: [], configure: () => {}, restore: () => {} }

const style = {
  novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
  novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
  proseStyleRulePath: "表现输出/笔风规则/仙侠.md",
}

const choices: SynopsisConversationChoice[] = [
  { label: "方向 A", action: "continue_discuss" },
  { label: "方向 B", action: "continue_discuss" },
  { label: "确认梗概", action: "confirm_synopsis" },
  { label: "确认卷规划", action: "confirm_arc_plan" },
  { label: "开始推演", action: "start_turn" },
  { label: "确认落盘", action: "promote_staging" },
  { label: "暂不落盘", action: "continue_discuss" },
  { label: "确认用草稿经图治理覆盖正式正文", action: "promote_draft_to_body" },
  { label: "切换到第2章", action: "set_focus", chapterSequence: 2 },
  { label: "爽文 + 飞卢 + 仙侠", action: "continue_discuss", workStyleSelection: style },
]

function Fixture(): React.JSX.Element {
  const [context, setContext] = useState<FixtureContext>({
    projectId: "project-1", sessionId: "session-1", messageId: "message-2", questionId: "question-1",
    busy: false, running: false, emptyChoices: false, focusLocked: false, chapterWorkflowEnabled: true,
  })
  const [draftRestore, setDraftRestore] = useState<{ text: string; token: number }>()
  window.choiceFixture.configure = (patch) => { setContext((current) => ({ ...current, ...patch })) }
  window.choiceFixture.restore = (text) => { setDraftRestore((current) => ({ text, token: (current?.token ?? 0) + 1 })) }
  const message: SynopsisConversationMessage = {
    messageId: context.messageId, projectId: context.projectId, sessionId: context.sessionId,
    role: "assistant", content: "请选择方向；也可以直接输入完整的自定义回答。", createdAtMs: 2,
    choices: context.emptyChoices ? [] : choices.map((choice) => ({
      ...choice, ...(context.questionId === undefined ? {} : { setupQuestionId: context.questionId }),
    })),
  }
  return <SynopsisConversationComposer
    layout="rail" projectId={context.projectId} workspaceRootRef={undefined}
    session={{
      sessionId: context.sessionId, projectId: context.projectId, chapterSequence: 1, title: "测试",
      synopsisPath: "测试梗概.md", focusKind: "plot_synopsis", status: "active", createdAtMs: 1, updatedAtMs: 1,
      synopsisContentState: "empty", outlineContentState: "empty", draftContentState: "empty",
    }}
    messages={[{ ...message, messageId: "message-1", choices: context.emptyChoices ? [] : choices }, message]}
    busy={context.busy} running={context.running} focusLocked={context.focusLocked}
    chapterWorkflowEnabled={context.chapterWorkflowEnabled} draftRestore={draftRestore}
    onSend={(text, options) => { window.choiceFixture.sent.push({ message: text, options }); return Promise.resolve() }}
    onStartTurn={() => { window.choiceFixture.actions.push("start-turn") }}
    onPromoteStaging={() => { window.choiceFixture.actions.push("promote-staging"); return Promise.resolve() }}
    onRejectStagingPromote={() => { window.choiceFixture.actions.push("reject-staging"); return Promise.resolve() }}
    onPromoteDraftToBody={() => { window.choiceFixture.actions.push("promote-draft"); return Promise.resolve() }}
    onSetFocus={() => { window.choiceFixture.actions.push("focus") }}
    onRefreshChoices={() => { window.choiceFixture.actions.push("refresh"); return Promise.resolve() }}
    descriptionRule="" proseRule="" novelMajorCategoryRulePath="" novelSubcategoryRulePath=""
    minimumWordCount="2000" maximumWordCount="3000" wordCountValid
    descriptionRules={[]} proseRules={[style.proseStyleRulePath]}
    novelMajorCategoryRules={[style.novelMajorCategoryRulePath]} novelSubcategoryRules={[style.novelSubcategoryRulePath]}
    boundaryPace="advance_allowed" causalityFocus="auto"
    onDescriptionRuleChange={() => {}} onProseRuleChange={() => {}}
    onNovelMajorCategoryRuleChange={() => {}} onNovelSubcategoryRuleChange={() => {}}
    onMinimumWordCountChange={() => {}} onMaximumWordCountChange={() => {}}
    onBoundaryPaceChange={() => {}} onCausalityFocusChange={() => {}}
    modelProfiles={[]} activeModelProfileId="" onActiveModelIdChange={() => {}} onReasoningEffortChange={() => {}}
  />
}

const root = document.getElementById("root")
if (root === null) throw new Error("Choice fixture root is missing")
createRoot(root).render(<Fixture />)
