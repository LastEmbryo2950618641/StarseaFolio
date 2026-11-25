export function taggedVolumeFixture(artifact: Record<string, unknown>): Record<string, unknown> {
  if (artifact.toolRequest !== undefined) return artifact
  const synopsis = artifact.volumeSynopsis as { markdown: string } | undefined
  const outline = artifact.arcPlan as { markdown: string } | undefined
  const meta = artifact.volumePlanMeta as { targetChapterCount: number; targetWordCount: number } | undefined
  const settings = artifact.creationDeskSettings as Record<string, string | number> | undefined
  const blocks = [String(artifact.assistantMessage ?? "")]
  if (synopsis) blocks.push(`<compose-volume-synopsis>\n${synopsis.markdown.trim()}\n</compose-volume-synopsis>`)
  if (outline) blocks.push(`<compose-volume-outline>\n${outline.markdown.trim()}\n</compose-volume-outline>`)
  if (meta) blocks.push(`<compose-volume-meta>\ntargetChapterCount: ${meta.targetChapterCount}\ntargetWordCount: ${meta.targetWordCount}\n</compose-volume-meta>`)
  if (settings) blocks.push(`<writing-settings>\n${Object.entries(settings).map(([key, value]) => `${key}: ${value}`).join("\n")}\n</writing-settings>`)
  if (artifact.continueTurn === true) blocks.push("<continue-turn/>")
  return { assistantMessage: blocks.join("\n\n") }
}
