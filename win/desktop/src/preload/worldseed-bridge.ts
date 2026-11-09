import { ipcRenderer } from "electron"
import type {
  AppUpdatePrefs,
  AppSettingsReadResult,
  WorldseedCommand,
  DesktopModelProfiles,
  UpdateCheckResult,
  UpdateDownloadProgress,
  AppUpdateInfoResult,
  BackendWaitTimeoutInfo,
  WorldseedBridge,
} from "@worldseed/contracts"
import {
  clientRequestSchema,
  clientResponseSchema,
} from "@worldseed/contracts"
import type { ModelListResult } from "@worldseed/contracts"

/** Avoid node:os / node:path in sandboxed preload — use env only. */
export function resolveDefaultWorkDirectoryPath(): string {
  const home = (process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/[\\/]+$/u, "")
  if (home.length === 0) return ""
  const separator = home.includes("\\") ? "\\" : "/"
  return `${home}${separator}.worldseed`
}

function normalizeAppSettingsReadResult(raw: unknown): AppSettingsReadResult {
  const fallback = resolveDefaultWorkDirectoryPath()
  if (raw === null || typeof raw !== "object") {
    return { defaultWorkDirectory: fallback, workDirectories: [] }
  }
  const record = raw as {
    defaultWorkDirectory?: unknown
    workDirectories?: unknown
    workDirectory?: unknown
    activeWorkDirectory?: unknown
    update?: unknown
  }
  const legacyDirectory = typeof record.workDirectory === "string" ? record.workDirectory.trim() : ""
  const workDirectories = Array.isArray(record.workDirectories)
    ? record.workDirectories.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : legacyDirectory.length > 0
      ? [legacyDirectory]
      : []
  const defaultWorkDirectory = typeof record.defaultWorkDirectory === "string" && record.defaultWorkDirectory.trim().length > 0
    ? record.defaultWorkDirectory.trim()
    : fallback
  const activeCandidate = typeof record.activeWorkDirectory === "string"
    ? record.activeWorkDirectory.trim()
    : legacyDirectory.length > 0
      ? legacyDirectory
      : undefined
  const update = parseUpdatePrefsFromRecord(record.update)
  return {
    defaultWorkDirectory,
    workDirectories,
    ...(activeCandidate !== undefined && activeCandidate.length > 0 && workDirectories.includes(activeCandidate)
      ? { activeWorkDirectory: activeCandidate }
      : workDirectories.length > 0
        ? { activeWorkDirectory: workDirectories[0] }
        : {}),
    ...(update === undefined ? {} : { update }),
  }
}

function parseUpdatePrefsFromRecord(raw: unknown): AppUpdatePrefs | undefined {
  if (raw === null || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const updateUrl = typeof record.updateUrl === "string" ? record.updateUrl.trim() : ""
  if (updateUrl.length === 0) return undefined
  const interval = record.checkIntervalHours
  const checkIntervalHours = interval === 1 || interval === 2 || interval === 4 || interval === 8 || interval === 24
    ? interval
    : undefined
  return {
    updateUrl,
    ...(checkIntervalHours === undefined ? {} : { checkIntervalHours }),
    ...(typeof record.lastCheckedAtMs === "number" ? { lastCheckedAtMs: record.lastCheckedAtMs } : {}),
    ...(record.compareMode === "semver" || record.compareMode === "any_change"
      ? { compareMode: record.compareMode }
      : {}),
  }
}

export type {
  UpdateCheckIntervalHours,
  AppUpdatePrefs,
  AppSettingsReadResult,
  WorldseedCommand,
  WindowControlAction,
  NativeMenuAction,
  DesktopModelProfile,
  DesktopModelProfiles,
  RemoveWorkDirectoryMode,
  LocalAppIdentity,
  UpdateManifest,
  UpdateCheckResult,
  UpdateDownloadProgress,
  AppUpdateInfoResult,
  AppSettings,
  BackendWaitTimeoutInfo,
  WorldseedBridge,
} from "@worldseed/contracts"

export const worldseedBridge: WorldseedBridge = {
  defaultWorkDirectoryPath: resolveDefaultWorkDirectoryPath(),
  invoke: async (request, options) => {
    const response = await ipcRenderer.invoke(
      "worldseed:request",
      clientRequestSchema.parse(request),
      options === undefined ? {} : { waitTimeoutMs: options.waitTimeoutMs },
    ) as unknown
    return clientResponseSchema.parse(response)
  },
  continueBackendWait: async (requestId) => ipcRenderer.invoke("worldseed:backend-continue-wait", requestId) as Promise<boolean>,
  abandonBackendRequest: async (requestId) => ipcRenderer.invoke("worldseed:backend-abandon", requestId) as Promise<boolean>,
  onBackendWaitTimeout: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, info: BackendWaitTimeoutInfo): void => {
      listener(info)
    }
    ipcRenderer.on("worldseed:backend-wait-timeout", handler)
    return () => ipcRenderer.removeListener("worldseed:backend-wait-timeout", handler)
  },
  readModelProfiles: async () => ipcRenderer.invoke("worldseed:model-profiles:read") as Promise<DesktopModelProfiles>,
  saveModelProfiles: async (input) => ipcRenderer.invoke("worldseed:model-profiles:save", input) as Promise<DesktopModelProfiles>,
  listModels: async (input) => ipcRenderer.invoke("worldseed:model-list", input) as Promise<ModelListResult>,
  readAppSettings: async () => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-settings:read")),
  saveAppSettings: async (input) => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-settings:save", input)),
  addWorkDirectory: async (directoryPath) => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-settings:work-directory:add", { directoryPath })),
  setActiveWorkDirectory: async (directoryPath) => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-settings:work-directory:set-active", { directoryPath })),
  removeWorkDirectory: async (input) => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-settings:work-directory:remove", input)),
  getAppUpdateInfo: async () => ipcRenderer.invoke("worldseed:app-update:info") as Promise<AppUpdateInfoResult>,
  saveAppUpdatePrefs: async (input) => normalizeAppSettingsReadResult(await ipcRenderer.invoke("worldseed:app-update:save-prefs", input)),
  checkAppUpdate: async (input) => ipcRenderer.invoke("worldseed:app-update:check", input ?? {}) as Promise<UpdateCheckResult>,
  startAppUpdateDownload: async (input) => ipcRenderer.invoke("worldseed:app-update:download-start", input) as Promise<{ ok: true; installerPath: string }>,
  cancelAppUpdateDownload: async () => ipcRenderer.invoke("worldseed:app-update:download-cancel") as Promise<{ ok: true }>,
  installAppUpdateAndQuit: async (installerPath) => ipcRenderer.invoke("worldseed:app-update:install-and-quit", { installerPath }) as Promise<{ ok: true }>,
  onAppUpdateDownloadProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress): void => {
      listener(progress)
    }
    ipcRenderer.on("worldseed:app-update:download-progress", handler)
    return () => ipcRenderer.removeListener("worldseed:app-update:download-progress", handler)
  },
  allocateBookPath: async (workDirectory) => ipcRenderer.invoke("worldseed:book-path:allocate", { workDirectory }) as Promise<string>,
  selectDirectory: async (input) => ipcRenderer.invoke("worldseed:select-directory", input) as Promise<string | undefined>,
  selectMarkdownFiles: async (input) => {
    const paths = await ipcRenderer.invoke("worldseed:select-markdown-files", input ?? {}) as unknown
    return Array.isArray(paths) ? paths.filter((entry): entry is string => typeof entry === "string") : []
  },
  selectImageFile: async (input) => ipcRenderer.invoke("worldseed:select-image-file", input) as Promise<string | undefined>,
  readImageFile: async (sourcePath) => ipcRenderer.invoke("worldseed:image-file:read", { sourcePath }) as Promise<string>,
  getBookCover: async (workspaceRootRef) => {
    const result = await ipcRenderer.invoke("worldseed:book-cover:get", { workspaceRootRef }) as unknown
    return typeof result === "string" && result.length > 0 ? result : undefined
  },
  setBookCover: async (input) => ipcRenderer.invoke("worldseed:book-cover:set", input) as Promise<string>,
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: WorldseedCommand): void => { listener(command); }
    ipcRenderer.on("worldseed:command", handler)
    return () => ipcRenderer.removeListener("worldseed:command", handler)
  },
  windowControl: async (action) => ipcRenderer.invoke("worldseed:window-control", action) as Promise<boolean | undefined>,
  onWindowMaximized: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => { listener(maximized); }
    ipcRenderer.on("worldseed:window-maximized", handler)
    return () => ipcRenderer.removeListener("worldseed:window-maximized", handler)
  },
  nativeMenu: async (action) => {
    await ipcRenderer.invoke("worldseed:native-menu", action)
  },
}
