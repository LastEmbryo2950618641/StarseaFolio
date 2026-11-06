export type VolumePlanningState = Readonly<{
  volumeFolderName: string
  startSequence: number
  targetChapterCount: number
  targetWordCount: number
  synopsisWriteCount: number
  outlineWriteCount: number
  storyline?: Readonly<{ opening: string; climaxes: string; ending: string; subplots: string }>
  storylineConfirmedAtMs?: number
  notes?: string
}>

export function volumePlanningGateReady(state: VolumePlanningState | undefined): boolean {
  return state !== undefined
    && Number.isInteger(state.targetChapterCount) && state.targetChapterCount > 0
    && Number.isInteger(state.targetWordCount) && state.targetWordCount > 0
    && state.synopsisWriteCount > 0
    && state.outlineWriteCount > 0
    && validStoryline(state.storyline)
    && typeof state.storylineConfirmedAtMs === "number" && state.storylineConfirmedAtMs >= 0
}

/** Headers, empty files and planning placeholders do not count as written content. */
export function volumePlanningMarkdownHasContent(markdown: string | undefined): boolean {
  return (markdown ?? "").split(/\r?\n/u).some(line => {
    const text = line.trim()
    return text.length > 0 && !/^#{1,6}(?:\s|$)/u.test(text)
      && !/^[-*_]{3,}$/u.test(text)
      && !/^(?:待写入|待规划|待补充|暂无内容|占位|TODO|TBD)[。.!！\s]*$/iu.test(text)
  })
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
      || !nonNegativeNumber(record.targetChapterCount)
      || !nonNegativeNumber(record.targetWordCount)) return undefined
    return {
      volumeFolderName: record.volumeFolderName,
      startSequence: record.startSequence,
      targetChapterCount: record.targetChapterCount,
      targetWordCount: record.targetWordCount,
      synopsisWriteCount: nonNegativeInteger(record.synopsisWriteCount),
      outlineWriteCount: nonNegativeInteger(record.outlineWriteCount),
      ...(validStoryline(record.storyline) ? { storyline: record.storyline } : {}),
      ...(typeof record.storylineConfirmedAtMs === "number" && Number.isFinite(record.storylineConfirmedAtMs)
        && record.storylineConfirmedAtMs >= 0 ? { storylineConfirmedAtMs: record.storylineConfirmedAtMs } : {}),
      ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
    }
  } catch {
    return undefined
  }
}

export function serializeVolumePlanningState(state: VolumePlanningState): string {
  const story = state.storyline === undefined ? "\n主线与支线：待用户确认\n" : [
    "\n## 用户确认的本卷主线与支线", `开场：${state.storyline.opening}`,
    `高潮：${state.storyline.climaxes}`, `结局：${state.storyline.ending}`, `支线及事件时机：${state.storyline.subplots}`, "",
  ].join("\n\n")
  return `# ${state.volumeFolderName}卷规划状态\n\n章节目标：${state.targetChapterCount > 0 ? String(state.targetChapterCount) : "待规划"} 章\n总字数目标：${state.targetWordCount > 0 ? String(state.targetWordCount) : "待规划"} 字\n卷梗概写入次数：${String(state.synopsisWriteCount)}\n卷大纲写入次数：${String(state.outlineWriteCount)}\n${state.notes === undefined ? "" : `备注：${state.notes}\n`}${story}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function validStoryline(value: unknown): value is NonNullable<VolumePlanningState["storyline"]> {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return ["opening", "climaxes", "ending", "subplots"].every(key => typeof record[key] === "string" && record[key].trim().length > 0)
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0
}
