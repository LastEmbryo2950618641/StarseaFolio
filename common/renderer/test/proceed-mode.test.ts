import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  loadCustomProceedGates,
  loadProceedMode,
  persistCustomProceedGates,
  persistProceedMode,
  PROCEED_MODE_OPTIONS,
} from "../src/features/editor/proceed-mode.js"

const MODE_KEY = "worldseed.creation-desk.proceed-mode"
const GATES_KEY = "worldseed.creation-desk.custom-proceed-gates"
const LEGACY_KEY = "worldseed.creation-desk.batch-proceed"

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string): string | null {
          return memory.get(key) ?? null
        },
        setItem(key: string, value: string): void {
          memory.set(key, value)
        },
        removeItem(key: string): void {
          memory.delete(key)
        },
      },
    },
  })
})

afterEach(() => {
  memory.clear()
})

describe("creation-desk proceed mode storage", () => {
  it("defaults to single when nothing stored", () => {
    expect(loadProceedMode()).toBe("single")
    expect(PROCEED_MODE_OPTIONS.some((option) => option.value === "single")).toBe(true)
  })

  it("migrates legacy batch-proceed true → batch and false → single", () => {
    window.localStorage.setItem(LEGACY_KEY, "1")
    expect(loadProceedMode()).toBe("batch")
    expect(window.localStorage.getItem(MODE_KEY)).toBe("batch")

    window.localStorage.removeItem(MODE_KEY)
    window.localStorage.setItem(LEGACY_KEY, "0")
    expect(loadProceedMode()).toBe("single")
  })

  it("persists mode and custom gates", () => {
    persistProceedMode("custom")
    expect(loadProceedMode()).toBe("custom")
    persistCustomProceedGates({
      chapter_requirements: true,
      synopsis_discuss: false,
      outline_discuss: true,
      draft_discuss: false,
      body_discuss: true,
    })
    expect(loadCustomProceedGates()).toEqual({
      chapter_requirements: true,
      synopsis_discuss: false,
      outline_discuss: true,
      draft_discuss: false,
      body_discuss: true,
    })
  })
})
