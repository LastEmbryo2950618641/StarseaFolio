import type { PhaseResultEnvelope, ProjectSettings } from "@starseafolio/contracts"
import { defaultProjectSettings } from "@starseafolio/config"

import { digest } from "../../core/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import { scoreWebSearchHit } from "../retrieval/web-search-relevance.js"
import {
  entitySearchQueries,
  readLocalOriginalWorkReferences,
  referenceCoversQueries,
  referenceExcerpt,
  saveOriginalWorkWebReferences,
  type LocalOriginalWorkReferences,
} from "./original-work-reference-store.js"
import type { TurnReadEvidence } from "../turns/ports/ai-model-port.js"
import type {
  WebResearchPort,
  WebResearchFetchDetail,
  WebResearchProviderAttempt,
  WebResearchSearchDetail,
  WebSearchHit,
} from "../retrieval/ports/web-research-port.js"

export type SynopsisWebReadStreamUpdate = Readonly<{
  query: string
  status: "running" | "completed" | "failed"
  resultSummary?: string
}>

/**
 * Execute `sourceKinds: ["web"]` reads for synopsis ReAct and return model-visible evidence.
 * Always returns at least one diagnostic evidence item when search fails or returns empty.
 */
export async function executeSynopsisWebReads(input: Readonly<{
  requests: PhaseResultEnvelope["requestedReads"]
  existingEvidence: readonly TurnReadEvidence[]
  createId: () => string
  webResearch?: WebResearchPort
  settings?: ProjectSettings
  localReferences?: LocalOriginalWorkReferences
}>): Promise<readonly TurnReadEvidence[]> {
  const seen = new Set(input.existingEvidence.map((item) => `${item.ownerId}:${item.digest}`))
  const seenSearchOwners = new Set(input.existingEvidence
    .filter((item) => item.ownerKind === "web:search")
    .map((item) => item.ownerId))
  const collected: TurnReadEvidence[] = []

  for (const request of input.requests) {
    const explicitUrls = [...new Set(request.query.exactKeys.map((key) => key.trim()).filter((key) => /^https?:\/\//iu.test(key)))]
    const queries = resolveWebQueries(request)
    if (queries.length === 0 && explicitUrls.length === 0) continue
    const queryLabel = [...queries, ...explicitUrls].join("；")

    if (input.localReferences !== undefined && queries.length > 0) {
      const local = await readLocalOriginalWorkReferences({ local: input.localReferences, queries, createId: input.createId })
      for (const item of local.evidence) {
        const key = `${item.ownerId}:${item.digest}`
        if (!seen.has(key)) { seen.add(key); collected.push(item) }
      }
      if (local.covered) continue
    }
    if (input.settings !== undefined && !input.settings.retrieval.webResearchEnabled) {
      collected.push(buildDisabledEvidence(queryLabel, input.createId))
      continue
    }
    const port = input.webResearch
    if (port === undefined) {
      collected.push(buildDiagnosticEvidence(
        queryLabel,
        renderRuntimePrompt("discuss-evidence", "web-port-missing"),
        [],
        input.createId,
      ))
      continue
    }

    const maxResults = Math.min(
      request.query.maxCandidates,
      input.settings?.retrieval.maxWebResults ?? defaultProjectSettings.retrieval.maxWebResults,
    )
    if (maxResults <= 0) continue

    try {
      const attempts: WebResearchProviderAttempt[] = []
      const pageFailures: WebResearchProviderAttempt[] = []
      const rankedHits: Array<{ query: string; hit: WebSearchHit; score: number }> = []
      const perQueryLimit = Math.max(1, Math.ceil(maxResults / Math.max(1, queries.length)))
      let rawHitCount = 0

      const search = async (query: string): Promise<boolean> => {
        const detail = await searchWebDetailed(port, {
          query,
          maxResults: perQueryLimit,
          signal: AbortSignal.timeout(8_000),
        })
        attempts.push(...detail.attempts)
        rawHitCount += detail.hits.length
        for (const hit of detail.hits) {
          const score = scoreWebSearchHit(query, hit)
          if (score > 0) rankedHits.push({ query, hit, score })
        }
        return rankedHits.length > 0
      }
      // Explicit addresses are page reads, not search terms. Descriptions of desired
      // evidence must not become literal keywords that reject otherwise valid pages.
      if (explicitUrls.length === 0) {
        for (const query of queries) await search(query)
        if (rankedHits.length === 0) {
          for (const query of entitySearchQueries(queries, request.query.entityHints)) {
            if (await search(query)) break
          }
        }
      }

      rankedHits.sort((left, right) => right.score - left.score)
      const savedPages: Array<{ url: string; title: string; text: string }> = []
      const fetchedUrls = new Set<string>()
      const pageCandidates = explicitUrls.length > 0
        ? explicitUrls.map((url) => ({ url, queries }))
        : diversePageCandidates(rankedHits)
      for (const candidate of pageCandidates) {
        if (fetchedUrls.size >= Math.min(4, maxResults) || savedPages.length >= 2) break
        if (fetchedUrls.has(candidate.url)) continue
        fetchedUrls.add(candidate.url)
        // A blocked site must not discard successful results from another source.
        try {
          const detail = await fetchWebPageDetailed(port, candidate.url)
          const page = detail.page
          if (page === undefined) {
            pageFailures.push(...detail.attempts.map((attempt) => ({ ...attempt, provider: `${attempt.provider} ${candidate.url}` })))
            continue
          }
          const excerpt = candidate.queries.length === 0
            ? page.text.trim().slice(0, 10_000)
            : referenceExcerpt(page.text, candidate.queries)
          if (!referenceCoversQueries(excerpt, [])
            || (candidate.queries.length > 0 && !candidate.queries.some((query) => referenceCoversQueries(excerpt, [query])))) {
            pageFailures.push({
              provider: candidate.url,
              status: "empty",
              message: renderRuntimePrompt("discuss-evidence", "web-page-excerpt-unmatched"),
            })
            continue
          }
          const semanticText = renderRuntimePrompt("discuss-evidence", "web-page-evidence", {
            title: page.title,
            url: page.url,
            notice: renderRuntimePrompt("discuss-evidence", "web-page"),
            excerpt,
          })
          const item: TurnReadEvidence = {
            readId: input.createId(), visibility: "committed", ownerKind: "web:page", ownerId: page.url,
            exactKeys: [page.url, ...queries], semanticText, digest: digest(semanticText),
            sourceRefs: [{ sourceKind: "web", url: page.url, title: page.title, query: queries.join("；") }],
          }
          const key = `${item.ownerId}:${item.digest}`
          if (!seen.has(key)) { seen.add(key); collected.push(item) }
          savedPages.push({ url: page.url, title: page.title, text: excerpt })
        } catch (error) {
          pageFailures.push({ provider: candidate.url, status: "error", message: error instanceof Error ? error.message : String(error) })
        }
      }
      if (input.localReferences !== undefined && savedPages.length > 0) {
        try {
          await saveOriginalWorkWebReferences({ local: input.localReferences, queries: queries.length > 0 ? queries : explicitUrls, pages: savedPages })
        } catch (error) {
          collected.push(buildDiagnosticEvidence(
            queryLabel,
            renderRuntimePrompt("discuss-evidence", "web-reference-save-failed", {
              reason: error instanceof Error ? error.message : String(error),
            }),
            [],
            input.createId,
          ))
        }
      }
      for (const { query, hit } of rankedHits.slice(0, maxResults)) {
        if (savedPages.some((page) => page.url === hit.url)) continue
        if (seenSearchOwners.has(hit.url)) continue
        const evidence = buildSearchHitEvidence(query, hit, input.createId, queries)
        const key = `${evidence.ownerId}:${evidence.digest}`
        if (seen.has(key)) continue
        seen.add(key)
        seenSearchOwners.add(hit.url)
        collected.push(evidence)
      }
      if (rankedHits.length > 0 || savedPages.length > 0) {
        if (savedPages.length === 0) {
          collected.push(buildDiagnosticEvidence(queryLabel, renderRuntimePrompt("discuss-evidence", "web-no-readable-page"), pageFailures, input.createId))
        }
        continue
      }

      const providerHitCount = attempts.reduce((total, attempt) => total + (attempt.hitCount ?? 0), 0)
      const summary = explicitUrls.length > 0
        ? renderRuntimePrompt("discuss-evidence", "web-explicit-page-unavailable")
        : rawHitCount > 0 || providerHitCount > 0
        ? renderRuntimePrompt("discuss-evidence", "web-query-unmatched")
        : formatFailureSummary(attempts)
      const diagnostic = buildDiagnosticEvidence(queryLabel, summary, [...attempts, ...pageFailures], input.createId)
      const key = `${diagnostic.ownerId}:${diagnostic.digest}`
      if (!seen.has(key)) {
        seen.add(key)
        collected.push(diagnostic)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const diagnostic = buildDiagnosticEvidence(
        queryLabel,
        renderRuntimePrompt("discuss-evidence", "web-search-exception", { reason: message }),
        [{ provider: "composite", status: "error", message }],
        input.createId,
      )
      const key = `${diagnostic.ownerId}:${diagnostic.digest}`
      if (!seen.has(key)) {
        seen.add(key)
        collected.push(diagnostic)
      }
    }
  }

  return collected
}

/** Prefer a different host before spending the bounded page budget on the same site. */
function diversePageCandidates(hits: readonly Readonly<{ query: string; hit: WebSearchHit }>[]): Array<{ url: string; queries: string[] }> {
  const byUrl = new Map<string, { url: string; queries: string[] }>()
  for (const { query, hit } of hits) {
    const candidate = byUrl.get(hit.url)
    if (candidate === undefined) byUrl.set(hit.url, { url: hit.url, queries: [query] })
    else if (!candidate.queries.includes(query)) candidate.queries.push(query)
  }
  const hosts = new Set<string>()
  const first: Array<{ url: string; queries: string[] }> = []
  const rest: Array<{ url: string; queries: string[] }> = []
  for (const candidate of byUrl.values()) {
    let host = candidate.url
    try { host = new URL(candidate.url).hostname } catch { /* fetch layer reports invalid URLs */ }
    if (hosts.has(host)) rest.push(candidate)
    else { hosts.add(host); first.push(candidate) }
  }
  return [...first, ...rest]
}

async function fetchWebPageDetailed(port: WebResearchPort, url: string): Promise<WebResearchFetchDetail> {
  const input = { url, signal: AbortSignal.timeout(8_000) }
  if (port.fetchPageDetailed !== undefined) return port.fetchPageDetailed(input)
  const page = await port.fetchPage(input)
  return page === undefined
    ? { attempts: [{ provider: "HTTP", status: "empty", message: renderRuntimePrompt("discuss-evidence", "web-page-empty") }] }
    : { page, attempts: [] }
}

async function searchWebDetailed(
  port: WebResearchPort,
  input: Readonly<{ query: string; maxResults: number; signal?: AbortSignal }>,
): Promise<WebResearchSearchDetail> {
  if (port.searchDetailed !== undefined) {
    return port.searchDetailed(input)
  }
  try {
    const hits = await port.search(input)
    return {
      hits,
      attempts: hits.length === 0
        ? [{ provider: "default", status: "empty" }]
        : [{ provider: "default", status: "ok", hitCount: hits.length }],
    }
  } catch (error) {
    return {
      hits: [],
      attempts: [{
        provider: "default",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      }],
    }
  }
}

function resolveWebQueries(request: PhaseResultEnvelope["requestedReads"][number]): string[] {
  const queries = [...request.query.exactKeys, ...request.query.semanticTexts]
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !/^https?:\/\//iu.test(term))
  if (queries.length === 0 && !request.query.exactKeys.some((key) => /^https?:\/\//iu.test(key.trim()))) {
    const fallback = request.expectedEvidence.slice(0, 200).trim()
    return fallback.length === 0 ? [] : [fallback]
  }
  return [...new Set(queries)].slice(0, Math.max(1, request.query.maxCandidates))
}

function buildSearchHitEvidence(
  query: string,
  hit: WebSearchHit,
  createId: () => string,
  originalQueries: readonly string[],
): TurnReadEvidence {
  const semanticText = formatWebSearchHitEvidence(query, hit)
  return {
    readId: createId(),
    visibility: "committed",
    ownerKind: "web:search",
    ownerId: hit.url,
    exactKeys: [...new Set([hit.url, hit.title, query, ...originalQueries])],
    semanticText,
    sourceRefs: [{ sourceKind: "web", url: hit.url, title: hit.title, query }],
    digest: digest(semanticText),
  }
}

function buildDiagnosticEvidence(
  query: string,
  summary: string,
  attempts: readonly WebResearchProviderAttempt[],
  createId: () => string,
): TurnReadEvidence {
  const semanticText = formatWebDiagnosticEvidence(query, summary, attempts)
  const ownerId = `web:diagnostic:${query}`
  return {
    readId: createId(),
    visibility: "committed",
    ownerKind: "web:diagnostic",
    ownerId,
    exactKeys: [query, ownerId],
    semanticText,
    sourceRefs: [{ sourceKind: "web", query }],
    digest: digest(semanticText),
  }
}

function buildDisabledEvidence(query: string, createId: () => string): TurnReadEvidence {
  const semanticText = renderRuntimePrompt("discuss-evidence", "web-disabled-evidence", {
    query,
    notice: renderRuntimePrompt("discuss-evidence", "web-disabled"),
  })
  const ownerId = `web:disabled:${query}`
  return {
    readId: createId(),
    visibility: "committed",
    ownerKind: "web:diagnostic",
    ownerId,
    exactKeys: [query, ownerId],
    semanticText,
    sourceRefs: [{ sourceKind: "web", query }],
    digest: digest(semanticText),
  }
}

function formatFailureSummary(attempts: readonly WebResearchProviderAttempt[]): string {
  if (attempts.length === 0) return renderRuntimePrompt("discuss-evidence", "web-failure-no-response")
  const errors = attempts.filter((attempt) => attempt.status === "error")
  if (errors.length === attempts.length) {
    return renderRuntimePrompt("discuss-evidence", "web-failure-all-errors", {
      details: errors.map(formatAttempt).join("；"),
    })
  }
  const empties = attempts.filter((attempt) => attempt.status === "empty")
  if (empties.length === attempts.length) {
    return renderRuntimePrompt("discuss-evidence", "web-failure-no-matches")
  }
  if (errors.length > 0) {
    return renderRuntimePrompt("discuss-evidence", "web-failure-partial", {
      details: errors.map(formatAttempt).join("；"),
    })
  }
  return renderRuntimePrompt("discuss-evidence", "web-failure-none")
}

function formatAttempt(attempt: WebResearchProviderAttempt): string {
  const detail = attempt.message === undefined ? "" : `（${attempt.message}）`
  if (attempt.status === "ok") {
    return renderRuntimePrompt("discuss-evidence", "web-attempt-ok", {
      provider: attempt.provider,
      hitCount: attempt.hitCount ?? 0,
      detail,
    })
  }
  if (attempt.status === "empty") {
    return renderRuntimePrompt("discuss-evidence", "web-attempt-empty", { provider: attempt.provider })
  }
  return renderRuntimePrompt("discuss-evidence", "web-attempt-error", {
    provider: attempt.provider,
    detail,
  })
}

function formatWebSearchHitEvidence(
  query: string,
  hit: Readonly<{ title: string; url: string; snippet: string }>,
): string {
  return [
    renderRuntimePrompt("discuss-evidence", "web-search-hit-evidence", {
      query,
      title: hit.title,
      url: hit.url,
    }),
    ...(hit.snippet.length === 0
      ? []
      : [renderRuntimePrompt("discuss-evidence", "web-search-hit-snippet", { snippet: hit.snippet })]),
    "",
    renderRuntimePrompt("discuss-evidence", "web-search-snippet"),
  ].join("\n")
}

function formatWebDiagnosticEvidence(
  query: string,
  summary: string,
  attempts: readonly WebResearchProviderAttempt[],
): string {
  const attemptLines = attempts.length === 0
    ? [renderRuntimePrompt("discuss-evidence", "web-diagnostic-no-attempts")]
    : attempts.map((attempt) => `- ${formatAttempt(attempt)}`)
  return [
    renderRuntimePrompt("discuss-evidence", "web-diagnostic-evidence", { query, summary }),
    ...attemptLines,
    "",
    renderRuntimePrompt("discuss-evidence", "web-diagnostic"),
  ].join("\n")
}
