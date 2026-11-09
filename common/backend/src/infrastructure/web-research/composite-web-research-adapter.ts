import type {
  WebPageContent,
  WebResearchFetchInput,
  WebResearchFetchDetail,
  WebResearchPort,
  WebResearchProviderAttempt,
  WebResearchSearchDetail,
  WebResearchSearchInput,
  WebSearchHit,
} from "../../application/retrieval/ports/web-research-port.js"
import { scoreWebSearchHit } from "../../application/retrieval/web-search-relevance.js"
import { BingChinaWebResearchAdapter } from "./bing-china-web-research-adapter.js"
import { DuckDuckGoWebResearchAdapter } from "./duckduckgo-web-research-adapter.js"
import { WebResearchHttpClient } from "./web-research-http.js"

export type CompositeWebResearchProvider = Readonly<{
  name: string
  port: WebResearchPort
}>

export type CompositeWebResearchAdapterOptions = Readonly<{
  providers: readonly (WebResearchPort | CompositeWebResearchProvider)[]
  /** Shared page reader; when configured, search providers must not refetch the same URL. */
  pageFetcher?: WebResearchPort
}>

/**
 * Fan-out search across multiple providers concurrently, merge/dedupe by URL.
 * Provider order is preference order when ranking ties (Bing China first by default).
 */
export class CompositeWebResearchAdapter implements WebResearchPort {
  private readonly providers: readonly CompositeWebResearchProvider[]
  private readonly pageFetchers: readonly WebResearchPort[]

  public constructor(options: CompositeWebResearchAdapterOptions) {
    if (options.providers.length === 0) {
      throw new Error("CompositeWebResearchAdapter requires at least one provider")
    }
    this.providers = options.providers.map((entry, index) => (
      "port" in entry ? entry : { name: `provider-${String(index)}`, port: entry }
    ))
    const firstProvider = this.providers[0]
    if (firstProvider === undefined) throw new Error("CompositeWebResearchAdapter requires at least one provider")
    this.pageFetchers = options.pageFetcher === undefined
      ? [...new Set(this.providers.map((entry) => entry.port))]
      : [options.pageFetcher]
  }

  public search(input: WebResearchSearchInput): Promise<readonly WebSearchHit[]> {
    return this.searchDetailed(input).then((detail) => detail.hits)
  }

  public async searchDetailed(input: WebResearchSearchInput): Promise<WebResearchSearchDetail> {
    const query = input.query.trim()
    if (query.length === 0 || input.maxResults <= 0) {
      return { hits: [], attempts: [] }
    }
    const perProvider = Math.max(input.maxResults, Math.min(10, input.maxResults * 2))
    const settled = await Promise.allSettled(
      this.providers.map(({ name, port }) => port.search({
        query,
        maxResults: perProvider,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }).then((hits) => ({ name, hits }))),
    )
    const attempts: WebResearchProviderAttempt[] = []
    const ranked: Array<{ hit: WebSearchHit; score: number; providerIndex: number }> = []
    const seen = new Set<string>()
    for (const [providerIndex, result] of settled.entries()) {
      if (result.status === "rejected") {
        const provider = this.providers[providerIndex]
        attempts.push({
          provider: provider?.name ?? "unknown",
          status: "error",
          message: errorMessage(result.reason),
        })
        continue
      }
      const { name, hits } = result.value
      attempts.push(hits.length === 0
        ? { provider: name, status: "empty" }
        : { provider: name, status: "ok", hitCount: hits.length })
      for (const hit of hits) {
        const key = normalizeHitUrl(hit.url)
        if (seen.has(key)) continue
        const score = scoreWebSearchHit(query, hit)
        if (score > 0) {
          seen.add(key)
          ranked.push({ hit, score, providerIndex })
        }
      }
    }
    ranked.sort((left, right) => right.score - left.score || left.providerIndex - right.providerIndex)
    return { hits: ranked.slice(0, input.maxResults).map(({ hit }) => hit), attempts }
  }

  public async fetchPage(input: WebResearchFetchInput): Promise<WebPageContent | undefined> {
    return (await this.fetchPageDetailed(input)).page
  }

  public async fetchPageDetailed(input: WebResearchFetchInput): Promise<WebResearchFetchDetail> {
    const attempts: WebResearchProviderAttempt[] = []
    for (const provider of this.pageFetchers) {
      if (input.signal?.aborted === true) break
      try {
        const detail = provider.fetchPageDetailed === undefined
          ? { page: await provider.fetchPage(input), attempts: [] }
          : await provider.fetchPageDetailed(input)
        attempts.push(...detail.attempts)
        if (detail.page !== undefined) return { page: detail.page, attempts }
      } catch (error) {
        attempts.push({ provider: "page", status: "error", message: errorMessage(error) })
      }
    }
    return { attempts: attempts.length > 0 ? attempts : [{ provider: "page", status: "empty", message: "页面未返回可读正文，或读取已超时" }] }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Default stack: Bing China (domestic) + DuckDuckGo (fallback), concurrent merge. */
export function createDefaultWebResearchPort(): WebResearchPort {
  const http = new WebResearchHttpClient()
  const bing = new BingChinaWebResearchAdapter()
  const duck = new DuckDuckGoWebResearchAdapter()
  return new CompositeWebResearchAdapter({
    providers: [
      { name: "Bing China", port: bing },
      { name: "DuckDuckGo", port: duck },
    ],
    pageFetcher: {
      search: () => Promise.resolve([]),
      fetchPage: (input) => http.fetchPage(input),
      fetchPageDetailed: (input) => http.fetchPageDetailed(input),
    },
  })
}

export function mergeWebSearchHits(
  providerHitLists: readonly (readonly WebSearchHit[])[],
  maxResults: number,
): readonly WebSearchHit[] {
  const ranked: WebSearchHit[] = []
  const seen = new Set<string>()
  for (const hits of providerHitLists) {
    for (const hit of hits) {
      const key = normalizeHitUrl(hit.url)
      if (seen.has(key)) continue
      seen.add(key)
      ranked.push(hit)
      if (ranked.length >= maxResults) return ranked
    }
  }
  return ranked
}

function normalizeHitUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString().replace(/\/$/u, "").toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}
