import { describe, expect, it } from "vitest"

import {
  defaultNetworkSettings,
  parseNetworkSettings,
} from "../src/index.js"

describe("network settings", () => {
  it("defaults to a 5-minute request timeout and 4 attempts", () => {
    expect(defaultNetworkSettings).toEqual({
      requestTimeoutMs: 300_000,
      maxAttempts: 4,
    })
  })

  it("accepts valid overrides and falls back on invalid input", () => {
    expect(parseNetworkSettings({
      requestTimeoutMs: 600_000,
      maxAttempts: 6,
    })).toEqual({
      requestTimeoutMs: 600_000,
      maxAttempts: 6,
    })
    expect(parseNetworkSettings({ requestTimeoutMs: 0, maxAttempts: 99 })).toEqual(defaultNetworkSettings)
    expect(parseNetworkSettings(undefined)).toEqual(defaultNetworkSettings)
  })
})
