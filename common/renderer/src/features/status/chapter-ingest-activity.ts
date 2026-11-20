import { useEffect, useState } from "react"
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

/** Poll running chapter-ingest (graph-revision) progress for the open project. */
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
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    let wasBusy = false
    const onSettled = options?.onSettled
    const poll = async (): Promise<void> => {
      try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return
        const listed = await invokeBackend<readonly GraphRevisionTask[]>("chapter.graphRevision.list", project)
        if (disposed) return
        const running = listed.find((item) => item.status === "running" || item.status === "pending")
        busy = running !== undefined
        if (wasBusy && !busy) {
          void Promise.resolve(onSettled?.()).catch(() => undefined)
        }
        wasBusy = busy
        setActivity(resolveChapterIngestActivity(running))
      } catch {
        if (!disposed) {
          setActivity(undefined)
          busy = false
          wasBusy = false
        }
      } finally {
        if (!disposed) {
          const hidden = typeof document !== "undefined" && document.visibilityState === "hidden"
          timer = setTimeout(() => { void poll() }, hidden ? 12_000 : busy ? 1_500 : 8_000)
        }
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [options?.onSettled, project?.projectId, project?.workspaceRootRef])

  return activity
}
