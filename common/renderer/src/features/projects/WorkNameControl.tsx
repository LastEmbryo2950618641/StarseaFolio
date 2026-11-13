import { useEffect, useRef, useState } from "react"
import { ChevronDown, History, PencilLine, RefreshCw } from "lucide-react"

import type { DesktopModelProfile, OpenProject } from "../../api/client.js"
import { invokeBackend } from "../../api/client.js"
import { rememberWorkName, readWorkNameHistory } from "./work-name-history.js"

type Props = Readonly<{
  project: OpenProject
  statusLabel: string
  running: boolean
  model?: DesktopModelProfile
  onRenamed(displayName: string, description?: string): void
}>

export function WorkNameControl({ project, statusLabel, running, model, onRenamed }: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const onRenamedRef = useRef(onRenamed)
  useEffect(() => { onRenamedRef.current = onRenamed }, [onRenamed])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.displayName)
  const [description, setDescription] = useState(project.description ?? "")
  const [descriptionDraft, setDescriptionDraft] = useState(project.description ?? "")
  const [editingDescription, setEditingDescription] = useState(false)
  const [history, setHistory] = useState<readonly string[]>(() => readWorkNameHistory(project.projectId))
  const [busy, setBusy] = useState<"load" | "refresh" | "save">()
  const [error, setError] = useState<string>()

  useEffect(() => {
    setDraft(project.displayName)
    setHistory(readWorkNameHistory(project.projectId))
    setEditing(false)
    setError(undefined)
  }, [project.displayName, project.projectId])

  useEffect(() => {
    setDescription(project.description ?? "")
    setDescriptionDraft(project.description ?? "")
    setEditingDescription(false)
  }, [project.projectId, project.description])

  useEffect(() => {
    if (!open) return
    let active = true
    setBusy("load")
    void invokeBackend<{ displayName: string; description: string }>("project.metadata.read", {
      projectId: project.projectId,
      workspaceRootRef: project.workspaceRootRef,
    }).then((metadata) => {
      if (!active) return
      setDescription(metadata.description)
      setDescriptionDraft(metadata.description)
      onRenamedRef.current(metadata.displayName, metadata.description)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (active) setBusy(undefined)
    })
    return () => { active = false }
  }, [open, project.projectId, project.workspaceRootRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setEditing(false)
        setEditingDescription(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => { document.removeEventListener("mousedown", onPointerDown) }
  }, [open])

  const applyName = async (displayName: string, nextDescription?: string): Promise<void> => {
    const trimmed = displayName.trim()
    if (trimmed.length === 0 || (trimmed === project.displayName && nextDescription === undefined)) {
      setEditing(false)
      return
    }
    setBusy("save")
    setError(undefined)
    try {
      const renamed = await invokeBackend<OpenProject>("project.rename", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        displayName: trimmed,
        ...(nextDescription === undefined ? {} : { description: nextDescription }),
      })
      setHistory(rememberWorkName(project.projectId, renamed.displayName))
      setDescription(renamed.description ?? description)
      setDescriptionDraft(renamed.description ?? description)
      onRenamed(renamed.displayName, renamed.description)
      setEditing(false)
      setEditingDescription(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const refreshGenerate = async (): Promise<void> => {
    if (model === undefined) {
      setError("模型配置尚未加载完成，请稍候再生成标题")
      return
    }
    setBusy("refresh")
    setError(undefined)
    try {
      const suggested = await invokeBackend<{ displayName: string; description: string; alternatives?: readonly string[] }>("project.suggestDisplayName", {
        projectId: project.projectId,
        workspaceRootRef: project.workspaceRootRef,
        historyNames: readWorkNameHistory(project.projectId),
        model: {
          baseUrl: model.baseUrl,
          model: model.model,
          credentialRef: model.credentialRef,
          apiProtocol: model.apiProtocol,
          contextWindowTokens: model.contextWindowTokens,
          thinkingModeEnabled: false,
          reasoningEffort: model.reasoningEffort,
          jsonModeEnabled: model.jsonModeEnabled,
          disableResponseStorage: model.disableResponseStorage,
          serviceTier: model.serviceTier,
        },
      })
      setDraft(suggested.displayName)
      setBusy(undefined)
      await applyName(suggested.displayName, suggested.description)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(undefined)
    }
  }

  return <div className={`work-name-control${open ? " open" : ""}`} ref={rootRef} data-testid="work-name-control">
    <button
      type="button"
      className="work-name-trigger"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={() => { setOpen((current) => !current); setEditing(false); setEditingDescription(false); setError(undefined) }}
    >
      <span className="work-name-trigger-label">{project.displayName}</span>
      <i className={running ? "running" : ""} />
      <em>{statusLabel}</em>
      <ChevronDown size={13} />
    </button>
    {open ? <div className="work-name-menu" role="menu">
      <div className="work-name-menu-actions">
        <button type="button" disabled={busy !== undefined} data-testid="work-name-refresh" onClick={() => { void refreshGenerate() }}>
          <RefreshCw size={13} className={busy === "refresh" ? "work-name-spin" : undefined} />
          AI生成标题
        </button>
        <button type="button" disabled={busy !== undefined} data-testid="work-name-edit" onClick={() => {
          setEditing(true)
          setDraft(project.displayName)
        }}>
          <PencilLine size={13} />
          输入标题
        </button>
      </div>
      {editing ? <form className="work-name-edit-row" onSubmit={(event) => {
        event.preventDefault()
        void applyName(draft)
      }}>
        <input
          value={draft}
          maxLength={200}
          autoFocus
          disabled={busy !== undefined}
          data-testid="work-name-input"
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button type="submit" disabled={busy !== undefined || draft.trim().length === 0}>保存</button>
      </form> : null}
      <section className="work-name-overview" aria-label="书籍信息">
        <strong className="work-name-current-title" data-testid="work-name-current-title">{project.displayName}</strong>
        <div className="work-name-description-heading">
          <span>书籍简介</span>
          <button type="button" aria-label="编辑书籍简介" disabled={busy !== undefined} onClick={() => {
            setDescriptionDraft(description)
            setEditingDescription((current) => !current)
          }}><PencilLine size={12} /></button>
        </div>
        {editingDescription ? <form className="work-name-description-form" onSubmit={(event) => {
          event.preventDefault()
          void applyName(project.displayName, descriptionDraft)
        }}>
          <textarea aria-label="书籍简介" value={descriptionDraft} maxLength={300} rows={5}
            disabled={busy !== undefined} onChange={(event) => { setDescriptionDraft(event.target.value) }} />
          <div><small>{descriptionDraft.length}/300</small><button type="submit" disabled={busy !== undefined}>保存简介</button></div>
        </form> : <p className="work-name-description" data-testid="work-name-description">{description || "暂无简介，AI 会根据构思与剧情补充。"}</p>}
      </section>
      {history.filter((entry) => entry !== project.displayName).length === 0 ? null : <><p className="work-name-empty"><History size={12} />历史标题</p><ul className="work-name-history">
        {history.filter((entry) => entry !== project.displayName).map((entry) => <li key={entry}>
          <button
            type="button"
            disabled={busy !== undefined || entry === project.displayName}
            onClick={() => { void applyName(entry) }}
          >
            {entry}
          </button>
        </li>)}
      </ul></>}
      {error === undefined ? null : <p className="work-name-error" role="alert">{error}</p>}
    </div> : null}
  </div>
}
