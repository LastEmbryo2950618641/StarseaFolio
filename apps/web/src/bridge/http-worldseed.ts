import {
  PROTOCOL_VERSION,
  clientRequestSchema,
  clientResponseSchema,
  type ClientRequest,
  type ClientResponse,
  type ModelListResult,
} from "@worldseed/contracts"

import type { WorldseedBridge } from "../../../desktop/src/preload/worldseed-bridge.js"
import {
  allocateBookWorkspaceRef,
  DEFAULT_BOOKS_ROOT,
  type WebSession,
} from "./session.js"

type DesktopModelProfile = Readonly<{
  id: string
  name: string
  baseUrl: string
  model: string
  credentialRef: string
  apiProtocol: "openai_chat_completions" | "openai_responses"
  contextWindowTokens: number
  apiKey: string
  hasApiKey: boolean
  thinkingModeEnabled: boolean
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  jsonModeEnabled: boolean
  disableResponseStorage: boolean
  serviceTier: "auto" | "default" | "flex" | "priority" | "fast"
}>

type DesktopModelProfiles = Readonly<{
  profiles: readonly DesktopModelProfile[]
  activeProfileId: string
}>

type AppSettingsReadResult = Readonly<{
  defaultWorkDirectory: string
  workDirectories: readonly string[]
  activeWorkDirectory?: string
}>

function booksSettings(): AppSettingsReadResult {
  return {
    defaultWorkDirectory: DEFAULT_BOOKS_ROOT,
    workDirectories: [DEFAULT_BOOKS_ROOT],
    activeWorkDirectory: DEFAULT_BOOKS_ROOT,
  }
}

/** Server holds DEEPSEEK_API_KEY; browser only needs a selectable profile shape. */
function defaultWebProfiles(): DesktopModelProfiles {
  return {
    profiles: [
      {
        id: "deepseek",
        name: "DeepSeek (server)",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        credentialRef: "model-profile:deepseek",
        apiProtocol: "openai_chat_completions",
        contextWindowTokens: 1_000_000,
        apiKey: "",
        hasApiKey: true,
        thinkingModeEnabled: true,
        reasoningEffort: "high",
        jsonModeEnabled: false,
        disableResponseStorage: true,
        serviceTier: "auto",
      },
    ],
    activeProfileId: "deepseek",
  }
}

function asDesktopProfiles(raw: Readonly<{
  profiles: readonly Record<string, unknown>[]
  activeProfileId: string
}>): DesktopModelProfiles {
  const fallback = defaultWebProfiles()
  const profiles = raw.profiles.map((profile) => {
    const id = typeof profile.id === "string" ? profile.id : "deepseek"
    return {
      id,
      name: typeof profile.name === "string" ? profile.name : id,
      baseUrl: typeof profile.baseUrl === "string" ? profile.baseUrl : "https://api.deepseek.com",
      model: typeof profile.model === "string" ? profile.model : "deepseek-chat",
      credentialRef: typeof profile.credentialRef === "string" ? profile.credentialRef : `model-profile:${id}`,
      apiProtocol: profile.apiProtocol === "openai_responses" ? "openai_responses" as const : "openai_chat_completions" as const,
      contextWindowTokens: typeof profile.contextWindowTokens === "number" ? profile.contextWindowTokens : 1_000_000,
      apiKey: "",
      // Credentials live on the VPS; mark configured so the desktop UI can send.
      hasApiKey: true,
      thinkingModeEnabled: profile.thinkingModeEnabled !== false,
      reasoningEffort: (typeof profile.reasoningEffort === "string" ? profile.reasoningEffort : "high") as DesktopModelProfile["reasoningEffort"],
      jsonModeEnabled: profile.jsonModeEnabled === true,
      disableResponseStorage: profile.disableResponseStorage !== false,
      serviceTier: (typeof profile.serviceTier === "string" ? profile.serviceTier : "auto") as DesktopModelProfile["serviceTier"],
    }
  })
  if (profiles.length === 0) return fallback
  const activeProfileId = profiles.some((profile) => profile.id === raw.activeProfileId)
    ? raw.activeProfileId
    : profiles[0]!.id
  return { profiles, activeProfileId }
}

/** Drop client model selection so the HTTP backend uses its env-backed default model. */
function stripClientModel(request: ClientRequest): ClientRequest {
  const payload = request.payload
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return request
  }
  if (!("model" in payload)) return request
  const { model: _model, ...rest } = payload as Record<string, unknown>
  return { ...request, payload: rest }
}

async function postRpc(session: WebSession, request: ClientRequest): Promise<ClientResponse> {
  const parsed = clientRequestSchema.parse(stripClientModel(request))
  const response = await fetch(`${session.apiBaseUrl}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.apiToken}`,
    },
    body: JSON.stringify(parsed),
  })
  if (response.status === 401) {
    throw new Error("Unauthorized: API Token 无效，请检查设置")
  }
  const json: unknown = await response.json()
  return clientResponseSchema.parse(json)
}

async function rpcData<T>(session: WebSession, method: ClientRequest["method"], payload: unknown): Promise<T> {
  const response = await postRpc(session, {
    protocolVersion: PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    method,
    payload,
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.data as T
}

/**
 * Installs `window.worldseed` so the desktop renderer can run unchanged
 * against a remote HTTP backend.
 */
export function installHttpWorldseedBridge(session: WebSession): WorldseedBridge {
  const bridge: WorldseedBridge = {
    defaultWorkDirectoryPath: DEFAULT_BOOKS_ROOT,
    invoke: async (request) => postRpc(session, request),
    continueBackendWait: async () => true,
    abandonBackendRequest: async () => true,
    onBackendWaitTimeout: () => () => undefined,
    // Profiles for UI selection; actual API keys stay on the VPS (env / server vault).
    readModelProfiles: async () => {
      try {
        const result = await rpcData<{
          profiles: readonly Record<string, unknown>[]
          activeProfileId: string
        }>(session, "model.profiles.read", {})
        return asDesktopProfiles(result)
      } catch {
        return defaultWebProfiles()
      }
    },
    saveModelProfiles: async (input) => input as DesktopModelProfiles,
    listModels: async (input) => {
      try {
        return await rpcData<ModelListResult>(session, "model.list", {
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        })
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
      }
    },
    readAppSettings: async () => booksSettings(),
    saveAppSettings: async () => booksSettings(),
    addWorkDirectory: async () => booksSettings(),
    setActiveWorkDirectory: async () => booksSettings(),
    removeWorkDirectory: async () => booksSettings(),
    getAppUpdateInfo: async () => ({
      local: { productName: "StarseaFolio Web", version: "0.1.0", buildNumber: "web" },
      update: { updateUrl: "https://example.invalid/worldseed-web" },
    }),
    saveAppUpdatePrefs: async () => booksSettings(),
    checkAppUpdate: async () => ({
      checkedAtMs: Date.now(),
      updateAvailable: false,
      local: { productName: "StarseaFolio Web", version: "0.1.0", buildNumber: "web" },
      skipped: true,
      reason: "web-build",
    }),
    startAppUpdateDownload: async () => {
      throw new Error("Web 版不支持应用内更新")
    },
    cancelAppUpdateDownload: async () => ({ ok: true as const }),
    installAppUpdateAndQuit: async () => {
      throw new Error("Web 版不支持应用内更新")
    },
    onAppUpdateDownloadProgress: () => () => undefined,
    allocateBookPath: async () => allocateBookWorkspaceRef(DEFAULT_BOOKS_ROOT),
    selectDirectory: async () => DEFAULT_BOOKS_ROOT,
    selectMarkdownFiles: async () => [],
    selectImageFile: async () => {
      throw new Error("Web 版暂不支持更换封面")
    },
    getBookCover: async () => undefined,
    setBookCover: async () => {
      throw new Error("Web 版暂不支持更换封面")
    },
    onCommand: () => () => undefined,
    windowControl: async () => undefined,
    onWindowMaximized: () => () => undefined,
    nativeMenu: async () => undefined,
  }

  window.worldseed = bridge
  return bridge
}
