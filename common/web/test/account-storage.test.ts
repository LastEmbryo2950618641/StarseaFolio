import { afterEach, describe, expect, it, vi } from "vitest"

import { scopeWebAccountStorage } from "../src/bridge/account-storage.js"

vi.mock("../src/bridge/session.js", () => ({
  loadWebSession: () => ({ apiBaseUrl: "https://backend.example", apiToken: "token", accountId: "aaaaaaaaaaaaaaaa" }),
}))

describe("web account browser storage", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it("isolates app preferences while leaving the login session readable", () => {
    const backing = new Map<string, string>()
    class MemoryStorage {
      get length(): number { return backing.size }
      key(index: number): string | null { return [...backing.keys()][index] ?? null }
      getItem(key: string): string | null { return backing.get(key) ?? null }
      setItem(key: string, value: string): void { backing.set(key, value) }
      removeItem(key: string): void { backing.delete(key) }
    }
    vi.stubGlobal("Storage", MemoryStorage)
    vi.stubGlobal("localStorage", new MemoryStorage())
    localStorage.setItem("worldseed.web.session.v1", "session")

    scopeWebAccountStorage()
    localStorage.setItem("theme", "pink")
    expect(localStorage.getItem("theme")).toBe("pink")
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).toEqual(["theme"])
    expect(localStorage.getItem("worldseed.web.session.v1")).toBe("session")

    const otherAccountKey = "worldseed.account-storage.v1.https%3A%2F%2Fbackend.example.bbbbbbbbbbbbbbbb.theme"
    backing.set(otherAccountKey, "blue")
    expect(localStorage.getItem("theme")).toBe("pink")
  })
})
