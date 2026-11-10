import {
  PROTOCOL_VERSION,
  clientRequestSchema,
  clientResponseSchema,
  modelProfilesDraftSavePayloadSchema,
  modelProfilesSavePayloadSchema,
  type ClientRequest,
  type ClientResponse,
  type ModelListResult,
} from "@starseafolio/contracts"

import type { WorldseedBridge } from "@starseafolio/contracts"
import { chooseBrowserImage, readBrowserCover, saveBrowserCover } from "./browser-book-covers.js"
import { browserModelCredentials } from "./browser-model-credentials.js"
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

async function asDesktopProfiles(raw: Readonly<{
  profiles: readonly Record<string, unknown>[]
  activeProfileId: string
}>, credentials: ReturnType<typeof browserModelCredentials>): Promise<DesktopModelProfiles> {
  const profiles = await Promise.all(raw.profiles.map(async (profile) => {
    const id = typeof profile.id === "string" ? profile.id : "deepseek"
    const credentialRef = typeof profile.credentialRef === "string" ? profile.credentialRef : `model-profile:${id}`
    return {
      id,
      name: typeof profile.name === "string" ? profile.name : id,
      baseUrl: typeof profile.baseUrl === "string" ? profile.baseUrl : "https://api.deepseek.com",
      model: typeof profile.model === "string" ? profile.model : "deepseek-chat",
      credentialRef,
      apiProtocol: profile.apiProtocol === "openai_responses" ? "openai_responses" as const : "openai_chat_completions" as const,
      contextWindowTokens: typeof profile.contextWindowTokens === "number" ? profile.contextWindowTokens : 1_000_000,
      apiKey: "",
      hasApiKey: Boolean((await credentials.get(credentialRef))?.trim()),
      thinkingModeEnabled: profile.thinkingModeEnabled !== false,
      reasoningEffort: (typeof profile.reasoningEffort === "string" ? profile.reasoningEffort : "high") as DesktopModelProfile["reasoningEffort"],
      jsonModeEnabled: profile.jsonModeEnabled === true,
      disableResponseStorage: profile.disableResponseStorage !== false,
      serviceTier: (typeof profile.serviceTier === "string" ? profile.serviceTier : "auto") as DesktopModelProfile["serviceTier"],
    }
  }))
  const firstProfile = profiles[0]
  if (firstProfile === undefined) throw new Error("模型配置为空，请先添加模型配置")
  const activeProfileId = profiles.some((profile) => profile.id === raw.activeProfileId)
    ? raw.activeProfileId
    : firstProfile.id
  return { profiles, activeProfileId }
}

/** Resolve the same credential reference used by the desktop vault, without changing model selection. */
async function resolveClientModel(session: WebSession, request: ClientRequest): Promise<ClientRequest> {
  const payload = request.payload
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return request
  }
  if (!("model" in payload)) return request
  const model = (payload as Record<string, unknown>).model
  if (model === null || typeof model !== "object" || !("credentialRef" in model) || typeof model.credentialRef !== "string") return request
  const apiKey = await resolveApiKey(session, model.credentialRef, "apiKey" in model && typeof model.apiKey === "string" ? model.apiKey : undefined)
  return { ...request, payload: { ...payload, model: { ...model, apiKey } } }
}

async function resolveApiKey(session: WebSession, reference: string, supplied?: string): Promise<string> {
  const apiKey = supplied?.trim() || (await browserModelCredentials(session.apiBaseUrl).get(reference))?.trim()
  if (!apiKey) throw new Error("当前模型的 API Key 未保存在本机，请打开“模型配置”，填写 API Key 并保存后重试。")
  return apiKey
}

async function postRpc(session: WebSession, request: ClientRequest): Promise<ClientResponse> {
  const parsed = clientRequestSchema.parse(await resolveClientModel(session, request))
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
  const credentials = browserModelCredentials(session.apiBaseUrl)
  const bridge: WorldseedBridge = {
    defaultWorkDirectoryPath: DEFAULT_BOOKS_ROOT,
    invoke: async (request) => postRpc(session, request),
    continueBackendWait: async () => true,
    abandonBackendRequest: async () => true,
    onBackendWaitTimeout: () => () => undefined,
    readModelProfiles: async () => {
      const result = await rpcData<{
        profiles: readonly Record<string, unknown>[]
        activeProfileId: string
      }>(session, "model.profiles.read", {})
      return asDesktopProfiles(result, credentials)
    },
    saveModelProfiles: async (input) => {
      const drafts = modelProfilesDraftSavePayloadSchema.parse(input)
      // Send metadata only; the HTTP profile store deliberately does not store secrets.
      const result = await rpcData<{
        profiles: readonly Record<string, unknown>[]
        activeProfileId: string
      }>(session, "model.profiles.save", modelProfilesSavePayloadSchema.parse(drafts))
      for (const profile of drafts.profiles) {
        if (profile.apiKey.trim().length > 0) await credentials.set(profile.credentialRef, profile.apiKey.trim())
        else if (!profile.hasApiKey) await credentials.remove(profile.credentialRef)
      }
      return asDesktopProfiles(result, credentials)
    },
    listModels: async (input) => {
      try {
        return await rpcData<ModelListResult>(session, "model.list", {
          baseUrl: input.baseUrl,
          apiKey: await resolveApiKey(session, input.credentialRef, input.apiKey),
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
    selectImageFile: chooseBrowserImage,
    readImageFile: async (source) => {
      if (!source.startsWith("data:image/")) throw new Error("无效的图片来源，请重新选择图片")
      return source
    },
    getBookCover: async (workspace) => readBrowserCover(`${session.apiBaseUrl}\u0000${workspace}`),
    setBookCover: async ({ workspaceRootRef, dataUrl }) => saveBrowserCover(`${session.apiBaseUrl}\u0000${workspaceRootRef}`, dataUrl),
    onCommand: () => () => undefined,
    windowControl: async () => undefined,
    onWindowMaximized: () => () => undefined,
    nativeMenu: async () => undefined,
  }

  window.worldseed = bridge
  return bridge
}
