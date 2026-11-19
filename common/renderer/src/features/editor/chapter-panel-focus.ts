/** Scroll-focus falloff: center of the panel is brightest/largest; edges gather softer. */
export function chapterPanelFocusFromDistance(
  distancePx: number,
  halfViewportPx: number,
): Readonly<{ scale: number; opacity: number }> {
  const span = Math.max(1, halfViewportPx)
  const falloff = Math.min(1, Math.abs(distancePx) / span) ** 2
  return {
    scale: Number((1.07 - falloff * 0.2).toFixed(4)),
    opacity: Number((1 - falloff * 0.45).toFixed(4)),
  }
}
