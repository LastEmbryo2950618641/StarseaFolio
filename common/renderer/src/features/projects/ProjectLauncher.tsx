import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BookOpen, ImagePlus, Plus, Search, Trash2 } from "lucide-react"
import { MobileBottomSheet, useMobileViewport } from "../../components/MobileBottomSheet.js"

import {
  getBookCover,
  invokeBackend,
  readImageFile,
  selectImageFile,
  setBookCover,
  type OpenProject,
} from "../../api/client.js"
import { folderLabelFromPath, isUnderWorkDirectories } from "./book-path.js"
import { defaultBookCoverSrc } from "./default-book-cover.js"
import { DeleteBookDialog } from "./DeleteBookDialog.js"
import { ImageCropDialog } from "./ImageCropDialog.js"
import { type ProjectRailItem } from "./ProjectRail.js"
import { useWorkDirectory } from "./use-work-directory.js"
import { WorkNamePromptDialog } from "./WorkNamePromptDialog.js"
import { WorkDirectoryPromptDialog } from "./WorkDirectoryPromptDialog.js"
import { rememberWorkName } from "./work-name-history.js"

type Props = Readonly<{
  onOpen(project: OpenProject): void
  onCoverChanged?(projectId: string, dataUrl: string): void
}>
type PendingCover = Readonly<{ item: ProjectRailItem; src: string }>

function formatOpenedAgo(lastOpenedAtMs: number, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - lastOpenedAtMs)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "刚刚打开"
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)} 天前`
  return new Date(lastOpenedAtMs).toLocaleDateString()
}

export function ProjectLauncher({ onOpen, onCoverChanged }: Props): React.JSX.Element {
  const mobile = useMobileViewport()
  const [query, setQuery] = useState("")
  const [selectedBook, setSelectedBook] = useState<ProjectRailItem>()
  const workDirectoryState = useWorkDirectory()
  const [projects, setProjects] = useState<readonly ProjectRailItem[]>([])
  const [coverByProjectId, setCoverByProjectId] = useState<Readonly<Record<string, string>>>({})
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<"new" | string>()
  const [pendingCreatePath, setPendingCreatePath] = useState<string>()
  const [pendingDelete, setPendingDelete] = useState<ProjectRailItem>()
  const [pendingCover, setPendingCover] = useState<PendingCover>()
  const [nowMs, setNowMs] = useState(() => Date.now())

  const refreshProjects = useCallback(async (): Promise<void> => {
    setLoadingProjects(true)
    try {
      const result = await invokeBackend<{ projects: readonly ProjectRailItem[] }>("project.list", {})
      const filtered = result.projects
        .filter((project) => isUnderWorkDirectories(project.workspaceRootRef, workDirectoryState.workDirectories))
        .sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs)
      setProjects(filtered)
      setNowMs(Date.now())
      setError(undefined)
      const covers = await Promise.all(filtered.map(async (project) => {
        try {
          const cover = await getBookCover(project.workspaceRootRef)
          return cover === undefined ? undefined : ([project.projectId, cover] as const)
        } catch {
          return undefined
        }
      }))
      const next: Record<string, string> = {}
      for (const entry of covers) {
        if (entry !== undefined) next[entry[0]] = entry[1]
      }
      setCoverByProjectId(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingProjects(false)
    }
  }, [workDirectoryState.workDirectories])

  useEffect(() => {
    if (workDirectoryState.workDirectory === undefined) return
    void refreshProjects()
  }, [refreshProjects, workDirectoryState.workDirectory])

  const finishCreate = async (workspaceRootRef: string, displayName: string): Promise<void> => {
    setBusy("new")
    setError(undefined)
    try {
      const project = await invokeBackend<OpenProject>("project.create", {
        projectId: crypto.randomUUID(),
        displayName,
        workspaceRootRef,
      })
      rememberWorkName(project.projectId, project.displayName)
      await refreshProjects()
      onOpen(project)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
      setPendingCreatePath(undefined)
    }
  }

  const createBook = async (): Promise<void> => {
    if (workDirectoryState.workDirectory === undefined) {
      setError("请先配置软件工作目录")
      return
    }
    setBusy("new")
    setError(undefined)
    try {
      const workspaceRootRef = await workDirectoryState.allocateBookWorkspacePath()
      setPendingCreatePath(workspaceRootRef)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const openBookCard = async (item: ProjectRailItem): Promise<void> => {
    setBusy(item.projectId)
    setError(undefined)
    try {
      const project = await invokeBackend<OpenProject>("project.open", {
        workspaceRootRef: item.workspaceRootRef,
      })
      rememberWorkName(project.projectId, project.displayName)
      onOpen(project)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const changeCover = async (item: ProjectRailItem): Promise<void> => {
    setError(undefined)
    setBusy(`cover-select:${item.projectId}`)
    try {
      const sourcePath = await selectImageFile({ title: "选择封面图片" })
      if (sourcePath === undefined) return
      const src = await readImageFile(sourcePath)
      setPendingCover({ item, src })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const confirmCover = async (dataUrl: string): Promise<void> => {
    if (pendingCover === undefined) return
    const { item } = pendingCover
    setBusy(`cover:${item.projectId}`)
    setError(undefined)
    try {
      const savedCover = await setBookCover({
        workspaceRootRef: item.workspaceRootRef,
        dataUrl,
      })
      setCoverByProjectId((prev) => ({ ...prev, [item.projectId]: savedCover }))
      onCoverChanged?.(item.projectId, savedCover)
      setPendingCover(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (pendingDelete === undefined) return
    const item = pendingDelete
    setBusy(`delete:${item.projectId}`)
    setError(undefined)
    try {
      await invokeBackend("project.delete", {
        projectId: item.projectId,
        workspaceRootRef: item.workspaceRootRef,
        mode: "include_data",
      })
      setPendingDelete(undefined)
      await refreshProjects()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  if (workDirectoryState.loading || (workDirectoryState.workDirectory === undefined && workDirectoryState.defaultWorkDirectory.length === 0)) {
    return <main className="launcher"><p className="launcher-loading">正在加载工作目录…</p></main>
  }

  if (workDirectoryState.workDirectory === undefined) {
    return <>
      <WorkDirectoryPromptDialog
        defaultDirectory={workDirectoryState.defaultWorkDirectory}
        busy={workDirectoryState.saving}
        onConfirmDefault={() => {
          void workDirectoryState.confirmWorkDirectory(workDirectoryState.defaultWorkDirectory).catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause))
          })
        }}
        onChooseDirectory={() => { void workDirectoryState.chooseWorkDirectory() }}
      />
      {error === undefined && workDirectoryState.error === undefined
        ? null
        : <p className="form-error launcher-error" role="alert">{error ?? workDirectoryState.error}</p>}
    </>
  }

  const interactionLocked = busy !== undefined || pendingCreatePath !== undefined || pendingDelete !== undefined || pendingCover !== undefined
  const search = query.trim().toLocaleLowerCase()
  const visibleProjects = search.length === 0 ? projects : projects.filter((item) => item.displayName.toLocaleLowerCase().includes(search))

  return (
    <main className="launcher launcher--library">
      <header className="launcher-library-header">
        <h1>我的书籍</h1>
        <p>选择一本书继续创作，或添加新书</p>
      </header>

      <label className="launcher-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" aria-label="搜索书籍" placeholder="搜索书名…" value={query} onChange={(event) => { setQuery(event.target.value) }} />
      </label>

      {loadingProjects
        ? <p className="launcher-loading">正在加载书籍…</p>
        : null}
      <div className="launcher-book-grid" data-testid="launcher-book-grid">
        {visibleProjects.map((item) => {
          const coverSrc = coverByProjectId[item.projectId] ?? defaultBookCoverSrc(item.displayName)
          if (mobile) return <button type="button" key={item.projectId} className="launcher-book-card launcher-book-card--mobile"
            data-testid="launcher-book-card" aria-label={`书籍操作：${item.displayName}`} disabled={interactionLocked}
            onClick={() => { setSelectedBook(item) }}>
            <span className="launcher-book-cover"><img src={coverSrc} alt="" draggable={false} /></span>
            <strong className="launcher-book-title">{item.displayName}</strong>
            <span className="launcher-book-meta">{formatOpenedAgo(item.lastOpenedAtMs, nowMs)}</span>
          </button>
          return (
            <div
              key={item.projectId}
              className="launcher-book-card"
              data-testid="launcher-book-card"
            >
              <div className="launcher-book-cover">
                <img src={coverSrc} alt="" draggable={false} />
                <div className="launcher-book-actions">
                  <button
                    type="button"
                    className="launcher-book-action launcher-book-action--primary"
                    disabled={interactionLocked}
                    onClick={() => { void openBookCard(item) }}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    className="launcher-book-action"
                    disabled={interactionLocked}
                    onClick={() => { void changeCover(item) }}
                  >
                    更换封面
                  </button>
                  <button
                    type="button"
                    className="launcher-book-action launcher-book-action--danger"
                    disabled={interactionLocked}
                    onClick={() => { setPendingDelete(item) }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <strong className="launcher-book-title">{item.displayName}</strong>
              <span className="launcher-book-meta">{formatOpenedAgo(item.lastOpenedAtMs, nowMs)}</span>
            </div>
          )
        })}
        <button
          type="button"
          className="launcher-book-card launcher-book-card--add"
          data-testid="launcher-create-project"
          disabled={interactionLocked}
          onClick={() => { void createBook() }}
        >
          <span className="launcher-book-cover launcher-book-cover--add" aria-hidden>
            <span className="launcher-book-add-icon">
              <Plus size={22} strokeWidth={2.25} />
            </span>
          </span>
          <strong className="launcher-book-title">{busy === "new" ? "正在创建…" : "添加书籍"}</strong>
        </button>
      </div>

      {!loadingProjects && visibleProjects.length === 0 ? <p className="launcher-search-empty" role="status">{projects.length === 0 ? "还没有书籍，点击添加书籍开始创作。" : "没有找到匹配的书籍，请换个书名搜索。"}</p> : null}
      {!mobile || selectedBook === undefined ? null : <MobileBottomSheet title="书籍操作" name="book-actions" onClose={() => { setSelectedBook(undefined) }}>
        <div className="mobile-book-summary">
          <img src={coverByProjectId[selectedBook.projectId] ?? defaultBookCoverSrc(selectedBook.displayName)} alt="" />
          <div><strong>{selectedBook.displayName}</strong><small>{formatOpenedAgo(selectedBook.lastOpenedAtMs, nowMs)}</small></div>
        </div>
        <div className="mobile-book-actions">
          <button type="button" className="mobile-book-open" disabled={interactionLocked} onClick={() => { const item = selectedBook; setSelectedBook(undefined); void openBookCard(item) }}><BookOpen size={20} />打开</button>
          <button type="button" disabled={interactionLocked} onClick={() => { const item = selectedBook; setSelectedBook(undefined); void changeCover(item) }}><ImagePlus size={20} />更换封面</button>
          <button type="button" className="mobile-book-delete" disabled={interactionLocked} onClick={() => { setPendingDelete(selectedBook); setSelectedBook(undefined) }}><Trash2 size={20} />删除</button>
        </div>
      </MobileBottomSheet>}

      {error === undefined ? null : <div className="form-error launcher-error" role="alert">
        <span>{error}</span>
        <button
          type="button"
          className="launcher-error-dismiss"
          aria-label="关闭提示"
          title="关闭"
          onClick={() => { setError(undefined) }}
        >
          ×
        </button>
      </div>}
      {pendingCreatePath === undefined ? null : createPortal(
        <WorkNamePromptDialog
          folderLabel={folderLabelFromPath(pendingCreatePath)}
          onCancel={() => { setPendingCreatePath(undefined) }}
          onConfirm={(displayName) => { void finishCreate(pendingCreatePath, displayName) }}
        />,
        document.body,
      )}
      {pendingDelete === undefined ? null : createPortal(
        <DeleteBookDialog
          displayName={pendingDelete.displayName}
          busy={busy === `delete:${pendingDelete.projectId}`}
          onCancel={() => { setPendingDelete(undefined) }}
          onConfirm={() => { void confirmDelete() }}
        />,
        document.body,
      )}
      {pendingCover === undefined ? null : createPortal(
        <ImageCropDialog
          src={pendingCover.src}
          busy={busy === `cover:${pendingCover.item.projectId}`}
          onCancel={() => { if (busy === undefined) setPendingCover(undefined) }}
          onConfirm={(dataUrl) => { void confirmCover(dataUrl) }}
        />,
        document.body,
      )}
    </main>
  )
}
