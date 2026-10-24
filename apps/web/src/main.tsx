import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installHttpWorldseedBridge } from "./bridge/http-worldseed.js"
import { loadWebSession } from "./bridge/session.js"
import "./styles/mobile.css"

async function boot(): Promise<void> {
  const session = loadWebSession()
  // Must install before any renderer modules evaluate (they snapshot window.worldseed).
  installHttpWorldseedBridge(session)

  await import("@renderer/monaco.js")
  await import("@renderer/styles/global.css")
  const { App } = await import("@renderer/app/App.js")

  const root = document.getElementById("root")
  if (root === null) throw new Error("Web root is missing")

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
