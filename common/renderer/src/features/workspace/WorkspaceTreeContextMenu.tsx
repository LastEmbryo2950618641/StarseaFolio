import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Check, Copy } from "lucide-react"

type CopyStatus = "idle" | "copied" | "failed"

type Props = Readonly<{
  x: number
  y: number
  absolutePath: string
  onClose: () => void
}>

const EDGE_MARGIN = 8
const COPIED_CLOSE_DELAY_MS = 800

/** 工作目录树的行右键菜单；目前只有「复制绝对路径」，后续动作按 items 扩展。 */
export function WorkspaceTreeContextMenu({ x, y, absolutePath, onClose }: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState<CopyStatus>("idle")
  const [position, setPosition] = useState<Readonly<{ left: number; top: number }> | undefined>(undefined)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    setPosition({
      left: Math.min(Math.max(EDGE_MARGIN, x), Math.max(EDGE_MARGIN, window.innerWidth - menu.offsetWidth - EDGE_MARGIN)),
      top: Math.min(Math.max(EDGE_MARGIN, y), Math.max(EDGE_MARGIN, window.innerHeight - menu.offsetHeight - EDGE_MARGIN)),
    })
    menu.querySelector<HTMLButtonElement>("button")?.focus()
  }, [x, y])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node) === true) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    const handleClose = (): void => { onClose() }
    window.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleClose)
    window.addEventListener("blur", handleClose)
    window.addEventListener("scroll", handleClose, true)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleClose)
      window.removeEventListener("blur", handleClose)
      window.removeEventListener("scroll", handleClose, true)
    }
  }, [onClose])

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
  }, [])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(absolutePath)
      setStatus("copied")
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = window.setTimeout(() => { onClose() }, COPIED_CLOSE_DELAY_MS)
    } catch {
      setStatus("failed")
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      aria-label="文件操作"
      style={{
        left: position?.left ?? x,
        top: position?.top ?? y,
        visibility: position === undefined ? "hidden" : "visible",
      }}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      <button
        type="button"
        role="menuitem"
        className={`tree-context-menu-item${status === "failed" ? " is-failed" : ""}`}
        onClick={() => { void copy() }}
      >
        {status === "copied"
          ? <Check size={14} aria-hidden="true" />
          : status === "failed"
            ? <AlertTriangle size={14} aria-hidden="true" />
            : <Copy size={14} aria-hidden="true" />}
        <span>{status === "copied" ? "已复制" : status === "failed" ? "复制失败" : "复制绝对路径"}</span>
      </button>
    </div>,
    document.body,
  )
}
