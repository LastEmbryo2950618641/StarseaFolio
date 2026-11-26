import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, FileText } from "lucide-react"
import { VOLUME_LIFECYCLE_LABELS, VOLUME_LIFECYCLE_PHASES, type DiscussFocusKind, type SynopsisConversationSession } from "@starseafolio/contracts"

import {
  discussFocusOpenLabel,
  extractVolumeFolderNameFromChapterPath,
  groupChaptersByVolume,
  resolveDiscussFocusKindForChapter,
  resolveDiscussFocusOpenPath,
  type DiscussFocusChapterOption,
} from "./synopsis-path.js"

type Props = Readonly<{
  session: SynopsisConversationSession
  chapters: readonly DiscussFocusChapterOption[]
  /** Target chapter count for the active volume plan; omit to show only the in-volume index. */
  volumeTargetChapterCount?: number
  onSelectChapter(sequence: number, focusKind: DiscussFocusKind): void
  onOpenFile(path: string): void
}>

export function CreationDeskFocusBar(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusKind = props.session.focusKind ?? "plot_synopsis"
  const selected = props.chapters.find((item) => item.sequence === props.session.chapterSequence)
  const displayLabel = selected?.label
    ?? (props.session.title.length > 0
      ? `第${String(props.session.chapterSequence)}章 ${props.session.title}`
      : `第${String(props.session.chapterSequence)}章`)
  const volumeProgressLabel = useMemo(() => {
    const volumeName = props.session.volumeLifecycle?.volumeFolderName ?? selected?.volumeFolderName
    const volumeChapters = (volumeName === undefined
      ? props.chapters
      : props.chapters.filter((item) => item.volumeFolderName === volumeName)
    ).slice().sort((a, b) => a.sequence - b.sequence)
    const indexInVolume = volumeChapters.findIndex((item) => item.sequence === props.session.chapterSequence)
    const current = indexInVolume >= 0 ? indexInVolume + 1 : props.session.chapterSequence
    const lifecycle = props.session.volumeLifecycle
    const total = lifecycle !== undefined && lifecycle.volumeFolderName === volumeName
      ? lifecycle.chapterLimit
      : props.volumeTargetChapterCount
    if (total !== undefined && total > 0) return `第 ${String(current)}/${String(total)} 章`
    return `第 ${String(current)} 章`
  }, [
    props.chapters,
    props.session.chapterSequence,
    props.volumeTargetChapterCount,
    props.session.volumeLifecycle,
    selected?.volumeFolderName,
  ])
  const filtered = useMemo(() => {
    const needle = query.trim()
    if (needle.length === 0) return props.chapters
    return props.chapters.filter((item) => (
      item.label.includes(needle)
      || String(item.sequence).includes(needle)
    ))
  }, [props.chapters, query])
  const openPath = resolveDiscussFocusOpenPath(selected, focusKind)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    window.addEventListener("pointerdown", onPointer)
    return () => { window.removeEventListener("pointerdown", onPointer) }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const lifecycle = props.session.volumeLifecycle
  const volumeName = lifecycle?.volumeFolderName ?? selected?.volumeFolderName
    ?? extractVolumeFolderNameFromChapterPath(props.session.synopsisPath) ?? "当前卷"
  const volumes = useMemo(() => groupChaptersByVolume(props.chapters.map((chapter) => {
    const path = chapter.synopsisPath ?? chapter.outlinePath ?? chapter.bodyPath
    const folder = chapter.volumeFolderName ?? (path === undefined ? undefined : extractVolumeFolderNameFromChapterPath(path))
    return folder === undefined ? chapter : { ...chapter, volumeFolderName: folder }
  })), [props.chapters])
  return <div className="creation-desk-focus-stack" ref={rootRef} data-testid="creation-desk-focus-bar">
    <div className="creation-desk-session-bar">
    <FileText size={13} aria-hidden="true" />
    <div className="creation-desk-focus-combobox">
      <button
        type="button"
        className="creation-desk-focus-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="当前讨论焦点章节"
        onClick={() => { setOpen((current) => !current); }}
      >
        <span>{displayLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open
        ? <div className="creation-desk-focus-menu" role="listbox">
            <input
              ref={inputRef}
              value={query}
              placeholder="搜索章节…"
              aria-label="搜索章节"
              onChange={(event) => { setQuery(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false)
                  setQuery("")
                }
                if (event.key === "Enter") {
                  const first = filtered[0]
                  if (first !== undefined) {
                    props.onSelectChapter(
                      first.sequence,
                      resolveDiscussFocusKindForChapter(first, focusKind),
                    )
                    setOpen(false)
                    setQuery("")
                  }
                }
              }}
            />
            <ul>
              {filtered.length === 0
                ? <li className="creation-desk-focus-empty">没有匹配的章节</li>
                : filtered.map((item) => <li key={item.sequence}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.sequence === props.session.chapterSequence}
                      className={item.sequence === props.session.chapterSequence ? "is-selected" : ""}
                      onClick={() => {
                        props.onSelectChapter(
                          item.sequence,
                          resolveDiscussFocusKindForChapter(item, focusKind),
                        )
                        setOpen(false)
                        setQuery("")
                      }}
                    >
                      {item.label}
                    </button>
                  </li>)}
            </ul>
          </div>
        : null}
    </div>
    {openPath === undefined
      ? null
      : <button
          type="button"
          className="synopsis-open-file"
          onClick={() => { props.onOpenFile(openPath); }}
        >
          {discussFocusOpenLabel(focusKind)}
        </button>}
    </div>
    <div className="creation-desk-proceed-panel creation-desk-volume-progress" data-testid="creation-desk-volume-progress">
      <select
        className="creation-desk-proceed-mode creation-desk-volume-focus"
        aria-label="当前讨论焦点卷"
        title={volumeName}
        value={volumeName}
        onChange={(event) => {
          const volume = volumes.find((group) => group.volumeFolderName === event.target.value)
          const chapter = volume?.chapters.reduce<DiscussFocusChapterOption | undefined>(
            (first, item) => first === undefined || item.sequence < first.sequence ? item : first, undefined,
          )
          if (chapter !== undefined) props.onSelectChapter(chapter.sequence, resolveDiscussFocusKindForChapter(chapter, focusKind))
        }}
      >
        {!volumes.some((group) => group.volumeFolderName === volumeName) && <option value={volumeName}>{volumeName}</option>}
        {volumes.map((group) => <option key={group.volumeFolderName} value={group.volumeFolderName}>{group.volumeFolderName}</option>)}
      </select>
      <ol className="creation-desk-proceed-stages creation-desk-volume-stages" aria-label="卷阶段">
        {VOLUME_LIFECYCLE_PHASES.map((phase, index) => {
          const status = lifecycle?.stages.find((stage) => stage.phase === phase)?.status ?? "pending"
          const waitingForEnd = phase === "volume_end" && status === "current" && lifecycle?.ended === false
          const writingCount = phase === "writing" && status === "current" && lifecycle !== undefined && lifecycle.chapterLimit > 0
            ? `待写入 ${Math.min(lifecycle.chapterCount + 1, lifecycle.chapterLimit)}/${lifecycle.chapterLimit}` : undefined
          const detail = writingCount ?? (waitingForEnd ? "待标记" : undefined)
          const stepClass = status === "done" ? "is-done" : status === "current" ? "is-active status-waiting" : ""
          const label = VOLUME_LIFECYCLE_LABELS[phase]
          return <li key={phase} className={`creation-desk-proceed-step ${stepClass}`} aria-current={status === "current" ? "step" : undefined}>
            {index > 0 && <span className="creation-desk-proceed-connector" aria-hidden="true" />}
            <span className="creation-desk-proceed-stage" title={detail === undefined ? label : `${label} · ${detail}`} data-testid={`creation-desk-volume-stage-${phase}`}>
              <span className="creation-desk-proceed-stage-label">{label}</span>
              {detail !== undefined && <span className="creation-desk-proceed-stage-gate">{detail}</span>}
            </span>
          </li>
        })}
      </ol>
      {lifecycle === undefined && <span className="creation-desk-volume-count">{volumeProgressLabel}</span>}
    </div>
  </div>
}
