import { startTransition, useEffect, useState } from "react"
import type { GraphRevisionTask } from "@starseafolio/contracts"

import { invokeBackend } from "../../api/client.js"

export type ChapterIngestActivity = Readonly<{
  heading: string
  phaseLabel: string
  current: number
  total: number | null
}>

export const CHAPTER_INGEST_PHASE_LABELS: Record<string, string> = {
  settings_extraction: "抽取并写入设定",
  work_style_revision: "风格抽取与融合",
  graph_governance: "准备修订与证据",
  dependency_audit: "分析依赖与影响",
  graph_structure_plan: "生成图变更",
  graph_governance_review: "审核与查询验证",
  frontier_settlement: "更新推演前沿",
  commit_review: "校验并提交",
}

export function resolveChapterIngestActivity(
  task: GraphRevisionTask | undefined,
): ChapterIngestActivity | undefined {
  if (task === undefined) return undefined
  if (task.status !== "running" && task.status !== "pending") return undefined
  const { progress } = task
  const current = progress.completed + Number(progress.phases.some((phase) => phase.status === "running"))
  return {
    heading: task.heading,
    phaseLabel: CHAPTER_INGEST_PHASE_LABELS[progress.phase ?? ""] ?? progress.phase ?? "章节入库",
    current,
    total: progress.total,
  }
}

export function formatChapterIngestDetail(activity: ChapterIngestActivity): string {
  const total = activity.total === null ? "?" : String(activity.total)
  return `${activity.phaseLabel} · ${String(activity.current)}/${total} · ${activity.heading}`
}

export function chapterIngestActivityEqual(
  left: ChapterIngestActivity | undefined,
  right: ChapterIngestActivity | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return left.heading === right.heading
    && left.phaseLabel === right.phaseLabel
    && left.current === right.current
    && left.total === right.total
}

type ProjectKey = string
type SettledListener = () => void | Promise<void>
type ActivityListener = (activity: ChapterIngestActivity | undefined) => void

type SharedPoll = {
  activity: ChapterIngestActivity | undefined
  listeners: Set<ActivityListener>
  settled: Set<SettledListener>
  timer: ReturnType<typeof setTimeout> | undefined
  disposed: boolean
  busy: boolean
  wasBusy: boolean
}

const sharedPolls = new Map<ProjectKey, SharedPoll>()

function projectKey(project: Readonly<{ projectId: string; workspaceRootRef: string }>): ProjectKey {
  return `${project.projectId}\u0000${project.workspaceRootRef}`
}

function schedule(poll: SharedPoll, project: Readonly<{ projectId: string; workspaceRootRef: string }>): void {
  if (poll.disposed) return
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden"
  poll.timer = setTimeout(() => { void runPoll(project) }, hidden ? 12_000 : poll.busy ? 1_500 : 8_000)
}

async function runPoll(project: Readonly<{ projectId: string; workspaceRootRef: string }>): Promise<void> {
  const key = projectKey(project)
  const poll = sharedPolls.get(key)
  if (poll === undefined || poll.disposed) return
  try {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const listed = await invokeBackend<readonly GraphRevisionTask[]>("chapter.graphRevision.list", project)
    const current = sharedPolls.get(key)
    if (current === undefined || current.disposed) return
    const running = listed.find((item) => item.status === "running" || item.status === "pending")
    current.busy = running !== undefined
    if (current.wasBusy && !current.busy) {
      for (const listener of [...current.settled]) {
        void Promise.resolve(listener()).catch(() => undefined)
      }
    }
    current.wasBusy = current.busy
    const next = resolveChapterIngestActivity(running)
    if (!chapterIngestActivityEqual(current.activity, next)) {
      current.activity = next
      for (const listener of [...current.listeners]) listener(next)
    }
  } catch {
    const current = sharedPolls.get(key)
    if (current === undefined || current.disposed) return
    current.busy = false
    current.wasBusy = false
    if (current.activity !== undefined) {
      current.activity = undefined
      for (const listener of [...current.listeners]) listener(undefined)
    }
  } finally {
    const current = sharedPolls.get(key)
    if (current !== undefined && !current.disposed) schedule(current, project)
  }
}

function subscribeChapterIngestActivity(
  project: Readonly<{ projectId: string; workspaceRootRef: string }>,
  listener: ActivityListener,
  onSettled?: SettledListener,
): () => void {
  const key = projectKey(project)
  let poll = sharedPolls.get(key)
  if (poll === undefined) {
    poll = {
      activity: undefined,
      listeners: new Set(),
      settled: new Set(),
      timer: undefined,
      disposed: false,
      busy: false,
      wasBusy: false,
    }
    sharedPolls.set(key, poll)
    void runPoll(project)
  }
  poll.listeners.add(listener)
  if (onSettled !== undefined) poll.settled.add(onSettled)
  listener(poll.activity)

  const onVisibility = (): void => {
    if (document.visibilityState !== "visible") return
    const current = sharedPolls.get(key)
    if (current === undefined || current.disposed) return
    clearTimeout(current.timer)
    void runPoll(project)
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
  }

  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility)
    }
    const current = sharedPolls.get(key)
    if (current === undefined) return
    current.listeners.delete(listener)
    if (onSettled !== undefined) current.settled.delete(onSettled)
    if (current.listeners.size > 0) return
    current.disposed = true
    clearTimeout(current.timer)
    sharedPolls.delete(key)
  }
}

/** Shared poll: composer + right rail subscribe once per project instead of dual IPC. */
export function useChapterIngestActivity(
  project: Readonly<{ projectId: string; workspaceRootRef: string }> | undefined,
  options?: Readonly<{ onSettled?: () => void | Promise<void> }>,
): ChapterIngestActivity | undefined {
  const [activity, setActivity] = useState<ChapterIngestActivity | undefined>(undefined)

  useEffect(() => {
    if (project === undefined || project.projectId.length === 0 || project.workspaceRootRef.length === 0) {
      setActivity(undefined)
      return
    }
    return subscribeChapterIngestActivity(
      project,
      (next) => {
        startTransition(() => {
          setActivity((previous) => (chapterIngestActivityEqual(previous, next) ? previous : next))
        })
      },
      options?.onSettled,
    )
  }, [options?.onSettled, project?.projectId, project?.workspaceRootRef])

  return activity
}
