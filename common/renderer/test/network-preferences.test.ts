import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_NETWORK_SETTINGS,
  loadNetworkPreferences,
  saveNetworkPreferences,
} from "../src/features/settings/network-preferences.js"

const STORAGE_KEY = "worldseed.networkPreferences.v1"

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  const localStorage = {
    getItem(key: string): string | null {
      return memory.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      memory.set(key, value)
    },
    removeItem(key: string): void {
      memory.delete(key)
    },
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  })
})

afterEach(() => {
  memory.clear()
})

describe("network preferences", () => {
  it("loads defaults when storage is empty", () => {
    expect(loadNetworkPreferences()).toEqual(DEFAULT_NETWORK_SETTINGS)
  })

  it("round-trips timeout and retry settings", () => {
    const saved = saveNetworkPreferences({
      requestTimeoutMs: 600_000,
      maxAttempts: 6,
    })
    expect(saved).toEqual({ requestTimeoutMs: 600_000, maxAttempts: 6 })
    expect(loadNetworkPreferences()).toEqual(saved)
  })
})
