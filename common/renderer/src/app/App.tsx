import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CHARACTER_DIRECTORY, isCharacterProfilePath, emptyCharacterProfile, parseCharacterProfile, type CharacterUpdate } from "@starseafolio/contracts"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { ArrowLeft, BookOpen, ChevronDown, Cloud, Cpu, FolderOpen, PanelLeftClose, PanelRightClose, Save, Settings2, X } from "lucide-react"
import type {
  ChapterRevision,
  ChapterRevisionReadResult,
  ChapterSummary,
  ChapterSynopsis,
  DeductionGoalsSnapshot,
  HistoryCheckoutResult,
  HistoryOverview,
  HistoryRetentionPreview,
  ProjectSettings,
  ResettableRuntimeMetricId,
  RevisionDraftVersion,
  RevisionDraftVersionListResult,
  ResolvedChapter,
  SynopsisConversationListResult,
  SynopsisConversationMessage,
  SynopsisConversationSendResult,
  SynopsisConversationStartResult,
  SynopsisConversationStreamSnapshot,
  DiscussFocusKind,
  SynopsisConversationBudgetAdvisory,
  SynopsisConversationStreamUsage,
  SynopsisStagingPromoteProposal,
} from "@starseafolio/contracts"

import {
  browserDemoProject,
  invokeBackend,
  abandonBackendRequest,
  BackendRequestAbandonedError,
  readModelProfiles,
  saveModelProfiles as persistModelProfiles,
  type BackendWaitTimeoutInfo,
  type GraphSlice,
  type OpenProject,
  type RecoverableTaskList,
  type TaskSnapshot,
  type TurnResult,
  type WorkspaceReport,
} from "../api/client.js"
import { AppChrome } from "../components/AppChrome.js"
import { MobileWorkbenchNavigation, type MobileWorkbenchPane } from "../components/MobileWorkbenchNavigation.js"
import { ProjectLauncher } from "../features/projects/ProjectLauncher.js"
import { ProjectRail } from "../features/projects/ProjectRail.js"
import { WorkNameControl } from "../features/projects/WorkNameControl.js"
import { rememberWorkName } from "../features/projects/work-name-history.js"
import { useAppUpdate } from "../hooks/useAppUpdate.js"
import { WorkspaceTree } from "../features/workspace/WorkspaceTree.js"
import { WorkspaceNameDialog } from "../features/workspace/WorkspaceNameDialog.js"
import { AUTO_DESCRIPTION_RULE_PATH, canCreateFolderInDirectory, findDuplicateVolumeSequence, isValidVolumeFolderName, isChapterVolumeContainerPath, isVolumeDirectoryPath, resolveCreateDestination } from "../features/workspace/workspace-locks.js"
import { EditorArea } from "../features/editor/EditorArea.js"
import { closeEditorDocument, MAX_OPEN_EDITOR_DOCUMENTS, openEditorDocument, saveEditorDocument, updateEditorDocument, type EditorDocument } from "../features/editor/editor-document-tabs.js"
import { ChapterBrowseDetailRail } from "../features/editor/ChapterBrowseDetailRail.js"
import { mapAiCreationDeskSettings, useCreationDeskPresentationPreferences, reconcileSelectedRulePath } from "../features/editor/creation-desk-presentation-preferences.js"
import { SettingsLineagePanel } from "../features/settings/SettingsLineagePanel.js"
import { ChapterWorkspaceRail } from "../features/editor/ChapterWorkspaceRail.js"
import type { RelatedChapterArtifact } from "../features/editor/ChapterArtifactRelatedRail.js"
import { CreationDeskProgressReviewDialog } from "../features/editor/CreationDeskProgressReviewDialog.js"
import { countPendingReviews } from "../features/editor/creation-desk-goals.js"
import {
  BATCH_CHAPTER_ONCE_USER_MESSAGE,
  BATCH_CHAPTER_OUTLINE_FOLLOWUP,
  BATCH_VOLUME_DRAFT_USER_MESSAGE,
  BATCH_VOLUME_PLAN_USER_MESSAGE,
  batchDeductionStatusLabel,
  createIdleBatchStatus,
  volumeChaptersHavePlans,
  type BatchDeductionMode,
  type BatchDeductionPhase,
  type BatchDeductionStatus,
} from "../features/editor/batch-chapter-deduction.js"
import {
  isChapterBodyMarkdownPath,
  isChapterPlanningMarkdownPath,
  listDiscussFocusChapters,
  parseChapterSequenceFromPath,
  resolveChapterArtifactRelationsWithInventory,
  resolveChapterMarkdownKind,
  resolveChapterSurfacePath,
} from "../features/editor/synopsis-path.js"
import { CreationDeskBatchControls } from "../features/editor/CreationDeskBatchControls.js"
import {
  BATCH_VOLUME_PLAN_DOC_PATH,
  PUBLISHING_REVISION_STATUSES,
  buildVolumeBatchProgress,
  buildTargetVolumeChapters,
  chaptersInVolume,
  findFirstIncompleteVolume,
  isVolumeBatchComplete,
  isVolumeOutlineReady,
  parseVolumeBatchPlan,
  volumeBatchPlanPath,
  volumeOutlinePath,
} from "../features/editor/volume-batch-deduction.js"
import { readPlanningFile } from "../features/editor/read-planning-file.js"
import { shouldAutoEnsureChapterRevision } from "../features/editor/chapter-workspace-types.js"
import { BackendWaitTimeoutDialog } from "../features/status/BackendWaitTimeoutDialog.js"
import { RightRail, summarizeSynopsisStreamTokenMetrics, summarizeSynopsisUsageTokenMetrics, type TaskTokenMetrics } from "../features/status/RightRail.js"
import { RightPanelViewport } from "../features/status/RightPanelViewport.js"
import { type ModelProfile } from "../features/settings/ModelConfigurationDialog.js"
import { AppUpdateDialog } from "../features/settings/AppUpdateDialog.js"
import { AppDialogsHost } from "../features/settings/AppDialogsHost.js"
import { WorkbenchPages } from "../features/settings/WorkbenchPages.js"
import { useWorkbenchStore } from "../state/workbench-store.js"
import { UiTooltip } from "../components/UiTooltip.js"

type PendingGraphLoad = Readonly<{
  result: TurnResult
  anchorOffset: number
  append: boolean
  reason: "continue" | "retry"
}>

export function App({ mobileLayout = false }: Readonly<{ mobileLayout?: boolean }> = {}): React.JSX.Element {
  const [mobilePane, setMobilePane] = useState<MobileWorkbenchPane>("editor")
  const [project, setProject] = useState<OpenProject | undefined>(browserDemoProject)
  const [coverByProjectId, setCoverByProjectId] = useState<Readonly<Record<string, string>>>({})
  const [report, setReport] = useState<WorkspaceReport>({ inventory: [], issues: [] })
  const [workspaceFilePaths, setWorkspaceFilePaths] = useState<readonly string[]>([])
  const [selectedPath, setSelectedPath] = useState<string>()
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [lineageMode, setLineageMode] = useState(false)
  const [browseChapters, setBrowseChapters] = useState(false)
  const [browseChapterSequence, setBrowseChapterSequence] = useState<number>()
  const [browseVolumeFolderName, setBrowseVolumeFolderName] = useState<string>()
  const [batchStatus, setBatchStatus] = useState<BatchDeductionStatus>(() => createIdleBatchStatus())
  const [volumeBatchPlan, setVolumeBatchPlan] = useState<ReturnType<typeof parseVolumeBatchPlan>>()
  const [openedDocumentPath, setOpenedDocumentPath] = useState<string>()
  const [openedDocuments, setOpenedDocuments] = useState<readonly EditorDocument[]>([])
  const [documentTabNotice, setDocumentTabNotice] = useState<string>()
  const openedDocumentsRef = useRef<readonly EditorDocument[]>([])
  const documentNavigationRef = useRef(0)
  const documentLoadRequestsRef = useRef(new Map<string, number>())
  const beforeDocumentLeaveRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const documentProjectRef = useRef(project?.projectId)
  documentProjectRef.current = project?.projectId
  const [content, setContent] = useState("")
  const [chapterBody, setChapterBody] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [selectedChapter, setSelectedChapter] = useState<ChapterSummary>()
  const [chapterSummaries, setChapterSummaries] = useState<readonly ChapterSummary[]>([])
  const [unpublishedDrafts, setUnpublishedDrafts] = useState<readonly ChapterRevisionReadResult[]>([])
  const [chapterRevision, setChapterRevision] = useState<ChapterRevision>()
  const [chapterRevisionContent, setChapterRevisionContent] = useState<string>()
  const [chapterDraftVersions, setChapterDraftVersions] = useState<readonly RevisionDraftVersion[]>([])
  const [discussDraftPromotion, setDiscussDraftPromotion] = useState<{
    revisionTaskId: string
    chapterId: string
    draftVersionId: string
  }>()
  const [synopsisConversation, setSynopsisConversation] = useState<SynopsisConversationListResult>({ messages: [] })
  const [synopsisConversationBusy, setSynopsisConversationBusy] = useState(false)
  const [synopsisDraftRestore, setSynopsisDraftRestore] = useState<{ text: string; token: number }>()
  const [backendWaitPrompt, setBackendWaitPrompt] = useState<{
    info: BackendWaitTimeoutInfo
    decide: (choice: "continue" | "abandon") => void
  }>()
  const [pendingStagingPromotes, setPendingStagingPromotes] = useState<readonly SynopsisStagingPromoteProposal[]>([])
  const [synopsisStream, setSynopsisStream] = useState<SynopsisConversationStreamSnapshot>()
  const [synopsisUsage, setSynopsisUsage] = useState<SynopsisConversationStreamUsage>()
  const synopsisStreamRef = useRef<SynopsisConversationStreamSnapshot | undefined>(undefined)
  const synopsisActiveRequestRef = useRef<string | null>(null)
  const synopsisStopDraftRef = useRef<string | null>(null)
  const synopsisSendInFlightRef = useRef(false)
  const synopsisAutoContinueCountRef = useRef(0)
  const [agentAutoChainActive, setAgentAutoChainActive] = useState(false)
  const sendSynopsisMessageRef = useRef<((
    message: string,
    options?: Readonly<{
      agentMode?: "auto" | "plan" | "accept_edits"
      batchProceed?: boolean
      autoContinued?: boolean
      setupAnswerTo?: string
    }>,
  ) => Promise<boolean>) | undefined>(undefined)
  const batchCancelRef = useRef(false)
  const batchPauseRequestedRef = useRef(false)
  const batchRunningRef = useRef(false)
  const batchContextRef = useRef<Readonly<{
    mode: BatchDeductionMode
    volumeFolderName?: string
  }>>({ mode: "volume_batch" })
  const discussHandoffWatchRef = useRef(0)
  const chapterDraftVersionRequestRef = useRef(0)
  const displayedRevisionRef = useRef<string | undefined>(undefined)
  displayedRevisionRef.current = chapterRevision?.revisionTaskId
  const selectedPathRef = useRef<string | undefined>(undefined)
  selectedPathRef.current = selectedPath
  const [chapterSynopsis, setChapterSynopsis] = useState<ChapterSynopsis>()
  const [relatedChapterArtifacts, setRelatedChapterArtifacts] = useState<readonly RelatedChapterArtifact[]>([])
  const [prompt, setPrompt] = useState("")
  const [presentation, updatePresentation] = useCreationDeskPresentationPreferences(project?.projectId)
  const {
    descriptionRule,
    proseRule,
    novelMajorCategoryRulePath,
    novelSubcategoryRulePath,
    minimumWordCount,
    maximumWordCount,
    boundaryPace,
    causalityFocus,
  } = presentation
  const [task, setTask] = useState<TaskSnapshot>()
  const [graphSlice, setGraphSlice] = useState<GraphSlice>()
  const [error, setError] = useState<string>()
  const dismissedWorkspaceIssueKeysRef = useRef(new Set<string>())
  const [synopsisBudgetWarning, setSynopsisBudgetWarning] = useState<SynopsisConversationBudgetAdvisory>()
  const [postCommitNotice, setPostCommitNotice] = useState<string>()
  const [progressReviewOpen, setProgressReviewOpen] = useState(false)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [pendingGraphLoad, setPendingGraphLoad] = useState<PendingGraphLoad>()
  const appUpdate = useAppUpdate()
  const [workspaceCreatePrompt, setWorkspaceCreatePrompt] = useState<{
    kind: "file" | "directory"
    parentPath: string
  }>()
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>()
  const [history, setHistory] = useState<HistoryOverview>()
  const [, setHistoryLoading] = useState(false)
  const [modelProfiles, setModelProfiles] = useState<readonly ModelProfile[]>([])
  const [activeModelProfileId, setActiveModelProfileId] = useState("")
  const monitoredChapterRevisionIds = useRef(new Set<string>())
  const activeModelProfile = modelProfiles.find((profile) => profile.id === activeModelProfileId)
  const parsedMinimumWordCount = parseWordCount(minimumWordCount)
  const parsedMaximumWordCount = parseWordCount(maximumWordCount)
  const wordCountValid = parsedMinimumWordCount !== undefined
    && parsedMaximumWordCount !== undefined
    && parsedMinimumWordCount <= parsedMaximumWordCount

  const replaceOpenedDocuments = useCallback((documents: readonly EditorDocument[]): void => {
    openedDocumentsRef.current = documents
    setOpenedDocuments(documents)
  }, [])

  const reserveDocument = (path: string): boolean => {
    const opened = openEditorDocument(openedDocumentsRef.current, path)
    if (!opened.accepted) {
      setDocumentTabNotice(`最多同时打开 ${String(MAX_OPEN_EDITOR_DOCUMENTS)} 个文件，请先关闭部分文件标签后再打开。`)
      return false
    }
    replaceOpenedDocuments(opened.documents)
    setDocumentTabNotice(undefined)
    return true
  }

  const registerBeforeDocumentLeave = useCallback((handler: (() => Promise<void>) | undefined): void => {
    beforeDocumentLeaveRef.current = handler
  }, [])

  const beginDocumentNavigation = async (): Promise<number | undefined> => {
    const requestId = ++documentNavigationRef.current
    try {
      await beforeDocumentLeaveRef.current?.()
      return requestId === documentNavigationRef.current ? requestId : undefined
    } catch (cause) {
      setError(`无法切换文件，当前草稿尚未保存：${cause instanceof Error ? cause.message : String(cause)}`)
      return undefined
    }
  }

  const changeDocumentContent = (value: string): void => {
    if (selectedPath === undefined || selectedPathRef.current !== selectedPath) return
    setContent(value)
    replaceOpenedDocuments(updateEditorDocument(openedDocumentsRef.current, selectedPath, { content: value }))
  }

  const showDocument = (path: string): void => {
    chapterDraftVersionRequestRef.current += 1
    selectedPathRef.current = path
    setSelectedPath(path)
    setOpenedDocumentPath(path)
    setBrowseChapters(false)
    setBrowseChapterSequence(undefined)
    setBrowseVolumeFolderName(undefined)
    setLineageMode(false)
    setRelatedChapterArtifacts([])
    setChapterSynopsis(undefined)
  }

  const refreshSynopsisConversation = useCallback(async (): Promise<void> => {
    if (project === undefined) return
    const result = await invokeBackend<SynopsisConversationListResult>("synopsis.conversation.list", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
    })
    setSynopsisConversation(result)
    setSynopsisUsage(result.usage)
  }, [project])

  const handleCoverChanged = useCallback((projectId: string, dataUrl: string): void => {
    setCoverByProjectId((current) => ({ ...current, [projectId]: dataUrl }))
  }, [])

  const syncDiscussFocus = useCallback(async (path: string): Promise<void> => {
    if (project === undefined) return
    const normalized = path.replaceAll("\\", "/")
    if (!normalized.startsWith("章节正文/") || !normalized.endsWith(".md")) return
    try {
      const focused = await invokeBackend<SynopsisConversationStartResult>("synopsis.conversation.setFocus", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        relativePath: normalized,
      })
      setSynopsisConversation(focused)
      if (focused.usage !== undefined) setSynopsisUsage(focused.usage)
    } catch {
      // Opening a chapter file should still succeed if discuss focus cannot update.
    }
  }, [project])

  const refreshChapterSynopsis = useCallback(async (chapterId: string): Promise<void> => {
    if (project === undefined) return
    const requestedPath = selectedPathRef.current
    const result = await invokeBackend<ChapterSynopsis | undefined>("chapter.synopsis.get", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      chapterId,
    })
    if (documentProjectRef.current === project.projectId && selectedPathRef.current === requestedPath) setChapterSynopsis(result)
  }, [project])

  const loadRelatedChapterArtifacts = useCallback(async (path: string): Promise<void> => {
    if (project === undefined) {
      setRelatedChapterArtifacts([])
      return
    }
    const relations = resolveChapterArtifactRelationsWithInventory(path, workspaceFilePaths)
    if (relations === undefined) {
      setRelatedChapterArtifacts([])
      return
    }
    const candidates: Array<{ kind: RelatedChapterArtifact["kind"]; path: string }> = [
      { kind: "plot_synopsis", path: relations.synopsisPath },
      { kind: "plot_outline", path: relations.outlinePath },
      { kind: "chapter_body", path: relations.bodyPath },
    ]
    const visible = relations.kind === "chapter_body"
      ? candidates.filter((item) => item.kind !== "chapter_body")
      : candidates.filter((item) => item.path !== relations.currentPath)

    const loaded = await Promise.all(visible.map(async (item) => {
      try {
        const result = await invokeBackend<{ content: string }>("workspace.read", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          relativePath: item.path,
        })
        return {
          kind: item.kind,
          path: item.path,
          present: true,
          // Preview only — full body lives in the editor when opened.
          content: result.content.length > 2800
            ? `${result.content.slice(0, 2800)}\n…`
            : result.content,
        } satisfies RelatedChapterArtifact
      } catch {
        return {
          kind: item.kind,
          path: item.path,
          present: false,
        } satisfies RelatedChapterArtifact
      }
    }))
    if (documentProjectRef.current === project.projectId && selectedPathRef.current === path) setRelatedChapterArtifacts(loaded)
  }, [project, workspaceFilePaths])

  const refreshChapterDraftVersions = useCallback(async (revisionTaskId: string | undefined): Promise<void> => {
    const requestId = chapterDraftVersionRequestRef.current + 1
    chapterDraftVersionRequestRef.current = requestId
    if (project === undefined || revisionTaskId === undefined) {
      setChapterDraftVersions([])
      return
    }
    try {
      const listed = await invokeBackend<RevisionDraftVersionListResult>("chapter.revision.draftVersion.list", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        revisionTaskId,
        includeChapterHistory: true,
      })
      if (chapterDraftVersionRequestRef.current !== requestId) return
      setChapterDraftVersions(listed.versions)
    } catch {
      if (chapterDraftVersionRequestRef.current !== requestId) return
      setChapterDraftVersions([])
    }
  }, [project])

  const refreshWorkspace = useCallback(async (): Promise<readonly string[]> => {
    if (project === undefined) return []
    const [next, chapters, drafts] = await Promise.all([
      invokeBackend<WorkspaceReport>("workspace.list", { workspaceRootRef: project.workspaceRootRef }),
      invokeBackend<readonly ChapterSummary[]>("chapter.list", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
      }),
      invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
      }),
    ])
    setUnpublishedDrafts(drafts)
    setChapterSummaries(chapters)
    // Tree surfaces prefer body > outline > synopsis among same-chapter siblings.
    // Use on-disk files only — registered-but-missing publish paths must not hide
    // current 梗概/细纲 after titles were renamed (e.g. 第三章 秤与约 → 北地来的信使).
    const onDiskPaths = new Set(
      next.inventory.filter((entry) => entry.kind === "file").map((entry) => entry.path),
    )
    const filePaths = [
      ...onDiskPaths,
      ...drafts.flatMap((draft) => draft.publishPath === undefined ? [] : [draft.publishPath]),
    ]
    setWorkspaceFilePaths(filePaths)
    const chapterFiles = [
      ...drafts.flatMap((draft) => draft.publishPath === undefined ? [] : [{ path: draft.publishPath, kind: "file" as const }]),
      ...next.inventory.filter((entry) => (
        entry.path.startsWith("章节正文/")
        && entry.kind === "file"
        && (isChapterPlanningMarkdownPath(entry.path) || isChapterBodyMarkdownPath(entry.path))
      )),
      ...chapters
        .map((chapter) => chapter.publishPath)
        .filter((publishPath) => onDiskPaths.has(publishPath) && isChapterBodyMarkdownPath(publishPath))
        .map((publishPath) => ({ path: publishPath, kind: "file" as const })),
    ]
    const surfaceByDir = new Map<string, string>()
    const byDir = new Map<string, string[]>()
    for (const entry of chapterFiles) {
      const dir = entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "章节正文"
      const list = byDir.get(dir) ?? []
      list.push(entry.path)
      byDir.set(dir, list)
    }
    for (const [, paths] of byDir) {
      // Group by chapter sequence when parseable so divergent titles still fold;
      // fall back to basename stem for unlabeled files.
      const groups = new Map<string, string[]>()
      for (const path of paths) {
        const name = path.slice(path.lastIndexOf("/") + 1)
        const stem = name
          .replace(/\s*\[剧情梗概\]\.md$/u, "")
          .replace(/\[剧情梗概\]\.md$/u, "")
          .replace(/\s*\[剧情细纲\]\.md$/u, "")
          .replace(/\[剧情细纲\]\.md$/u, "")
          .replace(/\.md$/u, "")
        const sequenceMatch = stem.match(/^第(\d+|[零一二三四五六七八九十百]+)章(?:\s|$)/u)
        const groupKey = sequenceMatch === null
          ? `stem:${stem}`
          : `seq:${sequenceMatch[1] ?? stem}`
        const group = groups.get(groupKey) ?? []
        group.push(path)
        groups.set(groupKey, group)
      }
      for (const groupPaths of groups.values()) {
        const surface = resolveChapterSurfacePath(groupPaths)
        if (surface !== undefined) surfaceByDir.set(surface, surface)
      }
    }
    const foldedChapterFiles = chapterFiles.filter((entry) => surfaceByDir.has(entry.path))
    const inventory = [
      ...next.inventory.filter((entry) => !entry.path.startsWith("章节正文/") || entry.kind === "directory"),
      ...foldedChapterFiles,
    ].sort((left, right) => left.path.localeCompare(right.path, "zh-CN"))
    setReport({ ...next, inventory })
    const workspaceGateIssues = next.issues.filter((issue) => (
      issue.code === "invalid_synopsis_name"
      || issue.code === "chapter_missing_volume"
      || issue.code === "invalid_volume_name"
    ))
    const visibleIssues = workspaceGateIssues.filter((issue) => {
      const key = `${issue.code}:${issue.path}:${issue.message}`
      return !dismissedWorkspaceIssueKeysRef.current.has(key)
    })
    if (visibleIssues.length > 0) {
      setError(visibleIssues.map((issue) => `${issue.path}：${issue.message}`).join("\n"))
    }
    return filePaths
  }, [project])

  useEffect(() => {
    if (project === undefined || synopsisConversation.session === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const chapterSequence = synopsisConversation.session.chapterSequence
    const poll = async (): Promise<void> => {
      try {
        const latest = await invokeBackend<TaskSnapshot | null>("turn.latest.get", {
          projectId: project.projectId, workspaceRootRef: project.workspaceRootRef, chapterSequence,
        })
        if (active) setTask(latest ?? undefined)
      } catch {
        // Keep the current monitor during a transient backend failure.
      } finally {
        if (active) timer = setTimeout(() => { void poll() }, 1000)
      }
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [project, synopsisConversation.session?.chapterSequence])

  const readWorkspaceFile = useCallback(async (path: string): Promise<{ path: string; content: string }> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    const opened = await readPlanningFile(path, {
      read: async (relativePath) => {
        const result = await invokeBackend<{ content: string }>("workspace.read", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          relativePath,
        })
        return result.content
      },
      listPaths: async () => {
        const live = await invokeBackend<WorkspaceReport>("workspace.list", {
          workspaceRootRef: project.workspaceRootRef,
        })
        return live.inventory.filter((entry) => entry.kind === "file").map((entry) => entry.path)
      },
    })
    if (opened.path !== path) void refreshWorkspace().catch(() => undefined)
    return opened
  }, [project, refreshWorkspace])

  const setDiscussFocus = useCallback(async (sequence: number, focusKind: DiscussFocusKind): Promise<void> => {
    if (project === undefined) return
    try {
      const focused = await invokeBackend<SynopsisConversationStartResult>("synopsis.conversation.setFocus", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        chapterSequence: sequence,
        focusKind,
      })
      setSynopsisConversation(focused)
      if (focused.usage !== undefined) setSynopsisUsage(focused.usage)
      await refreshWorkspace()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [project, refreshWorkspace])

  const watchDiscussFocusAfterPublish = useCallback(async (publishedSequence: number): Promise<void> => {
    if (project === undefined) return
    discussHandoffWatchRef.current += 1
    const watchId = discussHandoffWatchRef.current
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (watchId !== discussHandoffWatchRef.current) return
      try {
        const result = await invokeBackend<SynopsisConversationListResult>("synopsis.conversation.list", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
        })
        if (watchId !== discussHandoffWatchRef.current) return
        setSynopsisConversation(result)
        if (result.usage !== undefined) setSynopsisUsage(result.usage)
        if ((result.session?.chapterSequence ?? 0) > publishedSequence) {
          const openPath = selectedPathRef.current
          if (openPath !== undefined && openPath.startsWith("章节正文/")) {
            await syncDiscussFocus(openPath)
            return
          }
          setPostCommitNotice((current) => (
            current === "正文已写入工作区，正在完成梗概交接…" ? undefined : current
          ))
          return
        }
      } catch {
        // Handoff focus watch is best-effort while analysis still runs.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }, [project, syncDiscussFocus])

  const discussFocusChapters = useMemo(() => {
    const listed = listDiscussFocusChapters(workspaceFilePaths)
    const session = synopsisConversation.session
    if (session === undefined) return listed
    if (listed.some((item) => item.sequence === session.chapterSequence)) return listed
    const fromSessionPath = listDiscussFocusChapters([session.synopsisPath])[0]
    const injected = fromSessionPath ?? {
      sequence: session.chapterSequence,
      label: session.title,
      synopsisPath: session.synopsisPath,
    }
    return [...listed, injected].sort((left, right) => left.sequence - right.sequence)
  }, [workspaceFilePaths, synopsisConversation.session])

  const publishingSequences = useMemo(() => new Set(
    unpublishedDrafts
      .filter((draft) => PUBLISHING_REVISION_STATUSES.has(draft.status))
      .map((draft) => draft.chapterSequence)
      .filter((sequence): sequence is number => sequence !== undefined),
  ), [unpublishedDrafts])

  // Discuss Agent touching chapters (draft writes, publish/workflow tools, auto-continued chain).
  const agentChapterActive = useMemo(() => {
    if (batchStatus.running) return false
    if (agentAutoChainActive) return true
    if (!synopsisConversationBusy) return false
    const stream = synopsisStream
    if (stream === undefined) return false
    return stream.toolRuns.some((run) => (
      run.name === "publish_draft" || run.name === "chapter_workflow" || run.name === "restage_chapter"
    )) || stream.editing.some((edit) => edit.kind === "draft")
  }, [agentAutoChainActive, batchStatus.running, synopsisConversationBusy, synopsisStream])

  const batchProgressRows = useMemo(() => {
    const sessionVolume = discussFocusChapters
      .find((chapter) => chapter.sequence === synopsisConversation.session?.chapterSequence)
      ?.volumeFolderName
    const volumeName = batchStatus.volumeFolderName
      ?? (agentChapterActive ? sessionVolume : undefined)
      ?? findFirstIncompleteVolume(discussFocusChapters)?.volumeFolderName
    if (volumeName === undefined) return []
    const currentPlan = volumeBatchPlan?.volumeFolderName === volumeName ? volumeBatchPlan : undefined
    const volumeChapters = currentPlan === undefined
      ? chaptersInVolume(discussFocusChapters, volumeName)
      : buildTargetVolumeChapters(discussFocusChapters, volumeName, currentPlan.targetChapterCount, currentPlan.startSequence)
    const draftSequences = new Set(
      unpublishedDrafts
        .filter((draft) => draft.proposedBody.trim().length > 0 && draft.status !== "completed")
        .map((draft) => draft.chapterSequence)
        .filter((sequence): sequence is number => sequence !== undefined),
    )
    return buildVolumeBatchProgress(volumeChapters, draftSequences, publishingSequences)
  }, [
    agentChapterActive,
    batchStatus.volumeFolderName,
    discussFocusChapters,
    publishingSequences,
    synopsisConversation.session?.chapterSequence,
    unpublishedDrafts,
    volumeBatchPlan,
  ])

  // Keep chapter stages (draft → 图修订中 → 正文) live while the Agent works across chapters.
  useEffect(() => {
    if (!agentChapterActive && publishingSequences.size === 0) return
    const timer = setInterval(() => { void refreshWorkspace().catch(() => undefined) }, 5_000)
    return () => { clearInterval(timer) }
  }, [agentChapterActive, publishingSequences.size, refreshWorkspace])

  const agentChapterStatusLabel = useMemo(() => {
    if (!agentChapterActive) return ""
    const sequence = synopsisConversation.session?.chapterSequence
    const publishing = [...publishingSequences].sort((left, right) => left - right)
    if (publishing.length > 0) {
      return `第${publishing.join("、")}章图修订中…`
    }
    if (synopsisConversationBusy) {
      return sequence === undefined ? "Agent 推进中…" : `Agent 推进第${String(sequence)}章…`
    }
    return "等待自动续跑下一轮…"
  }, [agentChapterActive, publishingSequences, synopsisConversation.session?.chapterSequence, synopsisConversationBusy])

  const loadHistoryGraph = useCallback(async (anchorIds: readonly string[]): Promise<void> => {
    if (project === undefined || anchorIds.length === 0) {
      setGraphSlice(undefined)
      return
    }
    const slice = await invokeBackend<GraphSlice>("graph.neighborhood", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      anchorIds,
      anchorOffset: 0,
      direction: "both",
      maxDepth: Math.max(1, projectSettings?.graph.preferredExpansionDepth ?? 2),
      maxNodes: projectSettings?.graph.maxVisitedNodes ?? 48,
      maxLinks: projectSettings?.graph.maxVisitedLinks ?? 96,
    })
    setGraphSlice(slice)
    if (slice.anchorWindow?.remainingCount !== undefined && slice.anchorWindow.remainingCount > 0) {
      setPostCommitNotice(`历史状态已恢复。世界图入口较多，当前显示首批 ${String(slice.anchorWindow.processedCount)} 个入口。`)
    }
  }, [project, projectSettings])

  const refreshHistory = useCallback(async (): Promise<HistoryOverview | undefined> => {
    if (project === undefined) return undefined
    setHistoryLoading(true)
    try {
      const overview = await invokeBackend<HistoryOverview>("history.list", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
      })
      setHistory(overview)
      await loadHistoryGraph(overview.graphAnchorIds)
      return overview
    } finally {
      setHistoryLoading(false)
    }
  }, [loadHistoryGraph, project])

  useEffect(() => { void refreshWorkspace() }, [refreshWorkspace])
  useEffect(() => { void refreshHistory() }, [refreshHistory])
  useEffect(() => {
    synopsisStreamRef.current = synopsisStream
  }, [synopsisStream])
  useEffect(() => {
    if (project === undefined || selectedPath !== undefined) return
    void refreshSynopsisConversation()
  }, [project, refreshSynopsisConversation, selectedPath])

  useEffect(() => {
    if (project === undefined) {
      setProjectSettings(undefined)
      setTask(undefined)
      setGraphSlice(undefined)
      setHistory(undefined)
      setPostCommitNotice(undefined)
      dismissedWorkspaceIssueKeysRef.current.clear()
      return
    }
    let active = true
    setProjectSettings(undefined)
    void invokeBackend<ProjectSettings>("project.settings.read", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
    }).then(async (settings) => {
      if (!active) return
      setProjectSettings(settings)
      const tasks = await invokeBackend<RecoverableTaskList>("turn.recoverable.list", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
      })
      if (!active) return
      const recoverable = tasks[0]
      if (recoverable !== undefined) {
        setTask(recoverable)
        if (recoverable.status === "awaiting_user_decision") {
          setPostCommitNotice("已恢复最近一次暂停的推演任务；请在弹出的检查点面板中决定重试、继续或回退本轮。")
        } else if (recoverable.status === "waiting_for_review") {
          setPostCommitNotice("正文已生成，请在弹出的检查点面板中确认设定抽取提案后再继续图治理。")
        }
      } else {
        const latest = await invokeBackend<TaskSnapshot | null>("turn.latest.get", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
        })
        if (!active) return
        setTask(latest ?? undefined)
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [project])

  useEffect(() => {
    void readModelProfiles().then((saved) => {
      setModelProfiles(saved.profiles)
      setActiveModelProfileId(saved.activeProfileId)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  useEffect(() => {
    const handleCommand = (command: "project.new" | "project.open" | "turn.start"): void => {
      if (command === "project.new" || command === "project.open") resetWorkbenchForProject(undefined)
      if (command === "turn.start") void startTurn()
    }
    const unsubscribe = window.worldseed?.onCommand(handleCommand)
    const onLocal = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      if (detail === "project.new" || detail === "project.open" || detail === "turn.start") {
        handleCommand(detail)
      }
    }
    window.addEventListener("worldseed:local-command", onLocal)
    return () => {
      unsubscribe?.()
      window.removeEventListener("worldseed:local-command", onLocal)
    }
  })

  const openDraftWorkspace = async (
    revisionTaskId: string,
    options?: Readonly<{ preserveView?: boolean }>,
  ): Promise<void> => {
    if (project === undefined) return
    const preserveView = options?.preserveView === true
    const requestId = preserveView ? undefined : await beginDocumentNavigation()
    if (!preserveView && requestId === undefined) return
    let requestedPath: string | undefined
    const isCurrentNavigation = (): boolean => documentProjectRef.current === project.projectId
      && (preserveView || requestId === documentNavigationRef.current)
      && (requestedPath === undefined || openedDocumentsRef.current.some((document) => document.path === requestedPath))
    const revision = await invokeBackend<ChapterRevisionReadResult>("chapter.readRevision", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      revisionTaskId,
    })
    if (!isCurrentNavigation()) return
    if (!preserveView && (revision.publishPath === undefined || !reserveDocument(revision.publishPath))) return
    if (!preserveView) requestedPath = revision.publishPath
    const drafts = await invokeBackend<RevisionDraftVersionListResult>("chapter.revision.draftVersion.list", {
      projectId: project.projectId, workspaceRootRef: project.workspaceRootRef, revisionTaskId, includeChapterHistory: true,
    })
    const isDisplayed = (): boolean => selectedPathRef.current !== undefined
      && selectedPathRef.current === revision.publishPath
      && displayedRevisionRef.current === revisionTaskId
    if (!isCurrentNavigation() || (preserveView && !isDisplayed())) return
    chapterDraftVersionRequestRef.current += 1
    if (revision.isInitialPublication !== true || revision.status === "completed") {
      const current = await invokeBackend<ChapterSummary & { content: string; body: string }>("chapter.read", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        chapterId: revision.chapterId,
      })
      if (!isCurrentNavigation() || (preserveView && !isDisplayed())) return
      if (!preserveView) {
        showDocument(current.publishPath)
      }
      setSelectedChapter(current)
      setContent(current.content)
      setChapterBody(current.body)
      setSavedContent(current.content)
      void loadRelatedChapterArtifacts(current.publishPath)
      setChapterRevision(revision)
      setChapterRevisionContent(revision.proposedBody)
      setChapterDraftVersions(drafts.versions)
      return
    }
    if (!preserveView) {
      if (revision.publishPath === undefined) return
      showDocument(revision.publishPath)
    }
    setSelectedChapter(undefined)
    setContent("")
    setChapterBody("")
    setSavedContent("")
    setChapterSynopsis(undefined)
    if (revision.publishPath !== undefined) void loadRelatedChapterArtifacts(revision.publishPath)
    setChapterRevision(revision)
    setChapterRevisionContent(revision.proposedBody)
    setChapterDraftVersions(drafts.versions)
    if (shouldMonitorChapterRevision(revision.graphSyncStatus)) {
      void monitorChapterRevision(revisionTaskId)
    }
  }

  const openFile = async (path: string | undefined): Promise<void> => {
    if (project === undefined || !isWorkspaceFilePath(path)) {
      setError("无法打开文件：工作区文件路径为空或无效")
      return
    }
    const unpublished = unpublishedDrafts.find((draft) => draft.publishPath === path)
    if (unpublished !== undefined) {
      try {
        await openDraftWorkspace(unpublished.revisionTaskId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
      return
    }
    const wasOpen = openedDocumentsRef.current.some((document) => document.path === path)
    if (!reserveDocument(path)) return
    const pendingNavigation = beginDocumentNavigation()
    const navigationId = documentNavigationRef.current
    documentLoadRequestsRef.current.set(path, navigationId)
    const requestId = await pendingNavigation
    if (requestId === undefined) {
      if (!wasOpen && documentLoadRequestsRef.current.get(path) === navigationId) {
        documentLoadRequestsRef.current.delete(path)
        replaceOpenedDocuments(openedDocumentsRef.current.filter((document) => document.path !== path))
      }
      return
    }
    const isCurrentNavigation = (): boolean => requestId === documentNavigationRef.current
      && documentProjectRef.current === project.projectId
      && documentLoadRequestsRef.current.get(path) === requestId
      && openedDocumentsRef.current.some((document) => document.path === path)
    const showMarkdown = (openedPath: string, diskContent: string): void => {
      if (!isCurrentNavigation()) return
      if (openedPath !== path) {
        replaceOpenedDocuments(openedDocumentsRef.current.filter((document) => document.path !== path))
        if (!reserveDocument(openedPath)) return
      }
      const buffered = openedDocumentsRef.current.find((document) => document.path === openedPath)
      const localChanges = buffered?.content !== undefined && buffered.content !== buffered.savedContent
      const nextContent = localChanges ? buffered.content : diskContent
      const nextSavedContent = localChanges ? buffered.savedContent ?? diskContent : diskContent
      replaceOpenedDocuments(updateEditorDocument(openedDocumentsRef.current, openedPath, { content: nextContent, savedContent: nextSavedContent }))
      showDocument(openedPath)
      setSelectedChapter(undefined)
      setChapterRevision(undefined)
      setChapterRevisionContent(undefined)
      setChapterDraftVersions([])
      setContent(nextContent)
      setChapterBody("")
      setSavedContent(nextSavedContent)
    }
    setError(undefined)
    try {
      const buffered = openedDocumentsRef.current.find((document) => document.path === path)
      if (buffered?.content !== undefined && buffered.content !== buffered.savedContent) {
        showMarkdown(path, buffered.savedContent ?? "")
        if (isChapterPlanningMarkdownPath(path)) {
          void loadRelatedChapterArtifacts(path)
          void syncDiscussFocus(path)
        }
        return
      }
      // Synopsis/outline are planning markdown on disk; they are not committed chapter publish paths.
      if (isChapterPlanningMarkdownPath(path)) {
        const opened = await readWorkspaceFile(path)
        if (!isCurrentNavigation()) return
        const openedPath = opened.path
        showMarkdown(openedPath, opened.content)
        void loadRelatedChapterArtifacts(openedPath)
        void syncDiscussFocus(openedPath)
        return
      }
      if (path.startsWith("章节正文/")) {
        const resolved = await invokeBackend<ResolvedChapter>("chapter.resolveByPath", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          publishPath: path,
        })
        if (!isCurrentNavigation()) return
        showDocument(path)
        setSelectedChapter(resolved.committed)
        setChapterRevision(resolved.activeRevision)
        setChapterRevisionContent(resolved.activeRevision?.proposedBody)
        void refreshChapterDraftVersions(resolved.activeRevision?.revisionTaskId)
        setContent(resolved.committed.content)
        setChapterBody(resolved.committed.body)
        setSavedContent(resolved.committed.content)
        if (resolved.activeRevision !== undefined && shouldMonitorChapterRevision(resolved.activeRevision.graphSyncStatus)) {
          void monitorChapterRevision(resolved.activeRevision.revisionTaskId)
        }
        void refreshChapterSynopsis(resolved.committed.chapterId)
        void loadRelatedChapterArtifacts(path)
        void syncDiscussFocus(path)
        return
      }
      const result = await invokeBackend<{ content: string }>("workspace.read", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        relativePath: path,
      })
      showMarkdown(path, result.content)
    } catch (cause) {
      if (documentLoadRequestsRef.current.get(path) !== requestId || documentProjectRef.current !== project.projectId) return
      if (!wasOpen) replaceOpenedDocuments(openedDocumentsRef.current.filter((document) => document.path !== path))
      if (requestId === documentNavigationRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const openVolumeOutline = (volumeFolderName: string): void => {
    if (project === undefined) return
    const path = volumeOutlinePath(volumeFolderName)
    void (async () => {
      try {
        await invokeBackend<{ content: string }>("workspace.read", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          relativePath: path,
        })
        await openFile(path)
      } catch {
        setError(`尚未找到卷大纲：${path}。可在创作台让 Agent 完善后写入该路径（文件名须与卷文件夹名一致）。`)
      }
    })()
  }

  const startChapterRevision = async (heading: string, body: string): Promise<ChapterRevision> => {
    if (project === undefined || selectedChapter === undefined) throw new Error("当前没有可修订章节")
    const revision = await invokeBackend<ChapterRevision>("chapter.startRevision", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      chapterId: selectedChapter.chapterId,
      baseSourceId: selectedChapter.sourceId,
      heading,
      body,
      inputMode: "agent",
    })
    setChapterRevision(revision)
    setChapterRevisionContent(body)
    await refreshChapterDraftVersions(revision.revisionTaskId)
    return revision
  }

  const createFocusedDraft = async (): Promise<void> => {
    if (project === undefined) return
    const session = synopsisConversation.session
    if (session === undefined) throw new Error("请先选择讨论焦点章节")
    const heading = /^第.+章/u.test(session.title) ? session.title : `第${String(session.chapterSequence)}章 ${session.title}`
    const version = await invokeBackend<RevisionDraftVersion>("chapter.draft.start", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      chapterSequence: session.chapterSequence,
      heading,
      body: "（待撰写）",
      source: "manual",
      ...(session.synopsisPath.split("/")[1] === undefined ? {} : { volumeFolderName: session.synopsisPath.split("/")[1] }),
    })
    await refreshWorkspace()
    await openDraftWorkspace(version.revisionTaskId)
  }

  const ensureChapterRevision = async (heading: string, body: string): Promise<ChapterRevision | undefined> => {
    if (project === undefined) return undefined
    if (chapterRevision !== undefined && !shouldAutoEnsureChapterRevision(chapterRevision)) {
      return chapterRevision
    }
    if (selectedChapter === undefined) return undefined
    const revision = await startChapterRevision(heading, body)
    return revision
  }

  const updateChapterRevision = async (revisionTaskId: string, heading: string, body: string, draftVersionId?: string): Promise<ChapterRevision> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    const selectedDraftVersionId = chapterDraftVersions.some((version) => (
      version.versionId === draftVersionId
      && version.revisionTaskId === revisionTaskId
      && version.isLatest
      && version.source !== "baseline"
    ))
      ? draftVersionId
      : chapterDraftVersions.find((version) => version.revisionTaskId === revisionTaskId && version.isLatest && version.source !== "baseline")?.versionId
    const revision = await invokeBackend<ChapterRevision>("chapter.updateRevision", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      revisionTaskId,
      ...(selectedDraftVersionId === undefined ? {} : { draftVersionId: selectedDraftVersionId }),
      heading,
      body,
    })
    setChapterRevision(revision)
    setChapterRevisionContent(body)
    if (selectedDraftVersionId !== undefined) setChapterDraftVersions((versions) => versions.map((version) => version.versionId === selectedDraftVersionId
      ? { ...version, heading, body, source: "manual" } : version))
    return revision
  }

  const reviewChapterRevision = async (revisionTaskId: string): Promise<ChapterRevision> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    setError(undefined)
    try {
      const revision = await invokeBackend<ChapterRevision>("chapter.reviewRevision", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        revisionTaskId,
        ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
      })
      setChapterRevision(revision)
      return revision
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
  }

  const monitorChapterRevision = async (revisionTaskId: string): Promise<void> => {
    if (project === undefined || monitoredChapterRevisionIds.current.has(revisionTaskId)) return
    monitoredChapterRevisionIds.current.add(revisionTaskId)
    try {
      for (let attempt = 0; attempt < 1_200; attempt += 1) {
        const current = await invokeBackend<ChapterRevisionReadResult>("chapter.readRevision", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          revisionTaskId,
        })
        const isDisplayed = selectedPathRef.current !== undefined
          && selectedPathRef.current === current.publishPath
          && displayedRevisionRef.current === revisionTaskId
        if (isDisplayed) {
          setChapterRevision(current)
          setChapterRevisionContent(current.proposedBody)
        }
        if (current.graphSyncStatus === "completed") {
          setPostCommitNotice("图修订已完成，草稿已发布为正文。")
          if (isDisplayed) await openDraftWorkspace(revisionTaskId, { preserveView: true })
          await refreshWorkspace()
          await refreshHistory()
          return
        }
        if (current.graphSyncStatus === "failed") {
          setError("草稿发布未完成，请在图修订任务中查看原因并重试。")
          setPostCommitNotice("草稿已保留。")
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      setError("世界图同步仍在运行，请稍后重新打开章节查看状态。")
    } finally {
      monitoredChapterRevisionIds.current.delete(revisionTaskId)
    }
  }

  const submitChapterRevision = async (input: Readonly<{
    revisionTaskId: string
    mode: "direct" | "reviewed"
    forced: boolean
    draftVersionId?: string
    reviewId?: string
  }>): Promise<ChapterRevision> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    setError(undefined)
    let revision: ChapterRevision
    try {
      const submission = input.mode === "direct"
        ? await invokeBackend<ChapterRevision>("chapter.reviewRevision", {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
            revisionTaskId: input.revisionTaskId,
            ...(input.draftVersionId === undefined ? {} : { draftVersionId: input.draftVersionId }),
            ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
          }).then((reviewed) => {
            if (reviewed.review === undefined) throw new Error("当前草稿审核未生成结果，不能提交正文")
            return {
              ...input,
              mode: "reviewed" as const,
              forced: false,
              reviewId: reviewed.review.reviewId,
            }
          })
        : input
      revision = await invokeBackend<ChapterRevision>("chapter.submitRevision", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        ...submission,
        ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
    setChapterRevision(revision)
    await refreshChapterDraftVersions(revision.revisionTaskId)
    await refreshWorkspace()
    setPostCommitNotice(revision.graphSyncStatus === "completed"
      ? "图修订已完成，草稿已发布为正文。"
      : "正在进行图修订，成功后将把所选草稿发布为正文。")
    if (revision.graphSyncStatus === "pending" || shouldMonitorChapterRevision(revision.graphSyncStatus)) {
      void monitorChapterRevision(revision.revisionTaskId).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    } else if (revision.graphSyncStatus === "completed") {
      await openDraftWorkspace(revision.revisionTaskId, { preserveView: true })
      await refreshHistory()
    }
    return revision
  }

  const retireChapterRevision = async (revisionTaskId: string): Promise<ChapterRevision> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    const revision = await invokeBackend<ChapterRevision>("chapter.retireRevision", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      revisionTaskId,
    })
    setChapterRevision(undefined)
    setChapterRevisionContent(undefined)
    setChapterDraftVersions([])
    return revision
  }

  const appendPersistedDraftVersion = async (input: Readonly<{ heading: string; body: string }>): Promise<RevisionDraftVersion | undefined> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    const revisionTaskId = chapterRevision?.revisionTaskId
    if (revisionTaskId === undefined) throw new Error("当前没有可写入的章节草稿")
    const appended = await invokeBackend<RevisionDraftVersion>("chapter.revision.draftVersion.append", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      revisionTaskId,
      source: "manual",
      heading: input.heading,
      body: input.body,
    })
    await refreshChapterDraftVersions(revisionTaskId)
    return appended
  }

  const restorePersistedDraftVersion = async (versionId: string): Promise<void> => {
    if (project === undefined) throw new Error("当前没有打开项目")
    const revisionTaskId = chapterRevision?.revisionTaskId
    if (revisionTaskId === undefined) throw new Error("当前没有可回退的章节草稿")
    await invokeBackend("chapter.revision.draftVersion.restore", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      revisionTaskId,
      versionId,
    })
    await refreshChapterDraftVersions(revisionTaskId)
  }

  const promoteDiscussDraftToBody = async (): Promise<void> => {
    const revisionTaskId = discussDraftPromotion?.revisionTaskId ?? chapterRevision?.revisionTaskId
    if (revisionTaskId === undefined) {
      setError("还没有可覆盖正文的草稿")
      return
    }
    await submitChapterRevision({
      revisionTaskId,
      mode: "direct",
      forced: true,
      ...(discussDraftPromotion?.revisionTaskId === revisionTaskId
        ? { draftVersionId: discussDraftPromotion.draftVersionId }
        : {}),
    })
  }

  const selectDiscussDraftCandidate = (revisionTaskId: string, draftVersionId: string): void => {
    setDiscussDraftPromotion((current) => current?.revisionTaskId !== revisionTaskId
      ? current
      : { ...current, draftVersionId })
  }

  const loadCommittedGraph = async (
    result: TurnResult,
    anchorOffset = 0,
    append = false,
  ): Promise<void> => {
    if (project === undefined || result.graphAnchorIds.length === 0) return
    try {
      const slice = await invokeBackend<GraphSlice>("graph.neighborhood", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        anchorIds: result.graphAnchorIds,
        anchorOffset,
        direction: "both",
        maxDepth: Math.max(1, projectSettings?.graph.preferredExpansionDepth ?? 2),
        maxNodes: projectSettings?.graph.maxVisitedNodes ?? 48,
        maxLinks: projectSettings?.graph.maxVisitedLinks ?? 96,
      })
      setGraphSlice((current) => append ? mergeGraphSlices(current, slice) : slice)
      if (slice.anchorWindow?.nextOffset !== undefined) {
        setPendingGraphLoad({
          result,
          anchorOffset: slice.anchorWindow.nextOffset,
          append: true,
          reason: "continue",
        })
        const loadedCount = slice.anchorWindow.requestedCount - slice.anchorWindow.remainingCount
        setPostCommitNotice(`本轮正文与图数据已提交。世界图共有 ${String(slice.anchorWindow.requestedCount)} 个查询入口，已按配置加载 ${String(loadedCount)} 个；是否继续加载下一批？`)
      } else {
        setPendingGraphLoad(undefined)
        setPostCommitNotice(undefined)
      }
    } catch (cause) {
      setPendingGraphLoad({ result, anchorOffset, append, reason: "retry" })
      setPostCommitNotice(`本轮正文与图数据已提交，但世界图展示加载失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  const saveFile = async (): Promise<void> => {
    if (project === undefined || selectedPath === undefined) return
    const path = selectedPath
    const submittedContent = content
    try {
      if (isCharacterProfilePath(path)) {
        const original = openedDocumentsRef.current.find(document => document.path === path)?.savedContent ?? savedContent
        const before = parseCharacterProfile(original)
        const after = parseCharacterProfile(submittedContent)
        const operations: CharacterUpdate["operations"] = [
          ...Object.entries(after.fields).filter(([field, value]) => JSON.stringify(before.fields[field]) !== JSON.stringify(value))
            .map(([field, value]) => ({ op: "set" as const, field, value })),
          ...Object.keys(before.fields).filter(field => !Object.hasOwn(after.fields, field)).map(field => ({ op: "delete" as const, field })),
        ]
        if (operations.length > 0) await invokeBackend("workspace.character.update", {
          projectId: project.projectId, workspaceRootRef: project.workspaceRootRef, relativePath: path,
          mode: "update", expectedContent: original, operations,
        })
      } else {
        await invokeBackend("workspace.save", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          relativePath: path,
          content: submittedContent,
        })
      }
      if (documentProjectRef.current !== project.projectId) return
      replaceOpenedDocuments(saveEditorDocument(openedDocumentsRef.current, path, submittedContent))
      if (selectedPathRef.current === path) setSavedContent(submittedContent)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const closeDocument = async (path: string): Promise<void> => {
    const document = openedDocumentsRef.current.find((item) => item.path === path)
    if (document === undefined) return
    if (document.content !== document.savedContent && !window.confirm(`「${path.split("/").at(-1) ?? path}」有未保存的修改，确定关闭并放弃这些修改？`)) return
    const wasActive = selectedPathRef.current === path
    if (wasActive && await beginDocumentNavigation() === undefined) return
    documentLoadRequestsRef.current.delete(path)
    const closed = closeEditorDocument(openedDocumentsRef.current, path, selectedPathRef.current)
    setDocumentTabNotice(undefined)
    replaceOpenedDocuments(closed.documents)
    if (openedDocumentPath === path) setOpenedDocumentPath(closed.activePath ?? closed.documents.at(-1)?.path)
    if (!wasActive) return
    selectedPathRef.current = undefined
    setSelectedPath(undefined)
    setContent("")
    setSavedContent("")
    if (closed.activePath === undefined) {
      setBrowseChapters(false)
      setLineageMode(false)
      return
    }
    beforeDocumentLeaveRef.current = undefined
    await openFile(closed.activePath)
  }

  const createWorkspaceMarkdown = (destinationOverride?: string): void => {
    if (project === undefined) return
    const destination = destinationOverride ?? resolveCreateDestination(selectedPath ?? openedDocumentPath)
    setWorkspaceCreatePrompt({ kind: "file", parentPath: destination })
  }

  const createWorkspaceDirectory = (parentPath?: string): void => {
    if (project === undefined) return
    const destination = parentPath ?? resolveCreateDestination(selectedPath ?? openedDocumentPath)
    setWorkspaceCreatePrompt({
      kind: "directory",
      parentPath: canCreateFolderInDirectory(destination) ? destination : "设定集",
    })
  }

  const confirmWorkspaceCreate = async (rawName: string): Promise<void> => {
    if (project === undefined || workspaceCreatePrompt === undefined) return
    const { kind, parentPath } = workspaceCreatePrompt
    setWorkspaceCreatePrompt(undefined)
    setError(undefined)
    try {
      if (kind === "file") {
        const trimmed = rawName.trim().replaceAll("\\", "/").split("/").at(-1) ?? ""
        if (parentPath === CHARACTER_DIRECTORY) {
          const name = trimmed.replace(/\.(?:json|md)$/iu, "") || "新人物"
          const relativePath = `${CHARACTER_DIRECTORY}/${name}.json`
          await invokeBackend("workspace.character.update", {
            projectId: project.projectId, workspaceRootRef: project.workspaceRootRef, relativePath, mode: "create",
            operations: Object.entries(emptyCharacterProfile(name).fields).map(([field, value]) => ({ op: "set", field, value })),
          })
          await refreshWorkspace()
          await openFile(relativePath)
          setPostCommitNotice(`已新建人物「${name}」`)
          return
        }
        const filename = trimmed.length === 0
          ? "未命名.md"
          : trimmed.toLowerCase().endsWith(".md")
            ? trimmed
            : `${trimmed}.md`
        const relativePath = `${parentPath}/${filename}`
        await invokeBackend("workspace.save", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          relativePath,
          content: `# ${filename.replace(/\.md$/iu, "")}\n\n`,
        })
        await refreshWorkspace()
        await openFile(relativePath)
        setPostCommitNotice(`已新建「${relativePath}」`)
        return
      }
      const folderName = rawName.trim().replaceAll("\\", "/").split("/").filter((part) => part.length > 0).at(-1)
      if (folderName === undefined || folderName.length === 0) return
      if (parentPath === "章节正文" && !isValidVolumeFolderName(folderName)) {
        setError("卷文件夹必须命名为「第N卷 标题」，例如「第一卷 潮水退去时」")
        return
      }
      if (parentPath === "章节正文") {
        const existingVolumes = report.inventory
          .filter((entry) => entry.kind === "directory" && isVolumeDirectoryPath(entry.path))
          .map((entry) => entry.path.slice("章节正文/".length))
        const duplicate = findDuplicateVolumeSequence(folderName, existingVolumes)
        if (duplicate !== undefined) {
          setError(`卷序号重复：已存在「${duplicate}」，不能再创建「${folderName}」。同一序号只能有一个卷。`)
          return
        }
      }
      const relativePath = `${parentPath}/${folderName}`
      await invokeBackend("workspace.createDirectory", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        relativePath,
      })
      await refreshWorkspace()
      setSelectedPath(relativePath)
      setPostCommitNotice(`已新建文件夹「${relativePath}」`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const deleteWorkspaceMarkdown = async (path: string): Promise<void> => {
    if (project === undefined) return
    const isVolume = isChapterVolumeContainerPath(path)
    const confirmLabel = isVolume
      ? `确定删除卷文件夹「${path}」？其中的梗概/细纲会一并删除；若含正式正文则无法删除。`
      : `确定删除「${path}」？此操作不可撤销。`
    if (!window.confirm(confirmLabel)) return
    setError(undefined)
    try {
      await invokeBackend("workspace.delete", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        relativePath: path,
      })
      const deletedPaths = openedDocumentsRef.current.filter((document) => document.path === path || document.path.startsWith(`${path}/`)).map((document) => document.path)
      replaceOpenedDocuments(openedDocumentsRef.current.filter((document) => !deletedPaths.includes(document.path)))
      for (const deletedPath of deletedPaths) documentLoadRequestsRef.current.delete(deletedPath)
      if (selectedPath === path || selectedPath?.startsWith(`${path}/`) === true) {
        documentNavigationRef.current += 1
        selectedPathRef.current = undefined
        setSelectedPath(undefined)
        setOpenedDocumentPath(undefined)
        setContent("")
        setSavedContent("")
      } else if (openedDocumentPath !== undefined && deletedPaths.includes(openedDocumentPath)) {
        setOpenedDocumentPath(openedDocumentsRef.current.at(-1)?.path)
      }
      await refreshWorkspace()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const monitorTask = async (taskId: string): Promise<void> => {
    let consecutiveFailures = 0
    let publishedChapterRefreshed = false
    for (;;) {
      let snapshot: TaskSnapshot
      try {
        snapshot = await invokeBackend<TaskSnapshot>("turn.status", { taskId })
        consecutiveFailures = 0
      } catch (cause) {
        consecutiveFailures += 1
        if (consecutiveFailures >= 3) throw cause
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        continue
      }
      setTask(snapshot)

      const finalizationReady = snapshot.finalization !== undefined
        && (snapshot.finalization.status === "chapter_registered"
          || snapshot.finalization.status === "completed")
      if (!publishedChapterRefreshed && finalizationReady && snapshot.finalization !== undefined) {
        try {
          await refreshWorkspace()
          publishedChapterRefreshed = true
          if (snapshot.status !== "completed") {
            setPostCommitNotice("正文已写入工作区，正在完成梗概交接…")
          }
        } catch (cause) {
          setPostCommitNotice(`正文已提交，但刷新工作区失败：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }

      if (snapshot.status === "completed") {
        setPrompt("")
        if (snapshot.result?.kind === "draft") {
          await refreshWorkspace()
          await openDraftWorkspace(snapshot.result.revisionTaskId, { preserveView: true })
          setPostCommitNotice("正文推演工具已生成新草稿。")
          void refreshSynopsisConversation()
          return
        }
        if (!publishedChapterRefreshed) {
          try {
            await refreshWorkspace()
            publishedChapterRefreshed = true
          } catch (cause) {
            setPostCommitNotice(`本轮正文与图数据已提交，但工作区刷新失败：${cause instanceof Error ? cause.message : String(cause)}`)
          }
        }
        void refreshSynopsisConversation()
        const publishedPath = snapshot.result?.chapterPath ?? snapshot.finalization?.chapterPath
        const publishedSequence = snapshot.finalization?.committedSequence
          ?? (publishedPath === undefined ? undefined : parseChapterSequenceFromPath(publishedPath))
        if (publishedSequence !== undefined && publishedSequence > 0) {
          void watchDiscussFocusAfterPublish(publishedSequence)
        }
        if (snapshot.result !== undefined) await loadCommittedGraph(snapshot.result)
        try {
          const goals = await invokeBackend<DeductionGoalsSnapshot>("deduction.goals.list", {
            projectId: project!.projectId,
            workspaceRootRef: project!.workspaceRootRef,
          })
          const reviewCount = countPendingReviews(goals)
          setPendingReviewCount(reviewCount)
          if (reviewCount > 0) {
            setPostCommitNotice(`本轮已提交。有 ${String(reviewCount)} 条推演目标待复盘（已达成 / 部分达成 / 未达成）。`)
          } else if (publishedChapterRefreshed) {
            setPostCommitNotice("正文已写入工作区，正在完成梗概交接…")
          }
        } catch {
          // Review prompt is optional; turn completion already succeeded.
        }
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          const overview = await refreshHistory()
          if (overview?.entries.some((entry) => entry.taskId === taskId && entry.status === "ready") === true) break
        }
        return
      }
      if (["awaiting_user_decision", "waiting_for_review", "paused", "cancelled", "failed"].includes(snapshot.status)) return
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }

  const sendSynopsisMessage = async (
    message: string,
    options?: Readonly<{
      focusLocked?: boolean
      lockedChapterSequence?: number
      automation?: "batch_chapter"
      agentMode?: "auto" | "plan" | "accept_edits"
      batchProceed?: boolean
      autoContinued?: boolean
      setupAnswerTo?: string
    }>,
  ): Promise<boolean> => {
    if (options?.autoContinued !== true) synopsisAutoContinueCountRef.current = 0
    const trimmedChoice = message.trim()
    if (options?.automation === undefined && /开始批量推演|批量推演本卷/u.test(trimmedChoice)) {
      startBatchDeduction({ mode: "volume_batch" })
      return true
    }
    if (options?.automation === undefined && /按章推演/u.test(trimmedChoice) && !/批量/u.test(trimmedChoice)) {
      startChapterOnceDeduction()
      return true
    }
    if (project === undefined || activeModelProfile === undefined) {
      setError("模型配置尚未加载完成，请稍候再发送")
      return false
    }
    if (!wordCountValid || parsedMinimumWordCount === undefined || parsedMaximumWordCount === undefined) {
      setError("请填写有效的正文字数范围（最少字数不能大于最多字数）")
      return false
    }
    if (synopsisSendInFlightRef.current) {
      setError("上一轮回复仍在收尾，请稍候再发送")
      return false
    }
    synopsisSendInFlightRef.current = true
    const optimisticId = crypto.randomUUID()
    const optimisticMessage: SynopsisConversationMessage = {
      messageId: optimisticId,
      sessionId: synopsisConversation.session?.sessionId ?? crypto.randomUUID(),
      projectId: project.projectId,
      role: "user",
      content: message,
      createdAtMs: Date.now(),
    }
    setSynopsisConversation((current) => ({
      ...current,
      messages: [...current.messages, optimisticMessage],
    }))
    setSynopsisConversationBusy(true)
    synopsisStopDraftRef.current = message
    setSynopsisStream({
      status: "running",
      thinking: "",
      thinkingRounds: [],
      content: "",
      searching: [],
      editing: [],
      toolRuns: [],
      todos: [],
      updatedAtMs: Date.now(),
    })
    setError(undefined)
    let pollStopped = false
    let observedRunningStream = false
    const pollStream = async (): Promise<void> => {
      while (!pollStopped) {
        try {
          const peek = await invokeBackend<SynopsisConversationStreamSnapshot>("synopsis.conversation.streamPeek", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
            ...(synopsisConversation.session?.sessionId === undefined
              ? {}
              : { sessionId: synopsisConversation.session.sessionId }),
          }, {
            // Peeks must not inherit the long soft-wait used by send; a hung peek
            // would keep the Stop button stuck after the reply is already visible.
            waitTimeoutMs: 15_000,
            onWaitTimeout: async () => "abandon",
          })
          // Ignore idle until send() begins the hub; ignore stale completed/failed
          // leftovers from the previous turn until this send has been observed as running.
          if (peek.status === "idle") {
            await new Promise((resolve) => setTimeout(resolve, 200))
            continue
          }
          if (peek.status === "completed" || peek.status === "failed") {
            if (!observedRunningStream) {
              await new Promise((resolve) => setTimeout(resolve, 200))
              continue
            }
            setSynopsisStream(peek)
            if (peek.usage !== undefined) {
              setSynopsisUsage(peek.usage)
            }
            if (peek.budgetAdvisory !== undefined) {
              setSynopsisBudgetWarning(peek.budgetAdvisory)
            }
            // Keep peeking until send() sets pollStopped so post-discuss
            // staging search updates still reach the stream bubble.
          } else {
            observedRunningStream = true
            setSynopsisStream(peek)
            if (peek.usage !== undefined) {
              setSynopsisUsage(peek.usage)
            }
            if (peek.budgetAdvisory !== undefined) {
              setSynopsisBudgetWarning(peek.budgetAdvisory)
            }
          }
        } catch {
          // Peek is best-effort while the model streams.
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    const pollTask = pollStream()
    try {
      if (synopsisConversation.session === undefined) {
        const started = await invokeBackend<SynopsisConversationStartResult>("synopsis.conversation.start", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
        })
        setSynopsisConversation((current) => ({
          ...current,
          session: started.session,
          messages: [...current.messages],
          ...(started.usage === undefined ? {} : { usage: started.usage }),
        }))
        if (started.usage !== undefined) setSynopsisUsage(started.usage)
      }
      const sent = await invokeBackend<SynopsisConversationSendResult>("synopsis.conversation.send", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        message,
        presentation: {
          ...(novelMajorCategoryRulePath.trim().length === 0 ? {} : { novelMajorCategoryRulePath }),
          ...(novelSubcategoryRulePath.trim().length === 0 ? {} : { novelSubcategoryRulePath }),
          ...(descriptionRule.length === 0 ? {} : { descriptionRulePath: descriptionRule }),
          ...(proseRule.length === 0 ? {} : { proseStyleRulePath: proseRule }),
          minimumWordCount: parsedMinimumWordCount,
          maximumWordCount: parsedMaximumWordCount,
        },
        chapterIntent: { boundaryPace, causalityFocus },
        model: {
          baseUrl: activeModelProfile.baseUrl,
          model: activeModelProfile.model,
          credentialRef: activeModelProfile.credentialRef,
          apiProtocol: activeModelProfile.apiProtocol,
          contextWindowTokens: activeModelProfile.contextWindowTokens,
          thinkingModeEnabled: true,
          reasoningEffort: activeModelProfile.reasoningEffort,
          jsonModeEnabled: activeModelProfile.jsonModeEnabled,
          disableResponseStorage: activeModelProfile.disableResponseStorage,
          serviceTier: activeModelProfile.serviceTier,
        },
        ...(options?.focusLocked === true ? { focusLocked: true } : {}),
        ...(options?.lockedChapterSequence === undefined
          ? {}
          : { lockedChapterSequence: options.lockedChapterSequence, lockedFocusKind: "chapter_body" as const }),
        ...(options?.automation === undefined ? {} : { automation: options.automation }),
        ...(options?.batchProceed === undefined ? {} : { batchProceed: options.batchProceed }),
        ...(options?.agentMode === undefined ? {} : { agentMode: options.agentMode }),
        ...(options?.setupAnswerTo === undefined || options?.autoContinued === true || options?.automation !== undefined
          ? {} : { setupAnswerTo: options.setupAnswerTo }),
      }, {
        waitTimeoutMs: projectSettings?.execution.backendRequestWaitTimeoutMs
          ?? 600_000,
        onRequestStarted: ({ requestId }) => {
          synopsisActiveRequestRef.current = requestId
        },
        onWaitTimeout: (info) => new Promise<"continue" | "abandon">((resolve) => {
          // Batch proceed / volume batch runs unattended; 停止 abandons.
          if (
            batchRunningRef.current
            || options?.batchProceed === true
            || options?.automation === "batch_chapter"
          ) {
            resolve("continue")
            return
          }
          setBackendWaitPrompt({ info, decide: resolve })
        }),
      })
      setBackendWaitPrompt((current) => {
        current?.decide("continue")
        return undefined
      })
      pollStopped = true
      setSynopsisConversation(sent)
      let creationDeskSettingsNotice: string | undefined
      if (sent.creationDeskSettings !== undefined) {
        const mapped = mapAiCreationDeskSettings(
          sent.creationDeskSettings,
          sent.rejectedCreationDeskRulePaths,
        )
        updatePresentation(mapped.patch)
        if (mapped.rejectedRulePaths.length > 0) {
          creationDeskSettingsNotice = `AI 选择的规则未能切换：${mapped.rejectedRulePaths.join("、")}。已应用其余有效设置，请检查写作设置。`
        }
      } else if ((sent.rejectedCreationDeskRulePaths?.length ?? 0) > 0) {
        creationDeskSettingsNotice = `AI 选择的规则未能切换：${sent.rejectedCreationDeskRulePaths!.join("、")}。写作设置保持原样。`
      }
      setPendingStagingPromotes(sent.pendingStagingPromotes ?? [])
      if (sent.workDisplayName !== undefined) {
        setProject((current) => current === undefined
          ? current
          : { ...current, displayName: sent.workDisplayName! })
        rememberWorkName(project.projectId, sent.workDisplayName)
      }
      if (sent.budgetAdvisory !== undefined) {
        setSynopsisBudgetWarning(sent.budgetAdvisory)
      }
      if (sent.usage !== undefined) {
        setSynopsisUsage(sent.usage)
      }
      if (sent.appendedDraft !== undefined) {
        setDiscussDraftPromotion({
          revisionTaskId: sent.appendedDraft.revisionTaskId,
          chapterId: sent.appendedDraft.chapterId,
          draftVersionId: sent.appendedDraft.draftVersionId,
        })
        try {
          await openDraftWorkspace(sent.appendedDraft.revisionTaskId, { preserveView: true })
          setPostCommitNotice(`已写入草稿 ${sent.appendedDraft.draftLabel}。发布时将进行图修订。`)
        } catch {
          setPostCommitNotice(`已写入草稿 ${sent.appendedDraft.draftLabel}。确认后才会覆盖正式正文。`)
        }
      }
      if (creationDeskSettingsNotice !== undefined) {
        setPostCommitNotice(creationDeskSettingsNotice)
      }
      setSynopsisStream(undefined)
      setSynopsisConversationBusy(false)
      void refreshWorkspace().catch(() => undefined)
      // Process gate (e.g. previous chapter still publishing): keep going without asking the user.
      // Runaway guard only; a multi-chapter Auto run legitimately needs dozens of continuations.
      const willAutoContinue = sent.awaitingSetupInput === undefined
        && sent.autoContinue !== undefined && synopsisAutoContinueCountRef.current < 40
      setAgentAutoChainActive(willAutoContinue)
      if (willAutoContinue && sent.autoContinue !== undefined) {
        synopsisAutoContinueCountRef.current += 1
        const continuation = sent.autoContinue.message
        setTimeout(() => {
          void sendSynopsisMessageRef.current?.(continuation, {
            ...(options?.agentMode === undefined ? {} : { agentMode: options.agentMode }),
            ...(options?.batchProceed === undefined ? {} : { batchProceed: options.batchProceed }),
            autoContinued: true,
          })
        }, 1_500)
      }
      if (sent.awaitingSetupInput !== undefined && options?.automation !== undefined) {
        setPostCommitNotice("批量推进正在等待你确认主角罗盘或本卷主支线；请在对话中选择或填写后发送。")
        return false
      }
      return true
    } catch (cause) {
      setAgentAutoChainActive(false)
      pollStopped = true
      setBackendWaitPrompt((current) => {
        current?.decide("continue")
        return undefined
      })
      const cancelled = cause instanceof BackendRequestAbandonedError || isSynopsisSendCancelledError(cause)
      const errorLabel = cancelled
        ? "用户停止对话"
        : (cause instanceof Error ? cause.message : String(cause))
      // Keep the latest turn visible: refresh from backend (partial assistant persisted)
      // or fall back to freezing the last stream snapshot into messages.
      try {
        if (cancelled) {
          const discarded = await invokeBackend<SynopsisConversationListResult>(
            "synopsis.conversation.discardLastUserTurn",
            {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
              ...(synopsisConversation.session?.sessionId === undefined
                ? {}
                : { sessionId: synopsisConversation.session.sessionId }),
            },
          )
          setSynopsisConversation(discarded)
        } else {
          const listed = await invokeBackend<SynopsisConversationListResult>(
            "synopsis.conversation.list",
            {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
            },
          )
          setSynopsisConversation(listed)
        }
      } catch {
        const frozen = freezeInterruptedSynopsisStream({
          stream: synopsisStreamRef.current,
          optimisticUser: optimisticMessage,
          sessionId: synopsisConversation.session?.sessionId ?? optimisticMessage.sessionId,
          projectId: project.projectId,
          errorLabel,
        })
        if (frozen !== undefined) {
          setSynopsisConversation((current) => ({
            ...current,
            messages: mergeInterruptedConversationMessages(current.messages, frozen),
          }))
        }
      }
      setSynopsisStream(undefined)
      if (cancelled) {
        setSynopsisDraftRestore({ text: message, token: Date.now() })
        return false
      }
      if (isSynopsisBudgetError(cause)) {
        setSynopsisBudgetWarning(parseSynopsisBudgetError(cause))
        return false
      }
      setError(errorLabel)
      return false
    } finally {
      pollStopped = true
      synopsisSendInFlightRef.current = false
      synopsisActiveRequestRef.current = null
      synopsisStopDraftRef.current = null
      setBackendWaitPrompt((current) => {
        current?.decide("continue")
        return undefined
      })
      setSynopsisConversationBusy(false)
      void pollTask.catch(() => undefined)
    }
  }
  sendSynopsisMessageRef.current = sendSynopsisMessage

  const stopSynopsisMessage = async (): Promise<void> => {
    synopsisAutoContinueCountRef.current = Number.POSITIVE_INFINITY
    setAgentAutoChainActive(false)
    if (project === undefined || !synopsisConversationBusy) return
    const requestId = synopsisActiveRequestRef.current
    const draftText = synopsisStopDraftRef.current
    const streamSnapshot = synopsisStreamRef.current
    setError(undefined)
    setBackendWaitPrompt((current) => {
      current?.decide("abandon")
      return undefined
    })
    try {
      const discarded = await invokeBackend<SynopsisConversationListResult>(
        "synopsis.conversation.discardLastUserTurn",
        {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          ...(synopsisConversation.session?.sessionId === undefined
            ? {}
            : { sessionId: synopsisConversation.session.sessionId }),
        },
      )
      setSynopsisConversation(discarded)
    } catch {
      const frozen = freezeInterruptedSynopsisStream({
        stream: streamSnapshot,
        optimisticUser: undefined,
        sessionId: synopsisConversation.session?.sessionId ?? crypto.randomUUID(),
        projectId: project.projectId,
        errorLabel: "用户停止对话",
      })
      if (frozen !== undefined) {
        setSynopsisConversation((current) => ({
          ...current,
          messages: mergeInterruptedConversationMessages(current.messages, frozen),
        }))
      }
    }
    if (requestId !== null) {
      await abandonBackendRequest(requestId).catch(() => undefined)
    }
    if (draftText !== null && draftText.length > 0) {
      setSynopsisDraftRestore({ text: draftText, token: Date.now() })
    }
    setSynopsisStream(undefined)
    setSynopsisConversationBusy(false)
  }

  const acknowledgeSynopsisBudget = async (): Promise<void> => {
    if (project === undefined) return
    try {
      await invokeBackend("synopsis.conversation.acknowledgeBudget", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
      })
    } catch {
      // Local dismiss still improves UX if backend is unreachable.
    }
    setSynopsisBudgetWarning(undefined)
  }

  const refreshSynopsisChoices = async (messageId: string): Promise<void> => {
    if (project === undefined || activeModelProfile === undefined) {
      setError("模型配置尚未加载完成，请稍候再刷新选项")
      return
    }
    setError(undefined)
    try {
      const refreshed = await invokeBackend<SynopsisConversationSendResult>("synopsis.conversation.refreshChoices", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        messageId,
        presentation: {
          ...(novelMajorCategoryRulePath.trim().length === 0 ? {} : { novelMajorCategoryRulePath }),
          ...(novelSubcategoryRulePath.trim().length === 0 ? {} : { novelSubcategoryRulePath }),
          ...(descriptionRule.length === 0 ? {} : { descriptionRulePath: descriptionRule }),
          ...(proseRule.length === 0 ? {} : { proseStyleRulePath: proseRule }),
          minimumWordCount: parsedMinimumWordCount,
          maximumWordCount: parsedMaximumWordCount,
        },
        chapterIntent: { boundaryPace, causalityFocus },
        model: {
          baseUrl: activeModelProfile.baseUrl,
          model: activeModelProfile.model,
          credentialRef: activeModelProfile.credentialRef,
          apiProtocol: activeModelProfile.apiProtocol,
          contextWindowTokens: activeModelProfile.contextWindowTokens,
          thinkingModeEnabled: true,
          reasoningEffort: activeModelProfile.reasoningEffort,
          jsonModeEnabled: activeModelProfile.jsonModeEnabled,
          disableResponseStorage: activeModelProfile.disableResponseStorage,
          serviceTier: activeModelProfile.serviceTier,
        },
      })
      setSynopsisConversation(refreshed)
      if (refreshed.usage !== undefined) setSynopsisUsage(refreshed.usage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const promoteStaging = async (): Promise<void> => {
    if (project === undefined) return
    setError(undefined)
    try {
      let proposals = pendingStagingPromotes
      if (proposals.length === 0) {
        const listed = await invokeBackend<{ proposals: SynopsisStagingPromoteProposal[] }>(
          "synopsis.staging.promote.list",
          {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
            ...(synopsisConversation.session?.sessionId === undefined
              ? {}
              : { sessionId: synopsisConversation.session.sessionId }),
          },
        )
        proposals = listed.proposals
      }
      if (proposals.length === 0) {
        setError("当前没有可落盘的提案。请等 Agent 给出「确认落盘」类选项后再点底部按钮。")
        return
      }
      setSynopsisConversationBusy(true)
      await invokeBackend("synopsis.staging.promote.approve", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        proposalIds: proposals.map((proposal) => proposal.proposalId),
      })
      const writtenPaths = [...new Set(proposals.flatMap((proposal) => (
        proposal.settingsWrites.map((write) => write.relativePath)
      )))]
      setPendingStagingPromotes([])
      await refreshWorkspace()
      const reopenPath = writtenPaths.find((path) => path === selectedPath || path === openedDocumentPath)
        ?? writtenPaths[0]
      if (reopenPath !== undefined) {
        await openFile(reopenPath)
      }
      setPostCommitNotice(
        writtenPaths.length === 0
          ? "落盘已确认。"
          : `已落盘：${writtenPaths.join("、")}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSynopsisConversationBusy(false)
    }
  }

  const rejectStagingPromote = async (proposalIds: readonly string[]): Promise<void> => {
    if (project === undefined || proposalIds.length === 0) return
    setSynopsisConversationBusy(true)
    setError(undefined)
    try {
      await invokeBackend("synopsis.staging.promote.reject", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        proposalIds,
      })
      setPendingStagingPromotes((current) => current.filter((proposal) => !proposalIds.includes(proposal.proposalId)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSynopsisConversationBusy(false)
    }
  }

  const startTurn = async (): Promise<void> => {
    if (project === undefined || task?.status === "running" || !wordCountValid) return
    if (activeModelProfile === undefined) {
      setError("模型配置尚未加载完成，请稍候再开始推演")
      return
    }
    setError(undefined)
    setPostCommitNotice(undefined)
    setPendingGraphLoad(undefined)
    try {
      const model = {
        baseUrl: activeModelProfile.baseUrl,
        model: activeModelProfile.model,
        credentialRef: activeModelProfile.credentialRef,
        apiProtocol: activeModelProfile.apiProtocol,
        contextWindowTokens: activeModelProfile.contextWindowTokens,
        thinkingModeEnabled: activeModelProfile.thinkingModeEnabled,
        reasoningEffort: activeModelProfile.reasoningEffort,
        jsonModeEnabled: activeModelProfile.jsonModeEnabled,
        disableResponseStorage: activeModelProfile.disableResponseStorage,
        serviceTier: activeModelProfile.serviceTier,
      }
      const presentation = {
        ...(novelMajorCategoryRulePath.trim().length === 0 ? {} : { novelMajorCategoryRulePath }),
        ...(novelSubcategoryRulePath.trim().length === 0 ? {} : { novelSubcategoryRulePath }),
        ...(descriptionRule.length === 0 ? {} : { descriptionRulePath: descriptionRule }),
        ...(proseRule.length === 0 ? {} : { proseStyleRulePath: proseRule }),
        minimumWordCount: parsedMinimumWordCount,
        maximumWordCount: parsedMaximumWordCount,
      }
      const chapterIntent = { boundaryPace, causalityFocus }
      let started: { taskId: string }
      if (prompt.trim().length === 0) {
        started = await invokeBackend<{ taskId: string }>("synopsis.conversation.beginTurn", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          acknowledgeWarnings: true,
          ...(synopsisConversation.session?.sessionId === undefined
            ? {}
            : { sessionId: synopsisConversation.session.sessionId }),
          presentation,
          chapterIntent,
          model,
        })
      } else {
        const userInput = prompt.trim()
        const chapterSequence = synopsisConversation.session?.chapterSequence
        if (chapterSequence === undefined) throw new Error("请先选择讨论焦点章节")
        started = await invokeBackend<{ taskId: string }>("turn.start", {
          projectId: project.projectId,
          workspaceRootRef: project.workspaceRootRef,
          userInput,
          chapterSequence,
          presentation,
          chapterIntent,
          model,
        })
      }
      setTask({ handle: { taskId: started.taskId, status: "running" }, status: "running" })
      await monitorTask(started.taskId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setTask((current) => current === undefined
        ? { status: "failed", error: { message: cause instanceof Error ? cause.message : String(cause) } }
        : { ...current, error: { message: cause instanceof Error ? cause.message : String(cause) } })
    }
  }

  const updateBatchStatus = (phase: BatchDeductionPhase, chapterSequence?: number): void => {
    const { mode, volumeFolderName } = batchContextRef.current
    setBatchStatus({
      running: phase !== "idle" && phase !== "stopped",
      phase,
      mode,
      ...(volumeFolderName === undefined ? {} : { volumeFolderName }),
      ...(chapterSequence === undefined ? {} : { chapterSequence }),
      label: batchDeductionStatusLabel(phase, chapterSequence, volumeFolderName),
    })
  }

  const pauseBatch = (chapterSequence: number, reason: string): void => {
    updateBatchStatus("paused", chapterSequence)
    if (reason !== "用户暂停") {
      setError(`批量推演已暂停（第 ${String(chapterSequence)} 章）：${reason}`)
    }
  }

  const shouldAbortBatch = (sequence: number): "cancelled" | "paused" | undefined => {
    if (batchCancelRef.current) return "cancelled"
    if (batchPauseRequestedRef.current) {
      pauseBatch(sequence, "用户暂停")
      return "paused"
    }
    return undefined
  }

  const awaitBatchRevisionPublished = async (
    revisionTaskId: string,
  ): Promise<"completed" | "failed" | "cancelled"> => {
    if (project === undefined) return "failed"
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      if (batchCancelRef.current) return "cancelled"
      const current = await invokeBackend<ChapterRevisionReadResult>("chapter.readRevision", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        revisionTaskId,
      })
      setChapterRevision(current)
      setChapterRevisionContent(current.proposedBody)
      if (current.graphSyncStatus === "completed") {
        await refreshWorkspace()
        return "completed"
      }
      if (current.graphSyncStatus === "failed") return "failed"
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return "failed"
  }

  const runBatchDraftTurn = async (
    sessionId: string | undefined,
    chapterSequence: number,
  ): Promise<"completed" | "blocked" | "failed" | "cancelled"> => {
    if (project === undefined || activeModelProfile === undefined) return "failed"
    if (!wordCountValid || parsedMinimumWordCount === undefined || parsedMaximumWordCount === undefined) {
      return "failed"
    }
    try {
      await setDiscussFocus(chapterSequence, "plot_synopsis")
      const model = {
        baseUrl: activeModelProfile.baseUrl,
        model: activeModelProfile.model,
        credentialRef: activeModelProfile.credentialRef,
        apiProtocol: activeModelProfile.apiProtocol,
        contextWindowTokens: activeModelProfile.contextWindowTokens,
        thinkingModeEnabled: activeModelProfile.thinkingModeEnabled,
        reasoningEffort: activeModelProfile.reasoningEffort,
        jsonModeEnabled: activeModelProfile.jsonModeEnabled,
        disableResponseStorage: activeModelProfile.disableResponseStorage,
        serviceTier: activeModelProfile.serviceTier,
      }
      const presentation = {
        ...(descriptionRule.length === 0 ? {} : { descriptionRulePath: descriptionRule }),
        ...(proseRule.length === 0 ? {} : { proseStyleRulePath: proseRule }),
        minimumWordCount: parsedMinimumWordCount,
        maximumWordCount: parsedMaximumWordCount,
      }
      const started = await invokeBackend<{ taskId: string }>("synopsis.conversation.beginTurn", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        acknowledgeWarnings: true,
        ...(sessionId === undefined ? {} : { sessionId }),
        presentation,
        chapterIntent: { boundaryPace, causalityFocus },
        model,
      })
      setTask({ handle: { taskId: started.taskId, status: "running" }, status: "running" })
      for (;;) {
        if (batchCancelRef.current) return "cancelled"
        const snapshot = await invokeBackend<TaskSnapshot>("turn.status", { taskId: started.taskId })
        setTask(snapshot)
        if (snapshot.status === "completed") {
          await refreshWorkspace()
          return "completed"
        }
        if (snapshot.status === "awaiting_user_decision" || snapshot.status === "waiting_for_review") {
          return "blocked"
        }
        if (snapshot.status === "failed" || snapshot.status === "cancelled" || snapshot.status === "paused") {
          return "failed"
        }
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return "failed"
    }
  }

  /** When正文推演 is enabled: produce drafts for all listed chapters before any graph publish. */
  const runBatchMultiChapterDrafts = async (
    sequences: readonly number[],
    sessionId: string | undefined,
  ): Promise<"completed" | "blocked" | "failed" | "cancelled"> => {
    for (const chapterSequence of sequences) {
      if (shouldAbortBatch(chapterSequence) !== undefined) {
        return batchCancelRef.current ? "cancelled" : "failed"
      }
      updateBatchStatus("draft", chapterSequence)
      const drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
        projectId: project!.projectId,
        workspaceRootRef: project!.workspaceRootRef,
      })
      const existing = drafts.find((item) => (
        item.chapterSequence === chapterSequence
        && item.status !== "completed"
        && item.proposedBody.trim().length > 0
      ))
      if (existing !== undefined) continue
      const outcome = await runBatchDraftTurn(sessionId, chapterSequence)
      if (outcome !== "completed") return outcome
    }
    return "completed"
  }

  const stopBatchDeduction = (): void => {
    batchPauseRequestedRef.current = false
    batchCancelRef.current = true
    if (!batchRunningRef.current) {
      updateBatchStatus("stopped", batchStatus.chapterSequence)
      return
    }
    updateBatchStatus("stopped", batchStatus.chapterSequence)
  }

  const pauseBatchDeduction = (): void => {
    if (!batchRunningRef.current) return
    batchPauseRequestedRef.current = true
  }

  const startBatchDeduction = (options?: Readonly<{
    mode?: BatchDeductionMode
    resumeSequence?: number
    volumeFolderName?: string
    skipOutlineGate?: boolean
  }>): void => {
    if (project === undefined || batchRunningRef.current) return
    if (activeModelProfile === undefined) {
      setError("模型配置尚未加载完成，请稍候再开始推演")
      return
    }
    if (!wordCountValid) {
      setError("请填写有效的正文字数范围后再开始推演")
      return
    }
    const mode = options?.mode ?? "volume_batch"
    void (async () => {
      const paths = await refreshWorkspace()
      const allChapters = listDiscussFocusChapters(paths)
      let volumeFolderName = options?.volumeFolderName
      let volumeChapters = volumeFolderName === undefined
        ? undefined
        : chaptersInVolume(allChapters, volumeFolderName)
      if (mode === "volume_batch") {
        if (volumeChapters === undefined || volumeChapters.length === 0) {
          const incomplete = findFirstIncompleteVolume(allChapters)
          if (incomplete === undefined) {
            setError("所有卷的章节正文均已完成，无需批量推演")
            return
          }
          volumeFolderName = incomplete.volumeFolderName
          volumeChapters = incomplete.chapters
        }
        if (volumeFolderName !== undefined) {
          let persistedPlan
          try {
            const read = await invokeBackend<{ content: string }>("workspace.read", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
              relativePath: volumeBatchPlanPath(volumeFolderName),
            })
            persistedPlan = parseVolumeBatchPlan(read.content)
          } catch {
            persistedPlan = undefined
          }
          if (persistedPlan !== undefined) setVolumeBatchPlan(persistedPlan)
          volumeChapters = persistedPlan === undefined
            ? chaptersInVolume(allChapters, volumeFolderName)
            : buildTargetVolumeChapters(allChapters, volumeFolderName, persistedPlan.targetChapterCount, persistedPlan.startSequence)
        }
        if (options?.skipOutlineGate !== true) {
          if (volumeFolderName === undefined) {
            setError("未找到可推演的卷")
            return
          }
          const outlineFile = volumeOutlinePath(volumeFolderName)
          let outlineMarkdown = ""
          try {
            const read = await invokeBackend<{ content: string }>("workspace.read", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
              relativePath: outlineFile,
            })
            outlineMarkdown = read.content
          } catch {
            outlineMarkdown = ""
          }
          if (!isVolumeOutlineReady(outlineMarkdown)) {
            setError(`批量推演前请先完善卷大纲（至少含两章节点）：${outlineFile}`)
            setBrowseChapters(false)
            void sendSynopsisMessage([
              "请先完善本卷大纲，再决定「开始批量推演」或「按章推演」。",
              `目标路径：\`${outlineFile}\`（文件名须与章节正文下卷文件夹名完全一致）。`,
              `规则说明见：\`${BATCH_VOLUME_PLAN_DOC_PATH}\``,
              "用户可只给一句话或一段素材；请主动补齐卷大纲并写入上述路径，合格后在回复中给出互斥 choices：「开始批量推演」与「按章推演」。",
            ].join("\n"))
            return
          }
        }
      }

      const sequences = mode === "chapter_once"
        ? [options?.resumeSequence ?? synopsisConversation.session?.chapterSequence ?? 1]
        : (volumeChapters ?? allChapters).map((item) => item.sequence).sort((a, b) => a - b)
      if (sequences.length === 0) {
        setError("没有可推演的章节")
        return
      }
      let sequence = options?.resumeSequence ?? sequences[0] ?? 1
      if (!sequences.includes(sequence)) sequence = sequences[0] ?? 1

      batchContextRef.current = {
        mode,
        ...(volumeFolderName === undefined ? {} : { volumeFolderName }),
      }
      batchCancelRef.current = false
      batchPauseRequestedRef.current = false
      batchRunningRef.current = true
      setError(undefined)
      let lastSequence = sequence
      const chapterWorkflowEnabled = projectSettings?.creationDesk.chapterWorkflowEnabled === true

      try {
        if (mode === "volume_batch") {
          updateBatchStatus("focus", sequence)
          try {
            await setDiscussFocus(sequence, "plot_synopsis")
          } catch (cause) {
            pauseBatch(sequence, cause instanceof Error ? cause.message : String(cause))
            return
          }
          let nextPaths = await refreshWorkspace()
          let activeVolumePlan: ReturnType<typeof parseVolumeBatchPlan>
          if (volumeFolderName !== undefined) {
            try {
              const read = await invokeBackend<{ content: string }>("workspace.read", {
                projectId: project.projectId,
                workspaceRootRef: project.workspaceRootRef,
                relativePath: volumeBatchPlanPath(volumeFolderName),
              })
              activeVolumePlan = parseVolumeBatchPlan(read.content)
            } catch {
              activeVolumePlan = undefined
            }
          }
          let currentVolumeChapters = listDiscussFocusChapters(nextPaths)
          let volumeChapterRows = activeVolumePlan === undefined
            ? chaptersInVolume(currentVolumeChapters, volumeFolderName ?? "")
            : buildTargetVolumeChapters(
                currentVolumeChapters,
                activeVolumePlan.volumeFolderName,
                activeVolumePlan.targetChapterCount,
                activeVolumePlan.startSequence,
              )
          if (activeVolumePlan === undefined || !volumeChaptersHavePlans(volumeChapterRows)) {
            updateBatchStatus("volume_plan", sequence)
            const planned = await sendSynopsisMessage(BATCH_VOLUME_PLAN_USER_MESSAGE, {
              automation: "batch_chapter",
            })
            if (!planned) {
              pauseBatch(sequence, "卷规划讨论失败或被中断")
              return
            }
            if (shouldAbortBatch(sequence) !== undefined) {
              if (batchCancelRef.current) updateBatchStatus("stopped", sequence)
              return
            }
            nextPaths = await refreshWorkspace()
            currentVolumeChapters = listDiscussFocusChapters(nextPaths)
            if (volumeFolderName !== undefined) {
              try {
                const read = await invokeBackend<{ content: string }>("workspace.read", {
                  projectId: project.projectId,
                  workspaceRootRef: project.workspaceRootRef,
                  relativePath: volumeBatchPlanPath(volumeFolderName),
                })
                activeVolumePlan = parseVolumeBatchPlan(read.content)
                if (activeVolumePlan !== undefined) {
                  setVolumeBatchPlan(activeVolumePlan)
                  volumeChapterRows = buildTargetVolumeChapters(
                    currentVolumeChapters,
                    volumeFolderName,
                    activeVolumePlan.targetChapterCount,
                    activeVolumePlan.startSequence,
                  )
                }
              } catch {
                // The validation below pauses the batch if the model omitted the required target.
              }
            }
            if (!volumeChaptersHavePlans(volumeChapterRows)) {
              pauseBatch(sequence, "卷规划未写齐各章梗概与细纲（需 volumeChapterPlans）")
              return
            }
          }

          if (activeVolumePlan === undefined) {
            pauseBatch(sequence, "卷规划未设置强制目标章节数，请重新生成卷规划")
            return
          }
          setVolumeBatchPlan(activeVolumePlan)
          volumeChapterRows = buildTargetVolumeChapters(
            listDiscussFocusChapters(nextPaths),
            activeVolumePlan.volumeFolderName,
            activeVolumePlan.targetChapterCount,
            activeVolumePlan.startSequence,
          )

          const publishSequences = volumeChapterRows
            .filter((item) => item.bodyPath === undefined)
            .map((item) => item.sequence)
            .sort((left, right) => left - right)
          if (publishSequences.length === 0) {
            updateBatchStatus("stopped", sequence)
            return
          }

          const listed = await invokeBackend<SynopsisConversationListResult>("synopsis.conversation.list", {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
          })
          setSynopsisConversation(listed)
          if (listed.usage !== undefined) setSynopsisUsage(listed.usage)
          const sessionId = listed.session?.sessionId

          let drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
          })
          const missingDraftSequences = publishSequences.filter((chapterSequence) => (
            !drafts.some((item) => (
              item.chapterSequence === chapterSequence
              && item.status !== "completed"
              && item.proposedBody.trim().length > 0
            ))
          ))
          if (missingDraftSequences.length > 0) {
            updateBatchStatus("draft", missingDraftSequences[0])
            if (chapterWorkflowEnabled) {
              const draftOutcome = await runBatchMultiChapterDrafts(missingDraftSequences, sessionId)
              if (draftOutcome === "cancelled") {
                updateBatchStatus("stopped", lastSequence)
                return
              }
              if (draftOutcome === "blocked") {
                pauseBatch(missingDraftSequences[0]!, "草稿推演需要人工决策")
                return
              }
              if (draftOutcome === "failed") {
                pauseBatch(missingDraftSequences[0]!, "多章正文推演失败")
                return
              }
            } else {
              const drafted = await sendSynopsisMessage(BATCH_VOLUME_DRAFT_USER_MESSAGE, {
                automation: "batch_chapter",
              })
              if (!drafted) {
                pauseBatch(missingDraftSequences[0]!, "正文草稿讨论失败或被中断")
                return
              }
            }
            drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
            })
          }

          for (const chapterSequence of publishSequences) {
            lastSequence = chapterSequence
            if (shouldAbortBatch(chapterSequence) !== undefined) {
              if (batchCancelRef.current) updateBatchStatus("stopped", chapterSequence)
              return
            }
            const draft = drafts.find((item) => (
              item.chapterSequence === chapterSequence
              && item.status !== "completed"
              && item.proposedBody.trim().length > 0
            ))
            if (draft === undefined) {
              if (chapterWorkflowEnabled) {
                const retry = await runBatchMultiChapterDrafts([chapterSequence], sessionId)
                if (retry !== "completed") {
                  pauseBatch(chapterSequence, retry === "blocked" ? "草稿推演需要人工决策" : "未找到可发布的草稿")
                  return
                }
              } else {
                try {
                  await setDiscussFocus(chapterSequence, "plot_synopsis")
                } catch (cause) {
                  pauseBatch(chapterSequence, cause instanceof Error ? cause.message : String(cause))
                  return
                }
                const drafted = await sendSynopsisMessage(
                  "【批量推演·逐章补草稿】请基于本章已落盘的梗概与细纲，用 chapterDraftProposal 写出本章完整正文草稿；不要 publish_draft，不要推进其他章节。",
                  { automation: "batch_chapter" },
                )
                if (!drafted) {
                  pauseBatch(chapterSequence, "本章草稿推演失败或被中断")
                  return
                }
              }
              drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
                projectId: project.projectId,
                workspaceRootRef: project.workspaceRootRef,
              })
            }
            const publishDraft = (await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
            })).find((item) => (
              item.chapterSequence === chapterSequence
              && item.status !== "completed"
              && item.proposedBody.trim().length > 0
            ))
            if (publishDraft === undefined) {
              pauseBatch(chapterSequence, "未找到可发布的草稿")
              return
            }
            updateBatchStatus("publish", chapterSequence)
            try {
              const reviewed = await invokeBackend<ChapterRevision>("chapter.reviewRevision", {
                projectId: project.projectId,
                workspaceRootRef: project.workspaceRootRef,
                revisionTaskId: publishDraft.revisionTaskId,
                ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
              })
              if (reviewed.review === undefined) throw new Error("当前草稿审核未生成结果，不能提交正文")
              const submitted = await invokeBackend<ChapterRevision>("chapter.submitRevision", {
                projectId: project.projectId,
                workspaceRootRef: project.workspaceRootRef,
                revisionTaskId: publishDraft.revisionTaskId,
                mode: "reviewed",
                forced: false,
                reviewId: reviewed.review.reviewId,
                ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
              })
              setChapterRevision(submitted)
              if (submitted.graphSyncStatus !== "completed") {
                const publishOutcome = await awaitBatchRevisionPublished(submitted.revisionTaskId)
                if (publishOutcome === "cancelled") {
                  updateBatchStatus("stopped", chapterSequence)
                  return
                }
                if (publishOutcome !== "completed") {
                  pauseBatch(chapterSequence, "正文图修订失败")
                  return
                }
              } else {
                await refreshWorkspace()
              }
            } catch (cause) {
              pauseBatch(chapterSequence, cause instanceof Error ? cause.message : String(cause))
              return
            }
            const afterPaths = await refreshWorkspace()
            const published = listDiscussFocusChapters(afterPaths).find((item) => item.sequence === chapterSequence)
            if (published?.bodyPath === undefined) {
              pauseBatch(chapterSequence, "正文尚未落盘，无法继续下一章")
              return
            }
          }
          const finalPaths = await refreshWorkspace()
          const finalRows = buildTargetVolumeChapters(
            listDiscussFocusChapters(finalPaths),
            volumeFolderName ?? "",
            activeVolumePlan.targetChapterCount,
            activeVolumePlan.startSequence,
          )
          if (!isVolumeBatchComplete(
            listDiscussFocusChapters(finalPaths),
            volumeFolderName ?? "",
            activeVolumePlan.targetChapterCount,
            activeVolumePlan.startSequence,
          )) {
            const incomplete = finalRows.find((item) => item.bodyPath === undefined)
            pauseBatch(incomplete?.sequence ?? lastSequence, "卷目标章节尚未全部完成图修订")
            return
          }
          updateBatchStatus("stopped", lastSequence)
          return
        }

        // chapter_once: single-chapter discuss plan + draft (no default beginTurn)
        for (;;) {
          lastSequence = sequence
          const abort = shouldAbortBatch(sequence)
          if (abort === "cancelled") {
            updateBatchStatus("stopped", sequence)
            return
          }
          if (abort === "paused") return

          updateBatchStatus("focus", sequence)
          try {
            await setDiscussFocus(sequence, "plot_synopsis")
          } catch (cause) {
            pauseBatch(sequence, cause instanceof Error ? cause.message : String(cause))
            return
          }
          if (shouldAbortBatch(sequence) !== undefined) {
            if (batchCancelRef.current) updateBatchStatus("stopped", sequence)
            return
          }
          const listed = await invokeBackend<SynopsisConversationListResult>("synopsis.conversation.list", {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
          })
          setSynopsisConversation(listed)
          if (listed.usage !== undefined) setSynopsisUsage(listed.usage)
          const sessionId = listed.session?.sessionId

          let nextPaths = await refreshWorkspace()
          let chapter = listDiscussFocusChapters(nextPaths).find((item) => item.sequence === sequence)
          if (chapter?.bodyPath === undefined) {
            updateBatchStatus("synopsis", sequence)
            const planned = await sendSynopsisMessage(BATCH_CHAPTER_ONCE_USER_MESSAGE, {
              automation: "batch_chapter",
            })
            if (!planned) {
              pauseBatch(sequence, "梗概讨论失败或被中断")
              return
            }
            if (shouldAbortBatch(sequence) !== undefined) {
              if (batchCancelRef.current) updateBatchStatus("stopped", sequence)
              return
            }
            nextPaths = await refreshWorkspace()
            chapter = listDiscussFocusChapters(nextPaths).find((item) => item.sequence === sequence)
            if (chapter?.outlinePath === undefined) {
              updateBatchStatus("outline", sequence)
              const outlined = await sendSynopsisMessage(BATCH_CHAPTER_OUTLINE_FOLLOWUP, {
                automation: "batch_chapter",
              })
              if (!outlined) {
                pauseBatch(sequence, "细纲讨论失败或被中断")
                return
              }
              nextPaths = await refreshWorkspace()
              chapter = listDiscussFocusChapters(nextPaths).find((item) => item.sequence === sequence)
            }
          }

          if (shouldAbortBatch(sequence) !== undefined) {
            if (batchCancelRef.current) updateBatchStatus("stopped", sequence)
            return
          }
          nextPaths = await refreshWorkspace()
          chapter = listDiscussFocusChapters(nextPaths).find((item) => item.sequence === sequence)
          if (chapter?.bodyPath !== undefined) {
            updateBatchStatus("stopped", sequence)
            return
          }

          let drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
            projectId: project.projectId,
            workspaceRootRef: project.workspaceRootRef,
          })
          let draft = drafts.find((item) => (
            item.chapterSequence === sequence
            && item.status !== "completed"
            && item.proposedBody.trim().length > 0
          ))
          if (draft === undefined) {
            updateBatchStatus("draft", sequence)
            if (chapterWorkflowEnabled) {
              const draftOutcome = await runBatchDraftTurn(sessionId, sequence)
              if (draftOutcome === "cancelled") {
                updateBatchStatus("stopped", sequence)
                return
              }
              if (draftOutcome === "blocked") {
                pauseBatch(sequence, "草稿推演需要人工决策")
                return
              }
              if (draftOutcome === "failed") {
                pauseBatch(sequence, "草稿推演失败")
                return
              }
            } else {
              const drafted = await sendSynopsisMessage(
                "【按章推演·正文草稿】请用 chapterDraftProposal 写出本章完整正文草稿；不要 publish_draft；不要优先 chapter_workflow。",
                { automation: "batch_chapter" },
              )
              if (!drafted) {
                pauseBatch(sequence, "正文草稿讨论失败或被中断")
                return
              }
            }
            drafts = await invokeBackend<readonly ChapterRevisionReadResult[]>("chapter.draft.list", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
            })
            draft = drafts.find((item) => (
              item.chapterSequence === sequence
              && item.status !== "completed"
              && item.proposedBody.trim().length > 0
            ))
          }
          if (draft === undefined) {
            pauseBatch(sequence, "未找到可发布的草稿")
            return
          }

          if (shouldAbortBatch(sequence) !== undefined) {
            if (batchCancelRef.current) updateBatchStatus("stopped", sequence)
            return
          }
          updateBatchStatus("publish", sequence)
          try {
            const reviewed = await invokeBackend<ChapterRevision>("chapter.reviewRevision", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
              revisionTaskId: draft.revisionTaskId,
              ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
            })
            if (reviewed.review === undefined) throw new Error("当前草稿审核未生成结果，不能提交正文")
            const submitted = await invokeBackend<ChapterRevision>("chapter.submitRevision", {
              projectId: project.projectId,
              workspaceRootRef: project.workspaceRootRef,
              revisionTaskId: draft.revisionTaskId,
              mode: "reviewed",
              forced: false,
              reviewId: reviewed.review.reviewId,
              ...(activeModelProfile === undefined ? {} : { model: modelSelection(activeModelProfile) }),
            })
            setChapterRevision(submitted)
            if (submitted.graphSyncStatus !== "completed") {
              const publishOutcome = await awaitBatchRevisionPublished(submitted.revisionTaskId)
              if (publishOutcome === "cancelled") {
                updateBatchStatus("stopped", sequence)
                return
              }
              if (publishOutcome !== "completed") {
                pauseBatch(sequence, "正文图修订失败")
                return
              }
            } else {
              await refreshWorkspace()
            }
          } catch (cause) {
            pauseBatch(sequence, cause instanceof Error ? cause.message : String(cause))
            return
          }
          updateBatchStatus("stopped", sequence)
          return
        }
      } finally {
        batchRunningRef.current = false
        if (batchCancelRef.current) {
          updateBatchStatus("stopped", lastSequence)
        }
      }
    })()
  }

  const continueBatchDeduction = (): void => {
    if (batchStatus.phase !== "paused" || batchStatus.chapterSequence === undefined) return
    startBatchDeduction({
      mode: batchStatus.mode ?? "volume_batch",
      resumeSequence: batchStatus.chapterSequence,
      ...(batchStatus.volumeFolderName === undefined ? {} : { volumeFolderName: batchStatus.volumeFolderName }),
      skipOutlineGate: true,
    })
  }

  const startChapterOnceDeduction = (): void => {
    startBatchDeduction({
      mode: "chapter_once",
      resumeSequence: synopsisConversation.session?.chapterSequence
        ?? browseChapterSequence
        ?? 1,
    })
  }

  const resumeTask = async (mode: "continue" | "retry_phase"): Promise<void> => {
    const taskId = task?.handle?.taskId
    if (taskId === undefined || projectSettings === undefined) throw new Error("当前任务没有可恢复标识")
    const fromInterruption = (task?.interruption?.blockedMetrics ?? []).filter((metricId): metricId is ResettableRuntimeMetricId => (
      metricId === "model_calls"
      || metricId === "input_tokens"
      || metricId === "output_tokens"
      || metricId === "wall_time"
    ))
    const message = (task?.interruption?.message ?? task?.error?.message ?? "").toLowerCase()
    const inferred: ResettableRuntimeMetricId[] = []
    if (message.includes("turn deadline exceeded") || message.includes("wall time") || task?.interruption?.kind === "limit_exhausted") {
      inferred.push("wall_time")
    }
    if (message.includes("model call budget")) inferred.push("model_calls")
    if (message.includes("input token budget")) inferred.push("input_tokens")
    if (message.includes("output token budget")) inferred.push("output_tokens")
    const fromMetrics = (task?.runtimeMetrics?.metrics ?? [])
      .filter((metric) => (
        (metric.metricId === "model_calls"
          || metric.metricId === "input_tokens"
          || metric.metricId === "output_tokens"
          || metric.metricId === "wall_time")
        && metric.resettable
        && (metric.state === "exhausted" || metric.blocking)
      ))
      .map((metric) => metric.metricId as ResettableRuntimeMetricId)
    const resetMetricIds = [...new Set([...fromInterruption, ...inferred, ...fromMetrics])]
    const handle = await invokeBackend<{ taskId: string; status: string }>("turn.resume", {
      taskId,
      mode,
      resetMetricIds,
      ...(activeModelProfile === undefined ? {} : {
        model: {
          baseUrl: activeModelProfile.baseUrl,
          model: activeModelProfile.model,
          credentialRef: activeModelProfile.credentialRef,
          apiProtocol: activeModelProfile.apiProtocol,
          contextWindowTokens: activeModelProfile.contextWindowTokens,
          thinkingModeEnabled: activeModelProfile.thinkingModeEnabled,
          reasoningEffort: activeModelProfile.reasoningEffort,
          jsonModeEnabled: activeModelProfile.jsonModeEnabled,
          disableResponseStorage: activeModelProfile.disableResponseStorage,
          serviceTier: activeModelProfile.serviceTier,
        },
      }),
      maxModelCalls: projectSettings.execution.maxModelCalls,
      deadlineMs: projectSettings.execution.maxWallTimeMs,
      maxRetrievalRounds: projectSettings.execution.maxRetrievalRounds,
    })
    setTask((current) => {
      const { interruption: _interruption, ...rest } = current ?? { status: "running" }
      void _interruption
      return { ...rest, handle, status: "running" }
    })
    void monitorTask(taskId).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const resetTaskMetrics = async (metricIds: readonly ResettableRuntimeMetricId[]): Promise<void> => {
    const taskId = task?.handle?.taskId
    if (taskId === undefined) throw new Error("当前任务没有可重置标识")
    const runtimeMetrics = await invokeBackend<NonNullable<TaskSnapshot["runtimeMetrics"]>>("turn.metrics.reset", {
      taskId,
      metricIds,
    })
    setTask((current) => current === undefined ? current : { ...current, runtimeMetrics })
  }

  const returnPreviousRound = async (): Promise<void> => {
    if (project === undefined) return
    const payload = {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      operationId: crypto.randomUUID(),
    }
    let result: HistoryCheckoutResult
    try {
      result = await invokeBackend<HistoryCheckoutResult>("history.returnPreviousRound", payload)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!isRecoverableDatabaseDisconnect(message)) throw cause
      await invokeBackend<OpenProject>("project.open", { workspaceRootRef: project.workspaceRootRef })
      result = await invokeBackend<HistoryCheckoutResult>("history.returnPreviousRound", {
        ...payload,
      operationId: crypto.randomUUID(),
    })
    }
    if (task?.handle?.taskId !== undefined) {
      try {
        await invokeBackend("turn.cancel", { taskId: task.handle.taskId })
      } catch {
        // History already moved; ignore cancel failures on a dead task handle.
      }
    }
    setSelectedPath(undefined)
    setOpenedDocumentPath(undefined)
    documentNavigationRef.current += 1
    documentLoadRequestsRef.current.clear()
    replaceOpenedDocuments([])
    setDocumentTabNotice(undefined)
    setContent("")
    setSavedContent("")
    setTask(undefined)
    await Promise.all([refreshWorkspace(), refreshHistory(), loadHistoryGraph(result.graphAnchorIds)])
    setPostCommitNotice(`已返回上一轮“${result.entry.name}”；再次开始推演或编辑时会自动创建新世界线。`)
  }

  const continueGraphLoad = async (): Promise<void> => {
    if (pendingGraphLoad === undefined) return
    await loadCommittedGraph(
      pendingGraphLoad.result,
      pendingGraphLoad.anchorOffset,
      pendingGraphLoad.append,
    )
  }

  const saveModelProfiles = async (profiles: readonly ModelProfile[], activeProfileId: string): Promise<void> => {
    const saved = await persistModelProfiles({
      profiles,
      activeProfileId,
    })
    setModelProfiles(saved.profiles)
    setActiveModelProfileId(saved.activeProfileId)
    useWorkbenchStore.getState().closeModelDialog()
  }

  const applyModelProfiles = async (
    profiles: readonly ModelProfile[],
    activeProfileId: string,
  ): Promise<void> => {
    const saved = await persistModelProfiles({
      profiles,
      activeProfileId,
    })
    setModelProfiles(saved.profiles)
    setActiveModelProfileId(saved.activeProfileId)
  }

  const updateActiveModelId = async (modelId: string): Promise<void> => {
    if (activeModelProfile === undefined) return
    const nextModel = modelId.trim()
    if (nextModel.length === 0 || activeModelProfile.model === nextModel) return
    const nextProfiles = modelProfiles.map((profile) => (
      profile.id !== activeModelProfile.id
        ? profile
        : { ...profile, model: nextModel }
    ))
    await applyModelProfiles(nextProfiles, activeModelProfileId)
  }

  const updateActiveReasoningEffort = async (effort: ModelProfile["reasoningEffort"]): Promise<void> => {
    if (activeModelProfile === undefined) return
    if (activeModelProfile.reasoningEffort === effort) return
    const nextProfiles = modelProfiles.map((profile) => (
      profile.id !== activeModelProfile.id
        ? profile
        : {
            ...profile,
            reasoningEffort: effort,
            ...(effort === "none" ? {} : { thinkingModeEnabled: true }),
          }
    ))
    await applyModelProfiles(nextProfiles, activeModelProfileId)
  }

  const saveProjectSettings = async (settings: ProjectSettings): Promise<void> => {
    if (project === undefined) return
    if (settings.history.retentionLimit !== projectSettings?.history.retentionLimit) {
      const preview = await invokeBackend<HistoryRetentionPreview>("history.retention.preview", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        retentionLimit: settings.history.retentionLimit,
      })
      if (preview.deleteCount > 0 && !window.confirm(`新的历史上限会删除最旧的 ${String(preview.deleteCount)} 个保存点，且无法从历史列表恢复。是否继续？`)) return
    }
    const saved = await invokeBackend<ProjectSettings>("project.settings.save", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
      settings,
    })
    setProjectSettings(saved)
    await refreshHistory()
    useWorkbenchStore.getState().closeProjectSettings()
  }

  const descriptionRules = useMemo(() => report.inventory.filter((entry) => (
    entry.kind === "file"
    && entry.path.startsWith("表现输出/描写规则/")
    && entry.path !== AUTO_DESCRIPTION_RULE_PATH
  )).map((entry) => entry.path), [report])
  const proseRules = useMemo(() => report.inventory.filter((entry) => entry.kind === "file" && entry.path.startsWith("表现输出/笔风规则/")).map((entry) => entry.path), [report])
  const novelMajorCategoryRules = useMemo(() => report.inventory.filter((entry) => entry.kind === "file" && entry.path.startsWith("表现输出/小说大类规则/")).map((entry) => entry.path), [report])
  const novelSubcategoryRules = useMemo(() => report.inventory.filter((entry) => entry.kind === "file" && entry.path.startsWith("表现输出/小说次大类规则/")).map((entry) => entry.path), [report])

  useEffect(() => {
    const next = reconcileSelectedRulePath(descriptionRule, descriptionRules)
    if (next === undefined) return
    updatePresentation({ descriptionRule: next })
  }, [descriptionRule, descriptionRules, updatePresentation])

  useEffect(() => {
    const next = reconcileSelectedRulePath(proseRule, proseRules)
    if (next === undefined) return
    updatePresentation({ proseRule: next })
  }, [proseRule, proseRules, updatePresentation])

  useEffect(() => {
    const next = reconcileSelectedRulePath(novelMajorCategoryRulePath, novelMajorCategoryRules)
    if (next === undefined) return
    updatePresentation({ novelMajorCategoryRulePath: next })
  }, [novelMajorCategoryRulePath, novelMajorCategoryRules, updatePresentation])

  useEffect(() => {
    const next = reconcileSelectedRulePath(novelSubcategoryRulePath, novelSubcategoryRules)
    if (next === undefined) return
    updatePresentation({ novelSubcategoryRulePath: next })
  }, [novelSubcategoryRulePath, novelSubcategoryRules, updatePresentation])

  useEffect(() => {
    if (postCommitNotice === undefined) return
    if (pendingGraphLoad !== undefined || pendingReviewCount > 0) return
    const timer = window.setTimeout(() => {
      setPostCommitNotice(undefined)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [postCommitNotice, pendingGraphLoad, pendingReviewCount])

  const synopsisTokenMetrics = useMemo((): TaskTokenMetrics => {
    const fromUsage = summarizeSynopsisUsageTokenMetrics(synopsisUsage)
    if (Object.keys(fromUsage).length > 0) return fromUsage
    return summarizeSynopsisStreamTokenMetrics(synopsisStream)
  }, [synopsisUsage, synopsisStream])

  const resetWorkbenchForProject = useCallback((next: OpenProject | undefined): void => {
    setMobilePane("editor")
    setDocumentTabNotice(undefined)
    documentNavigationRef.current += 1
    documentLoadRequestsRef.current.clear()
    beforeDocumentLeaveRef.current = undefined
    replaceOpenedDocuments([])
    setProject(next)
    setRightPanelOpen(false)
    setReport({ inventory: [], issues: [] })
    setWorkspaceFilePaths([])
    setUnpublishedDrafts([])
    setSelectedPath(undefined)
    setOpenedDocumentPath(undefined)
    setContent("")
    setChapterBody("")
    setSavedContent("")
    setSelectedChapter(undefined)
    setChapterRevision(undefined)
    setChapterRevisionContent(undefined)
    setChapterDraftVersions([])
    setDiscussDraftPromotion(undefined)
    setSynopsisConversation({ messages: [] })
    setSynopsisConversationBusy(false)
    setSynopsisStream(undefined)
    setSynopsisUsage(undefined)
    setChapterSynopsis(undefined)
    setPrompt("")
    setTask(undefined)
    setGraphSlice(undefined)
    setError(undefined)
    setPostCommitNotice(undefined)
    setProgressReviewOpen(false)
    setPendingReviewCount(0)
    setPendingGraphLoad(undefined)
    useWorkbenchStore.getState().closeAllDialogs()
    setProjectSettings(undefined)
    setHistory(undefined)
  }, [replaceOpenedDocuments])

  const openWorkspaceHome = async (): Promise<void> => {
    if (await beginDocumentNavigation() === undefined) return
    setMobilePane("editor")
    selectedPathRef.current = undefined
    setSelectedPath(undefined)
    setBrowseChapters(false)
    setBrowseChapterSequence(undefined)
    setBrowseVolumeFolderName(undefined)
    setLineageMode(false)
  }

  const openChapterPanel = async (): Promise<void> => {
    if (await beginDocumentNavigation() === undefined) return
    setMobilePane("editor")
    selectedPathRef.current = undefined
    setSelectedPath(undefined)
    setBrowseChapters(true)
    setLineageMode(false)
    setError(undefined)
  }

  const openSettingsLineage = async (): Promise<void> => {
    if (await beginDocumentNavigation() === undefined) return
    selectedPathRef.current = undefined
    setLineageMode(true)
    setBrowseChapters(false)
    setBrowseChapterSequence(undefined)
    setBrowseVolumeFolderName(undefined)
    setSelectedPath(undefined)
    setError(undefined)
  }

  const reopenOpenedDocument = (): void => {
    if (openedDocumentPath === undefined) return
    void openFile(openedDocumentPath)
  }

  if (project === undefined) {
    return <>
      <AppChrome
        rail={
          <ProjectRail
            coverByProjectId={coverByProjectId}
            onOpen={resetWorkbenchForProject}
            updateAvailable={appUpdate.available}
            onUpdateClick={() => {
              appUpdate.openUpdatePrompt()
            }}
          />
        }
      >
        <ProjectLauncher onOpen={resetWorkbenchForProject} onCoverChanged={handleCoverChanged} />
      </AppChrome>
      {appUpdate.dialog !== null
        ? <AppUpdateDialog
            state={appUpdate.dialog}
            onClose={appUpdate.closeDialog}
            onConfirmDownload={() => { void appUpdate.confirmDownload() }}
            onCancelDownload={() => { void appUpdate.cancelDownload() }}
            onInstall={() => { void appUpdate.installAndQuit() }}
          />
        : null}
    </>
  }

  const sharedRuleSelected = selectedPath?.startsWith("表现输出/描写规则/") === true
    || selectedPath?.startsWith("表现输出/笔风规则/") === true
  const documentRoot = sharedRuleSelected
    ? report.sharedPresentationRoot ?? project.workspaceRootRef
    : project.workspaceRootRef
  const readOnly = selectedPath?.startsWith("世界推演规则/基础规则/") === true
    || (selectedPath?.startsWith("章节正文/") === true && !isChapterPlanningMarkdownPath(selectedPath))
  const dirty = content !== savedContent
  const selectedChapterKind = selectedPath === undefined
    ? undefined
    : resolveChapterMarkdownKind(selectedPath)
  const showChapterConversation = selectedPath?.startsWith("章节正文/") === true
  const browseChapter = browseChapters && browseChapterSequence !== undefined
    ? discussFocusChapters.find((item) => item.sequence === browseChapterSequence)
    : undefined
  const browseVolume = browseChapters && browseVolumeFolderName !== undefined
    ? {
      folderName: browseVolumeFolderName,
      chapters: discussFocusChapters.filter((item) => item.volumeFolderName === browseVolumeFolderName),
    }
    : undefined
  const rightPanelAvailable = !lineageMode && (
    selectedPath === undefined
    || showChapterConversation
    || browseChapters
  )
  const showRightPanel = mobileLayout ? mobilePane === "tools" || mobilePane === "details" : rightPanelAvailable && rightPanelOpen
  const rightPanelChapterMode = mobileLayout ? mobilePane === "details" : showChapterConversation || browseChapters
  const relatedSynopsis = relatedChapterArtifacts.find((item) => item.kind === "plot_synopsis")
  const relatedOutline = relatedChapterArtifacts.find((item) => item.kind === "plot_outline")
  const railSynopsisMarkdown = selectedChapterKind === "plot_synopsis"
    ? content
    : (chapterSynopsis?.synopsisMarkdown ?? relatedSynopsis?.content)
  const railOutlineMarkdown = selectedChapterKind === "plot_outline"
    ? content
    : relatedOutline?.content
  const railSynopsisPath = selectedChapterKind === "plot_synopsis" ? selectedPath : relatedSynopsis?.path
  const railOutlinePath = selectedChapterKind === "plot_outline" ? selectedPath : relatedOutline?.path

  return <><WorkbenchPages settings={<AppDialogsHost
    projectName={project.displayName}
    projectSettings={projectSettings}
    historyEntryCount={history?.entries.length ?? 0}
    modelProfiles={modelProfiles}
    activeModelProfileId={activeModelProfileId}
    activeModelName={activeModelProfile?.name ?? "未配置模型"}
    appUpdate={appUpdate}
    onSaveModelProfiles={saveModelProfiles}
    onSaveProjectSettings={saveProjectSettings}
  />}><AppChrome
    rail={
      <ProjectRail
        activeProjectId={project.projectId}
        coverByProjectId={coverByProjectId}
        onOpen={resetWorkbenchForProject}
        onBrowseAllBooks={() => { resetWorkbenchForProject(undefined) }}
        updateAvailable={appUpdate.available}
        onUpdateClick={() => {
          appUpdate.openUpdatePrompt()
        }}
      />
    }
    titleLeading={
      <>
        {mobileLayout ? <button type="button" className="mobile-library-back" aria-label="返回书库" onClick={() => { resetWorkbenchForProject(undefined) }}><BookOpen size={18} /></button> : null}
        <WorkNameControl
          project={project}
          running={task?.status === "running"}
          statusLabel={task?.status === "running" ? "推演中" : "就绪"}
          {...(activeModelProfile === undefined ? {} : { model: activeModelProfile })}
          onRenamed={(displayName) => {
            setProject((current) => current === undefined ? current : { ...current, displayName })
            rememberWorkName(project.projectId, displayName)
          }}
        />
        <UiTooltip label="配置与切换模型">
          <button className="model-config-trigger" data-testid="model-config-trigger" aria-label="配置与切换模型" onClick={() => { useWorkbenchStore.getState().openModelDialog(); }}><Cpu size={14} /><span>{activeModelProfile?.name ?? "未配置模型"}</span><ChevronDown size={13} /></button>
        </UiTooltip>
        <UiTooltip label="项目设置">
          <button className="project-settings-trigger" data-testid="project-settings-trigger" aria-label="项目设置" disabled={projectSettings === undefined} onClick={() => { useWorkbenchStore.getState().openProjectSettings("execution"); }}><Settings2 size={15} /></button>
        </UiTooltip>
      </>
    }
  >
  <main className="app-shell" {...(mobileLayout ? { "data-mobile-pane": mobilePane } : {})}>
    {mobileLayout ? <MobileWorkbenchNavigation
      pane={mobilePane}
      chaptersActive={browseChapters}
      onDiscussion={() => { void openWorkspaceHome() }}
      onChapters={() => { void openChapterPanel() }}
      onDirectory={() => { setMobilePane("files") }}
      onWritingSettings={() => {
        void openWorkspaceHome().then(() => { useWorkbenchStore.getState().setWritingSettingsOpen(true) })
      }}
      onTools={() => { setMobilePane("tools") }}
    /> : null}
    {synopsisBudgetWarning === undefined
      ? null
      : <div className="budget-warning-banner" role="status">
          <span>{synopsisBudgetWarning.message}</span>
          <button type="button" onClick={() => { void acknowledgeSynopsisBudget(); }}>已知晓</button>
        </div>}
    {error === undefined ? null : <div className="error-banner" role="alert">
      <span className="error-banner-text">{error}</span>
      <button
        type="button"
        className="error-banner-dismiss"
        aria-label="关闭提示"
        title="关闭"
        onClick={() => {
          for (const line of error.split("\n")) {
            const sep = line.indexOf("：")
            if (sep > 0) {
              const path = line.slice(0, sep)
              const message = line.slice(sep + 1)
              for (const code of ["invalid_synopsis_name", "chapter_missing_volume", "invalid_volume_name"] as const) {
                dismissedWorkspaceIssueKeysRef.current.add(`${code}:${path}:${message}`)
              }
            }
          }
          setError(undefined)
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>}
    {workspaceCreatePrompt === undefined
      ? null
      : <WorkspaceNameDialog
          kind={workspaceCreatePrompt.kind}
          parentPath={workspaceCreatePrompt.parentPath}
          onCancel={() => { setWorkspaceCreatePrompt(undefined) }}
          onConfirm={(name) => { void confirmWorkspaceCreate(name) }}
        />}
    {postCommitNotice === undefined ? null : <div className="post-commit-notice" role="status">
      <span>{postCommitNotice}</span>
      <div>
        {pendingReviewCount > 0
          ? <button
              type="button"
              data-testid="post-commit-review-goals"
              onClick={() => { setProgressReviewOpen(true); }}
            >
              复盘目标
            </button>
          : null}
        {pendingGraphLoad === undefined ? null : <button onClick={() => { void continueGraphLoad(); }}>{pendingGraphLoad.reason === "continue" ? "继续加载世界图" : "重试世界图"}</button>}
        <button
          type="button"
          className="post-commit-notice-close"
          aria-label="关闭"
          data-testid="post-commit-notice-close"
          onClick={() => {
            setPostCommitNotice(undefined)
            setPendingGraphLoad(undefined)
            setPendingReviewCount(0)
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>}
    {project !== undefined && progressReviewOpen
      ? <CreationDeskProgressReviewDialog
          open={progressReviewOpen}
          projectId={project.projectId}
          workspaceRootRef={project.workspaceRootRef}
          onClose={() => {
            setProgressReviewOpen(false)
            setPendingReviewCount(0)
            setPostCommitNotice(undefined)
          }}
          onReviewed={() => {
            setPendingReviewCount((count) => Math.max(0, count - 1))
          }}
        />
      : null}
    {backendWaitPrompt === undefined
      ? null
      : <BackendWaitTimeoutDialog
          method={backendWaitPrompt.info.method}
          waitTimeoutMs={backendWaitPrompt.info.waitTimeoutMs}
          elapsedMs={backendWaitPrompt.info.elapsedMs}
          onContinue={() => {
            const decide = backendWaitPrompt.decide
            setBackendWaitPrompt(undefined)
            decide("continue")
          }}
          onStop={() => {
            const decide = backendWaitPrompt.decide
            setBackendWaitPrompt(undefined)
            decide("abandon")
          }}
        />}
    <PanelGroup className="workbench-panels" direction="horizontal">
      <Panel id="workbench-files" order={0} defaultSize={19} minSize={14} maxSize={28} collapsible>
        <WorkspaceTree
          entries={report.inventory}
          selectedPath={selectedPath ?? openedDocumentPath}
          lineageActive={lineageMode}
          onSelect={(path) => { void openFile(path).then(() => { setMobilePane("editor") }) }}
          onSelectLineage={() => { void openSettingsLineage().then(() => { setMobilePane("editor") }) }}
          onRefresh={() => void refreshWorkspace()}
          onCreateMarkdown={(destination) => { createWorkspaceMarkdown(destination) }}
          onCreateDirectory={(parentPath) => { createWorkspaceDirectory(parentPath) }}
          onDeletePath={(path) => { void deleteWorkspaceMarkdown(path) }}
        />
      </Panel>
      <PanelResizeHandle className="resize-handle"><PanelLeftClose size={12} /></PanelResizeHandle>
      <Panel id="workbench-editor" order={1} minSize={42}>
        {lineageMode
          ? <SettingsLineagePanel
              projectId={project.projectId}
              workspaceRootRef={project.workspaceRootRef}
            />
          : <EditorArea
          projectId={project.projectId}
          workspaceRootRef={project.workspaceRootRef}
          selectedPath={selectedPath}
          openedDocumentPath={openedDocumentPath}
          openedDocuments={openedDocuments.map((document) => ({ path: document.path, dirty: document.content !== document.savedContent }))}
          {...(documentTabNotice === undefined ? {} : { documentTabNotice })}
          onSelectDocument={(path) => { void openFile(path) }}
          onCloseDocument={(path) => { void closeDocument(path) }}
          onBeforeDocumentLeaveReady={registerBeforeDocumentLeave}
          rightPanelOpen={showRightPanel}
          {...(rightPanelAvailable ? { onToggleRightPanel: () => {
            if (mobileLayout) setMobilePane("tools")
            else setRightPanelOpen((open) => !open)
          } } : {})}
          browseChapters={browseChapters}
          onBrowseChapters={() => { void openChapterPanel() }}
          {...(browseChapterSequence === undefined ? {} : { browseChapterSequence })}
          {...(browseVolumeFolderName === undefined ? {} : { browseVolumeFolderName })}
          onSelectBrowseChapter={(chapter) => {
            setBrowseChapterSequence(chapter.sequence)
            setBrowseVolumeFolderName(undefined)
            if (mobileLayout) setMobilePane("details")
          }}
          onSelectBrowseVolume={(volumeFolderName) => {
            setBrowseVolumeFolderName(volumeFolderName)
            setBrowseChapterSequence(undefined)
            if (mobileLayout) setMobilePane("details")
          }}
          batchRunning={batchStatus.running}
          batchPaused={batchStatus.phase === "paused"}
          batchStatusLabel={batchStatus.label}
          batchPhase={batchStatus.phase}
          {...(batchStatus.chapterSequence === undefined ? {} : { batchChapterSequence: batchStatus.chapterSequence })}
          onStartBatch={() => { startBatchDeduction({ mode: "volume_batch" }) }}
          onStopBatch={stopBatchDeduction}
          onPauseBatch={pauseBatchDeduction}
          onContinueBatch={continueBatchDeduction}
          onOpenVolumeOutline={openVolumeOutline}
          batchPanel={<CreationDeskBatchControls
            batchStatus={batchStatus}
            progressRows={batchProgressRows}
            agentActive={agentChapterActive || publishingSequences.size > 0}
            {...(synopsisConversation.session?.chapterSequence === undefined
              ? {}
              : { agentChapterSequence: synopsisConversation.session.chapterSequence })}
            agentStatusLabel={agentChapterStatusLabel || (publishingSequences.size > 0 ? "图修订进行中…" : "")}
            onStopAgent={() => { void stopSynopsisMessage() }}
            onPause={pauseBatchDeduction}
            onContinue={continueBatchDeduction}
            onStop={stopBatchDeduction}
            onSelectChapter={(sequence) => {
              setBrowseChapters(true)
              setBrowseChapterSequence(sequence)
              setBrowseVolumeFolderName(undefined)
              void setDiscussFocus(sequence, "plot_synopsis")
            }}
          />}
          chapterSummaries={chapterSummaries}
          unpublishedDrafts={unpublishedDrafts}
          content={content}
          dirty={dirty}
          readOnly={readOnly}
          running={task?.status === "running"}
          prompt={prompt}
          descriptionRule={descriptionRule}
          proseRule={proseRule}
          novelMajorCategoryRulePath={novelMajorCategoryRulePath}
          novelSubcategoryRulePath={novelSubcategoryRulePath}
          minimumWordCount={minimumWordCount}
          maximumWordCount={maximumWordCount}
          wordCountValid={wordCountValid}
          descriptionRules={descriptionRules}
          proseRules={proseRules}
          novelMajorCategoryRules={novelMajorCategoryRules}
          novelSubcategoryRules={novelSubcategoryRules}
          boundaryPace={boundaryPace}
          causalityFocus={causalityFocus}
          onContentChange={changeDocumentContent}
          onHome={() => { void openWorkspaceHome() }}
          onOpenDocument={reopenOpenedDocument}
          onPromptChange={setPrompt}
          onDescriptionRuleChange={(value) => { updatePresentation({ descriptionRule: value }); }}
          onProseRuleChange={(value) => { updatePresentation({ proseRule: value }); }}
          onNovelMajorCategoryRuleChange={(value) => { updatePresentation({ novelMajorCategoryRulePath: value, novelSubcategoryRulePath: "", proseRule: "" }); }}
          onNovelSubcategoryRuleChange={(value) => { updatePresentation({ novelSubcategoryRulePath: value, proseRule: "" }); }}
          onMinimumWordCountChange={(value) => { updatePresentation({ minimumWordCount: value }); }}
          onMaximumWordCountChange={(value) => { updatePresentation({ maximumWordCount: value }); }}
          onBoundaryPaceChange={(value) => { updatePresentation({ boundaryPace: value }); }}
          onCausalityFocusChange={(value) => { updatePresentation({ causalityFocus: value }); }}
          modelProfiles={modelProfiles}
          activeModelProfileId={activeModelProfileId}
          onActiveModelIdChange={(modelId) => { void updateActiveModelId(modelId); }}
          onReasoningEffortChange={(effort) => { void updateActiveReasoningEffort(effort); }}
          onSave={() => void saveFile()}
          onRun={() => void startTurn()}
          onCreateDraft={createFocusedDraft}
          chapter={selectedChapter ?? (chapterRevision?.isInitialPublication === true
            ? { chapterId: chapterRevision.chapterId, sourceId: chapterRevision.proposedSourceId, heading: chapterRevision.heading }
            : undefined)}
          chapterIsUnpublished={chapterRevision?.isInitialPublication === true && chapterRevision.status !== "completed"}
          chapterBody={chapterBody}
          revision={chapterRevision}
          revisionContent={chapterRevisionContent}
          persistedDraftVersions={chapterDraftVersions}
          onEnsureRevision={ensureChapterRevision}
          onUpdateRevision={updateChapterRevision}
          onReviewRevision={reviewChapterRevision}
          onSubmitRevision={submitChapterRevision}
          onRetireRevision={retireChapterRevision}
          onAppendPersistedDraft={appendPersistedDraftVersion}
          onRestorePersistedDraft={restorePersistedDraftVersion}
          synopsisSession={synopsisConversation.session}
          synopsisMessages={synopsisConversation.messages}
          synopsisBusy={synopsisConversationBusy}
          synopsisStream={synopsisStream}
          synopsisDraftRestore={synopsisDraftRestore}
          synopsisTokenMetrics={{
            ...synopsisTokenMetrics,
            ...(activeModelProfile?.contextWindowTokens === undefined
              ? {}
              : { contextWindowTokens: activeModelProfile.contextWindowTokens }),
          }}
          pendingStagingPromotes={pendingStagingPromotes}
          onSynopsisSend={async (message, options) => {
            await sendSynopsisMessage(message, options)
          }}
          onSynopsisStop={stopSynopsisMessage}
          onSynopsisRefreshChoices={refreshSynopsisChoices}
          onPromoteStaging={promoteStaging}
          onPromoteDraftToBody={promoteDiscussDraftToBody}
          onRejectStagingPromote={rejectStagingPromote}
          onOpenSynopsisFile={(path) => { void openFile(path); }}
          onSetFocus={(sequence, focusKind) => { void setDiscussFocus(sequence, focusKind); }}
          focusChapters={discussFocusChapters}
          onOpenSettingsLineage={() => { void openSettingsLineage() }}
          requireCompleteHookSchedules={projectSettings?.creationDesk.requireCompleteHookSchedules !== false}
          chapterWorkflowEnabled={projectSettings?.creationDesk.chapterWorkflowEnabled === true}
        />}
      </Panel>
      {showRightPanel
        ? <>
      <PanelResizeHandle className="resize-handle"><PanelRightClose size={12} /></PanelResizeHandle>
            <Panel id="workbench-details" order={2} defaultSize={25} minSize={20} maxSize={38} collapsible onCollapse={() => { setRightPanelOpen(false) }} className="workbench-right-panel">
              {mobileLayout && mobilePane === "details" ? <button type="button" className="mobile-detail-back" onClick={() => { void openChapterPanel() }}><ArrowLeft size={16} />返回章节列表</button> : null}
              <RightPanelViewport
                chapterMode={rightPanelChapterMode}
                chapterPanel={browseChapters
                  ? <ChapterBrowseDetailRail
                      projectId={project.projectId}
                      workspaceRootRef={project.workspaceRootRef}
                      chapter={browseChapter}
                      unpublishedDrafts={unpublishedDrafts}
                      {...(discussDraftPromotion?.draftVersionId === undefined ? {} : { draftCandidateVersionId: discussDraftPromotion.draftVersionId })}
                      onSelectDraftCandidate={selectDiscussDraftCandidate}
                      {...(browseVolume === undefined ? {} : { volume: browseVolume })}
                      onOpenBody={(path) => { void openFile(path).then(() => { setMobilePane("editor") }) }}
                    />
                  : <ChapterWorkspaceRail
                      key={selectedPath}
                      {...(railSynopsisMarkdown === undefined ? {} : { synopsisMarkdown: railSynopsisMarkdown })}
                      {...(railOutlineMarkdown === undefined ? {} : { outlineMarkdown: railOutlineMarkdown })}
                      {...(railSynopsisPath === undefined ? {} : { synopsisPath: railSynopsisPath })}
                      {...(railOutlinePath === undefined ? {} : { outlinePath: railOutlinePath })}
                      onOpenFile={(path) => { void openFile(path); }}
                    />}
                defaultPanel={<RightRail
          revisionModel={activeModelProfile === undefined ? undefined : modelSelection(activeModelProfile)}
          task={task}
                  project={project}
          graphSlice={graphSlice}
          graphSettings={projectSettings?.graph}
          chapters={discussFocusChapters}
          chapterSummaries={chapterSummaries}
          unpublishedDrafts={unpublishedDrafts}
          {...(discussDraftPromotion?.draftVersionId === undefined ? {} : { draftCandidateVersionId: discussDraftPromotion.draftVersionId })}
          onSelectDraftCandidate={selectDiscussDraftCandidate}
          selectedChapterPath={selectedPath}
          onOpenChapter={(path) => { void openFile(path).then(() => { setMobilePane("editor") }) }}
          onResumeTask={resumeTask}
          onResetTaskMetrics={resetTaskMetrics}
          onReturnPreviousRound={returnPreviousRound}
                  onRefreshTask={async () => {
                    const taskId = task?.handle?.taskId
                    if (taskId === undefined) return
                    const snapshot = await invokeBackend<TaskSnapshot>("turn.status", { taskId })
                    setTask(snapshot)
                  }}
                  onRefreshWorkspace={async () => { await refreshWorkspace() }}
                />}
        />
      </Panel>
          </>
        : null}
    </PanelGroup>
    <footer className="statusbar">
      <span>UTF-8</span><span>LF</span><span>{isCharacterProfilePath(selectedPath ?? "") ? "人物信息" : "Markdown"}</span><span className={dirty ? "unsaved" : "saved"}>{dirty ? <Cloud size={13} /> : <Save size={13} />}{dirty ? "未保存" : "已保存"}</span>
      <span className="status-path"><FolderOpen size={13} />{selectedPath === undefined ? project.workspaceRootRef : `${documentRoot}\\${selectedPath.replaceAll("/", "\\")}`}</span>
      <span>继承环境：本轮 RuleSnapshot</span><span>归档：空闲</span>
    </footer>
  </main>
  </AppChrome></WorkbenchPages>
    {appUpdate.dialog !== null
      ? <AppUpdateDialog
          state={appUpdate.dialog}
          onClose={appUpdate.closeDialog}
          onConfirmDownload={() => { void appUpdate.confirmDownload() }}
          onCancelDownload={() => { void appUpdate.cancelDownload() }}
          onInstall={() => { void appUpdate.installAndQuit() }}
        />
      : null}
  </>
}

function parseWordCount(value: string): number | undefined {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function modelSelection(profile: ModelProfile) {
  return {
    baseUrl: profile.baseUrl,
    model: profile.model,
    credentialRef: profile.credentialRef,
    apiProtocol: profile.apiProtocol,
    contextWindowTokens: profile.contextWindowTokens,
    thinkingModeEnabled: profile.thinkingModeEnabled,
    reasoningEffort: profile.reasoningEffort,
    jsonModeEnabled: profile.jsonModeEnabled,
    disableResponseStorage: profile.disableResponseStorage,
    serviceTier: profile.serviceTier,
  }
}

export function shouldMonitorChapterRevision(status: ChapterRevision["graphSyncStatus"]): boolean {
  return status === "running"
}

/** Freeze a failed/stopped live stream into a durable assistant bubble for the chat. */
function freezeInterruptedSynopsisStream(input: Readonly<{
  stream: SynopsisConversationStreamSnapshot | undefined
  optimisticUser: SynopsisConversationMessage | undefined
  sessionId: string
  projectId: string
  errorLabel: string
}>): SynopsisConversationMessage | undefined {
  const stream = input.stream
  const hasProgress = stream !== undefined && (
    stream.thinking.trim().length > 0
    || stream.content.trim().length > 0
    || stream.thinkingRounds.length > 0
    || stream.searching.length > 0
    || stream.editing.length > 0
    || stream.toolRuns.length > 0
    || stream.todos.length > 0
  )
  if (!hasProgress && input.optimisticUser === undefined) return undefined
  const content = (() => {
    if (stream === undefined) return "（本轮回复未完成）"
    const raw = stream.content.trim()
    if (raw.length === 0) return "（本轮回复未完成）"
    if (raw.startsWith("{")) return "（本轮回复未完成，结构化输出中断）"
    return raw
  })()
  return {
    messageId: crypto.randomUUID(),
    sessionId: input.sessionId,
    projectId: input.projectId,
    role: "assistant",
    content,
    ...(stream?.thinking.trim().length
      ? { reasoningContent: stream.thinking }
      : {}),
    ...(stream !== undefined && stream.thinkingRounds.length > 0
      ? { thinkingRounds: stream.thinkingRounds }
      : {}),
    ...(stream !== undefined && stream.searching.length > 0 ? { searching: stream.searching } : {}),
    ...(stream !== undefined && stream.editing.length > 0 ? { editing: stream.editing } : {}),
    ...(stream !== undefined && stream.toolRuns.length > 0 ? { toolRuns: stream.toolRuns } : {}),
    ...(stream !== undefined && stream.todos.length > 0 ? { todos: stream.todos } : {}),
    error: input.errorLabel,
    createdAtMs: Date.now(),
  }
}

function mergeInterruptedConversationMessages(
  current: readonly SynopsisConversationMessage[],
  assistant: SynopsisConversationMessage,
): SynopsisConversationMessage[] {
  const last = current.at(-1)
  if (last?.role === "assistant" && last.error !== undefined) {
    return [
      ...current.slice(0, -1),
      {
        ...assistant,
        messageId: last.messageId,
        createdAtMs: last.createdAtMs,
      },
    ]
  }
  return [...current, assistant]
}

function isSynopsisBudgetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes("预算")
}

function parseSynopsisBudgetError(error: unknown): SynopsisConversationBudgetAdvisory {
  const message = error instanceof Error ? error.message : String(error)
  return {
    message: message.includes("提醒阈值")
      ? message
      : "梗概讨论模型调用次数较多。可在右侧查看 Token 与上下文占用；点击「已知晓」后将重置计数，再次达到阈值时会重新提醒。",
    callsUsed: 0,
    softLimit: 1,
  }
}

function isSynopsisSendCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "SynopsisSendCancelledError"
    || error.message.includes("SynopsisSendCancelled")
    || error.message.includes("用户停止")
}

function isWorkspaceFilePath(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0 && (value.toLowerCase().endsWith(".md") || isCharacterProfilePath(value))
}

function isRecoverableDatabaseDisconnect(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes("driver has already been destroyed")
    || normalized.includes("no result")
    || normalized.includes("database connection is not open")
    || normalized.includes("sqlite") && normalized.includes("closed")
}

export function mergeGraphSlices(current: GraphSlice | undefined, next: GraphSlice): GraphSlice {
  if (current === undefined) return next
  return {
    nodes: [...new Map([...current.nodes, ...next.nodes].map((node) => [node.id, node])).values()],
    links: [...new Map([...current.links, ...next.links].map((link) => [link.id, link])).values()],
    truncated: next.truncated,
    ...(next.anchorWindow === undefined ? {} : { anchorWindow: next.anchorWindow }),
  }
}
