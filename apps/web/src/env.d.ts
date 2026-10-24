/// <reference types="vite/client" />

import type { WorldseedBridge } from "../../desktop/src/preload/worldseed-bridge.js"

declare global {
  interface Window {
    worldseed?: WorldseedBridge
  }
}

export {}
