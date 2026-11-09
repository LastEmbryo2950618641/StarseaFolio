import { useEffect, useRef, type ReactNode } from "react"

import { AppChrome } from "../../components/AppChrome.js"
import { useWorkbenchStore } from "../../state/workbench-store.js"

/** Keep the workbench mounted so page navigation preserves unsent text and open files. */
export function WorkbenchPages({ children, settings }: Readonly<{
  children: ReactNode
  settings: ReactNode
}>): React.JSX.Element {
  const settingsActive = useWorkbenchStore((state) => state.modelDialogOpen || state.projectSettingsOpen)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!settingsActive && returnFocus.current?.isConnected) returnFocus.current.focus()
  }, [settingsActive])

  return <div className="workbench-pages" data-screen={settingsActive ? "settings" : "workbench"}>
    <div className="workbench-screen" hidden={settingsActive} inert={settingsActive}
      onFocusCapture={(event) => { returnFocus.current = event.target }}>
      {children}
    </div>
    {settingsActive ? <div className="settings-screen"><AppChrome windowControlsOnly>{settings}</AppChrome></div> : null}
  </div>
}
