/**
 * @deprecated Use proceed-mode.ts. Kept so accidental imports still compile during migration.
 */
import { loadProceedMode, persistProceedMode } from "./proceed-mode.js"

/** @deprecated Prefer loadProceedMode(); true only when mode is batch. */
export function loadBatchProceedEnabled(): boolean {
  return loadProceedMode() === "batch"
}

/** @deprecated Prefer persistProceedMode(). */
export function persistBatchProceedEnabled(enabled: boolean): void {
  persistProceedMode(enabled ? "batch" : "single")
}
