import "./polyfill-random-uuid.js"
import { StrictMode, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installHttpWorldseedBridge } from "./bridge/http-worldseed.js"
import { loadWebSession } from "./bridge/session.js"

const mobileViewport = window.matchMedia("(max-width: 900px)")
const subscribeViewport = (notify: () => void): (() => void) => {
  mobileViewport.addEventListener("change", notify)
  return () => { mobileViewport.removeEventListener("change", notify) }
}

async function boot(): Promise<void> {
  const session = loadWebSession()
  // Must install before any renderer modules evaluate (they snapshot window.worldseed).
  installHttpWorldseedBridge(session)

  await import("@renderer/monaco.js")
  await import("@renderer/styles/global.css")
  await import("./styles/mobile.css")
  const { App } = await import("@renderer/app/App.js")
  function WebWorkbench(): React.JSX.Element {
    const mobileLayout = useSyncExternalStore(subscribeViewport, () => mobileViewport.matches)
    return <App mobileLayout={mobileLayout} />
  }

  const root = document.getElementById("root")
  if (root === null) throw new Error("Web root is missing")

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <WebWorkbench />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
