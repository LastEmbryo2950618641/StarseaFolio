import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_CREATION_DESK_PRESENTATION,
  mapAiCreationDeskSettings,
  loadCreationDeskPresentationPreferences,
  reconcileSelectedRulePath,
} from "../src/renderer/src/features/editor/creation-desk-presentation-preferences.js"

const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const STORAGE_KEY = `worldseed.creationDeskPresentation.${PROJECT_ID}`

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
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  })
})

afterEach(() => {
  memory.clear()
})

describe("creation desk presentation preferences", () => {
  it("maps AI setting updates into the same editable controls", () => {
    expect(mapAiCreationDeskSettings({
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
      descriptionRulePath: "表现输出/描写规则/自动.md",
      proseStyleRulePath: "表现输出/笔风规则/网文白话.md",
      minimumWordCount: 2500,
      maximumWordCount: 3500,
      boundaryPace: "hold_without_resolution",
      causalityFocus: "action",
    }, ["表现输出/笔风规则/不存在.md"])).toEqual({
      patch: {
        novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
        novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
        descriptionRule: "",
        proseRule: "表现输出/笔风规则/网文白话.md",
        minimumWordCount: "2500",
        maximumWordCount: "3500",
        boundaryPace: "hold_without_resolution",
        causalityFocus: "action",
      },
      rejectedRulePaths: ["表现输出/笔风规则/不存在.md"],
    })
  })

  it("restores word counts saved as numbers instead of falling back to 2000–3000", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      descriptionRule: "",
      proseRule: "表现输出/笔风规则/虚渊玄风格.md",
      novelMajorCategoryRulePath: "表现输出/小说大类规则/爽文.md",
      novelSubcategoryRulePath: "表现输出/小说次大类规则/飞卢.md",
      minimumWordCount: 10000,
      maximumWordCount: 20000,
      boundaryPace: "advance_allowed",
      causalityFocus: "auto",
    }))
    const loaded = loadCreationDeskPresentationPreferences(PROJECT_ID)
    expect(loaded.minimumWordCount).toBe("10000")
    expect(loaded.maximumWordCount).toBe("20000")
    expect(loaded.proseRule).toBe("表现输出/笔风规则/虚渊玄风格.md")
    expect(loaded.novelMajorCategoryRulePath).toBe("表现输出/小说大类规则/爽文.md")
    expect(loaded.novelSubcategoryRulePath).toBe("表现输出/小说次大类规则/飞卢.md")
    expect(loaded).not.toEqual(DEFAULT_CREATION_DESK_PRESENTATION)
  })

  it("does not clear a saved 笔风 while the rule list is still empty", () => {
    expect(reconcileSelectedRulePath(
      "表现输出/笔风规则/虚渊玄风格.md",
      [],
    )).toBeUndefined()
  })

  it("clears a saved 笔风 only after the list is loaded and the file is gone", () => {
    expect(reconcileSelectedRulePath(
      "表现输出/笔风规则/虚渊玄风格.md",
      ["表现输出/笔风规则/克制叙述.md"],
    )).toBe("")
    expect(reconcileSelectedRulePath(
      "表现输出/笔风规则/虚渊玄风格.md",
      ["表现输出/笔风规则/虚渊玄风格.md", "表现输出/笔风规则/克制叙述.md"],
    )).toBeUndefined()
  })
})
