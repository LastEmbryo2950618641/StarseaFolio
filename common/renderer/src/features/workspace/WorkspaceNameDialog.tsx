import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, FilePlus2, FolderPlus } from "lucide-react"
import { CHARACTER_DIRECTORY } from "@starseafolio/contracts"
import { userPromptCategory, userPromptTypes } from "./prompt-paths.js"

type Props = Readonly<{
  kind: "file" | "directory"
  parentPath: string
  onConfirm(name: string, promptType?: string): void
  onCancel(): void
}>

export function WorkspaceNameDialog({ kind, parentPath, onConfirm, onCancel }: Props): React.JSX.Element {
  const character = kind === "file" && parentPath === CHARACTER_DIRECTORY
  const [draft, setDraft] = useState(kind === "file" ? character ? "新人物" : "未命名.md" : "未命名文件夹")
  const inputRef = useRef<HTMLInputElement>(null)
  const typeTriggerRef = useRef<HTMLButtonElement>(null)
  const typeMenuRef = useRef<HTMLDivElement>(null)
  const typeListId = useId()
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [promptType, setPromptType] = useState("")
  const category = kind === "file" ? userPromptCategory(parentPath) : undefined
  const awaitingType = category !== undefined && promptType === ""

  useEffect(() => {
    if (awaitingType) {
      typeTriggerRef.current?.focus()
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [awaitingType])

  useEffect(() => {
    if (!typeMenuOpen) return
    const menu = typeMenuRef.current
    const option = menu?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?? menu?.querySelector<HTMLButtonElement>('[role="option"]')
    option?.focus()
  }, [typeMenuOpen])

  const submit = (): void => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || awaitingType) return
    onConfirm(trimmed, promptType || undefined)
  }

  const title = character ? "新增人物" : kind === "file" ? "新建 Markdown" : "新建文件夹"
  const label = kind === "file" ? "文件名" : "文件夹名称"
  const Icon = kind === "file" ? FilePlus2 : FolderPlus

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <section
      className="work-name-prompt-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-name-prompt-title"
      data-testid="workspace-name-dialog"
    >
      <header>
        <span className="work-name-prompt-icon"><Icon size={16} /></span>
        <div>
          <strong id="workspace-name-prompt-title">{title}</strong>
          <small>位置：{parentPath}</small>
        </div>
      </header>
      <div className="work-name-prompt-body">
        {category !== undefined && <div className="workspace-name-prompt-type">
          <span id={`${typeListId}-label`}>提示词类型</span>
          <div className="creation-desk-focus-combobox" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setTypeMenuOpen(false)
          }} onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (typeMenuOpen) {
                event.preventDefault()
                setTypeMenuOpen(false)
                typeTriggerRef.current?.focus()
              } else {
                onCancel()
              }
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
            event.preventDefault()
            if (!typeMenuOpen) {
              setTypeMenuOpen(true)
              return
            }
            const options = Array.from(typeMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
            const index = options.findIndex((option) => option === document.activeElement)
            const step = event.key === "ArrowDown" ? 1 : -1
            options[(index + step + options.length) % options.length]?.focus()
          }}>
            <button
              ref={typeTriggerRef}
              type="button"
              className="creation-desk-focus-trigger"
              aria-labelledby={`${typeListId}-label ${typeListId}-value`}
              aria-haspopup="listbox"
              aria-expanded={typeMenuOpen}
              aria-controls={typeMenuOpen ? typeListId : undefined}
              onClick={() => setTypeMenuOpen((open) => !open)}
            >
              <span id={`${typeListId}-value`}>{promptType || "请选择提示词类型"}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {typeMenuOpen && <div ref={typeMenuRef} id={typeListId} className="creation-desk-focus-menu" role="listbox" aria-labelledby={`${typeListId}-label`}>
              {userPromptTypes(category).map((type) => <button
                key={type}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={type === promptType}
                className={type === promptType ? "is-selected" : undefined}
                onClick={() => {
                  setPromptType(type)
                  setTypeMenuOpen(false)
                  if (!awaitingType) inputRef.current?.focus()
                }}
              >{type}</button>)}
            </div>}
          </div>
        </div>}
        {!awaitingType && <label>
          <span>{label}</span>
          <input
            ref={inputRef}
            value={draft}
            maxLength={200}
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              }
              if (event.key === "Escape") onCancel()
            }}
          />
        </label>}
        {kind === "file"
          ? <p>{character ? "每个人物独立保存，自动创建 .json 人物资料。" : "可省略扩展名，保存时会自动补上 .md。"}</p>
          : <p>文件夹名称不能包含斜杠。</p>}
      </div>
      <footer>
        <button type="button" onClick={onCancel}>取消</button>
        <button
          className="dialog-primary-command"
          type="button"
          data-testid="workspace-name-confirm"
          disabled={awaitingType || !draft.trim()}
          onClick={submit}
        >
          创建
        </button>
      </footer>
    </section>
  </div>
}
