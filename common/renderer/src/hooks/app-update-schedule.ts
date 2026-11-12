/** The main process gates wake-up checks against the saved interval. */
export function scheduleAppUpdateChecks(input: Readonly<{
  hours?: number
  lastCheckedAtMs?: number
  check(): void
}>): () => void {
  if (input.hours === undefined) return () => undefined
  const intervalMs = Math.max(1, input.hours) * 60 * 60_000
  const now = Date.now()
  const elapsed = input.lastCheckedAtMs === undefined ? intervalMs : now - input.lastCheckedAtMs
  const delay = elapsed < 0 ? 0 : Math.max(0, intervalMs - elapsed)
  let stopped = false
  let timer: number
  const tick = (): void => {
    if (stopped) return
    input.check()
    timer = window.setTimeout(tick, intervalMs)
  }
  timer = window.setTimeout(tick, delay)
  window.addEventListener("focus", input.check)
  window.addEventListener("online", input.check)
  return () => {
    stopped = true
    window.clearTimeout(timer)
    window.removeEventListener("focus", input.check)
    window.removeEventListener("online", input.check)
  }
}
