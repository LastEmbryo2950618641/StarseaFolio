import type { SynopsisConversationTodo } from "@starseafolio/contracts"

import { DISCUSS_STEP_FAILURE_LIMIT } from "./discuss-session-context.js"

export const TODO_NO_PROGRESS_LIMIT = DISCUSS_STEP_FAILURE_LIMIT
const TODO_CONSECUTIVE_LIMIT = 8

/** Shared with UI「空转停跑保护」: clamp 1–30, default DISCUSS_STEP_FAILURE_LIMIT. */
export function resolveDiscussNoProgressGuardLimit(limit: number | undefined): number {
  return Number.isSafeInteger(limit) && (limit as number) >= 1 && (limit as number) <= 30
    ? (limit as number)
    : DISCUSS_STEP_FAILURE_LIMIT
}

export function discussTodoFingerprint(todos: readonly SynopsisConversationTodo[]): string {
  return JSON.stringify(todos.map(({ id, content, status }) => ({ id, content, status })))
}

export function advanceTodoNoProgressStreak(
  currentStreak: number,
  before: readonly SynopsisConversationTodo[],
  after: readonly SynopsisConversationTodo[],
): number {
  return discussTodoFingerprint(before) === discussTodoFingerprint(after)
    ? currentStreak + 1
    : 0
}

export function shouldIssueTodoLoopRepair(
  noProgressStreak: number,
  repairAlreadyIssued: boolean,
  consecutiveWrites = 0,
  unchangedLimit = TODO_NO_PROGRESS_LIMIT,
): boolean {
  return (noProgressStreak >= unchangedLimit || consecutiveWrites >= TODO_CONSECUTIVE_LIMIT) && !repairAlreadyIssued
}

export function shouldStopTodoWriteLoop(
  noProgressStreak: number,
  repairAlreadyIssued: boolean,
  consecutiveWrites = 0,
  unchangedLimit = TODO_NO_PROGRESS_LIMIT,
): boolean {
  return (noProgressStreak >= unchangedLimit || consecutiveWrites > TODO_CONSECUTIVE_LIMIT) && repairAlreadyIssued
}

export function shouldAllowDiscussBudgetGrace(remainingCalls: number, graceAlreadyUsed: boolean): boolean {
  return remainingCalls <= 0 && !graceAlreadyUsed
}
