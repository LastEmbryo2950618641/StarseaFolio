import type { SynopsisConversationTodo } from "@starseafolio/contracts"

export const TODO_NO_PROGRESS_LIMIT = 3
const TODO_CONSECUTIVE_LIMIT = 8

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

export function shouldIssueTodoLoopRepair(noProgressStreak: number, repairAlreadyIssued: boolean, consecutiveWrites = 0): boolean {
  return (noProgressStreak >= TODO_NO_PROGRESS_LIMIT || consecutiveWrites >= TODO_CONSECUTIVE_LIMIT) && !repairAlreadyIssued
}

export function shouldStopTodoWriteLoop(noProgressStreak: number, repairAlreadyIssued: boolean, consecutiveWrites = 0): boolean {
  return (noProgressStreak >= TODO_NO_PROGRESS_LIMIT || consecutiveWrites > TODO_CONSECUTIVE_LIMIT) && repairAlreadyIssued
}

export function shouldAllowDiscussBudgetGrace(remainingCalls: number, graceAlreadyUsed: boolean): boolean {
  return remainingCalls <= 0 && !graceAlreadyUsed
}
