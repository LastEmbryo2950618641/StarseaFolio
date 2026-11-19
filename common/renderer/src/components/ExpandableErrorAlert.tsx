import { useEffect, useState } from "react"
import { Copy, Maximize2, X } from "lucide-react"

type Props = Readonly<{
  message: string
  title?: string
  className?: string
  testId?: string
}>

export function ExpandableErrorAlert({
  message,
  title = "错误详情",
  className,
  testId,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("keydown", onKeyDown) }
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, 1600)
    return () => { window.clearTimeout(timer) }
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return <>
    <div
      role="alert"
      className={["expandable-error", className].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      <pre className="expandable-error-preview">{message}</pre>
      <button
        type="button"
        className="expandable-error-open"
        data-testid={testId === undefined ? undefined : `${testId}-open`}
        onClick={() => { setOpen(true) }}
      >
        <Maximize2 size={12} aria-hidden="true" />
        查看全文
      </button>
    </div>
    {open ? <div className="dialog-backdrop" role="presentation" data-testid={testId === undefined ? undefined : `${testId}-dialog`} onClick={() => { setOpen(false) }}>
      <section
        className="work-name-prompt-dialog expandable-error-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expandable-error-title"
        onClick={(event) => { event.stopPropagation() }}
      >
        <header>
          <div>
            <strong id="expandable-error-title">{title}</strong>
            <small>可滚动查看完整内容</small>
          </div>
          <button type="button" aria-label="关闭" onClick={() => { setOpen(false) }}><X size={16} /></button>
        </header>
        <div className="expandable-error-dialog-body">
          <pre>{message}</pre>
        </div>
        <footer>
          <button type="button" onClick={() => { void copy() }}>
            <Copy size={14} aria-hidden="true" />
            {copied ? "已复制" : "复制全文"}
          </button>
          <button type="button" className="dialog-primary-command" onClick={() => { setOpen(false) }}>关闭</button>
        </footer>
      </section>
    </div> : null}
  </>
}
