/// <reference types="vite/client" />

import type { WorldseedBridge } from "@starseafolio/contracts"

declare global {
  interface Window {
    worldseed?: WorldseedBridge
  }
}

export {}
