import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { networkFetch } = vi.hoisted(() => ({ networkFetch: vi.fn() }))
vi.mock("electron", () => ({ net: { fetch: networkFetch }, app: {}, shell: {} }))

import { fetchUpdateManifest } from "../src/main/app-update.js"
import { cancelActiveUpdateDownload, startUpdateInstallerDownload } from "../src/main/app-update-download.js"

afterEach(() => { cancelActiveUpdateDownload(); vi.unstubAllGlobals(); vi.resetAllMocks() })

describe("update networking", () => {
  it("uses Electron networking for manifests so system proxy settings apply", async () => {
    const directFetch = vi.fn(() => { throw new Error("Direct connection unavailable") })
    vi.stubGlobal("fetch", directFetch)
    const manifest = { version: "0.0.1-24", buildNumber: "24", downloadUrl: "https://example.com/setup.exe" }
    networkFetch.mockResolvedValue(new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }))
    expect(await fetchUpdateManifest("https://example.com/latest.json")).toEqual(manifest)
    expect(directFetch).not.toHaveBeenCalled()
    expect(networkFetch).toHaveBeenCalledWith("https://example.com/latest.json", expect.objectContaining({ redirect: "follow" }))
    const requestOptions = networkFetch.mock.calls[0]?.[1] as RequestInit
    expect(requestOptions.signal).toBeInstanceOf(AbortSignal)
  })

  it("downloads installer bytes through the same network stack and reports completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "starseafolio-update-test-"))
    try {
      vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Direct connection unavailable") }))
      networkFetch.mockResolvedValue(new Response("installer bytes", { headers: { "Content-Length": "15" } }))
      const destinationPath = join(directory, "setup.exe")
      const onProgress = vi.fn()
      const handle = await startUpdateInstallerDownload({ downloadUrl: "https://example.com/setup.exe", destinationPath, onProgress })
      expect(await handle.done).toBe(destinationPath)
      expect(await readFile(destinationPath, "utf8")).toBe("installer bytes")
      expect(onProgress).toHaveBeenLastCalledWith({ receivedBytes: 15, totalBytes: 15, percent: 100 })
      expect(networkFetch).toHaveBeenCalledTimes(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("retains download cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "starseafolio-update-test-"))
    try {
      networkFetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => { reject(new Error("cancelled")) }, { once: true })
      }))
      const handle = await startUpdateInstallerDownload({ downloadUrl: "https://example.com/setup.exe", destinationPath: join(directory, "setup.exe"), onProgress: vi.fn() })
      const rejected = expect(handle.done).rejects.toThrow(/cancelled|aborted/iu)
      handle.cancel()
      await rejected
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
