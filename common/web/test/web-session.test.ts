import { afterEach, describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION } from "@starseafolio/contracts"

import { installHttpWorldseedBridge } from "../src/bridge/http-worldseed.js"
import { clearWebSession, DEFAULT_BOOKS_ROOT, loadWebSession, saveWebSession } from "../src/bridge/session.js"

describe("web account session", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it("ignores a stored service token that is not tied to an account", () => {
    const memory = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    })
    localStorage.setItem("worldseed.web.session.v1", JSON.stringify({
      apiBaseUrl: "http://111.229.32.85/worldseed",
      apiToken: "shared-service-token",
    }))
    expect(loadWebSession()).toEqual({ apiBaseUrl: "http://111.229.32.85/worldseed", apiToken: "" })

    saveWebSession({
      apiBaseUrl: "http://111.229.32.85/worldseed/",
      apiToken: "account-session-token-value",
      accountId: "0123456789abcdef",
      accountName: "星海",
      avatarDataUrl: "data:image/png;base64,aaaa",
      booksRoot: "/var/lib/worldseed/books/accounts/0123456789abcdef",
    })
    expect(loadWebSession()).toMatchObject({
      apiBaseUrl: "http://111.229.32.85/worldseed",
      accountId: "0123456789abcdef",
      accountName: "星海",
      booksRoot: "/var/lib/worldseed/books/accounts/0123456789abcdef",
    })
    clearWebSession()
    expect(loadWebSession().apiToken).toBe("")
  })

  it("does not read or create shared books before login", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("fetch", vi.fn())
    const bridge = installHttpWorldseedBridge({ apiBaseUrl: "https://backend.example", apiToken: "" })
    const response = await bridge.invoke({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      method: "project.list",
      payload: {},
    })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.data).toEqual({ projects: [] })
    expect(fetch).not.toHaveBeenCalled()
    expect(bridge.defaultWorkDirectoryPath).toBe(`${DEFAULT_BOOKS_ROOT}/accounts/signed-out`)
    await expect(bridge.allocateBookPath()).rejects.toThrow("请先登录")
  })
})
