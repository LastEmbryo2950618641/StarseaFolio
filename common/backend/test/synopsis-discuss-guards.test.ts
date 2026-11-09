import { describe, expect, it } from "vitest"

import {
  advanceTodoNoProgressStreak,
  discussTodoFingerprint,
  shouldAllowDiscussBudgetGrace,
  shouldIssueTodoLoopRepair,
  shouldStopTodoWriteLoop,
  TODO_NO_PROGRESS_LIMIT,
} from "../src/application/chapters/synopsis-discuss-guards.js"

describe("synopsis discuss runtime guards", () => {
  it("detects todo status or content progress but ignores object identity", () => {
    const before = [{ id: "write", content: "写入梗概", status: "in_progress" as const }]
    const unchanged = [{ ...before[0] }]
    const progressed = [{ ...before[0], status: "completed" as const }]

    expect(discussTodoFingerprint(before)).toBe(discussTodoFingerprint(unchanged))
    expect(discussTodoFingerprint(before)).not.toBe(discussTodoFingerprint(progressed))
    expect(advanceTodoNoProgressStreak(2, before, unchanged)).toBe(3)
    expect(advanceTodoNoProgressStreak(2, before, progressed)).toBe(0)
  })

  it("requests one repair at the no-progress threshold and stops repeated todo calls after repair", () => {
    expect(TODO_NO_PROGRESS_LIMIT).toBe(3)
    expect(shouldIssueTodoLoopRepair(TODO_NO_PROGRESS_LIMIT - 1, false)).toBe(false)
    expect(shouldIssueTodoLoopRepair(TODO_NO_PROGRESS_LIMIT, false)).toBe(true)
    expect(shouldIssueTodoLoopRepair(TODO_NO_PROGRESS_LIMIT, true)).toBe(false)
    expect(shouldStopTodoWriteLoop(TODO_NO_PROGRESS_LIMIT, false)).toBe(false)
    expect(shouldStopTodoWriteLoop(TODO_NO_PROGRESS_LIMIT, true)).toBe(true)
    expect(shouldIssueTodoLoopRepair(0, false, 8)).toBe(true)
    expect(shouldStopTodoWriteLoop(0, true, 9)).toBe(true)
  })

  it("allows the discuss model budget grace only once", () => {
    expect(shouldAllowDiscussBudgetGrace(1, false)).toBe(false)
    expect(shouldAllowDiscussBudgetGrace(0, false)).toBe(true)
    expect(shouldAllowDiscussBudgetGrace(0, true)).toBe(false)
    expect(shouldAllowDiscussBudgetGrace(-1, true)).toBe(false)
  })
})
