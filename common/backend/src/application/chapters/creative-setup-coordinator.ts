import type { ProjectId, SynopsisConversationChoice, SynopsisConversationMessage } from "@starseafolio/contracts"
import type { WorkspacePort } from "../workspace/index.js"
import { digest } from "../../core/identity/digest.js"
import type { SqliteCreativeSetupRepository } from "../../infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import {
  initialCreativeSetupState, openCreativeSetupQuestion, answerCreativeSetupQuestion,
  markCreativeSetupWritten, serializeProtagonistCreativeSetupMarkdown, invalidateCreativeSetupWritten,
  protagonistCreativeSetupMarkdownHasContent,
  type CreativeSetupState, type CreativeSetupScope,
} from "./creative-setup-state.js"
import { parseVolumePlanningState, serializeVolumePlanningState, type VolumePlanningState } from "./volume-planning-gate.js"

export const PROTAGONIST_SETTINGS_PATH = "设定集/人物/主角.md"

const activeCreativeSetupAdvances = new Set<string>()

type InterviewReply = Readonly<{
  content: string
  choices?: readonly SynopsisConversationChoice[] | undefined
  protagonistSupplementMarkdown?: string
}>

/** Only explicit, nonce-bound user responses advance these gates. AI output has no transition authority. */
export class CreativeSetupCoordinator {
  constructor(private readonly dependencies: Readonly<{
    repository: Pick<SqliteCreativeSetupRepository, "find" | "save">
    workspace: Pick<WorkspacePort, "readMarkdown" | "saveUserMarkdown">
    now: () => number
    createId: () => string
    recordSettings: (path: string, markdown: string) => Promise<void>
  }>) {}

  async advance(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    volumeFolderName: string
    chapterSequence: number
    message: string
    setupAnswerTo?: string
    priorMessages: readonly SynopsisConversationMessage[]
    regenerate?: boolean
    generate: (state: CreativeSetupState) => Promise<InterviewReply>
  }>): Promise<Readonly<{
    content: string
    choices: readonly SynopsisConversationChoice[]
    questionId: string
    scope: string
    field: string
    cached: boolean
  }> | undefined> {
    const key = JSON.stringify([input.workspaceRootRef, input.projectId])
    if (activeCreativeSetupAdvances.has(key)) {
      throw new Error("主角/卷设定正在处理中，请等待当前请求结束后重试")
    }
    activeCreativeSetupAdvances.add(key)
    try {
      return await this.advanceUnlocked(input)
    } finally {
      activeCreativeSetupAdvances.delete(key)
    }
  }

  private async advanceUnlocked(input: Parameters<CreativeSetupCoordinator["advance"]>[0]) {
    let answerConsumed = false
    const notices: string[] = []
    for (const scope of ["protagonist", `volume:${input.volumeFolderName}`] as CreativeSetupScope[]) {
      let state = await this.dependencies.repository.find(input.projectId, scope)
        ?? initialCreativeSetupState(scope, this.dependencies.now())
      const replayField = input.setupAnswerTo === undefined ? undefined : state.answeredQuestions?.[input.setupAnswerTo]
      if (!answerConsumed && replayField !== undefined) {
        if (state.answers[replayField] !== input.message.trim()) {
          throw new Error("该问题已确认或已过期；旧问题的不同回答不能用于推进当前状态")
        }
        // A failed model/write may follow a successful answer transaction. Resume, never apply it twice.
        answerConsumed = true
      }
      if (state.status === "ready") {
        const saved = state.settingsPath === undefined ? "" : await this.dependencies.workspace
          .readMarkdown(input.workspaceRootRef, state.settingsPath).catch(() => "")
        const documentedPlan = scope === "protagonist" ? undefined : parseVolumePlanningState(saved)
        const documented = scope === "protagonist" ? protagonistCreativeSetupMarkdownHasContent(saved)
          : documentedPlan?.volumeFolderName === scope.slice(7) && documentedPlan.storyline !== undefined
            && documentedPlan.storylineConfirmedAtMs !== undefined
        if (documented) continue
        state = invalidateCreativeSetupWritten(state, this.dependencies.now())
        await this.dependencies.repository.save(input.projectId, state)
      }
      if (input.setupAnswerTo !== undefined && !answerConsumed) {
        if (state.status !== "collecting" || state.pendingQuestion?.id !== input.setupAnswerTo) {
          throw new Error("该问题已过期或与当前问题不匹配，请回答最新的问题")
        }
        state = answerCreativeSetupQuestion(state, {
          questionId: input.setupAnswerTo, answer: input.message, now: this.dependencies.now(),
        })
        await this.dependencies.repository.save(input.projectId, state)
        answerConsumed = true
      }
      if (state.status === "awaiting_write") {
        if (scope === "protagonist") {
          const reply = await input.generate(state)
          const path = PROTAGONIST_SETTINGS_PATH
          const previous = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, path).catch(() => "")
          const complete = serializeProtagonistCreativeSetupMarkdown(state, {
            existingMarkdown: previous || "# 主角设定\n",
            ...(reply.protagonistSupplementMarkdown === undefined ? {} : { aiAdditions: reply.protagonistSupplementMarkdown }),
          })
          await this.dependencies.workspace.saveUserMarkdown(input.workspaceRootRef, path, complete)
          const saved = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, path)
          if (digest(saved) !== digest(complete)) throw new Error("主角设定写入核对失败，门禁未推进")
          await this.dependencies.recordSettings(path, saved)
          const readmePath = "设定集/readme.md"
          const readme = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, readmePath).catch(() => "# 设定集索引\n")
          if (!readme.includes(path)) {
            await this.dependencies.workspace.saveUserMarkdown(input.workspaceRootRef, readmePath,
              `${readme.trimEnd()}\n- [主角设定](人物/主角.md) · ${path}\n`)
          }
          state = markCreativeSetupWritten(state, { path, digest: digest(saved), now: this.dependencies.now() })
          notices.push("主角罗盘已确认并写入设定集，接下来确认本卷主线与支线。")
        } else {
          const path = `大纲/${input.volumeFolderName}.批量计划.md`
          const previous = parseVolumePlanningState(await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, path).catch(() => ""))
          const storyline = { opening: state.answers.opening ?? "", climaxes: state.answers.climaxes ?? "",
            ending: state.answers.ending ?? "", subplots: state.answers.subplots ?? "" }
          const plan: VolumePlanningState = {
            volumeFolderName: input.volumeFolderName, startSequence: previous?.startSequence ?? input.chapterSequence,
            targetChapterCount: previous?.targetChapterCount ?? 0, targetWordCount: previous?.targetWordCount ?? 0,
            synopsisWriteCount: previous?.synopsisWriteCount ?? 0, outlineWriteCount: previous?.outlineWriteCount ?? 0,
            ...(previous?.notes === undefined ? {} : { notes: previous.notes }),
            storyline, storylineConfirmedAtMs: this.dependencies.now(),
          }
          const markdown = serializeVolumePlanningState(plan)
          await this.dependencies.workspace.saveUserMarkdown(input.workspaceRootRef, path, markdown)
          const saved = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, path)
          if (digest(saved) !== digest(markdown)) throw new Error("卷主支线写入核对失败，门禁未推进")
          state = markCreativeSetupWritten(state, { path, digest: digest(saved), now: this.dependencies.now() })
        }
        await this.dependencies.repository.save(input.projectId, state)
        continue
      }
      state = openCreativeSetupQuestion(state, this.dependencies.createId(), this.dependencies.now())
      await this.dependencies.repository.save(input.projectId, state)
      const question = state.pendingQuestion
      if (question === undefined) throw new Error("主角/卷规划问题状态不完整")
      const cached = input.regenerate === true ? undefined : [...input.priorMessages].reverse().find(message =>
        message.role === "assistant" && message.choices?.some(choice => choice.setupQuestionId === question.id))
      const reply = cached === undefined ? await input.generate(state) : cached
      const content = "content" in reply ? reply.content : ""
      const choices = (reply.choices ?? []).map(choice => ({
        label: choice.label, action: "continue_discuss" as const, setupQuestionId: question.id,
      }))
      if (choices.length < 2) throw new Error("AI 未提供足够的主题选项，请重试当前问题；未推进状态")
      return { content: [...notices, content].join("\n\n"), choices,
        questionId: question.id, scope, field: question.field, cached: cached !== undefined }
    }
    if (input.setupAnswerTo !== undefined && !answerConsumed) throw new Error("该问题已过期或已确认，请使用当前问题的选项")
    return undefined
  }
}
