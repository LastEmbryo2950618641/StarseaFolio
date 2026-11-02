import { describe, expect, it } from "vitest"

import {
  incrementVolumePlanningWriteCount,
  parseVolumePlanningState,
  serializeVolumePlanningState,
  volumePlanningGateReady,
} from "../src/application/chapters/volume-planning-gate.js"

describe("volume planning first-write gate", () => {
  it("stays blocked until targets, synopsis and outline have recorded first writes", () => {
    expect(volumePlanningGateReady(undefined)).toBe(false)
    const state = {
      volumeFolderName: "第一卷 A",
      startSequence: 1,
      targetChapterCount: 8,
      targetWordCount: 24000,
      synopsisWriteCount: 1,
      outlineWriteCount: 0,
    }
    expect(volumePlanningGateReady(state)).toBe(false)
    expect(volumePlanningGateReady({ ...state, outlineWriteCount: 1 })).toBe(true)
  })

  it("increments only the successfully written planning artifact and round-trips persisted state", () => {
    const initial = {
      volumeFolderName: "第一卷 A",
      startSequence: 1,
      targetChapterCount: 8,
      targetWordCount: 24000,
      synopsisWriteCount: 0,
      outlineWriteCount: 0,
    }
    const synopsisWritten = incrementVolumePlanningWriteCount(initial, "synopsis")
    const ready = incrementVolumePlanningWriteCount(synopsisWritten, "outline")
    expect(synopsisWritten.synopsisWriteCount).toBe(1)
    expect(synopsisWritten.outlineWriteCount).toBe(0)
    expect(parseVolumePlanningState(serializeVolumePlanningState(ready))).toEqual(ready)
    expect(volumePlanningGateReady(ready)).toBe(true)
  })
})
