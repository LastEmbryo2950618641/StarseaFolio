export function isGraphReferenceRepairExhaustedError(message: string | undefined): boolean {
  return typeof message === "string"
    && message.includes("Graph references must be owner IDs read in this turn")
}
