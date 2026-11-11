import { describe, expect, it } from "vitest"

import {
  compareSemver,
  isUpdateAvailable,
  parseUpdateManifest,
  shouldAutoCheck,
  type LocalAppIdentity,
  type UpdateManifest,
} from "../src/main/app-update.js"

const local: LocalAppIdentity = {
  productName: "星海余页 (StarseaFolio)",
  version: "0.1.0",
  buildNumber: "1",
}

describe("app update compare", () => {
  it("keeps detecting higher versions for legacy any_change preferences", () => {
    const sameBuildNewVersion: UpdateManifest = {
      version: "0.1.1",
      buildNumber: "1",
      downloadUrl: "https://example.com/setup.exe",
    }
    const sameVersionNewBuild: UpdateManifest = {
      version: "0.1.0",
      buildNumber: "2",
      downloadUrl: "https://example.com/setup.exe",
    }
    expect(isUpdateAvailable(local, sameBuildNewVersion, "any_change")).toBe(true)
    expect(isUpdateAvailable(local, sameVersionNewBuild, "any_change")).toBe(true)
    expect(isUpdateAvailable(local, {
      version: "0.1.0",
      buildNumber: "1",
      downloadUrl: "https://example.com/setup.exe",
    }, "any_change")).toBe(false)
  })

  it("accepts higher product or build versions and rejects downgrades", () => {
    expect(isUpdateAvailable(local, {
      version: "0.2.0",
      buildNumber: "1",
      downloadUrl: "https://example.com/setup.exe",
    }, "semver")).toBe(true)
    expect(isUpdateAvailable(local, {
      version: "0.1.0",
      buildNumber: "99",
      downloadUrl: "https://example.com/setup.exe",
    }, "semver")).toBe(true)
    expect(isUpdateAvailable(local, {
      version: "0.0.9",
      buildNumber: "99",
      downloadUrl: "https://example.com/setup.exe",
    }, "semver")).toBe(false)
  })

  it("orders the numeric 0.0.1-N release suffix and migrates legacy build identities", () => {
    const current: LocalAppIdentity = { ...local, version: "0.0.1-18", buildNumber: "18" }
    const manifest = (version: string, buildNumber = "18"): UpdateManifest => ({ version, buildNumber, downloadUrl: "https://example.com/setup.exe" })
    expect(isUpdateAvailable(current, manifest("0.0.1-19", "19"))).toBe(true)
    expect(isUpdateAvailable(current, manifest("0.0.1-9", "9"))).toBe(false)
    expect(isUpdateAvailable(current, manifest("0.0.1-18", "18"))).toBe(false)
    expect(isUpdateAvailable({ ...current, version: "0.0.1", buildNumber: "17" }, manifest("0.0.1-18", "18"))).toBe(true)
    expect(isUpdateAvailable(current, manifest("0.0.2", "1"))).toBe(true)
    for (const mode of ["any_change", "semver"] as const) {
      expect(isUpdateAvailable(current, manifest("0.0.1", "17"), mode)).toBe(false)
      expect(isUpdateAvailable(current, manifest("0.0.1-17", "17"), mode)).toBe(false)
      expect(isUpdateAvailable({ ...current, version: "0.0.1-9", buildNumber: "9" }, manifest("0.0.1-10", "10"), mode)).toBe(true)
      expect(isUpdateAvailable(current, manifest("unknown", "999"), mode)).toBe(false)
    }
    expect(compareSemver("0.0.1-10", "0.0.1-9")).toBeGreaterThan(0)
  })

  it("compares semver numbers", () => {
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0)
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0)
    expect(compareSemver("0.1.0", "0.1.1")).toBeLessThan(0)
  })

  it("parses update manifests", () => {
    expect(parseUpdateManifest({
      version: "0.1.1",
      buildNumber: 12,
      downloadUrl: "https://example.com/Starsea-Folio-0.1.1-Setup.exe",
      productName: "星海余页 (StarseaFolio)",
    })).toEqual({
      version: "0.1.1",
      buildNumber: "12",
      downloadUrl: "https://example.com/Starsea-Folio-0.1.1-Setup.exe",
      productName: "星海余页 (StarseaFolio)",
    })
  })

  it("gates auto checks by interval", () => {
    const now = 1_000_000
    expect(shouldAutoCheck({ updateUrl: "https://example.com/latest.json" }, now)).toBe(false)
    expect(shouldAutoCheck({
      updateUrl: "https://example.com/latest.json",
      checkIntervalHours: 24,
    }, now)).toBe(true)
    expect(shouldAutoCheck({
      updateUrl: "https://example.com/latest.json",
      checkIntervalHours: 1,
      lastCheckedAtMs: now - 30 * 60 * 1000,
    }, now)).toBe(false)
    expect(shouldAutoCheck({
      updateUrl: "https://example.com/latest.json",
      checkIntervalHours: 1,
      lastCheckedAtMs: now - 2 * 60 * 60 * 1000,
    }, now)).toBe(true)
  })
})
