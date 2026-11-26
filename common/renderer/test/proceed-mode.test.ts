import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  displayGateAuto,
  displayStageForProceedStage,
  loadProceedMode,
  persistProceedMode,
  PROCEED_DISPLAY_STAGE_LABELS,
  PROCEED_MODE_OPTIONS,
} from "../src/features/editor/proceed-mode.js"

const MODE_KEY = "worldseed.creation-desk.proceed-mode"
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
  it("defaults to precise when nothing stored", () => {
    expect(loadProceedMode()).toBe("precise")
    expect(PROCEED_MODE_OPTIONS.map((option) => option.value)).toEqual(["precise", "batch"])
  })

  it("migrates legacy batch-proceed true → batch and false → precise", () => {
    window.localStorage.setItem(LEGACY_KEY, "1")
    expect(loadProceedMode()).toBe("batch")
    expect(window.localStorage.getItem(MODE_KEY)).toBe("batch")

    window.localStorage.removeItem(MODE_KEY)
    window.localStorage.setItem(LEGACY_KEY, "0")
    expect(loadProceedMode()).toBe("precise")
  })

  it.each(["single", "custom"])("migrates the old %s mode to precise", (mode) => {
    memory.set(MODE_KEY, mode)
    expect(loadProceedMode()).toBe("precise")
    expect(memory.get(MODE_KEY)).toBe("precise")
    persistProceedMode("batch")
    expect(loadProceedMode()).toBe("batch")
  })

  it("merges synopsis, outline and draft into one 构思 display gate", () => {
    expect(displayStageForProceedStage("synopsis_discuss")).toBe("compose_discuss")
    expect(displayStageForProceedStage("outline_discuss")).toBe("compose_discuss")
    expect(displayStageForProceedStage("draft_discuss")).toBe("body_discuss")
    expect(PROCEED_DISPLAY_STAGE_LABELS.compose_discuss).toBe("构思")
    expect(PROCEED_MODE_OPTIONS.find((option) => option.value === "precise")?.hint).toContain("草稿")
  })

  it("marks the compose gate as automatic in batch only", () => {
    expect(displayGateAuto({ stage: "compose_discuss", mode: "precise" })).toBe(false)
    expect(displayGateAuto({ stage: "compose_discuss", mode: "batch" })).toBe(true)
  })
})
