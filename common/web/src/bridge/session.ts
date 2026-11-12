export type WebSession = Readonly<{
  apiBaseUrl: string
  apiToken: string
  accountId?: string
  accountName?: string
  avatarDataUrl?: string
  booksRoot?: string
  /** Android local preview talks to the machine backend and does not use web accounts. */
  offlinePreview?: boolean
}>

const STORAGE_KEY = "worldseed.web.session.v1"

/** Logged-out web never falls back to the shared service token. */
export const DEFAULT_WEB_SESSION: WebSession = {
  apiBaseUrl: "http://111.229.32.85/worldseed",
  apiToken: "",
}

const previewApiBase = import.meta.env.VITE_WORLDSEED_API_BASE_URL as string | undefined
const previewSession: WebSession | undefined = previewApiBase === undefined || previewApiBase.trim().length === 0
  ? undefined
  : {
    apiBaseUrl: new URL(previewApiBase, window.location.origin).href.replace(/\/+$/u, ""),
    apiToken: "",
    offlinePreview: true,
  }

/** Web login is only rendered for the public browser app, not the Android local preview. */
export const webAccountsEnabled = previewSession === undefined

/** 服务端书籍根目录（与 mobile / 部署约定一致）。 */
export const DEFAULT_BOOKS_ROOT = (import.meta.env.VITE_WORLDSEED_BOOKS_ROOT as string | undefined) ?? "/var/lib/worldseed/books"

export function modelCredentialScope(session: WebSession): string {
  return session.accountId === undefined ? session.apiBaseUrl : `${session.apiBaseUrl}\u0000${session.accountId}`
}

export function loadWebSession(): WebSession {
  if (previewSession !== undefined) return previewSession
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_WEB_SESSION
    const parsed = JSON.parse(raw) as Partial<WebSession>
    const apiBaseUrl = typeof parsed.apiBaseUrl === "string" && parsed.apiBaseUrl.trim().length > 0
      ? parsed.apiBaseUrl.trim().replace(/\/+$/u, "")
      : DEFAULT_WEB_SESSION.apiBaseUrl
    return accountSession(parsed, apiBaseUrl)
  } catch {
    return DEFAULT_WEB_SESSION
  }
}

export function saveWebSession(session: WebSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiBaseUrl: session.apiBaseUrl.trim().replace(/\/+$/u, ""),
    apiToken: session.apiToken.trim(),
    accountId: session.accountId ?? "",
    accountName: session.accountName ?? "",
    avatarDataUrl: session.avatarDataUrl ?? "",
    booksRoot: session.booksRoot ?? "",
  }))
}

export function clearWebSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

function accountSession(parsed: Partial<WebSession>, apiBaseUrl: string): WebSession {
  const accountId = typeof parsed.accountId === "string" ? parsed.accountId.trim() : ""
  const apiToken = typeof parsed.apiToken === "string" ? parsed.apiToken.trim() : ""
  const booksRoot = typeof parsed.booksRoot === "string" ? parsed.booksRoot.trim() : ""
  const accountName = typeof parsed.accountName === "string" ? parsed.accountName.trim() : ""
  const avatarDataUrl = typeof parsed.avatarDataUrl === "string" ? parsed.avatarDataUrl : ""
  if (!/^[0-9a-f]{16}$/u.test(accountId) || apiToken.length < 20 || !isAccountBooksRoot(booksRoot)) {
    return { apiBaseUrl, apiToken: "" }
  }
  return {
    apiBaseUrl,
    apiToken,
    accountId,
    booksRoot,
    ...(accountName.length > 0 ? { accountName } : {}),
    ...(avatarDataUrl.startsWith("data:image/") ? { avatarDataUrl } : {}),
  }
}

function isAccountBooksRoot(value: string): boolean {
  if (!value.startsWith("/") || value.includes("..") || value.includes("\0")) return false
  return /\/accounts\/[0-9a-f]{16}$/u.test(value)
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
