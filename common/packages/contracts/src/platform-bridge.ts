import type { ClientRequest, ClientResponse } from "./ipc.js"
import type { ModelListResult, ModelProfileDraft } from "./backend-payloads.js"

export type UpdateCheckIntervalHours = 1 | 2 | 4 | 8 | 24

export type AppUpdatePrefs = Readonly<{
  updateUrl: string
  checkIntervalHours?: UpdateCheckIntervalHours
  lastCheckedAtMs?: number
  compareMode?: "any_change" | "semver"
}>

export type AppSettingsReadResult = Readonly<{
  defaultWorkDirectory: string
  workDirectories: readonly string[]
  activeWorkDirectory?: string
  update?: AppUpdatePrefs
}>

export type WorldseedCommand = "project.new" | "project.open" | "turn.start"
export type WindowControlAction = "minimize" | "maximize" | "close" | "isMaximized"
export type NativeMenuAction =
  | "app.quit"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.toggleFullscreen"
export type DesktopModelProfile = ModelProfileDraft
export type DesktopModelProfiles = Readonly<{
  profiles: readonly DesktopModelProfile[]
  activeProfileId: string
}>

export type RemoveWorkDirectoryMode = "keep_data" | "include_data"

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
  skipped?: boolean
}>

export type UpdateDownloadProgress = Readonly<{
  receivedBytes: number
  totalBytes: number
  percent: number
}>

export type AppUpdateInfoResult = Readonly<{
  local: LocalAppIdentity
  update: AppUpdatePrefs
}>

export type AppSettings = Readonly<{
  workDirectory: string
}>

export type BackendWaitTimeoutInfo = Readonly<{
  requestId: string
  method: string
  waitTimeoutMs: number
  elapsedMs: number
}>

export type WorldseedBridge = Readonly<{
  defaultWorkDirectoryPath: string
  invoke(request: ClientRequest, options?: { waitTimeoutMs?: number }): Promise<ClientResponse>
  continueBackendWait(requestId: string): Promise<boolean>
  abandonBackendRequest(requestId: string): Promise<boolean>
  onBackendWaitTimeout(listener: (info: BackendWaitTimeoutInfo) => void): () => void
  readModelProfiles(): Promise<DesktopModelProfiles>
  saveModelProfiles(input: { profiles: readonly DesktopModelProfile[]; activeProfileId: string }): Promise<DesktopModelProfiles>
  listModels(input: { baseUrl: string; apiKey?: string; credentialRef: string }): Promise<ModelListResult>
  readAppSettings(): Promise<AppSettingsReadResult>
  saveAppSettings(input: AppSettings): Promise<AppSettingsReadResult>
  addWorkDirectory(directoryPath: string): Promise<AppSettingsReadResult>
  setActiveWorkDirectory(directoryPath: string): Promise<AppSettingsReadResult>
  removeWorkDirectory(input: Readonly<{ directoryPath: string; mode: RemoveWorkDirectoryMode }>): Promise<AppSettingsReadResult>
  getAppUpdateInfo(): Promise<AppUpdateInfoResult>
  saveAppUpdatePrefs(input: AppUpdatePrefs): Promise<AppSettingsReadResult>
  checkAppUpdate(input?: { force?: boolean; startup?: boolean }): Promise<UpdateCheckResult>
  startAppUpdateDownload(input: Readonly<{
    downloadUrl: string
    version: string
    buildNumber: string
  }>): Promise<{ ok: true; installerPath: string }>
  cancelAppUpdateDownload(): Promise<{ ok: true }>
  installAppUpdateAndQuit(installerPath: string): Promise<{ ok: true }>
  onAppUpdateDownloadProgress(listener: (progress: UpdateDownloadProgress) => void): () => void
  allocateBookPath(workDirectory: string): Promise<string>
  selectDirectory(input?: { title?: string; defaultPath?: string }): Promise<string | undefined>
  selectMarkdownFiles(input?: { title?: string; defaultPath?: string }): Promise<readonly string[]>
  selectImageFile(input?: { title?: string; defaultPath?: string }): Promise<string | undefined>
  readImageFile(sourcePath: string): Promise<string>
  getBookCover(workspaceRootRef: string): Promise<string | undefined>
  setBookCover(input: Readonly<{ workspaceRootRef: string; dataUrl: string }>): Promise<string>
  onCommand(listener: (command: WorldseedCommand) => void): () => void
  windowControl(action: WindowControlAction): Promise<boolean | undefined>
  onWindowMaximized(listener: (maximized: boolean) => void): () => void
  nativeMenu(action: NativeMenuAction): Promise<void>
}>
