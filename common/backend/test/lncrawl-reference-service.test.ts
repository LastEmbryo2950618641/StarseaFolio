import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32 } from "node:zlib"
import { afterEach, expect, it, vi } from "vitest"
import { LncrawlReferenceService } from "../src/infrastructure/web-research/lncrawl-reference-service.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("uses the bundled CLI directly with empty user data and no runtime download or installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "starsea-lncrawl-test-")); roots.push(root)
  const runtimeDirectory = join(root, "bundle")
  await mkdir(join(runtimeDirectory, "_internal"), { recursive: true })
  const executable = join(runtimeDirectory, "cli")
  await writeFile(executable, "bundled CLI")
  await writeFile(join(runtimeDirectory, "bundle-manifest.json"), JSON.stringify({
    version: "v4.14.0", platform: process.platform, arch: process.arch,
    executable: "cli", executableDigest: createHash("sha256").update("bundled CLI").digest("hex"),
  }))
  const fetch = vi.fn(() => Promise.reject(new Error("runtime download is forbidden")))
  vi.stubGlobal("fetch", fetch)
  const run = vi.fn<(_binary: string, _args: string[], _cwd: string) => Promise<{ stdout: string; stderr: string }>>(() => Promise.resolve({ stdout: "", stderr: "" }))
  const service = new LncrawlReferenceService(join(root, "empty-user-data"), { runtimeDirectory, run })
  await service.search("Book", root)
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0]?.[0]).toBe(executable)
  expect(run.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["search", "Book"]))
  expect(run.mock.calls[0]?.[2]).toContain("empty-user-data")
  expect(fetch).not.toHaveBeenCalled()
})

it("rejects a tampered bundled executable without installing a replacement", async () => {
  const { root, service } = await fixtureService()
  await writeFile(join(root, "tools", "lncrawl", "cli"), "tampered")
  const fetch = vi.fn(() => Promise.reject(new Error("No installer allowed")))
  vi.stubGlobal("fetch", fetch)
  await expect(service.search("Book", root)).rejects.toThrow("完整性校验失败")
  expect(fetch).not.toHaveBeenCalled()
})

it("reports missing bundled files without falling back to a network installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "starsea-lncrawl-test-")); roots.push(root)
  const fetch = vi.fn(() => Promise.reject(new Error("runtime download is forbidden")))
  vi.stubGlobal("fetch", fetch)
  const service = new LncrawlReferenceService(root, { runtimeDirectory: join(root, "missing-bundle") })
  await expect(service.search("Book", root)).rejects.toThrow("内置 LNCrawl")
  expect(fetch).not.toHaveBeenCalled()
})

// A stored ZIP fixture exercises the actual archive reader and workspace importer.
function zipFixture(entries: Record<string, unknown>): Buffer {
  const files: Buffer[] = [], directory: Buffer[] = []
  let offset = 0
  for (const [path, value] of Object.entries(entries)) {
    const name = Buffer.from(path), data = Buffer.from(JSON.stringify(value))
    const local = Buffer.alloc(30), central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    files.push(local, name, data); directory.push(central, name); offset += local.length + name.length + data.length
  }
  const end = Buffer.alloc(22), index = Buffer.concat(directory)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, index, end])
}

async function fixtureService(crawlOutput?: Record<string, unknown>, searchOutput?: string | readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), "starsea-lncrawl-test-")); roots.push(root)
  const directory = join(root, "tools", "lncrawl")
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, "cli"), "CLI fixture")
  await writeFile(join(directory, "bundle-manifest.json"), JSON.stringify({ platform: process.platform, arch: process.arch, executable: "cli", executableDigest: createHash("sha256").update("CLI fixture").digest("hex") }))
  const run = vi.fn(async (_binary: string, args: string[], cwd: string) => {
    if (args[0] === "search") {
      const stdout = Array.isArray(searchOutput) ? searchOutput.shift() : searchOutput
      return { stdout: stdout ?? "Exhausted('failed https://error.example/search?q=Book')\n📖 Book  (1 results)\n  ➡ https://novels.example/book\n    A displaced knight returns to the capital to expose the regent.\n", stderr: "" }
    }
    if (crawlOutput !== undefined) await writeFile(join(cwd, "book.zip"), zipFixture(crawlOutput))
    return { stdout: "JSON generated", stderr: "" }
  })
  await mkdir(join(directory, "_internal"), { recursive: true })
  const service = new LncrawlReferenceService(root, { run, runtimeDirectory: directory })
  return { root, service, run, workspace: new NodeWorkspaceAdapter() }
}

it("only accepts actual result URLs, never error-log endpoints", async () => {
  const { root, service } = await fixtureService()
  const result = await service.search("Book", root)
  expect(result.candidateUrls).toEqual(["https://novels.example/book"])
  expect(result.candidates).toEqual([{
    title: "Book", url: "https://novels.example/book",
    synopsis: "A displaced knight returns to the capital to expose the regent.",
  }])
})

it("requires a synopsis and an explicit bounded chapter count before crawling", async () => {
  const { root, service, workspace, run } = await fixtureService()
  await service.search("Book", root)
  await expect(service.crawl({ title: "Book", url: "https://novels.example/book", workspaceRootRef: root, workspace }))
    .rejects.toThrow("必须显式指定 chapterLimit")
  expect(run).toHaveBeenCalledOnce()
})

it("does not crawl a candidate when LNCrawl returned no synopsis to verify", async () => {
  const { root, service, workspace, run } = await fixtureService(undefined,
    "📖 Book (1 results)\n  ➡ https://novels.example/book\n")
  await service.search("Book", root)
  await expect(service.crawl({ title: "Book", url: "https://novels.example/book", workspaceRootRef: root, workspace, chapterLimit: 1 }))
    .rejects.toThrow("没有可核对的作品简介")
  expect(run).toHaveBeenCalledOnce()
})

it("treats a source status such as completed as missing synopsis, not as identity evidence", async () => {
  const { root, service, workspace, run } = await fixtureService(undefined,
    "📖 Fate/stay night (1 results)\n  ➡ https://novels.example/fate\n    completed\n")
  await service.search("Fate/stay night", root)
  await expect(service.crawl({ title: "Fate/stay night", url: "https://novels.example/fate", workspaceRootRef: root, workspace, chapterLimit: 1 }))
    .rejects.toThrow("没有可核对的作品简介")
  expect(run).toHaveBeenCalledOnce()
})

it("invalidates mistaken candidates on re-search and only allows crawling the newly confirmed result", async () => {
  const searches = [
    "📖 Fate: Perfect Redemption (1 results)\n  ➡ https://novels.example/fate-zero\n    A Fate/Zero fanfiction following Kiritsugu and the Fourth Holy Grail War.\n",
    "📖 Fate/stay night: Unlimited Blade Works (1 results)\n  ➡ https://novels.example/stay-night-ubw\n    Shirou Emiya summons Saber and enters the Fifth Holy Grail War in Fuyuki.\n",
  ]
  const { root, service, workspace, run } = await fixtureService({
    "001.json": { title: "Chapter 1", content: "<p>Shirou Emiya summons Saber in Fuyuki.</p>" },
  }, searches)
  const wrong = await service.search("Fate/Zero", root)
  expect(wrong.candidates[0]?.synopsis).toContain("Fourth Holy Grail War")
  const correct = await service.search("Fate/stay night Unlimited Blade Works", root)
  expect(correct.candidates[0]?.synopsis).toContain("Fifth Holy Grail War")
  await expect(service.crawl({ title: "Fate", url: "https://novels.example/fate-zero", workspaceRootRef: root, workspace, chapterLimit: 1 }))
    .rejects.toThrow("只能抓取本次原作搜索返回")
  const imported = await service.crawl({ title: "Fate stay night UBW", url: "https://novels.example/stay-night-ubw", workspaceRootRef: root, workspace, chapterLimit: 1 })
  expect(imported.importedFiles).toHaveLength(2)
  expect(run.mock.calls.filter((call) => call[1][0] === "crawl")).toHaveLength(1)
  expect(run.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(["https://novels.example/stay-night-ubw", "--first", "1"]))
})

it("imports actual chapter text through a bounded non-interactive crawl", async () => {
  const { root, service, run, workspace } = await fixtureService({
    "meta.json": { title: "Book" }, "000/00001.json": { title: "Chapter One", content: "<p>Verified text.</p><p>Second paragraph.</p>" },
    "000/00002.json": { title: "Not downloaded", content: "" },
  })
  await service.search("Book", root)
  const result = await service.crawl({ title: "Book", url: "https://novels.example/book", workspaceRootRef: root, workspace, chapterLimit: 1 })
  expect(result.importedFiles).toHaveLength(2)
  const chapterPath = result.importedFiles[1]
  if (chapterPath === undefined) throw new Error("Missing imported chapter")
  const markdown = await workspace.readMarkdown(root, chapterPath)
  expect(markdown).toMatch(/Verified text\.\n\s*Second paragraph\./u)
  expect(markdown).not.toContain("<p>")
  expect(run.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["--noin", "--first", "1", "--format", "json"]))
})

it("does not import an unrelated cached ZIP when this crawl produces no archive", async () => {
  const { root, service, workspace } = await fixtureService()
  await service.search("Book", root)
  const dataDirectory = join(root, "tools", "lncrawl", "books", createHash("sha256").update(root).digest("hex").slice(0, 20))
  await writeFile(join(dataDirectory, "old.zip"), zipFixture({ "old.json": { title: "Wrong book", content: "Stale evidence" } }))
  await expect(service.crawl({ title: "Book", url: "https://novels.example/book", workspaceRootRef: root, workspace, chapterLimit: 1 })).rejects.toThrow("没有生成")
})

it("rejects metadata-only archives instead of treating JSON as chapter evidence", async () => {
  const { root, service, workspace } = await fixtureService({ "chapter.json": { title: "Empty", id: "c1" } })
  await service.search("Book", root)
  await expect(service.crawl({ title: "Book", url: "https://novels.example/book", workspaceRootRef: root, workspace, chapterLimit: 1 })).rejects.toThrow("未找到可导入")
})
