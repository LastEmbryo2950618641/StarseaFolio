import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const rendererSrc = path.resolve(rootDir, "../renderer/src")

const base = process.env.STARSEA_WEB_BASE ?? "/"

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": rendererSrc,
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    include: ["monaco-editor", "@monaco-editor/react"],
  },
})
