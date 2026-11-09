export type WebSession = Readonly<{
  apiBaseUrl: string
  apiToken: string
}>

const STORAGE_KEY = "worldseed.web.session.v1"

/** 内置默认：连已部署的 VPS；可在 localStorage 覆盖。 */
export const DEFAULT_WEB_SESSION: WebSession = {
  apiBaseUrl: "http://111.229.32.85",
  apiToken: "GuW35QrAofLViSmdwHsNTujlFLTv-MXtcvzYG8mHYao",
}

const previewApiBase = import.meta.env.VITE_WORLDSEED_API_BASE_URL as string | undefined
const previewSession: WebSession | undefined = previewApiBase === undefined ? undefined : {
  apiBaseUrl: new URL(previewApiBase, window.location.origin).href.replace(/\/+$/u, ""),
  apiToken: "",
}

/** 服务端书籍根目录（与 mobile / 部署约定一致）。 */
export const DEFAULT_BOOKS_ROOT = (import.meta.env.VITE_WORLDSEED_BOOKS_ROOT as string | undefined) ?? "/var/lib/worldseed/books"

export function loadWebSession(): WebSession {
  // Android development always uses the current local backend, not a stale saved VPS session.
  if (previewSession !== undefined) return previewSession
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_WEB_SESSION
    const parsed = JSON.parse(raw) as Partial<WebSession>
    const apiBaseUrl = typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim().replace(/\/+$/u, "") : ""
    const apiToken = typeof parsed.apiToken === "string" ? parsed.apiToken.trim() : ""
    return {
      apiBaseUrl: apiBaseUrl.length > 0 ? apiBaseUrl : DEFAULT_WEB_SESSION.apiBaseUrl,
      apiToken: apiToken.length > 0 ? apiToken : DEFAULT_WEB_SESSION.apiToken,
    }
  } catch {
    return DEFAULT_WEB_SESSION
  }
}

export function saveWebSession(session: WebSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiBaseUrl: session.apiBaseUrl.trim().replace(/\/+$/u, ""),
    apiToken: session.apiToken.trim(),
  }))
}

export function allocateBookWorkspaceRef(booksRoot: string = DEFAULT_BOOKS_ROOT): string {
  const adjectives = ["amber", "azure", "calm", "cedar", "dawn", "ember", "golden", "misty", "quiet", "silver"]
  const nouns = ["atlas", "bridge", "chapter", "harbor", "ledger", "quill", "river", "studio", "voyage", "window"]
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)] ?? "amber"
  const noun = nouns[Math.floor(Math.random() * nouns.length)] ?? "atlas"
  const suffix = Math.random().toString(16).slice(2, 6)
  const root = booksRoot.replace(/\/+$/u, "")
  return `${root}/${adj}-${noun}-${suffix}`
}
