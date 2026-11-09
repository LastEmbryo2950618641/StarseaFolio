import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { COVER_OUTPUT_SIZE, ImageCropDialog, coverBaseScale } from "../src/features/projects/ImageCropDialog.js"

describe("ImageCropDialog", () => {
  it("uses a cover scale that fills the fixed 3:4 crop stage", () => {
    expect(coverBaseScale({ width: 1600, height: 900 }, { width: 360, height: 480 })).toBeCloseTo(0.5333, 3)
    expect(coverBaseScale({ width: 600, height: 1000 }, { width: 360, height: 480 })).toBeCloseTo(0.6, 3)
    expect(COVER_OUTPUT_SIZE).toEqual({ width: 600, height: 800 })
  })

  it("renders the crop controls and fixed output description", () => {
    const html = renderToStaticMarkup(React.createElement(ImageCropDialog, {
      src: "data:image/png;base64,AA==",
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }))

    expect(html).toContain("image-crop-dialog")
    expect(html).toContain("固定比例 3:4")
    expect(html).toContain("600 × 800")
    expect(html).toContain("封面缩放")
    expect(html).toContain("image-crop-confirm")
  })
})
