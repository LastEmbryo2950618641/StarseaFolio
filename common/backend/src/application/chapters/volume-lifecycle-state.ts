import {
  formatVolumeSequenceLabel,
  validateVolumeFolderName,
  VOLUME_PLACEHOLDER_TITLE,
} from "../../core/chapters/chapter-volume.js"
import type { WorkspacePort } from "../workspace/ports/workspace-port.js"

export type VolumeLifecycleState = Readonly<{
  volumeFolderName: string
  startedAtMs: number
  endedAtMs?: number
  revisionStartedAtMs?: number
}>

export type LegacyVolumeStartEvidence = Readonly<{
  setupReady: boolean
  /** The volume's own plan is ready and both planning documents have substantive content. */
  planningReady: boolean
  /** The volume contains at least one existing chapter, independently of its plan. */
  hasExistingChapters: boolean
}>

export type VolumeLifecycleTransition = Readonly<{
  volumeFolderName: string
  action: "start" | "end" | "revise"
  atMs: number
  legacyStarted?: boolean
}>

export function volumeLifecycleStatePath(volumeFolderName: string): string {
  if (!isCanonicalVolumeFolderName(volumeFolderName)) throw new Error(`卷名无效：${volumeFolderName}`)
  return `大纲/${volumeFolderName}.卷状态.md`
}

export function parseVolumeLifecycleState(
  markdown: string | undefined,
  expectedVolumeFolderName?: string,
): VolumeLifecycleState | undefined {
  const json = markdown?.trim().match(/^(?:#[ \t]+[^\r\n]+\r?\n(?:[ \t]*\r?\n)*)?```json[ \t]*\r?\n([\s\S]+)\r?\n```$/u)?.[1]
  if (json === undefined) return undefined
  try {
    const state: unknown = JSON.parse(json)
    if (!isVolumeLifecycleState(state)) return undefined
    if (expectedVolumeFolderName !== undefined && state.volumeFolderName !== expectedVolumeFolderName) return undefined
    return state
  } catch {
    return undefined
  }
}

export function serializeVolumeLifecycleState(state: VolumeLifecycleState): string {
  if (!isVolumeLifecycleState(state)) throw new Error("卷状态格式无效")
  const { volumeFolderName, startedAtMs, endedAtMs, revisionStartedAtMs } = state
  const json = JSON.stringify({ volumeFolderName, startedAtMs, endedAtMs, revisionStartedAtMs }, null, 2)
  return `# 卷状态\n\n\`\`\`json\n${json}\n\`\`\`\n`
}

export async function readVolumeLifecycleState(
  workspace: Pick<WorkspacePort, "readMarkdown">,
  workspaceRootRef: string,
  volumeFolderName: string,
): Promise<VolumeLifecycleState | undefined> {
  const path = volumeLifecycleStatePath(volumeFolderName)
  let markdown: string
  try {
    markdown = await workspace.readMarkdown(workspaceRootRef, path)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
  const state = parseVolumeLifecycleState(markdown, volumeFolderName)
  if (state === undefined) throw new Error(`卷状态文件格式无效或不属于当前卷：${path}`)
  return state
}

export async function saveVolumeLifecycleState(
  workspace: Pick<WorkspacePort, "saveUserMarkdown">,
  workspaceRootRef: string,
  state: VolumeLifecycleState,
): Promise<void> {
  await workspace.saveUserMarkdown(
    workspaceRootRef,
    volumeLifecycleStatePath(state.volumeFolderName),
    serializeVolumeLifecycleState(state),
  )
}

export function isVolumeStarted(state: VolumeLifecycleState | undefined, evidence?: LegacyVolumeStartEvidence): boolean {
  return state !== undefined || (
    evidence?.setupReady === true && (evidence.planningReady || evidence.hasExistingChapters)
  )
}

/** Apply an explicit author action. A missing result means the action is invalid in this state. */
export function transitionVolumeLifecycle(
  state: VolumeLifecycleState | undefined,
  input: VolumeLifecycleTransition,
): VolumeLifecycleState | undefined {
  const { volumeFolderName, action, atMs, legacyStarted } = input
  if (!isCanonicalVolumeFolderName(volumeFolderName) || !isTimestamp(atMs)) return undefined
  if (state !== undefined && (!isVolumeLifecycleState(state) || state.volumeFolderName !== volumeFolderName)) return undefined

  switch (action) {
    case "start":
      return state === undefined ? { volumeFolderName, startedAtMs: atMs } : undefined
    case "end":
      // The first recorded lifecycle action can end a legacy volume. Its actual start time is unknown.
      if (state === undefined) {
        return legacyStarted === true ? { volumeFolderName, startedAtMs: atMs, endedAtMs: atMs } : undefined
      }
      if (state.endedAtMs !== undefined || atMs < state.startedAtMs) return undefined
      return { ...state, endedAtMs: atMs }
    case "revise":
      if (state?.endedAtMs === undefined || state.revisionStartedAtMs !== undefined || atMs < state.endedAtMs) return undefined
      return { ...state, revisionStartedAtMs: atMs }
  }
}

/** The supplied sequence is the next chapter to create, so the last planned chapter is still allowed. */
export function isVolumeChapterCapReached(
  plan: Readonly<{ startSequence: number; targetChapterCount: number }> | undefined,
  nextChapterSequence: number,
): boolean {
  return plan !== undefined
    && isPositiveSafeInteger(plan.startSequence)
    && isPositiveSafeInteger(plan.targetChapterCount)
    && isPositiveSafeInteger(nextChapterSequence)
    && nextChapterSequence - plan.startSequence >= plan.targetChapterCount
}

/** Use the next ordinal, preserving an existing folder's title when it already exists. */
export function nextVolumeFolderName(currentVolume: string, existingVolumeFolders: readonly string[]): string {
  const current = validateVolumeFolderName(currentVolume)
  if (!current.ok || !isPositiveSafeInteger(current.sequence + 1) || current.sequence < 1) {
    throw new Error(`卷名或卷序号无效：${currentVolume}`)
  }
  const sequence = current.sequence + 1
  const matches = existingVolumeFolders.map(validateVolumeFolderName)
    .filter(folder => folder.ok && folder.sequence === sequence)
    .map(folder => folder.folderName)
    .sort()
  const label = formatVolumeSequenceLabel(sequence)
  const placeholder = `${label} ${VOLUME_PLACEHOLDER_TITLE}`
  // The formatter uses hundreds in Chinese, which the volume parser cannot round-trip.
  return matches[0] ?? (validateVolumeFolderName(placeholder).ok ? placeholder : `第${sequence}卷 ${VOLUME_PLACEHOLDER_TITLE}`)
}

function isCanonicalVolumeFolderName(name: unknown): name is string {
  if (typeof name !== "string") return false
  const volume = validateVolumeFolderName(name)
  return volume.ok && name === volume.folderName && isPositiveSafeInteger(volume.sequence)
}

function isVolumeLifecycleState(value: unknown): value is VolumeLifecycleState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !["volumeFolderName", "startedAtMs", "endedAtMs", "revisionStartedAtMs"].includes(key))) return false
  const { volumeFolderName, startedAtMs, endedAtMs, revisionStartedAtMs } = record
  if (!isCanonicalVolumeFolderName(volumeFolderName) || !isTimestamp(startedAtMs)) return false
  if (Object.hasOwn(record, "endedAtMs") && (!isTimestamp(endedAtMs) || endedAtMs < startedAtMs)) return false
  return !Object.hasOwn(record, "revisionStartedAtMs")
    || (isTimestamp(revisionStartedAtMs) && isTimestamp(endedAtMs) && revisionStartedAtMs >= endedAtMs)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
