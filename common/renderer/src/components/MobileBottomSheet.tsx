import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

const query = "(max-width: 900px)"
const subscribe = (notify: () => void): (() => void) => {
  const media = window.matchMedia(query)
  media.addEventListener("change", notify)
  return () => { media.removeEventListener("change", notify) }
}
export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

export function MobileBottomSheet(props: Readonly<{
  title: string
  name: string
  children: ReactNode
  onClose(): void
}>): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  const startY = useRef<number | undefined>(undefined)
  const [drag, setDrag] = useState(0)
  const [closing, setClosing] = useState(false)
  const close = (): void => { setClosing(true) }

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => { onCloseRef.current() }, 180)
    return () => { window.clearTimeout(timer) }
  }, [closing])

  useEffect(() => {
    const previousFocus = document.activeElement
    const root = document.getElementById("root")
    const previousInert = root?.inert ?? false
    if (root !== null) root.inert = true
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); setClosing(true); return }
      if (event.key !== "Tab") return
      const controls = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']")
      if (controls === undefined || controls.length === 0) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      if (root !== null) root.inert = previousInert
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return createPortal(<div className={`mobile-sheet-overlay${closing ? " is-closing" : ""}`} data-mobile-sheet={props.name}>
    <button type="button" className="mobile-sheet-backdrop" aria-label={`关闭${props.title}面板`} tabIndex={-1} onClick={close} />
    <section ref={panelRef} className="mobile-bottom-sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1}
      style={drag > 0 && !closing ? { transform: `translateY(${String(drag)}px)`, animation: "none" } : undefined}>
      <header className="mobile-sheet-header"
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button") !== null) return
          startY.current = event.clientY
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => { if (startY.current !== undefined) setDrag(Math.max(0, event.clientY - startY.current)) }}
        onPointerUp={(event) => {
          if (startY.current !== undefined && event.clientY - startY.current > 80) close()
          startY.current = undefined
          setDrag(0)
        }}
        onPointerCancel={() => { startY.current = undefined; setDrag(0) }}>
        <span className="mobile-sheet-grip" aria-hidden="true" />
        <strong>{props.title}</strong>
        <button type="button" aria-label={`关闭 ${props.title}`} onClick={close}><X size={20} /></button>
      </header>
      <div className="mobile-sheet-content">{props.children}</div>
    </section>
  </div>, document.body)
}
