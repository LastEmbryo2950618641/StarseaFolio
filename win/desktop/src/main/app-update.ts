import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { app } from "electron"

export type UpdateCheckIntervalHours = 1 | 2 | 4 | 8 | 24

/** Persisted legacy names; both modes now reject older builds. */
export type UpdateCompareMode = "any_change" | "semver"

export type AppUpdatePrefs = Readonly<{
  updateUrl: string
  checkIntervalHours?: UpdateCheckIntervalHours
  lastCheckedAtMs?: number
  compareMode?: UpdateCompareMode
}>

export type LocalAppIdentity = Readonly<{
  productName: string
  version: string
  buildNumber: string
}>

export type UpdateManifest = Readonly<{
  version: string
  buildNumber: string
  downloadUrl: string
  productName?: string
  releaseNotes?: string
}>

export type UpdateCheckResult = Readonly<{
  checkedAtMs: number
  updateAvailable: boolean
  local: LocalAppIdentity
  remote?: UpdateManifest
  reason?: string
}>

export const DEFAULT_UPDATE_URL =
  "https://github.com/LastEmbryo2950618641/StarseaFolio/releases/latest/download/latest.json"

export const UPDATE_INTERVAL_OPTIONS: readonly UpdateCheckIntervalHours[] = [1, 2, 4, 8, 24]

export function defaultUpdatePrefs(): AppUpdatePrefs {
  return {
    updateUrl: DEFAULT_UPDATE_URL,
    checkIntervalHours: 1,
    compareMode: "semver",
  }
}

export async function readLocalAppIdentity(): Promise<LocalAppIdentity> {
  const version = app.getVersion()
  const productName = "星海余页 (StarseaFolio)"
  const buildNumber = await readBuildNumber()
  return { productName, version, buildNumber }
}

async function readBuildNumber(): Promise<string> {
  const candidates = [
    join(app.getAppPath(), "build-info.json"),
    join(process.resourcesPath, "build-info.json"),
    join(import.meta.dirname, "../../build-info.json"),
  ]
  for (const path of candidates) {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { buildNumber?: unknown }
      if (typeof raw.buildNumber === "string" && raw.buildNumber.trim().length > 0) {
        return raw.buildNumber.trim()
      }
      if (typeof raw.buildNumber === "number" && Number.isFinite(raw.buildNumber)) {
        return String(raw.buildNumber)
      }
    } catch {
      // try next
    }
  }
  return "0"
}

export function isUpdateAvailable(
  local: LocalAppIdentity,
  remote: UpdateManifest,
  mode: UpdateCompareMode = "semver",
): boolean {
  // Keep the old preference argument for stored clients; neither mode permits downgrades.
  void mode
  const a = parseSemver(remote.version)
  const b = parseSemver(local.version)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  // Old installations used a plain version and a separate buildNumber.
  const remoteBuild = a[3] ?? parseBuildNumber(remote.buildNumber)
  const localBuild = b[3] ?? parseBuildNumber(local.buildNumber)
  return remoteBuild !== undefined && localBuild !== undefined && remoteBuild > localBuild
}

/** Returns negative if a < b, 0 if equal, positive if a > b. Non-semver falls back to string compare. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === undefined || pb === undefined) {
    return a === b ? 0 : a > b ? 1 : -1
  }
  for (let i = 0; i < 4; i += 1) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

// Product convention: 0.0.1-N is an increasing build, including migration from 0.0.1.
function parseSemver(value: string): [number, number, number, number?] | undefined {
  const match = value.trim().replace(/^v/iu, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/u)
  if (match === null) return undefined
  const parts = match.slice(1, 4).map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) return undefined
  const build = match[4] === undefined ? undefined : parseBuildNumber(match[4])
  if (match[4] !== undefined && build === undefined) return undefined
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return build === undefined ? core : [...core, build]
}

function parseBuildNumber(value: string): number | undefined {
  const number = Number(value)
  return /^\d+$/u.test(value) && Number.isSafeInteger(number) ? number : undefined
}

export function shouldAutoCheck(
  prefs: AppUpdatePrefs,
  nowMs: number,
  startup = false,
): boolean {
  if (startup) return true
  const hours = prefs.checkIntervalHours
  if (hours === undefined) return false
  const last = prefs.lastCheckedAtMs
  if (last === undefined) return true
  return nowMs < last || nowMs - last >= hours * 60 * 60 * 1000
}

export async function fetchUpdateManifest(updateUrl: string): Promise<UpdateManifest> {
  const url = updateUrl.trim()
  if (url.length === 0) throw new Error("更新地址不能为空")
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "StarseaFolio-Updater", "Cache-Control": "no-cache" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const hint = response.status === 404
      ? "。若仓库为私有，公开 Release 下载链接会返回 404，需将仓库设为公开，或改用可匿名访问的清单地址"
      : ""
    throw new Error(`更新清单请求失败（HTTP ${String(response.status)}）${hint}`)
  }
  const raw = await response.json() as unknown
  return parseUpdateManifest(raw)
}

export function parseUpdateManifest(raw: unknown): UpdateManifest {
  if (raw === null || typeof raw !== "object") {
    throw new Error("更新清单格式无效")
  }
  const record = raw as Record<string, unknown>
  const version = typeof record.version === "string" ? record.version.trim() : ""
  const buildNumber = typeof record.buildNumber === "string"
    ? record.buildNumber.trim()
    : typeof record.buildNumber === "number"
      ? String(record.buildNumber)
      : ""
  const downloadUrl = typeof record.downloadUrl === "string" ? record.downloadUrl.trim() : ""
  if (version.length === 0 || buildNumber.length === 0 || downloadUrl.length === 0) {
    throw new Error("更新清单缺少 version / buildNumber / downloadUrl")
  }
  return {
    version,
    buildNumber,
    downloadUrl,
    ...(typeof record.productName === "string" && record.productName.trim().length > 0
      ? { productName: record.productName.trim() }
      : {}),
    ...(typeof record.releaseNotes === "string" && record.releaseNotes.trim().length > 0
      ? { releaseNotes: record.releaseNotes.trim() }
      : {}),
  }
}

export async function checkForUpdate(prefs: AppUpdatePrefs): Promise<UpdateCheckResult> {
  const local = await readLocalAppIdentity()
  const checkedAtMs = Date.now()
  try {
    const remote = await fetchUpdateManifest(prefs.updateUrl || DEFAULT_UPDATE_URL)
    const mode = prefs.compareMode ?? "any_change"
    const updateAvailable = isUpdateAvailable(local, remote, mode)
    return {
      checkedAtMs,
      updateAvailable,
      local,
      remote,
      reason: updateAvailable ? "发现更高版本或构建号" : "当前已是最新版本或高于公开版本",
    }
  } catch (error) {
    return {
      checkedAtMs,
      updateAvailable: false,
      local,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
