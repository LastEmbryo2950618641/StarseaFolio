export type VolumePlanningState = Readonly<{
  volumeFolderName: string
  startSequence: number
  targetChapterCount: number
  targetWordCount: number
  synopsisWriteCount: number
  outlineWriteCount: number
  notes?: string
}>

export function volumePlanningGateReady(state: VolumePlanningState | undefined): boolean {
  return state !== undefined
    && Number.isInteger(state.targetChapterCount) && state.targetChapterCount > 0
    && Number.isInteger(state.targetWordCount) && state.targetWordCount > 0
    && state.synopsisWriteCount > 0
    && state.outlineWriteCount > 0
}

export function incrementVolumePlanningWriteCount(
  state: VolumePlanningState,
  artifact: "synopsis" | "outline",
): VolumePlanningState {
  return artifact === "synopsis"
    ? { ...state, synopsisWriteCount: state.synopsisWriteCount + 1 }
    : { ...state, outlineWriteCount: state.outlineWriteCount + 1 }
}

export function parseVolumePlanningState(markdown: string | undefined): VolumePlanningState | undefined {
  const json = markdown?.match(/```json\s*([\s\S]*?)\s*```/u)?.[1]
  if (json === undefined) return undefined
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.volumeFolderName !== "string"
      || !positiveInteger(record.startSequence)
      || !positiveInteger(record.targetChapterCount)
      || !positiveInteger(record.targetWordCount)) return undefined
    return {
      volumeFolderName: record.volumeFolderName,
      startSequence: record.startSequence,
      targetChapterCount: record.targetChapterCount,
      targetWordCount: record.targetWordCount,
      synopsisWriteCount: nonNegativeInteger(record.synopsisWriteCount),
      outlineWriteCount: nonNegativeInteger(record.outlineWriteCount),
      ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
    }
  } catch {
    return undefined
  }
}

export function serializeVolumePlanningState(state: VolumePlanningState): string {
  return `# ${state.volumeFolderName}卷规划状态\n\n章节目标：${String(state.targetChapterCount)} 章\n总字数目标：${String(state.targetWordCount)} 字\n卷梗概写入次数：${String(state.synopsisWriteCount)}\n卷大纲写入次数：${String(state.outlineWriteCount)}\n${state.notes === undefined ? "" : `备注：${state.notes}\n`}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0
}
