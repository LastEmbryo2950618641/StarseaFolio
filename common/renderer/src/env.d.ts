/// <reference types="vite/client" />

import type { WorldseedBridge } from "@worldseed/contracts"

declare global {
  interface Window {
    worldseed?: WorldseedBridge
  }
}

export {}
