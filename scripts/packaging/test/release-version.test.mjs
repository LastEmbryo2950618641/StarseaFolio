import { describe, expect, it } from "vitest"
import { windowsBuildIdentity, nextReleaseBuild } from "../release-version.mjs"

describe("Windows release identities", () => {
  it("keeps display, installer and Windows file versions aligned", () => {
    expect(windowsBuildIdentity("0.0.1", 18)).toEqual({ baseVersion: "0.0.1", version: "0.0.1-18", buildNumber: "18", windowsVersion: "0.0.1.18" })
  })
  it("continues from legacy releases, drafts, reruns and the workflow counter", () => {
    const releases = [{ tag_name: "v0.0.1", name: "StarseaFolio 0.0.1 (build 17)" }, { tag_name: "v0.0.1-19", draft: true }]
    expect(nextReleaseBuild(18, releases)).toBe(20)
    expect(nextReleaseBuild(21, releases)).toBe(21)
    expect(nextReleaseBuild(18, [{ tag_name: "v0.0.1-20" }, ...releases])).toBe(21)
  })
  it("rejects invalid build identities before packaging", () => {
    for (const build of [0, -1, "x", "1.2", 65536]) expect(() => windowsBuildIdentity("0.0.1", build)).toThrow()
    expect(() => windowsBuildIdentity("0.0.1-1", 2)).toThrow()
  })
})
