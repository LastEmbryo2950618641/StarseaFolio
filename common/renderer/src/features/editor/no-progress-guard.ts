const ENABLED_KEY = "worldseed.creation-desk.no-progress-guard-enabled"
const LIMIT_KEY = "worldseed.creation-desk.no-progress-guard-limit"

export const DEFAULT_NO_PROGRESS_GUARD_ENABLED = false
export const DEFAULT_NO_PROGRESS_GUARD_LIMIT = 3
export const MIN_NO_PROGRESS_GUARD_LIMIT = 1
export const MAX_NO_PROGRESS_GUARD_LIMIT = 30

export type NoProgressGuardPrefs = Readonly<{
  enabled: boolean
  limit: number
}>

export function clampNoProgressGuardLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NO_PROGRESS_GUARD_LIMIT
  return Math.min(MAX_NO_PROGRESS_GUARD_LIMIT, Math.max(MIN_NO_PROGRESS_GUARD_LIMIT, Math.trunc(value)))
}

export function loadNoProgressGuardPrefs(): NoProgressGuardPrefs {
  try {
    const enabledRaw = window.localStorage.getItem(ENABLED_KEY)
    const enabled = enabledRaw === null
      ? DEFAULT_NO_PROGRESS_GUARD_ENABLED
      : enabledRaw !== "0" && enabledRaw !== "false"
    const limitRaw = window.localStorage.getItem(LIMIT_KEY)
    const parsed = limitRaw === null ? DEFAULT_NO_PROGRESS_GUARD_LIMIT : Number(limitRaw)
    return {
      enabled,
      limit: clampNoProgressGuardLimit(parsed),
    }
  } catch {
    return {
      enabled: DEFAULT_NO_PROGRESS_GUARD_ENABLED,
      limit: DEFAULT_NO_PROGRESS_GUARD_LIMIT,
    }
  }
}

export function persistNoProgressGuardPrefs(prefs: NoProgressGuardPrefs): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, prefs.enabled ? "1" : "0")
    window.localStorage.setItem(LIMIT_KEY, String(clampNoProgressGuardLimit(prefs.limit)))
  } catch {
    // ignore
  }
}
