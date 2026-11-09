import { describe, expect, it, vi } from "vitest"
import type { WebResearchPort } from "../src/application/retrieval/ports/web-research-port.js"
import { scoreWebSearchHit } from "../src/application/retrieval/web-search-relevance.js"
import { WebResearchHttpClient } from "../src/infrastructure/web-research/web-research-http.js"

describe("page fetch diagnostics", () => {
  it("preserves an HTTP rejection for callers that need diagnostics", async () => {
    const client = new WebResearchHttpClient()
    const read = vi.spyOn(client, "readText").mockRejectedValue(new Error("Web fetch failed (403) for https://8.8.8.8/page"))
    const detail = await client.fetchPageDetailed({ url: "https://8.8.8.8/page" })
    expect(detail.page).toBeUndefined()
    expect(detail.attempts[0]?.message).toContain("403")
    expect(read).toHaveBeenCalledOnce()
  })

  it("does not return a verification screen as article evidence", async () => {
    const client = new WebResearchHttpClient()
    vi.spyOn(client, "readText").mockResolvedValue('<title>安全验证</title><p>请完成验证码后继续访问。</p>')
    const detail = await client.fetchPageDetailed({ url: "https://8.8.8.8/page" })
    expect(detail.page).toBeUndefined()
    expect(detail.attempts[0]?.message).toContain("验证")
  })

  it("can still read an article about CAPTCHA rather than mistaking the topic for a challenge", async () => {
    const client = new WebResearchHttpClient()
    vi.spyOn(client, "readText").mockResolvedValue('<title>CAPTCHA - Wikipedia</title><p>A CAPTCHA is a type of challenge-response test used in computing.</p>')
    expect((await client.fetchPageDetailed({ url: "https://8.8.8.8/page" })).page?.text).toContain("challenge-response")
  })
})

describe("web search relevance", () => {
  it("keeps relevant mixed-script Fate canon results instead of collapsing the query into one token", () => {
    const query = "Fate/stay night official visual novel TYPE-MOON"
    expect(scoreWebSearchHit(query, {
      title: "Fate/stay night（TYPE-MOON发行的文字冒险游戏）_百度百科",
      url: "https://baike.baidu.com/item/fate/stay%20night/35179",
      snippet: "《Fate/stay night》是TYPE-MOON开发并于2004年发售的PC平台文字冒险游戏。",
    })).toBeGreaterThan(0)
  })

  it("still rejects results that match fewer than two meaningful query terms", () => {
    expect(scoreWebSearchHit("Fate stay night", {
      title: "Late Night Bistro", url: "https://example.com/late-night", snippet: "A restaurant story.",
    })).toBe(0)
  })
})

import {
  FakeWebResearchAdapter,
  parseDuckDuckGoHits,
  parseBingChinaHits,
  mergeWebSearchHits,
  CompositeWebResearchAdapter,
  assertPublicHttpUrl,
  isPrivateOrSpecialIp,
  htmlToPlainText,
} from "../src/infrastructure/web-research/index.js"

describe("web url safety", () => {
  it("blocks private and special-use addresses", () => {
    expect(isPrivateOrSpecialIp("127.0.0.1")).toBe(true)
    expect(isPrivateOrSpecialIp("10.0.0.8")).toBe(true)
    expect(isPrivateOrSpecialIp("192.168.1.1")).toBe(true)
    expect(isPrivateOrSpecialIp("169.254.169.254")).toBe(true)
    expect(isPrivateOrSpecialIp("::1")).toBe(true)
    expect(isPrivateOrSpecialIp("8.8.8.8")).toBe(false)
  })

  it("rejects non-http URLs and localhost hosts", () => {
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http/)
    expect(() => assertPublicHttpUrl("http://localhost/admin")).toThrow(/Blocked/)
    expect(() => assertPublicHttpUrl("https://example.com/path")).not.toThrow()
  })

  it("strips scripts when converting HTML to text", () => {
    expect(htmlToPlainText("<p>hello</p><script>alert(1)</script><p>world</p>")).toBe("hello\n world")
  })
})

describe("duckduckgo hit parsing", () => {
  it("extracts titles, urls, and snippets from HTML results", () => {
    const html = `
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha">Alpha Title</a>
      <a class="result__snippet" href="#">Alpha snippet about research.</a>
      <a rel="nofollow" class="result__a" href="https://example.com/beta">Beta Title</a>
      <a class="result__snippet" href="#">Beta snippet.</a>
    `
    expect(parseDuckDuckGoHits(html, 2)).toEqual([
      {
        title: "Alpha Title",
        url: "https://example.com/alpha",
        snippet: "Alpha snippet about research.",
      },
      {
        title: "Beta Title",
        url: "https://example.com/beta",
        snippet: "Beta snippet.",
      },
    ])
  })
})

describe("bing china hit parsing", () => {
  it("preserves the whole snippet when search keywords have nested emphasis", () => {
    const html = '<li class="b_algo"><h2><a href="https://example.com/shinji">间桐慎二</a></h2><p class="b_lineclamp2"><strong>Fate</strong> 中的间桐慎二通过<strong>伪臣之书</strong>控制 Rider。</p></li>'
    expect(parseBingChinaHits(html, 1)[0]?.snippet).toBe("Fate 中的间桐慎二通过 伪臣之书 控制 Rider。")
  })

  it("extracts organic b_algo results", () => {
    const html = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="https://zh.wikipedia.org/wiki/Romano-British">Romano-British</a></h2>
          <div class="b_caption"><p class="b_lineclamp2">不列颠罗马时期居民概述。</p></div>
        </li>
        <li class="b_algo">
          <h2><a href="https://example.com/names">Early British names</a></h2>
          <p>Name lists and etymology.</p>
        </li>
      </ol>
    `
    expect(parseBingChinaHits(html, 5)).toEqual([
      {
        title: "Romano-British",
        url: "https://zh.wikipedia.org/wiki/Romano-British",
        snippet: "不列颠罗马时期居民概述。",
      },
      {
        title: "Early British names",
        url: "https://example.com/names",
        snippet: "Name lists and etymology.",
      },
    ])
  })
})

describe("composite web research", () => {
  it("does not refetch the same blocked page through search providers when a shared page fetcher is configured", async () => {
    const fetcher = { search: () => Promise.resolve([]), fetchPage: vi.fn().mockResolvedValue(undefined) }
    const provider = { search: () => Promise.resolve([]), fetchPage: vi.fn().mockResolvedValue(undefined) }
    const composite = new CompositeWebResearchAdapter({ providers: [provider], pageFetcher: fetcher })
    await composite.fetchPage({ url: "https://example.com/blocked" })
    expect(fetcher.fetchPage).toHaveBeenCalledOnce()
    expect(provider.fetchPage).not.toHaveBeenCalled()
  })

  it("does not restart page fetching through other providers after the deadline expires", async () => {
    const controller = new AbortController()
    let fallbackCalls = 0
    const composite = new CompositeWebResearchAdapter({
      pageFetcher: { search: () => Promise.resolve([]), fetchPage: () => { controller.abort(); return Promise.resolve(undefined) } },
      providers: [{ search: () => Promise.resolve([]), fetchPage: () => { fallbackCalls++; return Promise.resolve(undefined) } }],
    })
    await expect(composite.fetchPage({ url: "https://example.com/page", signal: controller.signal })).resolves.toBeUndefined()
    expect(fallbackCalls).toBe(0)
  })

  it("merges concurrent provider hits with preference order and URL dedupe", async () => {
    const bing = new FakeWebResearchAdapter({
      names: [
        { title: "Names: Bing Hit", url: "https://example.com/a", snippet: "from bing" },
        { title: "Names Shared", url: "https://example.com/shared/", snippet: "bing shared" },
      ],
    })
    const duck = new FakeWebResearchAdapter({
      names: [
        { title: "Names: Duck Hit", url: "https://example.com/b", snippet: "from duck" },
        { title: "Names Shared Dup", url: "https://example.com/shared", snippet: "duck shared" },
      ],
    })
    const composite = new CompositeWebResearchAdapter({ providers: [bing, duck] })
    await expect(composite.search({ query: "names", maxResults: 5 })).resolves.toEqual([
      { title: "Names: Bing Hit", url: "https://example.com/a", snippet: "from bing" },
      { title: "Names Shared", url: "https://example.com/shared/", snippet: "bing shared" },
      { title: "Names: Duck Hit", url: "https://example.com/b", snippet: "from duck" },
    ])
  })

  it("survives a failing provider and still returns other hits", async () => {
    const ok = new FakeWebResearchAdapter({
      ok: [{ title: "Ok", url: "https://example.com/ok", snippet: "ok" }],
    })
    const failing: typeof ok = {
      search: () => Promise.reject(new Error("blocked")),
      fetchPage: () => Promise.resolve(undefined),
    }
    const composite = new CompositeWebResearchAdapter({ providers: [failing, ok] })
    await expect(composite.search({ query: "ok", maxResults: 3 })).resolves.toEqual([
      { title: "Ok", url: "https://example.com/ok", snippet: "ok" },
    ])
  })

  it("reports the configured provider name when a search provider rejects", async () => {
    const failing: WebResearchPort = {
      search: () => Promise.reject(new Error("network timeout")),
      fetchPage: () => Promise.resolve(undefined),
    }
    const composite = new CompositeWebResearchAdapter({ providers: [{ name: "DuckDuckGo", port: failing }] })

    await expect(composite.searchDetailed({ query: "Fate search", maxResults: 3 })).resolves.toMatchObject({
      attempts: [{ provider: "DuckDuckGo", status: "error", message: "network timeout" }],
    })
  })

  it("ranks relevant results from all providers before applying the result limit", async () => {
    const noisy = new FakeWebResearchAdapter({
      Fate: [{ title: "Bilibili 首页", url: "https://example.com/noise", snippet: "视频弹幕网站。" }],
    })
    const relevant = new FakeWebResearchAdapter({
      "Fate/stay night 第五次圣杯战争 冬木市": [{ title: "Fate/stay night 第五次圣杯战争", url: "https://example.com/fate", snippet: "冬木市的圣杯战争由御主召唤从者参与。" }],
    })
    const composite = new CompositeWebResearchAdapter({
      providers: [{ name: "Bing", port: noisy }, { name: "DuckDuckGo", port: relevant }],
    })

    await expect(composite.search({ query: "Fate/stay night 第五次圣杯战争 冬木市", maxResults: 1 }))
      .resolves.toEqual([{ title: "Fate/stay night 第五次圣杯战争", url: "https://example.com/fate", snippet: "冬木市的圣杯战争由御主召唤从者参与。" }])
  })

  it("exports merge helper used by adapters", () => {
    expect(mergeWebSearchHits([
      [{ title: "A", url: "https://a.example/", snippet: "" }],
      [{ title: "A2", url: "https://a.example", snippet: "" }, { title: "B", url: "https://b.example", snippet: "" }],
    ], 2)).toEqual([
      { title: "A", url: "https://a.example/", snippet: "" },
      { title: "B", url: "https://b.example", snippet: "" },
    ])
  })
})

describe("FakeWebResearchAdapter", () => {
  it("returns configured search hits and pages", async () => {
    const adapter = new FakeWebResearchAdapter(
      {
        tea: [{ title: "Tea", url: "https://example.com/tea", snippet: "Camellia sinensis" }],
      },
      {
        "https://example.com/tea": {
          url: "https://example.com/tea",
          title: "Tea",
          text: "Tea is a drink.",
        },
      },
    )
    await expect(adapter.search({ query: "tea", maxResults: 3 })).resolves.toEqual([
      { title: "Tea", url: "https://example.com/tea", snippet: "Camellia sinensis" },
    ])
    await expect(adapter.fetchPage({ url: "https://example.com/tea" })).resolves.toMatchObject({
      text: "Tea is a drink.",
    })
  })
})
