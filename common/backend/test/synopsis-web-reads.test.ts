import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { WorkspaceCatalogSnapshot } from "@starseafolio/contracts"

import { executeSynopsisWebReads } from "../src/application/chapters/synopsis-web-reads.js"
import type { WebResearchPort, WebResearchSearchDetail } from "../src/application/retrieval/ports/web-research-port.js"
import { FakeWebResearchAdapter } from "../src/infrastructure/web-research/duckduckgo-web-research-adapter.js"
import { CompositeWebResearchAdapter } from "../src/infrastructure/web-research/composite-web-research-adapter.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function localReferenceFixture() {
  const workspaceRootRef = await mkdtemp(join(tmpdir(), "starsea-reference-"))
  temporaryRoots.push(workspaceRootRef)
  const workspace = new NodeWorkspaceAdapter()
  const catalog: WorkspaceCatalogSnapshot = {
    snapshotId: "snap", projectId: "11111111-1111-4111-8111-111111111111", createdAtMs: 1, digest: "catalog",
    entries: [{ relativePath: "设定集/人物.md", entryKind: "file", role: "settings", version: 1, digest: "settings", size: 200 }],
  }
  return { workspace, workspaceRootRef, catalog, now: () => 1_794_038_400_000 }
}

const shinjiRead = {
  requestId: "r-shinji", reason: "核对人物契约", expectedEvidence: "慎二通过伪臣之书控制 Rider 的契约",
  query: { sourceKinds: ["web" as const], exactKeys: [], semanticTexts: ["间桐慎二 Rider 伪臣之书 契约"], maxCandidates: 5 },
}

describe("executeSynopsisWebReads", () => {
  it("fetches an explicit URL directly even without a search phrase or expected-evidence text", async () => {
    const searched: string[] = []
    const fetched: string[] = []
    const url = "https://example.com/shinji"
    const port: WebResearchPort = {
      search: ({ query }) => { searched.push(query); return Promise.resolve([]) },
      fetchPage: ({ url: target }) => {
        fetched.push(target)
        return Promise.resolve({ url: target, title: "间桐慎二", text: "间桐慎二是间桐樱的哥哥，与 Rider 的契约借助伪臣之书成立。" })
      },
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{ ...shinjiRead, expectedEvidence: "", query: { ...shinjiRead.query, exactKeys: [url], semanticTexts: [] } }],
      existingEvidence: [], createId: () => "direct", webResearch: port,
    })
    expect(fetched).toEqual([url])
    expect(searched).toEqual([])
    expect(evidence.find((item) => item.ownerKind === "web:page")?.semanticText).toContain("伪臣之书")
  })

  it("does not turn a verbose expected-evidence description into a mandatory page keyword", async () => {
    const url = "https://example.com/shinji"
    const port: WebResearchPort = {
      search: () => Promise.reject(new Error("An explicit page must not run a search")),
      fetchPage: () => Promise.resolve({ url, title: "间桐慎二", text: "间桐慎二是间桐樱的哥哥，也是 Rider 的代理御主。" }),
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{ ...shinjiRead, expectedEvidence: "慎二条目正文：间桐家系位置、脏砚与樱的关系、三条路线中的结局差异。",
        query: { ...shinjiRead.query, exactKeys: [url], semanticTexts: [], readMode: "read_full" } }],
      existingEvidence: [], createId: () => "direct", webResearch: port,
    })
    expect(evidence.some((item) => item.ownerKind === "web:page")).toBe(true)
  })

  it("keeps a page relevant to one requested topic without requiring every topic on that page", async () => {
    const url = "https://example.com/shinji"
    const port: WebResearchPort = {
      search: ({ query }) => Promise.resolve(query.includes("慎二")
        ? [{ url, title: "间桐慎二 Rider 伪臣之书 契约", snippet: "人物原作说明。" }] : []),
      fetchPage: () => Promise.resolve({ url, title: "间桐慎二", text: "间桐慎二通过伪臣之书管理 Rider 的契约。" }),
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{ ...shinjiRead, query: { ...shinjiRead.query, semanticTexts: ["间桐慎二 Rider 伪臣之书 契约", "第五次圣杯战争 冬木市 时间线"] } }],
      existingEvidence: [], createId: () => "topic", webResearch: port,
    })
    expect(evidence.some((item) => item.ownerKind === "web:page" && item.semanticText.includes("伪臣之书"))).toBe(true)
  })

  it("returns the page failure reason and URL instead of silently reporting no evidence", async () => {
    const url = "https://example.com/blocked"
    const port: WebResearchPort = {
      search: () => Promise.resolve([]), fetchPage: () => Promise.resolve(undefined),
      fetchPageDetailed: () => Promise.resolve({ attempts: [{ provider: "HTTP", status: "error", message: "Web fetch failed (403)" }] }),
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{ ...shinjiRead, query: { ...shinjiRead.query, exactKeys: [url], semanticTexts: [] } }],
      existingEvidence: [], createId: () => "failure", webResearch: port,
    })
    expect(evidence.some((item) => item.ownerKind === "web:page")).toBe(false)
    expect(evidence.map((item) => item.semanticText).join("\n")).toContain("403")
    expect(evidence.map((item) => item.semanticText).join("\n")).toContain(url)
  })

  it("tries another host after two blocked sources while keeping the page budget bounded", async () => {
    const fetched: string[] = []
    const urls = ["https://blocked-a.example/shinji", "https://blocked-a.example/shinji-2", "https://blocked-b.example/shinji", "https://readable.example/shinji", "https://unused.example/shinji"]
    const port: WebResearchPort = {
      search: () => Promise.resolve(urls.map((url) => ({ url, title: shinjiRead.query.semanticTexts[0] ?? "", snippet: "人物原作说明" }))),
      fetchPage: ({ url }) => {
        fetched.push(url)
        if (!url.includes("readable.example")) return Promise.reject(new Error("HTTP 403"))
        return Promise.resolve({ url, title: "间桐慎二", text: "间桐慎二通过伪臣之书管理 Rider 的契约。" })
      },
    }
    const evidence = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "bounded", webResearch: port })
    expect(evidence.find((item) => item.ownerKind === "web:page")?.ownerId).toBe("https://readable.example/shinji")
    expect(fetched.slice(0, 3)).toEqual([urls[0], urls[2], urls[3]])
    expect(fetched).toHaveLength(4)
  })

  it("keeps read diagnostics even when all search URLs were already returned in a previous round", async () => {
    const port = new FakeWebResearchAdapter({
      [shinjiRead.query.semanticTexts[0] ?? ""]: [{ title: "间桐慎二 Rider 伪臣之书 契约", url: "https://example.com/shinji", snippet: "人物说明" }],
    })
    const first = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "first", webResearch: port })
    const second = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: first.filter((item) => item.ownerKind === "web:search"), createId: () => "second", webResearch: port })
    expect(second.some((item) => item.ownerKind === "web:search")).toBe(false)
    expect(second.find((item) => item.ownerKind === "web:diagnostic")?.semanticText).toContain("未取得可用正文")
  })

  it("uses actual local character settings before making any network request", async () => {
    const localReferences = await localReferenceFixture()
    await localReferences.workspace.saveUserMarkdown(localReferences.workspaceRootRef, "设定集/人物.md",
      "# 间桐慎二\n本作品中，间桐慎二与 Rider 的契约借助伪臣之书成立。用户改写优先。")
    const port: WebResearchPort = {
      search: () => Promise.reject(new Error("Local settings must prevent this network call")),
      fetchPage: () => Promise.resolve(undefined),
    }
    const evidence = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "local-1", webResearch: port, localReferences })
    expect(evidence.map((item) => item.ownerId)).toEqual(["设定集/人物.md"])
    expect(evidence[0]?.semanticText).toContain("用户改写优先")
  })

  it("falls back to an entity search, fetches its page, and reuses saved knowledge after reopening", async () => {
    const localReferences = await localReferenceFixture()
    await localReferences.workspace.saveUserMarkdown(localReferences.workspaceRootRef, "设定集/人物.md", "# 人物\n（尚无条目）")
    const port = new FakeWebResearchAdapter({
      "间桐慎二": [{ title: "间桐慎二 - Fate/stay night", url: "https://example.com/shinji", snippet: "间桐慎二是 Rider 的代理御主。" }],
    }, {
      "https://example.com/shinji": { title: "间桐慎二", url: "https://example.com/shinji", text: "间桐慎二通过伪臣之书管理与 Rider 的契约。此项原作说明来自页面正文。" },
    })
    let id = 0
    const first = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => `web-${String(++id)}`, webResearch: port, localReferences })
    expect(first.some((item) => item.ownerKind === "web:page" && item.semanticText.includes("原作说明来自页面正文"))).toBe(true)
    const folder = join(localReferences.workspaceRootRef, "参考文件", "原作资料", "网络资料")
    const files = await readdir(folder)
    expect(files).toHaveLength(1)
    const saved = await readFile(join(folder, files[0] ?? "missing.md"), "utf8")
    expect(saved).toContain("https://example.com/shinji")
    expect(saved).toContain("原作说明来自页面正文")
    const offline: WebResearchPort = {
      search: () => Promise.reject(new Error("Reopened knowledge must prevent this network call")),
      fetchPage: () => Promise.resolve(undefined),
    }
    const second = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "cached-1", webResearch: offline, localReferences: { ...localReferences, workspace: new NodeWorkspaceAdapter() } })
    expect(second.some((item) => item.ownerKind.startsWith("workspace:") && item.semanticText.includes("原作说明来自页面正文"))).toBe(true)
    expect(second.some((item) => item.ownerKind === "web:diagnostic")).toBe(false)
  })

  it("keeps partial local settings but still retrieves the missing facts", async () => {
    const localReferences = await localReferenceFixture()
    await localReferences.workspace.saveUserMarkdown(localReferences.workspaceRootRef, "设定集/人物.md", "# 间桐慎二\n间桐慎二在本作中住在海边。")
    const calls: string[] = []
    const port: WebResearchPort = {
      search: ({ query }) => {
        calls.push(query)
        return Promise.resolve([{ title: "间桐慎二 Rider 伪臣之书 契约", url: "https://example.com/shinji", snippet: "原作参考。" }])
      },
      fetchPage: () => Promise.resolve({ title: "间桐慎二", url: "https://example.com/shinji", text: "间桐慎二通过伪臣之书管理 Rider 的契约。" }),
    }
    const evidence = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "id", webResearch: port, localReferences })
    expect(calls).toEqual(shinjiRead.query.semanticTexts)
    expect(evidence.some((item) => item.ownerKind === "workspace:settings:partial" && item.semanticText.includes("海边"))).toBe(true)
    expect(evidence.some((item) => item.ownerKind === "web:page")).toBe(true)
  })

  it("associates shortened-query discovery results with the original requested read", async () => {
    const port = new FakeWebResearchAdapter({
      "间桐慎二": [{ title: "间桐慎二", url: "https://example.com/shinji", snippet: "人物条目。" }],
    })
    const evidence = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "id", webResearch: port })
    expect(evidence[0]?.ownerKind).toBe("web:search")
    expect(evidence[0]?.exactKeys).toContain(shinjiRead.query.semanticTexts[0])
    expect(evidence[0]?.semanticText).toContain("尚未核实页面正文")
  })

  it("reads local settings even without a configured internet port", async () => {
    const localReferences = await localReferenceFixture()
    await localReferences.workspace.saveUserMarkdown(localReferences.workspaceRootRef, "设定集/人物.md", "# 人设\n间桐慎二通过伪臣之书管理 Rider 的契约。")
    const evidence = await executeSynopsisWebReads({ requests: [shinjiRead], existingEvidence: [], createId: () => "id", localReferences })
    expect(evidence.map((item) => item.ownerKind)).toEqual(["workspace:settings"])
  })

  it("fetches explicit URLs and does not treat unrelated page text as verified knowledge", async () => {
    const localReferences = await localReferenceFixture()
    const fetched: string[] = []
    const port: WebResearchPort = {
      search: () => Promise.resolve([]),
      fetchPage: ({ url }) => {
        fetched.push(url)
        return Promise.resolve({ title: shinjiRead.query.semanticTexts[0] ?? "", url, text: "请登录。此页面暂时不可用。" })
      },
    }
    const evidence = await executeSynopsisWebReads({ requests: [{ ...shinjiRead, query: { ...shinjiRead.query, exactKeys: ["https://example.com/unavailable"] } }], existingEvidence: [], createId: () => "id", webResearch: port, localReferences })
    expect(fetched).toEqual(["https://example.com/unavailable"])
    expect(evidence.some((item) => item.ownerKind === "web:page")).toBe(false)
    await expect(readdir(join(localReferences.workspaceRootRef, "参考文件", "原作资料", "网络资料"))).rejects.toThrow()
  })

  it("searches every supplied phrase and excludes hits unrelated to the query", async () => {
    const searchedQueries: string[] = []
    const port: WebResearchPort = {
      searchDetailed: ({ query }) => {
        searchedQueries.push(query)
        return Promise.resolve({
          hits: query.includes("慎二")
            ? [
                { title: "间桐慎二 - Fate/stay night", url: "https://example.com/shinji", snippet: "伪臣之书使慎二能够召唤 Rider。" },
                { title: "间字释义", url: "https://example.com/jian", snippet: "间，现代汉语常用字。" },
              ]
            : [{ title: "Bilibili 首页", url: "https://example.com/bili", snippet: "视频弹幕网站。" }],
          attempts: [{ provider: "Test", status: "ok", hitCount: 2 }],
        })
      },
      search: () => Promise.resolve([]),
      fetchPage: () => Promise.resolve(undefined),
    }

    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "核对慎二与 Rider",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["间桐慎二 Rider 伪臣之书 契约", "Fate/stay night 間桐慎二 魔術回路"],
          maxCandidates: 5,
        },
        expectedEvidence: "",
      }],
      existingEvidence: [],
      createId: (() => { let id = 0; return () => `id-${String(++id)}` })(),
      webResearch: port,
    })

    expect(searchedQueries).toEqual([
      "间桐慎二 Rider 伪臣之书 契约",
      "Fate/stay night 間桐慎二 魔術回路",
    ])
    expect(evidence.filter((item) => item.ownerKind === "web:search").map((item) => item.ownerId)).toEqual(["https://example.com/shinji"])
    expect(evidence.find((item) => item.ownerKind === "web:diagnostic")?.semanticText).toContain("未取得可用正文")
  })

  it("returns a diagnostic instead of treating zero relevant hits as evidence", async () => {
    const port = new FakeWebResearchAdapter({
      "Fate/stay night 第五次圣杯战争 时间 冬木市": [
        { title: "Bilibili 首页", url: "https://example.com/bili", snippet: "视频弹幕网站。" },
      ],
    })
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "核验原作背景",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Fate/stay night 第五次圣杯战争 时间 冬木市"],
          maxCandidates: 5,
        },
        expectedEvidence: "原作时间线",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.ownerKind).toBe("web:diagnostic")
    expect(evidence[0]?.semanticText).toContain("未命中查询关键词")
    expect(evidence[0]?.semanticText).not.toContain("Bilibili 首页")
  })

  it("rejects franchise-only hits that do not answer a specific character query", async () => {
    const port = new FakeWebResearchAdapter({
      "Fate stay night Matou Shinji Rider False Attendant Book": [
        { title: "Fate franchise overview", url: "https://example.com/fate", snippet: "Fate/stay night is a TYPE-MOON visual novel series." },
      ],
    })
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "核验慎二与 Rider 的契约",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Fate stay night Matou Shinji Rider False Attendant Book"],
          maxCandidates: 5,
        },
        expectedEvidence: "慎二如何使用伪臣之书控制 Rider",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })

    expect(evidence[0]?.ownerKind).toBe("web:diagnostic")
    expect(evidence[0]?.semanticText).toContain("未命中查询关键词")
  })

  it("keeps related franchise links as search leads without treating them as verified page evidence", async () => {
    const port = new FakeWebResearchAdapter({
      "Fate/stay night 第五次圣杯战争 时间 冬木市": [
        { title: "Fate/Zero 第一季", url: "https://example.com/fate-zero", snippet: "作为 Fate/stay night 的前传，故事发生在第五次圣杯战争十年前。" },
      ],
    })
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "核验第五次圣杯战争时间与舞台",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Fate/stay night 第五次圣杯战争 时间 冬木市"],
          maxCandidates: 5,
        },
        expectedEvidence: "第五次圣杯战争时间与冬木市舞台",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })

    expect(evidence[0]?.ownerKind).toBe("web:search")
    expect(evidence.some((item) => item.ownerKind === "web:page")).toBe(false)
    expect(evidence.some((item) => item.ownerKind === "web:diagnostic")).toBe(true)
  })

  it("reports returned but filtered provider hits as an irrelevant-result diagnostic", async () => {
    const port: WebResearchPort = {
      searchDetailed: () => Promise.resolve({
        hits: [],
        attempts: [
          { provider: "Bing China", status: "ok", hitCount: 6 },
          { provider: "DuckDuckGo", status: "error", message: "network timeout" },
        ],
      }),
      search: () => Promise.resolve([]),
      fetchPage: () => Promise.resolve(undefined),
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "核验原作事实",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Fate stay night Matou Shinji Rider False Attendant Book"],
          maxCandidates: 5,
        },
        expectedEvidence: "慎二如何控制 Rider",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })

    expect(evidence[0]?.semanticText).toContain("未命中查询关键词")
    expect(evidence[0]?.semanticText).toContain("Bing China：6 条")
    expect(evidence[0]?.semanticText).toContain("DuckDuckGo：失败")
  })

  it("returns search hit evidence for the model", async () => {
    const port = new FakeWebResearchAdapter({
      "Brythonic names": [{
        title: "Brythonic names: Example",
        url: "https://example.com/names",
        snippet: "A list of names.",
      }],
    })
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "test",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Brythonic names"],
          maxCandidates: 5,
        },
        expectedEvidence: "",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })
    expect(evidence.filter((item) => item.ownerKind === "web:search")).toHaveLength(1)
    expect(evidence[0]?.ownerKind).toBe("web:search")
    expect(evidence[0]?.semanticText).toContain("联网检索结果")
    expect(evidence[0]?.semanticText).toContain("https://example.com/names")
  })

  it("returns diagnostic evidence when all providers fail", async () => {
    const failing: WebResearchPort = {
      search: () => Promise.reject(new Error("network timeout")),
      fetchPage: () => Promise.resolve(undefined),
    }
    const port = new CompositeWebResearchAdapter({
      providers: [{ name: "Test", port: failing }],
    })
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "test",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: ["Roman Britain names"],
          maxCandidates: 3,
        },
        expectedEvidence: "",
      }],
      existingEvidence: [],
      createId: () => "id-1",
      webResearch: port,
    })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.ownerKind).toBe("web:diagnostic")
    expect(evidence[0]?.semanticText).toContain("联网检索未成功")
    expect(evidence[0]?.semanticText).toContain("network timeout")
  })

  it("returns diagnostic evidence when providers return empty hits", async () => {
    const port: WebResearchPort = {
      searchDetailed: (): Promise<WebResearchSearchDetail> => Promise.resolve({
        hits: [],
        attempts: [
          { provider: "Bing China", status: "empty" },
          { provider: "DuckDuckGo", status: "empty" },
        ],
      }),
      search: () => Promise.resolve([]),
      fetchPage: () => Promise.resolve(undefined),
    }
    const evidence = await executeSynopsisWebReads({
      requests: [{
        requestId: "r1",
        reason: "test",
        query: {
          sourceKinds: ["web"],
          exactKeys: [],
          semanticTexts: [" obscure query "],
          maxCandidates: 3,
        },
        expectedEvidence: "",
      }],
      existingEvidence: [],
      createId: () => "id-2",
      webResearch: port,
    })
    expect(evidence[0]?.semanticText).toContain("各搜索引擎均无匹配结果")
  })
})
