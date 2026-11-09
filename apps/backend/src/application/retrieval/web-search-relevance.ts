import type { WebSearchHit } from "./ports/web-research-port.js"

const GENERIC_QUERY_TERMS = new Set([
  "的", "了", "和", "与", "及", "在", "如何", "什么", "资料", "介绍", "相关", "信息",
])
const MINIMUM_RELEVANCE_RATIO = 0.5

export function scoreWebSearchHit(query: string, hit: WebSearchHit): number {
  const terms = [...new Set(tokenizeSearchTerms(query)
    .filter((term) => term.length > 0 && !GENERIC_QUERY_TERMS.has(term)))]
  if (terms.length === 0) return 0

  const searchableText = normalizeSearchTerm(`${hit.title} ${hit.snippet}`)
  const matchedTerms = terms.filter((term) => searchableText.includes(term)).length
  const minimumMatches = Math.min(2, terms.length)
  if (matchedTerms < minimumMatches) return 0

  const ratio = matchedTerms / terms.length
  return ratio >= MINIMUM_RELEVANCE_RATIO ? ratio : 0
}

function tokenizeSearchTerms(value: string): string[] {
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [])
    .map(normalizeSearchTerm)
}

function normalizeSearchTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}
