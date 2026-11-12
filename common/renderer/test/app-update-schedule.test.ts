import { afterEach, describe, expect, it, vi } from "vitest"
import { scheduleAppUpdateChecks } from "../src/hooks/app-update-schedule.js"

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("app update scheduling", () => {
  it("checks at the remaining deadline and hourly thereafter, then cleans up", () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
    const check = vi.fn()
    const stop = scheduleAppUpdateChecks({ hours: 1, lastCheckedAtMs: Date.now() - 30 * 60_000, check })
    vi.advanceTimersByTime(30 * 60_000 - 1)
    expect(check).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(check).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60 * 60_000)
    expect(check).toHaveBeenCalledTimes(2)
    stop()
    window.dispatchEvent(new Event("online"))
    window.dispatchEvent(new Event("focus"))
    vi.advanceTimersByTime(60 * 60_000)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it("requests a due check when returning to the app or reconnecting", () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
    const check = vi.fn()
    const stop = scheduleAppUpdateChecks({ hours: 1, lastCheckedAtMs: Date.now(), check })
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    expect(check).toHaveBeenCalledTimes(2)
    stop()
  })

  it("leaves periodic checks disabled when the user disabled them", () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
    const check = vi.fn()
    const stop = scheduleAppUpdateChecks({ check })
    window.dispatchEvent(new Event("online"))
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(check).not.toHaveBeenCalled()
    stop()
  })
})
