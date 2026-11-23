import { useEffect, useRef } from "react"
import { Sparkles } from "lucide-react"

import { promptCategoryLabel } from "../workspace/prompt-paths.js"

export const PROMPT_SAVE_CONFIRM_MESSAGE = "这是平台提示词。保存后会写入全局提示词库，并影响所有作品后续生成。确定保存吗？"

type Props = Readonly<{
  path: string
  onConfirm(): void
  onCancel(): void
}>

/** 平台提示词保存前的确认弹窗；确认后才真正落盘。 */
export function PromptSaveConfirmDialog({ path, onConfirm, onCancel }: Props): React.JSX.Element {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const category = promptCategoryLabel(path)

  useEffect(() => {
    confirmButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => { window.removeEventListener("keydown", handleKeyDown) }
  }, [onCancel])

  return <div
    className="dialog-backdrop"
    role="presentation"
    data-testid="prompt-save-confirm-dialog"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}
  >
    <section
      className="work-name-prompt-dialog prompt-save-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-save-confirm-title"
    >
      <header>
        <span className="work-name-prompt-icon" aria-hidden="true"><Sparkles size={16} /></span>
        <div>
          <strong id="prompt-save-confirm-title">保存提示词</strong>
          <small>{category === undefined ? "全局提示词库" : `全局提示词库 · ${category}`} · {path}</small>
        </div>
      </header>
      <div className="work-name-prompt-body">
        <p>{PROMPT_SAVE_CONFIRM_MESSAGE}</p>
      </div>
      <footer>
        <button type="button" data-testid="prompt-save-cancel" onClick={onCancel}>取消</button>
        <button
          ref={confirmButtonRef}
          type="button"
          className="dialog-primary-command"
          data-testid="prompt-save-confirm"
          onClick={onConfirm}
        >
          保存并生效
        </button>
      </footer>
    </section>
  </div>
}
