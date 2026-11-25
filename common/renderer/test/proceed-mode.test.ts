import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  displayGateAuto,
  displayStageForProceedStage,
  loadCustomProceedGates,
  loadProceedMode,
  persistCustomProceedGates,
  persistProceedMode,
  PROCEED_DISPLAY_STAGE_LABELS,
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

  it("merges synopsis, outline and draft into one 构思 display gate", () => {
    expect(displayStageForProceedStage("synopsis_discuss")).toBe("compose_discuss")
    expect(displayStageForProceedStage("outline_discuss")).toBe("compose_discuss")
    expect(displayStageForProceedStage("draft_discuss")).toBe("body_discuss")
    expect(PROCEED_DISPLAY_STAGE_LABELS.compose_discuss).toBe("构思")
    expect(PROCEED_MODE_OPTIONS.find((option) => option.value === "precise")?.hint).toContain("草稿")
    expect(PROCEED_MODE_OPTIONS.find((option) => option.value === "single")?.hint).toContain("草稿")
    expect(PROCEED_MODE_OPTIONS.find((option) => option.value === "custom")?.hint).toContain("三个节点")
  })

  it("auto-advances the merged compose gate only when all three materials are automatic", () => {
    expect(displayGateAuto({ stage: "compose_discuss", mode: "single" })).toBe(true)
    expect(displayGateAuto({ stage: "compose_discuss", mode: "precise" })).toBe(false)
    expect(displayGateAuto({ stage: "compose_discuss", mode: "batch" })).toBe(true)
    const base = {
      chapter_requirements: true,
      synopsis_discuss: true,
      outline_discuss: true,
      draft_discuss: true,
      body_discuss: false,
    }
    expect(displayGateAuto({ stage: "compose_discuss", mode: "custom", customGates: base })).toBe(true)
    expect(displayGateAuto({
      stage: "compose_discuss", mode: "custom",
      customGates: { ...base, draft_discuss: false },
    })).toBe(false)
  })
})
