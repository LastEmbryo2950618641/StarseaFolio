import { fetch } from "undici"

import type { WebPageContent, WebResearchFetchDetail } from "../../application/retrieval/ports/web-research-port.js"
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
  decodeHtmlEntities,
  htmlToPlainText,
  isHttpUrl,
} from "./web-url-safety.js"

const DEFAULT_USER_AGENT = "StarseaFolioDesktop/1.0 (+local research; respectful)"
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 512_000
const MAX_REDIRECTS = 3

export type WebResearchHttpClientOptions = Readonly<{
  userAgent?: string
  timeoutMs?: number
  maxResponseBytes?: number
  fetchImpl?: typeof fetch
}>

/** Shared bounded public-http GET used by search HTML scrapers and page fetch. */
export class WebResearchHttpClient {
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly fetchImpl: typeof fetch

  public constructor(options: WebResearchHttpClientOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  public async readText(
    rawUrl: string,
    outerSignal: AbortSignal | undefined,
    options: Readonly<{ followRedirects?: boolean }> = {},
  ): Promise<string> {
    let current = assertPublicHttpUrl(rawUrl).toString()
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      outerSignal?.throwIfAborted()
      await assertPublicHttpUrlResolved(current)
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, this.timeoutMs)
      const onAbort = (): void => { controller.abort() }
      outerSignal?.addEventListener("abort", onAbort, { once: true })
      if (outerSignal?.aborted === true) controller.abort()
      try {
        const response = await this.fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          headers: {
            "user-agent": this.userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
        })
        if (response.status >= 300 && response.status < 400) {
          if (!options.followRedirects) {
            throw new Error(`Unexpected redirect from ${current}`)
          }
          const location = response.headers.get("location")
          if (location === null || location.length === 0) {
            throw new Error(`Redirect without location from ${current}`)
          }
          current = new URL(location, current).toString()
          continue
        }
        if (!response.ok) {
          throw new Error(`Web fetch failed (${String(response.status)}) for ${current}`)
        }
        const contentType = response.headers.get("content-type") ?? ""
        if (contentType.length > 0
          && !contentType.includes("text/")
          && !contentType.includes("json")
          && !contentType.includes("xml")
          && !contentType.includes("html")) {
          throw new Error(`Unsupported content type for web research: ${contentType}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.byteLength > this.maxResponseBytes) {
          return buffer.subarray(0, this.maxResponseBytes).toString("utf8")
        }
        return buffer.toString("utf8")
      } finally {
        clearTimeout(timer)
        outerSignal?.removeEventListener("abort", onAbort)
      }
    }
    throw new Error(`Too many redirects fetching ${rawUrl}`)
  }

  public async fetchPage(input: Readonly<{ url: string; signal?: AbortSignal }>): Promise<WebPageContent | undefined> {
    return (await this.fetchPageDetailed(input)).page
  }

  public async fetchPageDetailed(input: Readonly<{ url: string; signal?: AbortSignal }>): Promise<WebResearchFetchDetail> {
    const raw = input.url.trim()
    if (!isHttpUrl(raw)) return { attempts: [{ provider: "HTTP", status: "error", message: "URL 不是有效的 HTTP(S) 页面地址" }] }
    try {
      await assertPublicHttpUrlResolved(raw)
      const html = await this.readText(raw, input.signal, { followRedirects: true })
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)
      const title = titleMatch?.[1] === undefined
        ? raw
        : decodeHtmlEntities(htmlToPlainText(titleMatch[1])).slice(0, 200) || raw
      const text = htmlToPlainText(html).slice(0, 24_000)
      if (text.length === 0) return { attempts: [{ provider: "HTTP", status: "empty", message: "页面没有可读正文" }] }
      if (/^(?:安全验证|访问验证|人机验证|just a moment[.!…]*|attention required!?|access denied|403 forbidden)(?:\s*[|｜-].*)?$/iu.test(title.trim())
        || (text.length < 2_000 && /请完成.{0,12}(?:验证|验证码)|verify you are human|enable javascript and cookies to continue/iu.test(text))) {
        return { attempts: [{ provider: "HTTP", status: "error", message: "站点返回访问验证或拦截页面，未取得正文" }] }
      }
      return { page: { url: raw, title, text }, attempts: [{ provider: "HTTP", status: "ok" }] }
    } catch (error) {
      const message = input.signal?.aborted === true
        ? "网页读取超时或已取消"
        : error instanceof Error ? error.message : String(error)
      const cause = error instanceof Error && error.cause instanceof Error ? `：${error.cause.message}` : ""
      return { attempts: [{ provider: "HTTP", status: "error", message: `${message}${cause}` }] }
    }
  }
}
