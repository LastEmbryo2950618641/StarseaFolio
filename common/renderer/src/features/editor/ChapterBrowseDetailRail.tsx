import { useEffect, useMemo, useState } from "react"
import type { ChapterRevisionReadResult, ChapterWorkflowGate, DeductionGoal, RevisionDraftVersion } from "@worldseed/contracts"
import { AlertTriangle, ArrowLeft, BookOpenText, ChevronDown, ChevronRight, FileText, Info, Link2, Library, ScrollText } from "lucide-react"

import { invokeBackend } from "../../api/client.js"
import {
  listChapterRelevantGoals,
  narrativeKindLabel,
  progressStatusLabel,
  scaleLabel,
} from "./creation-desk-goals.js"
import { resolveDiscussFocusOpenPath, type DiscussFocusChapterOption } from "./synopsis-path.js"
import { countChapterCharacters } from "./chapter-draft-versions-prototype.js"
import { useDeductionGoals } from "./use-deduction-goals.js"
import {
  buildVolumeHookDensityReport,
  hookRoleLabel,
  isHookScheduleIncomplete,
  type VolumeChapterHookSummary,
} from "./volume-hook-density.js"
import { parseVolumePlanInfo, volumeArtifactWriteStatus, volumeBatchPlanPath, volumeOutlinePath, type VolumeBatchPlan } from "./volume-batch-deduction.js"

export { isHookScheduleIncomplete } from "./volume-hook-density.js"

export type ChapterBrowseVolumeSelection = Readonly<{
  folderName: string
  chapters: readonly DiscussFocusChapterOption[]
}>

export type ChapterBrowseDetailRailProps = Readonly<{
  projectId: string
  workspaceRootRef: string
  chapter: DiscussFocusChapterOption | undefined
  volume?: ChapterBrowseVolumeSelection
  backLabel?: string
  unpublishedDrafts?: readonly ChapterRevisionReadResult[]
  draftCandidateVersionId?: string
  onSelectDraftCandidate?(revisionTaskId: string, versionId: string): void
  onOpenBody(path: string): void
  onBack?(): void
}>

type ChapterDetailTab = "info" | "synopsis" | "outline" | "draft" | "body"
type VolumeDetailTab = "info" | "synopsis" | "outline"

const VOLUME_DETAIL_TABS: ReadonlyArray<Readonly<{ id: VolumeDetailTab; label: string; icon: typeof Info }>> = [
  { id: "info", label: "卷信息", icon: Info },
  { id: "synopsis", label: "梗概", icon: BookOpenText },
  { id: "outline", label: "大纲", icon: ScrollText },
]

const CHAPTER_DETAIL_TABS: ReadonlyArray<Readonly<{ id: ChapterDetailTab; label: string; testId: string }>> = [
  { id: "info", label: "章节信息", testId: "chapter-detail-tab-info" },
  { id: "synopsis", label: "剧情梗概", testId: "chapter-detail-tab-synopsis" },
  { id: "outline", label: "剧情细纲", testId: "chapter-detail-tab-outline" },
  { id: "draft", label: "草稿", testId: "chapter-detail-tab-draft" },
  { id: "body", label: "正文", testId: "chapter-detail-tab-body" },
]

export function ChapterBrowseDetailRail(props: ChapterBrowseDetailRailProps): React.JSX.Element {
  const [workflowGate, setWorkflowGate] = useState<ChapterWorkflowGate>()
  const [activeTab, setActiveTab] = useState<ChapterDetailTab>("info")
  const [volumeSynopsis, setVolumeSynopsis] = useState<string>()
  const [volumeOutline, setVolumeOutline] = useState<string>()
  const [volumePlanMarkdown, setVolumePlanMarkdown] = useState<string>()
  const [volumeWordCount, setVolumeWordCount] = useState(0)
  const [volumeTab, setVolumeTab] = useState<VolumeDetailTab>("info")
  const [synopsisLoading, setSynopsisLoading] = useState(false)
  const [draftVersions, setDraftVersions] = useState<readonly RevisionDraftVersion[]>([])
  const [draftLoading, setDraftLoading] = useState(false)
  const [localDraftCandidateVersionId, setLocalDraftCandidateVersionId] = useState<string>()
  const [expandedChapters, setExpandedChapters] = useState<ReadonlySet<number>>(() => new Set())
  const goals = useDeductionGoals({
    projectId: props.projectId,
    workspaceRootRef: props.workspaceRootRef,
  })
  const hooks = useMemo(
    () => listChapterHooks(goals.snapshot?.goals ?? [], props.chapter?.sequence),
    [goals.snapshot?.goals, props.chapter?.sequence],
  )
  const volumeHookReport = useMemo(() => {
    if (props.volume === undefined) return undefined
    return buildVolumeHookDensityReport(
      props.volume.chapters,
      goals.snapshot?.goals ?? [],
      goals.snapshot?.progress ?? [],
    )
  }, [goals.snapshot?.goals, goals.snapshot?.progress, props.volume])
  const bodyPath = resolveDiscussFocusOpenPath(props.chapter, "chapter_body")
  const hasBody = props.chapter?.bodyPath !== undefined
  const volumeMode = props.chapter === undefined && props.volume !== undefined
  const draftRevision = useMemo(() => {
    if (props.chapter === undefined) return undefined
    return [...(props.unpublishedDrafts ?? [])]
      .filter((revision) => revision.chapterSequence === props.chapter?.sequence && revision.status !== "completed" && revision.status !== "retired")
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0]
  }, [props.chapter, props.unpublishedDrafts])

  const volumeFolderKey = props.volume?.folderName
  // Parent streaming updates recreate the volume object without changing this selection.
  const volumeBodyPathsKey = JSON.stringify(props.volume?.chapters
    .flatMap((chapter) => chapter.bodyPath === undefined ? [] : [chapter.bodyPath]) ?? [])
  useEffect(() => {
    setExpandedChapters(new Set())
  }, [volumeFolderKey])
  useEffect(() => {
    setActiveTab("info")
  }, [props.chapter?.sequence])
  useEffect(() => { setVolumeTab("info") }, [volumeFolderKey])
  useEffect(() => {
    setLocalDraftCandidateVersionId(undefined)
  }, [draftRevision?.revisionTaskId, props.chapter?.sequence, props.projectId])
  useEffect(() => {
    if (!volumeMode || volumeHookReport === undefined) return
    setExpandedChapters((current) => {
      if (current.size > 0) return current
      return new Set(
        volumeHookReport.chapterRows
          .filter((row) => row.hookCount > 0)
          .map((row) => row.chapterSequence),
      )
    })
  }, [volumeMode, volumeFolderKey, volumeHookReport])

  useEffect(() => {
    let cancelled = false
    const chapterSequence = props.chapter?.sequence
    if (chapterSequence === undefined) {
      setWorkflowGate(undefined)
      return
    }
    const refresh = (): void => {
      void invokeBackend<ChapterWorkflowGate>("chapter.workflowGate.get", {
        projectId: props.projectId,
        workspaceRootRef: props.workspaceRootRef,
        chapterSequence,
      }).then((gate) => {
        if (!cancelled) setWorkflowGate(gate)
      }).catch(() => {
        if (!cancelled) setWorkflowGate(undefined)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [props.chapter?.sequence, props.projectId, props.workspaceRootRef])

  useEffect(() => {
    let cancelled = false
    setVolumeSynopsis(undefined)
    setVolumeOutline(undefined)
    setVolumePlanMarkdown(undefined)
    if (!volumeMode || volumeFolderKey === undefined) {
      setSynopsisLoading(false)
      return
    }
    setSynopsisLoading(true)
    let inFlight = false
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      // Only the first load hides content. Background reads preserve the current view,
      // including when a file is temporarily unavailable during a write.
      void Promise.all([
        `大纲/${volumeFolderKey}.梗概.md`,
        volumeOutlinePath(volumeFolderKey),
        volumeBatchPlanPath(volumeFolderKey),
      ].map((path) => readWorkspaceMarkdown(props.projectId, props.workspaceRootRef, path)
        .catch(() => undefined))).then(([synopsis, outline, plan]) => {
        if (!cancelled) {
          if (synopsis !== undefined) setVolumeSynopsis(synopsis)
          if (outline !== undefined) setVolumeOutline(outline)
          if (plan !== undefined) setVolumePlanMarkdown(plan)
        }
      }).finally(() => {
        inFlight = false
        if (!cancelled) setSynopsisLoading(false)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [volumeMode, props.projectId, volumeFolderKey, props.workspaceRootRef])

  useEffect(() => {
    let cancelled = false
    if (!volumeMode || volumeFolderKey === undefined) {
      setVolumeWordCount(0)
      return
    }
    const bodyPaths = JSON.parse(volumeBodyPathsKey) as string[]
    let inFlight = false
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      void countVolumePublishedWords(props.projectId, props.workspaceRootRef, bodyPaths).then((wordCount) => {
        if (!cancelled) setVolumeWordCount(wordCount)
      }).catch(() => {
        // Retain the last complete count on transient read errors.
      }).finally(() => { inFlight = false })
    }
    refresh()
    // Body files are much larger than planning files; also refresh after in-place edits.
    const timer = window.setInterval(refresh, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [volumeMode, props.projectId, volumeFolderKey, volumeBodyPathsKey, props.workspaceRootRef])

  useEffect(() => { setVolumeWordCount(0) }, [volumeFolderKey, props.projectId, props.workspaceRootRef])

  useEffect(() => {
    let cancelled = false
    const revisionTaskId = draftRevision?.revisionTaskId
    const publishedBodyPath = props.chapter?.bodyPath
    if (revisionTaskId === undefined && publishedBodyPath === undefined) {
      setDraftVersions([])
      setDraftLoading(false)
      return
    }
    setDraftVersions([])
    setDraftLoading(true)
    let inFlight = false
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      void loadChapterDraftHistory({
        projectId: props.projectId,
        workspaceRootRef: props.workspaceRootRef,
        ...(revisionTaskId === undefined ? {} : { revisionTaskId }),
        ...(publishedBodyPath === undefined ? {} : { bodyPath: publishedBodyPath }),
      }).then((versions) => {
        if (!cancelled) setDraftVersions(versions)
      }).catch(() => {
        if (!cancelled) setDraftVersions([])
      }).finally(() => {
        inFlight = false
        if (!cancelled) setDraftLoading(false)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [draftRevision?.revisionTaskId, props.chapter?.bodyPath, props.projectId, props.workspaceRootRef])

  if (props.chapter === undefined && props.volume === undefined) {
    return <aside className="chapter-browse-rail" data-testid="chapter-browse-detail-rail">
      <div className="chapter-browse-rail-empty">
        <BookOpenText size={18} aria-hidden="true" />
        <p>点击左侧卷标题查看本卷剧情梗概，或点击章节卡片查看本章剧情梗概与预留钩子。</p>
      </div>
    </aside>
  }

  if (volumeMode && props.volume !== undefined) {
    const synopsisText = volumeSynopsis?.trim() ?? ""
    const outlineText = volumeOutline?.trim() ?? ""
    const parsedPlan = parseVolumePlanInfo(volumePlanMarkdown)
    const plan = parsedPlan?.volumeFolderName === props.volume.folderName ? parsedPlan : undefined
    const planPath = volumeBatchPlanPath(props.volume.folderName)
    const report = volumeHookReport
    return <aside className="chapter-browse-rail" data-testid="chapter-browse-detail-rail" data-mode="volume">
      <header className="chapter-browse-rail-header">
        {props.onBack === undefined ? null : <button
          type="button"
          className="chapter-browse-back"
          data-testid="chapter-browse-back"
          onClick={props.onBack}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {props.backLabel ?? "返回正文章节"}
        </button>}
        <h3>{props.volume.folderName}</h3>
        <span className="chapter-browse-volume-meta">{plan === undefined || plan.targetChapterCount === 0 ? "规划待完成" : `${String(plan.targetChapterCount)} 章目标`}</span>
      </header>

      <div className="chapter-rail-tabs" data-testid="volume-detail-tabs" role="tablist" aria-label="卷详情">
        {VOLUME_DETAIL_TABS.map((tab) => {
          const Icon = tab.icon
          return <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={volumeTab === tab.id}
            className={volumeTab === tab.id ? "active" : ""}
            data-testid={`volume-detail-tab-${tab.id}`}
            onClick={() => setVolumeTab(tab.id)}
          ><Icon size={12} aria-hidden="true" />{tab.label}</button>
        })}
      </div>

      {volumeTab === "info" ? <>
      <VolumePlanningInfo
        plan={plan}
        publishedChapterCount={props.volume.chapters.filter((chapter) => chapter.bodyPath !== undefined).length}
        wordCount={volumeWordCount}
        onOpenPlan={() => { props.onOpenBody(planPath) }}
      />
      <section className="chapter-browse-section" data-testid="chapter-browse-volume-hooks">
        <h4>
          <Link2 size={13} aria-hidden="true" />
          本卷钩子密度
        </h4>
        {report === undefined || report.totals.hookCount === 0
          ? <p className="chapter-browse-muted">本卷尚未登记伏笔 / 高潮钩子。</p>
          : <>
              <div className="chapter-browse-volume-hook-totals" data-testid="chapter-browse-volume-hook-totals">
                <span>钩子 {String(report.totals.hookCount)}</span>
                <span>埋下 {String(report.totals.plantCount)}</span>
                <span>兑现 {String(report.totals.payoffCount)}</span>
                <span>时限完整 {String(report.totals.completeSchedule)}</span>
                <span>时限不完整 {String(report.totals.incompleteSchedule)}</span>
              </div>
              {report.densityWarning === undefined
                ? null
                : <p className="chapter-browse-density-warning" data-testid="chapter-browse-density-warning">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {report.densityWarning}
                  </p>}
              <ul className="chapter-browse-volume-chapter-list">
                {report.chapterRows.map((row) => (
                  <VolumeChapterHookRow
                    key={row.chapterSequence}
                    row={row}
                    expanded={expandedChapters.has(row.chapterSequence)}
                    onToggle={() => {
                      setExpandedChapters((current) => {
                        const next = new Set(current)
                        if (next.has(row.chapterSequence)) next.delete(row.chapterSequence)
                        else next.add(row.chapterSequence)
                        return next
                      })
                    }}
                  />
                ))}
              </ul>
            </>}
      </section>
      </> : volumeTab === "synopsis" ? <section className="chapter-browse-section" data-testid="chapter-browse-volume-synopsis">
        <h4>
          <Library size={13} aria-hidden="true" />
          本卷梗概
        </h4>
        {synopsisLoading
          ? <p className="chapter-browse-muted">正在读取卷梗概…</p>
          : synopsisText.length > 0
            ? <pre className="chapter-browse-markdown">{synopsisText}</pre>
            : <p className="chapter-browse-muted">卷梗概待写入。</p>}
      </section> : <section className="chapter-browse-section" data-testid="chapter-browse-volume-outline">
        <h4><ScrollText size={13} aria-hidden="true" />本卷大纲</h4>
        {synopsisLoading
          ? <p className="chapter-browse-muted">正在读取卷大纲…</p>
          : outlineText.length > 0
            ? <pre className="chapter-browse-markdown">{outlineText}</pre>
            : <p className="chapter-browse-muted">卷大纲待写入。</p>}
      </section>}
    </aside>
  }

  const synopsisMarkdown = workflowGate?.synopsis.markdown
  const synopsisText = synopsisMarkdown?.trim() ?? ""
  const synopsisPreview = synopsisText.length > 0
    ? stripLeadingHeadingKeepBody(synopsisMarkdown ?? "")
    : ""

  return <aside className="chapter-browse-rail" data-testid="chapter-browse-detail-rail" data-mode="chapter">
    <header className="chapter-browse-rail-header">
      {props.onBack === undefined ? null : <button
        type="button"
        className="chapter-browse-back"
        data-testid="chapter-browse-back"
        onClick={props.onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {props.backLabel ?? "返回正文章节"}
      </button>}
      <h3>{props.chapter!.label}</h3>
      <button
        type="button"
        className="chapter-browse-open-body"
        data-testid="chapter-browse-open-body"
        disabled={bodyPath === undefined}
        onClick={() => {
          if (bodyPath !== undefined) props.onOpenBody(bodyPath)
        }}
      >
        <FileText size={14} aria-hidden="true" />
        {hasBody ? "定位正文" : "打开章节文稿"}
      </button>
    </header>

    <div className="chapter-rail-tabs" data-testid="chapter-detail-tabs" role="tablist" aria-label="章节详情">
      {CHAPTER_DETAIL_TABS.map((tab) => {
        const selected = activeTab === tab.id
        return <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${tab.testId}-button`}
          className={selected ? "active" : ""}
          aria-selected={selected}
          aria-controls="chapter-detail-panel"
          data-testid={tab.testId}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.id === "info" ? <Info size={12} aria-hidden="true" />
            : tab.id === "synopsis" ? <BookOpenText size={12} aria-hidden="true" />
              : tab.id === "outline" ? <ScrollText size={12} aria-hidden="true" />
                  : tab.id === "draft" ? <FileText size={12} aria-hidden="true" />
                : <FileText size={12} aria-hidden="true" />}
          {tab.label}
        </button>
      })}
    </div>

    <div className="chapter-browse-tab-panel" id="chapter-detail-panel" role="tabpanel" aria-labelledby={`chapter-detail-tab-${activeTab}-button`} data-testid="chapter-detail-panel">
      {activeTab === "info" ? <>
        {workflowGate === undefined
          ? <p className="chapter-browse-muted chapter-browse-panel-loading">正在读取章节信息…</p>
          : <section
              className="chapter-browse-section chapter-workflow-gate"
              data-testid="chapter-workflow-gate"
              data-ready={workflowGate.readyForDraft}
            >
              <h4><Info size={13} aria-hidden="true" /> 章节信息</h4>
              <p className="chapter-browse-muted">
                {workflowGate.readyForDraft
                  ? "剧情梗概已确认，剧情细纲和人物准备已完成，可进入草稿。"
                  : workflowGate.blockedReasons.join("；")}
              </p>
              <ChapterWorkflowStageList workflowGate={workflowGate} />
              <p className="chapter-browse-muted">剧情梗概 → 剧情细纲/人物准备 → 草稿 → 审核 → 图治理 → 正文</p>
            </section>}
        <section className="chapter-browse-section" data-testid="chapter-browse-hooks">
          <h4><Link2 size={13} aria-hidden="true" />本章剧情钩子</h4>
          {hooks.length === 0
            ? <p className="chapter-browse-muted">本章尚未预留剧情钩子（伏笔 / 高潮目标）。</p>
            : <ul className="chapter-browse-hook-list">
                {hooks.map((hook) => {
                  const incomplete = isHookScheduleIncomplete(hook)
                  return <li
                    key={hook.goalId}
                    className={`chapter-browse-hook-item${incomplete ? " is-incomplete" : ""}`}
                    data-testid={incomplete ? "chapter-browse-hook-incomplete" : undefined}
                  >
                    <div className="chapter-browse-hook-meta">
                      <span className="chapter-browse-hook-kind">
                        {narrativeKindLabel(hook.narrativeKind)}
                        {hook.narrativeKind === "general" ? null : `·${scaleLabel(hook.scale)}`}
                      </span>
                      {formatHookWindow(hook)}
                      {incomplete
                        ? <span className="chapter-browse-hook-incomplete" title="起势章与兑现章须同时填写">时限不完整</span>
                        : null}
                    </div>
                    <p>{hook.content}</p>
                  </li>
                })}
              </ul>}
        </section>
      </> : activeTab === "synopsis"
        ? <section className="chapter-browse-section" data-testid="chapter-browse-synopsis">
            <h4><BookOpenText size={13} aria-hidden="true" />剧情梗概</h4>
            {synopsisPreview.length > 0
              ? <pre className="chapter-browse-markdown">{synopsisPreview}</pre>
              : <p className="chapter-browse-muted">本章尚无剧情梗概。</p>}
          </section>
        : activeTab === "outline"
          ? <section className="chapter-browse-section" data-testid="chapter-browse-outline">
              <h4><ScrollText size={13} aria-hidden="true" />剧情细纲</h4>
              {workflowGate?.outline.markdown.trim()
                ? <pre className="chapter-browse-markdown">{stripLeadingHeadingKeepBody(workflowGate.outline.markdown)}</pre>
                : <p className="chapter-browse-muted">本章尚无剧情细纲。</p>}
            </section>
          : activeTab === "draft"
            ? <ChapterDraftDetailPanel
                revisionTaskId={draftRevision?.revisionTaskId}
                versions={draftVersions}
                loading={draftLoading}
                selectedVersionId={localDraftCandidateVersionId ?? props.draftCandidateVersionId}
                onSelectVersion={(versionId) => {
                  setLocalDraftCandidateVersionId(versionId)
                  const selected = draftVersions.find((version) => version.versionId === versionId)
                  if (draftRevision !== undefined && selected?.revisionTaskId === draftRevision.revisionTaskId && !selected.isCurrentOfficial) {
                    props.onSelectDraftCandidate?.(draftRevision.revisionTaskId, versionId)
                  }
                }}
              />
          : <section className="chapter-browse-section" data-testid="chapter-browse-body">
              <h4><FileText size={13} aria-hidden="true" />正文</h4>
              {workflowGate?.body.markdown.trim()
                ? <pre className="chapter-browse-markdown">{workflowGate.body.markdown.trim()}</pre>
                : <p className="chapter-browse-muted">本章尚未发布正文。</p>}
            </section>}
    </div>
  </aside>
}

export async function loadChapterDraftHistory(input: Readonly<{
  projectId: string
  workspaceRootRef: string
  revisionTaskId?: string
  bodyPath?: string
}>): Promise<readonly RevisionDraftVersion[]> {
  const scope = { projectId: input.projectId, workspaceRootRef: input.workspaceRootRef }
  let revisionTaskId = input.revisionTaskId
  // Completed publication tasks disappear from the unpublished queue, but retain their draft history.
  if (revisionTaskId === undefined && input.bodyPath !== undefined) {
    const resolved = await invokeBackend<{ activeRevision?: { revisionTaskId: string } }>("chapter.resolveByPath", {
      ...scope, publishPath: input.bodyPath,
    })
    revisionTaskId = resolved.activeRevision?.revisionTaskId
  }
  if (revisionTaskId === undefined) return []
  const result = await invokeBackend<{ versions: readonly RevisionDraftVersion[] }>("chapter.revision.draftVersion.list", {
    ...scope, revisionTaskId, includeChapterHistory: true,
  })
  return result.versions
}

export function VolumePlanningInfo(props: Readonly<{
  plan: VolumeBatchPlan | undefined
  publishedChapterCount: number
  wordCount: number
  onOpenPlan(): void
}>): React.JSX.Element {
  const { plan } = props
  const targetChapterCount = plan?.targetChapterCount ?? 0
  const targetWordCount = plan?.targetWordCount ?? 0
  const storyline = plan?.storyline
  const confirmed = plan?.storylineConfirmedAtMs !== undefined
    && storyline !== undefined
    && Object.values(storyline).every((text) => text.trim().length > 0)
  const sections = [
    { key: "opening", label: "主线开场", text: storyline?.opening },
    { key: "climaxes", label: "主线高潮（可多个）", text: storyline?.climaxes },
    { key: "ending", label: "主线结局", text: storyline?.ending },
    { key: "subplots", label: "支线时机与事件", text: storyline?.subplots },
  ]

  return <>
    <section className="chapter-browse-section" data-testid="chapter-browse-volume-info">
      <h4><Info size={13} aria-hidden="true" />卷规划</h4>
      <ul className="chapter-workflow-stage-list" data-testid="volume-planning-status">
        <li><span>章节进度</span><span>{targetChapterCount === 0
          ? `${String(props.publishedChapterCount)}/待规划`
          : `${String(Math.min(props.publishedChapterCount, targetChapterCount))}/${String(targetChapterCount)}`}</span></li>
        <li><span>已有字数 / 预计字数</span><span>{props.wordCount.toLocaleString("zh-CN")} / {targetWordCount === 0 ? "待规划" : targetWordCount.toLocaleString("zh-CN")}</span></li>
        <li><span>梗概</span><span>{volumeArtifactWriteStatus(plan?.synopsisWriteCount)}</span></li>
        <li><span>大纲</span><span>{volumeArtifactWriteStatus(plan?.outlineWriteCount)}</span></li>
      </ul>
    </section>
    <section className="chapter-browse-section" data-testid="chapter-browse-volume-storyline">
      <h4><BookOpenText size={13} aria-hidden="true" />主线与支线</h4>
      <p className="chapter-browse-muted" data-testid="volume-storyline-status" data-status={confirmed ? "confirmed" : "pending"}>
        {confirmed ? "用户已确认" : "待用户确认"}
      </p>
      {sections.map((section) => <div key={section.key} data-testid={`volume-storyline-${section.key}`}>
        <p className="chapter-browse-muted"><strong>{section.label}</strong></p>
        {section.text?.trim()
          ? <pre className="chapter-browse-markdown">{section.text.trim()}</pre>
          : <p className="chapter-browse-muted">待用户确认</p>}
      </div>)}
      {plan === undefined ? null : <button
        type="button"
        className="chapter-browse-open-body"
        data-testid="volume-edit-plan"
        onClick={props.onOpenPlan}
      ><FileText size={14} aria-hidden="true" />编辑卷规划</button>}
    </section>
  </>
}

export function ChapterDraftDetailPanel(props: Readonly<{
  revisionTaskId: string | undefined
  versions: readonly RevisionDraftVersion[]
  loading: boolean
  selectedVersionId: string | undefined
  onSelectVersion(versionId: string): void
}>): React.JSX.Element {
  const versions = props.versions.filter((version) => version.source !== "baseline")
    .map((version, index) => ({ ...version, label: `v${String(index + 1)}` }))
  const candidate = versions.find((version) => version.versionId === props.selectedVersionId)
    ?? versions.find((version) => version.isLatest)
    ?? versions.at(-1)
  const isPublicationCandidate = candidate !== undefined
    && candidate.revisionTaskId === props.revisionTaskId && !candidate.isCurrentOfficial
  return <section className="chapter-browse-section chapter-draft-detail" data-testid="chapter-browse-draft">
    <h4><FileText size={13} aria-hidden="true" />草稿</h4>
    {props.loading
      ? <p className="chapter-browse-muted">正在读取草稿版本…</p>
      : versions.length === 0
        ? <p className="chapter-browse-muted">本章暂无可选草稿。</p>
        : <>
            <label className="chapter-draft-detail-select-label" htmlFor="chapter-draft-detail-select">选择草稿版本</label>
            <select
              id="chapter-draft-detail-select"
              className="chapter-draft-detail-select"
              data-testid="chapter-draft-detail-select"
              value={candidate?.versionId ?? ""}
              onChange={(event) => { props.onSelectVersion(event.target.value) }}
            >
              {versions.map((version) => (
                <option key={version.versionId} value={version.versionId}>
                  {draftDetailVersionLabel(version, isPublicationCandidate && version.versionId === candidate?.versionId)}
                </option>
              ))}
            </select>
            {candidate === undefined
              ? null
              : <>
                  <p className="chapter-draft-detail-candidate" data-testid="chapter-draft-detail-candidate">
                    {isPublicationCandidate ? "正文候选" : "历史草稿"}：{draftDetailVersionLabel(candidate, isPublicationCandidate)}
                  </p>
                  <pre className="chapter-browse-markdown chapter-draft-detail-body">{candidate.body}</pre>
                  <p className="chapter-browse-muted">{isPublicationCandidate
                    ? "对讨论 Agent 说“可以”后，将对这个正文候选执行图修订并覆盖正式正文。"
                    : "发布后草稿版本仍会保留。切换历史版本仅用于查看，不会更改当前正文。"}</p>
                </>}
          </>}
  </section>
}

function draftDetailVersionLabel(version: RevisionDraftVersion, isPublicationCandidate: boolean): string {
  const source = version.source === "agent" ? "讨论agent"
    : version.source === "workflow" ? "正文推演"
      : version.source === "manual" ? "人工"
        : version.source === "rollback" ? "回退" : "系统"
  return `${version.label} · ${source}${version.isCurrentOfficial ? " · 已发布为当前正文" : isPublicationCandidate ? " · 正文候选" : ""}`
}

export function ChapterWorkflowStageList(props: Readonly<{ workflowGate: ChapterWorkflowGate }>): React.JSX.Element {
  const { workflowGate } = props
  return <ul className="chapter-workflow-stage-list" data-testid="chapter-workflow-stage-list">
    <WorkflowStage
      label="剧情梗概"
      state={workflowGate.synopsis.contentState}
      ready={workflowGate.synopsis.ready && workflowGate.synopsis.confirmed}
      writeCount={workflowGate.synopsis.writeCount}
    />
    <WorkflowStage
      label="剧情细纲"
      state={workflowGate.outline.contentState}
      ready={workflowGate.outline.ready}
      writeCount={workflowGate.outline.writeCount}
    />
    <WorkflowStage label="草稿" state={workflowGate.draft.contentState} ready={workflowGate.draft.contentState !== "empty"} />
    <WorkflowStage
      label="正文"
      ready={workflowGate.body.markdown.trim().length > 0}
      statusLabel={workflowGate.body.markdown.trim().length > 0 ? "已写入" : "未完成"}
      writeCount={workflowGate.body.writeCount}
    />
  </ul>
}

function WorkflowStage(props: Readonly<{
  label: string
  state?: ChapterWorkflowGate["synopsis"]["contentState"]
  ready: boolean
  statusLabel?: string
  writeCount?: number
}>): React.JSX.Element {
  const stateLabel = props.statusLabel ?? (props.state === "ai_written"
    ? "AI 已写入"
    : props.state === "manual_modified" ? "人工已修改" : "未完成")
  const confirmationLabel = props.label === "剧情梗概" && props.state !== undefined && props.state !== "empty"
    ? (props.ready ? " · 已确认" : " · 待确认")
    : ""
  const synopsisPendingConfirmation = props.label === "剧情梗概" && props.state !== undefined && !props.ready
  const writeStatus = props.writeCount === undefined || synopsisPendingConfirmation
    ? ""
    : ` · ${formatArtifactWriteStatus(props.writeCount)}`
  return <li data-state={props.state} data-ready={props.ready}>
    <span>{props.label}</span>
    <span data-written={props.writeCount !== undefined && props.writeCount > 0}>{stateLabel}{confirmationLabel}{writeStatus}</span>
  </li>
}

export function formatArtifactWriteStatus(count: number): string {
  return count === 0
    ? "未写入"
    : count === 1 ? "首次写入" : `已更新 ${String(count - 1)} 次`
}

export function listChapterHooks(
  goals: readonly DeductionGoal[],
  chapterSequence: number | undefined,
): readonly DeductionGoal[] {
  if (chapterSequence === undefined) return []
  return listChapterRelevantGoals(goals, chapterSequence)
    .filter((goal) => goal.narrativeKind === "foreshadow" || goal.narrativeKind === "climax")
}

function VolumeChapterHookRow(props: Readonly<{
  row: VolumeChapterHookSummary
  expanded: boolean
  onToggle(): void
}>): React.JSX.Element {
  const { row, expanded, onToggle } = props
  const Chevron = expanded ? ChevronDown : ChevronRight
  return <li className="chapter-browse-volume-chapter" data-testid={`chapter-browse-volume-chapter-${String(row.chapterSequence)}`}>
    <button
      type="button"
      className="chapter-browse-volume-chapter-toggle"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <Chevron size={14} aria-hidden="true" />
      <span className="chapter-browse-volume-chapter-title">{row.chapterLabel}</span>
      <span className="chapter-browse-volume-chapter-stats">
        埋 {String(row.plantCount)} · 收 {String(row.payoffCount)} · 共 {String(row.hookCount)}
      </span>
    </button>
    <div className="chapter-browse-volume-status-pills">
      {row.statusCounts.incompleteSchedule > 0
        ? <span className="is-warn">时限不完整 {String(row.statusCounts.incompleteSchedule)}</span>
        : null}
      {row.statusCounts.completeSchedule > 0
        ? <span>时限完整 {String(row.statusCounts.completeSchedule)}</span>
        : null}
      {row.statusCounts.planned > 0 ? <span>计划 {String(row.statusCounts.planned)}</span> : null}
      {row.statusCounts.partial > 0 ? <span>推进 {String(row.statusCounts.partial)}</span> : null}
      {row.statusCounts.achieved > 0 ? <span>达成 {String(row.statusCounts.achieved)}</span> : null}
      {row.statusCounts.missed > 0 ? <span>未达 {String(row.statusCounts.missed)}</span> : null}
      {row.hookCount === 0 ? <span className="is-muted">本章无钩子</span> : null}
    </div>
    {expanded && row.hooks.length > 0
      ? <ul className="chapter-browse-hook-list">
          {row.hooks.map((hook) => (
            <li
              key={`${hook.goalId}:${hook.roles.join(",")}`}
              className={`chapter-browse-hook-item${hook.incompleteSchedule ? " is-incomplete" : ""}`}
            >
              <div className="chapter-browse-hook-meta">
                <span className="chapter-browse-hook-kind">
                  {narrativeKindLabel(hook.narrativeKind)}
                  {hook.narrativeKind === "general" ? null : `·${scaleLabel(hook.scale)}`}
                </span>
                <span className="chapter-browse-hook-roles">
                  {hook.roles.map((role) => hookRoleLabel(role)).join("·")}
                </span>
                {formatHookWindow({
                  plantChapterSequence: hook.plantChapterSequence,
                  payoffChapterSequence: hook.payoffChapterSequence,
                })}
                {hook.progressStatus === undefined
                  ? null
                  : <span className="chapter-browse-hook-window">
                      {progressStatusLabel(hook.progressStatus, hook.narrativeKind)}
                    </span>}
                {hook.incompleteSchedule
                  ? <span className="chapter-browse-hook-incomplete">时限不完整</span>
                  : null}
              </div>
              <p>{hook.content}</p>
            </li>
          ))}
        </ul>
      : null}
  </li>
}

export async function assembleVolumeSynopsis(
  projectId: string,
  workspaceRootRef: string,
  chapters: readonly DiscussFocusChapterOption[],
): Promise<string> {
  const parts: string[] = []
  for (const chapter of chapters) {
    if (chapter.synopsisPath === undefined) continue
    try {
      const result = await invokeBackend<{ content: string }>("workspace.read", {
        projectId,
        workspaceRootRef,
        relativePath: chapter.synopsisPath,
      })
      const body = stripLeadingHeadingKeepBody(result.content)
      if (body.length === 0) continue
      parts.push(`【${chapter.label}】\n${body}`)
    } catch {
      // skip unreadable chapter synopsis
    }
  }
  return parts.join("\n\n")
}

async function readWorkspaceMarkdown(
  projectId: string,
  workspaceRootRef: string,
  relativePath: string,
): Promise<string> {
  try {
    const result = await invokeBackend<{ content: string }>("workspace.read", {
      projectId,
      workspaceRootRef,
      relativePath,
    })
    return result.content
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ENOENT:")) return ""
    throw error
  }
}

async function countVolumePublishedWords(
  projectId: string,
  workspaceRootRef: string,
  bodyPaths: readonly string[],
): Promise<number> {
  // Wait for every read even on failure, so the next poll cannot overlap this one.
  const results = await Promise.allSettled(bodyPaths
    .map((path) => readWorkspaceMarkdown(projectId, workspaceRootRef, path)))
  const bodies = results.map((result) => {
    if (result.status === "rejected") throw result.reason
    return result.value
  })
  return bodies.reduce((total, body) => total + countChapterCharacters(stripLeadingHeadingKeepBody(body)), 0)
}

function formatHookWindow(goal: Readonly<{
  plantChapterSequence?: number | undefined
  payoffChapterSequence?: number | undefined
}>): React.JSX.Element | null {
  const plant = goal.plantChapterSequence
  const payoff = goal.payoffChapterSequence
  if (plant === undefined && payoff === undefined) return null
  const parts: string[] = []
  if (plant !== undefined) parts.push(`埋于第${String(plant)}章`)
  if (payoff !== undefined) parts.push(`收于第${String(payoff)}章`)
  return <span className="chapter-browse-hook-window">{parts.join(" · ")}</span>
}

function stripLeadingHeadingKeepBody(markdown: string): string {
  const normalized = markdown.replace(/\r\n/gu, "\n").trim()
  if (normalized.length === 0) return ""
  // Prefer full synopsis for the detail rail; only drop a lone top heading line.
  const withoutTitle = normalized.replace(/^#[^\n]*\n+/u, "").trim()
  return withoutTitle.length > 0 ? withoutTitle : normalized
}
