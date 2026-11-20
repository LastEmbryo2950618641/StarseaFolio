import { startTransition, useEffect, useRef, useState } from "react"
import { AlertCircle, Check, CheckCircle2, Circle, Loader2, Play, RefreshCw, RotateCcw, X } from "lucide-react"
import type { ChapterReviewRevisionPayload, GraphRevisionTask, ResettableRuntimeMetricId } from "@starseafolio/contracts"
import { invokeBackend, type OpenProject, type PhaseRunSnapshot, type TaskSnapshot } from "../../api/client.js"
import { ExpandableErrorAlert } from "../../components/ExpandableErrorAlert.js"
import { UiTooltip } from "../../components/UiTooltip.js"
import { GraphReferenceRepairLimitDialog } from "./GraphReferenceRepairLimitDialog.js"
import { isGraphReferenceRepairExhaustedError } from "./graph-reference-repair.js"
import { PhaseIoDetails, PhaseIoPending } from "./phase-io-details.js"
import { RuntimeMonitor } from "./TaskCheckpointPrototype.js"

const statuses: Record<string, string> = {
  pending: "待入库", running: "入库中", completed: "已完成", failed: "待重试",
  cancelled: "已取消", interrupted: "已中断", retired: "已撤销",
}
const activityLabels = { waiting: "等待模型响应", thinking: "模型思考中", responding: "正在接收结果", repairing: "正在修正输出" }

function elapsedText(startedAtMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  return seconds < 60 ? `${String(seconds)} 秒` : `${String(Math.floor(seconds / 60))} 分 ${String(seconds % 60)} 秒`
}

function taskSnapshotEqual(
  left: TaskSnapshot | undefined,
  right: TaskSnapshot,
): boolean {
  if (left === undefined) return false
  return left.handle?.taskId === right.handle?.taskId
    && left.status === right.status
    && left.lastPhase === right.lastPhase
    && left.error?.message === right.error?.message
    && (left.phaseRuns?.length ?? 0) === (right.phaseRuns?.length ?? 0)
    && (left.phaseRuns?.at(-1)?.finishedAtMs ?? left.phaseRuns?.at(-1)?.startedAtMs)
      === (right.phaseRuns?.at(-1)?.finishedAtMs ?? right.phaseRuns?.at(-1)?.startedAtMs)
}

function graphRevisionActivityEqual(
  left: GraphRevisionTask["activity"],
  right: GraphRevisionTask["activity"],
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return left.phase === right.phase
    && left.stage === right.stage
    && left.attempt === right.attempt
    && left.startedAtMs === right.startedAtMs
    && left.lastActivityAtMs === right.lastActivityAtMs
    && left.reasoningCharacters === right.reasoningCharacters
    && left.contentCharacters === right.contentCharacters
}

function graphRevisionTasksEqual(
  left: readonly GraphRevisionTask[],
  right: readonly GraphRevisionTask[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return false
    if (
      a.revisionTaskId !== b.revisionTaskId
      || a.status !== b.status
      || a.updatedAtMs !== b.updatedAtMs
      || a.graphSyncTaskId !== b.graphSyncTaskId
      || a.error !== b.error
      || a.canCancel !== b.canCancel
      || a.canRetry !== b.canRetry
      || a.canContinue !== b.canContinue
      || a.blocksTurn !== b.blocksTurn
      || a.heading !== b.heading
      || !graphRevisionActivityEqual(a.activity, b.activity)
    ) {
      return false
    }
  }
  return true
}
const phaseLabels: Record<string, string> = {
  settings_extraction: "抽取并写入设定",
  work_style_revision: "风格抽取与融合",
  interpret: "理解章节修订", rule_assembly: "装配规则", source_retrieval: "检索资料",
  emergence_planning: "规划内容", emergence_review: "审查内容", dependency_audit: "分析依赖与影响",
  graph_governance: "准备修订与证据", graph_structure_plan: "生成图变更",
  graph_capacity_rewrite: "重构局部结构", graph_spacetime_settlement: "结算时空与历史",
  graph_retrieval_design: "更新查询索引", graph_governance_review: "独立审核与查询验证",
  settlement_review: "审核结算", frontier_settlement: "更新推演前沿", commit_review: "校验并提交",
}

const stageMemberPhases: Record<string, readonly string[]> = {
  graph_governance: ["graph_governance", "interpret", "rule_assembly", "source_retrieval", "emergence_planning", "emergence_review"],
  graph_structure_plan: ["graph_structure_plan", "graph_capacity_rewrite", "graph_spacetime_settlement", "graph_retrieval_design"],
  graph_governance_review: ["graph_governance_review", "settlement_review"],
}

function selectStageRun(stagePhase: string, runs: readonly PhaseRunSnapshot[] | undefined): PhaseRunSnapshot | undefined {
  const names = new Set(stageMemberPhases[stagePhase] ?? [stagePhase])
  const matched = (runs ?? []).filter((run) => names.has(run.phase))
  const own = [...matched].reverse().find((run) => run.phase === stagePhase && run.result !== undefined)
  if (own !== undefined) return own
  return [...matched].reverse().find((run) => run.result !== undefined) ?? matched.at(-1)
}

type PhaseVisualKind = "done" | "failed" | "running" | "idle"

function phaseVisual(status: string): { kind: PhaseVisualKind; css: string } {
  if (status === "completed") return { kind: "done", css: "done" }
  if (status === "failed" || status === "cancelled") return { kind: "failed", css: "failed" }
  if (status === "running") return { kind: "running", css: "current" }
  return { kind: "idle", css: "" }
}

function PhaseStatusIcon({ state }: { state: PhaseVisualKind }): React.JSX.Element {
  if (state === "done") return <Check size={13} />
  if (state === "failed") return <AlertCircle size={13} aria-label="失败" />
  if (state === "running") return <span className="phase-spinner" aria-hidden="true" />
  return <Circle size={10} />
}

export function StageRecordPanel({
  task,
  monitorTask,
  onResetMetrics,
}: {
  task: GraphRevisionTask
  monitorTask: TaskSnapshot | undefined
  onResetMetrics?: ((metricIds: readonly ResettableRuntimeMetricId[]) => Promise<void>) | undefined
}): React.JSX.Element {
  const syncTaskId = task.graphSyncTaskId
  const monitorIsSyncTask = syncTaskId !== undefined && monitorTask?.handle?.taskId === syncTaskId
  const [loadedTask, setLoadedTask] = useState<TaskSnapshot>()
  useEffect(() => {
    if (syncTaskId === undefined || monitorIsSyncTask) {
      setLoadedTask(undefined)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const next = await invokeBackend<TaskSnapshot>("turn.status", { taskId: syncTaskId })
        if (disposed) return
        setLoadedTask((previous) => taskSnapshotEqual(previous, next) ? previous : next)
        if (next.status === "completed" || next.status === "failed" || next.status === "cancelled") return
        timer = setTimeout(() => { void poll() }, 1500)
      } catch {
        if (!disposed) setLoadedTask(undefined)
      }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [syncTaskId, monitorIsSyncTask])
  const detailTask = syncTaskId === undefined || monitorIsSyncTask ? monitorTask : loadedTask
  const { progress } = task
  return <div className="graph-revision-stage-record" data-testid="graph-revision-stage-record">
    <RuntimeMonitor task={detailTask} onResetMetrics={onResetMetrics} />
    <div className="phase-list">
      {progress.phases.map((phase) => {
        const visual = phaseVisual(phase.status)
        const latest = selectStageRun(phase.phase, detailTask?.phaseRuns)
        const label = phaseLabels[phase.phase] ?? phase.phase
        return <details className={`phase-detail ${visual.css}`} key={phase.phase}>
          <summary className={`phase-row ${visual.css}`}>
            <span className="phase-icon" aria-hidden="true"><PhaseStatusIcon state={visual.kind} /></span>
            <span className="phase-row-copy">
              <strong>{label}</strong>
            </span>
          </summary>
          {latest?.result === undefined
            ? <PhaseIoPending latestStatus={latest?.status ?? phase.status} visualKind={visual.kind} />
            : <PhaseIoDetails result={latest.result} />}
        </details>
      })}
    </div>
  </div>
}

export function GraphRevisionTasksPanel({ project, model, monitorTask, onResetMetrics, onChanged }: {
  project: OpenProject | undefined
  model?: ChapterReviewRevisionPayload["model"]
  monitorTask?: TaskSnapshot | undefined
  onResetMetrics?: ((metricIds: readonly ResettableRuntimeMetricId[]) => Promise<void>) | undefined
  onChanged?: (() => Promise<void>) | undefined
}): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly GraphRevisionTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const [pending, setPending] = useState<Record<string, string>>({})
  const [refresh, setRefresh] = useState(0)
  const [repairPrompt, setRepairPrompt] = useState<{
    task: GraphRevisionTask
    key: string
  }>()
  const generation = useRef(0)
  const operations = useRef(new Set<string>())
  const dismissedRepairKeys = useRef(new Set<string>())
  const previousBusyRef = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  useEffect(() => {
    const current = ++generation.current
    setTasks([])
    setLoading(true)
    setError(undefined)
    setLoadError(undefined)
    previousBusyRef.current = false
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastKnownBusy = false
    const poll = async (): Promise<void> => {
      try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return
        }
        if (project === undefined) {
          if (!disposed && generation.current === current) setTasks([])
          lastKnownBusy = false
        } else {
          // Read-only refresh. Do not call folio.host.ensure on every tick — ensure
          // rewrites .folio/ui-state.json and saturates IPC while the panel is open.
          const [ui, listed] = await Promise.all([
            invokeBackend<{
              panels: { graphRevision: { tasks: readonly GraphRevisionTask[] } }
            }>("folio.uiState.read", project).catch(() => undefined),
            invokeBackend<readonly GraphRevisionTask[]>("chapter.graphRevision.list", project),
          ])
          // Folio keeps panel order; authoritative list wins for live status/progress.
          const fromFolio = ui?.panels.graphRevision.tasks ?? []
          const listedById = new Map(listed.map((task) => [task.revisionTaskId, task]))
          const mergedFromFolio = fromFolio.map((task) => {
            const authority = listedById.get(task.revisionTaskId)
            if (authority === undefined) return task
            return {
              ...task,
              ...authority,
              heading: authority.heading.length > 0 ? authority.heading : task.heading,
            }
          })
          const folioIds = new Set(fromFolio.map((task) => task.revisionTaskId))
          const next = fromFolio.length > 0
            ? [
              ...mergedFromFolio,
              ...listed.filter((task) => !folioIds.has(task.revisionTaskId)),
            ]
            : listed
          lastKnownBusy = next.some((task) => task.status === "running" || task.status === "pending")
          // When ingest finishes, refresh workspace so left progress leaves「章节入库中」.
          if (previousBusyRef.current && !lastKnownBusy) {
            void onChangedRef.current?.().catch(() => undefined)
          }
          previousBusyRef.current = lastKnownBusy
          if (!disposed && generation.current === current) {
            startTransition(() => {
              setTasks((previous) => graphRevisionTasksEqual(previous, next) ? previous : next)
              setLoadError(undefined)
            })
          }
        }
      } catch (cause) {
        if (!disposed) setLoadError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!disposed) {
          setLoading(false)
          // Terminal-only lists can back off; active sync stays responsive.
          const hidden = typeof document !== "undefined" && document.visibilityState === "hidden"
          const delay = hidden ? 12_000 : lastKnownBusy ? 1_500 : 8_000
          timer = setTimeout(() => { void poll() }, delay)
        }
      }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [project?.projectId, project?.workspaceRootRef, refresh])

  useEffect(() => {
    if (project === undefined) return
    // One-shot host sync when the panel mounts or the user forces refresh.
    void invokeBackend("folio.host.ensure", { ...project, host: "starseafolio" }).catch(() => undefined)
  }, [project?.projectId, project?.workspaceRootRef, refresh])

  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== "running") continue
      for (const key of [...dismissedRepairKeys.current]) {
        if (key.startsWith(`${task.revisionTaskId}:`)) dismissedRepairKeys.current.delete(key)
      }
      if (repairPrompt?.task.revisionTaskId === task.revisionTaskId) setRepairPrompt(undefined)
    }
    if (repairPrompt !== undefined) return
    const candidate = tasks.find((task) => (
      task.canContinue
      && isGraphReferenceRepairExhaustedError(task.error)
      && !dismissedRepairKeys.current.has(`${task.revisionTaskId}:${String(task.updatedAtMs)}`)
    ))
    if (candidate === undefined || candidate.error === undefined) return
    setRepairPrompt({
      task: candidate,
      key: `${candidate.revisionTaskId}:${String(candidate.updatedAtMs)}`,
    })
  }, [tasks, repairPrompt])

  const act = async (task: GraphRevisionTask, action: "cancel" | "rerun" | "continue"): Promise<void> => {
    if (project === undefined || operations.current.has(task.revisionTaskId)) return
    const current = generation.current
    operations.current.add(task.revisionTaskId)
    setPending((previous) => ({ ...previous, [task.revisionTaskId]: action }))
    setError(undefined)
    try {
      // Graph recovery is skill-owned: UI only enqueues .folio actions.
      await invokeBackend("folio.action.enqueue", {
        ...project,
        name: action === "cancel" ? "graph.cancel" : action === "rerun" ? "graph.rerun" : "graph.continue",
        input: { revisionTaskId: task.revisionTaskId },
        drain: true,
        ...(model === undefined ? {} : { model }),
      })
      if (generation.current !== current) return
      setRefresh((value) => value + 1)
      await onChanged?.()
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      operations.current.delete(task.revisionTaskId)
      setPending((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== task.revisionTaskId)))
    }
  }
  const dismissRepairPrompt = (): void => {
    if (repairPrompt === undefined) return
    dismissedRepairKeys.current.add(repairPrompt.key)
    setRepairPrompt(undefined)
  }

  return <>
  <section className="graph-revision-panel" aria-label="章节入库" data-testid="graph-revision-panel">
    <header className="graph-revision-heading">
      <strong>章节入库 <span>{tasks.length}</span></strong>
      <UiTooltip label="刷新任务"><button type="button" aria-label="刷新章节入库任务" onClick={() => { setRefresh((value) => value + 1) }}><RefreshCw size={15} /></button></UiTooltip>
    </header>
    {error === undefined ? null : <ExpandableErrorAlert message={error} className="graph-revision-error" title="章节入库错误" testId="graph-revision-action-error" />}
    {loadError === undefined ? null : <ExpandableErrorAlert message={loadError} className="graph-revision-error" title="章节入库读取错误" testId="graph-revision-load-error" />}
    {loading && tasks.length === 0 ? <p className="graph-revision-empty">正在读取任务…</p> : null}
    {!loading && tasks.length === 0 ? <p className="graph-revision-empty">{project === undefined ? "请先打开项目" : "暂无章节入库任务"}</p> : null}
    {tasks.map((task) => {
      const busy = pending[task.revisionTaskId]
      const { progress } = task
      const activity = task.status === "running" ? task.activity : undefined
      const current = progress.completed + Number(task.status === "running" && progress.phases.some((phase) => phase.status === "running"))
      return <article className="graph-revision-task" key={task.revisionTaskId} data-testid="graph-revision-task">
        <div className="graph-revision-title"><strong>{task.heading}</strong><span className={`graph-revision-status is-${task.status}`}>{statuses[task.status] ?? task.status}</span></div>
        <div className="graph-revision-progress" aria-live="polite">
          {task.status === "running" ? <Loader2 size={14} className="graph-revision-spinner" /> : task.status === "completed" ? <CheckCircle2 size={14} /> : null}
          <span>{task.status === "completed" ? "入库完成" : phaseLabels[progress.phase ?? ""] ?? "等待章节入库"}…（{current}/{progress.total ?? "待定"}）</span>
        </div>
        {progress.total !== null && progress.total > 0 ? <progress aria-label={`${task.heading}同步进度`} max={progress.total} value={current} /> : null}
        {activity === undefined ? null : <div className="graph-revision-activity" role="status">
          <span>{activityLabels[activity.stage]} · 第 {activity.attempt} 次请求</span>
          <span>本阶段已用 {elapsedText(activity.startedAtMs)} · {activity.reasoningCharacters + activity.contentCharacters === 0 ? `等待数据 ${elapsedText(activity.lastActivityAtMs)}` : `最近响应 ${elapsedText(activity.lastActivityAtMs)}前`}</span>
          {activity.reasoningCharacters + activity.contentCharacters === 0 ? null : <span>已接收思考 {activity.reasoningCharacters.toLocaleString("zh-CN")} 字符 · 结果 {activity.contentCharacters.toLocaleString("zh-CN")} 字符</span>}
        </div>}
        {task.blocksTurn ? <p className="graph-revision-blocker">章节入库尚未完成，暂不能开始新推演</p> : null}
        {task.error === undefined ? null : <ExpandableErrorAlert message={task.error} className="graph-revision-error" title="章节入库任务错误" testId={`graph-revision-task-error-${task.revisionTaskId}`} />}
        {progress.phases.length > 0 ? <details className="graph-revision-stages">
          <summary>阶段记录</summary>
          <StageRecordPanel task={task} monitorTask={monitorTask} onResetMetrics={onResetMetrics} />
        </details> : null}
        <footer><time dateTime={new Date(task.updatedAtMs).toISOString()}>{new Date(task.updatedAtMs).toLocaleString("zh-CN", { hour12: false })}</time><div>
          <button type="button" disabled={!task.canCancel || busy !== undefined} onClick={() => { void act(task, "cancel") }}><X size={12} aria-hidden="true" />{busy === "cancel" ? "取消中" : "取消"}</button>
          <button type="button" disabled={!task.canRetry || busy !== undefined} onClick={() => { void act(task, "rerun") }}><RotateCcw size={12} aria-hidden="true" />{busy === "rerun" ? "提交中" : "重跑"}</button>
          <button
            type="button"
            disabled={!task.canContinue || task.status === "running" || busy !== undefined}
            onClick={() => { void act(task, "continue") }}
          >
            <Play size={12} aria-hidden="true" />{busy === "continue" ? "提交中" : "继续"}
          </button>
        </div></footer>
      </article>
    })}
  </section>
  {repairPrompt === undefined ? null : <GraphReferenceRepairLimitDialog
    heading={repairPrompt.task.heading}
    error={repairPrompt.task.error ?? ""}
    onDismiss={dismissRepairPrompt}
    onContinue={() => {
      const task = repairPrompt.task
      dismissRepairPrompt()
      void act(task, "continue")
    }}
  />}
  </>
}
