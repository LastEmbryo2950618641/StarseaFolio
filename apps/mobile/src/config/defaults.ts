import type { MobileSession } from "../api/client"

/** 内置默认后端；不填设置就用这份。可在「设置」里覆盖。 */
export const DEFAULT_SESSION: MobileSession = {
  apiBaseUrl: "http://111.229.32.85",
  apiToken: "GuW35QrAofLViSmdwHsNTujlFLTv-MXtcvzYG8mHYao",
}

/** 服务端上新建书的工作区根目录（绝对路径，由后端建目录）。 */
export const DEFAULT_BOOKS_ROOT = "/var/lib/worldseed/books"

export function resolveSession(override: MobileSession | undefined): MobileSession {
  if (override === undefined) return DEFAULT_SESSION
  const apiBaseUrl = override.apiBaseUrl.trim().replace(/\/+$/u, "")
  const apiToken = override.apiToken.trim()
  return {
    apiBaseUrl: apiBaseUrl.length > 0 ? apiBaseUrl : DEFAULT_SESSION.apiBaseUrl,
    apiToken: apiToken.length > 0 ? apiToken : DEFAULT_SESSION.apiToken,
  }
}

export function allocateBookWorkspaceRef(displayName: string, booksRoot: string = DEFAULT_BOOKS_ROOT): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "book"
  const suffix = Math.random().toString(36).slice(2, 8)
  const root = booksRoot.replace(/\/+$/u, "")
  return `${root}/${slug}-${suffix}`
}
