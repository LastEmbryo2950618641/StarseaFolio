import {
  phaseRequestEnvelopeSchema,
  phaseResultEnvelopeSchema,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type ProjectId,
  type ProjectSettings,
  type ChapterNarrativeIntent,
  type ConversationArchiveQuery,
  type CharacterFieldValue,
  type CreationDeskSettingsUpdate,
  type DiscussCustomProceedGates,
  type DiscussFocusKind,
  type DiscussProceedMode,
  type DiscussProceedProgress,
  type DiscussProceedStage,
  DISCUSS_PIPELINE_STAGE_LABELS,
  buildVolumeLifecycle,
  resolveDiscussPipelineStage,
  resolveDiscussProceedMode,
  resolveProceedAutonomy,
  resolveProceedNextChapterAutonomy,
  type SynopsisConversationListResult,
  type SynopsisConversationMessage,
  type SynopsisConversationSendResult,
  type SynopsisConversationSession,
  type SynopsisConversationStartResult,
  type SynopsisConversationStreamEdit,
  type SynopsisConversationStreamSnapshot,
  type SynopsisConversationStreamUsage,
  type SynopsisConversationBudgetAdvisory,
  type SynopsisConversationChoice,
  type SynopsisResolveTurnInputResult,
  type TurnHandoffBrief,
  type TurnMonitorPhaseSnapshot,
  type WorkspaceCatalogSnapshot,
  type DeductionGoal,
  type HookScheduleAudit,
  selectGoalsForChapterContext,
} from "@starseafolio/contracts"
import {
  consumeDiscussToolExclusiveStrip,
  discussTurnWriteScopeSchema,
  synopsisDiscussArtifactSchema,
  type DiscussTurnWriteScope,
  type SynopsisDiscussArtifact,
} from "@starseafolio/prompt-contracts"
import { defaultProjectSettings } from "@starseafolio/config"

import {
  buildContextBudgetContent,
  buildContextUsageBreakdown,
  CONTEXT_FOLD_SUMMARY_PROTOCOL,
  contextTokensAfterProviderUsage,
  executeWithContextCompaction,
  filterNovelContextExchangeMessages,
  findEphemeralDiscussContextMessageIds,
  findExactDuplicateStaticMessageIds,
} from "../context/index.js"
import {
  assembleSynopsisPlaceholderDocument,
  assertUniqueVolumeSequence,
  DEFAULT_VOLUME_FOLDER_NAME,
  deriveChapterPublishPath,
  deriveOutlineMarkdownPath,
  deriveSynopsisMarkdownPath,
  deriveVolumeDirectoryPath,
  extractSynopsisTitleFromDocument,
  extractVolumeFolderNameFromPath,
  formatChapterSequenceLabel,
  digest,
  assembleChapterDocument,
  readChapterBody,
  pickPreferredVolumeFolderName,
  parseChapterSequenceFromLabel,
  parseOutlineMarkdownPath,
  parseSynopsisMarkdownPath,
  parseSynopsisTitleFromLabel,
  remapPathVolumeFolder,
  siblingPlanningMarkdownPath,
  isChapterBodyMarkdownPath,
  isOutlineMarkdownPath,
  isSynopsisPlaceholderDocument,
  isSynopsisMarkdownPath,
  validateSynopsisMarkdownPath,
  validateVolumeFolderName,
  assertWorkspaceMutationAllowed,
  assertWorkDescriptionWriteBatch,
  resolveDescriptionRulePaths,
  listDescriptionRuleFiles,
  NOVEL_MAJOR_CATEGORY_RULES_DIR,
  NOVEL_SUBCATEGORY_RULES_DIR,
  listWorkDescriptionRuleFiles,
  assessWorkStyleMarkdown,
  WORK_STYLE_RULE_PATH,
} from "../../core/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import {
  applyColdStartStyleGate,
  resolveColdStartStyleSelectionPath,
} from "./cold-start-style-gate.js"
import {
  canProceedPastWorkStyleGate,
} from "../../core/workspace/work-style-gate-state.js"
import type { GoalProposalPayload } from "@starseafolio/contracts"
import type { AIModelPort, PromptResourcePort, TurnPhaseInput, TurnReadEvidence, TurnRetrievalGap } from "../turns/ports/ai-model-port.js"
import type { WorkspacePort, InternalStorePort } from "../workspace/index.js"
import type { WorkspaceCatalogPort } from "../retrieval/ports/workspace-catalog.js"
import type { WebResearchPort } from "../retrieval/ports/web-research-port.js"
import type { ChapterResolveService } from "./chapter-resolve-service.js"
import {
  RevisionInvalidStateError,
  type ChapterRevisionService,
} from "./chapter-revision-service.js"
import type { ChapterSynopsisService } from "./chapter-synopsis-service.js"
import type { DeductionGoalsService } from "./deduction-goals-service.js"
import type { StagingPromoteService } from "./staging-promote-service.js"
import type { SettingsLineageService } from "../settings/settings-lineage-service.js"
import type { SqliteChapterIndexRepository } from "../../infrastructure/sqlite/repositories/sqlite-chapter-index-repository.js"
import type { SqliteDocumentRepository } from "../../infrastructure/sqlite/repositories/sqlite-document-repository.js"
import { ChapterTemporalSourceResolver } from "./chapter-temporal-source-resolver.js"
import type { SqliteSynopsisConversationRepository } from "../../infrastructure/sqlite/repositories/sqlite-synopsis-conversation-repository.js"
import { runtimeLog } from "../../infrastructure/diagnostics/index.js"
import { synopsisConversationStreamHub } from "./synopsis-conversation-stream-hub.js"
import { ComposeProtocolError, composeArtifactFromText, composeSections, extractComposeIntentMarker, extractContinueTurnMarker, parseComposeFocusTag, parseComposeHostTags } from "./compose-artifact.js"
import { isVolumeChapterCapReached, isVolumeStarted, nextVolumeFolderName, readVolumeLifecycleState, saveVolumeLifecycleState, transitionVolumeLifecycle, volumeLifecycleStatePath } from "./volume-lifecycle-state.js"
import { parseComposeGoalProposals } from "./compose-goal-proposals.js"
import { parseComposeToolRequest } from "./compose-tool-request.js"
import { parseComposeStagingPromote } from "./compose-staging-promote.js"
import { parseComposeOutlinePatch } from "./compose-outline-patch.js"
import { composeVolumePlanArtifactFromText } from "./compose-volume-plan.js"
import { parseComposeWritingSettings } from "./compose-writing-settings.js"
import { buildComposeWorkStylePrompt, composeWorkStyleArtifactFromText } from "./compose-work-style.js"
import { extractBlock, parseCreativeSetupOutput, parseDiscussChoices, parseWorkMetadataTags } from "./creative-setup-output.js"
import { composeProgressForEvent } from "./compose-stage.js"
import { ComposeStreamParser } from "@starseafolio/prompt-contracts"
import { retainDiscussWrites, restoreDiscussWrites, type PendingDiscussWrites } from "./discuss-pending-artifact.js"
import { describeDiscussWrites, formatDiscussBlockNote } from "./discuss-block-note.js"
import {
  AGENT_MEMORY_INDEX_PATH,
  truncateAgentMemoryIndex,
} from "./agent-memory.js"
import {
  collectDiscussReadEvidenceFromContext,
  compactDiscussContextHistory,
  computeDiscussBootstrapDigest,
  describeRequiredRetryStep,
  DISCUSS_ARCHIVE_NOTICE,
  DISCUSS_PROGRESS_PROTOCOL,
  DISCUSS_STEP_FAILURE_PROTOCOL,
  findInvalidDiscussGateMessageIds,
  measureDiscussProgress,
  readDiscussStepFailures,
  selectActiveDiscussRoutingMessages,
  toVisibleDiscussContextMessages,
} from "./discuss-session-context.js"
import {
  clearSynopsisSendCancellation,
  isSynopsisSendCancelled,
  markSynopsisSendCancelled,
  SynopsisSendCancelledError,
} from "./synopsis-send-cancellation.js"
import {
  acknowledgeSynopsisModelBudget,
  peekSynopsisModelBudgetAdvisory,
  recordSynopsisModelCall,
} from "./synopsis-model-budget-tracker.js"
import {
  buildInterruptedAssistantMessageFields,
  streamHasVisibleProgress,
} from "./synopsis-interrupted-turn.js"
import {
  alignTodosForChapterSequenceGate,
  alignTodosForToolExclusiveGate,
  discussChapterSequenceGateHint,
  DISCUSS_TODO_INCOMPLETE_HINT,
  DISCUSS_TODO_NO_PROGRESS_HINT,
  DISCUSS_TODO_REQUIRED_HINT,
  DISCUSS_TOOL_EXCLUSIVE_GATE_HINT,
  discussArtifactRequiresTodos,
  discussTodosAreSettled,
  discussTurnHasTodos,
  latestSavedDiscussTodos,
  isDiscussTodoBootstrapTool,
  isPrecedingChapterPublishGateError,
  partitionChapterDraftSequences,
  shouldRetryDeferredChapterDraft,
  settleToolGateTodos,
} from "./synopsis-todo-gate.js"
import {
  advanceTodoNoProgressStreak,
  resolveDiscussNoProgressGuardLimit,
  shouldAllowDiscussBudgetGrace,
  shouldIssueTodoLoopRepair,
  shouldStopTodoWriteLoop,
} from "./synopsis-discuss-guards.js"
import { normalizeThinkingDisplayText } from "./synopsis-thinking-text.js"
import { applySearchReplace } from "./markdown-search-replace.js"
import {
  executeSynopsisTool,
  DESCRIBE_REQUIRED_MESSAGE,
  synopsisToolCatalog,
  type SynopsisToolContext,
  type SynopsisWorkflowToolCallbacks,
  type SynopsisWorkflowToolResult,
} from "./synopsis-workflow-tools.js"
import {
  executeSynopsisWebReads,
} from "./synopsis-web-reads.js"
import {
  executeSynopsisWorkspaceReads,
  formatSynopsisSearchLabel,
  isPresentationRuleMarkdownPath,
  listUserRuleMarkdownPaths,
} from "./synopsis-workspace-reads.js"
import {
  executeSynopsisTemporalReads,
  formatTemporalSearchLabel,
  isTemporalReadRequest,
  MAX_TEMPORAL_READS_PER_ROUND,
  temporalSearchMeta,
} from "./synopsis-temporal-reads.js"
import {
  ARC_PLAN_STAGING_PATH,
  STAGING_FILE_KEYS,
  volumeOutlinePlanPath,
  evictStagingEntries,
  mergeStagingPatches,
  parseStagingEntries,
  serializeStagingEntries,
  stagingFileTitle,
  type StagingEntry,
  type StagingEntryPatch,
} from "./staging-entries.js"
import { chapterNarrativeIntentPhaseAppendix, chapterPresentationPhaseAppendix } from "../settings/chapter-narrative-intent-policy.js"
import {
  formatTurnHandoffSystemMessage,
} from "./turn-handoff.js"
import {
  incrementVolumePlanningWriteCount,
  parseVolumePlanningState,
  serializeVolumePlanningState,
  volumePlanningGateReady,
  volumePlanningMarkdownHasContent,
  type VolumePlanningState,
} from "./volume-planning-gate.js"
import { CreativeSetupCoordinator } from "./creative-setup-coordinator.js"
import { buildCreativeSetupPrompt, type CreativeSetupState } from "./creative-setup-state.js"
import type { SqliteCreativeSetupRepository } from "../../infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import {
  detectsOriginalWorkContext,
  hasOriginalWorkEvidence,
  originalWorkEvidenceRepairHint,
  readOriginalWorkEvidenceStage,
} from "./original-work-evidence-gate.js"

export class SynopsisInvalidStateError extends Error {}

class VolumeRolloverConflictError extends SynopsisInvalidStateError {}

type ChapterDraftProposal = Readonly<{
  base: "body" | "draft"
  baseDraftVersionId?: string
  heading: string
  body: string
}>

type ChapterDraftProposalEntry = ChapterDraftProposal & Readonly<{
  chapterSequence: number
}>

type VolumeChapterPlan = Readonly<{
  chapterSequence: number
  chapterTitle?: string
  synopsisBody: string
  outlineBody: string
}>

type VolumePlanningContext = NonNullable<NonNullable<TurnPhaseInput["synopsisDiscuss"]>["volumePlanning"]>
type VolumeBoundaryAction = "start" | "end" | "revise"
const VOLUME_BOUNDARY_LABEL: Record<VolumeBoundaryAction, string> = { start: "卷始", end: "卷末", revise: "修订" }
const volumeBoundaryMarker = (action: VolumeBoundaryAction): string => `<volume-${action}/>`

export type SynopsisConversationServiceDependencies = SynopsisWorkflowToolCallbacks & Readonly<{
  chapters: ChapterResolveService
  revisions?: ChapterRevisionService
  chapterSynopsis: ChapterSynopsisService
  conversation: SqliteSynopsisConversationRepository
  creativeSetup: SqliteCreativeSetupRepository
  goals: DeductionGoalsService
  stagingPromote: StagingPromoteService
  settingsLineage: SettingsLineageService
  chapterIndex: SqliteChapterIndexRepository
  documents: SqliteDocumentRepository
  internalStore: InternalStorePort
  chapterTemporal: ChapterTemporalSourceResolver
  workspace: WorkspacePort
  catalog: WorkspaceCatalogPort
  prompts: PromptResourcePort
  webResearch?: WebResearchPort
  readProjectSettings?: () => Promise<ProjectSettings>
  readDisplayName?: () => Promise<string>
  renameDisplayName?: (displayName: string) => Promise<string>
  readWorkDescription?: () => Promise<string>
  saveWorkDescription?: (description: string) => Promise<string>
  readTurnMonitor?: () => Promise<Readonly<{
    taskId: string
    status: string
    phases: readonly TurnMonitorPhaseSnapshot[]
  }> | undefined>
  /** Wait for in-flight graph revision publication; true when nothing is pending. */
  waitForPendingPublications?: (input: Readonly<{ timeoutMs: number; signal?: AbortSignal }>) => Promise<boolean>
  createId: () => string
  now: () => number
}>

export class SynopsisConversationService {

  public constructor(private readonly dependencies: SynopsisConversationServiceDependencies) {}

  public async list(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
  }>): Promise<SynopsisConversationListResult> {
    const usage = await this.hydrateDiscussUsage(input.projectId)
    const session = await this.dependencies.conversation.findActiveSession(input.projectId)
    const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
    if (session === undefined) {
      return {
        messages: [...messages],
        ...(usage === undefined ? {} : { usage }),
      }
    }
    const reconciled = await this.reconcileSessionSynopsisPath(input.workspaceRootRef, session)
    const proceedProgress = await this.syncProceedProgressFromMaterials({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      session: reconciled,
    })
    return {
      session: await this.withVolumeLifecycle(input.workspaceRootRef, reconciled),
      messages: [...messages],
      ...(usage === undefined ? {} : { usage }),
      proceedProgress,
    }
  }

  public async listInheritedReadEvidence(projectId: ProjectId): Promise<readonly TurnReadEvidence[]> {
    const session = await this.dependencies.conversation.findActiveSession(projectId)
    if (session === undefined) return []
    const messages = await this.dependencies.conversation.listDiscussContextMessages(session.sessionId)
    return collectDiscussReadEvidenceFromContext(messages)
  }

  public async start(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    title?: string
  }>): Promise<SynopsisConversationStartResult> {
    const usage = await this.hydrateDiscussUsage(input.projectId)
    const existing = await this.dependencies.conversation.findActiveSession(input.projectId)
    if (existing !== undefined) {
      const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
      const reconciled = await this.reconcileSessionSynopsisPath(input.workspaceRootRef, existing)
      const proceedProgress = await this.syncProceedProgressFromMaterials({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        session: reconciled,
      })
      return {
        session: await this.withVolumeLifecycle(input.workspaceRootRef, reconciled),
        messages: [...messages],
        ...(usage === undefined ? {} : { usage }),
        proceedProgress,
      }
    }
    const fromIndex = await this.dependencies.chapters.nextChapterSequence(input.projectId)
    const chapterSequence = fromIndex
    const claimed = await this.findExistingSynopsisForSequence(input.workspaceRootRef, chapterSequence)
    const title = input.title?.trim()
      || claimed?.title
      || ""
    const existingVolumes = await this.dependencies.workspace.listVolumeFolderNames(input.workspaceRootRef)
    const preferredVolume = pickPreferredVolumeFolderName(existingVolumes) ?? DEFAULT_VOLUME_FOLDER_NAME
    const synopsisPath = claimed?.path
      ?? deriveSynopsisMarkdownPath(chapterSequence, title, preferredVolume)
    const claimedSynopsisMarkdown = claimed === undefined
      ? ""
      : await this.readSynopsisFile(input.workspaceRootRef, synopsisPath)
    const claimedOutlinePath = siblingPlanningMarkdownPath(synopsisPath, "outline")
    const claimedOutlineMarkdown = claimedOutlinePath === undefined
      ? ""
      : await this.readSynopsisFile(input.workspaceRootRef, claimedOutlinePath)
    if (claimed === undefined) {
      const placeholder = assembleSynopsisPlaceholderDocument(chapterSequence, title)
      await this.dependencies.workspace.saveSynopsisMarkdown(input.workspaceRootRef, synopsisPath, placeholder)
    }
    const nowMs = this.dependencies.now()
    const sessionId = this.dependencies.createId()
    const session = await this.dependencies.conversation.createSession({
      sessionId,
      projectId: input.projectId,
      chapterSequence,
      synopsisPath,
      title: title.length === 0 ? formatChapterSequenceLabel(chapterSequence) : title,
      synopsisContentState: hasPlanningContent(claimedSynopsisMarkdown, true) ? "manual_modified" : "empty",
      outlineContentState: hasPlanningContent(claimedOutlineMarkdown, false) ? "manual_modified" : "empty",
      createdAtMs: nowMs,
    })
    runtimeLog("debug", "synopsis-conversation", "started", {
      projectId: input.projectId,
      sessionId,
      chapterSequence,
      synopsisPath,
      claimed: claimed !== undefined,
    })
    const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
    const proceedProgress = await this.syncProceedProgressFromMaterials({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      session,
    })
    return {
      session: await this.withVolumeLifecycle(input.workspaceRootRef, session),
      messages: [...messages],
      ...(usage === undefined ? {} : { usage }),
      proceedProgress,
    }
  }

  public async setFocus(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    chapterSequence?: number
    relativePath?: string
    focusKind?: DiscussFocusKind
    enterVolumeRevision?: boolean
  }>): Promise<SynopsisConversationStartResult> {
    const chapterSequence = this.resolveFocusChapterSequence(input)
    if (chapterSequence > await this.dependencies.chapters.nextChapterSequence(input.projectId)) {
      throw new SynopsisInvalidStateError("当前章尚未经过图修订发布为正文，不能进入下一章")
    }
    const session = await this.ensureActiveSession(input.projectId, input.workspaceRootRef)
    if (input.enterVolumeRevision && session.chapterSequence === chapterSequence) {
      const folder = extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
      await this.enterHistoricalVolumeRevision(input.workspaceRootRef, folder)
    }
    const focusKind = input.focusKind
      ?? this.resolveFocusKindFromPath(input.relativePath)
      ?? session.focusKind
      ?? "plot_synopsis"
    if (session.chapterSequence === chapterSequence && session.focusKind === focusKind) {
      const usage = await this.hydrateDiscussUsage(input.projectId)
      const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
      const reconciled = await this.reconcileSessionSynopsisPath(input.workspaceRootRef, session)
      const proceedProgress = await this.syncProceedProgressFromMaterials({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        session: reconciled,
      })
      return {
        session: await this.withVolumeLifecycle(input.workspaceRootRef, reconciled),
        messages: [...messages],
        ...(usage === undefined ? {} : { usage }),
        proceedProgress,
      }
    }
    if (session.chapterSequence === chapterSequence) {
      await this.dependencies.conversation.updateSession({
        sessionId: session.sessionId,
        focusKind,
        updatedAtMs: this.dependencies.now(),
      })
      const usage = await this.hydrateDiscussUsage(input.projectId)
      const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
      const focused = await this.dependencies.conversation.findSession(session.sessionId)
      const reconciled = await this.reconcileSessionSynopsisPath(
        input.workspaceRootRef,
        focused ?? { ...session, focusKind },
      )
      const proceedProgress = await this.syncProceedProgressFromMaterials({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        session: reconciled,
      })
      return {
        session: await this.withVolumeLifecycle(input.workspaceRootRef, reconciled),
        messages: [...messages],
        ...(usage === undefined ? {} : { usage }),
        proceedProgress,
      }
    }
    let claimed = await this.findExistingSynopsisForSequence(input.workspaceRootRef, chapterSequence)
    const existingVolumes = await this.dependencies.workspace.listVolumeFolderNames(input.workspaceRootRef)
    const currentVolume = await this.readFocusedVolume(input.workspaceRootRef, session)
    const indexed = await this.dependencies.chapterIndex.findBySequence(input.projectId, chapterSequence)
    const claimedVolume = extractVolumeFolderNameFromPath(indexed?.currentPublishPath ?? claimed?.path ?? "")
    const forward = chapterSequence > session.chapterSequence
    const editingPublishedVolume = input.enterVolumeRevision === true && indexed !== undefined
      && claimedVolume !== undefined && claimedVolume !== currentVolume.folder
    const crossesCap = forward && !editingPublishedVolume && isVolumeChapterCapReached(currentVolume.plan, chapterSequence)
      && (claimedVolume === undefined || claimedVolume === currentVolume.folder || currentVolume.state?.endedAtMs === undefined)
    if (crossesCap && currentVolume.state?.endedAtMs === undefined) {
      throw new SynopsisInvalidStateError("本卷已达章节上限。AI 必须先提交 <volume-end/> 标记卷末，才能进入下一章。")
    }
    const nextVolume = crossesCap ? nextVolumeFolderName(currentVolume.folder, existingVolumes) : undefined
    if (nextVolume !== undefined && claimedVolume !== undefined && claimedVolume !== nextVolume) {
      const placeholder = claimed !== undefined && indexed === undefined && !claimed.title?.trim()
        && isSynopsisPlaceholderDocument(await this.readSynopsisFile(input.workspaceRootRef, claimed.path))
      if (!placeholder || claimed === undefined) {
        throw new VolumeRolloverConflictError(`第 ${String(chapterSequence)} 章已有卷归属，请先处理归属再切至「${nextVolume}」。`)
      }
      const outline = siblingPlanningMarkdownPath(claimed.path, "outline")
      if (outline !== undefined && (await this.readSynopsisFile(input.workspaceRootRef, outline)).trim()) {
        throw new VolumeRolloverConflictError(`第 ${String(chapterSequence)} 章已有细纲，请先处理卷归属，再切至「${nextVolume}」。`)
      }
      await this.dependencies.workspace.removeSynopsisMarkdown(input.workspaceRootRef, claimed.path)
      claimed = undefined
    }
    const preferredVolume = nextVolume ?? claimedVolume ?? currentVolume.folder
    if (input.enterVolumeRevision) await this.enterHistoricalVolumeRevision(input.workspaceRootRef, preferredVolume)
    const title = claimed?.title?.trim()
      || ""
    const synopsisPath = claimed?.path
      ?? deriveSynopsisMarkdownPath(
        chapterSequence,
        title,
        preferredVolume,
      )
    if (claimed === undefined) {
      const placeholder = assembleSynopsisPlaceholderDocument(chapterSequence, title)
      await this.dependencies.workspace.saveSynopsisMarkdown(input.workspaceRootRef, synopsisPath, placeholder)
    }
    const nowMs = this.dependencies.now()
    await this.dependencies.conversation.updateSession({
      sessionId: session.sessionId,
      chapterSequence,
      synopsisPath,
      title: title.length === 0 ? formatChapterSequenceLabel(chapterSequence) : title,
      focusKind,
      lastAgentDigest: null,
      lastOutlineAgentDigest: null,
      synopsisConfirmedAtMs: null,
      synopsisContentState: "empty",
      outlineContentState: "empty",
      draftContentState: "empty",
      draftVersionId: null,
      lastDraftDigest: null,
      updatedAtMs: nowMs,
    })
    await this.dependencies.conversation.saveDiscussContextDigests({
      sessionId: session.sessionId,
      synopsisDigest: null,
      outlineDigest: null,
      bootstrapDigest: null,
      updatedAtMs: nowMs,
    })
    runtimeLog("debug", "synopsis-conversation", "set_focus", {
      projectId: input.projectId,
      sessionId: session.sessionId,
      fromSequence: session.chapterSequence,
      chapterSequence,
      focusKind,
      synopsisPath,
    })
    const usage = await this.hydrateDiscussUsage(input.projectId)
    const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
    const focused = await this.dependencies.conversation.findSession(session.sessionId)
    const reconciled = await this.reconcileSessionSynopsisPath(
      input.workspaceRootRef,
      focused ?? { ...session, chapterSequence, synopsisPath, focusKind },
    )
    const proceedProgress = await this.syncProceedProgressFromMaterials({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      session: reconciled,
    })
    return {
      session: await this.withVolumeLifecycle(input.workspaceRootRef, reconciled),
      messages: [...messages],
      ...(usage === undefined ? {} : { usage }),
      proceedProgress,
    }
  }

  public peekStream(projectId: ProjectId, sessionId?: string): SynopsisConversationStreamSnapshot {
    const snapshot = synopsisConversationStreamHub.peek(projectId, sessionId)
    const budgetAdvisory = peekSynopsisModelBudgetAdvisory(projectId)
    return budgetAdvisory === undefined
      ? snapshot
      : { ...snapshot, budgetAdvisory }
  }

  public async contextUsage(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    sessionId?: string
    contextWindowTokens?: number
  }>): Promise<Readonly<{
    sessionId?: string
    usedTokens: number
    maxTokens: number
    percent: number
    categories: ReturnType<typeof buildContextUsageBreakdown>["categories"]
    empty: boolean
  }>> {
    void input.workspaceRootRef
    const session = input.sessionId === undefined
      ? await this.dependencies.conversation.findActiveSession(input.projectId)
      : await this.dependencies.conversation.findSession(input.sessionId)
    const maxTokens = input.contextWindowTokens ?? 1_000_000
    if (session === undefined || session.projectId !== input.projectId) {
      return {
        usedTokens: 0,
        maxTokens,
        percent: 0,
        categories: [],
        empty: true,
      }
    }
    let messages = [...await this.dependencies.conversation.listDiscussContextMessages(session.sessionId)]
    const duplicateStaticIds = findExactDuplicateStaticMessageIds(messages)
    if (duplicateStaticIds.length > 0) {
      await this.dependencies.conversation.hideDiscussContextMessages(
        session.sessionId,
        duplicateStaticIds,
        this.dependencies.now(),
      )
      messages = messages.filter((message) => !duplicateStaticIds.includes(message.messageId))
    }
    const usage = await this.hydrateDiscussUsage(input.projectId)
    const breakdown = buildContextUsageBreakdown({
      messages,
      contextWindowTokens: maxTokens,
      ...(usage?.lastRequestInputTokens === undefined
        ? {}
        : { lastRequestInputTokens: usage.lastRequestInputTokens }),
    })
    return {
      sessionId: session.sessionId,
      usedTokens: breakdown.usedTokens,
      maxTokens: breakdown.maxTokens,
      percent: breakdown.percent,
      categories: breakdown.categories,
      empty: breakdown.empty,
    }
  }

  public acknowledgeBudget(input: Readonly<{ projectId: ProjectId }>): Readonly<{
    budgetAdvisory?: SynopsisConversationBudgetAdvisory
  }> {
    acknowledgeSynopsisModelBudget(input.projectId)
    const advisory = peekSynopsisModelBudgetAdvisory(input.projectId)
    return advisory === undefined ? {} : { budgetAdvisory: advisory }
  }

  public async send(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    message: string
    setupAnswerTo?: string
    publishDraftVersionId?: string
    model: AIModelPort
    chapterIntent?: ChapterNarrativeIntent
    presentation?: Readonly<{
      descriptionRulePath?: string | undefined
      proseStyleRulePath?: string | undefined
      novelMajorCategoryRulePath?: string | undefined
      novelSubcategoryRulePath?: string | undefined
      minimumWordCount: number
      maximumWordCount: number
    }>
    maxModelCalls?: number
    deadlineMs?: number
    signal?: AbortSignal
    focusLocked?: boolean
    lockedChapterSequence?: number
    lockedFocusKind?: DiscussFocusKind
    /** ChapterPanel 批量推演：按章规划并允许同轮写梗概与细纲。 */
    automation?: "batch_chapter"
    automationStep?: "volume_plan" | "volume_draft" | "chapter_plan" | "outline" | "draft"
    /**
     * @deprecated Prefer proceedMode. Legacy true → batch.
     */
    batchProceed?: boolean
    /** Creation-desk proceed mode (default single). */
    proceedMode?: DiscussProceedMode
    /** Per-stage auto gates when proceedMode is custom. */
    customProceedGates?: DiscussCustomProceedGates
    /**
     * UI「空转停跑保护」. Default off (`false`/omitted): do not hard-stop on idle loops.
     * When true, Todo/tool/step idle and content-fingerprint idle share `noProgressGuardLimit`.
     */
    noProgressGuardEnabled?: boolean
    /** Consecutive idle failures before stop when guard is on. Default 3; range 1–30. */
    noProgressGuardLimit?: number
    /** Claude Code–style discuss mode. */
    agentMode?: import("@starseafolio/contracts").DiscussAgentMode
    /** full (default) auto-applies 设定集; settings_write_confirm keeps confirm gate. */
    writePermissionMode?: import("@starseafolio/contracts").DiscussWritePermissionMode
  }>): Promise<SynopsisConversationSendResult> {
    const focusLocked = input.focusLocked === true
    const batchAutomation = input.automation === "batch_chapter"
    const agentMode = input.agentMode ?? "auto"
    const writePermissionMode = input.writePermissionMode
    const proceedMode: DiscussProceedMode = batchAutomation
      ? "batch"
      : resolveDiscussProceedMode({
        ...(input.proceedMode === undefined ? {} : { proceedMode: input.proceedMode }),
        ...(input.batchProceed === undefined ? {} : { batchProceed: input.batchProceed }),
      })
    const customGates = input.customProceedGates
    const stageAuto = (stage: DiscussProceedStage): boolean => resolveProceedAutonomy({
      mode: proceedMode,
      stage,
      ...(customGates === undefined ? {} : { customGates }),
      agentMode,
    })
    const autonomousChapterRequirements = stageAuto("chapter_requirements")
    const autonomousSynopsis = stageAuto("synopsis_discuss")
    const autonomousOutline = stageAuto("outline_discuss")
    const autonomousDraft = stageAuto("draft_discuss")
    const autonomousBody = stageAuto("body_discuss")
    const nextChapterAuto = resolveProceedNextChapterAutonomy({
      mode: proceedMode,
      ...(customGates === undefined ? {} : { customGates }),
      agentMode,
    })
    const withinChapterAuto = autonomousSynopsis || autonomousOutline || autonomousDraft
    const pipelineAuto = autonomousChapterRequirements || withinChapterAuto || autonomousBody || nextChapterAuto
    /** Legacy flag: batch mode or volume automation (prompt / nested call sites). */
    const batchProceed = proceedMode === "batch" || batchAutomation
    const emitProceedProgress = (
      stage: DiscussProceedStage,
      status: DiscussProceedProgress["status"],
    ): void => {
      synopsisConversationStreamHub.setProceedProgress(
        input.projectId,
        { stage, status },
        this.dependencies.now(),
      )
    }
    if (input.lockedChapterSequence !== undefined) {
      await this.setFocus({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        chapterSequence: input.lockedChapterSequence,
        focusKind: input.lockedFocusKind ?? "chapter_body",
      })
    }
    const session = await this.ensureActiveSession(input.projectId, input.workspaceRootRef)
    clearSynopsisSendCancellation(input.projectId)
    const volume = await this.readFocusedVolume(input.workspaceRootRef, session)
    const boundaryAction = !volume.started ? "start"
      : volume.atCap && volume.state?.endedAtMs === undefined ? "end"
      : volume.state?.endedAtMs !== undefined && volume.state.revisionStartedAtMs === undefined ? "revise"
      : undefined
    if (boundaryAction !== undefined) {
      return this.runVolumeBoundary(input, session, volume, boundaryAction)
    }
    await this.hydrateDiscussUsage(input.projectId)
    const priorMessages = await this.dependencies.conversation.listMessages(session.sessionId)
    let styleMarkdown: string | undefined
    try {
      styleMarkdown = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, WORK_STYLE_RULE_PATH)
    } catch {
      styleMarkdown = undefined
    }
    let styleGateState = await this.dependencies.conversation.findWorkStyleGateState(input.projectId)
    if (styleGateState.status === "ready" && digest(styleMarkdown ?? "") !== styleGateState.styleDigest) {
      styleGateState = await this.dependencies.conversation.transitionWorkStyleGate({
        projectId: input.projectId,
        event: {
          type: "style_document_changed",
          currentDigest: digest(styleMarkdown ?? ""),
          ...(styleMarkdown === undefined ? {} : { markdown: styleMarkdown }),
        },
        updatedAtMs: this.dependencies.now(),
      })
    }
    let availableProseStylePaths: string[] = []
    let availableNovelMajorCategoryRulePaths: string[] = []
    let availableNovelSubcategoryRulePaths: string[] = []
    if (styleGateState.status !== "ready") {
      const catalog = await this.dependencies.catalog.createSnapshot({
        snapshotId: this.dependencies.createId(),
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        generatedAtMs: this.dependencies.now(),
      })
      availableProseStylePaths = catalog.entries
        .filter((entry) => entry.entryKind === "file"
          && entry.relativePath.startsWith("表现输出/笔风规则/")
          && entry.relativePath.endsWith(".md"))
        .map((entry) => entry.relativePath)
      availableNovelMajorCategoryRulePaths = catalog.entries.filter((entry) => entry.entryKind === "file"
        && entry.relativePath.startsWith(`${NOVEL_MAJOR_CATEGORY_RULES_DIR}/`) && entry.relativePath.endsWith(".md"))
        .map((entry) => entry.relativePath)
      availableNovelSubcategoryRulePaths = catalog.entries.filter((entry) => entry.entryKind === "file"
        && entry.relativePath.startsWith(`${NOVEL_SUBCATEGORY_RULES_DIR}/`) && entry.relativePath.endsWith(".md"))
        .map((entry) => entry.relativePath)
      const selectedStyle = resolveColdStartStyleSelectionPath(
        priorMessages,
        input.message,
        availableProseStylePaths,
        availableNovelMajorCategoryRulePaths,
        availableNovelSubcategoryRulePaths,
      )
      if (selectedStyle !== undefined) {
        styleGateState = await this.dependencies.conversation.transitionWorkStyleGate({
          projectId: input.projectId,
          event: { type: "select_style", ...selectedStyle },
          updatedAtMs: this.dependencies.now(),
        })
      }
    }
    const workStyleGateReadyAtStart = canProceedPastWorkStyleGate(styleGateState)
    // Reset stream hub before any further awaits so concurrent streamPeek cannot
    // resurface the previous turn's completed thinking/content.
    const streamStartedAtMs = this.dependencies.now()
    synopsisConversationStreamHub.begin(input.projectId, session.sessionId, streamStartedAtMs)
    synopsisConversationStreamHub.restoreCarriedTodos(
      input.projectId,
      session.sessionId,
      latestSavedDiscussTodos(priorMessages),
      streamStartedAtMs,
    )
    try {
      let writeScope: DiscussTurnWriteScope | undefined
      let routingCalls = 0
      const routeStartedAt = this.dependencies.now()
      const automationStep = batchAutomation ? input.automationStep : undefined
      const canPublish = agentMode !== "plan" && !batchAutomation
      const publish = (draftVersionId: string) => this.publishConfirmedDraftIfRequested({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        session,
        message: input.message,
        draftVersionId,
        model: input.model,
        autoContinueNextChapter: nextChapterAuto,
        ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
        ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
        ...(input.deadlineMs === undefined ? {} : {
          deadlineMs: Math.max(1, input.deadlineMs - (this.dependencies.now() - routeStartedAt)),
        }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      if (input.publishDraftVersionId !== undefined) {
        if (!canPublish) throw new SynopsisInvalidStateError("当前模式不能通过讨论确认发布。")
        return await publish(input.publishDraftVersionId)
      }
      let setupMetadata: { workDisplayName?: string; workDescription?: string } = {}
      if (workStyleGateReadyAtStart) {
        const gateReply = await new CreativeSetupCoordinator({
          repository: this.dependencies.creativeSetup,
          workspace: this.dependencies.workspace,
          now: this.dependencies.now,
          createId: this.dependencies.createId,
          recordSettings: async (relativePath, markdown) => {
            await this.dependencies.settingsLineage.recordUpsert({ relativePath, markdown,
              sourceKind: "staging_promote", summary: "用户逐项确认主角罗盘，更新主角设定" })
          },
        }).advance({
          projectId: input.projectId, workspaceRootRef: input.workspaceRootRef,
          volumeFolderName: extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
          chapterSequence: session.chapterSequence, message: input.message, priorMessages,
          ...(input.setupAnswerTo === undefined || batchAutomation ? {} : { setupAnswerTo: input.setupAnswerTo }),
          generate: async (creativeSetup) => {
            const result = await this.runSynopsisDiscuss({
              projectId: input.projectId, workspaceRootRef: input.workspaceRootRef, sessionId: session.sessionId,
              userMessage: input.message, heading: session.title, chapterSequence: session.chapterSequence,
              synopsisMarkdown: "", outlineMarkdown: "", userEditedSinceAgent: false, userEditedOutlineSinceAgent: false,
              activeGoals: [], chapterProgress: [], hookScheduleAudit: {
                requireCompleteHookSchedules: true, incompleteHooks: [], completeCount: 0, incompleteCount: 0,
              },
              model: input.model, creativeSetup, allowWorkflowTools: false, allowChapterWorkflowTools: false,
              ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
              ...(input.signal === undefined ? {} : { signal: input.signal }),
              maxModelCalls: Math.min(input.maxModelCalls ?? 3, 3),

              ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
              ...(input.noProgressGuardEnabled === undefined
                ? {}
                : { noProgressGuardEnabled: input.noProgressGuardEnabled }),
              ...(input.noProgressGuardLimit === undefined
                ? {}
                : { noProgressGuardLimit: input.noProgressGuardLimit }),
            })
            setupMetadata = await this.applyWorkMetadata(result)
            return result
          },
        })
        if (gateReply !== undefined) {
          if (!gateReply.cached) {
            await this.dependencies.conversation.appendMessage({
              messageId: this.dependencies.createId(), projectId: input.projectId, sessionId: session.sessionId,
              role: "user", content: input.message, createdAtMs: this.dependencies.now(),
            })
            await this.dependencies.conversation.appendMessage({
              messageId: this.dependencies.createId(), projectId: input.projectId, sessionId: session.sessionId,
              role: "assistant", content: gateReply.content, choices: [...gateReply.choices], createdAtMs: this.dependencies.now() + 1,
            })
          }
          const usage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
          synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), { content: gateReply.content })
          synopsisConversationStreamHub.clear(input.projectId)
          return { session: await this.withVolumeLifecycle(input.workspaceRootRef, session), messages: [...await this.dependencies.conversation.listMessagesForProject(input.projectId)],
            awaitingSetupInput: { questionId: gateReply.questionId, scope: gateReply.scope, field: gateReply.field },
            ...setupMetadata,
            ...(usage === undefined ? {} : { usage }) }
        }
      }
      const synopsisMarkdown = await this.readSynopsisFile(input.workspaceRootRef, session.synopsisPath)
      const synopsisDigest = digest(synopsisMarkdown)
      const userEditedSinceAgent = session.lastAgentDigest !== undefined && session.lastAgentDigest !== synopsisDigest
      const outlinePathForRead = siblingPlanningMarkdownPath(session.synopsisPath, "outline")
        ?? deriveOutlineMarkdownPath(
          session.chapterSequence,
          session.title,
          extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
        )
      const outlineMarkdown = await this.readSynopsisFile(input.workspaceRootRef, outlinePathForRead)
      const outlineDigest = outlineMarkdown.trim().length === 0 ? undefined : digest(outlineMarkdown)
      const synopsisReady = hasPlanningContent(synopsisMarkdown, true)
      const outlineReadyAtStart = hasPlanningContent(outlineMarkdown, false)
      const initialVolume = extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
      const initialVolumePlanningState = await this.readVolumePlanningState(input.workspaceRootRef, initialVolume)
      const initialVolumePlanningContext = await this.readVolumePlanningContext(input.workspaceRootRef, initialVolume, initialVolumePlanningState)
      const volumePlanningGateWasReady = initialVolumePlanningContext.ready && volume.wordsReady
      if (workStyleGateReadyAtStart && volumePlanningGateWasReady && input.setupAnswerTo === undefined
        && automationStep === undefined && input.model.classifyDiscussTurn !== undefined) {
        const candidate = canPublish ? await this.findPublishableFocusDraft(input.projectId, session.chapterSequence) : undefined
        const signals = [
          ...(input.signal === undefined ? [] : [input.signal]),
          ...(input.deadlineMs === undefined ? [] : [AbortSignal.timeout(Math.max(1, input.deadlineMs - (this.dependencies.now() - routeStartedAt)))]),
        ]
        const { scope, usage } = await input.model.classifyDiscussTurn({
          message: input.message,
          recentMessages: selectActiveDiscussRoutingMessages(
            await this.dependencies.conversation.listDiscussContextMessages(session.sessionId),
            priorMessages.filter((message) => !message.hidden).slice(-4),
          )
            .map(({ role, content }) => ({ role, content: content.slice(0, 3_000) })),
          chapterSequence: session.chapterSequence,
          focusKind: session.focusKind,
          synopsisReady,
          outlineReady: outlineReadyAtStart,
          proceedMode,
          chapterAutomation: batchAutomation,
          ...(candidate === undefined ? {} : { publishableDraftLabel: candidate.draftLabel }),
          ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
        })
        if (isSynopsisSendCancelled(input.projectId)) throw new SynopsisSendCancelledError()
        input.signal?.throwIfAborted()
        // The router is a model: never let one malformed enum abort the whole turn.
        const normalizedScope = scope !== null && typeof scope === "object"
          && (scope as Record<string, unknown>).draft === "rewrite"
          ? { ...(scope as Record<string, unknown>), draft: "write" }
          : scope
        const parsedScope = discussTurnWriteScopeSchema.safeParse(normalizedScope)
        if (parsedScope.success) {
          const routed = parsedScope.data
          // A chapter synopsis write starts a complete composition. The router from
          // older prompt libraries may still authorize just the first artifact.
          if (routed.synopsis !== undefined && Object.keys(routed).every((key) =>
            ["synopsis", "outline", "draft", "chapterTitle", "advance"].includes(key))) {
            const { advance: _advance, ...composeScope } = routed
            writeScope = {
              ...composeScope,
              synopsis: synopsisReady ? "rewrite" : "create",
              outline: outlineReadyAtStart ? "rewrite" : "create",
              draft: "write",
            }
          } else {
            writeScope = routed
          }
          runtimeLog("info", "synopsis-conversation", "planning_write_scope.resolved", {
            projectId: input.projectId, sessionId: session.sessionId, chapterSequence: session.chapterSequence, scope: writeScope,
          })
        } else {
          runtimeLog("warn", "synopsis-conversation", "planning_write_scope.invalid", {
            projectId: input.projectId,
            sessionId: session.sessionId,
            chapterSequence: session.chapterSequence,
            issues: parsedScope.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
          })
        }
        routingCalls = Math.max(1, usage.modelCalls ?? 1)
        synopsisConversationStreamHub.addUsage(input.projectId, usage, this.dependencies.now())
        const cumulativeUsage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
        if (cumulativeUsage !== undefined) {
          await this.dependencies.conversation.saveDiscussUsage({
            projectId: input.projectId, usage: cumulativeUsage, updatedAtMs: this.dependencies.now(),
          })
        }
        if (writeScope !== undefined && writeScope.publish === true && Object.keys(writeScope).length === 1 && canPublish) {
          if (candidate === undefined) throw new SynopsisInvalidStateError("当前章没有可发布的草稿。")
          return await publish(candidate.draftVersionId)
        }
      }
      const chapterBodyMarkdown = await this.readFocusedCommittedBody(
        input.projectId,
        input.workspaceRootRef,
        session.chapterSequence,
      )
      const latestDraftMarkdown = await this.readFocusedLatestDraft(
        input.projectId,
        session.chapterSequence,
      )
      const userEditedOutlineSinceAgent = session.lastOutlineAgentDigest !== undefined
        && outlineDigest !== undefined
        && session.lastOutlineAgentDigest !== outlineDigest
      const confirmingSynopsis = writeScope === undefined
        ? isConfirmSynopsisUserMessage(input.message)
        : writeScope.outline !== undefined
      const nowMs = this.dependencies.now()
      let synopsisConfirmedAtMs = session.synopsisConfirmedAtMs
      if ((!synopsisReady || (userEditedSinceAgent && !confirmingSynopsis)) && synopsisConfirmedAtMs !== undefined) {
        synopsisConfirmedAtMs = undefined
        await this.dependencies.conversation.updateSession({
          sessionId: session.sessionId,
          synopsisConfirmedAtMs: null,
          updatedAtMs: nowMs,
        })
      }
      if ((confirmingSynopsis || autonomousSynopsis || batchAutomation) && synopsisReady && synopsisConfirmedAtMs === undefined) {
        synopsisConfirmedAtMs = nowMs
        await this.dependencies.conversation.updateSession({
          sessionId: session.sessionId,
          synopsisConfirmedAtMs: nowMs,
          updatedAtMs: nowMs,
        })
        if (autonomousSynopsis || batchAutomation) {
          emitProceedProgress("synopsis_discuss", "done")
        }
      }
      const synopsisConfirmed = synopsisConfirmedAtMs !== undefined
      const goalsSnapshot = await this.dependencies.goals.list(input.projectId)
      const activeGoals = selectGoalsForChapterContext(goalsSnapshot.goals, session.chapterSequence)
      const chapterProgress = goalsSnapshot.progress.filter(
        (item) => item.chapterSequence === session.chapterSequence && item.status !== "superseded",
      )
      const hookScheduleAudit = await this.dependencies.goals.auditHookSchedules(input.projectId)
      await this.dependencies.conversation.appendMessage({
        messageId: this.dependencies.createId(),
        projectId: input.projectId,
        sessionId: session.sessionId,
        role: "user",
        content: input.message,
        createdAtMs: nowMs,
      })
      const initialProgressFingerprint = pipelineAuto ? await this.readDiscussProgressFingerprint({
        projectId: input.projectId, workspaceRootRef: input.workspaceRootRef,
        chapterSequence: session.chapterSequence, draftVersionId: session.draftVersionId,
        styleStatus: styleGateState.status,
      }) : undefined
      switch (automationStep) {
        case "volume_plan":
          writeScope = { volume: "whole_volume", volumeTargets: true }
          break
        case "volume_draft":
          writeScope = { draft: "write", volumeDrafts: true }
          break
        case "chapter_plan":
          writeScope = {
            ...(synopsisReady ? {} : { synopsis: "create" }),
            ...(outlineReadyAtStart ? {} : { outline: "create" }),
            draft: "write",
          }
          break
        case "outline":
          writeScope = { outline: outlineReadyAtStart ? "rewrite" : "create" }
          break
        case "draft":
          writeScope = { draft: "write" }
          break
      }
      // Match syncProceedProgressFromMaterials: restage clears draftVersionId / empty state;
      // orphan revision rows alone must not pin「当前」on 草稿.
      const draftReadyAtStart = session.draftVersionId !== undefined
        && session.draftContentState !== "empty"
        && (latestDraftMarkdown?.trim().length ?? 0) > 0
      if (writeScope?.advance === true && Object.keys(writeScope).length === 1
        && (!synopsisReady || !outlineReadyAtStart || !draftReadyAtStart)
        && (chapterBodyMarkdown?.trim().length ?? 0) === 0) {
        writeScope = {
          ...(!synopsisReady ? { synopsis: "create" as const } : {}),
          ...(!synopsisReady || !outlineReadyAtStart ? { outline: outlineReadyAtStart ? "rewrite" as const : "create" as const } : {}),
          draft: "write",
        }
      }
      const chapterPublishedAtStart = (chapterBodyMarkdown?.trim().length ?? 0) > 0
      const pipelineStageAtStart = resolveDiscussPipelineStage({
        synopsisReady,
        outlineReady: outlineReadyAtStart,
        draftReady: draftReadyAtStart,
        ...(chapterPublishedAtStart ? { chapterPublished: true } : {}),
      })
      emitProceedProgress(
        pipelineStageAtStart,
        stageAuto(pipelineStageAtStart) ? "running" : "waiting",
      )
      const remainingCallsAfterRouting = input.maxModelCalls === undefined ? undefined : input.maxModelCalls - routingCalls
      if (remainingCallsAfterRouting !== undefined && remainingCallsAfterRouting <= 0) {
        throw new SynopsisInvalidStateError("本轮调用预算已用于识别写入范围，尚未写入任何内容。")
      }
      const discussResult = await this.runSynopsisDiscuss({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        sessionId: session.sessionId,
        userMessage: input.message,
        heading: session.title,
        chapterSequence: session.chapterSequence,
        synopsisMarkdown,
        outlineMarkdown,
        ...(chapterBodyMarkdown === undefined ? {} : { chapterBodyMarkdown }),
        ...(latestDraftMarkdown === undefined ? {} : { latestDraftMarkdown }),
        focusKind: session.focusKind ?? "plot_synopsis",
        ...(focusLocked ? { focusLocked: true } : {}),
        ...(outlineDigest === undefined ? {} : { outlineDigest }),
        userEditedSinceAgent,
        userEditedOutlineSinceAgent,
        synopsisConfirmed,
        ...(batchAutomation ? { batchAutomation: true } : {}),
        // Allows mid-chapter continueTurn / skip choice gate for single & partial custom.
        ...((batchProceed || withinChapterAuto) ? { batchProceed: true } : {}),
        proceedMode,
        ...(customGates === undefined ? {} : { customProceedGates: customGates }),
        ...(input.noProgressGuardEnabled === undefined
          ? {}
          : { noProgressGuardEnabled: input.noProgressGuardEnabled }),
        ...(input.noProgressGuardLimit === undefined
          ? {}
          : { noProgressGuardLimit: input.noProgressGuardLimit }),
        activeGoals,
        chapterProgress,
        hookScheduleAudit,
        model: input.model,
        composeText: workStyleGateReadyAtStart && volumePlanningGateWasReady
          && (scopedComposeIntent(writeScope) !== undefined || isOutlinePatchScope(writeScope)
            || isVolumeComposeScope(writeScope) || isFocusOnlyScope(writeScope)
            || (writeScope !== undefined && Object.keys(writeScope).length === 0)),
        ...(writeScope === undefined ? {} : { writeScope }),
        allowWorkflowTools: workStyleGateReadyAtStart,
        allowChapterWorkflowTools: workStyleGateReadyAtStart && volumePlanningGateWasReady,
        ...(workStyleGateReadyAtStart
          ? { volumePlanning: initialVolumePlanningContext }
          : {}),
        ...(!workStyleGateReadyAtStart
          ? {
              workStyleGate: {
                status: styleGateState.status as "awaiting_choice" | "style_selected",
                ...(styleGateState.status === "style_selected"
                  ? {
                      selectedProseStylePath: styleGateState.selectedProseStylePath,
                      novelMajorCategoryRulePath: styleGateState.novelMajorCategoryRulePath,
                      novelSubcategoryRulePath: styleGateState.novelSubcategoryRulePath,
                    }
                  : {}),
              },
            }
          : {}),
        agentMode,
        ...(writePermissionMode === undefined ? {} : { writePermissionMode }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
        ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
        ...(remainingCallsAfterRouting === undefined ? {} : { maxModelCalls: remainingCallsAfterRouting }),
        ...(input.deadlineMs === undefined ? {} : {
          deadlineMs: Math.max(1, input.deadlineMs - (this.dependencies.now() - routeStartedAt)),
        }),
      })
      const availableProseStylePaths = discussResult.availableProseStylePaths ?? []
      const availableDescriptionRulePaths = discussResult.availableDescriptionRulePaths ?? []
      const availableNovelMajorCategoryRulePaths = discussResult.availableNovelMajorCategoryRulePaths ?? []
      const availableNovelSubcategoryRulePaths = discussResult.availableNovelSubcategoryRulePaths ?? []
      const {
        availableProseStylePaths: _availableProseStylePaths,
        availableDescriptionRulePaths: _availableDescriptionRulePaths,
        availableNovelMajorCategoryRulePaths: _availableNovelMajorCategoryRulePaths,
        availableNovelSubcategoryRulePaths: _availableNovelSubcategoryRulePaths,
        ...discussAssist
      } = discussResult
      let assist = discussAssist
      if (writeScope !== undefined && writeScope.advance !== true && volumePlanningGateWasReady) {
        if (writeScope.volumeTitle !== true) delete assist.volumeFolderName
        if (writeScope.chapterTitle !== true) {
          delete assist.titleAlignTarget
          if (synopsisReady || writeScope.synopsis === undefined) delete assist.chapterTitle
        }
      }
      const planningWriteIntent = assist.planningWriteIntent
      // Mark stream completed as soon as the visible reply is ready, so the UI can leave
      // the "Stop / streaming" state while we still persist files and messages.
      synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
        ...(assist.reasoningContent === undefined ? {} : { thinking: assist.reasoningContent }),
        content: assist.content,
      })
      if (isSynopsisSendCancelled(input.projectId)) {
        throw new SynopsisSendCancelledError()
      }
      let synopsisPath = session.synopsisPath
      let sessionTitle = session.title
      let lastAgentDigest = session.lastAgentDigest
      let lastOutlineAgentDigest = session.lastOutlineAgentDigest
      let nextSynopsisContentState = session.synopsisContentState
      let nextOutlineContentState = session.outlineContentState
      let wroteSynopsisBody = false
      let savedOutlineThisTurn = false
      let restagedToSynopsisThisTurn = false
      let restagedToOutlineThisTurn = false
      let nextSynopsisConfirmedAtMs = synopsisConfirmedAtMs
      const writeNotices: string[] = []
      const currentVolume = extractVolumeFolderNameFromPath(synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
      const volumeFromAssist = assist.volumeFolderName === undefined
        ? undefined
        : validateVolumeFolderName(assist.volumeFolderName)
      if (volumeFromAssist !== undefined && !volumeFromAssist.ok) {
        throw new SynopsisInvalidStateError(volumeFromAssist.reason)
      }
      let nextVolume = volumeFromAssist?.ok === true ? volumeFromAssist.folderName : currentVolume
      let volumeCleanupFolder: string | undefined
      if (nextVolume !== currentVolume) {
        const volumeChange = await this.applyVolumeFolderChange({
          projectId: input.projectId,
          workspaceRootRef: input.workspaceRootRef,
          synopsisPath,
          fromFolderName: currentVolume,
          toFolderName: nextVolume,
        })
        synopsisPath = volumeChange.synopsisPath
        nextVolume = volumeChange.volumeFolderName
        volumeCleanupFolder = volumeChange.cleanupEmptyFolderName
      }
      let volumePlanningState = nextVolume === initialVolume
        ? initialVolumePlanningState
        : await this.readVolumePlanningState(input.workspaceRootRef, nextVolume)
      const volumePlanningWasReady = (await this.readVolumePlanningContext(input.workspaceRootRef, nextVolume, volumePlanningState)).ready
      const volumeStoryConfirmation = await this.dependencies.creativeSetup.find(input.projectId, `volume:${nextVolume}`)
      const volumeStoryNeedsUser = workStyleGateReadyAtStart && volumeStoryConfirmation?.status !== "ready"
      const volumePlanningNeedsFirstWrite = !volumePlanningWasReady || volumeStoryNeedsUser
      if (volumeStoryNeedsUser) {
        delete assist.volumePlanMeta
        delete assist.volumeSynopsisMarkdown
        delete assist.arcPlanMarkdown
        writeNotices.push("本卷主支线尚未由用户确认，不能直接生成卷梗概、大纲或章节；下一步询问开场、高潮、结局和支线事件时机。")
      }
      if (volumePlanningNeedsFirstWrite) {
        const attemptedChapterWrite = assist.synopsisBody !== undefined
          || assist.outlineBody !== undefined
          || assist.bodyEdits !== undefined
          || assist.chapterDraftProposal !== undefined
          || (assist.chapterDraftProposals?.length ?? 0) > 0
          || (assist.volumeChapterPlans?.length ?? 0) > 0
          || assist.appendedDraft !== undefined
          || assist.focusChange !== undefined
          || assist.continueTurn === true
        if (attemptedChapterWrite) {
          writeNotices.push("卷级首次写入门禁未完成：本轮已拦截章节梗概、大纲、草稿、正文和自动推进。请先完成卷信息、卷梗概和卷大纲的首次写入。")
          delete assist.synopsisBody
          delete assist.outlineBody
          delete assist.bodyEdits
          delete assist.chapterDraftProposal
          delete assist.chapterDraftProposals
          delete assist.volumeChapterPlans
          delete assist.appendedDraft
          delete assist.focusChange
          assist.continueTurn = false
          assist.choices = assist.choices?.filter((choice) => ![
            "confirm_synopsis", "confirm_arc_plan", "set_focus", "start_turn", "promote_draft_to_body",
          ].includes(choice.action))
        }
      }
      const completeComposition = assist.synopsisBody !== undefined && assist.outlineBody !== undefined
        && assist.chapterDraftProposal !== undefined
      if (completeComposition) {
        const outlinePathBeforeWrite = siblingPlanningMarkdownPath(synopsisPath, "outline") ?? outlinePathForRead
        const [currentSynopsis, currentOutline] = await Promise.all([
          this.readSynopsisFile(input.workspaceRootRef, synopsisPath),
          this.readSynopsisFile(input.workspaceRootRef, outlinePathBeforeWrite),
        ])
        if (digest(currentSynopsis) !== synopsisDigest || digest(currentOutline) !== digest(outlineMarkdown)) {
          throw new SynopsisInvalidStateError("生成期间梗概或细纲已变更，本轮构思未写入。")
        }
      }
      const synopsisChangedWhileRunning = assist.synopsisBody !== undefined
        && digest(await this.readSynopsisFile(input.workspaceRootRef, synopsisPath)) !== synopsisDigest
      if (synopsisChangedWhileRunning) {
        writeNotices.push("生成期间梗概文件已发生变更，本轮保留最新版本。")
      } else if (assist.synopsisBody !== undefined
        && (!userEditedSinceAgent
          || planningWriteIntent?.synopsis === "rewrite"
          || writeScope?.synopsis === "rewrite")) {
        // Rewrite invalidates downstream materials so the stage bar returns to 梗概
        // (materials-only resolve would otherwise stay on 草稿 while old 细纲/草稿 remain).
        const rewriteSynopsis = planningWriteIntent?.synopsis === "rewrite"
          || writeScope?.synopsis === "rewrite"
        if (rewriteSynopsis && !completeComposition) {
          try {
            await this.dependencies.chapterSynopsis.restageChapter({
              projectId: input.projectId,
              workspaceRootRef: input.workspaceRootRef,
              chapterSequence: session.chapterSequence,
              targetStage: "synopsis",
              reason: "用户要求重写梗概：清除下游细纲与草稿表面，阶段回到梗概",
            })
            restagedToSynopsisThisTurn = true
            writeNotices.push("已回退到梗概阶段：旧细纲已清除，草稿表面已清空，请按新梗概重写下游。")
          } catch (error) {
            runtimeLog("warn", "synopsis-conversation", "restage-on-synopsis-rewrite-failed", {
              projectId: input.projectId,
              sessionId: session.sessionId,
              error: error instanceof Error ? error.message : String(error),
            })
            writeNotices.push("重写梗概时未能自动回退下游材料，阶段条可能仍停在更后节点；请再试或调用 restage_chapter。")
          }
        }
        wroteSynopsisBody = true
        const preserveTitle = writeScope !== undefined && writeScope.advance !== true
          && writeScope.chapterTitle !== true && synopsisReady
        const resolvedTitle = preserveTitle ? sessionTitle
          : assist.chapterTitle?.trim() ?? extractSynopsisTitleFromDocument(assist.synopsisBody)
        if (resolvedTitle !== undefined && resolvedTitle.length > 0) {
          const nextPath = deriveSynopsisMarkdownPath(session.chapterSequence, resolvedTitle, nextVolume)
          this.emitDiscussEdit(input.projectId, {
            path: nextPath,
            kind: "synopsis",
            status: "running",
            summary: "正在写入剧情梗概",
          })
          if (nextPath !== synopsisPath) {
            await this.dependencies.workspace.saveSynopsisMarkdown(
              input.workspaceRootRef,
              nextPath,
              assist.synopsisBody,
            )
            await this.relocateOutlineBesideSynopsis(
              input.workspaceRootRef,
              synopsisPath,
              nextPath,
            )
            await this.dependencies.workspace.removeSynopsisMarkdown(input.workspaceRootRef, synopsisPath)
            synopsisPath = nextPath
            sessionTitle = resolvedTitle
          } else {
            await this.dependencies.workspace.saveSynopsisMarkdown(
              input.workspaceRootRef,
              synopsisPath,
              assist.synopsisBody,
            )
            sessionTitle = resolvedTitle
          }
          this.emitDiscussEdit(input.projectId, {
            path: synopsisPath,
            kind: "synopsis",
            status: "completed",
            summary: "已写入剧情梗概",
          })
        } else {
          const nextPath = deriveSynopsisMarkdownPath(
            session.chapterSequence,
            sessionTitle,
            nextVolume,
          )
          this.emitDiscussEdit(input.projectId, {
            path: nextPath,
            kind: "synopsis",
            status: "running",
            summary: "正在写入剧情梗概",
          })
          if (nextPath !== synopsisPath) {
            await this.dependencies.workspace.saveSynopsisMarkdown(
              input.workspaceRootRef,
              nextPath,
              assist.synopsisBody,
            )
            await this.relocateOutlineBesideSynopsis(
              input.workspaceRootRef,
              synopsisPath,
              nextPath,
            )
            await this.dependencies.workspace.removeSynopsisMarkdown(input.workspaceRootRef, synopsisPath)
            synopsisPath = nextPath
          } else {
            await this.dependencies.workspace.saveSynopsisMarkdown(
              input.workspaceRootRef,
              synopsisPath,
              assist.synopsisBody,
            )
          }
          this.emitDiscussEdit(input.projectId, {
            path: synopsisPath,
            kind: "synopsis",
            status: "completed",
            summary: "已写入剧情梗概",
          })
        }
        lastAgentDigest = digest(assist.synopsisBody)
        nextSynopsisContentState = hasPlanningContent(assist.synopsisBody, true) ? "ai_written" : "empty"
        await this.dependencies.chapterSynopsis.recordPlanningArtifactState({
          projectId: input.projectId,
          chapterSequence: session.chapterSequence,
          kind: "synopsis",
          state: nextSynopsisContentState,
          markdown: assist.synopsisBody,
        })
      } else if (assist.synopsisBody !== undefined && userEditedSinceAgent
        && planningWriteIntent?.synopsis !== "rewrite"
        && writeScope?.synopsis !== "rewrite") {
        writeNotices.push("梗概文件有你的手改内容，模型未确认本轮要重写该文档，因此已保留原文。")
        this.emitDiscussEdit(input.projectId, {
          path: synopsisPath,
          kind: "synopsis",
          status: "failed",
          summary: "未落盘：你刚改过梗概文件",
        })
        runtimeLog("debug", "synopsis-conversation", "skipped-agent-overwrite", {
          projectId: input.projectId,
          sessionId: session.sessionId,
        })
      } else if ((assist.chapterTitle !== undefined || nextVolume !== currentVolume) && !userEditedSinceAgent) {
        const resolvedTitle = assist.chapterTitle?.trim() ?? sessionTitle
        if (resolvedTitle.length > 0) {
          const nextPath = deriveSynopsisMarkdownPath(session.chapterSequence, resolvedTitle, nextVolume)
          if (nextPath !== synopsisPath) {
            const currentBody = await this.readSynopsisFile(input.workspaceRootRef, synopsisPath)
            await this.dependencies.workspace.saveSynopsisMarkdown(
              input.workspaceRootRef,
              nextPath,
              currentBody,
            )
            await this.relocateOutlineBesideSynopsis(
              input.workspaceRootRef,
              synopsisPath,
              nextPath,
            )
            await this.dependencies.workspace.removeSynopsisMarkdown(input.workspaceRootRef, synopsisPath)
            synopsisPath = nextPath
            if (assist.chapterTitle !== undefined) sessionTitle = resolvedTitle
          }
        }
      }

      if (assist.titleAlignTarget !== undefined) {
        const aligned = await this.applyTitleAlignTarget({
          projectId: input.projectId,
          workspaceRootRef: input.workspaceRootRef,
          chapterSequence: session.chapterSequence,
          target: assist.titleAlignTarget,
          synopsisPath,
          sessionTitle,
          volumeFolderName: nextVolume,
        })
        synopsisPath = aligned.synopsisPath
        sessionTitle = aligned.sessionTitle
        writeNotices.push(...aligned.notices)
      }

      let styleDiskMarkdown: string | undefined
      try {
        styleDiskMarkdown = await this.dependencies.workspace.readMarkdown(
          input.workspaceRootRef,
          WORK_STYLE_RULE_PATH,
        )
      } catch {
        styleDiskMarkdown = undefined
      }
      if (styleGateState.status === "ready" && digest(styleDiskMarkdown ?? "") !== styleGateState.styleDigest) {
        styleGateState = await this.dependencies.conversation.transitionWorkStyleGate({
          projectId: input.projectId,
          event: {
            type: "style_document_changed",
            currentDigest: digest(styleDiskMarkdown ?? ""),
            ...(styleDiskMarkdown === undefined ? {} : { markdown: styleDiskMarkdown }),
          },
          updatedAtMs: this.dependencies.now(),
        })
      }
      const styleGated = applyColdStartStyleGate({
        assist,
        diskStyleMarkdown: styleDiskMarkdown,
        availableProseStylePaths,
        availableNovelMajorCategoryRulePaths,
        availableNovelSubcategoryRulePaths,
        gateReady: workStyleGateReadyAtStart && canProceedPastWorkStyleGate(styleGateState),
        styleChoicePending: styleGateState.status === "awaiting_choice",
      })
      let coldStartStyleNeedsChoice = styleGated.blocked
      assist = styleGated.assist
      if (styleGated.notices.length > 0) writeNotices.push(...styleGated.notices)
      const requestedCreationDeskSettings = workStyleGateReadyAtStart
        ? sanitizeCreationDeskSettings({
            update: assist.creationDeskSettings,
            availableDescriptionRulePaths,
            availableProseStylePaths,
            availableNovelMajorCategoryRulePaths,
            availableNovelSubcategoryRulePaths,
          })
        : undefined
      const rejectedCreationDeskRulePaths = workStyleGateReadyAtStart
        ? getRejectedCreationDeskRulePaths({
            update: assist.creationDeskSettings,
            availableDescriptionRulePaths,
            availableProseStylePaths,
            availableNovelMajorCategoryRulePaths,
            availableNovelSubcategoryRulePaths,
          })
        : []

      if (assist.volumeChapterPlans !== undefined && assist.volumeChapterPlans.length > 0) {
        const allowsWholeVolumePlanning = writeScope === undefined
          ? assist.planningWriteIntent?.volume === "whole_volume"
          : writeScope.volume === "whole_volume"
        const { allowed, deferred } = partitionVolumeChapterPlansBySequence(
          assist.volumeChapterPlans,
          session.chapterSequence,
          allowsWholeVolumePlanning,
        )
        if (deferred.length > 0) {
          assist = { ...assist, volumeChapterPlans: allowed }
          const deferredSequences = [...new Set(deferred.map((plan) => plan.chapterSequence))].sort((a, b) => a - b)
          writeNotices.push(
            `按章顺序门禁：当前是第${String(session.chapterSequence)}章，已暂缓第${deferredSequences.join("、")}章的梗概/细纲规划。请先完成当前章梗概、细纲与正文草稿，再继续下一章。`,
          )
          runtimeLog("warn", "synopsis-conversation", "chapter_sequence.planning_deferred", {
            projectId: input.projectId,
            sessionId: session.sessionId,
            currentSequence: session.chapterSequence,
            deferredSequences,
          })
        }
      }

      if (assist.volumePlanMeta?.targetChapterCount !== undefined
        && assist.volumePlanMeta.targetWordCount !== undefined) {
        const planVolume = nextVolume
          ?? extractVolumeFolderNameFromPath(synopsisPath)
          ?? DEFAULT_VOLUME_FOLDER_NAME
        const planPath = `大纲/${planVolume}.批量计划.md`
        let previousStartSequence: number | undefined
        try {
          const previousPlan = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, planPath)
          const previousJson = previousPlan.match(/```json\s*([\s\S]*?)\s*```/u)?.[1]
          if (previousJson !== undefined) {
            const parsed: unknown = JSON.parse(previousJson)
            if (typeof parsed === "object" && parsed !== null) {
              const startSequence = (parsed as Record<string, unknown>).startSequence
              if (typeof startSequence === "number" && Number.isInteger(startSequence) && startSequence > 0) {
                previousStartSequence = startSequence
              }
            }
          }
        } catch {
          previousStartSequence = undefined
        }
        const plan: VolumePlanningState = {
          volumeFolderName: planVolume,
          startSequence: previousStartSequence ?? (assist.volumeChapterPlans?.length
            ? Math.min(...assist.volumeChapterPlans.map((chapter) => chapter.chapterSequence))
            : session.chapterSequence),
          targetChapterCount: assist.volumePlanMeta.targetChapterCount,
          targetWordCount: assist.volumePlanMeta.targetWordCount,
          synopsisWriteCount: volumePlanningState?.synopsisWriteCount ?? 0,
          outlineWriteCount: volumePlanningState?.outlineWriteCount ?? 0,
          ...(volumePlanningState?.storyline === undefined ? {} : { storyline: volumePlanningState.storyline }),
          ...(volumePlanningState?.storylineConfirmedAtMs === undefined ? {} : { storylineConfirmedAtMs: volumePlanningState.storylineConfirmedAtMs }),
          ...(assist.volumePlanMeta.notes === undefined ? {} : { notes: assist.volumePlanMeta.notes }),
        }
        volumePlanningState = plan
        await this.dependencies.workspace.saveUserMarkdown(
          input.workspaceRootRef,
          planPath,
          serializeVolumePlanningState(plan),
        )
      }

      if (assist.volumeChapterPlans !== undefined && assist.volumeChapterPlans.length > 0) {
        const planVolume = nextVolume
          ?? extractVolumeFolderNameFromPath(synopsisPath)
          ?? DEFAULT_VOLUME_FOLDER_NAME
        for (const plan of assist.volumeChapterPlans) {
          const existing = await this.dependencies.chapterSynopsis.getWorkflowGate({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            chapterSequence: plan.chapterSequence,
          })
          const hasProtectedPlanning = (
            existing.synopsis.contentState === "manual_modified" && existing.synopsis.markdown !== plan.synopsisBody
          ) || (
            existing.outline.contentState === "manual_modified" && existing.outline.markdown !== plan.outlineBody
          )
          const outsideVolume = [existing.synopsis.path, existing.outline.path, existing.body.path].some(
            (path) => path !== undefined && extractVolumeFolderNameFromPath(path) !== planVolume,
          )
          if (hasProtectedPlanning || outsideVolume) {
            writeNotices.push(hasProtectedPlanning
              ? `第${String(plan.chapterSequence)}章有手改规划，已保留。需要调整时可针对该章提出修改。`
              : `第${String(plan.chapterSequence)}章已有材料归属其他卷，已跳过。`)
            continue
          }
          const persisted = await this.persistVolumeChapterPlan({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            plan,
            volumeFolderName: planVolume,
            ...(existing.synopsis.path === undefined ? {} : { synopsisPath: existing.synopsis.path }),
            ...(existing.outline.path === undefined ? {} : { outlinePath: existing.outline.path }),
          })
          for (const [kind, markdown, contentState] of [
            ["synopsis", plan.synopsisBody, existing.synopsis.contentState],
            ["outline", plan.outlineBody, existing.outline.contentState],
          ] as const) {
            if (contentState === "manual_modified") continue
            await this.dependencies.chapterSynopsis.recordPlanningArtifactState({
              projectId: input.projectId,
              chapterSequence: plan.chapterSequence,
              kind,
              markdown,
              state: hasPlanningContent(markdown, kind === "synopsis") ? "ai_written" : "empty",
            })
          }
          if (plan.chapterSequence === session.chapterSequence) {
            wroteSynopsisBody = true
            savedOutlineThisTurn = true
            synopsisPath = persisted.synopsisPath
            sessionTitle = persisted.title
            lastAgentDigest = digest(plan.synopsisBody)
            nextSynopsisContentState = hasPlanningContent(plan.synopsisBody, true) ? "ai_written" : "empty"
            nextOutlineContentState = hasPlanningContent(plan.outlineBody, false) ? "ai_written" : "empty"
          }
        }
      }

      const outlinePath = siblingPlanningMarkdownPath(synopsisPath, "outline")
        ?? deriveOutlineMarkdownPath(
          session.chapterSequence,
          sessionTitle,
          extractVolumeFolderNameFromPath(synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
        )
      const synopsisMarkdownAfterWrites = await this.readSynopsisFile(input.workspaceRootRef, synopsisPath)
      const synopsisReadyForOutline = hasPlanningContent(synopsisMarkdownAfterWrites, true)
      const outlineWriteAllowed = synopsisReadyForOutline && (writeScope?.synopsis === undefined || wroteSynopsisBody)
      if (assist.bodyEdits !== undefined) {
        this.emitDiscussEdit(input.projectId, {
          path: outlinePath,
          kind: "body_edits",
          status: "running",
          summary: "正在局部更新细纲",
          opsAttempted: assist.bodyEdits.ops.length,
        })
        if (!outlineWriteAllowed) {
          writeNotices.push("剧情梗概尚未完成：本轮细纲未落盘，请先补齐剧情梗概。")
          this.emitDiscussEdit(input.projectId, {
            path: outlinePath,
            kind: "body_edits",
            status: "failed",
            summary: "未落盘：缺少有效剧情梗概",
            opsAttempted: assist.bodyEdits.ops.length,
            opsApplied: 0,
          })
          runtimeLog("debug", "synopsis-conversation", "outline-edits-blocked-missing-synopsis", {
            projectId: input.projectId,
            sessionId: session.sessionId,
          })
        } else if (userEditedOutlineSinceAgent && planningWriteIntent?.outline !== "patch") {
          writeNotices.push(planningWriteIntent?.outline === "rewrite"
            ? "本轮意图要求整篇重写细纲，但模型返回了局部编辑，本轮未应用。"
            : "细纲文件有你的手改内容，模型未确认本轮要局部修改，因此已保留原文。")
          this.emitDiscussEdit(input.projectId, {
            path: outlinePath,
            kind: "body_edits",
            status: "failed",
            summary: "未落盘：你刚改过细纲文件",
            opsAttempted: assist.bodyEdits.ops.length,
            opsApplied: 0,
          })
        } else {
          const currentOutline = await this.readSynopsisFile(input.workspaceRootRef, outlinePath)
          if (currentOutline.trim().length === 0) {
            writeNotices.push("细纲文件尚不存在或为空，无法局部编辑；请先输出完整 outlineBody。")
            this.emitDiscussEdit(input.projectId, {
              path: outlinePath,
              kind: "body_edits",
              status: "failed",
              summary: "未落盘：细纲为空或不存在",
              opsAttempted: assist.bodyEdits.ops.length,
              opsApplied: 0,
            })
          } else if (
            assist.bodyEdits.baseDigest !== undefined
            && digest(currentOutline) !== assist.bodyEdits.baseDigest
          ) {
            writeNotices.push("细纲已变化（baseDigest 不匹配），本轮 bodyEdits 未落盘。请基于最新细纲重抄 oldText，或改吐全量 outlineBody。")
            this.emitDiscussEdit(input.projectId, {
              path: outlinePath,
              kind: "body_edits",
              status: "failed",
              summary: "未落盘：baseDigest 不匹配",
              opsAttempted: assist.bodyEdits.ops.length,
              opsApplied: 0,
            })
          } else {
            const applied = applySearchReplace(currentOutline, assist.bodyEdits.ops)
            if (!applied.ok) {
              writeNotices.push(`${applied.reason}；细纲未改盘。请重贴锚点或改吐全量 outlineBody。`)
              this.emitDiscussEdit(input.projectId, {
                path: outlinePath,
                kind: "body_edits",
                status: "failed",
                summary: applied.reason,
                opsAttempted: assist.bodyEdits.ops.length,
                opsApplied: 0,
              })
            } else {
              await this.dependencies.workspace.saveSynopsisMarkdown(
                input.workspaceRootRef,
                outlinePath,
                applied.content,
              )
              lastOutlineAgentDigest = digest(applied.content)
              savedOutlineThisTurn = true
              nextOutlineContentState = hasPlanningContent(applied.content, false) ? "ai_written" : "empty"
              await this.dependencies.chapterSynopsis.recordPlanningArtifactState({
                projectId: input.projectId,
                chapterSequence: session.chapterSequence,
                kind: "outline",
                state: nextOutlineContentState,
                markdown: applied.content,
              })
              writeNotices.push(`已局部更新细纲（${String(applied.appliedCount)} 处）。`)
              this.emitDiscussEdit(input.projectId, {
                path: outlinePath,
                kind: "body_edits",
                status: "completed",
                summary: `已局部更新细纲（${String(applied.appliedCount)} 处）`,
                opsAttempted: assist.bodyEdits.ops.length,
                opsApplied: applied.appliedCount,
              })
            }
          }
        }
      } else if (assist.outlineBody !== undefined && outlineWriteAllowed) {
        this.emitDiscussEdit(input.projectId, {
          path: outlinePath,
          kind: "outline",
          status: "running",
          summary: "正在写入剧情细纲",
        })
        const currentOutline = await this.readSynopsisFile(input.workspaceRootRef, outlinePath)
        // Host synopsis restage deletes the outline mid-turn; that digest change is expected and
        // must not block the same turn from writing a replacement outline (+ draft).
        if (!restagedToSynopsisThisTurn && digest(currentOutline) !== digest(outlineMarkdown)) {
          writeNotices.push("生成期间细纲文件已发生变更，本轮保留最新版本。")
          this.emitDiscussEdit(input.projectId, {
            path: outlinePath, kind: "outline", status: "failed", summary: "未落盘：细纲已变化",
          })
        } else if (!restagedToSynopsisThisTurn && userEditedOutlineSinceAgent
          && planningWriteIntent?.outline !== "rewrite"
          && writeScope?.outline !== "rewrite") {
          writeNotices.push(planningWriteIntent?.outline === "patch"
            ? "本轮意图要求局部修改细纲，但模型返回了整篇内容，本轮未覆盖手改。"
            : "细纲文件有你的手改内容，模型未确认本轮要重写整篇细纲，因此已保留原文。")
          this.emitDiscussEdit(input.projectId, {
            path: outlinePath,
            kind: "outline",
            status: "failed",
            summary: "未落盘：你刚改过细纲文件",
          })
        } else {
          if (!completeComposition && (planningWriteIntent?.outline === "rewrite" || writeScope?.outline === "rewrite")) {
            await this.dependencies.chapterSynopsis.restageChapter({
              projectId: input.projectId,
              workspaceRootRef: input.workspaceRootRef,
              chapterSequence: session.chapterSequence,
              targetStage: "outline",
              reason: "用户要求重写细纲：清除下游草稿表面，阶段回到细纲",
            })
            restagedToOutlineThisTurn = true
            writeNotices.push("已回退到细纲阶段：草稿表面已清空，请按新细纲重写草稿。")
          }
          await this.dependencies.workspace.saveSynopsisMarkdown(
            input.workspaceRootRef,
            outlinePath,
            assist.outlineBody,
          )
          lastOutlineAgentDigest = digest(assist.outlineBody)
          savedOutlineThisTurn = true
          nextOutlineContentState = hasPlanningContent(assist.outlineBody, false) ? "ai_written" : "empty"
          await this.dependencies.chapterSynopsis.recordPlanningArtifactState({
            projectId: input.projectId,
            chapterSequence: session.chapterSequence,
            kind: "outline",
            state: nextOutlineContentState,
            markdown: assist.outlineBody,
          })
          this.emitDiscussEdit(input.projectId, {
            path: outlinePath,
            kind: "outline",
            status: "completed",
            summary: "已写入剧情细纲",
          })
        }
      } else if (assist.outlineBody !== undefined) {
        writeNotices.push("剧情梗概尚未完成：本轮细纲未落盘，请先补齐剧情梗概。")
        this.emitDiscussEdit(input.projectId, {
          path: outlinePath,
          kind: "outline",
          status: "failed",
          summary: "未落盘：缺少有效剧情梗概",
        })
        runtimeLog("debug", "synopsis-conversation", "outline-blocked-missing-synopsis", {
          projectId: input.projectId,
          sessionId: session.sessionId,
        })
      }

      const wroteOutlineThisTurn = lastOutlineAgentDigest !== undefined
        && lastOutlineAgentDigest !== session.lastOutlineAgentDigest
      if (synopsisReadyForOutline && wroteSynopsisBody && (batchAutomation || autonomousSynopsis)) {
        nextSynopsisConfirmedAtMs = nowMs
        emitProceedProgress("synopsis_discuss", "done")
      } else if (wroteSynopsisBody && !confirmingSynopsis) {
        nextSynopsisConfirmedAtMs = undefined
      }
      if (synopsisReadyForOutline && (confirmingSynopsis || ((batchAutomation || autonomousSynopsis) && wroteSynopsisBody))) {
        nextSynopsisConfirmedAtMs = nextSynopsisConfirmedAtMs ?? nowMs
      }
      if (wroteSynopsisBody) {
        emitProceedProgress("synopsis_discuss", autonomousSynopsis || batchAutomation ? "done" : "waiting")
      }
      // Draft services read the persisted gate, including changes made in this turn.
      await this.dependencies.conversation.updateSession({
        sessionId: session.sessionId,
        synopsisPath,
        synopsisConfirmedAtMs: nextSynopsisConfirmedAtMs ?? null,
        updatedAtMs: nowMs,
      })

      if (volumeCleanupFolder !== undefined) {
        await this.tryRemoveEmptyVolumeDirectory(input.workspaceRootRef, volumeCleanupFolder)
      }

      const hasOutlineOnDisk = hasPlanningContent(
        await this.readSynopsisFile(input.workspaceRootRef, outlinePath), false,
      )
      if (
        assist.planningWriteIntent?.outline !== undefined
        && !isCurrentUserFocusChange(assist.focusChange, input.message)
        && synopsisReadyForOutline
        && !hasOutlineOnDisk
      ) {
        writeNotices.push(
          `系统状态：第${String(session.chapterSequence)}章细纲没有收到可保存的结构化内容，文件仍未写入；正文草稿不能越过细纲门禁。`,
        )
      }
      // Every chapter must have a non-empty outline before a draft can be written.
      const bodyWriteAllowed = synopsisReadyForOutline && hasOutlineOnDisk
        && (writeScope?.synopsis === undefined || wroteSynopsisBody)
        && (writeScope?.outline === undefined || savedOutlineThisTurn)
      if (wroteOutlineThisTurn) {
        emitProceedProgress(
          "outline_discuss",
          autonomousOutline || batchAutomation ? "done" : "waiting",
        )
      }
      const mustStopAfterOutline = wroteOutlineThisTurn
        && !autonomousOutline
        && !autonomousDraft
        && !batchAutomation
        && assist.planningWriteIntent?.draft !== "write"
      const blockBodyPipeline = !bodyWriteAllowed || mustStopAfterOutline
      let draftAssist = assist
      if (blockBodyPipeline) {
        if (
          assist.chapterDraftProposal !== undefined
          || (assist.chapterDraftProposals?.length ?? 0) > 0
          || assist.appendedDraft !== undefined
        ) {
          writeNotices.push("请先完成剧情梗概并写入细纲，再开始正文草稿。")
        }
        const {
          chapterDraftProposal: _blockedProposal,
          chapterDraftProposals: _blockedProposals,
          appendedDraft: _blockedAppended,
          continueTurn: _blockedContinue,
          ...assistWithoutBodyWrites
        } = assist
        draftAssist = {
          ...assistWithoutBodyWrites,
          choices: (hasOutlineOnDisk || wroteOutlineThisTurn)
            ? mergeConfirmOutlineChoice(assist.choices)
            : assist.choices,
        }
      } else if (!autonomousDraft && !nextChapterAuto && !batchAutomation) {
        // Keep a requested focus action; the focus gate below distinguishes it from automatic progression.
        const { continueTurn: _stepContinue, ...assistWithoutJump } = assist
        draftAssist = assistWithoutJump
      }

      const assistantMessageId = this.dependencies.createId()
      const draftVolume = extractVolumeFolderNameFromPath(synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
      const deferredDraftSequences: number[] = []
      let draftApply: Awaited<ReturnType<SynopsisConversationService["applyDiscussChapterDraft"]>> =
        draftAssist.chapterDraftProposal === undefined && draftAssist.appendedDraft !== undefined
          ? { appended: draftAssist.appendedDraft }
          : await this.applyDiscussChapterDraft({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            chapterSequence: session.chapterSequence,
            volumeFolderName: draftVolume,
            ...(draftAssist.chapterDraftProposal === undefined ? {} : { proposal: draftAssist.chapterDraftProposal }),
            messageId: assistantMessageId,
          })
      if (draftApply.notice !== undefined) writeNotices.push(draftApply.notice)
      let draftSaveBlocked = draftApply.blocked === true
      if (draftApply.deferredSequence !== undefined) deferredDraftSequences.push(draftApply.deferredSequence)
      if (draftAssist.chapterDraftProposals !== undefined) {
        for (const entry of draftAssist.chapterDraftProposals) {
          const applied = await this.applyDiscussChapterDraft({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            chapterSequence: entry.chapterSequence,
            volumeFolderName: draftVolume,
            proposal: {
              base: entry.base,
              heading: entry.heading,
              body: entry.body,
              ...(entry.baseDraftVersionId === undefined ? {} : { baseDraftVersionId: entry.baseDraftVersionId }),
            },
            messageId: assistantMessageId,
          })
          if (applied.notice !== undefined) writeNotices.push(applied.notice)
          draftSaveBlocked ||= applied.blocked === true
          if (applied.deferredSequence !== undefined) deferredDraftSequences.push(applied.deferredSequence)
          if (entry.chapterSequence === session.chapterSequence
            && (applied.appended !== undefined || (applied.unchanged === true && draftApply.appended === undefined))) {
            draftApply = applied
          }
        }
      }
      if (deferredDraftSequences.length > 0) {
        const nextSequence = await this.dependencies.chapters.nextChapterSequence(input.projectId)
        this.applyChapterSequenceTodoGate(
          input.projectId,
          session.sessionId,
          nextSequence,
          deferredDraftSequences,
        )
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: session.sessionId,
          projectId: input.projectId,
          createdAtMs: this.dependencies.now(),
          messages: [{
            role: "system",
            kind: "phase_instruction",
            content: JSON.stringify({
              protocol: "discuss-gate-v1",
              gate: "chapter_sequence_publish",
              nextSequence,
              deferredSequences: deferredDraftSequences,
              message: discussChapterSequenceGateHint(nextSequence, deferredDraftSequences),
            }),
          }],
        })
        runtimeLog("info", "synopsis-conversation", "chapter_sequence.gate_applied", {
          projectId: input.projectId,
          sessionId: session.sessionId,
          nextSequence,
          deferredSequences: deferredDraftSequences,
        })
      }
      if (
        assist.planningWriteIntent?.draft === "write"
        && !isCurrentUserFocusChange(assist.focusChange, input.message)
        && draftApply.appended === undefined
        && draftApply.unchanged !== true
        && !assist.content.includes("没有写入草稿版本")
      ) {
        writeNotices.push(
          `系统状态：第${String(session.chapterSequence)}章草稿未落入草稿版本（${draftApply.notice ?? "未收到可保存的完整正文"}）。正式正文未变更。`,
        )
      }
      let appliedFocusSequence: number | undefined
      let focusGateDeferred = false
      if (draftSaveBlocked) {
        writeNotices.push("草稿保存失败，已暂停自动推进；请先处理上述阻塞原因，再重试当前步骤。")
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: session.sessionId,
          projectId: input.projectId,
          createdAtMs: this.dependencies.now(),
          messages: [{ role: "system", kind: "phase_instruction", content: JSON.stringify({
            protocol: "discuss-gate-v1",
            gate: "draft_save_failed",
            message: writeNotices.join("\n"),
          }) }],
        })
      }
      if (!draftSaveBlocked && draftAssist.focusChange !== undefined) {
        if (agentMode === "plan") {
          writeNotices.push("当前是 Plan 模式，本轮不修改章节焦点。")
        } else if (focusLocked) {
          writeNotices.push("当前入口已锁定焦点，本轮 focusChange 未生效。")
        } else if (batchAutomation) {
          writeNotices.push("批量推演中焦点由系统推进，本轮 focusChange 未生效。")
        } else if (
          draftAssist.focusChange.chapterSequence !== session.chapterSequence
          && !nextChapterAuto
          && !isCurrentUserFocusChange(draftAssist.focusChange, input.message)
        ) {
          writeNotices.push("当前推进模式不允许自动换章，且本轮未提供用户换章指令依据，焦点保持不变。用户明确要求换章时可直接执行。")
        } else {
          const targetSequence = draftAssist.focusChange.chapterSequence
          const nextSequence = await this.waitForChapterSequenceGate(input.projectId, targetSequence)
          if (targetSequence > nextSequence) {
            focusGateDeferred = true
            this.applyChapterSequenceTodoGate(input.projectId, session.sessionId, nextSequence, [targetSequence])
            writeNotices.push(
              `门禁：第${String(nextSequence)}章尚未完成图修订发布，焦点暂留；完成后将自动继续推进到第${String(targetSequence)}章。`,
            )
          } else {
            try {
              await this.setFocus({
                projectId: input.projectId,
                workspaceRootRef: input.workspaceRootRef,
                chapterSequence: targetSequence,
                focusKind: draftAssist.focusChange.focusKind ?? "plot_synopsis",
                 enterVolumeRevision: isCurrentUserFocusChange(draftAssist.focusChange, input.message) && draftAssist.continueTurn === true,
              })
              appliedFocusSequence = targetSequence
              writeNotices.push(`已将讨论焦点调整到第 ${String(targetSequence)} 章（无需确认）。`)
            } catch (error) {
              if (!isPrecedingChapterPublishGateError(error)) throw error
              focusGateDeferred = true
              writeNotices.push(`门禁：前一章尚未发布，焦点暂留；完成后将自动继续推进到第${String(targetSequence)}章。`)
            }
          }
        }
      }
      const gateDeferred = !focusLocked && (focusGateDeferred || deferredDraftSequences.length > 0)
      const workflowChoices = filterDiscussChoices(
        (draftAssist.choices ?? (wroteSynopsisBody && !hasOutlineOnDisk && writeScope?.outline === undefined
          && scopedComposeIntent(writeScope) !== undefined
          ? [{ label: "用这份梗概写细纲", action: "confirm_synopsis" as const }]
          : undefined))?.filter((choice) => choice.action !== "promote_draft_to_body"),
        {
          focusLocked,
          synopsisReady: synopsisReadyForOutline,
          synopsisConfirmed,
          outlineReady: hasOutlineOnDisk,
          offerSynopsisConfirmation: !autonomousSynopsis
            && !batchAutomation
            && !volumePlanningNeedsFirstWrite
            && !volumeStoryNeedsUser
            && !coldStartStyleNeedsChoice
            && !hasOutlineOnDisk
            && !confirmingSynopsis,
          ...(appliedFocusSequence === undefined ? {} : { appliedFocusSequence }),
        },
      )
      const planningChoices = volumePlanningNeedsFirstWrite
        ? workflowChoices?.filter((choice) => ![
            "confirm_synopsis", "confirm_arc_plan", "set_focus", "start_turn", "promote_draft_to_body",
          ].includes(choice.action))
        : workflowChoices
      let persistedChoices: SynopsisConversationChoice[] | undefined = draftSaveBlocked
        ? [
            { label: "检查当前章节规划与阻塞原因", action: "continue_discuss" as const },
            { label: "修复阻塞后重试保存草稿", action: "continue_discuss" as const },
          ]
        : coldStartStyleNeedsChoice
        ? assist.choices ?? []
        : volumePlanningNeedsFirstWrite
        ? planningChoices ?? buildFallbackDiscussChoices({
            volumePlanningNeedsFirstWrite,
            volumeFolderName: nextVolume,
          })
        : !synopsisReadyForOutline && workflowChoices === undefined
        ? [{ label: "先完成剧情梗概", action: "continue_discuss" as const }]
        : workflowChoices ?? buildFallbackDiscussChoices({
            volumePlanningNeedsFirstWrite,
            volumeFolderName: nextVolume,
          })
      const todosStillOpen = !discussTodosAreSettled(
        synopsisConversationStreamHub.peek(input.projectId, session.sessionId).todos,
      )
      const offeredChoices = persistedChoices ?? []
      const waitingOnUser = (coldStartStyleNeedsChoice || volumeStoryNeedsUser || !withinChapterAuto) && offeredChoices.length > 0

      let assistantContent = volumePlanningNeedsFirstWrite && workStyleGateReadyAtStart
        ? buildVolumeFirstWriteGateReply(volumePlanningState, nextVolume, volumePlanningWasReady && !volumeStoryNeedsUser)
        : writeNotices.length === 0
          ? assist.content
          : `${assist.content}\n\n——\n${writeNotices.join("\n")}`
      if (isSynopsisSendCancelled(input.projectId)) {
        throw new SynopsisSendCancelledError()
      }
      if (assist.stagingDelta !== undefined) {
        const stagingPaths = await this.applyStagingDelta({
          workspaceRootRef: input.workspaceRootRef,
          delta: assist.stagingDelta,
          sourceMessageId: assistantMessageId,
        })
        for (const path of stagingPaths) {
          this.emitDiscussEdit(input.projectId, {
            path,
            kind: "staging",
            status: "completed",
            summary: "已更新暂存区草稿",
          })
        }
      }
      if (assist.arcPlanMarkdown !== undefined) {
        if (!volumePlanningMarkdownHasContent(assist.arcPlanMarkdown)) throw new SynopsisInvalidStateError("卷大纲没有有效内容，不能推进首次写入状态")
        this.emitDiscussEdit(input.projectId, {
          path: ARC_PLAN_STAGING_PATH,
          kind: "arc_plan",
          status: "running",
          summary: "正在写入弧线规划",
        })
        await this.dependencies.workspace.saveUserMarkdown(
          input.workspaceRootRef,
          ARC_PLAN_STAGING_PATH,
          assist.arcPlanMarkdown,
        )
        this.emitDiscussEdit(input.projectId, {
          path: ARC_PLAN_STAGING_PATH,
          kind: "arc_plan",
          status: "completed",
          summary: "已写入弧线规划",
        })
        const volumeOutlinePath = volumeOutlinePlanPath(nextVolume)
        this.emitDiscussEdit(input.projectId, {
          path: volumeOutlinePath,
          kind: "arc_plan",
          status: "running",
          summary: "正在写入卷大纲",
        })
        await this.dependencies.workspace.saveUserMarkdown(
          input.workspaceRootRef,
          volumeOutlinePath,
          assist.arcPlanMarkdown,
        )
        if (volumePlanningState !== undefined) {
          volumePlanningState = incrementVolumePlanningWriteCount(volumePlanningState, "outline")
          await this.saveVolumePlanningState(input.workspaceRootRef, volumePlanningState)
        }
        this.emitDiscussEdit(input.projectId, {
          path: volumeOutlinePath,
          kind: "arc_plan",
          status: "completed",
          summary: "已写入卷大纲",
        })
      }
      if (assist.volumeSynopsisMarkdown !== undefined) {
        if (!volumePlanningMarkdownHasContent(assist.volumeSynopsisMarkdown)) throw new SynopsisInvalidStateError("卷梗概没有有效内容，不能推进首次写入状态")
        const volumeSynopsisPath = `大纲/${nextVolume}.梗概.md`
        await this.dependencies.workspace.saveUserMarkdown(
          input.workspaceRootRef,
          volumeSynopsisPath,
          assist.volumeSynopsisMarkdown,
        )
        if (volumePlanningState !== undefined) {
          volumePlanningState = incrementVolumePlanningWriteCount(volumePlanningState, "synopsis")
          await this.saveVolumePlanningState(input.workspaceRootRef, volumePlanningState)
        }
        this.emitDiscussEdit(input.projectId, {
          path: volumeSynopsisPath,
          kind: "arc_plan",
          status: "completed",
          summary: "已写入卷梗概",
        })
      }
      if (volumePlanningNeedsFirstWrite && workStyleGateReadyAtStart) {
        const ready = !volumeStoryNeedsUser && (await this.readVolumePlanningContext(input.workspaceRootRef, nextVolume, volumePlanningState)).ready
        assistantContent = buildVolumeFirstWriteGateReply(volumePlanningState, nextVolume, ready)
      }
      if (assist.presentationWrites !== undefined && assist.presentationWrites.length > 0) {
        for (const write of assist.presentationWrites) {
          this.emitDiscussEdit(input.projectId, {
            path: write.relativePath,
            kind: "presentation",
            status: "running",
            summary: `${write.mode === "create" ? "正在新建" : "正在更新"}表现规则`,
          })
        }
        await this.applyPresentationWrites({
          workspaceRootRef: input.workspaceRootRef,
          writes: assist.presentationWrites,
        })
        if (assist.presentationWrites.some((write) => (
          write.relativePath.replaceAll("\\", "/").replace(/^\.\//u, "") === WORK_STYLE_RULE_PATH
        ))) {
          const savedStyle = await this.dependencies.workspace.readMarkdown(
            input.workspaceRootRef,
            WORK_STYLE_RULE_PATH,
          )
          if (styleGateState.status === "style_selected") {
            styleGateState = await this.dependencies.conversation.transitionWorkStyleGate({
              projectId: input.projectId,
              event: { type: "style_document_saved", markdown: savedStyle, digest: digest(savedStyle) },
              updatedAtMs: this.dependencies.now(),
            })
          } else if (styleGateState.status === "ready") {
            styleGateState = await this.dependencies.conversation.transitionWorkStyleGate({
              projectId: input.projectId,
              event: {
                type: "style_document_changed",
                currentDigest: digest(savedStyle),
                markdown: savedStyle,
              },
              updatedAtMs: this.dependencies.now(),
            })
          }
        }
        for (const write of assist.presentationWrites) {
          this.emitDiscussEdit(input.projectId, {
            path: write.relativePath,
            kind: "presentation",
            status: "completed",
            summary: `${write.mode} ${write.relativePath}`,
          })
        }
      }
      if (canProceedPastWorkStyleGate(styleGateState)) {
        coldStartStyleNeedsChoice = false
      }
      const creationDeskSettings = {
        ...requestedCreationDeskSettings,
        ...(!workStyleGateReadyAtStart && styleGateState.status === "ready"
          ? {
              proseStyleRulePath: styleGateState.selectedProseStylePath,
              novelMajorCategoryRulePath: styleGateState.novelMajorCategoryRulePath,
              novelSubcategoryRulePath: styleGateState.novelSubcategoryRulePath,
            }
          : {}),
      }
      if (Object.keys(creationDeskSettings).length > 0 && rejectedCreationDeskRulePaths.length === 0) {
        assistantContent += "\n\n创作台写作设置已同步，可在「写作设置」中继续调整。"
      } else if (Object.keys(creationDeskSettings).length > 0) {
        assistantContent += `\n\n创作台写作设置已部分同步；未应用规则路径：${rejectedCreationDeskRulePaths.join("、")}。`
      } else if (rejectedCreationDeskRulePaths.length > 0) {
        assistantContent += `\n\n创作台规则未切换，以下路径不存在或不可用：${rejectedCreationDeskRulePaths.join("、")}。`
      }
      const styleSelectionCompleted = !workStyleGateReadyAtStart
        && styleGateState.status === "ready"
      const volumePlanningCompletedThisTurn = volumePlanningNeedsFirstWrite
        && !volumeStoryNeedsUser
        && (await this.readVolumePlanningContext(input.workspaceRootRef, nextVolume, volumePlanningState)).ready
      const savedDraft = draftApply.appended
      const savedDraftPublished = savedDraft !== undefined && this.dependencies.revisions !== undefined
        && (await this.dependencies.revisions.readRevision(savedDraft.revisionTaskId)).status === "completed"
      const synopsisProgressCompleted = wroteSynopsisBody && synopsisReadyForOutline
      const outlineProgressCompleted = wroteOutlineThisTurn && hasOutlineOnDisk
      // Restage clears session draft pointers; do not keep turn-start draftReady which would
      // pin the bar on 草稿 after a synopsis/outline rewrite.
      const draftReadyAfterTurn = savedDraft !== undefined
        || (draftReadyAtStart && !restagedToSynopsisThisTurn && !restagedToOutlineThisTurn)
      const chapterPublishedAfterTurn = savedDraftPublished || chapterPublishedAtStart
      const pipelineStageAfterTurn = resolveDiscussPipelineStage({
        synopsisReady: synopsisReadyForOutline,
        outlineReady: hasOutlineOnDisk && !restagedToSynopsisThisTurn,
        draftReady: draftReadyAfterTurn,
        ...(chapterPublishedAfterTurn ? { chapterPublished: true } : {}),
      })
      // Prefer materials sync after restage so list/send agree; otherwise emit from turn flags.
      const proceedProgressAfterTurn = (restagedToSynopsisThisTurn || restagedToOutlineThisTurn)
        ? await this.syncProceedProgressFromMaterials({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            session: (await this.dependencies.conversation.findSession(session.sessionId))
              ?? session,
            proceedMode,
            ...(customGates === undefined ? {} : { customProceedGates: customGates }),
          })
        : undefined
      if (proceedProgressAfterTurn === undefined) {
        emitProceedProgress(
          pipelineStageAfterTurn,
          stageAuto(pipelineStageAfterTurn) ? "running" : "waiting",
        )
      }
      // 构思 is atomic: once synopsis/outline are being written in this turn, the
      // host must continue to the draft even in precise/custom-stop modes. The
      // group gate only decides whether to continue after the draft is saved.
      const composeFlowActive = wroteSynopsisBody || wroteOutlineThisTurn || savedDraft !== undefined
      const composeFlowAuto = composeFlowActive
        && (pipelineStageAfterTurn === "synopsis_discuss" || pipelineStageAfterTurn === "outline_discuss")
      const currentStageAutonomous = stageAuto(pipelineStageAfterTurn) || composeFlowAuto
      const autoContinuePipelineActive = pipelineAuto || composeFlowAuto
      const materialIngestThisTurn = wroteSynopsisBody || wroteOutlineThisTurn || savedDraft !== undefined
        || savedDraftPublished
        || styleSelectionCompleted
        || volumePlanningCompletedThisTurn
      const userRequestedFocusTransition = isCurrentUserFocusChange(assist.focusChange, input.message)
        && assist.focusChange?.chapterSequence !== session.chapterSequence
      const continueRequestedFocusTask = userRequestedFocusTransition
        && appliedFocusSequence !== undefined && assist.continueTurn === true
      // Proceed continues only on 入库 / setup events, or within-stage auto discussion —
      // never by treating a bare discuss turn as "advance to next unfinished material".
      const shouldAutoContinue = discussResult.autoContinueBlocked !== true
        && !draftSaveBlocked
        && agentMode !== "plan" && !batchAutomation && !coldStartStyleNeedsChoice
        && (
          styleSelectionCompleted
          || volumeStoryNeedsUser
          || continueRequestedFocusTask
          || (gateDeferred && !userRequestedFocusTransition)
           || (autoContinuePipelineActive && materialIngestThisTurn && (
            styleSelectionCompleted
            || volumePlanningCompletedThisTurn
             || ((writeScope === undefined || writeScope.advance === true)
               && (synopsisProgressCompleted || outlineProgressCompleted || savedDraftPublished))
          ))
          // In-stage auto-continue only while todos remain open — not on bare
          // continueTurn / choice-capable stages (those felt like forced 推进).
           || ((writeScope === undefined || writeScope.advance === true)
             && autoContinuePipelineActive && currentStageAutonomous && !waitingOnUser && todosStillOpen)
        )
      const stayInStageContinueMessage = buildStayInStageContinueMessage(pipelineStageAfterTurn)
      const autoContinueMessage = !shouldAutoContinue || (savedDraftPublished && !nextChapterAuto)
        ? undefined
        : continueRequestedFocusTask
          ? renderRuntimePrompt("discuss-messages", "focus-changed-resume", {
              focusSequence: String(appliedFocusSequence), userMessage: input.message,
            })
          : styleSelectionCompleted
            ? renderRuntimePrompt("discuss-messages", "style-approved")
            : volumeStoryNeedsUser
              ? renderRuntimePrompt("discuss-messages", "volume-story-required")
            : volumePlanningCompletedThisTurn
              ? renderRuntimePrompt("discuss-messages", "volume-planning-complete")
              : savedDraftPublished && nextChapterAuto
                ? appliedFocusSequence !== undefined && appliedFocusSequence !== session.chapterSequence
                  ? renderRuntimePrompt("discuss-messages", "published-focus-changed", { chapterSequence: session.chapterSequence, focusSequence: appliedFocusSequence })
                  : renderRuntimePrompt("discuss-messages", "published-advance", { chapterSequence: session.chapterSequence, nextSequence: session.chapterSequence + 1 })
              : savedDraft !== undefined
                ? renderRuntimePrompt("discuss-messages", "draft-saved", { draftLabel: savedDraft.draftLabel })
                : synopsisProgressCompleted
                  ? renderRuntimePrompt("discuss-messages", "synopsis-saved", { chapterSequence: session.chapterSequence })
                  : outlineProgressCompleted
                    ? renderRuntimePrompt("discuss-messages", "outline-saved", { chapterSequence: session.chapterSequence })
                    : stayInStageContinueMessage
      let autoContinue: { message: string } | undefined = autoContinueMessage === undefined
        ? undefined
        : { message: autoContinueMessage }
      const publishableDraft = batchAutomation || savedDraft === undefined
        ? undefined
        : await this.findPublishableFocusDraft(input.projectId, session.chapterSequence)
      if (publishableDraft !== undefined && publishableDraft.draftVersionId === savedDraft?.draftVersionId) {
        persistedChoices = withDraftConfirmationChoice(persistedChoices, publishableDraft)
        if (!assistantContent.includes(DRAFT_PUBLISH_CONFIRMATION)) {
          assistantContent += "\n\n草稿已经写好。请确认「草稿可以，发布正文」；确认后会自动完成设定抽取、图治理并落入正文，中间不再询问。"
        }
        // Stay on draft_discuss until the user starts 章节入库 (publish confirm).
        emitProceedProgress("draft_discuss", "waiting")
        autoContinue = undefined
      } else if (savedDraft === undefined && autoContinue === undefined && appliedFocusSequence === undefined) {
        if (restagedToSynopsisThisTurn || (wroteSynopsisBody && synopsisReadyForOutline && !hasOutlineOnDisk)) {
          // Rewrite restage / synopsis-only materials: pin「当前」on 梗概 (status done = stage complete for gate text).
          emitProceedProgress("synopsis_discuss", "done")
        } else if (restagedToOutlineThisTurn || savedOutlineThisTurn) {
          emitProceedProgress("outline_discuss", "done")
        }
      }
      if (pipelineAuto) {
        const fingerprint = await this.readDiscussProgressFingerprint({
          projectId: input.projectId, workspaceRootRef: input.workspaceRootRef,
          chapterSequence: appliedFocusSequence ?? session.chapterSequence,
          draftVersionId: draftApply.appended?.draftVersionId ?? session.draftVersionId,
          styleStatus: styleGateState.status,
        })
        const progress = measureDiscussProgress(
          await this.dependencies.conversation.listDiscussContextMessages(session.sessionId), fingerprint,
          initialProgressFingerprint ?? fingerprint,
        )
        const noProgressGuardEnabled = input.noProgressGuardEnabled === true
        const noProgressGuardLimit = resolveDiscussNoProgressGuardLimit(input.noProgressGuardLimit)
        const progressExhausted = noProgressGuardEnabled
          && autoContinue !== undefined
          && progress.consecutiveNoProgressTurns >= noProgressGuardLimit
        if (progressExhausted) {
          runtimeLog("warn", "synopsis-conversation", "discuss.no_progress_stop", {
            projectId: input.projectId, sessionId: session.sessionId,
            consecutiveNoProgressTurns: progress.consecutiveNoProgressTurns,
            noProgressGuardLimit,
          })
        }
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: session.sessionId, projectId: input.projectId, createdAtMs: this.dependencies.now(),
          messages: [{ role: "system", kind: "phase_instruction", content: JSON.stringify({
            protocol: DISCUSS_PROGRESS_PROTOCOL, fingerprint,
            consecutiveNoProgressTurns: progress.consecutiveNoProgressTurns,
          }) }],
        })
        if (progress.obsoleteMessageIds.length > 0) {
          await this.dependencies.conversation.hideDiscussContextMessages(
            session.sessionId, progress.obsoleteMessageIds, this.dependencies.now(),
          )
        }
        if (progressExhausted) {
          throw new SynopsisInvalidStateError(
            `当前步骤连续 ${String(noProgressGuardLimit)} 次没有实际内容进展，已停止自动推进。已有内容和待办已保留，请检查阻塞原因。`,
          )
        }
      }
      const { workDisplayName, workDescription } = await this.applyWorkMetadata(assist)
      if (volumePlanningGateWasReady && writeScope !== undefined && appliedFocusSequence === undefined) {
        const writes = [
          ["synopsis", "梗概", writeScope.synopsis !== undefined, wroteSynopsisBody],
          ["outline", "细纲", writeScope.outline !== undefined, savedOutlineThisTurn],
          ["draft", "草稿", writeScope.draft === "write" && writeScope.volumeDrafts !== true,
            savedDraft !== undefined || draftApply.unchanged === true],
        ] as const
        const recorded = synopsisConversationStreamHub.peek(input.projectId, session.sessionId).todos
        const hostTodos = writes.flatMap(([key, label, requested, saved]) => {
          if (!requested) return []
          const id = `host-write-${key}`
          if (saved && !recorded.some((todo) => todo.id === id)) return []
          const content = key === "draft" && draftApply.unchanged === true
            ? "草稿内容相同，沿用现有版本"
            : `${saved ? "已保存" : "待实际保存"}${label}`
          return [{ id, content, status: saved ? "completed" as const : "pending" as const }]
        })
        if (hostTodos.length > 0) {
          synopsisConversationStreamHub.setTodos(input.projectId, hostTodos, this.dependencies.now(), { merge: true })
        }
        if (hostTodos.some((todo) => todo.status === "pending")) autoContinue = undefined
      }
      const streamPeek = synopsisConversationStreamHub.peek(input.projectId, session.sessionId)
      const persistedThinking = normalizeThinkingDisplayText(
        assist.reasoningContent ?? (streamPeek.thinking.length === 0 ? undefined : streamPeek.thinking),
      )
      await this.dependencies.conversation.appendMessage({
        messageId: assistantMessageId,
        projectId: input.projectId,
        sessionId: session.sessionId,
        role: "assistant",
        content: assistantContent,
        ...(persistedThinking === undefined ? {} : { reasoningContent: persistedThinking }),
        ...(streamPeek.thinkingRounds.length === 0 ? {} : { thinkingRounds: streamPeek.thinkingRounds }),
        ...(streamPeek.searching.length === 0 ? {} : { searching: streamPeek.searching }),
        ...(streamPeek.editing.length === 0 ? {} : { editing: streamPeek.editing }),
        ...(streamPeek.toolRuns.length === 0 ? {} : { toolRuns: streamPeek.toolRuns }),
        ...(streamPeek.todos.length === 0 ? {} : { todos: streamPeek.todos }),
        ...(persistedChoices === undefined ? {} : { choices: persistedChoices }),
        createdAtMs: nowMs + 1,
      })
      const createdProposals = assist.goalProposals === undefined || assist.goalProposals.length === 0
        ? []
        : await this.dependencies.goals.createProposalsFromArtifact({
            projectId: input.projectId,
            proposals: assist.goalProposals,
            sourceMessageId: assistantMessageId,
          })
      const projectSettings = this.dependencies.readProjectSettings === undefined
        ? undefined
        : await this.dependencies.readProjectSettings()
      const autoApproveGoals = projectSettings?.creationDesk.autoApproveGoalProposals !== false
      let pendingProposals = createdProposals
      if (autoApproveGoals && createdProposals.length > 0) {
        const { failed } = await this.dependencies.goals.approveProposalsLenient({
          projectId: input.projectId,
          proposalIds: createdProposals.map((proposal) => proposal.proposalId),
        })
        const failedIds = new Set(failed.map((item) => item.proposalId))
        pendingProposals = createdProposals.filter((proposal) => failedIds.has(proposal.proposalId))
        if (failed.length > 0) {
          runtimeLog("warn", "synopsis-conversation", "goal_proposals.kept_pending", {
            projectId: input.projectId,
            failed: failed.map((item) => item.message),
          })
        }
      }
      let pendingStagingPromotes = assist.stagingPromote === undefined
        ? []
        : [await this.dependencies.stagingPromote.createFromArtifact({
            projectId: input.projectId,
            sessionId: session.sessionId,
            sourceMessageId: assistantMessageId,
            settingsWrites: assist.stagingPromote.settingsWrites,
            ...(assist.stagingPromote.goalProposals === undefined
              ? {}
              : { goalProposals: assist.stagingPromote.goalProposals }),
            ...(assist.stagingPromote.reason === undefined ? {} : { reason: assist.stagingPromote.reason }),
          })]
      const { shouldAutoApproveStagingPromote } = await import("./discuss-write-permission.js")
      // full permission (default): apply like Cursor/Codex Agent. settings_write_confirm: wait for 确认落盘.
      if (shouldAutoApproveStagingPromote(writePermissionMode) && pendingStagingPromotes.length > 0) {
        try {
          await this.dependencies.stagingPromote.approve({
            projectId: input.projectId,
            workspaceRootRef: input.workspaceRootRef,
            proposalIds: pendingStagingPromotes.map((proposal) => proposal.proposalId),
          })
          pendingStagingPromotes = []
          if (persistedChoices !== undefined) {
            persistedChoices = persistedChoices.filter((choice) => choice.action !== "promote_staging")
            if (persistedChoices.length === 0) persistedChoices = undefined
          }
          if (!assistantContent.includes("设定已写入") && !assistantContent.includes("已落盘到设定集")) {
            assistantContent += "\n\n设定集已按完全权限直接写入（无需再点确认落盘）。"
          }
        } catch (error) {
          runtimeLog("warn", "synopsis-conversation", "staging_promote.auto_approve_failed", {
            projectId: input.projectId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      // Digests/title still belong to the chapter this turn wrote; focusChange already
      // moved session.chapterSequence via setFocus — only patch digests when focus stayed.
      if (appliedFocusSequence === undefined) {
        await this.dependencies.conversation.updateSession({
          sessionId: session.sessionId,
          synopsisPath,
          title: sessionTitle,
          ...(lastAgentDigest === undefined ? {} : { lastAgentDigest }),
          ...(lastOutlineAgentDigest === undefined ? {} : { lastOutlineAgentDigest }),
          synopsisContentState: nextSynopsisContentState,
          outlineContentState: nextOutlineContentState,
          ...(draftApply.appended === undefined
            ? {}
            : {
                draftContentState: "ai_written",
                draftVersionId: draftApply.appended.draftVersionId,
              }),
          synopsisConfirmedAtMs: nextSynopsisConfirmedAtMs === undefined ? null : nextSynopsisConfirmedAtMs,
          updatedAtMs: nowMs + 1,
        })
      } else if (lastAgentDigest !== undefined || lastOutlineAgentDigest !== undefined) {
        // Focus moved: keep new focus paths from setFocus; do not overwrite with old chapter digests.
      }
      const updatedSession = (await this.dependencies.conversation.findSession(session.sessionId)) as NonNullable<Awaited<ReturnType<SqliteSynopsisConversationRepository["findSession"]>>>
      // Authoritative bar: always re-derive from disk after writes/restage so
      // 梗概→细纲→草稿→正文确认 tracks materials, not mid-turn emit races.
      let proceedProgress = await this.syncProceedProgressFromMaterials({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        session: updatedSession,
        proceedMode,
        ...(customGates === undefined ? {} : { customProceedGates: customGates }),
      })
      if (proceedProgress.stage === "synopsis_discuss" && (wroteSynopsisBody || restagedToSynopsisThisTurn)) {
        proceedProgress = { stage: "synopsis_discuss", status: "done" }
        emitProceedProgress("synopsis_discuss", "done")
      } else if (proceedProgress.stage === "outline_discuss" && (savedOutlineThisTurn || restagedToOutlineThisTurn)) {
        proceedProgress = { stage: "outline_discuss", status: "done" }
        emitProceedProgress("outline_discuss", "done")
      } else if (proceedProgress.stage === "draft_discuss" && savedDraft !== undefined) {
        proceedProgress = { stage: "draft_discuss", status: "waiting" }
        emitProceedProgress("draft_discuss", "waiting")
      } else if (proceedProgress.stage === "body_discuss") {
        proceedProgress = { stage: "body_discuss", status: "waiting" }
        emitProceedProgress("body_discuss", "waiting")
      }
      const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
      synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
        thinking: assist.reasoningContent ?? streamPeek.thinking,
        content: assistantContent,
      })
      // Drop completed thinking/content so the next send cannot briefly re-show this turn.
      // Cumulative usage is retained for composer metrics (and persisted below).
      const usage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
      synopsisConversationStreamHub.clear(input.projectId)
      if (usage !== undefined) {
        await this.dependencies.conversation.saveDiscussUsage({
          projectId: input.projectId,
          usage,
          updatedAtMs: this.dependencies.now(),
        })
      }
      const budgetAdvisory = assist.budgetAdvisory ?? peekSynopsisModelBudgetAdvisory(input.projectId)
      return {
        session: await this.withVolumeLifecycle(input.workspaceRootRef, updatedSession),
        messages: [...messages],
        ...(volumePlanningNeedsFirstWrite && workStyleGateReadyAtStart ? { volumePlanningStage: true } : {}),
        ...(pendingProposals.length === 0 ? {} : { pendingProposals: [...pendingProposals] }),
        ...(pendingStagingPromotes.length === 0
          ? {}
          : { pendingStagingPromotes: [...pendingStagingPromotes] }),
        ...(budgetAdvisory === undefined ? {} : { budgetAdvisory }),
        ...(usage === undefined ? {} : { usage }),
        ...(workDisplayName === undefined ? {} : { workDisplayName }),
        ...(workDescription === undefined ? {} : { workDescription }),
        ...(Object.keys(creationDeskSettings).length === 0 ? {} : { creationDeskSettings }),
        ...(rejectedCreationDeskRulePaths.length === 0 ? {} : { rejectedCreationDeskRulePaths }),
        ...(draftApply.appended === undefined ? {} : { appendedDraft: draftApply.appended }),
        ...(autoContinue === undefined ? {} : { autoContinue }),
        ...(proceedProgress === undefined ? {} : { proceedProgress }),
      }
    } catch (error) {
      const cancelled = error instanceof SynopsisSendCancelledError || isSynopsisSendCancelled(input.projectId)
      const errorLabel = cancelled
        ? "用户停止对话"
        : (error instanceof Error ? error.message : String(error))
      try {
        await this.persistInterruptedAssistantTurn({
          projectId: input.projectId,
          sessionId: session.sessionId,
          errorLabel,
        })
      } catch {
        // Best-effort: never lose the throw path because persistence failed.
      }
      synopsisConversationStreamHub.fail(input.projectId, errorLabel, this.dependencies.now())
      synopsisConversationStreamHub.clear(input.projectId)
      if (cancelled) {
        clearSynopsisSendCancellation(input.projectId)
        throw error instanceof SynopsisSendCancelledError ? error : new SynopsisSendCancelledError()
      }
      throw error
    }
  }

  /**
   * Stop an in-flight / timed-out user turn: cancel the active send, keep the user
   * message, and persist any partial assistant stream so the chat does not go blank.
   */
  public async discardLastUserTurn(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    sessionId?: string
  }>): Promise<SynopsisConversationListResult> {
    markSynopsisSendCancelled(input.projectId)
    const session = input.sessionId === undefined
      ? await this.dependencies.conversation.findActiveSession(input.projectId)
      : await this.dependencies.conversation.findSession(input.sessionId)
    if (session !== undefined && session.projectId === input.projectId) {
      try {
        await this.persistInterruptedAssistantTurn({
          projectId: input.projectId,
          sessionId: session.sessionId,
          errorLabel: "用户停止对话",
        })
      } catch {
        // Best-effort keep of partial reply.
      }
      // Keep discuss model-context turns; only cancel the in-flight send.
    }
    synopsisConversationStreamHub.fail(input.projectId, "用户停止对话", this.dependencies.now())
    synopsisConversationStreamHub.clear(input.projectId)
    return this.list({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
    })
  }

  /** Persist a failed/stopped discuss bubble from the live stream hub (idempotent-ish). */
  private async persistInterruptedAssistantTurn(input: Readonly<{
    projectId: ProjectId
    sessionId: string
    errorLabel: string
  }>): Promise<void> {
    const peek = synopsisConversationStreamHub.peek(input.projectId, input.sessionId)
    if (!streamHasVisibleProgress(peek) && peek.status !== "failed" && peek.status !== "running") {
      // Still record a short bubble so the user turn is not left alone after an early crash.
      if (peek.status === "idle") return
    }
    const existing = await this.dependencies.conversation.listMessages(input.sessionId)
    const last = existing.at(-1)
    if (
      last?.role === "assistant"
      && last.error !== undefined
      && last.error === input.errorLabel
    ) {
      return
    }
    if (!streamHasVisibleProgress(peek) && last?.role === "assistant") {
      return
    }
    const fields = buildInterruptedAssistantMessageFields(
      peek,
      input.errorLabel,
    )
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      role: "assistant",
      content: fields.content,
      ...(fields.reasoningContent === undefined ? {} : { reasoningContent: fields.reasoningContent }),
      ...(fields.thinkingRounds === undefined ? {} : { thinkingRounds: fields.thinkingRounds }),
      ...(fields.searching === undefined ? {} : { searching: fields.searching }),
      ...(fields.editing === undefined ? {} : { editing: fields.editing }),
      ...(fields.toolRuns === undefined ? {} : { toolRuns: fields.toolRuns }),
      ...(fields.todos === undefined ? {} : { todos: fields.todos }),
      error: fields.error,
      createdAtMs: this.dependencies.now(),
    })
  }

  /**
   * Quietly regenerate decision chips: appends hidden context messages, then merges
   * new choices onto the visible assistant message without a new chat bubble.
   */
  public async refreshChoices(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    messageId?: string
    model: AIModelPort
    chapterIntent?: ChapterNarrativeIntent
    presentation?: Readonly<{
      descriptionRulePath?: string | undefined
      proseStyleRulePath?: string | undefined
      novelMajorCategoryRulePath?: string | undefined
      novelSubcategoryRulePath?: string | undefined
      minimumWordCount: number
      maximumWordCount: number
    }>
    maxModelCalls?: number
    deadlineMs?: number
  }>): Promise<SynopsisConversationSendResult> {
    const session = await this.ensureActiveSession(input.projectId, input.workspaceRootRef)
    await this.hydrateDiscussUsage(input.projectId)
    const priorMessages = await this.dependencies.conversation.listMessages(session.sessionId)
    const target = resolveRefreshTargetMessage(priorMessages, input.messageId)
    if (target === undefined) {
      throw new SynopsisInvalidStateError("没有可刷新的选项")
    }
    const existingChoices = target.choices ?? []
    const setupQuestionId = existingChoices.find(choice => choice.setupQuestionId !== undefined)?.setupQuestionId
    let creativeSetup: CreativeSetupState | undefined
    if (setupQuestionId !== undefined) {
      for (const scope of ["protagonist", `volume:${extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME}`]) {
        const state = await this.dependencies.creativeSetup.find(input.projectId, scope)
        if (state?.pendingQuestion?.id === setupQuestionId) creativeSetup = state
      }
      if (creativeSetup === undefined) throw new SynopsisInvalidStateError("该问题已确认或过期，请刷新当前问题的选项")
    }
    const refreshPrompt = buildRefreshChoicesPrompt(existingChoices)
    const synopsisMarkdown = await this.readSynopsisFile(input.workspaceRootRef, session.synopsisPath)
    const synopsisDigest = digest(synopsisMarkdown)
    const userEditedSinceAgent = session.lastAgentDigest !== undefined && session.lastAgentDigest !== synopsisDigest
    const nowMs = this.dependencies.now()
    const goalsSnapshot = await this.dependencies.goals.list(input.projectId)
    const activeGoals = selectGoalsForChapterContext(goalsSnapshot.goals, session.chapterSequence)
    const chapterProgress = goalsSnapshot.progress.filter(
      (item) => item.chapterSequence === session.chapterSequence && item.status !== "superseded",
    )
    const hookScheduleAudit = await this.dependencies.goals.auditHookSchedules(input.projectId)
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: session.sessionId,
      role: "user",
      content: refreshPrompt,
      hidden: true,
      createdAtMs: nowMs,
    })
    const outlinePathForRefresh = siblingPlanningMarkdownPath(session.synopsisPath, "outline")
      ?? deriveOutlineMarkdownPath(
        session.chapterSequence,
        session.title,
        extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
      )
    const outlineMarkdown = await this.readSynopsisFile(input.workspaceRootRef, outlinePathForRefresh)
    const outlineDigest = outlineMarkdown.trim().length === 0 ? undefined : digest(outlineMarkdown)
    const chapterBodyMarkdown = await this.readFocusedCommittedBody(
      input.projectId,
      input.workspaceRootRef,
      session.chapterSequence,
    )
    const userEditedOutlineSinceAgent = session.lastOutlineAgentDigest !== undefined
      && outlineDigest !== undefined
      && session.lastOutlineAgentDigest !== outlineDigest
    const assist = await this.runSynopsisDiscuss({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      sessionId: session.sessionId,
      userMessage: refreshPrompt,
      refreshChoicesOnly: true,
      ...(creativeSetup === undefined ? {} : { creativeSetup }),
      heading: session.title,
      chapterSequence: session.chapterSequence,
      synopsisMarkdown,
      outlineMarkdown,
      ...(chapterBodyMarkdown === undefined ? {} : { chapterBodyMarkdown }),
      ...(outlineDigest === undefined ? {} : { outlineDigest }),
      userEditedSinceAgent,
      userEditedOutlineSinceAgent,
      synopsisConfirmed: session.synopsisConfirmedAtMs !== undefined,
      activeGoals,
      chapterProgress,
      hookScheduleAudit,
      model: input.model,
      ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
      ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
      ...(input.maxModelCalls === undefined ? {} : { maxModelCalls: input.maxModelCalls }),
      ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
    })
    const incoming = (assist.choices ?? []).map(choice => setupQuestionId === undefined ? choice
      : { label: choice.label, action: "continue_discuss" as const, setupQuestionId })
    if (incoming.length === 0) {
      throw new SynopsisInvalidStateError("模型未返回新的选项，请重试刷新")
    }
    const mergedChoices = mergeSynopsisChoices(existingChoices, incoming)
    if (mergedChoices.length === existingChoices.length) {
      throw new SynopsisInvalidStateError("新选项与已有选项重复，请再试一次刷新")
    }
    await this.dependencies.conversation.updateMessageChoices(target.messageId, mergedChoices)
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: session.sessionId,
      role: "assistant",
      content: assist.content.trim().length > 0
        ? assist.content
        : `已追加 ${String(mergedChoices.length - existingChoices.length)} 个新选项。`,
      hidden: true,
      createdAtMs: this.dependencies.now(),
    })
    await this.dependencies.conversation.updateSession({
      sessionId: session.sessionId,
      updatedAtMs: this.dependencies.now(),
    })
    const updatedSession = (await this.dependencies.conversation.findSession(session.sessionId)) as NonNullable<
      Awaited<ReturnType<SqliteSynopsisConversationRepository["findSession"]>>
    >
    const messages = await this.dependencies.conversation.listMessagesForProject(input.projectId)
    const usage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
    if (usage !== undefined) {
      await this.dependencies.conversation.saveDiscussUsage({
        projectId: input.projectId,
        usage,
        updatedAtMs: this.dependencies.now(),
      })
    }
    return {
      session: await this.withVolumeLifecycle(input.workspaceRootRef, updatedSession),
      messages: [...messages],
      ...(usage === undefined ? {} : { usage }),
    }
  }

  public async resolveTurnInput(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    sessionId?: string
  }>): Promise<SynopsisResolveTurnInputResult & { sessionId: string }> {
    const session = input.sessionId === undefined
      ? await this.dependencies.conversation.findActiveSession(input.projectId)
      : await this.dependencies.conversation.findSession(input.sessionId)
    if (session === undefined || session.projectId !== input.projectId) {
      throw new SynopsisInvalidStateError("No active synopsis conversation session")
    }
    const resolved = await this.resolveBootstrapInput(input.workspaceRootRef, session)
    await this.dependencies.conversation.updateSession({
      sessionId: session.sessionId,
      turnBootstrapInput: resolved.userInput,
      updatedAtMs: this.dependencies.now(),
    })
    const deductionGoalBundle = await this.dependencies.goals.buildTurnBundle({
      projectId: input.projectId,
      chapterSequence: resolved.chapterSequence,
    })
    const projectSettings = this.dependencies.readProjectSettings === undefined
      ? undefined
      : await this.dependencies.readProjectSettings()
    const requireCompleteHookSchedules = projectSettings?.creationDesk.requireCompleteHookSchedules !== false
    const reconcile = await this.dependencies.goals.reconcileForTurn({
      projectId: input.projectId,
      chapterSequence: resolved.chapterSequence,
      synopsisMarkdown: resolved.userInput,
      requireCompleteHookSchedules,
    })
    return {
      ...resolved,
      sessionId: session.sessionId,
      deductionGoalBundle,
      reconcile,
    }
  }

  public async prepareBeginTurn(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    sessionId?: string
    acknowledgeWarnings?: boolean
    forceOverride?: boolean
  }>): Promise<Readonly<{
    userInput: string
    sessionId: string
    chapterSequence: number
    source: SynopsisResolveTurnInputResult["source"]
    synopsisPath?: string
    reconcile: NonNullable<SynopsisResolveTurnInputResult["reconcile"]>
  }>> {
    const resolved = await this.resolveTurnInput({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    })
    const reconcile = resolved.reconcile ?? { warnings: [], blocking: [] }
    const hookBlocks = reconcile.blocking.filter((issue) => issue.code === "incomplete_hook_schedule")
    const otherBlocks = reconcile.blocking.filter((issue) => issue.code !== "incomplete_hook_schedule")
    if (hookBlocks.length > 0) {
      throw new SynopsisInvalidStateError(
        `推演清单：钩子时限不完整，无法开始推演——${hookBlocks.map((issue) => issue.message).join("；")}`,
      )
    }
    if (otherBlocks.length > 0 && input.forceOverride !== true) {
      throw new SynopsisInvalidStateError(
        `推演目标与梗概存在冲突，无法开始推演：${otherBlocks.map((issue) => issue.message).join("；")}`,
      )
    }
    return {
      userInput: resolved.userInput,
      sessionId: resolved.sessionId,
      chapterSequence: resolved.chapterSequence,
      source: resolved.source,
      ...(resolved.synopsisPath === undefined ? {} : { synopsisPath: resolved.synopsisPath }),
      reconcile,
    }
  }

  public async readConversationArchive(
    scope: Readonly<{ projectId: ProjectId; sessionId: string }>,
    query: ConversationArchiveQuery,
  ) {
    const offset = query.offset ?? 0
    return query.operation === "search"
      ? this.dependencies.conversation.searchArchivedMessages({
          ...scope, offset, query: query.query ?? "", ...(query.role === undefined ? {} : { role: query.role }),
        })
      : this.dependencies.conversation.readArchivedMessage({ ...scope, offset, messageId: query.messageId })
  }

  private async hydrateDiscussUsage(projectId: ProjectId): Promise<SynopsisConversationStreamUsage | undefined> {
    const inMemory = synopsisConversationStreamHub.readCumulativeUsage(projectId)
    if (inMemory !== undefined) return inMemory
    const stored = await this.dependencies.conversation.loadDiscussUsage(projectId)
    if (stored === undefined) return undefined
    synopsisConversationStreamHub.hydrateCumulativeUsage(projectId, {
      ...(stored.inputTokens === undefined ? {} : { inputTokens: stored.inputTokens }),
      ...(stored.outputTokens === undefined ? {} : { outputTokens: stored.outputTokens }),
      ...(stored.cacheHitInputTokens === undefined ? {} : { cacheHitInputTokens: stored.cacheHitInputTokens }),
      ...(stored.cacheMissInputTokens === undefined ? {} : { cacheMissInputTokens: stored.cacheMissInputTokens }),
      ...(stored.lastRequestInputTokens === undefined
        ? {}
        : { lastRequestInputTokens: stored.lastRequestInputTokens }),
    })
    return stored
  }

  private async ensureActiveSession(projectId: ProjectId, workspaceRootRef: string) {
    const active = await this.dependencies.conversation.findActiveSession(projectId)
    if (active !== undefined) {
      return this.reconcileSessionSynopsisPath(workspaceRootRef, active)
    }
    const started = await this.start({ projectId, workspaceRootRef })
    return started.session
  }

  /**
   * Keep session.synopsisPath aligned with the on-disk file for this chapter sequence.
   * Stale paths (e.g. after title rename) cause UI/path mismatch and ENOENT on unlink.
   */
  private async reconcileSessionSynopsisPath(
    workspaceRootRef: string,
    session: NonNullable<Awaited<ReturnType<SqliteSynopsisConversationRepository["findSession"]>>>,
  ) {
    const claimed = await this.findExistingSynopsisForSequence(workspaceRootRef, session.chapterSequence)
    const pathStillValid = claimed === undefined
      ? await this.synopsisFileExists(workspaceRootRef, session.synopsisPath)
      : false
    const nextPath = claimed?.path
      ?? (pathStillValid ? session.synopsisPath : undefined)
    if (nextPath === undefined) {
      // Recreate placeholder when the session points at a missing file and no claim exists.
      const existingVolumes = await this.dependencies.workspace.listVolumeFolderNames(workspaceRootRef)
      const preferredVolume = pickPreferredVolumeFolderName(existingVolumes) ?? DEFAULT_VOLUME_FOLDER_NAME
      const placeholderPath = deriveSynopsisMarkdownPath(session.chapterSequence, session.title, preferredVolume)
      const placeholder = assembleSynopsisPlaceholderDocument(session.chapterSequence, session.title)
      await this.dependencies.workspace.saveSynopsisMarkdown(workspaceRootRef, placeholderPath, placeholder)
      await this.dependencies.conversation.updateSession({
        sessionId: session.sessionId,
        synopsisPath: placeholderPath,
        updatedAtMs: this.dependencies.now(),
      })
      return (await this.dependencies.conversation.findSession(session.sessionId)) ?? session
    }
    if (nextPath === session.synopsisPath) return session
    await this.dependencies.conversation.updateSession({
      sessionId: session.sessionId,
      synopsisPath: nextPath,
      ...(claimed?.title === undefined ? {} : { title: claimed.title }),
      updatedAtMs: this.dependencies.now(),
    })
    return (await this.dependencies.conversation.findSession(session.sessionId)) ?? {
      ...session,
      synopsisPath: nextPath,
      ...(claimed?.title === undefined ? {} : { title: claimed.title }),
    }
  }

  private async resolveBootstrapInput(
    workspaceRootRef: string,
    session: NonNullable<Awaited<ReturnType<SqliteSynopsisConversationRepository["findSession"]>>>,
  ): Promise<SynopsisResolveTurnInputResult> {
    const outlinePath = siblingPlanningMarkdownPath(session.synopsisPath, "outline")
      ?? deriveOutlineMarkdownPath(
        session.chapterSequence,
        session.title,
        extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
      )
    const outlineMarkdown = await this.readSynopsisFile(workspaceRootRef, outlinePath)
    const synopsisMarkdown = await this.readSynopsisFile(workspaceRootRef, session.synopsisPath)
    if (outlineMarkdown.trim().length > 0) {
      const synopsisAppendix = synopsisMarkdown.trim().length > 0
        ? "\n\n" + renderRuntimePrompt("discuss-messages", "workflow-synopsis-appendix", { synopsis: synopsisMarkdown.trim() }) + "\n"
        : ""
      return {
        chapterSequence: session.chapterSequence,
        userInput: `${outlineMarkdown.trim()}${synopsisAppendix}`,
        source: "outline_file",
        synopsisPath: session.synopsisPath,
      }
    }

    if (synopsisMarkdown.trim().length > 0) {
      return {
        chapterSequence: session.chapterSequence,
        userInput: synopsisMarkdown.trim(),
        source: "synopsis_file",
        synopsisPath: session.synopsisPath,
      }
    }

    const history = await this.dependencies.conversation.searchArchivedMessages({
      projectId: session.projectId, sessionId: session.sessionId, query: "", offset: 0, role: "user",
    })
    if (history.matches.length > 0) {
      return {
        chapterSequence: session.chapterSequence,
        userInput: renderRuntimePrompt("discuss-messages", "workflow-continue-from-archive"),
        source: "conversation",
      }
    }
    if (session.turnBootstrapInput !== undefined && session.turnBootstrapInput.trim().length > 0) {
      return {
        chapterSequence: session.chapterSequence,
        userInput: session.turnBootstrapInput,
        source: "turn_input",
      }
    }
    throw new SynopsisInvalidStateError("梗概/细纲文件与对话均为空，请先讨论剧情梗概后再开始推演")
  }

  private async runSynopsisDiscuss(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    sessionId: string
    userMessage: string
    heading: string
    chapterSequence: number
    synopsisMarkdown: string
    outlineMarkdown: string
    chapterBodyMarkdown?: string
    latestDraftMarkdown?: string
    focusKind?: DiscussFocusKind
    focusLocked?: boolean
    outlineDigest?: string
    userEditedSinceAgent: boolean
    userEditedOutlineSinceAgent: boolean
    synopsisConfirmed?: boolean
    creativeSetup?: CreativeSetupState
    workStyleGate?: Readonly<{
      status: "awaiting_choice" | "style_selected"
      selectedProseStylePath?: string
      novelMajorCategoryRulePath?: string
      novelSubcategoryRulePath?: string
    }>
    /** Injected by ChapterPanel 批量推演. */
    batchAutomation?: boolean
    /** @deprecated Prefer proceedMode. */
    batchProceed?: boolean
    proceedMode?: DiscussProceedMode
    customProceedGates?: DiscussCustomProceedGates
    /** UI「空转停跑保护」；false 时不因 Todo/工具/步骤空转硬停。 */
    noProgressGuardEnabled?: boolean
    noProgressGuardLimit?: number
    activeGoals: readonly DeductionGoal[]
    chapterProgress: readonly Readonly<{ goalId: string; chapterSequence: number; summary: string; status: "planned" | "achieved" | "partial" | "missed" | "superseded" }>[]
    hookScheduleAudit: HookScheduleAudit
    model: AIModelPort
    writeScope?: DiscussTurnWriteScope
    chapterIntent?: ChapterNarrativeIntent
    presentation?: Readonly<{
      descriptionRulePath?: string | undefined
      proseStyleRulePath?: string | undefined
      novelMajorCategoryRulePath?: string | undefined
      novelSubcategoryRulePath?: string | undefined
      minimumWordCount: number
      maximumWordCount: number
    }>
    discussTrigger?: "user" | "turn_handoff"
    allowWorkflowTools?: boolean
    allowChapterWorkflowTools?: boolean
    volumePlanning?: VolumePlanningContext
    agentMode?: import("@starseafolio/contracts").DiscussAgentMode
    writePermissionMode?: import("@starseafolio/contracts").DiscussWritePermissionMode
    signal?: AbortSignal
    maxModelCalls?: number
    deadlineMs?: number
    composeText?: boolean
    refreshChoicesOnly?: boolean
    volumeBoundary?: VolumeBoundaryAction
  }>): Promise<Readonly<{
    content: string
    volumeBoundaryAccepted?: boolean
    protagonistSupplementMarkdown?: string
    protagonistSupplementFields?: Record<string, CharacterFieldValue>
    reasoningContent?: string
    chapterTitle?: string
    titleAlignTarget?: "body" | "planning"
    volumeFolderName?: string
    workDisplayName?: string
    workDescription?: string
    synopsisBody?: string
    planningWriteIntent?: SynopsisDiscussArtifact["planningWriteIntent"]
    outlineBody?: string
    bodyEdits?: Readonly<{
      target: "outline"
      baseDigest?: string
      ops: readonly Readonly<{ oldText: string; newText: string }>[]
    }>
    chapterDraftProposal?: ChapterDraftProposal
    chapterDraftProposals?: readonly ChapterDraftProposalEntry[]
    volumeChapterPlans?: readonly VolumeChapterPlan[]
    volumePlanMeta?: Readonly<{ targetChapterCount?: number | undefined; targetWordCount?: number | undefined; notes?: string | undefined }>
    creationDeskSettings?: CreationDeskSettingsUpdate
    appendedDraft?: NonNullable<SynopsisConversationSendResult["appendedDraft"]>
    focusChange?: Readonly<NonNullable<SynopsisDiscussArtifact["focusChange"]>>
    continueTurn?: boolean
    autoContinueBlocked?: boolean
    choices?: SynopsisConversationSendResult["messages"][number]["choices"]
    goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
    stagingDelta?: Readonly<{
      notes?: readonly StagingEntryPatch[]
      characters?: readonly StagingEntryPatch[]
      worldRules?: readonly StagingEntryPatch[]
      promoteHints?: readonly StagingEntryPatch[]
    }>
    stagingPromote?: Readonly<{
      settingsWrites: readonly Readonly<{
        entryId: string
        relativePath: string
        markdown: string
        readmeEntry?: string
        mode: "create" | "update"
      }>[]
      goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
      reason?: string
    }>
    presentationWrites?: readonly Readonly<{
      relativePath: string
      markdown: string
      mode: "create" | "update"
    }>[]
    arcPlanMarkdown?: string
    volumeSynopsisMarkdown?: string
    availableProseStylePaths?: readonly string[]
    availableDescriptionRulePaths?: readonly string[]
    availableNovelMajorCategoryRulePaths?: readonly string[]
    availableNovelSubcategoryRulePaths?: readonly string[]
    budgetAdvisory?: SynopsisConversationBudgetAdvisory
    }>> {
    const currentWorkDisplayName = await this.dependencies.readDisplayName?.()
    const currentWorkDescription = await this.dependencies.readWorkDescription?.()
    const basePhasePrompt = await this.dependencies.prompts.loadPhase("synopsis_discuss")
    // 写草稿动作：显式 draft=write，或“无 writeScope/允许推进且已有细纲”的既有条件。
    // 同一条件既决定 outline-to-draft 指南，也决定 deslop/dialogue 阶段 skill。
    const shouldAttachDraftGuide = input.writeScope?.draft === "write"
      || ((input.writeScope === undefined || input.writeScope.advance === true) && hasPlanningContent(input.outlineMarkdown, false))
    // 阶段 skill 只作用于本次请求：拼进 phasePrompt，不写进持久 discuss context，
    // 避免每轮把整包 skill 重新落库、把缓存和上下文一起撑大。
    const stageSkillResources = await Promise.all(resolveDiscussStageSkillIds({
      workStyleGateActive: input.workStyleGate !== undefined,
      creativeSetupActive: input.creativeSetup !== undefined,
      writeScope: input.writeScope,
      synopsisMarkdown: input.synopsisMarkdown,
      outlineMarkdown: input.outlineMarkdown,
      draftAction: shouldAttachDraftGuide,
    }).map((skillId) => this.dependencies.prompts.loadSkill(skillId, { includeReferences: false })))
    const stageSkillAppendix = stageSkillResources.length === 0
      ? undefined
      : [
          "# 本轮阶段 Skill（仅本次请求加载）",
          ...stageSkillResources.map((skill) => skill.text),
        ].join("\n\n")
    const intentAppendix = chapterNarrativeIntentPhaseAppendix(input.chapterIntent, "synopsis_discuss")
    const presentationAppendix = chapterPresentationPhaseAppendix(input.presentation, "synopsis_discuss")
    const workStyleGateAppendix = input.workStyleGate === undefined
      ? undefined
      : buildComposeWorkStylePrompt(input.workStyleGate)
    const { discussAgentModePromptAppendix } = await import("./discuss-agent-mode.js")
    const { discussWritePermissionPromptAppendix } = await import("./discuss-write-permission.js")
    const modeAppendix = discussAgentModePromptAppendix(input.agentMode ?? "auto", {
      batchProceed: input.batchProceed === true || input.batchAutomation === true,
      ...(input.proceedMode === undefined ? {} : { proceedMode: input.proceedMode }),
      ...(input.customProceedGates === undefined ? {} : { customProceedGates: input.customProceedGates }),
    })
    const writePermissionAppendix = discussWritePermissionPromptAppendix(input.writePermissionMode)
    const volumePlanningAppendix = buildVolumePlanningPromptAppendix(input.volumePlanning)
    const appendix = [
      intentAppendix,
      presentationAppendix,
      modeAppendix,
      writePermissionAppendix,
      workStyleGateAppendix,
      volumePlanningAppendix,
      input.creativeSetup === undefined ? undefined : buildCreativeSetupPrompt(input.creativeSetup),
      stageSkillAppendix,
    ]
      .filter((part): part is string => part !== undefined)
    const phasePrompt = appendix.length === 0
      ? basePhasePrompt
      : {
          ...basePhasePrompt,
          text: `${basePhasePrompt.text}\n\n${appendix.join("\n\n")}`,
          digest: digest(`${basePhasePrompt.text}\n\n${appendix.join("\n\n")}`),
        }
    const systemRules = await this.dependencies.prompts.loadSynopsisDiscussSystemRules()
    const defaultSkillPack = await this.dependencies.prompts.loadDefaultSkillPack("synopsis_discuss")
    let discussionDraftGuide: Readonly<{ text: string }> | undefined
    let outlineToDraftGuideLoaded = false
    const turnMonitor = this.dependencies.readTurnMonitor === undefined
      ? undefined
      : await this.dependencies.readTurnMonitor()
    const discussTrigger = input.discussTrigger ?? "user"
    const creativeSetupText = input.creativeSetup !== undefined
    const firstVolumeText = input.volumePlanning?.ready === false && input.workStyleGate === undefined
    const workStyleText = input.workStyleGate !== undefined
    const settings = this.dependencies.readProjectSettings === undefined
      ? undefined
      : await this.dependencies.readProjectSettings()
    const nowMs = this.dependencies.now()
    const configuredWallMinutes = settings?.creationDesk.discussMaxWallTimeMinutes ?? 0
    const wallLimitMs = input.deadlineMs
      ?? (configuredWallMinutes > 0 ? configuredWallMinutes * 60_000 : undefined)
    // Budget schemas require a finite integer, so "unlimited" is a far-future timestamp.
    const deadlineAtMs = wallLimitMs === undefined ? Number.MAX_SAFE_INTEGER : nowMs + wallLimitMs
    const maxRetrievalRounds = settings?.execution.maxRetrievalRounds
      ?? defaultProjectSettings.execution.maxRetrievalRounds
    // Ordinary discussion has an advisory threshold, not a call deadline.
    // Explicit caps are still used by bounded internal operations (e.g. setup questions).
    const maxModelCalls = Math.max(1, input.maxModelCalls ?? (maxRetrievalRounds + 3))
    const hasExplicitCallLimit = input.maxModelCalls !== undefined
    let catalog = await this.dependencies.catalog.createSnapshot({
      snapshotId: this.dependencies.createId(),
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      generatedAtMs: nowMs,
    })
    const availableProseStylePaths = catalog.entries
      .filter((entry) => entry.entryKind === "file"
        && entry.relativePath.startsWith("表现输出/笔风规则/")
        && entry.relativePath.endsWith(".md"))
      .map((entry) => entry.relativePath)
    const availableDescriptionRulePaths = listDescriptionRuleFiles(catalog.entries)
      .map((entry) => entry.relativePath)
    const availableNovelMajorCategoryRulePaths = catalog.entries
      .filter((entry) => entry.entryKind === "file" && entry.relativePath.startsWith(`${NOVEL_MAJOR_CATEGORY_RULES_DIR}/`) && entry.relativePath.endsWith(".md"))
      .map((entry) => entry.relativePath)
    const availableNovelSubcategoryRulePaths = catalog.entries
      .filter((entry) => entry.entryKind === "file" && entry.relativePath.startsWith(`${NOVEL_SUBCATEGORY_RULES_DIR}/`) && entry.relativePath.endsWith(".md"))
      .map((entry) => entry.relativePath)
    const selectedRulePaths = [
      input.presentation?.novelMajorCategoryRulePath,
      input.presentation?.novelSubcategoryRulePath,
    ].filter((path): path is string => path !== undefined)
    const workStyleCandidatePaths = input.workStyleGate === undefined
      ? []
      : [
          ...availableProseStylePaths,
          ...availableNovelMajorCategoryRulePaths,
          ...availableNovelSubcategoryRulePaths,
          ...selectedRulePaths,
        ]
    const workStyleCandidateEvidence = input.workStyleGate === undefined
      ? []
      : (await Promise.all(workStyleCandidatePaths.map(async (path) => {
          try {
            const markdown = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, path)
            return {
              readId: this.dependencies.createId(),
              visibility: "committed" as const,
              ownerKind: "workspace:presentation_style_candidate",
              ownerId: path,
              exactKeys: [path],
              semanticText: markdown.length > 4_000
                ? `${markdown.slice(0, 4_000)}\n\n[规则正文过长，评估上下文已截断]`
                : markdown,
              sourceRefs: [],
              digest: digest(markdown),
              stateRole: "current" as const,
              temporalRole: "current" as const,
            }
          } catch {
            return undefined
          }
        }))).filter((evidence) => evidence !== undefined)
    let currentWorkStyleEvidence: TurnReadEvidence[] = []
    if (input.workStyleGate !== undefined) {
      try {
        const markdown = await this.dependencies.workspace.readMarkdown(input.workspaceRootRef, WORK_STYLE_RULE_PATH)
        currentWorkStyleEvidence = [{
          readId: this.dependencies.createId(),
          visibility: "committed",
          ownerKind: "workspace:work_style_current",
          ownerId: WORK_STYLE_RULE_PATH,
          exactKeys: [WORK_STYLE_RULE_PATH],
          semanticText: markdown,
          sourceRefs: [],
          digest: digest(markdown),
          stateRole: "current",
          temporalRole: "current",
        }]
      } catch {
        currentWorkStyleEvidence = []
      }
    }
    const titleAlignmentIssue = await this.dependencies.chapterSynopsis.detectTitleAlignmentIssue({
      workspaceRootRef: input.workspaceRootRef,
      chapterSequence: input.chapterSequence,
    })
    const storedDigests = await this.dependencies.conversation.readDiscussContextDigests(input.sessionId)
    const bootstrapDigest = computeDiscussBootstrapDigest({
      catalog,
      ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
    })
    await this.dependencies.conversation.refreshDiscussSystemRules(input.sessionId, systemRules.text)
    let storedContext = await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)
    const compactOlderHistory = async (): Promise<void> => {
      const compacted = compactDiscussContextHistory(storedContext)
      if (compacted === undefined) return
      const compactedAt = this.dependencies.now()
      if (compacted.noticeContent !== undefined) {
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: input.sessionId, projectId: input.projectId, createdAtMs: compactedAt,
          messages: [{ role: "system", kind: "phase_instruction", content: compacted.noticeContent }],
        })
      }
      await this.dependencies.conversation.hideDiscussContextMessages(input.sessionId, compacted.messagesToHide, compactedAt)
      storedContext = await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)
      runtimeLog("info", "synopsis-conversation", "context.history_compacted", {
        projectId: input.projectId,
        sessionId: input.sessionId,
        hiddenMessageCount: compacted.messagesToHide.length,
        retainedTurnCount: compacted.retainedTurnCount,
        visibleMessageCount: storedContext.length,
      })
    }
    await compactOlderHistory()
    const draftGuideHeader = "# 用户要求 + 梗概 + 细纲 → 正文草稿"
    const draftGuideHostNotice = renderRuntimePrompt("discuss-repairs", "draft-guide-host-notice")
    const cachedDraftGuides = storedContext.filter((message) => (
      message.kind === "phase_instruction" && message.role === "system"
      && message.content?.startsWith(draftGuideHeader) === true
    ))
    const currentDraftResource = shouldAttachDraftGuide || cachedDraftGuides.length > 0
      ? await this.dependencies.prompts.loadOutlineToDraftGuide()
      : undefined
    if (shouldAttachDraftGuide) {
      discussionDraftGuide = currentDraftResource
      outlineToDraftGuideLoaded = discussionDraftGuide !== undefined
    }
    const cachedSkillPacks = storedContext.filter((message) => (
      message.kind === "phase_instruction" && message.role === "system"
      && message.content?.startsWith("【skill-pack:synopsis_discuss】") === true
    ))
    const currentSkillPack = cachedSkillPacks.find((message) => message.content === defaultSkillPack.text)
    const currentDraftGuide = cachedDraftGuides.find((message) => message.content === currentDraftResource?.text)
    if (storedContext.length === 0) {
      await this.dependencies.conversation.appendDiscussContextMessages({
        sessionId: input.sessionId,
        projectId: input.projectId,
        createdAtMs: nowMs,
        messages: [
          {
            role: "system",
            kind: "system_rules",
            content: systemRules.text,
          },
          {
            role: "system",
            kind: "phase_instruction",
            content: defaultSkillPack.text,
          },
        ],
      })
      storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
    } else {
      const duplicateStaticIds = [
        ...findEphemeralDiscussContextMessageIds(storedContext),
        ...findExactDuplicateStaticMessageIds(storedContext),
        ...findInvalidDiscussGateMessageIds(storedContext),
        ...cachedSkillPacks.filter((message) => message.messageId !== currentSkillPack?.messageId).map((message) => message.messageId),
        ...cachedDraftGuides.filter((message) => message.messageId !== currentDraftGuide?.messageId).map((message) => message.messageId),
      ]
      if (duplicateStaticIds.length > 0) {
        const hiddenIds = [...new Set(duplicateStaticIds)]
        await this.dependencies.conversation.hideDiscussContextMessages(
          input.sessionId,
          hiddenIds,
          nowMs,
        )
        storedContext = storedContext.filter((message) => !hiddenIds.includes(message.messageId))
        runtimeLog("info", "synopsis-conversation", "context.static_duplicates_hidden", {
          projectId: input.projectId,
          sessionId: input.sessionId,
          hiddenCount: hiddenIds.length,
        })
      }
      const hasSkillPack = storedContext.some((message) => message.content === defaultSkillPack.text)
      if (!hasSkillPack) {
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: input.sessionId,
          projectId: input.projectId,
          createdAtMs: nowMs,
          messages: [{
            role: "system",
            kind: "phase_instruction",
            content: defaultSkillPack.text,
          }],
        })
        storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
        runtimeLog("info", "synopsis-conversation", "context.default_skill_pack_appended", {
          projectId: input.projectId,
          sessionId: input.sessionId,
        })
      }
    }
    const skipBootstrap = storedDigests.bootstrap === bootstrapDigest
    let readEvidence: TurnReadEvidence[] = skipBootstrap
      ? []
      : [...await this.bootstrapSynopsisEvidence({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        catalog,
        ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
      })]
    readEvidence = [...readEvidence, ...workStyleCandidateEvidence, ...currentWorkStyleEvidence]
    const sendTurnId = this.dependencies.createId()
    let lastRequestInputTokens = await this.dependencies.conversation.loadDiscussContextInputTokens(input.projectId, input.sessionId)
    let sendCompactedEstimate: number | undefined
    const contextId = this.dependencies.createId()
    let retrievalGaps: TurnRetrievalGap[] = []
    let remainingCalls = hasExplicitCallLimit ? maxModelCalls : Number.MAX_SAFE_INTEGER
    let retrievalRounds = 0
    let budgetGraceUsed = false
    let consecutiveTodoWrites = 0
    let todoNoProgressStreak = 0
    let todoLoopRepairIssued = false
    let todoIncompleteRepairs = 0
    let todoRequiredRepairs = 0
    let autoContinueBlocked = false
    // UI「空转停跑保护」统管：内容指纹空转、Todo/工具空转、步骤连续失败硬停。默认关闭。
    const noProgressGuardEnabled = input.noProgressGuardEnabled === true
    const noProgressGuardLimit = resolveDiscussNoProgressGuardLimit(input.noProgressGuardLimit)
    const recordStepOutcome = async (step: string, failure?: string): Promise<void> => {
      const saved = readDiscussStepFailures(
        await this.dependencies.conversation.listDiscussContextMessages(input.sessionId),
      )
      const key = `chapter:${String(input.chapterSequence)}:${step}`
      const previous = saved.failures.get(key) ?? 0
      if (failure === undefined && previous === 0) return
      const attempts = failure === undefined ? 0 : previous + 1
      if (attempts === 0) saved.failures.delete(key)
      else saved.failures.set(key, attempts)
      await this.dependencies.conversation.appendDiscussContextMessages({
        sessionId: input.sessionId, projectId: input.projectId, createdAtMs: this.dependencies.now(),
        messages: [{ role: "system", kind: "phase_instruction", content: JSON.stringify({
          protocol: DISCUSS_STEP_FAILURE_PROTOCOL,
          failures: Object.fromEntries(saved.failures),
          ...(failure === undefined ? {} : { step, reason: failure.slice(0, 500) }),
        }) }],
      })
      if (saved.obsoleteMessageIds.length > 0) {
        await this.dependencies.conversation.hideDiscussContextMessages(
          input.sessionId, saved.obsoleteMessageIds, this.dependencies.now(),
        )
      }
      if (attempts >= noProgressGuardLimit) {
        const mustStopAfterRepeatedFailure = step === "model_contract"
        if (!noProgressGuardEnabled && !mustStopAfterRepeatedFailure) {
          runtimeLog("info", "synopsis-conversation", "discuss.step_retry_exhausted_skipped", {
            projectId: input.projectId, sessionId: input.sessionId, step, attempts, reason: failure,
          })
          storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
          return
        }
        const message = `${step} 连续失败 ${String(attempts)} 次，已停止自动推进。最后原因：${failure ?? "未知"}`
        synopsisConversationStreamHub.setContent(input.projectId, message, this.dependencies.now())
        runtimeLog("warn", "synopsis-conversation", "discuss.step_retry_exhausted", {
          projectId: input.projectId, sessionId: input.sessionId, step, attempts, reason: failure,
        })
        throw new SynopsisInvalidStateError(message)
      }
      storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
    }
    const describeRetryStep = describeRequiredRetryStep(storedContext, DESCRIBE_REQUIRED_MESSAGE)
    if (describeRetryStep !== undefined) await recordStepOutcome(describeRetryStep)
    const stuckTodoStep = describeRequiredRetryStep(storedContext, DISCUSS_TODO_REQUIRED_HINT)
    if (stuckTodoStep !== undefined) await recordStepOutcome(stuckTodoStep)
    let accumulatedReasoning = ""
    let attempt = 0
    let missingArtifactRetries = 0
    let textProtocolRetries = 0
    let missingSynopsisArtifactRetries = 0
    let missingOutlineArtifactRetries = 0
    let missingDraftProposalRetries = 0
    let missingVolumePlanRetries = 0
    let missingCreationDeskSettingsRetries = 0
    let writeScopeRetries = 0
    let draftLengthRetries = 0
    let pendingUserFocusSequence: number | undefined
    let originalWorkGateRepairs = 0
    let goalScheduleRepairs = 0
    let pendingWrites: PendingDiscussWrites | undefined
    let archiveResults: ReturnType<typeof toVisibleDiscussContextMessages> = []
    const repairHints: string[] = []
    const originalWorkContext = detectsOriginalWorkContext({
      userMessage: input.userMessage,
      heading: input.heading,
      synopsisMarkdown: input.synopsisMarkdown,
      outlineMarkdown: input.outlineMarkdown,
      ...(currentWorkDisplayName === undefined ? {} : { currentWorkDisplayName }),
      ...(input.chapterBodyMarkdown === undefined ? {} : { chapterBodyMarkdown: input.chapterBodyMarkdown }),
      ...(input.latestDraftMarkdown === undefined ? {} : { latestDraftMarkdown: input.latestDraftMarkdown }),
    })
    if (input.batchAutomation === true) {
      repairHints.push(
        renderRuntimePrompt("discuss-repairs", "batch-automation"),
      )
    } else if (input.creativeSetup === undefined && !hasPlanningContent(input.synopsisMarkdown, true)) {
      repairHints.push(
        renderRuntimePrompt("discuss-repairs", "synopsis-missing"),
      )
    } else if (input.creativeSetup === undefined && !hasPlanningContent(input.outlineMarkdown, false)) {
      repairHints.push(
        renderRuntimePrompt("discuss-repairs", "outline-missing"),
      )
    }
    if (titleAlignmentIssue !== undefined) {
      const section = (input.agentMode ?? "auto") === "auto" ? "title-alignment-auto" : "title-alignment-confirm"
      repairHints.push(renderRuntimePrompt("discuss-repairs", section, {
        bodyHeading: titleAlignmentIssue.bodyHeading,
        planningHeading: titleAlignmentIssue.planningHeading,
        target: titleAlignmentIssue.recommendedTarget,
      }))
    }
    const carriedTodos = synopsisConversationStreamHub.carriedTodos(input.projectId)
    const carriedTodoNotice = input.workStyleGate !== undefined || carriedTodos.length === 0
      ? undefined
      : renderRuntimePrompt("discuss-messages", "carried-todos", {
          todos: carriedTodos.map((item) => `- [${item.status}] ${item.content}`).join("\n"),
        })
    let latestBudgetAdvisory: SynopsisConversationBudgetAdvisory | undefined
    let latestToolDraft: SynopsisWorkflowToolResult | undefined
    const noteDiscussBlock = async (
      gate: string,
      message: string,
      options?: Readonly<{ source?: unknown; held?: boolean; discarded?: readonly string[] }>,
    ): Promise<void> => {
      const discarded = options?.discarded ?? (options?.source === undefined ? [] : describeDiscussWrites(options.source))
      const note = formatDiscussBlockNote({
        message,
        discarded,
        disposition: options?.held === true ? "held" : discarded.length > 0 ? "rejected" : "noted",
      })
      // Keep the original hint so settled-todo filters can drop it. The durable note below is what later turns read.
      repairHints.push(message)
      await this.dependencies.conversation.appendDiscussContextMessages({
        sessionId: input.sessionId,
        projectId: input.projectId,
        createdAtMs: this.dependencies.now(),
        messages: [{
          role: "system",
          kind: "phase_instruction",
          content: JSON.stringify({
            protocol: "discuss-gate-v1",
            gate,
            message: note,
            ...(discarded.length === 0 ? {} : { discarded }),
          }),
        }],
      })
      storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
      const gateMessages = storedContext.filter((message) => {
        if (message.kind !== "phase_instruction" || message.content === undefined) return false
        try {
          return (JSON.parse(message.content) as { protocol?: unknown }).protocol === "discuss-gate-v1"
        } catch {
          return false
        }
      })
      const overflow = gateMessages.slice(0, Math.max(0, gateMessages.length - 12))
      if (overflow.length === 0) return
      const hiddenIds = overflow.map((message) => message.messageId)
      await this.dependencies.conversation.hideDiscussContextMessages(input.sessionId, hiddenIds, this.dependencies.now())
      const hidden = new Set(hiddenIds)
      storedContext = storedContext.filter((message) => !hidden.has(message.messageId))
    }
    const releaseHeldWrites = async (reason: string): Promise<void> => {
      if (pendingWrites === undefined) return
      const discarded = describeDiscussWrites(pendingWrites)
      pendingWrites = undefined
      if (discarded.length === 0) return
      await noteDiscussBlock("held_writes_released", reason, { discarded })
    }
    const stopDiscussLoop = async (content: string) => {
      await noteDiscussBlock("discuss_stopped", content)
      runtimeLog("warn", "synopsis-conversation", "discuss.safety_stop", {
        projectId: input.projectId, sessionId: input.sessionId, attempt,
        remainingCalls, todoNoProgressStreak, consecutiveTodoWrites,
      })
      const result = finalizeDiscussReturn(input.projectId, latestBudgetAdvisory, {
        content,
        autoContinueBlocked: true,
        availableProseStylePaths,
        availableDescriptionRulePaths,
        availableNovelMajorCategoryRulePaths,
        availableNovelSubcategoryRulePaths,
        ...(accumulatedReasoning.length === 0 ? {} : { reasoningContent: accumulatedReasoning }),
        ...(latestToolDraft === undefined ? {} : { appendedDraft: {
          revisionTaskId: latestToolDraft.revisionTaskId,
          chapterId: latestToolDraft.chapterId,
          draftVersionId: latestToolDraft.draftVersionId,
          draftLabel: latestToolDraft.draftLabel,
        } }),
        choices: [
          { label: "检查当前进度与阻塞原因", action: "continue_discuss" },
          { label: "根据已有材料重试当前步骤", action: "continue_discuss" },
        ],
      })
      synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
        content: result.content,
        ...(result.reasoningContent === undefined ? {} : { thinking: result.reasoningContent }),
      })
      return result
    }
    let focusedDraftMarkdown = input.latestDraftMarkdown
    const projectSettingsForTools = this.dependencies.readProjectSettings === undefined
      ? undefined
      : await this.dependencies.readProjectSettings()
    const chapterWorkflowEnabled = projectSettingsForTools?.creationDesk.chapterWorkflowEnabled === true
    const allowChapterWorkflowTools = input.allowChapterWorkflowTools
      ?? input.allowWorkflowTools === true
    const executeWorkflowTool = this.dependencies.executeWorkflowTool
    const workflowCallbacks: SynopsisWorkflowToolCallbacks = input.allowWorkflowTools !== true
      ? {
          // External reference research cannot confirm style or write story artifacts.
          ...(input.creativeSetup !== undefined || this.dependencies.searchOriginalWork === undefined
            ? {} : { searchOriginalWork: this.dependencies.searchOriginalWork }),
          ...(input.creativeSetup !== undefined || this.dependencies.downloadOriginalWork === undefined
            ? {} : { downloadOriginalWork: this.dependencies.downloadOriginalWork }),
        }
      : {
          ...(this.dependencies.updateCharacter === undefined ? {} : { updateCharacter: this.dependencies.updateCharacter }),
           ...(allowChapterWorkflowTools && chapterWorkflowEnabled && executeWorkflowTool !== undefined
             && (input.writeScope === undefined || (
               (input.writeScope.draft === "write" || input.writeScope.advance === true)
               && input.writeScope.synopsis === undefined && input.writeScope.outline === undefined
             ))
             ? { executeWorkflowTool: async (request) => {
                 if (input.writeScope !== undefined && input.writeScope.volumeDrafts !== true
                   && (request.chapterSequences ?? []).some((sequence) => sequence !== input.chapterSequence)) {
                   throw new SynopsisInvalidStateError("本轮只授权为焦点章写草稿。")
                 }
                 return executeWorkflowTool(request)
               } }
            : {}),
          // Host also auto-restages on planningWriteIntent.synopsis/outline=rewrite.
          // Expose the tool when writeScope allows restage, or when rewrite of an earlier
          // stage is in scope (so the model can demote if host rewrite path is skipped).
          ...(!allowChapterWorkflowTools || this.dependencies.restageChapter === undefined
            || (scopedComposeIntent(input.writeScope)?.synopsis !== undefined && input.writeScope?.draft === "write")
            || (input.writeScope !== undefined
              && input.writeScope.restage !== true
              && input.writeScope.synopsis !== "rewrite"
              && input.writeScope.outline !== "rewrite")
            ? {}
            : { restageChapter: this.dependencies.restageChapter }),
           ...(!allowChapterWorkflowTools || this.dependencies.runBash === undefined
             || (input.writeScope !== undefined && input.writeScope.shell !== true)
            ? {}
            : { runBash: this.dependencies.runBash }),
          ...(this.dependencies.searchOriginalWork === undefined
            ? {}
            : { searchOriginalWork: this.dependencies.searchOriginalWork }),
          ...(this.dependencies.downloadOriginalWork === undefined
            ? {}
            : { downloadOriginalWork: this.dependencies.downloadOriginalWork }),
          ...(this.dependencies.writeTodos === undefined
            ? {}
            : { writeTodos: this.dependencies.writeTodos }),
          ...(this.dependencies.writeMemory === undefined
            ? {}
            : { writeMemory: this.dependencies.writeMemory }),
          loadSkill: async (skillInput) => {
            const loaded = await this.dependencies.prompts.loadSkill(skillInput.skillId, {
              includeReferences: skillInput.includeReferences === true,
            })
            if (skillInput.skillId === "outline-to-draft") outlineToDraftGuideLoaded = true
            const listed = await this.dependencies.prompts.listSkills()
            const meta = listed.find((item) => item.id === loaded.skillId)
            return {
              skillId: loaded.skillId,
              name: meta?.name ?? loaded.skillId,
              includeReferences: loaded.includeReferences,
              text: loaded.text,
              digest: loaded.digest,
            }
          },
        }
    const toolCallbacks: SynopsisWorkflowToolCallbacks = {
      ...workflowCallbacks,
      ...(input.creativeSetup !== undefined ? {} : {
        readConversationArchive: (query) => this.readConversationArchive(
          { projectId: input.projectId, sessionId: input.sessionId }, query,
        ),
      }),
    }

    if (originalWorkContext) {
      runtimeLog("info", "synopsis-conversation", "original_work_reference.capability", {
        projectId: input.projectId,
        sessionId: input.sessionId,
        webResearch: this.dependencies.webResearch !== undefined,
        archiveSearch: toolCallbacks.searchOriginalWork !== undefined,
        archiveDownload: toolCallbacks.downloadOriginalWork !== undefined,
      })
    }

    for (;;) {
      input.signal?.throwIfAborted()
      if (isSynopsisSendCancelled(input.projectId)) throw new SynopsisSendCancelledError()
      if (this.dependencies.now() >= deadlineAtMs) {
        throw new SynopsisInvalidStateError(
          "梗概讨论超时：检索与模型调用未在截止前完成（可在 项目设置 › 执行 › 讨论最长运行时间 调整，0 为无上限）",
        )
      }
      if (hasExplicitCallLimit && attempt > maxModelCalls + maxRetrievalRounds + 8) {
        return await stopDiscussLoop("本轮重复尝试过多，已暂停自动推进。已保存的结果与未完成任务均已保留，请检查当前阻塞原因后重试。")
      }
      if (remainingCalls <= 0) {
        if (!shouldAllowDiscussBudgetGrace(remainingCalls, budgetGraceUsed)) {
          return await stopDiscussLoop("本轮模型调用预算已耗尽，已暂停自动推进。已保存的结果与未完成任务均已保留，请检查当前进度后重试。")
        }
        budgetGraceUsed = true
        remainingCalls = 1
        repairHints.push(
          renderRuntimePrompt("discuss-repairs", "budget-grace"),
        )
      } else if (remainingCalls === 1) {
        repairHints.push(renderRuntimePrompt("discuss-repairs", "last-call"))
      }
      const request = phaseRequestEnvelopeSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        envelopeId: this.dependencies.createId(),
        projectId: input.projectId,
        taskId: input.sessionId,
        turnId: sendTurnId,
        contextId,
        scopeId: input.sessionId,
        phase: "synopsis_discuss",
        protocolVersion: PROTOCOL_VERSION,
        promptRef: phasePrompt.ref,
        promptDigest: phasePrompt.digest,
        contextViewRef: `synopsis-discuss:${input.sessionId}:${String(attempt)}`,
        committedReadIds: readEvidence.map((item) => item.readId),
        visiblePendingIds: [],
        remainingBudget: createAssistBudget(remainingCalls, deadlineAtMs),
        input: {
          workflow: "synopsis",
          userInput: input.userMessage,
          chapterSequence: input.chapterSequence,
          allowWorkspaceChapterReads: true,
          sourceUnitIds: [],
          phaseRunIds: [],
          readEvidence,
          retrievalGaps,
          workspaceCatalog: catalog,
          ...(settings === undefined ? {} : { projectSettings: settings }),
          ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
          ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
          artifacts: {},
          synopsisDiscuss: {
            heading: input.heading,
            chapterSequence: input.chapterSequence,
            synopsisMarkdown: input.synopsisMarkdown,
            outlineMarkdown: input.outlineMarkdown,
            ...(input.chapterBodyMarkdown === undefined ? {} : { chapterBodyMarkdown: input.chapterBodyMarkdown }),
            ...(focusedDraftMarkdown === undefined ? {} : { latestDraftMarkdown: focusedDraftMarkdown }),
            ...(input.focusKind === undefined ? {} : { focusKind: input.focusKind }),
            ...(input.focusLocked === true ? { focusLocked: true } : {}),
            ...(input.outlineDigest === undefined ? {} : { outlineDigest: input.outlineDigest }),
            userEditedSinceAgent: input.userEditedSinceAgent,
            userEditedOutlineSinceAgent: input.userEditedOutlineSinceAgent,
            synopsisReady: hasPlanningContent(input.synopsisMarkdown, true),
            outlineReady: hasPlanningContent(input.outlineMarkdown, false),
            synopsisConfirmed: input.synopsisConfirmed === true,
            ...(input.workStyleGate === undefined ? {} : { workStyleGate: input.workStyleGate }),
            ...(input.volumePlanning === undefined ? {} : { volumePlanning: input.volumePlanning }),
            ...(input.creativeSetup === undefined ? {} : { creativeSetup: input.creativeSetup }),
            batchAutomation: input.batchAutomation === true,
            batchProceed: input.batchProceed === true,
            ...(currentWorkDisplayName === undefined ? {} : { currentWorkDisplayName }),
            ...(currentWorkDescription === undefined ? {} : { currentWorkDescription }),
            activeGoals: input.activeGoals.map((goal) => ({
              goalId: goal.goalId,
              content: goal.content,
              lifecycle: goal.lifecycle,
              narrativeKind: goal.narrativeKind,
              scale: goal.scale,
              ...(goal.plantChapterSequence === undefined
                ? {}
                : { plantChapterSequence: goal.plantChapterSequence }),
              ...(goal.payoffChapterSequence === undefined
                ? {}
                : { payoffChapterSequence: goal.payoffChapterSequence }),
            })),
            chapterProgress: input.chapterProgress.map((item) => ({
              goalId: item.goalId,
              chapterSequence: item.chapterSequence,
              summary: item.summary,
              status: item.status,
            })),
            hookScheduleAudit: input.hookScheduleAudit,
            discussTrigger,
            ...(titleAlignmentIssue === undefined ? {} : { titleAlignmentIssue }),
            ...(turnMonitor === undefined ? {} : { turnMonitor }),
          },
        },
      })
      storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
      const currentTodos = synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos
      const hasCurrentTodos = discussTurnHasTodos(currentTodos)
      const currentTodosSettled = hasCurrentTodos && discussTodosAreSettled(currentTodos)
      const activeRepairHints = repairHints.filter((hint) => (
        !(hasCurrentTodos && hint === DISCUSS_TODO_REQUIRED_HINT)
        && !(currentTodosSettled && hint === DISCUSS_TODO_INCOMPLETE_HINT)
      ))
      if (pendingWrites !== undefined) {
        activeRepairHints.push(renderRuntimePrompt("discuss-repairs", "held-proposals"))
      }
      const contextWindowTokens = input.model.info?.contextWindowTokens ?? 64_000
      const triggerRatio = settings?.execution.contextCompactionThresholdRatio
        ?? defaultProjectSettings.execution.contextCompactionThresholdRatio
      const targetRatio = settings?.execution.contextCompressionTargetRatio
        ?? defaultProjectSettings.execution.contextCompressionTargetRatio
      const foldsApplied = storedContext.filter((message) => (
        message.kind === "phase_instruction"
        && message.content?.includes(`"protocol":"${CONTEXT_FOLD_SUMMARY_PROTOCOL}"`) === true
      )).length
      const contextMessages = [
        ...toVisibleDiscussContextMessages(storedContext).filter((message) => (
          outlineToDraftGuideLoaded || message.messageId !== currentDraftGuide?.messageId
        )),
        ...(discussionDraftGuide === undefined || !outlineToDraftGuideLoaded
          ? []
          : [{
              messageId: this.dependencies.createId(),
              sequence: storedContext.length,
              role: "system" as const,
              kind: "phase_instruction" as const,
              content: draftGuideHostNotice,
            }]),
        ...(discussionDraftGuide === undefined || storedContext.some((message) => message.content === discussionDraftGuide?.text)
          ? []
          : [{
              messageId: this.dependencies.createId(),
              sequence: storedContext.length,
              role: "system" as const,
              kind: "phase_instruction" as const,
              content: discussionDraftGuide.text,
            }]),
        {
          messageId: this.dependencies.createId(),
          sequence: storedContext.length,
          role: "user" as const,
          kind: "phase_instruction" as const,
          content: buildContextBudgetContent({
            contextTokens: lastRequestInputTokens
              ?? storedContext.reduce((sum, message) => sum + (message.tokenEstimate ?? 0), 0),
            contextWindowTokens,
            triggerRatio,
            targetRatio,
            foldsApplied,
          }),
        },
        {
          messageId: this.dependencies.createId(),
          sequence: storedContext.length,
          role: "system" as const,
          kind: "phase_instruction" as const,
          content: synopsisToolCatalog(toolCallbacks, foldsApplied > 0 ? DISCUSS_ARCHIVE_NOTICE : undefined),
        },
        ...archiveResults,
        ...(input.writeScope === undefined ? [] : [{
          messageId: this.dependencies.createId(),
          sequence: storedContext.length,
          role: "system" as const,
          kind: "phase_instruction" as const,
          content: renderRuntimePrompt("discuss-messages", "write-scope", { writeScope: JSON.stringify(input.writeScope) }),
        }]),
        ...(carriedTodoNotice === undefined || currentTodosSettled
          ? []
          : [{
              messageId: this.dependencies.createId(),
              sequence: storedContext.length,
              role: "system" as const,
              kind: "system_rules" as const,
              content: carriedTodoNotice,
            }]),
        ...(attempt > 0 || readEvidence.length > 0
          ? [{
              messageId: this.dependencies.createId(),
              sequence: storedContext.length,
              role: "system" as const,
              kind: "system_rules" as const,
              content: [
                renderRuntimePrompt("discuss-messages", "react-reminder", { evidenceCount: readEvidence.length }),
                ...activeRepairHints.slice(-2),
                ...(currentTodosSettled
                  ? [renderRuntimePrompt("discuss-messages", "todo-settled")]
                  : []),
              ].join("\n"),
            }]
          : []),
      ]
      let streamedReasoning = ""
      const thinkingRound = attempt + 1
      let compactedEstimate: number | undefined
      let execution
      try {
        const composeIntent = scopedComposeIntent(input.writeScope)
          ?? (input.writeScope !== undefined && Object.keys(input.writeScope).length === 0 ? {} : undefined)
        const composeParser = input.composeText
          ? new ComposeStreamParser(composeIntent === undefined ? undefined : composeSections(composeIntent))
          : undefined
        execution = await executeWithContextCompaction({
          model: input.model,
          request,
          ...(lastRequestInputTokens === undefined ? {} : { lastRequestInputTokens }),
          triggerRatio: settings?.execution.contextCompactionThresholdRatio
            ?? defaultProjectSettings.execution.contextCompactionThresholdRatio,
          targetRatio: settings?.execution.contextCompressionTargetRatio
            ?? defaultProjectSettings.execution.contextCompressionTargetRatio,
          ...(toolCallbacks.readConversationArchive === undefined ? {} : { foldNotice: DISCUSS_ARCHIVE_NOTICE }),
          onReadyToCall: () => {
            synopsisConversationStreamHub.beginThinkingRound(input.projectId, thinkingRound, this.dependencies.now())
          },
          onCompacting: (active) => {
            synopsisConversationStreamHub.setCompacting(input.projectId, active, this.dependencies.now())
          },
          onCompacted: async (event) => {
            if (isSynopsisSendCancelled(input.projectId)) throw new SynopsisSendCancelledError()
            const hiddenIds = new Set(event.hiddenMessageIds)
            archiveResults = archiveResults.filter((message) => !hiddenIds.has(message.messageId))
            await this.dependencies.conversation.hideDiscussContextMessages(input.sessionId, event.hiddenMessageIds, this.dependencies.now())
            if (event.foldMessages.length > 0) {
              // Compaction may fold an empty shell message; the context schema rejects empty content.
              const foldMessages = event.foldMessages.filter((message) => message.content.trim().length > 0)
              if (foldMessages.length > 0) {
                await this.dependencies.conversation.appendDiscussContextMessages({
                  sessionId: input.sessionId,
                  projectId: input.projectId,
                  createdAtMs: this.dependencies.now(),
                  messages: foldMessages.map((message) => ({
                    role: message.role,
                    kind: message.kind,
                    content: message.content,
                  })),
                })
              }
            }
            storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
            if (event.estimatedInputTokens !== undefined) {
              compactedEstimate = event.estimatedInputTokens
              sendCompactedEstimate = event.estimatedInputTokens
              lastRequestInputTokens = event.estimatedInputTokens
              synopsisConversationStreamHub.addUsage(input.projectId, {
                lastRequestInputTokens: event.estimatedInputTokens,
              }, this.dependencies.now())
            }
            runtimeLog("info", "synopsis-conversation", "context.compaction.applied", {
              projectId: input.projectId,
              sessionId: input.sessionId,
              reason: event.reason,
              hiddenMessageCount: event.hiddenMessageIds.length,
              foldMessageCount: event.foldMessages.length,
              estimatedInputTokens: event.estimatedInputTokens,
              remainingMessageCount: event.remainingMessageCount,
            })
          },
          createMessageId: () => this.dependencies.createId(),
          options: {
            phasePrompt: (() => {
               if (input.volumeBoundary !== undefined) {
                 const action = input.volumeBoundary
                 const instruction = action === "start" ? "开始当前卷，下一轮进入创作设定。"
                   : action === "end" ? "本卷已写满，请主动标记卷末以开启下一卷。"
                   : "根据本轮用户请求判断是否要修订已结卷内容，确实要修改时才标记。"
                 const text = `【${VOLUME_BOUNDARY_LABEL[action]}门禁】${instruction} 独立一行输出 ${volumeBoundaryMarker(action)}。本轮不能修改文件或调用工具。`
                 return { ...phasePrompt, text, digest: digest(text) }
               }
              if (input.refreshChoicesOnly) {
                const text = `${input.userMessage}\n\n提供至少两个互不重复的新选项，用 <creative-choices> 和 </creative-choices> 包住，每项单独一行，以 - 开头。可在块外简短说明，只刷新选项。`
                return { ...phasePrompt, text, digest: digest(text) }
              }
              if (creativeSetupText) {
                const text = `【创作设定访谈输出格式】\ncollecting 状态先用一两句自然语言说明当前要确认的问题、推荐理由或选项差异，空一行后再用 <creative-choices> 和 </creative-choices> 包住两个或以上互不重复的选项，每项单独一行且以 - 开头。\n主角 awaiting_write 状态可以补充人物字段，只把字段名与值的 JSON 放在 <creative-character-json> 和 </creative-character-json> 之间；字段名任意但必须符合人物字段 schema。\n卷 awaiting_write 状态用普通文本简短确认。若需要更新作品名或简介，在选项和人物块之外分别使用 <work-title>...</work-title> 或 <work-description>...</work-description>。不要输出 JSON 响应封套或三段构思标签。\n\n${phasePrompt.text.replace(/^输出 JSON：顶层含[^\n]*\n?/mu, "").trimEnd()}`
                return { ...phasePrompt, text, digest: digest(text) }
              }
              if (workStyleText) {
                const text = phasePrompt.text.replace(/^输出 JSON：顶层含[^\n]*\n?/mu, "").trimEnd()
                return { ...phasePrompt, text, digest: digest(text) }
              }
              if (input.discussTrigger === "turn_handoff") {
                const text = `${input.userMessage}\n\n用普通文本给出交接分析。可用 <handoff-outline> 和 </handoff-outline> 提交卷大纲 Markdown。需要更新作品名或简介时，分别使用 <work-title> 或 <work-description> 闭合标签。不要返回 JSON 封套。`
                return { ...phasePrompt, text, digest: digest(text) }
              }
              if (firstVolumeText) {
                  const guidance = phasePrompt.text.replace(/^输出 JSON：顶层含[^\n]*\n?/mu, "")
                  const text = `${guidance}\n\n卷级首次写入使用纯文本。按顺序输出 <compose-volume-synopsis>、<compose-volume-outline>、<compose-volume-meta>，每个开闭标签独占一行。前两块写完整 Markdown，最后一块依次填写 targetChapterCount: 正整数 和 targetWordCount: 正整数。写作设置 creationDeskSettings 用 <writing-settings> 独立块，每行一个键值（key: value），只允许以下键名，禁止自造或改写字段名：novelMajorCategoryRulePath、novelSubcategoryRulePath、descriptionRulePath、proseStyleRulePath、minimumWordCount、maximumWordCount、boundaryPace、causalityFocus。三条规则路径必须逐字引用本轮已提供的真实候选路径；字数须同时给最小值和最大值；boundaryPace 取 advance_allowed 或 hold_without_resolution；causalityFocus 取 auto、buildup、action 或 payoff。只补写作设置时可单独提交写作设置块。如需本轮结束后自动继续下一轮，另起一行写 <continue-turn/>。需要 Todo 等非读取工具时另起一个 <tool-request> 块（name、action，invoke 时加一行 arguments 单行 JSON）；读取资料用原生读取工具；不输出 JSON 封套。`
                  return { ...phasePrompt, text, digest: digest(text) }
                }
              if (isFocusOnlyScope(input.writeScope)) {
                 const text = "用普通文本回复。用户要求切换焦点，或修改其他卷／章时，提交 <chapter-focus> 块。第一行为目标章的绝对章序号；修改整卷时选择目标卷的首章。之后逐字引用本轮用户要求切换或修改的原话，然后闭合 </chapter-focus>。若切换后需要修改，另起一行输出 <continue-turn/>。本轮不能修改文件。"
                 return { ...phasePrompt, text, digest: digest(text) }
               }
               if (isOutlinePatchScope(input.writeScope)) {
                 const text = "只提交一个 <compose-outline-patch> 块，内含 1–20 对 <search>...</search> 和 <replace>...</replace>。每个开闭标签独占一行。逐字复制当前细纲中唯一匹配的原文并保留空白。删除时留空替换块。块外只允许空白。"
                 return { ...phasePrompt, text, digest: digest(text) }
               }
               if (input.writeScope !== undefined && isVolumeComposeScope(input.writeScope)) {
                 const blocks = [
                   ...(input.writeScope.volumeSynopsis === true ? ["<compose-volume-synopsis>\n卷梗概 Markdown\n</compose-volume-synopsis>"] : []),
                   ...(input.writeScope.volumeOutline === true ? ["<compose-volume-outline>\n卷大纲 Markdown\n</compose-volume-outline>"] : []),
                   ...(input.writeScope.volumeTargets === true ? ["<compose-volume-meta>\ntargetChapterCount: 正整数\ntargetWordCount: 正整数\n</compose-volume-meta>"] : []),
                   ...(input.writeScope.volume === "whole_volume" ? ['逐章使用 <compose-volume-chapter index="N">，N 为绝对章序号。块内依次使用可选的 <compose-volume-chapter-title>、必填的 <compose-volume-chapter-synopsis> 和 <compose-volume-chapter-outline>。闭合每个标签，包括外层 </compose-volume-chapter>。'] : []),
                   "如需本轮结束后自动继续下一轮，另起一行写 <continue-turn/>。需要 Todo 等非读取工具时另起一个 <tool-request> 块（name、action，invoke 时加一行 arguments 单行 JSON）；读取资料用原生读取工具。",
                 ]
                 const text = ["按顺序输出以下获准的卷规划标签。每个开闭标签独占一行。可在所有块之前提供说明。", ...blocks].join("\n\n")
                 return { ...phasePrompt, text, digest: digest(text) }
               }
              const sections = composeIntent === undefined ? [] : composeSections(composeIntent)
              const headings = { synopsis: "梗概", outline: "细纲", draft: "草稿" } as const
              const protocol = sections.length === 0
                ? "用普通文本回复讨论。需要资料时调用原生读取工具；需要 Todo、正文推演等工具时，只输出 <tool-request> 文本块（name、action，invoke 时再加一行 arguments 单行 JSON），不要自造其他标签。"
                : [sections.length === 3 ? "本轮执行完整构思，一次生成并交齐梗概、细纲和草稿。后两段直接承接本次回复中的前置产物。" : "本轮仅可交付下列获准产物。",
                    "需要资料时先调用原生读取工具；需要 Todo 等非读取工具时，另起一个 <tool-request> 块（name、action，invoke 时加一行 arguments 单行 JSON），工具请求不能与下列构思写入同回。资料齐全后，在同一回复中按下列顺序交付完整 Markdown。",
                    ...sections.map((section) => `<compose-${section}>\n${headings[section]}\n</compose-${section}>`),
                  ].join("\n")
              const phaseGuidance = phasePrompt.text.replace(/^输出 JSON：顶层含[^\n]*\n?/mu, "").trimEnd()
              const text = `【本轮讨论输出协议】\n${protocol}\n如需根据用户要求更新作品名或简介，在构思段外分别使用 <work-title>...</work-title> 或 <work-description>...</work-description>。如需提供备选方向，可在构思段外用 <creative-choices> 和 </creative-choices> 包住至少两个选项，每行以 - 开头。如需本轮结束后自动继续下一轮，另起一行写 <continue-turn/>。不要输出 JSON 响应封套。下文的旧输出字段名只说明篇章内容或工作流程，以本段输出格式为准。\n\n${phaseGuidance}`
              return { ...phasePrompt, text, digest: digest(text) }
            })(),
            outputMode: "text",
            forceThinking: true,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            contextChainId: input.sessionId,
            onPartial: (partial) => {
              const stamp = this.dependencies.now()
              if (partial.reasoningDelta !== undefined) {
                streamedReasoning += partial.reasoningDelta
                if (streamedReasoning.trimStart().startsWith("{")) {
                  const display = normalizeThinkingDisplayText(streamedReasoning)
                  if (display !== undefined) {
                    synopsisConversationStreamHub.setThinking(input.projectId, display, stamp)
                  }
                } else {
                  synopsisConversationStreamHub.appendThinking(input.projectId, partial.reasoningDelta, stamp)
                }
              }
              if (partial.contentDelta !== undefined) {
                if (composeParser !== undefined) {
                  for (const event of composeParser.push(partial.contentDelta)) {
                    if (event.type === "section_delta" || event.type === "text") {
                      synopsisConversationStreamHub.appendContent(input.projectId, event.text, stamp)
                    }
                    const progress = composeProgressForEvent(event)
                    if (progress !== undefined) {
                      synopsisConversationStreamHub.setProceedProgress(input.projectId, progress, stamp)
                    }
                  }
                } else {
                  synopsisConversationStreamHub.appendContent(input.projectId, partial.contentDelta, stamp)
                }
              }
            },
            contextMessages,
          },
        })
        const artifact = execution.result.artifact
        if (input.volumeBoundary !== undefined) {
          const marker = volumeBoundaryMarker(input.volumeBoundary)
          const accepted = execution.result.outcome === "continue" && execution.result.requestedReads.length === 0
            && typeof artifact === "object" && artifact !== null && "assistantMessage" in artifact
            && typeof artifact.assistantMessage === "string" && artifact.assistantMessage.trim() === marker
          const stamp = this.dependencies.now()
          synopsisConversationStreamHub.addUsage(input.projectId, execution.usage, stamp)
          const usage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
          if (usage !== undefined) await this.dependencies.conversation.saveDiscussUsage({ projectId: input.projectId, usage, updatedAtMs: stamp })
          return {
            content: accepted ? `已确认${VOLUME_BOUNDARY_LABEL[input.volumeBoundary]}。`
              : `当前停在「${VOLUME_BOUNDARY_LABEL[input.volumeBoundary]}」。AI 需要单独提交 ${marker}，本轮未写入。`,
            volumeBoundaryAccepted: accepted,
          }
        }
        if (execution.result.requestedReads.length === 0) {
          if (typeof artifact !== "object" || artifact === null || !("assistantMessage" in artifact)
            || typeof artifact.assistantMessage !== "string" || !artifact.assistantMessage.trim()) {
            throw new SynopsisInvalidStateError("模型未返回有效的讨论文本，本次响应不会写入。")
          }
          const { text: rawText, continueTurn } = extractContinueTurnMarker(artifact.assistantMessage)
          const toolRequestParsed = parseComposeToolRequest(rawText)
          if (toolRequestParsed.toolRequest !== undefined) {
            const visible = toolRequestParsed.text.trim()
            if (/<\/?compose-(?:synopsis|outline|draft|outline-patch|volume)/u.test(visible)) {
              throw new ComposeProtocolError("工具请求不能与梗概、细纲或草稿写入同回。")
            }
            execution = {
              ...execution,
              result: {
                ...execution.result,
                artifact: {
                  assistantMessage: visible || "正在调用工具。",
                  finalSelfReview: "已解析纯文本工具请求。",
                  toolRequest: toolRequestParsed.toolRequest,
                },
              },
            }
          } else if (input.refreshChoicesOnly) {
            const parsed = parseDiscussChoices(rawText)
            execution = { ...execution, result: { ...execution.result, artifact: { ...parsed, finalSelfReview: "已解析刷新选项。" } } }
          } else if (input.discussTrigger === "turn_handoff") {
            const { prose, ...metadata } = parseWorkMetadataTags(rawText)
            const start = "<handoff-outline>"
            const end = "</handoff-outline>"
            const outline = prose.includes(start) || prose.includes(end) ? extractBlock(prose, start, end) : undefined
            const assistantMessage = (outline === undefined ? prose : `${outline.before}\n${outline.after}`).trim()
            execution = { ...execution, result: { ...execution.result, artifact: {
              ...metadata,
              assistantMessage: assistantMessage || "已完成章节交接分析。",
              finalSelfReview: "已解析章节交接文本。",
              ...(continueTurn ? { continueTurn: true } : {}),
              ...(outline?.content ? { arcPlan: { markdown: outline.content } } : {}),
            } } }
          } else if (workStyleText && !creativeSetupText && !("toolRequest" in artifact)) {
            const parsed = composeWorkStyleArtifactFromText(rawText, {
              ...input.workStyleGate!,
              availableProseStylePaths,
              availableNovelMajorCategoryRulePaths,
              availableNovelSubcategoryRulePaths,
              hasExistingWorkStyle: currentWorkStyleEvidence.length > 0,
            })
            execution = { ...execution, result: { ...execution.result, artifact: { ...parsed, ...(continueTurn ? { continueTurn: true } : {}) } } }
          } else if (firstVolumeText && !creativeSetupText && !("toolRequest" in artifact)) {
            const { prose, ...settings } = parseComposeWritingSettings(rawText)
            const parsedChoices = prose.includes("<creative-choices>") ? parseDiscussChoices(prose) : undefined
            const proseWithoutChoices = parsedChoices?.assistantMessage ?? prose
            const volumeTags = {
              ...(proseWithoutChoices.includes("<compose-volume-synopsis>") ? { volumeSynopsis: true as const } : {}),
              ...(proseWithoutChoices.includes("<compose-volume-outline>") ? { volumeOutline: true as const } : {}),
              ...(proseWithoutChoices.includes("<compose-volume-meta>") ? { volumeTargets: true as const } : {}),
            }
            // The model may wrap the required blocks with a short preamble and/or a closing note.
            // Parse the block region only, then merge the surrounding prose back for display.
            const blockStart = proseWithoutChoices.search(/<compose-volume-[a-z-]+\b/u)
            const lastClose = [...proseWithoutChoices.matchAll(/<\/compose-volume-[a-z-]+>/gu)].at(-1)
            const blockEnd = lastClose === undefined ? -1 : (lastClose.index ?? 0) + lastClose[0].length
            const hasBlocks = blockStart >= 0 && blockEnd > blockStart
            const blockDocument = hasBlocks ? proseWithoutChoices.slice(blockStart, blockEnd) : proseWithoutChoices
            const stripCodeFences = (value: string): string => value.replace(/^\s*```[a-zA-Z]*\s*$/gmu, "").trim()
            const preamble = hasBlocks ? stripCodeFences(proseWithoutChoices.slice(0, blockStart)) : ""
            const trailing = hasBlocks ? stripCodeFences(proseWithoutChoices.slice(blockEnd)) : ""
            const parsed = Object.values(volumeTags).some(Boolean)
              ? composeVolumePlanArtifactFromText(blockDocument, volumeTags)
              : { assistantMessage: proseWithoutChoices.trim() || "已整理写作设置。", finalSelfReview: "已解析卷规划讨论文本。" }
            const visibleText = [preamble, trailing].filter((part) => part.length > 0).join("\n\n").trim()
            execution = {
              ...execution,
              result: {
                ...execution.result,
                artifact: {
                  ...parsed,
                  ...settings,
                  ...(parsedChoices?.choices === undefined ? {} : { choices: parsedChoices.choices }),
                  ...(visibleText.length === 0 ? {} : { assistantMessage: visibleText }),
                  ...(continueTurn ? { continueTurn: true } : {}),
                },
              },
            }
          } else if (!creativeSetupText && !("toolRequest" in artifact)) {
            const { text: withoutFocus, focusChange } = parseComposeFocusTag(rawText)
            const { text: withoutStaging, stagingPromote } = parseComposeStagingPromote(withoutFocus)
            const { text: withoutGoals, goalProposals } = parseComposeGoalProposals(withoutStaging)
            const patchStart = withoutGoals.indexOf("<compose-outline-patch>")
            const patchText = patchStart < 0 ? withoutGoals : withoutGoals.slice(patchStart)
            const patchProse = patchStart > 0 ? withoutGoals.slice(0, patchStart).trim() : ""
            const parsed = isOutlinePatchScope(input.writeScope)
              || (input.writeScope === undefined && patchStart >= 0)
              ? {
                  assistantMessage: patchProse || "已整理细纲局部修改。",
                  finalSelfReview: "已解析细纲补丁。",
                  bodyEdits: {
                    baseDigest: digest(input.outlineMarkdown),
                    ...parseComposeOutlinePatch(patchText, { outline: "patch" }),
                  },
                  planningWriteIntent: { outline: "patch" as const },
                }
              : isVolumeComposeScope(input.writeScope)
                ? composeVolumePlanArtifactFromText(withoutGoals, input.writeScope)
                : (() => {
                    const { text: withoutTitle, chapterTitle, volumeFolderName } = parseComposeHostTags(withoutGoals)
                    const { text: withoutIntent, intent } = extractComposeIntentMarker(withoutTitle)
                    const { prose, ...metadata } = parseWorkMetadataTags(withoutIntent)
                    const markerIntent = intent === undefined ? undefined : {
                      ...(intent.synopsis === undefined ? {} : { synopsis: intent.synopsis }),
                      ...(intent.outline === "create" || intent.outline === "rewrite" ? { outline: intent.outline } : {}),
                      ...(intent.draft === undefined ? {} : { draft: intent.draft }),
                    }
                    const parsedText = composeArtifactFromText(prose, composeIntent)
                    return {
                      ...parsedText,
                      ...(markerIntent === undefined ? {} : {
                        planningWriteIntent: { ...(parsedText.planningWriteIntent ?? {}), ...markerIntent },
                      }),
                      ...metadata,
                      ...(chapterTitle === undefined ? {} : { chapterTitle }),
                      ...(volumeFolderName === undefined ? {} : { volumeFolderName }),
                    }
                  })()
            const choices = parsed.assistantMessage.includes("<creative-choices>") || parsed.assistantMessage.includes("</creative-choices>")
              ? parseDiscussChoices(parsed.assistantMessage)
              : undefined
            execution = {
              ...execution,
              result: {
                ...execution.result,
                artifact: {
                  ...parsed,
                  ...choices,
                  ...(goalProposals === undefined ? {} : { goalProposals }),
                  ...(focusChange === undefined ? {} : { focusChange }),
                  ...(stagingPromote === undefined ? {} : { stagingPromote }),
                  ...(continueTurn ? { continueTurn: true } : {}),
                },
              },
            }
          }
        }
      } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (error instanceof SynopsisInvalidStateError && message.includes("模型未返回有效的讨论文本")
            && missingArtifactRetries < 2 && remainingCalls > 1) {
            missingArtifactRetries += 1
            remainingCalls -= 1
            await noteDiscussBlock("missing_artifact", "请直接输出纯文本讨论回复。")
            attempt += 1
            continue
          }
          if (isRecoverableDiscussPhaseContractError(error)) {
            await recordStepOutcome("model_contract", message)
            if (missingArtifactRetries < 2 && remainingCalls > 1) {
              missingArtifactRetries += 1
              remainingCalls -= 1
              await noteDiscussBlock("phase_contract", discussPhaseContractRepairHint(error))
              attempt += 1
              continue
            }
          }
          const intent = scopedComposeIntent(input.writeScope)
          if (input.composeText && error instanceof ComposeProtocolError && intent !== undefined
            && composeSections(intent).length < 3 && missingArtifactRetries === 0 && remainingCalls > 1) {
            missingArtifactRetries += 1
            remainingCalls -= 1
            await noteDiscussBlock("model_result_rejected", `${message} 请只用本轮授权的标签重新提交。`)
            attempt += 1
            continue
          }
          if (error instanceof ComposeProtocolError && !message.includes("未授权")
            && textProtocolRetries < 1 && remainingCalls > 1) {
            textProtocolRetries += 1
            remainingCalls -= 1
            await noteDiscussBlock("text_protocol", `${message} 请严格按本轮纯文本标签格式重新提交，未知字段不要输出。`)
            attempt += 1
            continue
          }
          await noteDiscussBlock("model_result_rejected", message)
          throw error

      }
      const measuredContextTokens = contextTokensAfterProviderUsage(
        compactedEstimate ?? sendCompactedEstimate,
        execution.usage.lastRequestInputTokens,
      )
      if (measuredContextTokens !== undefined) lastRequestInputTokens = measuredContextTokens
      if (execution.contextExchange !== undefined) {
        const duplicateStaticIds = [
          ...findEphemeralDiscussContextMessageIds(storedContext),
          ...findExactDuplicateStaticMessageIds(storedContext),
        ]
        if (duplicateStaticIds.length > 0) {
          const hiddenIds = [...new Set(duplicateStaticIds)]
          await this.dependencies.conversation.hideDiscussContextMessages(
            input.sessionId,
            hiddenIds,
            this.dependencies.now(),
          )
          storedContext = storedContext.filter((message) => !hiddenIds.includes(message.messageId))
        }
        const exchangeMessages = filterNovelContextExchangeMessages(storedContext, [
          ...execution.contextExchange.requestMessages,
          execution.contextExchange.responseMessage,
        ]).filter((message) => (message.content ?? "").trim().length > 0)
        if (exchangeMessages.length > 0) {
          await this.dependencies.conversation.appendDiscussContextMessages({
            sessionId: input.sessionId,
            projectId: input.projectId,
            createdAtMs: this.dependencies.now(),
            messages: exchangeMessages,
          })
          storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
          await compactOlderHistory()
        }
        await this.dependencies.conversation.saveDiscussContextDigests({
          sessionId: input.sessionId,
          synopsisDigest: digest(input.synopsisMarkdown),
          outlineDigest: input.outlineDigest ?? null,
          bootstrapDigest,
          updatedAtMs: this.dependencies.now(),
        })
      }
      if ((execution.schemaRepairs?.length ?? 0) > 0) {
        await noteDiscussBlock("schema_validation", renderRuntimePrompt("discuss-repairs", "schema-validation", {
          issues: (execution.schemaRepairs ?? []).map((item, index) => `${String(index + 1)}. ${item}`).join("\n"),
        }))
      }
      remainingCalls = Math.max(0, remainingCalls - Math.max(1, execution.usage.modelCalls ?? 1))
      synopsisConversationStreamHub.addUsage(input.projectId, {
        inputTokens: execution.usage.inputTokens,
        outputTokens: execution.usage.outputTokens,
        ...(execution.usage.cacheHitInputTokens === undefined
          ? {}
          : { cacheHitInputTokens: execution.usage.cacheHitInputTokens }),
        ...(execution.usage.cacheMissInputTokens === undefined
          ? {}
          : { cacheMissInputTokens: execution.usage.cacheMissInputTokens }),
        ...(measuredContextTokens === undefined
          ? {}
          : { lastRequestInputTokens: measuredContextTokens }),
      }, this.dependencies.now())
      const cumulativeUsage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
      if (cumulativeUsage !== undefined) {
        await this.dependencies.conversation.saveDiscussUsage({
          projectId: input.projectId, usage: cumulativeUsage, updatedAtMs: this.dependencies.now(),
        })
      }
      latestBudgetAdvisory = recordSynopsisModelCall(input.projectId, maxModelCalls) ?? latestBudgetAdvisory
      const parsedResult = phaseResultEnvelopeSchema.parse(execution.result)
      const strippedByGate = consumeDiscussToolExclusiveStrip() ?? []
      await recordStepOutcome("model_contract", strippedByGate.length > 0
        ? "工具调用与写入混合提交，结果未通过协议门禁" : undefined)
      if (strippedByGate.length > 0) {
        this.applyToolExclusiveTodoGate(input.projectId, input.sessionId, strippedByGate)
        repairHints.push(DISCUSS_TOOL_EXCLUSIVE_GATE_HINT)
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: input.sessionId,
          projectId: input.projectId,
          createdAtMs: this.dependencies.now(),
          messages: [{
            role: "system",
            kind: "phase_instruction",
            content: JSON.stringify({
              protocol: "discuss-gate-v1",
              gate: "toolRequest_exclusive",
              strippedKeys: strippedByGate,
              message: DISCUSS_TOOL_EXCLUSIVE_GATE_HINT,
            }),
          }],
        })
        storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
        runtimeLog("info", "synopsis-conversation", "tool_exclusive.gate_applied", {
          projectId: input.projectId,
          sessionId: input.sessionId,
          strippedKeys: strippedByGate,
        })
      }
      const displayThinking = normalizeThinkingDisplayText(execution.usage.reasoningContent)
        ?? normalizeThinkingDisplayText(streamedReasoning)
      if (displayThinking !== undefined && displayThinking.length > 0) {
        accumulatedReasoning = displayThinking
        synopsisConversationStreamHub.setThinking(input.projectId, accumulatedReasoning, this.dependencies.now())
      }
      const requestedReads = parsedResult.requestedReads
      if (input.refreshChoicesOnly && parsedResult.outcome !== "request_read") {
        const artifact = synopsisDiscussArtifactSchema.parse(parsedResult.artifact)
        synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), { content: artifact.assistantMessage })
        return { content: artifact.assistantMessage, ...(artifact.choices === undefined ? {} : { choices: artifact.choices }) }
      }
      const creativeOutput = creativeSetupText && input.creativeSetup !== undefined
        && parsedResult.outcome !== "request_read"
        && typeof parsedResult.artifact === "object" && parsedResult.artifact !== null
        && "assistantMessage" in parsedResult.artifact && typeof parsedResult.artifact.assistantMessage === "string"
        ? (() => {
            try { return parseCreativeSetupOutput(parsedResult.artifact.assistantMessage as string, input.creativeSetup!) }
            catch { return undefined }
          })()
        : undefined
      const toolArtifact = synopsisDiscussArtifactSchema.safeParse(parsedResult.artifact)
      const manualFocusChange = input.batchProceed !== true && input.batchAutomation !== true
        && input.focusLocked !== true && (input.agentMode ?? "auto") !== "plan"
        && input.creativeSetup === undefined
        && (input.writeScope === undefined || input.writeScope.focus === true)
      const proposedFocusSequence = toolArtifact.success ? toolArtifact.data.focusChange?.chapterSequence : undefined
      if (manualFocusChange && (pendingUserFocusSequence !== undefined
        || (proposedFocusSequence !== undefined && proposedFocusSequence !== input.chapterSequence))) {
        // Resolve navigation before draft/todo/reference repairs can replay work for the captured old chapter.
        await releaseHeldWrites(renderRuntimePrompt("discuss-repairs", "release-held-on-focus"))
        if (toolArtifact.success && proposedFocusSequence !== undefined && proposedFocusSequence !== input.chapterSequence
          && isCurrentUserFocusChange(toolArtifact.data.focusChange, input.userMessage)) {
          const transition = prepareUserFocusTransition(toolArtifact.data, input.chapterSequence, input.userMessage)
          const result = finalizeDiscussReturn(input.projectId, latestBudgetAdvisory, {
            content: transition.assistantMessage,
            ...mapArtifactFocusChange(transition.focusChange),
            ...(transition.continueTurn === true ? { continueTurn: true } : {}),
            ...(transition.choices === undefined && transition.continueTurn === true ? {} : {
              choices: transition.choices?.length ? transition.choices : [
                { label: "查看目标章已有材料", action: "continue_discuss" as const },
                { label: "按当前构思继续讨论目标章", action: "continue_discuss" as const },
              ],
            }),
            ...(accumulatedReasoning.length === 0 ? {} : { reasoningContent: accumulatedReasoning }),
            availableProseStylePaths, availableDescriptionRulePaths,
            availableNovelMajorCategoryRulePaths, availableNovelSubcategoryRulePaths,
          })
          synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
            content: result.content,
            ...(result.reasoningContent === undefined ? {} : { thinking: result.reasoningContent }),
          })
          return result
        }
        if (pendingUserFocusSequence === undefined && remainingCalls > 0) {
          pendingUserFocusSequence = proposedFocusSequence
          await noteDiscussBlock(
            "focus_change_quote",
            isFocusOnlyScope(input.writeScope)
              ? `请重新提交 <chapter-focus> 块。第一行填写 ${String(proposedFocusSequence)}，随后逐字引用本轮用户要求换章的原话，再闭合标签。`
              : renderRuntimePrompt("discuss-repairs", "focus-change-quote", { focusSequence: String(proposedFocusSequence) }),
            { source: toolArtifact.success ? toolArtifact.data : undefined },
          )
          runtimeLog("warn", "synopsis-conversation", "focus_change.quote_repair", {
            projectId: input.projectId, sessionId: input.sessionId,
            currentSequence: input.chapterSequence, targetSequence: proposedFocusSequence,
          })
          attempt += 1
          continue
        }
        return await stopDiscussLoop("换章请求未通过核验：模型补正后仍未提供有效的本轮指令引用，或撤回了换章动作。章节焦点保持原位，没有写入草稿版本，也未应用该回复的章节改动。请检查本轮请求后重试。")
      }
      if (input.creativeSetup !== undefined && parsedResult.outcome !== "request_read") {
        if (creativeOutput === undefined || (input.creativeSetup.status === "collecting" && (creativeOutput.choices?.length ?? 0) < 2)
          || (input.creativeSetup.status === "awaiting_write" && input.creativeSetup.scope === "protagonist"
            && creativeOutput.protagonistSupplementFields === undefined)) {
          if (remainingCalls > 0 && attempt < 2) {
            await noteDiscussBlock("creative_setup", "请严格使用创作设定专用标签格式：给出至少两个选项时用 <creative-choices>，主角补充时用 <creative-character-json> 包住符合人物字段 schema 的 JSON。")
            attempt += 1
            continue
          }
          throw new SynopsisInvalidStateError("主角/卷规划问答未获得有效标签选项或人物字段，已停止；用户确认和已有内容均保留")
        }
        return { content: creativeOutput.assistantMessage,
          ...(creativeOutput.workDisplayName === undefined ? {} : { workDisplayName: creativeOutput.workDisplayName }),
          ...(creativeOutput.workDescription === undefined ? {} : { workDescription: creativeOutput.workDescription }),
          ...(creativeOutput.choices === undefined ? {} : { choices: [...creativeOutput.choices] }),
          ...(creativeOutput.protagonistSupplementMarkdown === undefined ? {} : { protagonistSupplementMarkdown: creativeOutput.protagonistSupplementMarkdown }),
          ...(creativeOutput.protagonistSupplementFields === undefined ? {} : { protagonistSupplementFields: creativeOutput.protagonistSupplementFields }) }
      }
      const originalWorkStage = readOriginalWorkEvidenceStage(storedContext)
      const originalWorkHasEvidence = hasOriginalWorkEvidence(readEvidence)
      const originalToolRequest = toolArtifact.success ? toolArtifact.data.toolRequest : undefined
      const originalToolRequested = originalToolRequest?.name === "original_work_search"
        || originalToolRequest?.name === "original_work_download"
      const originalWorkToolsAvailable = toolCallbacks.searchOriginalWork !== undefined
        || toolCallbacks.downloadOriginalWork !== undefined
      const originalWorkWebResearchAvailable = this.dependencies.webResearch !== undefined
      let originalWorkFallbackNotice: string | undefined
      if (originalWorkContext && !originalWorkHasEvidence && parsedResult.outcome !== "request_read") {
        const canBootstrapTodo = originalToolRequest?.name === "todo_write"
          || originalToolRequest?.name === "conversation_archive"
        const canUseOriginalTool = originalToolRequested
        const mustReadImportedReference = originalWorkStage === "archive_imported"
          && originalWorkGateRepairs < 3
        const shouldRequireEvidenceStep = !canBootstrapTodo && !canUseOriginalTool
          && (mustReadImportedReference
            || (originalWorkStage === "none"
              && (originalWorkWebResearchAvailable || originalWorkToolsAvailable)
              && originalWorkGateRepairs === 0)
            || (originalWorkStage === "none" && originalWorkToolsAvailable && originalWorkGateRepairs === 1)
            || (originalWorkStage === "web_attempted" && originalWorkToolsAvailable)
            || (originalWorkStage === "archive_searched" && originalWorkToolsAvailable))
        if (shouldRequireEvidenceStep && remainingCalls > 0) {
          originalWorkGateRepairs += 1
          runtimeLog("info", "synopsis-conversation", "original_work_reference.gate_step", {
            projectId: input.projectId,
            sessionId: input.sessionId,
            stage: originalWorkStage,
            repair: originalWorkGateRepairs,
            hasEvidence: originalWorkHasEvidence,
          })
          const repairStage = originalWorkStage === "none" && originalWorkGateRepairs > 1
            ? "web_attempted"
            : originalWorkStage
          await noteDiscussBlock(
            "original_work_evidence",
            originalWorkStage === "archive_imported"
              ? renderRuntimePrompt("discuss-repairs", "original-work-archive-import")
              : originalWorkEvidenceRepairHint({
                  stage: repairStage,
                  hasWebResearch: this.dependencies.webResearch !== undefined,
                  hasArchive: originalWorkToolsAvailable,
                }),
            { source: toolArtifact.success ? toolArtifact.data : undefined },
          )
          attempt += 1
          continue
        }
        // Public references can be unavailable or incomplete. The final fallback
        // keeps writing usable while explicitly separating inference from canon.
        originalWorkFallbackNotice = "原作资料未完成核验；以下内容仅按当前上下文与模型常识合理推演，不代表已确认的原作事实。"
      }
      if (toolArtifact.success && toolArtifact.data.toolRequest !== undefined) {
        if (parsedResult.outcome !== "continue" || requestedReads.length > 0) {
          await recordStepOutcome("tool_contract", "工具调用必须单独返回，不能与读取请求混合")
          await noteDiscussBlock("tool_contract", renderRuntimePrompt("discuss-repairs", "tool-contract"), { source: toolArtifact.data })
          attempt += 1
          continue
        }
        if (isSynopsisSendCancelled(input.projectId)) throw new SynopsisSendCancelledError()
        const toolRequest = toolArtifact.data.toolRequest
        if (toolRequest.name === "chapter_workflow" && toolRequest.action === "invoke"
          && !outlineToDraftGuideLoaded) {
          discussionDraftGuide = await this.dependencies.prompts.loadOutlineToDraftGuide()
          outlineToDraftGuideLoaded = true
          await noteDiscussBlock(
            "draft_guide_required",
            `${draftGuideHostNotice}${renderRuntimePrompt("discuss-repairs", "draft-guide-for-tool")}`,
            { source: toolArtifact.data },
          )
          attempt += 1
          continue
        }
        if (toolRequest.action === "invoke" && toolRequest.name !== "todo_write") {
          await releaseHeldWrites(renderRuntimePrompt("discuss-repairs", "release-held-on-tool", { toolName: toolRequest.name }))
        }
        await recordStepOutcome("tool_contract")
        if (toolRequest.name !== "todo_write") {
          consecutiveTodoWrites = 0
          todoNoProgressStreak = 0
          todoLoopRepairIssued = false
        }
        if (
          !isDiscussTodoBootstrapTool(toolRequest.name)
          && !discussTurnHasTodos(synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos)
          && todoRequiredRepairs < 2
          && remainingCalls > 0
        ) {
          todoRequiredRepairs += 1
          await noteDiscussBlock("todo_required", DISCUSS_TODO_REQUIRED_HINT, { source: toolArtifact.data })
          attempt += 1
          continue
        }
        const cancellation = new AbortController()
        const remainingMs = wallLimitMs === undefined
          ? undefined
          : Math.max(1, deadlineAtMs - this.dependencies.now())
        const toolSignal = AbortSignal.any([
          cancellation.signal,
          ...(remainingMs === undefined ? [] : [AbortSignal.timeout(remainingMs)]),
          ...(input.signal === undefined ? [] : [input.signal]),
        ])
        const cancellationPoll = setInterval(() => {
          if (isSynopsisSendCancelled(input.projectId)) cancellation.abort(new SynopsisSendCancelledError())
        }, 100)
        cancellationPoll.unref()
        const toolRunId = this.dependencies.createId()
        const toolRound = attempt + 1
        synopsisConversationStreamHub.upsertToolRun(input.projectId, {
          runId: toolRunId,
          name: toolRequest.name,
          action: toolRequest.action,
          ...(toolRequest.arguments === undefined ? {} : { arguments: toolRequest.arguments }),
          status: "running",
          round: toolRound,
        }, this.dependencies.now())
        try {
          const todosBeforeTool = [...synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos]
          // Re-read after compaction: hidden descriptions no longer grant permission.
          const visibleMessages = toVisibleDiscussContextMessages(
            await this.dependencies.conversation.listDiscussContextMessages(input.sessionId),
          )
          const toolResult = await executeSynopsisTool({
            request: toolRequest,
            context: {
              projectId: input.projectId,
              workspaceRootRef: input.workspaceRootRef,
              sessionId: input.sessionId,
              chapterSequence: input.chapterSequence,
              model: input.model,
              ...(hasExplicitCallLimit ? { maxModelCalls: Math.max(1, remainingCalls) } : {}),
              ...(remainingMs === undefined ? {} : { deadlineMs: remainingMs }),
              signal: toolSignal,
              ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
              ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
            },
            callbacks: toolCallbacks,
            allowPublish: false,
            visibleMessages,
            listDrafts: async () => {
              const revisions = this.dependencies.revisions
              if (revisions === undefined) return []
              const draft = await revisions.getDraftWorkspace({ projectId: input.projectId, chapterSequence: input.chapterSequence })
              if (draft === undefined) return []
              const listed = await revisions.listDraftVersions(draft.revisionTaskId)
              return listed.versions.map((version) => ({
                revisionTaskId: version.revisionTaskId,
                draftVersionId: version.versionId,
                draftLabel: version.label,
                heading: version.heading,
              }))
            },
          })
          const toolFailed = toolResult.status === "error"
          synopsisConversationStreamHub.upsertToolRun(input.projectId, {
            runId: toolRunId,
            name: toolRequest.name,
            action: toolRequest.action,
            ...(toolRequest.arguments === undefined ? {} : { arguments: toolRequest.arguments }),
            status: toolFailed ? "failed" : "completed",
            resultSummary: summarizeSynopsisToolRunResult(toolResult),
            round: toolRound,
          }, this.dependencies.now())
          if (toolResult.status === "draft_created") {
            latestToolDraft = toolResult.result as SynopsisWorkflowToolResult
            focusedDraftMarkdown = assembleChapterDocument(latestToolDraft.heading, latestToolDraft.body)
          }
          if (!toolFailed && toolRequest.name === "restage_chapter") {
            const restagedSession = await this.dependencies.conversation.findSession(input.sessionId)
              ?? await this.dependencies.conversation.findBySequence(input.projectId, input.chapterSequence)
            if (restagedSession !== undefined) {
              await this.syncProceedProgressFromMaterials({
                projectId: input.projectId,
                workspaceRootRef: input.workspaceRootRef,
                session: restagedSession,
              })
            }
          }
          if (!toolFailed && !isDiscussTodoBootstrapTool(toolRequest.name)) {
            const settledTodos = settleToolGateTodos(
              synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos,
            )
            if (settledTodos !== undefined) {
              synopsisConversationStreamHub.setTodos(input.projectId, settledTodos, this.dependencies.now(), { merge: false })
            }
          }
          const toolErrorMessage = typeof toolResult.message === "string" ? toolResult.message : ""
          if (toolFailed && isPrecedingChapterPublishGateError(new Error(toolErrorMessage))) {
            const nextSequence = await this.dependencies.chapters.nextChapterSequence(input.projectId)
            this.applyChapterSequenceTodoGate(
              input.projectId,
              input.sessionId,
              nextSequence,
              [input.chapterSequence],
            )
            await noteDiscussBlock(
              "chapter_sequence_publish",
              discussChapterSequenceGateHint(nextSequence, [input.chapterSequence]),
              { source: toolArtifact.data },
            )
          }
          if (toolRequest.name === "conversation_archive" && toolRequest.action === "invoke") {
            // Historical text is call-scoped data. Keep it available during this turn only.
            archiveResults.push({
              messageId: this.dependencies.createId(),
              sequence: (storedContext.at(-1)?.sequence ?? 0) + archiveResults.length + 1,
              role: "user",
              kind: "phase_instruction",
              content: JSON.stringify(toolResult),
            })
          } else {
            await this.dependencies.conversation.appendDiscussContextMessages({
              sessionId: input.sessionId,
              projectId: input.projectId,
              createdAtMs: this.dependencies.now(),
              messages: [{ role: "system", kind: "phase_instruction", content: JSON.stringify(toolResult) }],
            })
          }
          // The next model round must see the result it is expected to act on.
          storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
          if (toolFailed && !isPrecedingChapterPublishGateError(new Error(toolErrorMessage))) {
            await noteDiscussBlock(
              "tool_failed",
              renderRuntimePrompt("discuss-repairs", "tool-failed-without-result", { toolName: toolRequest.name, reason: toolErrorMessage || "工具执行失败" }),
            )
          }
          if (toolResult.status === "reference_imported" || toolResult.status === "character_updated") {
            // Imports add files mid-send. Both the next model request and the
            // read executor must use the refreshed inventory, not the bootstrap snapshot.
            catalog = await this.dependencies.catalog.createSnapshot({
              snapshotId: this.dependencies.createId(),
              projectId: input.projectId,
              workspaceRootRef: input.workspaceRootRef,
              generatedAtMs: this.dependencies.now(),
            })
          }
          if (!toolFailed && toolRequest.action === "describe") {
            const previousDescription = visibleMessages.flatMap((message) => {
              if (message.role !== "system" || message.kind !== "phase_instruction") return []
              try {
                const result = JSON.parse(message.content)
                return result?.protocol === "synopsis-tools-v1" && result.name === toolRequest.name
                  && result.action === "describe" && result.status === "described"
                  ? [result] : []
              } catch { return [] }
            }).at(-1)
            await recordStepOutcome(`tool:${toolRequest.name}:describe_no_progress`,
              previousDescription !== undefined && digest(previousDescription) === digest(toolResult)
                ? "工具说明未变化，重复读取没有产生实际进展；应执行工具或交付结果" : undefined)
          } else if (!toolFailed && toolRequest.action === "invoke") {
            await recordStepOutcome(`tool:${toolRequest.name}:describe_no_progress`)
          }
          await recordStepOutcome(`tool:${toolRequest.name}:${toolRequest.action}`,
            toolFailed ? toolErrorMessage || "工具执行失败" : undefined)
          if (!toolFailed && toolRequest.name === "todo_write" && toolRequest.action === "invoke") {
            await recordStepOutcome("todo_required")
            if (discussTodosAreSettled(synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos)) {
              await recordStepOutcome("todo_incomplete")
            }
          }
          synopsisConversationStreamHub.setContent(input.projectId, "", this.dependencies.now())
          if (toolRequest.name === "todo_write") {
            consecutiveTodoWrites += 1
            // The initial describe fetches a contract; later calls must change the plan or do real work.
            if (toolRequest.action === "invoke" || consecutiveTodoWrites > 1) {
              todoNoProgressStreak = advanceTodoNoProgressStreak(
                todoNoProgressStreak,
                todosBeforeTool,
                synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos,
              )
              if (toolRequest.action === "invoke") {
                await recordStepOutcome("todo_no_progress", todoNoProgressStreak > 0
                  ? "任务清单没有变化，未推进实际工作" : undefined)
                if (noProgressGuardEnabled && todoNoProgressStreak === noProgressGuardLimit - 1) {
                  todoLoopRepairIssued = true
                  autoContinueBlocked = true
                  await noteDiscussBlock("todo_no_progress", DISCUSS_TODO_NO_PROGRESS_HINT)
                }
              }
            }
            if (
              noProgressGuardEnabled
              && shouldStopTodoWriteLoop(
                todoNoProgressStreak, todoLoopRepairIssued, consecutiveTodoWrites, noProgressGuardLimit,
              )
            ) {
              return await stopDiscussLoop("任务清单连续重复更新，修复提示后仍未推进，已暂停自动推进。已保存结果与未完成任务均已保留，请检查阻塞原因后重试。")
            }
            if (
              noProgressGuardEnabled
              && shouldIssueTodoLoopRepair(
                todoNoProgressStreak, todoLoopRepairIssued, consecutiveTodoWrites, noProgressGuardLimit,
              )
            ) {
              todoLoopRepairIssued = true
              autoContinueBlocked = true
              await noteDiscussBlock("todo_no_progress", DISCUSS_TODO_NO_PROGRESS_HINT)
            }
          }
        } catch (error) {
          synopsisConversationStreamHub.upsertToolRun(input.projectId, {
            runId: toolRunId,
            name: toolRequest.name,
            action: toolRequest.action,
            ...(toolRequest.arguments === undefined ? {} : { arguments: toolRequest.arguments }),
            status: "failed",
            resultSummary: error instanceof Error ? error.message : String(error),
            round: toolRound,
          }, this.dependencies.now())
          await noteDiscussBlock(
            "tool_failed",
            renderRuntimePrompt("discuss-repairs", "tool-failed", { toolName: toolRequest.name, reason: (error instanceof Error ? error.message : String(error)).slice(0, 800) }),
          )
          throw error
        } finally {
          clearInterval(cancellationPoll)
        }
        attempt += 1
        continue
      }
      if (parsedResult.outcome !== "request_read" || requestedReads.length === 0) {
        const artifact = synopsisDiscussArtifactSchema.safeParse(parsedResult.artifact)
        if (!artifact.success) {
          if (!input.composeText && missingArtifactRetries < 2 && remainingCalls > 0) {
            missingArtifactRetries += 1
            const zodHint = artifact.error.issues
              .slice(0, 3)
              .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
              .join("；")
            await noteDiscussBlock(
              "invalid_artifact",
              zodHint.includes("toolRequest")
                ? discussPhaseContractRepairHint(zodHint)
                : renderRuntimePrompt("discuss-repairs", "artifact-invalid", { validationIssues: zodHint }),
            )
            attempt += 1
            continue
          }
          const message = "模型未返回完整讨论结果（缺少 artifact）。请重试发送。"
          await noteDiscussBlock("missing_artifact", message)
          throw new SynopsisInvalidStateError(message)
        }
        artifact.data = synopsisDiscussArtifactSchema.parse(restoreDiscussWrites(pendingWrites, artifact.data, input.chapterSequence))
        if (input.writeScope === undefined || input.writeScope.focus === true) {
          artifact.data = prepareUserFocusTransition(artifact.data, input.chapterSequence, input.userMessage)
        }
        const switchingAtUserRequest = (input.writeScope === undefined || input.writeScope.focus === true)
          && isCurrentUserFocusChange(artifact.data.focusChange, input.userMessage)
          && artifact.data.focusChange?.chapterSequence !== input.chapterSequence
        const scopeIssues = input.writeScope === undefined || switchingAtUserRequest || input.volumePlanning?.ready === false
          ? [] : assessDiscussWriteScope(input.writeScope, artifact.data, input.chapterSequence, latestToolDraft !== undefined, input.volumePlanning)
        if (input.model.classifyDiscussTurn !== undefined && allowChapterWorkflowTools
          && input.volumePlanning?.ready !== false && artifact.data.synopsisBody !== undefined
          && (artifact.data.outlineBody === undefined || artifact.data.chapterDraftProposal === undefined)) {
          scopeIssues.push("完整构思必须在同一回复交齐梗概、细纲和当前章草稿")
        }
        if (scopeIssues.length > 0) {
          const message = scopeIssues.join("；")
          if (writeScopeRetries >= 1 || remainingCalls <= 0 || budgetGraceUsed) {
            return await stopDiscussLoop(`本轮写入未通过校验，文件未保存。${message}`)
          }
          pendingWrites = undefined
          await noteDiscussBlock("planning_write_scope", renderRuntimePrompt("discuss-repairs", "write-scope", { issues: message }), { source: artifact.data })
          writeScopeRetries += 1
          attempt += 1
          continue
        }
        const hasDraftProposal = artifact.data.chapterDraftProposal !== undefined
          || (artifact.data.chapterDraftProposals?.length ?? 0) > 0
        if ((artifact.data.planningWriteIntent?.draft === "write" || hasDraftProposal)
          && !outlineToDraftGuideLoaded) {
          discussionDraftGuide = await this.dependencies.prompts.loadOutlineToDraftGuide()
          outlineToDraftGuideLoaded = true
          pendingWrites = retainDiscussWrites({
            ...artifact.data,
            chapterDraftProposal: undefined,
            chapterDraftProposals: undefined,
          })
          await noteDiscussBlock(
            "draft_guide_required",
            `${draftGuideHostNotice}${renderRuntimePrompt("discuss-repairs", "draft-guide-for-proposal")}`,
            { held: true },
          )
          attempt += 1
          continue
        }
        const presentation = input.presentation
        const draftLengthIssues = presentation === undefined ? [] : [
          ...(artifact.data.chapterDraftProposal === undefined ? [] : [{
            ...artifact.data.chapterDraftProposal, chapterSequence: input.chapterSequence,
          }]),
          ...(artifact.data.chapterDraftProposals ?? []),
        ].flatMap((proposal) => {
          const count = countDiscussDraftCharacters(proposal.heading, proposal.body)
          const { minimumWordCount, maximumWordCount } = presentation
          return count < minimumWordCount || count > maximumWordCount
            ? [`第${String(proposal.chapterSequence)}章正文为 ${String(count)} 字，要求 ${String(minimumWordCount)}–${String(maximumWordCount)} 字`]
            : []
        })
        if (draftLengthIssues.length > 0) {
          const message = draftLengthIssues.join("；")
          if (draftLengthRetries >= 1 || remainingCalls <= 0 || budgetGraceUsed) {
            return await stopDiscussLoop(`草稿未保存。${message}。`)
          }
          pendingWrites = retainDiscussWrites({ ...artifact.data, chapterDraftProposal: undefined, chapterDraftProposals: undefined })
          await noteDiscussBlock("draft_word_count", renderRuntimePrompt("discuss-repairs", "draft-word-count", { issues: message }), { held: true })
          draftLengthRetries += 1
          attempt += 1
          continue
        }
        pendingWrites = undefined
        if (input.volumePlanning?.ready === false) {
          const volumePlanMeta = artifact.data.volumePlanMeta
          const volumeSynopsis = artifact.data.volumeSynopsis
          const arcPlan = artifact.data.arcPlan
          const completeVolumePlan = volumePlanMeta?.targetChapterCount !== undefined
            && volumePlanMeta.targetWordCount !== undefined
            && volumeSynopsis !== undefined
            && volumeSynopsis.markdown.trim().length > 0
            && arcPlan !== undefined
            && arcPlan.markdown.trim().length > 0
          if (!completeVolumePlan && missingVolumePlanRetries < 1 && remainingCalls > 0) {
            await noteDiscussBlock(
              "volume_plan_required",
              firstVolumeText
                ? "请补齐卷规划的三个文本块：<compose-volume-synopsis>、<compose-volume-outline>、<compose-volume-meta>。"
                : renderRuntimePrompt("discuss-repairs", "volume-plan-required"),
              { source: artifact.data },
            )
            missingVolumePlanRetries += 1
            attempt += 1
            continue
          }
          if (completeVolumePlan && input.workStyleGate === undefined) {
            const settings = sanitizeCreationDeskSettings({
              update: artifact.data.creationDeskSettings,
              availableDescriptionRulePaths,
              availableProseStylePaths,
              availableNovelMajorCategoryRulePaths,
              availableNovelSubcategoryRulePaths,
            })
            const completeSettings = settings?.descriptionRulePath !== undefined
              && settings.proseStyleRulePath !== undefined
              && settings.minimumWordCount !== undefined
              && settings.maximumWordCount !== undefined
              && settings.boundaryPace !== undefined
              && settings.causalityFocus !== undefined
            if (!completeSettings) {
              if (missingCreationDeskSettingsRetries >= 1 || remainingCalls <= 0) {
                const message = "卷规划未完成：AI 未返回有效的写作设置结构化字段，控件没有切换。请重试卷规划。"
                await noteDiscussBlock("creation_desk_settings", message, { source: artifact.data })
                throw new SynopsisInvalidStateError(message)
              }
              missingCreationDeskSettingsRetries += 1
              pendingWrites = retainDiscussWrites(artifact.data)
              await noteDiscussBlock(
                "creation_desk_settings",
                firstVolumeText
                  ? "已保留卷规划。请补齐 <writing-settings> 文本块，使用本轮指定的键值格式和真实规则路径。"
                  : renderRuntimePrompt("discuss-repairs", "creation-desk-settings-required"),
                { source: artifact.data, held: true },
              )
              attempt += 1
              continue
            }
          }
        }
        if (input.workStyleGate !== undefined) {
          const validStylePaths = availableProseStylePaths.map((path) => path.replaceAll("\\", "/"))
          const validMajorCategoryPaths = new Set(availableNovelMajorCategoryRulePaths.map((path) => path.replaceAll("\\", "/")))
          const validSubcategoryPaths = new Set(availableNovelSubcategoryRulePaths.map((path) => path.replaceAll("\\", "/")))
          const recommendations = (artifact.data.choices ?? []).filter((choice) => (
            choice.action === "continue_discuss"
            && choice.workStyleSelection !== undefined
            && validStylePaths.includes(choice.workStyleSelection.proseStyleRulePath.replaceAll("\\", "/"))
            && validMajorCategoryPaths.has(choice.workStyleSelection.novelMajorCategoryRulePath.replaceAll("\\", "/"))
            && validSubcategoryPaths.has(choice.workStyleSelection.novelSubcategoryRulePath.replaceAll("\\", "/"))
          ))
          if (input.workStyleGate.status === "awaiting_choice") {
            const requiredRecommendations = Math.min(2, validStylePaths.length, validMajorCategoryPaths.size, validSubcategoryPaths.size)
            if (recommendations.length < requiredRecommendations) {
              await recordStepOutcome("style_recommendations", "风格候选未通过门禁，缺少有效的推荐选项")
              await noteDiscussBlock(
                "style_recommendations",
                renderRuntimePrompt("discuss-repairs", "style-recommendations-required"),
                { source: artifact.data },
              )
              attempt += 1
              continue
            }
          } else {
            const styleWrite = artifact.data.presentationWrites?.find((write) => (
              write.relativePath.replaceAll("\\", "/").replace(/^\.\//u, "") === WORK_STYLE_RULE_PATH
            ))
            const selectedPath = input.workStyleGate.selectedProseStylePath?.replaceAll("\\", "/")
            const styleWriteApproved = styleWrite !== undefined
              && selectedPath !== undefined
              && styleWrite.markdown.includes(selectedPath)
              && assessWorkStyleMarkdown(styleWrite.markdown).complete
            if (!styleWriteApproved && recommendations.length < Math.min(2, validStylePaths.length, validMajorCategoryPaths.size, validSubcategoryPaths.size)) {
              await recordStepOutcome("style_write", "作品风格写入未通过门禁")
              await noteDiscussBlock(
                "style_write",
                renderRuntimePrompt("discuss-repairs", "style-write-required", { selectedPath: selectedPath ?? "（缺失）", workStylePath: WORK_STYLE_RULE_PATH }),
                { source: artifact.data },
              )
              attempt += 1
              continue
            }
          }
          await recordStepOutcome("style_recommendations")
          await recordStepOutcome("style_write")
        }
        const turnTodos = synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos
        if (input.workStyleGate === undefined
          && discussArtifactRequiresTodos(artifact.data)
          && !discussTurnHasTodos(turnTodos)
          && todoRequiredRepairs < 2
          && remainingCalls > 0) {
          todoRequiredRepairs += 1
          pendingWrites = retainDiscussWrites(artifact.data)
          await noteDiscussBlock("todo_required", DISCUSS_TODO_REQUIRED_HINT, { source: artifact.data, held: true })
          attempt += 1
          continue
        }
        // Auto / Accept edits: do not end the turn with open todos (AI owns the list).
        // Plan mode may leave the checklist open as the deliverable plan.
        // continueTurn hands the open items to the auto-continued next turn.
        if (
          (input.agentMode ?? "auto") !== "plan"
          && artifact.data.continueTurn !== true
          && input.workStyleGate === undefined
          && discussTurnHasTodos(turnTodos)
          && !discussTodosAreSettled(turnTodos)
          && !todoLoopRepairIssued
        ) {
          if (!hasExplicitCallLimit && todoIncompleteRepairs >= 8) {
            return await stopDiscussLoop("任务清单连续未结清且模型未再更新，已暂停自动推进。已保存结果与未完成任务均已保留，请检查阻塞原因后重试。")
          }
          todoIncompleteRepairs += 1
          await recordStepOutcome("todo_incomplete", DISCUSS_TODO_INCOMPLETE_HINT)
          pendingWrites = retainDiscussWrites(artifact.data)
          await noteDiscussBlock("todo_incomplete", DISCUSS_TODO_INCOMPLETE_HINT, { source: artifact.data, held: true })
          attempt += 1
          continue
        }
        // Process gate: hook schedule (起势章/兑现章) — let the model fill it in instead of failing on apply.
        if (artifact.data.goalProposals !== undefined && artifact.data.goalProposals.length > 0 && goalScheduleRepairs < 2) {
          const scheduleIssues = await this.dependencies.goals.auditProposalSchedules(
            input.projectId,
            artifact.data.goalProposals,
          )
          if (scheduleIssues.length > 0) {
            goalScheduleRepairs += 1
            runtimeLog("info", "synopsis-conversation", "goal_schedule.gate_retry", {
              projectId: input.projectId,
              sessionId: input.sessionId,
              issues: scheduleIssues.length,
            })
            await noteDiscussBlock("goal_schedule", renderRuntimePrompt("discuss-repairs", "goal-schedule", {
              issues: scheduleIssues.map((issue) => `- ${issue}`).join("\n"),
            }), { source: artifact.data })
            attempt += 1
            continue
          }
        }
        // Process gate: cannot open draft N+k before chapter N is published — auto-defer / self-correct.
        const nextDraftSequence = await this.dependencies.chapters.nextChapterSequence(input.projectId)
        const indexedSequences = new Set(
          (await this.dependencies.chapterIndex.list(input.projectId)).map((chapter) => chapter.sequence),
        )
        const rawDraftProposals = artifact.data.chapterDraftProposals
        const focusDraftRequested = artifact.data.chapterDraftProposal !== undefined
        const currentVolumeSynopsisPlan = artifact.data.volumeChapterPlans?.find((plan) => (
          plan.chapterSequence === input.chapterSequence && hasPlanningContent(plan.synopsisBody, true)
        ))
        const currentVolumeOutlinePlan = artifact.data.volumeChapterPlans?.find((plan) => (
          plan.chapterSequence === input.chapterSequence && hasPlanningContent(plan.outlineBody, false)
        ))
        const missingRequiredSynopsisArtifact = artifact.data.planningWriteIntent?.synopsis !== undefined
          && !switchingAtUserRequest
          && !hasPlanningContent(artifact.data.synopsisBody ?? "", true)
          && currentVolumeSynopsisPlan === undefined
        if (
          missingRequiredSynopsisArtifact
          && missingSynopsisArtifactRetries < 1
          && !budgetGraceUsed
        ) {
          await noteDiscussBlock("synopsis_required", renderRuntimePrompt("discuss-repairs", "synopsis-required", { chapterSequence: input.chapterSequence }), { source: artifact.data })
          missingSynopsisArtifactRetries += 1
          attempt += 1
          continue
        }
        const missingSynopsisNotice = missingRequiredSynopsisArtifact
          ? `系统状态：第${String(input.chapterSequence)}章剧情梗概没有收到可保存的结构化内容，文件仍未写入；细纲和正文草稿不能越过梗概门禁。`
          : undefined
        const missingRequiredOutlineArtifact = artifact.data.planningWriteIntent?.outline !== undefined
          && !switchingAtUserRequest
          && hasPlanningContent(input.synopsisMarkdown, true)
          && !hasPlanningContent(artifact.data.outlineBody ?? "", false)
          && artifact.data.bodyEdits === undefined
          && currentVolumeOutlinePlan === undefined
        if (
          missingRequiredOutlineArtifact
          && missingOutlineArtifactRetries < 1
          && !budgetGraceUsed
        ) {
          await noteDiscussBlock("outline_required", renderRuntimePrompt("discuss-repairs", "outline-required", { chapterSequence: input.chapterSequence }), { source: artifact.data })
          missingOutlineArtifactRetries += 1
          attempt += 1
          continue
        }
        const draftSequences = [
          ...(rawDraftProposals?.map((proposal) => proposal.chapterSequence) ?? []),
          ...(focusDraftRequested ? [input.chapterSequence] : []),
        ]
        const { deferred: deferredDraftSequences } = partitionChapterDraftSequences(
          draftSequences,
          nextDraftSequence,
          indexedSequences,
        )
        const draftProposalRequired = !switchingAtUserRequest
          && input.writeScope?.volumeDrafts !== true
          && artifact.data.planningWriteIntent?.draft === "write"
        const hasCurrentChapterDraftProposal = artifact.data.chapterDraftProposal !== undefined
          && artifact.data.chapterDraftProposal.body.trim().length > 0
          || (rawDraftProposals?.some((proposal) => (
            proposal.chapterSequence === input.chapterSequence && proposal.body.trim().length > 0
          )) ?? false)
          || latestToolDraft !== undefined
        const missingRequiredDraftProposal = draftProposalRequired && !hasCurrentChapterDraftProposal
        if (missingRequiredDraftProposal && missingDraftProposalRetries < 1 && !budgetGraceUsed) {
          await noteDiscussBlock("draft_required", renderRuntimePrompt("discuss-repairs", "draft-required", { chapterSequence: input.chapterSequence }), { source: artifact.data })
          missingDraftProposalRetries += 1
          attempt += 1
          continue
        }
        const missingDraftNotice = missingRequiredDraftProposal
          ? `系统状态：模型未返回第${String(input.chapterSequence)}章的有效结构化草稿提案，正文没有写入草稿版本。请重试「按细纲写正文」。`
          : undefined
        const allowedDraftProposals = rawDraftProposals?.filter((proposal) => (
          indexedSequences.has(proposal.chapterSequence) || proposal.chapterSequence <= nextDraftSequence
        ))
        const focusDraftAllowed = !focusDraftRequested
          || indexedSequences.has(input.chapterSequence)
          || input.chapterSequence <= nextDraftSequence
        let deferredDraftNotice: string | undefined
        if (deferredDraftSequences.length > 0) {
          this.applyChapterSequenceTodoGate(
            input.projectId,
            input.sessionId,
            nextDraftSequence,
            deferredDraftSequences,
          )
          const gateHint = discussChapterSequenceGateHint(nextDraftSequence, deferredDraftSequences)
          await this.dependencies.conversation.appendDiscussContextMessages({
            sessionId: input.sessionId,
            projectId: input.projectId,
            createdAtMs: this.dependencies.now(),
            messages: [{
              role: "system",
              kind: "phase_instruction",
              content: JSON.stringify({
                protocol: "discuss-gate-v1",
                gate: "chapter_sequence_publish",
                nextSequence: nextDraftSequence,
                deferredSequences: deferredDraftSequences,
                message: gateHint,
              }),
            }],
          })
          storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
          const hadDraftIntent = focusDraftRequested
            || (rawDraftProposals !== undefined && rawDraftProposals.length > 0)
          const allowedAnyDraft = (focusDraftRequested && focusDraftAllowed)
            || (allowedDraftProposals !== undefined && allowedDraftProposals.length > 0)
            || latestToolDraft !== undefined
          if (shouldRetryDeferredChapterDraft({
            hadDraftIntent,
            hasAllowedDraft: allowedAnyDraft,
            deferredSequences: deferredDraftSequences,
            remainingCalls,
          })) {
            repairHints.push([
              gateHint,
              renderRuntimePrompt("discuss-repairs", "draft-sequence", { chapterSequence: input.chapterSequence }),
            ].join("\n"))
            runtimeLog("warn", "synopsis-conversation", "chapter_sequence.gate_retry", {
              projectId: input.projectId,
              sessionId: input.sessionId,
              nextSequence: nextDraftSequence,
              deferredSequences: deferredDraftSequences,
            })
            remainingCalls -= 1
            attempt += 1
            continue
          }
          if (hadDraftIntent && !allowedAnyDraft) {
            const deferredLabels = [...new Set(deferredDraftSequences)].sort((a, b) => a - b)
              .map((sequence) => `第${String(sequence)}章`).join("、")
            deferredDraftNotice = `系统状态：本轮只收到${deferredLabels}的草稿提案，顺序门禁已拒绝，当前焦点第${String(input.chapterSequence)}章没有生成或保存正文草稿。`
          }
        }

        const finalAssistantMessage = missingSynopsisNotice !== undefined
          ? missingSynopsisNotice
          : [originalWorkFallbackNotice, artifact.data.assistantMessage, deferredDraftNotice, missingDraftNotice]
              .filter((part): part is string => part !== undefined)
              .join("\n\n")
        synopsisConversationStreamHub.setContent(input.projectId, finalAssistantMessage, this.dependencies.now())
        synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
          ...(accumulatedReasoning.length === 0 ? {} : { thinking: accumulatedReasoning }),
          content: finalAssistantMessage,
        })
        return finalizeDiscussReturn(input.projectId, latestBudgetAdvisory, {
          content: finalAssistantMessage,
          ...(autoContinueBlocked ? { autoContinueBlocked: true } : {}),
          availableProseStylePaths,
          availableDescriptionRulePaths,
          availableNovelMajorCategoryRulePaths,
          availableNovelSubcategoryRulePaths,
          ...(accumulatedReasoning.length === 0 ? {} : { reasoningContent: accumulatedReasoning }),
          ...(artifact.data.chapterTitle === undefined ? {} : { chapterTitle: artifact.data.chapterTitle }),
          ...(artifact.data.titleAlignTarget === undefined
            ? {}
            : { titleAlignTarget: artifact.data.titleAlignTarget }),
          ...(artifact.data.volumeFolderName === undefined
            ? {}
            : { volumeFolderName: artifact.data.volumeFolderName }),
          ...(artifact.data.workDisplayName === undefined
            ? {}
            : { workDisplayName: artifact.data.workDisplayName }),
          ...(artifact.data.workDescription === undefined
            ? {}
            : { workDescription: artifact.data.workDescription }),
          ...(artifact.data.synopsisBody === undefined ? {} : { synopsisBody: artifact.data.synopsisBody }),
          ...(artifact.data.planningWriteIntent === undefined
            ? {} : { planningWriteIntent: artifact.data.planningWriteIntent }),
          ...(artifact.data.outlineBody === undefined ? {} : { outlineBody: artifact.data.outlineBody }),
          ...(artifact.data.bodyEdits === undefined
            ? {}
            : {
                bodyEdits: {
                  target: artifact.data.bodyEdits.target,
                  ...(artifact.data.bodyEdits.baseDigest === undefined
                    ? {}
                    : { baseDigest: artifact.data.bodyEdits.baseDigest }),
                  ops: artifact.data.bodyEdits.ops,
                },
              }),
          ...mapArtifactChapterDraftProposal(
            focusDraftAllowed ? artifact.data.chapterDraftProposal : undefined,
          ),
          ...mapArtifactChapterDraftProposals(allowedDraftProposals),
          ...mapArtifactVolumeChapterPlans(artifact.data.volumeChapterPlans),
          ...(artifact.data.volumePlanMeta === undefined ? {} : { volumePlanMeta: artifact.data.volumePlanMeta }),
          ...(artifact.data.creationDeskSettings === undefined
            ? {}
            : { creationDeskSettings: artifact.data.creationDeskSettings }),
          ...(latestToolDraft === undefined ? {} : { appendedDraft: {
            revisionTaskId: latestToolDraft.revisionTaskId,
            chapterId: latestToolDraft.chapterId,
            draftVersionId: latestToolDraft.draftVersionId,
            draftLabel: latestToolDraft.draftLabel,
          } }),
          ...mapArtifactFocusChange(artifact.data.focusChange),
          ...(artifact.data.continueTurn === true ? { continueTurn: true } : {}),
          ...(artifact.data.choices === undefined ? {} : { choices: artifact.data.choices }),
          ...(artifact.data.stagingDelta === undefined
            ? {}
            : { stagingDelta: mapSynopsisStagingDelta(artifact.data.stagingDelta) }),
          ...(artifact.data.stagingPromote === undefined
            ? {}
            : { stagingPromote: mapSynopsisStagingPromote(artifact.data.stagingPromote) }),
          ...(artifact.data.presentationWrites !== undefined
            ? { presentationWrites: mapSynopsisPresentationWrites(artifact.data.presentationWrites) }
            : {}),
          ...(artifact.data.arcPlan === undefined
            ? {}
            : { arcPlanMarkdown: artifact.data.arcPlan.markdown }),
          ...(artifact.data.volumeSynopsis === undefined
            ? {}
            : { volumeSynopsisMarkdown: artifact.data.volumeSynopsis.markdown }),
          ...(artifact.data.goalProposals === undefined
            ? {}
            : {
                goalProposals: artifact.data.goalProposals.map((proposal) => ({
                  payload: proposal.payload,
                  ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
                })),
              }),
        })
      }

      await releaseHeldWrites(renderRuntimePrompt("discuss-repairs", "release-held-on-read"))
      if (retrievalRounds >= maxRetrievalRounds || budgetGraceUsed) {
        runtimeLog("warn", "synopsis-conversation", "retrieval.exhausted", {
          projectId: input.projectId,
          sessionId: input.sessionId,
          attempt,
          requestedReadCount: requestedReads.length,
        })
        if (input.writeScope !== undefined) {
          return await stopDiscussLoop("本轮读取预算已用完，模型仍在请求资料，未提交可验证的写入结果。")
        }
        const artifact = synopsisDiscussArtifactSchema.safeParse(parsedResult.artifact)
        if (artifact.success) {
          artifact.data = prepareUserFocusTransition(artifact.data, input.chapterSequence, input.userMessage)
          const switchingAtUserRequest = isCurrentUserFocusChange(artifact.data.focusChange, input.userMessage)
            && artifact.data.focusChange?.chapterSequence !== input.chapterSequence
          const nextDraftSequence = await this.dependencies.chapters.nextChapterSequence(input.projectId)
          const indexedSequences = new Set(
            (await this.dependencies.chapterIndex.list(input.projectId)).map((chapter) => chapter.sequence),
          )
          const rawDraftProposals = artifact.data.chapterDraftProposals
          const focusDraftRequested = artifact.data.chapterDraftProposal !== undefined
          const draftSequences = [
            ...(rawDraftProposals?.map((proposal) => proposal.chapterSequence) ?? []),
            ...(focusDraftRequested ? [input.chapterSequence] : []),
          ]
          const { deferred: deferredDraftSequences } = partitionChapterDraftSequences(
            draftSequences,
            nextDraftSequence,
            indexedSequences,
          )
          const draftProposalRequired = !switchingAtUserRequest
            && artifact.data.planningWriteIntent?.draft === "write"
          const currentVolumeSynopsisPlan = artifact.data.volumeChapterPlans?.find((plan) => (
            plan.chapterSequence === input.chapterSequence && hasPlanningContent(plan.synopsisBody, true)
          ))
          const missingSynopsisNotice = artifact.data.planningWriteIntent?.synopsis !== undefined
            && !switchingAtUserRequest
            && !hasPlanningContent(artifact.data.synopsisBody ?? "", true)
            && currentVolumeSynopsisPlan === undefined
            ? `系统状态：第${String(input.chapterSequence)}章剧情梗概没有收到可保存的结构化内容，文件仍未写入；细纲和正文草稿不能越过梗概门禁。`
            : undefined
          const currentVolumeOutlinePlan = artifact.data.volumeChapterPlans?.find((plan) => (
            plan.chapterSequence === input.chapterSequence && hasPlanningContent(plan.outlineBody, false)
          ))
          const missingOutlineNotice = artifact.data.planningWriteIntent?.outline !== undefined
            && !switchingAtUserRequest
            && hasPlanningContent(input.synopsisMarkdown, true)
            && !hasPlanningContent(artifact.data.outlineBody ?? "", false)
            && artifact.data.bodyEdits === undefined
            && currentVolumeOutlinePlan === undefined
            ? `系统状态：模型未返回第${String(input.chapterSequence)}章的有效结构化细纲，细纲文件仍未写入；正文草稿不能越过细纲门禁。`
            : undefined
          const hasCurrentChapterDraftProposal = artifact.data.chapterDraftProposal !== undefined
            && artifact.data.chapterDraftProposal.body.trim().length > 0
            || (rawDraftProposals?.some((proposal) => (
              proposal.chapterSequence === input.chapterSequence && proposal.body.trim().length > 0
            )) ?? false)
          const missingDraftNotice = draftProposalRequired
            && !hasCurrentChapterDraftProposal
            && latestToolDraft === undefined
            ? `系统状态：模型未返回第${String(input.chapterSequence)}章的有效结构化草稿提案，正文没有写入草稿版本。请重试「按细纲写正文」。`
            : undefined
          const allowedDraftProposals = rawDraftProposals?.filter((proposal) => (
            indexedSequences.has(proposal.chapterSequence) || proposal.chapterSequence <= nextDraftSequence
          ))
          const focusDraftAllowed = !focusDraftRequested
            || indexedSequences.has(input.chapterSequence)
            || input.chapterSequence <= nextDraftSequence
          const hasAllowedDraft = (focusDraftRequested && focusDraftAllowed)
            || (allowedDraftProposals !== undefined && allowedDraftProposals.length > 0)
          const hasDraftIntent = focusDraftRequested || (rawDraftProposals?.length ?? 0) > 0
          const gateNotice = hasDraftIntent && deferredDraftSequences.length > 0 && !hasAllowedDraft
            ? `系统状态：草稿提案${[...new Set(deferredDraftSequences)].sort((a, b) => a - b).map((sequence) => `第${String(sequence)}章`).join("、")}未通过章节顺序门禁，当前焦点第${String(input.chapterSequence)}章没有生成或保存正文草稿。`
            : undefined

        const finalAssistantMessage = missingSynopsisNotice !== undefined
            ? missingSynopsisNotice
          : missingOutlineNotice !== undefined
            ? missingOutlineNotice
            : [originalWorkFallbackNotice, artifact.data.assistantMessage, gateNotice, missingDraftNotice]
                .filter((part): part is string => part !== undefined)
                .join("\n\n")
          synopsisConversationStreamHub.setContent(input.projectId, finalAssistantMessage, this.dependencies.now())
          synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
            ...(accumulatedReasoning.length === 0 ? {} : { thinking: accumulatedReasoning }),
            content: finalAssistantMessage,
          })
          return finalizeDiscussReturn(input.projectId, latestBudgetAdvisory, {
            content: finalAssistantMessage,
            ...(autoContinueBlocked ? { autoContinueBlocked: true } : {}),
            availableProseStylePaths,
            availableDescriptionRulePaths,
            availableNovelMajorCategoryRulePaths,
            availableNovelSubcategoryRulePaths,
            ...(accumulatedReasoning.length === 0 ? {} : { reasoningContent: accumulatedReasoning }),
            ...(artifact.data.chapterTitle === undefined ? {} : { chapterTitle: artifact.data.chapterTitle }),
            ...(artifact.data.titleAlignTarget === undefined
              ? {}
              : { titleAlignTarget: artifact.data.titleAlignTarget }),
            ...(artifact.data.volumeFolderName === undefined
              ? {}
              : { volumeFolderName: artifact.data.volumeFolderName }),
            ...(artifact.data.workDisplayName === undefined
              ? {}
              : { workDisplayName: artifact.data.workDisplayName }),
            ...(artifact.data.workDescription === undefined
              ? {}
              : { workDescription: artifact.data.workDescription }),
            ...(artifact.data.synopsisBody === undefined ? {} : { synopsisBody: artifact.data.synopsisBody }),
            ...(artifact.data.planningWriteIntent === undefined
              ? {} : { planningWriteIntent: artifact.data.planningWriteIntent }),
            ...(artifact.data.outlineBody === undefined ? {} : { outlineBody: artifact.data.outlineBody }),
            ...(artifact.data.bodyEdits === undefined
              ? {}
              : {
                  bodyEdits: {
                    target: artifact.data.bodyEdits.target,
                    ...(artifact.data.bodyEdits.baseDigest === undefined
                      ? {}
                      : { baseDigest: artifact.data.bodyEdits.baseDigest }),
                    ops: artifact.data.bodyEdits.ops,
                  },
                }),
            ...mapArtifactChapterDraftProposal(focusDraftAllowed ? artifact.data.chapterDraftProposal : undefined),
            ...mapArtifactChapterDraftProposals(allowedDraftProposals),
            ...mapArtifactVolumeChapterPlans(artifact.data.volumeChapterPlans),
            ...(artifact.data.volumePlanMeta === undefined ? {} : { volumePlanMeta: artifact.data.volumePlanMeta }),
            ...(artifact.data.creationDeskSettings === undefined
              ? {}
              : { creationDeskSettings: artifact.data.creationDeskSettings }),
            ...(latestToolDraft === undefined ? {} : { appendedDraft: {
              revisionTaskId: latestToolDraft.revisionTaskId,
              chapterId: latestToolDraft.chapterId,
              draftVersionId: latestToolDraft.draftVersionId,
              draftLabel: latestToolDraft.draftLabel,
            } }),
            ...mapArtifactFocusChange(artifact.data.focusChange),
            ...(artifact.data.continueTurn === true ? { continueTurn: true } : {}),
            ...(artifact.data.choices === undefined ? {} : { choices: artifact.data.choices }),
            ...(artifact.data.stagingDelta === undefined
              ? {}
              : { stagingDelta: mapSynopsisStagingDelta(artifact.data.stagingDelta) }),
            ...(artifact.data.stagingPromote === undefined
              ? {}
              : { stagingPromote: mapSynopsisStagingPromote(artifact.data.stagingPromote) }),
            ...(artifact.data.presentationWrites === undefined
              ? {}
              : { presentationWrites: mapSynopsisPresentationWrites(artifact.data.presentationWrites) }),
            ...(artifact.data.arcPlan === undefined
              ? {}
              : { arcPlanMarkdown: artifact.data.arcPlan.markdown }),
            ...(artifact.data.volumeSynopsis === undefined
              ? {}
              : { volumeSynopsisMarkdown: artifact.data.volumeSynopsis.markdown }),
            ...(artifact.data.goalProposals === undefined
              ? {}
              : {
                  goalProposals: artifact.data.goalProposals.map((proposal) => ({
                    payload: proposal.payload,
                    ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
                  })),
                }),
          })
        }
        const fallback = finalizeDiscussReturn(
          input.projectId,
          latestBudgetAdvisory,
          {
            ...buildSynopsisDiscussFallbackReturn({
              projectId: input.projectId,
              accumulatedReasoning,
              streamedContent: synopsisConversationStreamHub.peek(input.projectId).content,
            }),
            availableProseStylePaths,
            availableDescriptionRulePaths,
            availableNovelMajorCategoryRulePaths,
            availableNovelSubcategoryRulePaths,
          },
        )
        synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), {
          ...(fallback.reasoningContent === undefined ? {} : { thinking: fallback.reasoningContent }),
          content: fallback.content,
        })
        return fallback
      }

      if (input.workStyleGate === undefined
        && !discussTurnHasTodos(synopsisConversationStreamHub.peek(input.projectId, input.sessionId).todos)
        && todoRequiredRepairs < 2
        && remainingCalls > 0) {
        todoRequiredRepairs += 1
        await noteDiscussBlock("todo_required", DISCUSS_TODO_REQUIRED_HINT)
        attempt += 1
        continue
      }

      consecutiveTodoWrites = 0
      todoNoProgressStreak = 0
      todoLoopRepairIssued = false

      retrievalRounds += 1
      const searchRound = attempt + 1
      for (const read of requestedReads) {
        const label = synopsisSearchLabel(read)
        synopsisConversationStreamHub.upsertSearch(input.projectId, {
          query: label,
          status: "running",
          round: searchRound,
          ...temporalSearchMeta(read),
        }, this.dependencies.now())
      }

      const webReads = requestedReads.filter((read) => read.query.sourceKinds.includes("web"))
      let webEvidence: TurnReadEvidence[] = []
      if (webReads.length > 0) {
        webEvidence = [...await executeSynopsisWebReads({
          requests: webReads,
          existingEvidence: readEvidence,
          createId: this.dependencies.createId,
          ...(this.dependencies.webResearch === undefined ? {} : { webResearch: this.dependencies.webResearch }),
          localReferences: {
            workspace: this.dependencies.workspace,
            workspaceRootRef: input.workspaceRootRef,
            catalog,
            now: this.dependencies.now,
          },
          ...(settings === undefined ? {} : { settings }),
        })]
      }

      const temporalReads = requestedReads
        .filter((read) => isTemporalReadRequest(read))
        .slice(0, MAX_TEMPORAL_READS_PER_ROUND)
      const workspaceReads = requestedReads.filter((read) => (
        !isTemporalReadRequest(read) && !read.query.sourceKinds.includes("web")
      ))

      const temporalEvidence = await executeSynopsisTemporalReads({
        projectId: input.projectId,
        sessionChapterSequence: input.chapterSequence,
        workspaceRootRef: input.workspaceRootRef,
        workspace: this.dependencies.workspace,
        catalog,
        requests: temporalReads,
        existingEvidence: readEvidence,
        settingsLineage: this.dependencies.settingsLineage,
        chapterIndex: this.dependencies.chapterIndex,
        documents: this.dependencies.documents,
        internalStore: this.dependencies.internalStore,
        chapterTemporal: this.dependencies.chapterTemporal,
        createId: this.dependencies.createId,
        maxCandidates: settings?.retrieval.maxCandidates ?? defaultProjectSettings.retrieval.maxCandidates,
      })
      readEvidence = [...readEvidence, ...temporalEvidence, ...webEvidence]

      const workspaceEvidence = workspaceReads.length === 0
        ? []
        : await executeSynopsisWorkspaceReads({
          workspace: this.dependencies.workspace,
          workspaceRootRef: input.workspaceRootRef,
          catalog,
          requests: workspaceReads,
          existingEvidence: readEvidence,
          createId: this.dependencies.createId,
          maxCandidates: settings?.retrieval.maxCandidates ?? defaultProjectSettings.retrieval.maxCandidates,
          maxRequestsPerRound: settings?.retrieval.maxRequestsPerRound
            ?? defaultProjectSettings.retrieval.maxRequestsPerRound,
          allowWorkspaceChapterReads: true,
        })
      readEvidence = [...readEvidence, ...workspaceEvidence]
      const newEvidence = [...temporalEvidence, ...webEvidence, ...workspaceEvidence]

      if (originalWorkContext && webEvidence.some((item) => item.ownerKind.startsWith("web:"))) {
        await this.dependencies.conversation.appendDiscussContextMessages({
          sessionId: input.sessionId,
          projectId: input.projectId,
          createdAtMs: this.dependencies.now(),
          messages: [{
            role: "system",
            kind: "phase_instruction",
            content: JSON.stringify({
              protocol: "original-work-evidence-gate-v1",
              stage: "web_attempted",
              matchedEvidenceCount: webEvidence.filter((item) => item.ownerKind === "web:page").length,
            }),
          }],
        })
        storedContext = [...await this.dependencies.conversation.listDiscussContextMessages(input.sessionId)]
      }

      for (const read of requestedReads) {
        const label = synopsisSearchLabel(read)
        const matched = newEvidence.filter((item) => evidenceMatchesRead(item, read))
        const isWeb = read.query.sourceKinds.includes("web")
        const summary = matched.length === 0
          ? (isWeb ? "联网检索无可用证据" : "未命中可读内容")
          : matched.map((item) => {
              if (item.ownerKind === "web:diagnostic") return item.semanticText.slice(0, 2_000)
              if (item.ownerKind.startsWith("web:")) {
                const preview = item.semanticText.split("\n").slice(0, 4).join("\n")
                return `${item.ownerId}（${String(item.semanticText.length)} 字）\n${preview}`
              }
              const temporalNote = item.temporalRole === "as_of" && item.asOfChapterSequence !== undefined
                ? `第${String(item.asOfChapterSequence)}章视角 · `
                : ""
              return `${temporalNote}${item.ownerId}（${item.semanticText.length} 字）`
            }).join("\n")
        synopsisConversationStreamHub.upsertSearch(input.projectId, {
          query: label,
          status: matched.length === 0 || matched.every((item) => item.ownerKind === "web:diagnostic") ? "failed" : "completed",
          resultSummary: summary,
          round: searchRound,
          ...temporalSearchMeta(read),
        }, this.dependencies.now())
      }

      if (newEvidence.length === 0 && webReads.length === 0) {
        retrievalGaps = [
          ...retrievalGaps,
          ...requestedReads.map((read) => ({
            typeId: "system:retrieval-gap" as const,
            requestId: read.requestId,
            expectedEvidence: read.expectedEvidence,
            reason: read.reason,
            query: read.query,
          })),
        ]
        runtimeLog("debug", "synopsis-conversation", "retrieval.no_new_evidence", {
          projectId: input.projectId,
          sessionId: input.sessionId,
          attempt,
          gapCount: requestedReads.length,
        })
      }

      runtimeLog("debug", "synopsis-conversation", "retrieval.round_completed", {
        projectId: input.projectId,
        sessionId: input.sessionId,
        attempt,
        newEvidenceCount: newEvidence.length,
        totalEvidenceCount: readEvidence.length,
      })
      attempt += 1
    }
  }

  private async bootstrapSynopsisEvidence(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    catalog: WorkspaceCatalogSnapshot
    presentation?: Readonly<{
      descriptionRulePath?: string | undefined
      proseStyleRulePath?: string | undefined
      novelMajorCategoryRulePath?: string | undefined
      novelSubcategoryRulePath?: string | undefined
      minimumWordCount: number
      maximumWordCount: number
    }>
  }>): Promise<readonly TurnReadEvidence[]> {
    const bootstrapPaths = ["设定集/readme.md", "参考文件/readme.md", AGENT_MEMORY_INDEX_PATH]
    const descriptionPaths = resolveDescriptionRulePaths(
      input.presentation?.descriptionRulePath,
      input.catalog.entries,
    )
    const prosePath = input.presentation?.proseStyleRulePath?.trim()
    const presentationPaths = [
      ...descriptionPaths,
      ...(prosePath !== undefined && prosePath.length > 0 && isPresentationRuleMarkdownPath(prosePath)
        ? [prosePath]
        : []),
      ...(input.presentation?.novelMajorCategoryRulePath === undefined ? [] : [input.presentation.novelMajorCategoryRulePath]),
      ...(input.presentation?.novelSubcategoryRulePath === undefined ? [] : [input.presentation.novelSubcategoryRulePath]),
    ]
    const overlayPaths = listWorkDescriptionRuleFiles(input.catalog.entries).map((entry) => entry.relativePath)
    const userRulePaths = listUserRuleMarkdownPaths(input.catalog.entries)
    const bootstrapCap = bootstrapPaths.length
      + presentationPaths.length
      + overlayPaths.length
      + userRulePaths.length
    const bootstrapRequest = {
      requestId: this.dependencies.createId(),
      reason: "Bootstrap settings, reference indexes, agent memory, user rules, and selected presentation rules for synopsis discuss",
      expectedEvidence: "设定集/参考索引、Agent 记忆索引、用户规则与本轮描写笔风规则",
      query: {
        exactKeys: [...bootstrapPaths, ...presentationPaths, ...overlayPaths, ...userRulePaths],
        semanticTexts: [
          "设定集索引",
          "参考文件索引",
          "Agent记忆",
          ...presentationPaths,
          ...overlayPaths,
          ...userRulePaths,
        ],
        anchorIds: [] as string[],
        directions: ["both" as const],
        maxCandidates: bootstrapCap,
        maxDepth: 1,
        // Always include rule so Agent记忆（world_rules）is readable even when no user/presentation rules.
        sourceKinds: ["reference" as const, "rule" as const],
      },
    }
    const label = formatSynopsisSearchLabel(bootstrapRequest)
    synopsisConversationStreamHub.upsertSearch(input.projectId, {
      query: label,
      status: "running",
      round: 0,
    }, this.dependencies.now())
    try {
      const evidence = await executeSynopsisWorkspaceReads({
        workspace: this.dependencies.workspace,
        workspaceRootRef: input.workspaceRootRef,
        catalog: input.catalog,
        requests: [bootstrapRequest],
        existingEvidence: [],
        createId: this.dependencies.createId,
        maxCandidates: bootstrapCap,
        maxRequestsPerRound: 1,
        allowWorkspaceChapterReads: true,
      })
      const capped = evidence.map((item) => {
        if (item.ownerId !== AGENT_MEMORY_INDEX_PATH) return item
        const truncated = truncateAgentMemoryIndex(item.semanticText)
        if (!truncated.truncated) return item
        return {
          ...item,
          semanticText: truncated.text,
          digest: digest(truncated.text),
        }
      })
      synopsisConversationStreamHub.upsertSearch(input.projectId, {
        query: label,
        status: capped.length === 0 ? "failed" : "completed",
        round: 0,
        resultSummary: capped.length === 0
          ? "未找到设定集/参考索引"
          : capped.map((item) => `${item.ownerId}（${item.semanticText.length} 字）`).join("\n"),
      }, this.dependencies.now())
      return capped
    } catch (error) {
      synopsisConversationStreamHub.upsertSearch(input.projectId, {
        query: label,
        status: "failed",
        round: 0,
        resultSummary: error instanceof Error ? error.message : String(error),
      }, this.dependencies.now())
      return []
    }
  }

  private applyToolExclusiveTodoGate(
    projectId: ProjectId,
    sessionId: string,
    strippedKeys: readonly string[],
  ): void {
    if (strippedKeys.length === 0) return
    const current = synopsisConversationStreamHub.peek(projectId, sessionId).todos
    const aligned = alignTodosForToolExclusiveGate(current, strippedKeys)
    synopsisConversationStreamHub.setTodos(projectId, aligned, this.dependencies.now(), { merge: false })
  }

  /** Wait for pending publication so `targetSequence` becomes reachable; returns the next open sequence. */
  private async waitForChapterSequenceGate(
    projectId: ProjectId,
    targetSequence: number,
    timeoutMs = 240_000,
  ): Promise<number> {
    let nextSequence = await this.dependencies.chapters.nextChapterSequence(projectId)
    if (targetSequence <= nextSequence || this.dependencies.waitForPendingPublications === undefined) {
      return nextSequence
    }
    runtimeLog("info", "synopsis-conversation", "chapter_sequence.gate_wait", { projectId, targetSequence, nextSequence })
    await this.dependencies.waitForPendingPublications({ timeoutMs })
    nextSequence = await this.dependencies.chapters.nextChapterSequence(projectId)
    return nextSequence
  }

  private applyChapterSequenceTodoGate(
    projectId: ProjectId,
    sessionId: string,
    nextSequence: number,
    deferredSequences: readonly number[],
  ): void {
    if (deferredSequences.length === 0) return
    const current = synopsisConversationStreamHub.peek(projectId, sessionId).todos
    const aligned = alignTodosForChapterSequenceGate(current, nextSequence, deferredSequences)
    synopsisConversationStreamHub.setTodos(projectId, aligned, this.dependencies.now(), { merge: false })
  }

  private emitDiscussEdit(projectId: ProjectId, edit: SynopsisConversationStreamEdit): void {
    synopsisConversationStreamHub.upsertEdit(projectId, edit, this.dependencies.now())
  }

  private async applyPresentationWrites(input: Readonly<{
    workspaceRootRef: string
    writes: readonly Readonly<{
      relativePath: string
      markdown: string
      mode: "create" | "update"
    }>[]
  }>): Promise<void> {
    const inventory = (await this.dependencies.workspace.validate(input.workspaceRootRef)).inventory
    try {
      assertWorkDescriptionWriteBatch({
        existingPaths: inventory.filter((entry) => entry.kind === "file").map((entry) => entry.path),
        writes: input.writes,
      })
    } catch (error) {
      throw new SynopsisInvalidStateError(error instanceof Error ? error.message : String(error))
    }
    for (const write of input.writes) {
      const path = write.relativePath.trim().replace(/\\/gu, "/")
      assertWorkspaceMutationAllowed(path, "file", "user")
      await this.dependencies.workspace.saveUserMarkdown(
        input.workspaceRootRef,
        path,
        write.markdown,
      )
    }
  }

  private async applyStagingDelta(input: Readonly<{
    workspaceRootRef: string
    sourceMessageId: string
    delta: Readonly<{
      notes?: readonly StagingEntryPatch[]
      characters?: readonly StagingEntryPatch[]
      worldRules?: readonly StagingEntryPatch[]
      promoteHints?: readonly StagingEntryPatch[]
    }>
  }>): Promise<readonly string[]> {
    const settings = this.dependencies.readProjectSettings === undefined
      ? undefined
      : await this.dependencies.readProjectSettings()
    const maxChars = settings?.staging.maxChars ?? defaultProjectSettings.staging.maxChars
    const nowMs = this.dependencies.now()
    const fileSpecs: ReadonlyArray<{
      path: string
      patches: readonly StagingEntryPatch[] | undefined
    }> = [
      { path: STAGING_FILE_KEYS.notes, patches: input.delta.notes },
      { path: STAGING_FILE_KEYS.characters, patches: input.delta.characters },
      { path: STAGING_FILE_KEYS.world, patches: input.delta.worldRules },
      { path: STAGING_FILE_KEYS.promoteIndex, patches: input.delta.promoteHints },
    ]
    const mergedByPath: Record<string, StagingEntry[]> = {}
    for (const spec of fileSpecs) {
      const raw = await this.readSynopsisFile(input.workspaceRootRef, spec.path)
      const existing = parseStagingEntries(raw)
      const patches = (spec.patches ?? []).map((patch) => ({
        ...patch,
        ...(patch.status === undefined ? {} : { status: patch.status }),
      }))
      mergedByPath[spec.path] = mergeStagingPatches(
        existing,
        patches,
        nowMs,
        this.dependencies.createId,
      ).map((entry) => (
        entry.sourceMessageId === undefined
          ? { ...entry, sourceMessageId: input.sourceMessageId }
          : entry
      ))
    }
    const evicted = evictStagingEntries(
      mergedByPath,
      maxChars,
      (fileKey, entries) => serializeStagingEntries(stagingFileTitle(fileKey), entries),
    )
    if (evicted.removedTitles.length > 0) {
      const notesPath = STAGING_FILE_KEYS.notes
      const notes = evicted.files[notesPath] ?? []
      notes.push({
        entryId: this.dependencies.createId(),
        title: "系统清理记录",
        body: evicted.removedTitles.map((title) => `[系统] 已清理暂存条目 ${title}（超字数上限）`).join("\n"),
        status: "settled",
        updatedAtMs: nowMs,
        settledAtMs: nowMs,
      })
      evicted.files[notesPath] = notes
    }
    const writtenPaths: string[] = []
    for (const [relativePath, entries] of Object.entries(evicted.files)) {
      await this.dependencies.workspace.saveUserMarkdown(
        input.workspaceRootRef,
        relativePath,
        serializeStagingEntries(stagingFileTitle(relativePath), entries),
      )
      writtenPaths.push(relativePath)
    }
    return writtenPaths
  }

  private resolveFocusChapterSequence(input: Readonly<{
    chapterSequence?: number
    relativePath?: string
  }>): number {
    if (input.chapterSequence !== undefined) return input.chapterSequence
    const relativePath = input.relativePath?.replaceAll("\\", "/")
    if (relativePath === undefined || relativePath.length === 0) {
      throw new SynopsisInvalidStateError("setFocus requires chapterSequence or relativePath")
    }
    const synopsis = parseSynopsisMarkdownPath(relativePath)
    if (synopsis?.sequence !== undefined) return synopsis.sequence
    const outline = parseOutlineMarkdownPath(relativePath)
    if (outline?.sequence !== undefined) return outline.sequence
    const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1).replace(/\.md$/u, "")
    const sequence = parseChapterSequenceFromLabel(filename)
    if (sequence !== undefined) return sequence
    throw new SynopsisInvalidStateError(`无法从路径解析章序号：${relativePath}`)
  }

  private resolveFocusKindFromPath(relativePath: string | undefined): DiscussFocusKind | undefined {
    if (relativePath === undefined || relativePath.length === 0) return undefined
    const normalized = relativePath.replaceAll("\\", "/")
    if (isSynopsisMarkdownPath(normalized)) return "plot_synopsis"
    if (isOutlineMarkdownPath(normalized)) return "plot_outline"
    if (isChapterBodyMarkdownPath(normalized)) return "chapter_body"
    return undefined
  }

  private async findExistingSynopsisForSequence(
    workspaceRootRef: string,
    chapterSequence: number,
  ): Promise<Readonly<{ path: string; title?: string }> | undefined> {
    const report = await this.dependencies.workspace.validate(workspaceRootRef)
    const matches = report.inventory
      .filter((entry) => entry.kind === "file")
      .map((entry) => {
        const validation = validateSynopsisMarkdownPath(entry.path)
        if (!validation.ok || validation.sequence !== chapterSequence) return undefined
        return {
          path: validation.path,
          ...(validation.title === undefined ? {} : { title: validation.title }),
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
    return matches[0]
  }

  public async recordTurnHandoff(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    brief: TurnHandoffBrief
    model: AIModelPort
    runAutoAnalysis?: boolean
    chapterIntent?: ChapterNarrativeIntent
  }>): Promise<void> {
    const started = await this.start({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
    })
    const session = started.session
    const nowMs = this.dependencies.now()
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: session.sessionId,
      role: "system",
      content: formatTurnHandoffSystemMessage(input.brief),
      createdAtMs: nowMs,
    })
    const volume = await this.readFocusedVolume(input.workspaceRootRef, session)
    if (!volume.started || (volume.atCap && volume.state?.endedAtMs === undefined)) return
    if (input.runAutoAnalysis === false) {
      await this.setFocus({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        chapterSequence: input.brief.chapterSequence + 1,
        focusKind: "plot_synopsis",
      })
      return
    }

    const handoffVolume = extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
    const protagonistSetup = await this.dependencies.creativeSetup.find(input.projectId, "protagonist")
    const volumeSetup = await this.dependencies.creativeSetup.find(input.projectId, `volume:${handoffVolume}`)
    const volumePlan = await this.readVolumePlanningState(input.workspaceRootRef, handoffVolume)
    const volumePlanningContext = await this.readVolumePlanningContext(input.workspaceRootRef, handoffVolume, volumePlan)
    if (protagonistSetup?.status !== "ready" || volumeSetup?.status !== "ready" || !volumePlanningContext.ready) return

    const synopsisMarkdown = await this.readSynopsisFile(input.workspaceRootRef, session.synopsisPath)
    const outlinePathForHandoff = siblingPlanningMarkdownPath(session.synopsisPath, "outline")
      ?? deriveOutlineMarkdownPath(
        session.chapterSequence,
        session.title,
        extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
      )
    const outlineMarkdown = await this.readSynopsisFile(input.workspaceRootRef, outlinePathForHandoff)
    const outlineDigest = outlineMarkdown.trim().length === 0 ? undefined : digest(outlineMarkdown)
    const chapterBodyMarkdown = await this.readFocusedCommittedBody(
      input.projectId,
      input.workspaceRootRef,
      session.chapterSequence,
    )
    const userEditedOutlineSinceAgent = session.lastOutlineAgentDigest !== undefined
      && outlineDigest !== undefined
      && session.lastOutlineAgentDigest !== outlineDigest
    const goalsSnapshot = await this.dependencies.goals.list(input.projectId)
    const activeGoals = selectGoalsForChapterContext(goalsSnapshot.goals, session.chapterSequence)
    const chapterProgress = goalsSnapshot.progress.filter(
      (item) => item.chapterSequence === session.chapterSequence && item.status !== "superseded",
    )
    const hookScheduleAudit = await this.dependencies.goals.auditHookSchedules(input.projectId)
    const assist = await this.runSynopsisDiscuss({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      sessionId: session.sessionId,
      userMessage: renderRuntimePrompt("discuss-messages", "post-turn-handoff", {
        handoff: formatTurnHandoffSystemMessage(input.brief),
      }),
      heading: session.title,
      chapterSequence: session.chapterSequence,
      synopsisMarkdown,
      outlineMarkdown,
      ...(chapterBodyMarkdown === undefined ? {} : { chapterBodyMarkdown }),
      ...(outlineDigest === undefined ? {} : { outlineDigest }),
      userEditedSinceAgent: false,
      userEditedOutlineSinceAgent,
      synopsisConfirmed: session.synopsisConfirmedAtMs !== undefined,
      activeGoals,
      chapterProgress,
      hookScheduleAudit,
      model: input.model,
      discussTrigger: "turn_handoff",
      volumePlanning: volumePlanningContext,
      ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
    })
    await this.applyWorkMetadata(assist)
    const assistantMessageId = this.dependencies.createId()
    if (assist.stagingDelta !== undefined) {
      await this.applyStagingDelta({
        workspaceRootRef: input.workspaceRootRef,
        delta: assist.stagingDelta,
        sourceMessageId: assistantMessageId,
      })
    }
    if (assist.arcPlanMarkdown !== undefined) {
      await this.dependencies.workspace.saveUserMarkdown(
        input.workspaceRootRef,
        ARC_PLAN_STAGING_PATH,
        assist.arcPlanMarkdown,
      )
      const handoffVolume = extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
      await this.dependencies.workspace.saveUserMarkdown(
        input.workspaceRootRef,
        volumeOutlinePlanPath(handoffVolume),
        assist.arcPlanMarkdown,
      )
    }
    if (assist.presentationWrites !== undefined && assist.presentationWrites.length > 0) {
      await this.applyPresentationWrites({
        workspaceRootRef: input.workspaceRootRef,
        writes: assist.presentationWrites,
      })
    }
    if (assist.synopsisBody !== undefined) {
      await this.dependencies.workspace.saveSynopsisMarkdown(
        input.workspaceRootRef,
        session.synopsisPath,
        assist.synopsisBody,
      )
      await this.dependencies.conversation.updateSession({
        sessionId: session.sessionId,
        lastAgentDigest: digest(assist.synopsisBody),
        updatedAtMs: this.dependencies.now(),
      })
    }
    await this.dependencies.conversation.appendMessage({
      messageId: assistantMessageId,
      projectId: input.projectId,
      sessionId: session.sessionId,
      role: "assistant",
      content: assist.content,
      ...(assist.reasoningContent === undefined ? {} : { reasoningContent: assist.reasoningContent }),
      ...(assist.choices === undefined ? {} : { choices: assist.choices }),
      createdAtMs: this.dependencies.now(),
    })
    await this.setFocus({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      chapterSequence: input.brief.chapterSequence + 1,
      focusKind: "plot_synopsis",
    })
  }

  private async applyWorkMetadata(
    metadata: Readonly<{ workDisplayName?: string; workDescription?: string }>,
  ): Promise<{ workDisplayName?: string; workDescription?: string }> {
    const result: { workDisplayName?: string; workDescription?: string } = {}
    if (metadata.workDisplayName?.trim() && this.dependencies.renameDisplayName !== undefined) {
      result.workDisplayName = await this.dependencies.renameDisplayName(metadata.workDisplayName.trim())
    }
    if (metadata.workDescription !== undefined && this.dependencies.saveWorkDescription !== undefined) {
      result.workDescription = await this.dependencies.saveWorkDescription(metadata.workDescription)
    }
    return result
  }

  private async applyVolumeFolderChange(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    synopsisPath: string
    fromFolderName: string
    toFolderName: string
  }>): Promise<Readonly<{
    synopsisPath: string
    volumeFolderName: string
    cleanupEmptyFolderName?: string
  }>> {
    const fromValidated = validateVolumeFolderName(input.fromFolderName)
    const toValidated = validateVolumeFolderName(input.toFolderName)
    if (!fromValidated.ok) throw new SynopsisInvalidStateError(fromValidated.reason)
    if (!toValidated.ok) throw new SynopsisInvalidStateError(toValidated.reason)
    if (fromValidated.folderName === toValidated.folderName) {
      return {
        synopsisPath: input.synopsisPath,
        volumeFolderName: toValidated.folderName,
      }
    }

    const existing = await this.dependencies.workspace.listVolumeFolderNames(input.workspaceRootRef)
    const uniqueness = assertUniqueVolumeSequence(toValidated.folderName, existing, {
      excludeFolderName: fromValidated.folderName,
    })
    if (!uniqueness.ok) {
      throw new SynopsisInvalidStateError(uniqueness.reason)
    }

    if (fromValidated.sequence === toValidated.sequence) {
      const lifecycle = await readVolumeLifecycleState(this.dependencies.workspace, input.workspaceRootRef, fromValidated.folderName)
      await this.dependencies.workspace.renameVolumeDirectory(
        input.workspaceRootRef,
        fromValidated.folderName,
        toValidated.folderName,
      )
      await this.remapPublishedPathsForVolumeRename(
        input.projectId,
        fromValidated.folderName,
        toValidated.folderName,
      )
      const setup = await this.dependencies.creativeSetup.find(input.projectId, `volume:${fromValidated.folderName}`)
      for (const suffix of [".批量计划.md", ".梗概.md", ".md"]) {
        const oldPath = `大纲/${fromValidated.folderName}${suffix}`
        const newPath = `大纲/${toValidated.folderName}${suffix}`
        const markdown = await this.readSynopsisFile(input.workspaceRootRef, oldPath)
        if (markdown.trim().length === 0) continue
        const plan = suffix === ".批量计划.md" ? parseVolumePlanningState(markdown) : undefined
        await this.dependencies.workspace.saveUserMarkdown(input.workspaceRootRef, newPath,
          plan === undefined ? markdown : serializeVolumePlanningState({ ...plan, volumeFolderName: toValidated.folderName }))
        await this.dependencies.workspace.removeUserMarkdown(input.workspaceRootRef, oldPath)
      }
      if (lifecycle !== undefined) {
        await saveVolumeLifecycleState(this.dependencies.workspace, input.workspaceRootRef, { ...lifecycle, volumeFolderName: toValidated.folderName })
        await this.dependencies.workspace.removeUserMarkdown(input.workspaceRootRef, volumeLifecycleStatePath(fromValidated.folderName))
      }
      if (setup !== undefined) await this.dependencies.creativeSetup.save(input.projectId, {
        ...setup, scope: `volume:${toValidated.folderName}`,
        ...(setup.settingsPath === undefined ? {} : { settingsPath: `大纲/${toValidated.folderName}.批量计划.md` }),
        updatedAtMs: this.dependencies.now(),
      })
      return {
        synopsisPath: remapPathVolumeFolder(
          input.synopsisPath,
          fromValidated.folderName,
          toValidated.folderName,
        ),
        volumeFolderName: toValidated.folderName,
      }
    }

    return {
      synopsisPath: input.synopsisPath,
      volumeFolderName: toValidated.folderName,
      cleanupEmptyFolderName: fromValidated.folderName,
    }
  }

  private async remapPublishedPathsForVolumeRename(
    projectId: ProjectId,
    fromFolderName: string,
    toFolderName: string,
  ): Promise<void> {
    const chapters = await this.dependencies.chapterIndex.list(projectId)
    for (const chapter of chapters) {
      const nextPath = remapPathVolumeFolder(
        chapter.currentPublishPath,
        fromFolderName,
        toFolderName,
      )
      if (nextPath === chapter.currentPublishPath) continue
      await this.dependencies.chapterIndex.updateCurrent({
        projectId,
        chapterId: chapter.chapterId,
        currentSourceId: chapter.currentSourceId,
        currentPublishPath: nextPath,
      })
    }
  }

  private async tryRemoveEmptyVolumeDirectory(
    workspaceRootRef: string,
    folderName: string,
  ): Promise<void> {
    try {
      await this.dependencies.workspace.removeEmptyVolumeDirectory(
        workspaceRootRef,
        deriveVolumeDirectoryPath(folderName),
      )
    } catch (error) {
      runtimeLog("debug", "synopsis-conversation", "skip-empty-volume-cleanup", {
        folderName,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async relocateOutlineBesideSynopsis(
    workspaceRootRef: string,
    oldSynopsisPath: string,
    newSynopsisPath: string,
  ): Promise<void> {
    const oldOutline = siblingPlanningMarkdownPath(oldSynopsisPath, "outline")
    const newOutline = siblingPlanningMarkdownPath(newSynopsisPath, "outline")
    if (oldOutline === undefined || newOutline === undefined || oldOutline === newOutline) return
    const content = await this.readSynopsisFile(workspaceRootRef, oldOutline)
    if (content.trim().length === 0) return
    await this.dependencies.workspace.saveSynopsisMarkdown(workspaceRootRef, newOutline, content)
    await this.dependencies.workspace.removeSynopsisMarkdown(workspaceRootRef, oldOutline)
  }

  private async readSynopsisFile(workspaceRootRef: string, synopsisPath: string): Promise<string> {
    try {
      return await this.dependencies.workspace.readMarkdown(workspaceRootRef, synopsisPath)
    } catch {
      return ""
    }
  }

  private async readVolumePlanningState(
    workspaceRootRef: string,
    volumeFolderName: string,
  ): Promise<VolumePlanningState | undefined> {
    try {
      return parseVolumePlanningState(await this.dependencies.workspace.readMarkdown(
        workspaceRootRef,
        `大纲/${volumeFolderName}.批量计划.md`,
      ))
    } catch {
      return undefined
    }
  }

  private async readFocusedVolume(workspaceRootRef: string, session: SynopsisConversationSession) {
    const folder = extractVolumeFolderNameFromPath(session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME
    const [state, plan, style, protagonist, setup, index] = await Promise.all([
      readVolumeLifecycleState(this.dependencies.workspace, workspaceRootRef, folder),
      this.readVolumePlanningState(workspaceRootRef, folder),
      this.dependencies.conversation.findWorkStyleGateState(session.projectId),
      this.dependencies.creativeSetup.find(session.projectId, "protagonist"),
      this.dependencies.creativeSetup.find(session.projectId, `volume:${folder}`),
      this.dependencies.chapterIndex.list(session.projectId),
    ])
    const chapters = index.filter(chapter => extractVolumeFolderNameFromPath(chapter.currentPublishPath) === folder)
    const planning = await this.readVolumePlanningContext(workspaceRootRef, folder, plan)
    const styleReady = canProceedPastWorkStyleGate(style)
    const protagonistReady = protagonist?.status === "ready"
    const started = isVolumeStarted(state, {
      setupReady: styleReady && protagonistReady && (setup?.status === "ready" || chapters.length > 0),
      planningReady: planning.ready || plan?.storylineConfirmedAtMs !== undefined,
      hasExistingChapters: chapters.length > 0,
    })
    const published = new Set(chapters.map(chapter => chapter.sequence))
    let consecutive = published.size
    if (plan !== undefined && plan.targetChapterCount > 0) {
      consecutive = 0
      while (consecutive < plan.targetChapterCount && published.has(plan.startSequence + consecutive)) consecutive += 1
    }
    const atCap = plan !== undefined && isVolumeChapterCapReached(plan, plan.startSequence + consecutive)
    const story = { ...setup?.answers, ...plan?.storyline }
    const wordCounts = await Promise.all(chapters.map(async chapter => {
      const markdown = await this.dependencies.workspace.readMarkdown(workspaceRootRef, chapter.currentPublishPath).catch(() => undefined)
      return markdown === undefined ? undefined : markdown.replace(/^#\s+[^\r\n]*\r?\n/u, "").replace(/\s+/gu, "").length
    }))
    const wordsReady = wordCounts.every(count => count !== undefined && count > 0)
    const wordCount = wordCounts.reduce<number>((total, count) => total + (count ?? 0), 0)
    return { folder, state, plan, started, atCap, wordsReady, lifecycle: buildVolumeLifecycle({
      started, styleReady, protagonistReady, ...story, conceptionReady: planning.ready && wordsReady,
      chapterCount: consecutive, chapterLimit: plan?.targetChapterCount ?? 0, wordCount,
      targetWordCount: plan?.targetWordCount ?? 0, endedAtMs: state?.endedAtMs,
      revision: state?.revisionStartedAtMs !== undefined,
    }) }
  }

  private async enterHistoricalVolumeRevision(workspaceRootRef: string, volumeFolderName: string): Promise<void> {
    const state = await readVolumeLifecycleState(this.dependencies.workspace, workspaceRootRef, volumeFolderName)
    if (state?.endedAtMs === undefined || state.revisionStartedAtMs !== undefined) return
    const revision = transitionVolumeLifecycle(state, { volumeFolderName, action: "revise", atMs: this.dependencies.now() })
    if (revision !== undefined) await saveVolumeLifecycleState(this.dependencies.workspace, workspaceRootRef, revision)
  }

  private async withVolumeLifecycle(workspaceRootRef: string, session: SynopsisConversationSession): Promise<SynopsisConversationSession> {
    const volume = await this.readFocusedVolume(workspaceRootRef, session)
    return { ...session, volumeLifecycle: { ...volume.lifecycle, volumeFolderName: volume.folder } }
  }

  private async runVolumeBoundary(
    input: Parameters<SynopsisConversationService["send"]>[0],
    session: SynopsisConversationSession,
    volume: Awaited<ReturnType<SynopsisConversationService["readFocusedVolume"]>>,
    action: VolumeBoundaryAction,
  ): Promise<SynopsisConversationSendResult> {
    const now = this.dependencies.now()
    await this.hydrateDiscussUsage(input.projectId)
    synopsisConversationStreamHub.begin(input.projectId, session.sessionId, now)
    let focused = session
    let accepted = false
    let content = `当前停在「${VOLUME_BOUNDARY_LABEL[action]}」。`
    try {
      if (input.agentMode !== "plan") {
        const result = await this.runSynopsisDiscuss({
          projectId: input.projectId, workspaceRootRef: input.workspaceRootRef, sessionId: session.sessionId,
          userMessage: input.message, heading: session.title, chapterSequence: session.chapterSequence,
          synopsisMarkdown: "", outlineMarkdown: "", userEditedSinceAgent: false, userEditedOutlineSinceAgent: false,
          activeGoals: [], chapterProgress: [], hookScheduleAudit: {
            requireCompleteHookSchedules: true, incompleteHooks: [], completeCount: 0, incompleteCount: 0,
          },
          model: input.model, allowWorkflowTools: false, allowChapterWorkflowTools: false, volumeBoundary: action,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
          maxModelCalls: input.maxModelCalls ?? 2,
        })
        content = result.content
        if (isSynopsisSendCancelled(input.projectId) || input.signal?.aborted) throw new SynopsisSendCancelledError()
        if (result.volumeBoundaryAccepted) {
          const latest = await this.readFocusedVolume(input.workspaceRootRef, session)
          const next = transitionVolumeLifecycle(latest.state, {
            volumeFolderName: volume.folder, action, atMs: this.dependencies.now(), legacyStarted: latest.started,
          })
          if (next === undefined || (action === "end" && !latest.atCap)) {
            throw new SynopsisInvalidStateError("卷状态已变化，本轮没有写入，请重试。")
          }
          await saveVolumeLifecycleState(this.dependencies.workspace, input.workspaceRootRef, next)
          accepted = true
          if (action === "end") {
            try {
              const result = await this.setFocus({
                projectId: input.projectId, workspaceRootRef: input.workspaceRootRef,
                chapterSequence: await this.dependencies.chapters.nextChapterSequence(input.projectId), focusKind: "plot_synopsis",
              })
              focused = result.session
              content += ` 已切至「${focused.volumeLifecycle?.volumeFolderName ?? "下一卷"}」。`
            } catch (error) {
              if (!(error instanceof VolumeRolloverConflictError)) throw error
              content += ` ${error.message}`
            }
          }
        }
      }
      await this.dependencies.conversation.appendMessage({
        messageId: this.dependencies.createId(), projectId: input.projectId, sessionId: session.sessionId,
        role: "user", content: input.message, createdAtMs: now,
      })
      await this.dependencies.conversation.appendMessage({
        messageId: this.dependencies.createId(), projectId: input.projectId, sessionId: session.sessionId,
        role: "assistant", content, createdAtMs: this.dependencies.now() + 1,
      })
      synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), { content })
      return {
        session: await this.withVolumeLifecycle(input.workspaceRootRef, focused),
        messages: [...await this.dependencies.conversation.listMessagesForProject(input.projectId)],
        ...(accepted && action !== "end" ? { autoContinue: { message: input.message } } : {}),
      }
    } finally {
      synopsisConversationStreamHub.clear(input.projectId)
    }
  }

  private async readVolumePlanningContext(
    workspaceRootRef: string,
    volumeFolderName: string,
    state: VolumePlanningState | undefined,
  ): Promise<VolumePlanningContext> {
    const context = buildVolumePlanningStatus(volumeFolderName, state)
    const artifacts = await Promise.all([".梗概.md", ".md"].map(async suffix =>
      this.dependencies.workspace.readMarkdown(workspaceRootRef, `大纲/${volumeFolderName}${suffix}`).catch(() => "")))
    const missing = [...context.missing]
    for (const [index, label] of ["卷梗概", "卷大纲"].entries()) {
      if (!volumePlanningMarkdownHasContent(artifacts[index]) && !missing.includes(label)) missing.push(label)
    }
    // Keep historical write counters intact: missing documents require restoration, not a new first-write history.
    return { ...context, ready: context.ready && missing.length === 0, missing }
  }

  private async saveVolumePlanningState(
    workspaceRootRef: string,
    state: VolumePlanningState,
  ): Promise<void> {
    await this.dependencies.workspace.saveUserMarkdown(
      workspaceRootRef,
      `大纲/${state.volumeFolderName}.批量计划.md`,
      serializeVolumePlanningState(state),
    )
  }

  private async publishConfirmedDraftIfRequested(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    session: Awaited<ReturnType<SynopsisConversationService["ensureActiveSession"]>>
    message: string
    draftVersionId: string
    model: AIModelPort
    autoContinueNextChapter: boolean
    chapterIntent?: ChapterNarrativeIntent
    presentation?: SynopsisToolContext["presentation"]
    deadlineMs?: number
    signal?: AbortSignal
  }>): Promise<SynopsisConversationSendResult> {
    if (this.dependencies.publishDraft === undefined) throw new SynopsisInvalidStateError("正文发布服务不可用。")
    const draft = await this.findPublishableFocusDraft(input.projectId, input.session.chapterSequence)
    if (draft?.draftVersionId !== input.draftVersionId) {
      throw new SynopsisInvalidStateError("这份草稿已变更或不可发布，请核对当前版本后重新确认。")
    }
    const nowMs = this.dependencies.now()
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: input.session.sessionId,
      role: "user",
      content: input.message,
      createdAtMs: nowMs,
    })
    synopsisConversationStreamHub.setProceedProgress(
      input.projectId,
      { stage: "body_discuss", status: "running" },
      nowMs,
    )
    let content: string
    let autoContinue: { message: string } | undefined
    let choices: SynopsisConversationChoice[] | undefined
    try {
      const published = await this.dependencies.publishDraft({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        sessionId: input.session.sessionId,
        chapterSequence: input.session.chapterSequence,
        model: input.model,
        revisionTaskId: draft.revisionTaskId,
        draftVersionId: draft.draftVersionId,
        ...(input.chapterIntent === undefined ? {} : { chapterIntent: input.chapterIntent }),
        ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
        ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      const done = published.status === "completed" && published.error === undefined
      content = done
        ? `已确认草稿（${draft.draftLabel}）。设定抽取与章节入库已完成，正文已落盘。`
        : published.summary ?? published.error ?? "草稿已确认，但正文尚未落盘。"
      if (done) {
        synopsisConversationStreamHub.setProceedProgress(
          input.projectId,
          { stage: "body_discuss", status: "done" },
          this.dependencies.now(),
        )
      }
      const volume = done ? await this.readFocusedVolume(input.workspaceRootRef, input.session) : undefined
      if (volume?.atCap && volume.state?.endedAtMs === undefined) {
        autoContinue = { message: "本卷计划章节已全部发布，请标记卷末并开启下一卷。" }
      } else if (done && input.autoContinueNextChapter) {
        autoContinue = { message: publishedChapterAutoContinueMessage(input.session.chapterSequence) }
      } else if (!done) {
        choices = withDraftConfirmationChoice(undefined, draft)
      }
    } catch (error) {
      content = error instanceof Error ? error.message : String(error)
    }
    await this.dependencies.conversation.appendMessage({
      messageId: this.dependencies.createId(),
      projectId: input.projectId,
      sessionId: input.session.sessionId,
      role: "assistant",
      content,
      ...(choices === undefined ? {} : { choices }),
      createdAtMs: nowMs + 1,
    })
    const usage = synopsisConversationStreamHub.readCumulativeUsage(input.projectId)
    const proceedProgress = synopsisConversationStreamHub.peek(
      input.projectId,
      input.session.sessionId,
    ).proceedProgress
    synopsisConversationStreamHub.complete(input.projectId, this.dependencies.now(), { content })
    synopsisConversationStreamHub.clear(input.projectId)
    const session = await this.dependencies.conversation.findSession(input.session.sessionId)
    if (session === undefined) throw new SynopsisInvalidStateError("讨论会话不存在")
    return {
      session: await this.withVolumeLifecycle(input.workspaceRootRef, session),
      messages: [...await this.dependencies.conversation.listMessagesForProject(input.projectId)],
      ...(usage === undefined ? {} : { usage }),
      ...(autoContinue === undefined ? {} : { autoContinue }),
      ...(proceedProgress === undefined ? {} : { proceedProgress }),
    }
  }

  /** Derive and publish proceedProgress from on-disk materials for list/start/setFocus. */
  private async syncProceedProgressFromMaterials(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    session: SynopsisConversationSession
    proceedMode?: DiscussProceedMode
    customProceedGates?: DiscussCustomProceedGates
  }>): Promise<DiscussProceedProgress> {
    const synopsisMarkdown = await this.readSynopsisFile(input.workspaceRootRef, input.session.synopsisPath)
    const outlinePath = siblingPlanningMarkdownPath(input.session.synopsisPath, "outline")
      ?? deriveOutlineMarkdownPath(
        input.session.chapterSequence,
        input.session.title,
        extractVolumeFolderNameFromPath(input.session.synopsisPath) ?? DEFAULT_VOLUME_FOLDER_NAME,
      )
    const outlineMarkdown = await this.readSynopsisFile(input.workspaceRootRef, outlinePath)
    const chapterBodyMarkdown = await this.readFocusedCommittedBody(
      input.projectId,
      input.workspaceRootRef,
      input.session.chapterSequence,
    )
    const latestDraftMarkdown = await this.readFocusedLatestDraft(
      input.projectId,
      input.session.chapterSequence,
    )
    const publishableDraft = await this.findPublishableFocusDraft(
      input.projectId,
      input.session.chapterSequence,
    )
    const synopsisReady = hasPlanningContent(synopsisMarkdown, true)
    const outlineReady = hasPlanningContent(outlineMarkdown, false)
    // Restage clears draftVersionId / draftContentState; orphan revision rows must not keep
    // the proceed bar on 草稿 after the user rewound to 梗概 or 细纲.
    const draftReady = input.session.draftVersionId !== undefined
      && input.session.draftContentState !== "empty"
      && (
        (latestDraftMarkdown?.trim().length ?? 0) > 0
        || publishableDraft !== undefined
      )
    const chapterPublished = (chapterBodyMarkdown?.trim().length ?? 0) > 0
    const stage = resolveDiscussPipelineStage({
      synopsisReady,
      outlineReady,
      draftReady,
      ...(chapterPublished ? { chapterPublished: true } : {}),
    })
    const proceedMode = input.proceedMode ?? "single"
    const autonomous = resolveProceedAutonomy({
      mode: proceedMode,
      stage,
      ...(input.customProceedGates === undefined ? {} : { customGates: input.customProceedGates }),
    })
    const progress: DiscussProceedProgress = {
      stage,
      status: autonomous ? "running" : "waiting",
    }
    synopsisConversationStreamHub.setProceedProgress(
      input.projectId,
      progress,
      this.dependencies.now(),
    )
    return progress
  }

  private async findPublishableFocusDraft(
    projectId: ProjectId,
    chapterSequence: number,
  ): Promise<Readonly<{
    revisionTaskId: string
    draftVersionId: string
    draftLabel: string
    chapterId: string
  }> | undefined> {
    const revisions = this.dependencies.revisions
    if (revisions === undefined) return undefined
    const workspace = await revisions.getDraftWorkspace({ projectId, chapterSequence })
    if (workspace === undefined || !PUBLISHABLE_DRAFT_STATUSES.has(workspace.status)) return undefined
    const listed = await revisions.listDraftVersions(workspace.revisionTaskId)
    const latest = listed.versions.find((version) => version.isLatest) ?? listed.versions.at(-1)
    if (latest === undefined) return undefined
    return {
      revisionTaskId: workspace.revisionTaskId,
      draftVersionId: latest.versionId,
      draftLabel: latest.label,
      chapterId: workspace.chapterId,
    }
  }

  private async readFocusedCommittedBody(
    projectId: ProjectId,
    workspaceRootRef: string,
    sequence: number,
  ): Promise<string | undefined> {
    const indexed = await this.dependencies.chapterIndex.findBySequence(projectId, sequence)
    if (indexed === undefined) return undefined
    const version = await this.dependencies.documents.findStoredVersion(projectId, indexed.currentSourceId)
    if (version !== undefined) {
      try {
        const content = await this.dependencies.internalStore.readDocument(version.contentRef)
        if (content.trim().length > 0) return content
      } catch {
        // Fall through to the published workspace file the user can already open.
      }
    }
    try {
      const published = await this.dependencies.workspace.readMarkdown(
        workspaceRootRef,
        indexed.currentPublishPath,
      )
      return published.trim().length === 0 ? undefined : published
    } catch {
      return undefined
    }
  }

  private async readFocusedLatestDraft(
    projectId: ProjectId,
    sequence: number,
  ): Promise<string | undefined> {
    const revisions = this.dependencies.revisions
    if (revisions === undefined) return undefined
    const indexed = await this.dependencies.chapterIndex.findBySequence(projectId, sequence)
    const active = indexed === undefined
      ? await revisions.getDraftWorkspace({ projectId, chapterSequence: sequence })
      : await revisions.findActiveRevision(projectId, indexed.chapterId)
    if (active === undefined) return undefined
    const listed = await revisions.listDraftVersions(active.revisionTaskId)
    const latest = listed.versions.find((version) => version.isLatest) ?? listed.versions.at(-1)
    if (latest === undefined || latest.body.trim().length === 0) return undefined
    return assembleChapterDocument(latest.heading, latest.body)
  }

  private async persistVolumeChapterPlan(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    plan: VolumeChapterPlan
    volumeFolderName: string
    synopsisPath?: string
    outlinePath?: string
  }>): Promise<Readonly<{ synopsisPath: string; outlinePath: string; title: string }>> {
    const existingPath = input.synopsisPath ?? input.outlinePath
    const existingTitle = existingPath === undefined ? undefined
      : (parseSynopsisMarkdownPath(existingPath) ?? parseOutlineMarkdownPath(existingPath))?.title
    const title = existingTitle || input.plan.chapterTitle?.trim()
      || extractSynopsisTitleFromDocument(input.plan.synopsisBody)
      || formatChapterSequenceLabel(input.plan.chapterSequence)
    const synopsisPath = input.synopsisPath ?? deriveSynopsisMarkdownPath(
      input.plan.chapterSequence,
      title,
      input.volumeFolderName,
    )
    const outlinePath = input.outlinePath ?? deriveOutlineMarkdownPath(
      input.plan.chapterSequence,
      title,
      input.volumeFolderName,
    )
    this.emitDiscussEdit(input.projectId, {
      path: synopsisPath,
      kind: "synopsis",
      status: "running",
      summary: `正在写入第 ${String(input.plan.chapterSequence)} 章梗概`,
    })
    await this.dependencies.workspace.saveSynopsisMarkdown(
      input.workspaceRootRef,
      synopsisPath,
      input.plan.synopsisBody,
    )
    this.emitDiscussEdit(input.projectId, {
      path: synopsisPath,
      kind: "synopsis",
      status: "completed",
      summary: `已写入第 ${String(input.plan.chapterSequence)} 章梗概`,
    })
    this.emitDiscussEdit(input.projectId, {
      path: outlinePath,
      kind: "outline",
      status: "running",
      summary: `正在写入第 ${String(input.plan.chapterSequence)} 章细纲`,
    })
    await this.dependencies.workspace.saveSynopsisMarkdown(
      input.workspaceRootRef,
      outlinePath,
      input.plan.outlineBody,
    )
    this.emitDiscussEdit(input.projectId, {
      path: outlinePath,
      kind: "outline",
      status: "completed",
      summary: `已写入第 ${String(input.plan.chapterSequence)} 章细纲`,
    })
    return { synopsisPath, outlinePath, title }
  }

  private async readDiscussProgressFingerprint(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    chapterSequence: number
    draftVersionId: string | undefined
    styleStatus: string
  }>): Promise<string> {
    const catalog = await this.dependencies.catalog.createSnapshot({
      snapshotId: this.dependencies.createId(), projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef, generatedAtMs: this.dependencies.now(),
    })
    return digest({
      files: catalog.entries.filter((entry) => entry.entryKind === "file")
        .map((entry) => ({ path: entry.relativePath, digest: entry.digest ?? null }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      chapterSequence: input.chapterSequence, draftVersionId: input.draftVersionId ?? null,
      styleStatus: input.styleStatus, goals: await this.dependencies.goals.list(input.projectId),
    })
  }

  private async applyDiscussChapterDraft(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    chapterSequence: number
    proposal?: ChapterDraftProposal
    volumeFolderName?: string
    messageId: string
  }>): Promise<Readonly<{
    appended?: NonNullable<SynopsisConversationSendResult["appendedDraft"]>
    unchanged?: true
    notice?: string
    deferredSequence?: number
    blocked?: boolean
  }>> {
    if (input.proposal === undefined) return {}
    const revisions = this.dependencies.revisions
    if (revisions === undefined) {
      return { notice: "本章修订服务不可用，修订正文未写入草稿。", blocked: true }
    }
    const indexed = await this.dependencies.chapterIndex.findBySequence(input.projectId, input.chapterSequence)
    if (indexed === undefined) {
      const nextSequence = await this.waitForChapterSequenceGate(input.projectId, input.chapterSequence)
      if (input.chapterSequence > nextSequence) {
        this.emitDiscussEdit(input.projectId, {
          path: deriveChapterPublishPath(
            `${formatChapterSequenceLabel(input.chapterSequence)} 待命名`,
            input.volumeFolderName ?? DEFAULT_VOLUME_FOLDER_NAME,
          ),
          kind: "draft",
          status: "failed",
          summary: `门禁延后：须先发布第${String(nextSequence)}章`,
        })
        return {
          notice: discussChapterSequenceGateHint(nextSequence, [input.chapterSequence]),
          deferredSequence: input.chapterSequence,
        }
      }
      const shortHeading = normalizeDiscussDraftHeading(input.proposal.heading, "待命名")
        .replace(/^第(?:\d+|[零一二三四五六七八九十百千万]+)章\s*/u, "")
      const heading = `${formatChapterSequenceLabel(input.chapterSequence)} ${shortHeading}`
      const body = stripHeadingFromDraftBody(input.proposal.heading, input.proposal.body)
      if (body.trim().length === 0) return { notice: "正文为空，未写入草稿。", blocked: true }
      try {
        const stored = await revisions.startForChapterSequence({
          projectId: input.projectId,
          workspaceRootRef: input.workspaceRootRef,
          chapterSequence: input.chapterSequence,
          heading,
          body,
          volumeFolderName: input.volumeFolderName ?? DEFAULT_VOLUME_FOLDER_NAME,
          source: "agent",
          messageId: input.messageId,
        })
        const draft = await revisions.readRevision(stored.revisionTaskId)
        this.emitDiscussEdit(input.projectId, {
          path: draft.publishPath ?? deriveChapterPublishPath(heading, input.volumeFolderName ?? DEFAULT_VOLUME_FOLDER_NAME),
          kind: "draft",
          status: "completed",
          summary: `已写入草稿 ${stored.label}`,
        })
        return { appended: {
          revisionTaskId: stored.revisionTaskId,
          chapterId: draft.chapterId,
          draftVersionId: stored.versionId,
          draftLabel: stored.label,
        } }
      } catch (error) {
        if (isPrecedingChapterPublishGateError(error)) {
          const allowed = await this.dependencies.chapters.nextChapterSequence(input.projectId)
          this.emitDiscussEdit(input.projectId, {
            path: deriveChapterPublishPath(heading, input.volumeFolderName ?? DEFAULT_VOLUME_FOLDER_NAME),
            kind: "draft",
            status: "failed",
            summary: `门禁延后：须先发布第${String(allowed)}章`,
          })
          return {
            notice: discussChapterSequenceGateHint(allowed, [input.chapterSequence]),
            deferredSequence: input.chapterSequence,
          }
        }
        if (error instanceof RevisionInvalidStateError) {
          this.emitDiscussEdit(input.projectId, {
            path: deriveChapterPublishPath(heading, input.volumeFolderName ?? DEFAULT_VOLUME_FOLDER_NAME),
            kind: "draft",
            status: "failed",
            summary: error.message,
          })
          runtimeLog("warn", "synopsis-conversation", "draft.save_blocked", {
            projectId: input.projectId,
            chapterSequence: input.chapterSequence,
            reason: error.message,
          })
          return { notice: `草稿未保存：${error.message}`, blocked: true }
        }
        throw error
      }
    }
    const current = await revisions.read(input.projectId, indexed.chapterId)
    const heading = normalizeDiscussDraftHeading(input.proposal.heading, current.heading)
    const body = stripHeadingFromDraftBody(heading, input.proposal.body)
    if (body.trim().length === 0) {
      return { notice: "修订正文为空，未写入草稿。", blocked: true }
    }
    const active = await revisions.findActiveRevision(input.projectId, indexed.chapterId)
    const started = active ?? await revisions.start({
      projectId: input.projectId,
      workspaceRootRef: input.workspaceRootRef,
      chapterId: indexed.chapterId,
      baseSourceId: current.sourceId,
      heading: current.heading,
      body: current.body,
      inputMode: "agent",
    })
    const listed = await revisions.listDraftVersions(started.revisionTaskId)
    const latest = listed.versions.find((version) => version.isLatest) ?? listed.versions.at(-1)
    if (latest !== undefined && latest.heading === heading && latest.body === body) {
      const notice = `草稿未变（仍为 ${latest.label}）`
      this.emitDiscussEdit(input.projectId, {
        path: indexed.currentPublishPath,
        kind: "draft",
        status: "completed",
        summary: notice,
      })
      return { unchanged: true, notice }
    }
    this.emitDiscussEdit(input.projectId, {
      path: indexed.currentPublishPath,
      kind: "draft",
      status: "running",
      summary: "正在写入修订草稿",
    })
    const stored = await revisions.appendDraftVersion({
      revisionTaskId: started.revisionTaskId,
      source: "agent",
      heading,
      body,
      messageId: input.messageId,
      ...(input.proposal.base === "draft" && input.proposal.baseDraftVersionId !== undefined
        ? { parentVersionId: input.proposal.baseDraftVersionId }
        : {}),
    })
    this.emitDiscussEdit(input.projectId, {
      path: indexed.currentPublishPath,
      kind: "draft",
      status: "completed",
      summary: `已写入草稿 ${stored.label}`,
    })
    return {
      appended: {
        revisionTaskId: stored.revisionTaskId,
        chapterId: indexed.chapterId,
        draftVersionId: stored.versionId,
        draftLabel: stored.label,
      },
    }
  }

  private async synopsisFileExists(workspaceRootRef: string, synopsisPath: string): Promise<boolean> {
    const content = await this.readSynopsisFile(workspaceRootRef, synopsisPath)
    return content.length > 0
  }

  private async applyTitleAlignTarget(input: Readonly<{
    projectId: ProjectId
    workspaceRootRef: string
    chapterSequence: number
    target: "body" | "planning"
    synopsisPath: string
    sessionTitle: string
    volumeFolderName: string
  }>): Promise<Readonly<{
    synopsisPath: string
    sessionTitle: string
    notices: readonly string[]
  }>> {
    const notices: string[] = []
    if (input.target === "body") {
      const indexed = await this.dependencies.chapterIndex.findBySequence(input.projectId, input.chapterSequence)
      const issue = await this.dependencies.chapterSynopsis.detectTitleAlignmentIssue({
        workspaceRootRef: input.workspaceRootRef,
        chapterSequence: input.chapterSequence,
      })
      const onDiskBody = indexed?.currentPublishPath === undefined && issue === undefined
        ? await this.dependencies.chapterSynopsis.findBodyFile({
            workspaceRootRef: input.workspaceRootRef,
            chapterSequence: input.chapterSequence,
          })
        : undefined
      const bodyPath = indexed?.currentPublishPath ?? issue?.bodyPath ?? onDiskBody?.path
      const bodyHeading = issue?.bodyHeading
        ?? (bodyPath === undefined
          ? undefined
          : bodyPath.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.md$/u, ""))
      if (bodyPath === undefined || bodyHeading === undefined) {
        notices.push("本章还没有正文文件，无需按正文对齐标题。")
        return { synopsisPath: input.synopsisPath, sessionTitle: input.sessionTitle, notices }
      }
      if (issue === undefined) {
        const planning = await this.dependencies.chapterSynopsis.findPlanningHeading({
          workspaceRootRef: input.workspaceRootRef,
          chapterSequence: input.chapterSequence,
        })
        const planningShort = planning === undefined
          ? undefined
          : parseSynopsisTitleFromLabel(planning.titleLabel) ?? planning.titleLabel
        const bodyShort = parseSynopsisTitleFromLabel(bodyHeading) ?? bodyHeading
        if (planningShort === bodyShort) {
          notices.push(`标题已一致（${bodyHeading}），无需再对齐。`)
          return { synopsisPath: input.synopsisPath, sessionTitle: input.sessionTitle, notices }
        }
      }
      await this.dependencies.chapterSynopsis.alignPlanningTitlesToPublishedHeading({
        projectId: input.projectId,
        workspaceRootRef: input.workspaceRootRef,
        chapterSequence: input.chapterSequence,
        chapterHeading: bodyHeading,
        chapterPath: bodyPath,
      })
      const shortTitle = parseSynopsisTitleFromLabel(bodyHeading) ?? bodyHeading
      const nextSynopsis = deriveSynopsisMarkdownPath(
        input.chapterSequence,
        shortTitle,
        extractVolumeFolderNameFromPath(bodyPath) ?? input.volumeFolderName,
      )
      notices.push(
        `已按正文标题对齐梗概/细纲（→ ${bodyHeading}）。请刷新文件树验收：同章应只剩一个折叠入口，关联栏梗概/细纲应变为已创建。`,
      )
      return { synopsisPath: nextSynopsis, sessionTitle: shortTitle, notices }
    }

    const planning = await this.dependencies.chapterSynopsis.findPlanningHeading({
      workspaceRootRef: input.workspaceRootRef,
      chapterSequence: input.chapterSequence,
    })
    const indexed = await this.dependencies.chapterIndex.findBySequence(input.projectId, input.chapterSequence)
    const issue = await this.dependencies.chapterSynopsis.detectTitleAlignmentIssue({
      workspaceRootRef: input.workspaceRootRef,
      chapterSequence: input.chapterSequence,
    })
    const currentBodyPath = indexed?.currentPublishPath ?? issue?.bodyPath
    if (planning === undefined || currentBodyPath === undefined) {
      notices.push("未能同时找到规划文件与正文，titleAlignTarget=planning 未执行。")
      return { synopsisPath: input.synopsisPath, sessionTitle: input.sessionTitle, notices }
    }
    const nextBodyPath = deriveChapterPublishPath(planning.titleLabel, planning.volumeFolderName)
    if (currentBodyPath !== nextBodyPath) {
      const content = await this.dependencies.workspace.readMarkdown(
        input.workspaceRootRef,
        currentBodyPath,
      )
      await this.dependencies.workspace.replacePublishedChapter(
        input.workspaceRootRef,
        currentBodyPath,
        nextBodyPath,
        digest(content),
        content,
      )
      if (indexed !== undefined) {
        await this.dependencies.chapterIndex.updateCurrent({
          projectId: input.projectId,
          chapterId: indexed.chapterId,
          currentSourceId: indexed.currentSourceId,
          currentPublishPath: nextBodyPath,
        })
      }
    }
    const shortTitle = parseSynopsisTitleFromLabel(planning.titleLabel) ?? planning.titleLabel
    const nextSynopsis = deriveSynopsisMarkdownPath(
      input.chapterSequence,
      shortTitle,
      planning.volumeFolderName,
    )
    notices.push(
      `已按细纲/梗概标题重命名正文（→ ${planning.titleLabel}）。请刷新文件树验收：同章应只剩一个折叠入口。`,
    )
    return {
      synopsisPath: nextSynopsis,
      sessionTitle: shortTitle,
      notices,
    }
  }

}

function summarizeSynopsisToolRunResult(result: Record<string, unknown>): string {
  const status = typeof result.status === "string" ? result.status : "unknown"
  if (status === "error") {
    const message = typeof result.message === "string" ? result.message.trim() : ""
    return message.length === 0 ? "tool_failed" : truncateToolRunSummary(message)
  }
  if (status === "described") return "described"
  if (status === "bash_completed") {
    const payload = result.result
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      const bash = payload as Record<string, unknown>
      const exit = bash.exitCode === null || bash.exitCode === undefined ? "?" : String(bash.exitCode)
      const stdout = typeof bash.stdout === "string" ? bash.stdout.trim() : ""
      const stderr = typeof bash.stderr === "string" ? bash.stderr.trim() : ""
      const body = stdout.length > 0 ? stdout : stderr
      const timedOut = bash.timedOut === true ? " timedOut" : ""
      if (body.length === 0) return `exit=${exit}${timedOut}`
      return truncateToolRunSummary(`exit=${exit}${timedOut}\n${body}`)
    }
  }
  return truncateToolRunSummary(status)
}

function truncateToolRunSummary(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").trim()
  if (normalized.length <= 1_200) return normalized
  return `${normalized.slice(0, 1_199)}…`
}

/** Schema / phase-contract failures that the discuss loop can still recover from. */
export function isRecoverableDiscussPhaseContractError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("phase contract") && !message.includes("toolRequest 不可与")) return false
  // Network/config failures must still surface; only schema-shaped contract errors retry.
  if (error !== null && typeof error === "object" && "kind" in error) {
    const kind = (error as { kind?: unknown }).kind
    if (kind !== undefined && kind !== "schema") return false
  }
  return true
}

export function discussPhaseContractRepairHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isDiscussToolExclusiveContractError(error)) {
    return renderRuntimePrompt("discuss-repairs", "phase-contract-tool-exclusive")
  }
  return renderRuntimePrompt("discuss-repairs", "phase-contract-invalid", { validationIssue: message.slice(0, 400) })
}

function isDiscussToolExclusiveContractError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes("toolRequest 不可与")
}

function mapSynopsisStagingPatch(patch: {
  entryId?: string | undefined
  title: string
  body: string
  promoteTargetPath?: string | undefined
  status?: StagingEntryPatch["status"] | undefined
}): StagingEntryPatch {
  return {
    title: patch.title,
    body: patch.body,
    ...(patch.entryId === undefined ? {} : { entryId: patch.entryId }),
    ...(patch.promoteTargetPath === undefined ? {} : { promoteTargetPath: patch.promoteTargetPath }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
  }
}

function mapSynopsisStagingDelta(delta: {
  notes?: readonly {
    entryId?: string | undefined
    title: string
    body: string
    promoteTargetPath?: string | undefined
    status?: StagingEntryPatch["status"] | undefined
  }[] | undefined
  characters?: readonly {
    entryId?: string | undefined
    title: string
    body: string
    promoteTargetPath?: string | undefined
    status?: StagingEntryPatch["status"] | undefined
  }[] | undefined
  worldRules?: readonly {
    entryId?: string | undefined
    title: string
    body: string
    promoteTargetPath?: string | undefined
    status?: StagingEntryPatch["status"] | undefined
  }[] | undefined
  promoteHints?: readonly {
    entryId?: string | undefined
    title: string
    body: string
    promoteTargetPath?: string | undefined
    status?: StagingEntryPatch["status"] | undefined
  }[] | undefined
}): Readonly<{
  notes?: readonly StagingEntryPatch[]
  characters?: readonly StagingEntryPatch[]
  worldRules?: readonly StagingEntryPatch[]
  promoteHints?: readonly StagingEntryPatch[]
}> {
  return {
    ...(delta.notes === undefined ? {} : { notes: delta.notes.map(mapSynopsisStagingPatch) }),
    ...(delta.characters === undefined ? {} : { characters: delta.characters.map(mapSynopsisStagingPatch) }),
    ...(delta.worldRules === undefined ? {} : { worldRules: delta.worldRules.map(mapSynopsisStagingPatch) }),
    ...(delta.promoteHints === undefined ? {} : { promoteHints: delta.promoteHints.map(mapSynopsisStagingPatch) }),
  }
}

function mapSynopsisStagingPromote(promote: {
  settingsWrites: readonly {
    entryId: string
    relativePath: string
    markdown: string
    readmeEntry?: string | undefined
    mode: "create" | "update"
  }[]
  goalProposals?: readonly {
    payload: GoalProposalPayload
    reason?: string | undefined
  }[] | undefined
  reason?: string | undefined
}): Readonly<{
  settingsWrites: readonly Readonly<{
    entryId: string
    relativePath: string
    markdown: string
    readmeEntry?: string
    mode: "create" | "update"
  }>[]
  goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
  reason?: string
}> {
  return {
    settingsWrites: promote.settingsWrites.map((write) => ({
      entryId: write.entryId,
      relativePath: write.relativePath,
      markdown: write.markdown,
      mode: write.mode,
      ...(write.readmeEntry === undefined ? {} : { readmeEntry: write.readmeEntry }),
    })),
    ...(promote.goalProposals === undefined
      ? {}
      : {
          goalProposals: promote.goalProposals.map((proposal) => ({
            payload: proposal.payload,
            ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
          })),
        }),
    ...(promote.reason === undefined ? {} : { reason: promote.reason }),
  }
}

function mapSynopsisPresentationWrites(
  writes: readonly Readonly<{
    relativePath: string
    markdown: string
    mode: "create" | "update"
  }>[],
): readonly Readonly<{
  relativePath: string
  markdown: string
  mode: "create" | "update"
}>[] {
  return writes.map((write) => ({
    relativePath: write.relativePath.trim().replace(/\\/gu, "/"),
    markdown: write.markdown,
    mode: write.mode,
  }))
}

function buildVolumeFirstWriteGateReply(
  state: VolumePlanningState | undefined,
  volumeFolderName: string,
  actualContentReady = volumePlanningGateReady(state),
): string {
  const synopsisStatus = formatVolumePlanningWriteCount(state?.synopsisWriteCount)
  const outlineStatus = formatVolumePlanningWriteCount(state?.outlineWriteCount)
  if (state !== undefined && actualContentReady) {
    return `「${volumeFolderName}」卷规划首次写入已完成：目标 ${String(state.targetChapterCount)} 章、预计 ${String(state.targetWordCount)} 字，卷梗概与卷大纲均已写入。本轮不会同时进入第一章；下一步从第一章剧情梗概开始。`
  }
  const chapterCount = (state?.targetChapterCount ?? 0) <= 0 ? "待规划" : `${String(state?.targetChapterCount)} 章`
  const wordCount = (state?.targetWordCount ?? 0) <= 0 ? "待规划" : `${String(state?.targetWordCount)} 字`
  return `当前卷规划仍未完成，系统已拦截第一章梗概、细纲、草稿、正文和自动推进。「${volumeFolderName}」状态：章节数 ${chapterCount}；预计总字数 ${wordCount}；卷梗概 ${synopsisStatus}；卷大纲 ${outlineStatus}。请先完成缺少的卷级规划并成功写入；已有写入记录但文件缺失或为空时，也必须先恢复有效内容。门禁通过前不会开始第一章。`
}

function buildVolumePlanningStatus(
  volumeFolderName: string,
  state: VolumePlanningState | undefined,
): VolumePlanningContext {
  const missing: string[] = []
  if ((state?.targetChapterCount ?? 0) <= 0) missing.push("章节总数")
  if ((state?.targetWordCount ?? 0) <= 0) missing.push("预计总字数")
  if ((state?.synopsisWriteCount ?? 0) <= 0) missing.push("卷梗概")
  if ((state?.outlineWriteCount ?? 0) <= 0) missing.push("卷大纲")
  return {
    volumeFolderName,
    ready: volumePlanningGateReady(state),
    ...(state === undefined ? {} : {
      startSequence: state.startSequence,
      targetChapterCount: state.targetChapterCount,
      targetWordCount: state.targetWordCount,
    }),
    synopsisWriteCount: state?.synopsisWriteCount ?? 0,
    outlineWriteCount: state?.outlineWriteCount ?? 0,
    missing,
    ...(state?.storyline === undefined ? {} : { storyline: state.storyline }),
  }
}

function buildVolumePlanningPromptAppendix(
  planning: VolumePlanningContext | undefined,
): string | undefined {
  if (planning === undefined) return undefined
  const storyline = planning.storyline
  const confirmedArc = storyline === undefined ? undefined : renderRuntimePrompt("discuss-appendices", "confirmed-volume-story", {
    volumeFolderName: planning.volumeFolderName,
    opening: storyline.opening,
    climaxes: storyline.climaxes,
    ending: storyline.ending,
    subplots: storyline.subplots,
  })
  if (planning.ready) return confirmedArc
  const firstWrite = renderRuntimePrompt("discuss-appendices", "first-volume-planning", {
    volumeFolderName: planning.volumeFolderName,
    missing: planning.missing.length === 0 ? "无" : planning.missing.join("、"),
    chapterCount: planning.targetChapterCount ?? "待规划",
    wordCount: planning.targetWordCount ?? "待规划",
    synopsisWriteCount: planning.synopsisWriteCount,
    outlineWriteCount: planning.outlineWriteCount,
  })
  return confirmedArc === undefined ? firstWrite : [confirmedArc, firstWrite].join("\n")
}

function formatVolumePlanningWriteCount(count: number | undefined): string {
  if (count === undefined || count <= 0) return "待写入"
  return count === 1 ? "首次写入" : `写入${String(count)}次`
}

function synopsisSearchLabel(read: import("@starseafolio/contracts").ReadRequest): string {
  return isTemporalReadRequest(read) ? formatTemporalSearchLabel(read) : formatSynopsisSearchLabel(read)
}

function evidenceMatchesRead(
  item: TurnReadEvidence,
  read: import("@starseafolio/contracts").ReadRequest,
): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replaceAll("\\", "/")
  const path = normalize(item.ownerId)
  const evidenceKeys = item.exactKeys.map(normalize)
  const terms = [...read.query.exactKeys, ...read.query.semanticTexts, ...(read.query.entityHints ?? [])]
    .map(normalize)
    .filter((term) => term.length > 0)
  if (terms.length === 0) return true
  if (item.ownerKind.startsWith("web:")) {
    return terms.some((term) => path.includes(term) || evidenceKeys.some((key) => key === term))
  }
  return terms.some((term) => (
    path === term
    || path.includes(term)
    || path.split("/").at(-1) === term
    || evidenceKeys.some((key) => key === term || key.includes(term) || term.includes(key))
    || path.includes(`chapter-seq-${term}`)
    || path.includes(`as-of-${term}`)
  ))
}

function resolveRefreshTargetMessage(
  messages: readonly SynopsisConversationMessage[],
  messageId: string | undefined,
): SynopsisConversationMessage | undefined {
  if (messageId !== undefined) {
    const exact = messages.find((message) => message.messageId === messageId)
    if (exact?.role === "assistant" && (exact.choices?.length ?? 0) > 0 && exact.hidden !== true) {
      return exact
    }
    return undefined
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant" && (message.choices?.length ?? 0) > 0 && message.hidden !== true) {
      return message
    }
  }
  return undefined
}

export function buildRefreshChoicesPrompt(choices: readonly SynopsisConversationChoice[]): string {
  const labels = choices.map((choice) => `- ${choice.label}`).join("\n")
  return renderRuntimePrompt("discuss-messages", "refresh-choices", { labels })
}

export function mergeSynopsisChoices(
  existing: readonly SynopsisConversationChoice[],
  incoming: readonly SynopsisConversationChoice[],
  maxChoices = 16,
): SynopsisConversationChoice[] {
  const seen = new Set(existing.map((choice) => choice.label.trim()))
  const merged = [...existing]
  for (const choice of incoming) {
    const label = choice.label.trim()
    if (label.length === 0 || seen.has(label)) continue
    seen.add(label)
    merged.push(choice)
    if (merged.length >= maxChoices) break
  }
  return merged
}

function createAssistBudget(maxCalls: number, deadlineAtMs: number) {
  const safeCalls = Math.max(1, maxCalls)
  return {
    maxCalls: safeCalls,
    remainingCalls: safeCalls,
    maxInputTokens: 1_000_000,
    remainingInputTokens: 1_000_000,
    maxOutputTokens: 64_000,
    remainingOutputTokens: 64_000,
    deadlineAtMs,
    modelRequestDeadlineAtMs: deadlineAtMs,
  }
}

function finalizeDiscussReturn(
  projectId: ProjectId,
  latest: SynopsisConversationBudgetAdvisory | undefined,
  result: Readonly<{
    content: string
    autoContinueBlocked?: boolean
    appendedDraft?: NonNullable<SynopsisConversationSendResult["appendedDraft"]>
    reasoningContent?: string
    chapterTitle?: string
    titleAlignTarget?: "body" | "planning"
    volumeFolderName?: string
    workDisplayName?: string
    workDescription?: string
    synopsisBody?: string
    planningWriteIntent?: SynopsisDiscussArtifact["planningWriteIntent"]
    outlineBody?: string
    bodyEdits?: Readonly<{
      target: "outline"
      baseDigest?: string
      ops: readonly Readonly<{ oldText: string; newText: string }>[]
    }>
    chapterDraftProposal?: ChapterDraftProposal
    chapterDraftProposals?: readonly ChapterDraftProposalEntry[]
    volumeChapterPlans?: readonly VolumeChapterPlan[]
    volumePlanMeta?: Readonly<{ targetChapterCount?: number | undefined; targetWordCount?: number | undefined; notes?: string | undefined }>
    creationDeskSettings?: CreationDeskSettingsUpdate
    volumeSynopsisMarkdown?: string
    focusChange?: Readonly<NonNullable<SynopsisDiscussArtifact["focusChange"]>>
    continueTurn?: boolean
    choices?: SynopsisConversationSendResult["messages"][number]["choices"]
    goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
    stagingDelta?: Readonly<{
      notes?: readonly StagingEntryPatch[]
      characters?: readonly StagingEntryPatch[]
      worldRules?: readonly StagingEntryPatch[]
      promoteHints?: readonly StagingEntryPatch[]
    }>
    stagingPromote?: Readonly<{
      settingsWrites: readonly Readonly<{
        entryId: string
        relativePath: string
        markdown: string
        readmeEntry?: string
        mode: "create" | "update"
      }>[]
      goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
      reason?: string
    }>
    presentationWrites?: readonly Readonly<{
      relativePath: string
      markdown: string
      mode: "create" | "update"
    }>[]
    arcPlanMarkdown?: string
    availableProseStylePaths?: readonly string[]
    availableDescriptionRulePaths?: readonly string[]
    availableNovelMajorCategoryRulePaths?: readonly string[]
    availableNovelSubcategoryRulePaths?: readonly string[]
  }>,
): Readonly<{
  content: string
  autoContinueBlocked?: boolean
  appendedDraft?: NonNullable<SynopsisConversationSendResult["appendedDraft"]>
  reasoningContent?: string
  chapterTitle?: string
  titleAlignTarget?: "body" | "planning"
  volumeFolderName?: string
  workDisplayName?: string
  workDescription?: string
  synopsisBody?: string
  planningWriteIntent?: SynopsisDiscussArtifact["planningWriteIntent"]
  outlineBody?: string
  bodyEdits?: Readonly<{
    target: "outline"
    baseDigest?: string
    ops: readonly Readonly<{ oldText: string; newText: string }>[]
  }>
  chapterDraftProposal?: ChapterDraftProposal
  chapterDraftProposals?: readonly ChapterDraftProposalEntry[]
  volumeChapterPlans?: readonly VolumeChapterPlan[]
  volumePlanMeta?: Readonly<{ targetChapterCount?: number | undefined; targetWordCount?: number | undefined; notes?: string | undefined }>
  creationDeskSettings?: CreationDeskSettingsUpdate
  focusChange?: Readonly<NonNullable<SynopsisDiscussArtifact["focusChange"]>>
  continueTurn?: boolean
  choices?: SynopsisConversationSendResult["messages"][number]["choices"]
  goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
  stagingDelta?: Readonly<{
    notes?: readonly StagingEntryPatch[]
    characters?: readonly StagingEntryPatch[]
    worldRules?: readonly StagingEntryPatch[]
    promoteHints?: readonly StagingEntryPatch[]
  }>
  stagingPromote?: Readonly<{
    settingsWrites: readonly Readonly<{
      entryId: string
      relativePath: string
      markdown: string
      readmeEntry?: string
      mode: "create" | "update"
    }>[]
    goalProposals?: readonly Readonly<{ payload: GoalProposalPayload; reason?: string }>[]
    reason?: string
  }>
  presentationWrites?: readonly Readonly<{
    relativePath: string
    markdown: string
    mode: "create" | "update"
  }>[]
  arcPlanMarkdown?: string
  volumeSynopsisMarkdown?: string
  availableProseStylePaths?: readonly string[]
  availableDescriptionRulePaths?: readonly string[]
  availableNovelMajorCategoryRulePaths?: readonly string[]
  availableNovelSubcategoryRulePaths?: readonly string[]
  budgetAdvisory?: SynopsisConversationBudgetAdvisory
}> {
  const budgetAdvisory = latest ?? peekSynopsisModelBudgetAdvisory(projectId)
  return budgetAdvisory === undefined ? result : { ...result, budgetAdvisory }
}

function sanitizeCreationDeskSettings(input: Readonly<{
  update: CreationDeskSettingsUpdate | undefined
  availableDescriptionRulePaths: readonly string[]
  availableProseStylePaths: readonly string[]
  availableNovelMajorCategoryRulePaths?: readonly string[]
  availableNovelSubcategoryRulePaths?: readonly string[]
}>): CreationDeskSettingsUpdate | undefined {
  const update = input.update
  if (update === undefined) return undefined
  const descriptionPath = update.descriptionRulePath?.replaceAll("\\", "/")
  const prosePath = update.proseStyleRulePath?.replaceAll("\\", "/")
  const selectedDescriptionPath = descriptionPath === undefined
    ? undefined
    : input.availableDescriptionRulePaths.find((path) => path.replaceAll("\\", "/") === descriptionPath)
  const selectedProsePath = prosePath === undefined
    ? undefined
    : input.availableProseStylePaths.find((path) => path.replaceAll("\\", "/") === prosePath)
  const selectedMajorCategoryPath = update.novelMajorCategoryRulePath === undefined
    ? undefined
    : input.availableNovelMajorCategoryRulePaths?.find((path) => path.replaceAll("\\", "/") === update.novelMajorCategoryRulePath!.replaceAll("\\", "/"))
  const selectedSubcategoryPath = update.novelSubcategoryRulePath === undefined
    ? undefined
    : input.availableNovelSubcategoryRulePaths?.find((path) => path.replaceAll("\\", "/") === update.novelSubcategoryRulePath!.replaceAll("\\", "/"))
  const wordCountIsValid = update.minimumWordCount !== undefined
    && update.maximumWordCount !== undefined
    && update.minimumWordCount <= update.maximumWordCount
    && update.minimumWordCount <= 50_000
    && update.maximumWordCount <= 50_000
  const sanitized: CreationDeskSettingsUpdate = {
    ...(selectedMajorCategoryPath === undefined ? {} : { novelMajorCategoryRulePath: selectedMajorCategoryPath }),
    ...(selectedSubcategoryPath === undefined ? {} : { novelSubcategoryRulePath: selectedSubcategoryPath }),
    ...(selectedDescriptionPath === undefined ? {} : { descriptionRulePath: selectedDescriptionPath }),
    ...(selectedProsePath === undefined ? {} : { proseStyleRulePath: selectedProsePath }),
    ...(wordCountIsValid
      ? {
          minimumWordCount: update.minimumWordCount!,
          maximumWordCount: update.maximumWordCount!,
        }
      : {}),
    ...(update.boundaryPace === undefined ? {} : { boundaryPace: update.boundaryPace }),
    ...(update.causalityFocus === undefined ? {} : { causalityFocus: update.causalityFocus }),
  }
  return Object.keys(sanitized).length === 0 ? undefined : sanitized
}

function getRejectedCreationDeskRulePaths(input: Readonly<{
  update: CreationDeskSettingsUpdate | undefined
  availableDescriptionRulePaths: readonly string[]
  availableProseStylePaths: readonly string[]
  availableNovelMajorCategoryRulePaths?: readonly string[]
  availableNovelSubcategoryRulePaths?: readonly string[]
}>): string[] {
  const update = input.update
  if (update === undefined) return []
  const descriptionPath = update.descriptionRulePath?.replaceAll("\\", "/")
  const prosePath = update.proseStyleRulePath?.replaceAll("\\", "/")
  const validDescriptionPaths = new Set(input.availableDescriptionRulePaths.map((path) => path.replaceAll("\\", "/")))
  const validProsePaths = new Set(input.availableProseStylePaths.map((path) => path.replaceAll("\\", "/")))
  const validMajorPaths = new Set((input.availableNovelMajorCategoryRulePaths ?? []).map((path) => path.replaceAll("\\", "/")))
  const validSubcategoryPaths = new Set((input.availableNovelSubcategoryRulePaths ?? []).map((path) => path.replaceAll("\\", "/")))
  const majorPath = update.novelMajorCategoryRulePath?.replaceAll("\\", "/")
  const subcategoryPath = update.novelSubcategoryRulePath?.replaceAll("\\", "/")
  return [
    ...(descriptionPath !== undefined && !validDescriptionPaths.has(descriptionPath) ? [descriptionPath] : []),
    ...(prosePath !== undefined && !validProsePaths.has(prosePath) ? [prosePath] : []),
    ...(majorPath !== undefined && !validMajorPaths.has(majorPath) ? [majorPath] : []),
    ...(subcategoryPath !== undefined && !validSubcategoryPaths.has(subcategoryPath) ? [subcategoryPath] : []),
  ]
}

function buildSynopsisDiscussFallbackReturn(input: Readonly<{
  projectId: ProjectId
  accumulatedReasoning: string
  streamedContent: string
}>): Readonly<{ content: string; reasoningContent?: string }> {
  const streamed = normalizeThinkingDisplayText(input.streamedContent.trim())
  const content = (streamed !== undefined && !streamed.trimStart().startsWith("{") ? streamed : undefined)
    ?? (input.accumulatedReasoning.length > 0 ? input.accumulatedReasoning.slice(0, 4_000) : undefined)
    ?? "本轮讨论与检索轮次较多，已先停在本阶段。你可以继续发送更具体的指令，我会基于已有上下文接着推进。"
  return input.accumulatedReasoning.length === 0
    ? { content }
    : { content, reasoningContent: input.accumulatedReasoning }
}

function mapArtifactChapterDraftProposal(
  proposal: Readonly<{
    base?: "body" | "draft"
    baseDraftVersionId?: string | undefined
    heading: string
    body: string
  }> | undefined,
): { chapterDraftProposal?: ChapterDraftProposal } {
  if (proposal === undefined) return {}
  return {
    chapterDraftProposal: {
      base: proposal.base ?? "body",
      heading: proposal.heading,
      body: proposal.body,
      ...(proposal.baseDraftVersionId === undefined ? {} : { baseDraftVersionId: proposal.baseDraftVersionId }),
    },
  }
}

function mapArtifactChapterDraftProposals(
  proposals: readonly Readonly<{
    chapterSequence: number
    base?: "body" | "draft"
    baseDraftVersionId?: string | undefined
    heading: string
    body: string
  }>[] | undefined,
): { chapterDraftProposals?: readonly ChapterDraftProposalEntry[] } {
  if (proposals === undefined || proposals.length === 0) return {}
  return {
    chapterDraftProposals: proposals.map((proposal) => ({
      chapterSequence: proposal.chapterSequence,
      base: proposal.base ?? "body",
      heading: proposal.heading,
      body: proposal.body,
      ...(proposal.baseDraftVersionId === undefined ? {} : { baseDraftVersionId: proposal.baseDraftVersionId }),
    })),
  }
}

function mapArtifactVolumeChapterPlans(
  plans: readonly Readonly<{
    chapterSequence: number
    chapterTitle?: string | undefined
    synopsisBody: string
    outlineBody: string
  }>[] | undefined,
): { volumeChapterPlans?: readonly VolumeChapterPlan[] } {
  if (plans === undefined || plans.length === 0) return {}
  return {
    volumeChapterPlans: plans.map((plan) => ({
      chapterSequence: plan.chapterSequence,
      synopsisBody: plan.synopsisBody,
      outlineBody: plan.outlineBody,
      ...(plan.chapterTitle === undefined || plan.chapterTitle.length === 0
        ? {}
        : { chapterTitle: plan.chapterTitle }),
    })),
  }
}

export function partitionVolumeChapterPlansBySequence(
  plans: readonly VolumeChapterPlan[],
  currentSequence: number,
  allowsWholeVolumePlanning: boolean,
): Readonly<{ allowed: readonly VolumeChapterPlan[]; deferred: readonly VolumeChapterPlan[] }> {
  if (allowsWholeVolumePlanning) return { allowed: plans, deferred: [] }
  return {
    allowed: plans.filter((plan) => plan.chapterSequence === currentSequence),
    deferred: plans.filter((plan) => plan.chapterSequence !== currentSequence),
  }
}

function mapArtifactFocusChange(
  change: SynopsisDiscussArtifact["focusChange"],
): { focusChange?: NonNullable<SynopsisDiscussArtifact["focusChange"]> } {
  if (change === undefined) return {}
  return {
    focusChange: {
      chapterSequence: change.chapterSequence,
      ...(change.focusKind === undefined ? {} : { focusKind: change.focusKind }),
      ...(change.userRequestQuote === undefined ? {} : { userRequestQuote: change.userRequestQuote }),
    },
  }
}

/** The model interprets intent; code binds that interpretation to this message, not a phrase whitelist or old history. */
function isCurrentUserFocusChange(change: SynopsisDiscussArtifact["focusChange"], message: string): boolean {
  const quote = change?.userRequestQuote?.trim()
  return quote !== undefined && quote.length > 0 && message.includes(quote)
}

/** A user-requested switch happens before target-chapter work; never apply those writes to the captured old focus. */
function prepareUserFocusTransition(
  artifact: SynopsisDiscussArtifact,
  currentSequence: number,
  message: string,
): SynopsisDiscussArtifact {
  if (!isCurrentUserFocusChange(artifact.focusChange, message)
    || artifact.focusChange?.chapterSequence === currentSequence) return artifact
  return {
    assistantMessage: "本轮先处理你要求的章节焦点切换，写入前将重新读取目标章的材料。",
    finalSelfReview: artifact.finalSelfReview,
    focusChange: artifact.focusChange,
    ...(artifact.continueTurn === undefined ? {} : { continueTurn: artifact.continueTurn }),
    ...(artifact.choices === undefined ? {} : { choices: artifact.choices }),
  }
}

const DRAFT_PUBLISH_CONFIRMATION = "草稿可以，发布正文"
const PUBLISHABLE_DRAFT_STATUSES = new Set([
  "editing",
  "reviewing",
  "ready_to_submit",
  "awaiting_user_decision",
  "failed",
])

function publishedChapterAutoContinueMessage(chapterSequence: number): string {
  return renderRuntimePrompt("discuss-messages", "advance-after-publication", { chapterSequence, nextSequence: chapterSequence + 1 })
}

function buildStayInStageContinueMessage(stage: DiscussProceedStage): string {
  const label = DISCUSS_PIPELINE_STAGE_LABELS[stage]
  switch (stage) {
    case "chapter_requirements":
      return renderRuntimePrompt("discuss-messages", "stay-in-chapter-requirements", { stageLabel: label })
    case "synopsis_discuss":
      return renderRuntimePrompt("discuss-messages", "stay-in-synopsis", { stageLabel: label })
    case "outline_discuss":
      return renderRuntimePrompt("discuss-messages", "stay-in-outline", { stageLabel: label })
    case "draft_discuss":
      return renderRuntimePrompt("discuss-messages", "stay-in-draft", { stageLabel: label })
    case "body_discuss":
      return renderRuntimePrompt("discuss-messages", "stay-in-body", { stageLabel: label })
  }
}

function withDraftConfirmationChoice(
  choices: readonly SynopsisConversationChoice[] | undefined,
  draft: { draftLabel: string; draftVersionId: string },
): SynopsisConversationChoice[] {
  const rest = (choices ?? []).filter((choice) => choice.action !== "promote_draft_to_body")
  return [{
    label: `${DRAFT_PUBLISH_CONFIRMATION}（${draft.draftLabel}）`,
    action: "promote_draft_to_body",
    publishDraftVersionId: draft.draftVersionId,
  }, ...rest]
}

export function filterDiscussChoices(
  choices: SynopsisConversationChoice[] | undefined,
  input: Readonly<{
    focusLocked: boolean
    appliedFocusSequence?: number
    synopsisReady?: boolean
    synopsisConfirmed?: boolean
    outlineReady?: boolean
    offerSynopsisConfirmation?: boolean
  }>,
): SynopsisConversationChoice[] | undefined {
  const filtered = (choices ?? []).filter((choice) => {
    if (
      choice.action === "start_turn"
      && (
        input.focusLocked
        || input.synopsisReady === false
        || input.outlineReady === false
      )
    ) {
      return false
    }
    // Stage-gated shortcuts: no「按细纲写正文」until 细纲入库; no publish until 草稿入库.
    if (input.outlineReady === false && /按.*细纲写正文|写正文草稿/u.test(choice.label)) return false
    if (choice.action === "promote_draft_to_body" && input.outlineReady === false) return false
    if (choice.action === "confirm_synopsis" && input.synopsisReady === false) return false
    // Drop redundant confirm buttons once focus already moved this turn.
    if (
      choice.action === "set_focus"
      && input.appliedFocusSequence !== undefined
      && choice.chapterSequence === input.appliedFocusSequence
    ) {
      return false
    }
    return true
  })
  const shouldOfferConfirmation = input.offerSynopsisConfirmation === true
    && input.synopsisReady === true
    && input.synopsisConfirmed === false
  if (shouldOfferConfirmation) {
    const withoutDuplicateConfirmation = filtered.filter((choice) => choice.action !== "confirm_synopsis")
    return [
      { label: "用这份梗概写细纲", action: "confirm_synopsis" },
      ...withoutDuplicateConfirmation,
    ]
  }
  return filtered.length === 0 ? undefined : filtered
}

function buildFallbackDiscussChoices(input: Readonly<{
  volumePlanningNeedsFirstWrite: boolean
  volumeFolderName: string
}>): SynopsisConversationChoice[] {
  if (input.volumePlanningNeedsFirstWrite) {
    return [
      { label: `按建议继续完善「${input.volumeFolderName}」卷规划`, action: "continue_discuss" },
      { label: "我想调整本卷章节数、总字数、梗概或大纲", action: "continue_discuss" },
    ]
  }
  return [
    { label: "按当前建议继续", action: "continue_discuss" },
    { label: "我想调整方向或补充要求", action: "continue_discuss" },
  ]
}

function stripHeadingFromDraftBody(heading: string, body: string): string {
  try {
    return readChapterBody(heading, body).trim()
  } catch {
    return body.replaceAll("\r\n", "\n").trim()
  }
}

function countDiscussDraftCharacters(heading: string, body: string): number {
  return stripHeadingFromDraftBody(heading, body).replace(/\s+/gu, "").length
}

function isFocusOnlyScope(scope: DiscussTurnWriteScope | undefined): boolean {
  return scope?.focus === true && Object.keys(scope).every((key) => key === "focus")
}

function isOutlinePatchScope(scope: DiscussTurnWriteScope | undefined): scope is DiscussTurnWriteScope & { outline: "patch" } {
  return scope?.outline === "patch" && Object.keys(scope).every((key) => key === "outline")
}

function isVolumeComposeScope(scope: DiscussTurnWriteScope | undefined): boolean {
  return scope !== undefined && Object.keys(scope).length > 0
    && Object.keys(scope).every((key) => ["volume", "volumeSynopsis", "volumeOutline", "volumeTargets"].includes(key))
}

function scopedComposeIntent(scope: DiscussTurnWriteScope | undefined): Parameters<typeof composeArtifactFromText>[1] {
  if (scope === undefined || scope.outline === "patch"
    || (scope.synopsis === undefined && scope.outline === undefined && scope.draft === undefined)
    || Object.keys(scope).some((key) => key !== "synopsis" && key !== "outline" && key !== "draft" && key !== "chapterTitle")) return undefined
  return {
    ...(scope.synopsis === undefined ? {} : { synopsis: scope.synopsis }),
    ...(scope.outline === undefined ? {} : { outline: scope.outline }),
    ...(scope.draft === undefined ? {} : { draft: scope.draft }),
  }
}

function assessDiscussWriteScope(
  scope: DiscussTurnWriteScope,
  artifact: SynopsisDiscussArtifact,
  chapterSequence: number,
  toolDraftSaved: boolean,
  volumePlanning: VolumePlanningContext | undefined,
): string[] {
  const intent = artifact.planningWriteIntent
  const plans = artifact.volumeChapterPlans
  const focusedPlan = plans?.find((plan) => plan.chapterSequence === chapterSequence)
  const drafts = artifact.chapterDraftProposals
  const hasDraft = artifact.chapterDraftProposal !== undefined || (drafts?.length ?? 0) > 0
  const allowAdvance = scope.advance === true
  const issues: string[] = []

  if (scope.synopsis !== undefined
    && (!hasPlanningContent(artifact.synopsisBody ?? focusedPlan?.synopsisBody ?? "", true)
      || (intent?.synopsis !== scope.synopsis && focusedPlan === undefined))) issues.push("缺少本轮指定的梗概写入")
  if (scope.outline !== undefined && (scope.outline === "patch"
    ? artifact.bodyEdits === undefined || intent?.outline !== "patch"
    : !hasPlanningContent(artifact.outlineBody ?? focusedPlan?.outlineBody ?? "", false)
      || (intent?.outline !== scope.outline && focusedPlan === undefined))) issues.push("缺少本轮指定的细纲写入")
  if (scope.draft === "write" && !toolDraftSaved
    && artifact.chapterDraftProposal === undefined
    && !(drafts ?? []).some((draft) => scope.volumeDrafts === true || draft.chapterSequence === chapterSequence)) {
    issues.push(scope.volumeDrafts === true ? "缺少本轮指定的卷内草稿" : "缺少本轮指定的当前章草稿")
  }
  if (scope.volume !== undefined && (plans?.length ?? 0) === 0) issues.push("缺少本轮指定的整卷各章规划")
  if (plans?.some((plan) => !hasPlanningContent(plan.synopsisBody, true) || !hasPlanningContent(plan.outlineBody, false))) {
    issues.push("卷内章节梗概与细纲须有实际内容")
  }
  const start = volumePlanning?.startSequence
  const target = (scope.volumeTargets === true ? artifact.volumePlanMeta?.targetChapterCount : undefined)
    ?? volumePlanning?.targetChapterCount
  if (start !== undefined && target !== undefined && target > 0) {
    const scopedSequences = [
      ...(plans ?? []).map((plan) => plan.chapterSequence),
      ...(scope.volumeDrafts === true ? (drafts ?? []).map((draft) => draft.chapterSequence) : []),
    ]
    if (scopedSequences.some((sequence) => sequence < start || sequence >= start + target)) {
      issues.push(`卷内产物超出第${String(start)}–${String(start + target - 1)}章的目标范围`)
    }
  }
  if (scope.volumeSynopsis === true && !volumePlanningMarkdownHasContent(artifact.volumeSynopsis?.markdown)) issues.push("缺少本轮指定的卷梗概")
  if (scope.volumeOutline === true && !volumePlanningMarkdownHasContent(artifact.arcPlan?.markdown)) issues.push("缺少本轮指定的卷大纲")
  if (scope.volumeTargets === true && artifact.volumePlanMeta === undefined) issues.push("缺少本轮指定的卷章数或总字数")

  if (scope.volume === undefined && (intent?.volume !== undefined || (plans?.length ?? 0) > 0)) issues.push("本轮未授权整卷各章规划")
  if (!allowAdvance && scope.volumeDrafts !== true
    && (drafts ?? []).some((draft) => draft.chapterSequence !== chapterSequence)) issues.push("本轮未授权跨章写草稿")
  if (artifact.focusChange !== undefined && scope.focus !== true && !allowAdvance) issues.push("本轮未授权切换章节焦点")
  if (scope.volumeSynopsis !== true && artifact.volumeSynopsis !== undefined) issues.push("本轮未授权修改卷梗概")
  if (scope.volumeOutline !== true && artifact.arcPlan !== undefined) issues.push("本轮未授权修改卷大纲")
  if (scope.volumeTargets !== true && artifact.volumePlanMeta !== undefined) issues.push("本轮未授权修改卷目标")
  if (!allowAdvance) {
    if (scope.synopsis === undefined && (intent?.synopsis !== undefined || artifact.synopsisBody !== undefined)) issues.push("本轮未授权修改章梗概")
    if (scope.outline === undefined && (intent?.outline !== undefined || artifact.outlineBody !== undefined || artifact.bodyEdits !== undefined)) issues.push("本轮未授权修改细纲")
    if (scope.draft === undefined && (intent?.draft !== undefined || hasDraft)) issues.push("本轮未授权写草稿")
  }
  return issues
}

function normalizeDiscussDraftHeading(proposed: string, fallback: string): string {
  const trimmed = proposed.trim().replace(/^#+\s*/u, "")
  return trimmed.length === 0 ? fallback : trimmed
}

function hasPlanningContent(markdown: string, synopsis: boolean): boolean {
  if (markdown.trim().length === 0) return false
  if (synopsis && isSynopsisPlaceholderDocument(markdown)) return false
  const body = markdown.replace(/^\uFEFF?\s*(?:#|##)\s+[^\n]*\n?/u, "").trim()
  return body.length > 0
}

/**
 * discuss 基础包保持 3 个（discuss-workflow + plot-synopsis + starsea-writing），
 * 阶段 skill 按本轮动作挂到 phasePrompt：冷启动、梗概、细纲、写草稿各取所需。
 * outline-to-draft 仍由 discussionDraftGuide 注入，这里不重复。
 * settings-revision 改为 onDemand，由阶段提示点名 load_skill。
 */
function resolveDiscussStageSkillIds(input: Readonly<{
  workStyleGateActive: boolean
  creativeSetupActive: boolean
  writeScope: DiscussTurnWriteScope | undefined
  synopsisMarkdown: string
  outlineMarkdown: string
  /** 与 discussionDraftGuide 的注入条件完全一致。 */
  draftAction: boolean
}>): readonly string[] {
  const synopsisReady = hasPlanningContent(input.synopsisMarkdown, true)
  const outlineReady = hasPlanningContent(input.outlineMarkdown, false)
  // 创意设定问答生成轮的梗概/细纲是刻意留空的，不能据此判定“材料缺失”。
  const materialsTrustworthy = !input.creativeSetupActive && !input.workStyleGateActive
  const ids: string[] = []
  if (input.workStyleGateActive) ids.push("book-cold-start")
  if (input.writeScope?.synopsis !== undefined || (materialsTrustworthy && !synopsisReady)) {
    ids.push("user-to-synopsis")
  }
  if (input.writeScope?.outline !== undefined || (materialsTrustworthy && synopsisReady && !outlineReady)) {
    ids.push("synopsis-to-outline")
  }
  return ids
}

/** Legacy confirmation metadata only; prerequisite content, not this phrase, controls writes. */
export function isConfirmSynopsisUserMessage(message: string): boolean {
  const text = message.trim()
  if (text.length === 0) return false
  return /用这份梗概写细纲/u.test(text)
    || /确认(?:本章)?梗概/u.test(text)
    || /开始写细纲/u.test(text)
    || /确认梗概[，,]?\s*开始写细纲/u.test(text)
    || /按(?:照)?(?:这份)?梗概重写(?:整个)?细纲/u.test(text)
}

/** Skip outline and start body from synopsis. */
export function isSkipOutlineStartTurnMessage(message: string): boolean {
  const text = message.trim()
  if (text.length === 0) return false
  return /跳过细纲/u.test(text)
    || /按梗概开推/u.test(text)
    || /按这份梗概开推/u.test(text)
}

function mergeConfirmOutlineChoice(
  choices: SynopsisConversationSendResult["messages"][number]["choices"] | undefined,
): SynopsisConversationSendResult["messages"][number]["choices"] {
  const rest = (choices ?? []).filter((choice) => choice.label !== "按细纲写正文")
  return [...rest, { label: "按细纲写正文", action: "continue_discuss" as const }]
}
