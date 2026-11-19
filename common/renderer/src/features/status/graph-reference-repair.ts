const GRAPH_REFERENCE_ERROR_MARKER = "Graph references must be owner IDs read in this turn"

export function isGraphReferenceRepairExhaustedError(message: string | undefined): boolean {
  return typeof message === "string" && message.includes(GRAPH_REFERENCE_ERROR_MARKER)
}

/** Pull human-readable illegal labels out of the phase-contract error text. */
export function parseInvalidGraphReferenceLabels(message: string): readonly string[] {
  const markerWithColon = `${GRAPH_REFERENCE_ERROR_MARKER}:`
  const index = message.indexOf(markerWithColon)
  if (index < 0) return []
  return message
    .slice(index + markerWithColon.length)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
