import { createHash } from "node:crypto"
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { NikowenkuReferenceService } from "../src/infrastructure/web-research/nikowenku-reference-service.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"

const roots: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const runtimeDirectory = resolve("common/tools/nikowenku-archive")
const book = { id: "wenku8-1", title: "原作示例", author: "示例作者", description: "女主角米拉在北方港口寻找失散的家人，揭开王国继承纷争。", updatedAt: "2026-01-01", chapterCount: 2, files: [{ kind: "text", bytes: 100 }] }
const original = "第一卷 北方\n第一章 重逢\n米拉抵达北方港口，找到了家人的线索。\n第二章 约定\n她与船长约好次日出海，继续寻找家人。\n"
function importedPath(result: { importedFiles: string[] }, index: number): string {
  const path = result.importedFiles[index]
  if (path === undefined) throw new Error("Missing imported chapter")
  return path
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "starsea-nikowenku-")); roots.push(root)
  const workspaceRootRef = join(root, "workspace"); await mkdir(workspaceRootRef)
  let books = [book], details = { ...book }, body = Buffer.from(original), failSearch = false
  const run = vi.fn(async (_binary: string, args: string[], _cwd: string, signal?: AbortSignal, env?: NodeJS.ProcessEnv) => {
    expect(env?.ELECTRON_RUN_AS_NODE).toBe("1")
    signal?.throwIfAborted()
    if (args[1] === "search") {
      if (failSearch) throw new Error("network unavailable")
      return { stdout: JSON.stringify({ books, total: books.length }), stderr: "" }
    }
    if (args[1] === "info") return { stdout: JSON.stringify(details), stderr: "" }
    const path = args[args.indexOf("--output") + 1]
    if (path === undefined) throw new Error("Missing download path")
    await writeFile(path, body)
    return { stdout: JSON.stringify({ id: book.id, output: path, bytes: body.length }), stderr: "" }
  })
  const service = new NikowenkuReferenceService(root, { runtimeDirectory, run })
  const input = { bookId: book.id, title: book.title, workspaceRootRef, workspace: new NodeWorkspaceAdapter(), chapterLimit: 1 }
  return { root, workspaceRootRef, service, input, run, setBooks: (value: typeof books) => { books = value }, setDetails: (value: typeof details) => { details = value }, setBody: (value: Buffer) => { body = value }, failSearch: () => { failSearch = true } }
}

it("runs the bundled JavaScript with the existing runtime, JSON output, fixed site and no installer", async () => {
  const f = await fixture()
  const fetch = vi.fn(() => Promise.reject(new Error("No installation allowed"))); vi.stubGlobal("fetch", fetch)
  const result = await f.service.search(book.title, f.workspaceRootRef)
  expect(result.candidates[0]).toMatchObject({ bookId: book.id, title: book.title, author: book.author, synopsis: book.description })
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.run.mock.calls[0]?.[0]).toBe(process.execPath)
  expect(f.run.mock.calls[0]?.[1]).toEqual([join(runtimeDirectory, "scripts/cli.mjs"), "search", book.title, "--limit", "20", "--json", "--site", "https://111.229.32.85/nikowenku-archive/"])
  expect(f.run.mock.calls[0]?.[4]?.ELECTRON_RUN_AS_NODE).toBe("1")
  expect(fetch).not.toHaveBeenCalled()
})

it("puts exact titles ahead of unrelated books matched only by description", async () => {
  const f = await fixture(); f.setBooks([{ ...book, id: "wenku8-2", title: "另一作品" }, book])
  expect((await f.service.search(book.title, f.workspaceRootRef)).candidates[0]?.bookId).toBe(book.id)
})

it("rejects missing or damaged bundled sources without downloading a replacement", async () => {
  const f = await fixture()
  const missing = new NikowenkuReferenceService(f.root, { runtimeDirectory: join(f.root, "missing"), run: f.run })
  await expect(missing.search(book.title, f.workspaceRootRef)).rejects.toThrow("完整性校验失败")
  const copy = join(f.root, "bundle"); await cp(runtimeDirectory, copy, { recursive: true })
  await writeFile(join(copy, "server/text.mjs"), "tampered")
  await expect(new NikowenkuReferenceService(f.root, { runtimeDirectory: copy, run: f.run }).search(book.title, f.workspaceRootRef)).rejects.toThrow("文件缺失或损坏")
  expect(f.run).not.toHaveBeenCalled()
})

it("only downloads a current workspace candidate with a synopsis and explicit import range", async () => {
  const f = await fixture()
  await expect(f.service.download(f.input)).rejects.toThrow("本次原作搜索")
  await f.service.search(book.title, f.workspaceRootRef)
  await expect(f.service.download({ ...f.input, bookId: "../book" })).rejects.toThrow("本次原作搜索")
  await expect(f.service.download({ ...f.input, chapterLimit: undefined })).rejects.toThrow("chapterLimit")
  await expect(f.service.download({ ...f.input, workspaceRootRef: f.root })).rejects.toThrow("本次原作搜索")
  await expect(f.service.download({ ...f.input, startChapter: 0 })).rejects.toThrow("startChapter")
  f.setBooks([{ ...book, description: "连载中" }]); await f.service.search(book.title, f.workspaceRootRef)
  await expect(f.service.download(f.input)).rejects.toThrow("没有可核对的作品简介")
  expect(f.run.mock.calls.every(call => call[1][1] === "search")).toBe(true)
})

it("invalidates older candidates immediately when the next search fails", async () => {
  const f = await fixture(); await f.service.search(book.title, f.workspaceRootRef); f.failSearch()
  await expect(f.service.search("另一个版本", f.workspaceRootRef)).rejects.toThrow("network unavailable")
  await expect(f.service.download(f.input)).rejects.toThrow("本次原作搜索")
})

it("rechecks metadata and rejects a book changed between search and download", async () => {
  const f = await fixture(); await f.service.search(book.title, f.workspaceRootRef)
  f.setDetails({ ...book, title: "错误的同人小说" })
  await expect(f.service.download(f.input)).rejects.toThrow("详情与搜索候选不匹配")
  expect(f.run.mock.calls.some(call => call[1][1] === "download")).toBe(false)
})

it("downloads full original bytes once, imports a bounded chapter and reuses the verified cache", async () => {
  const f = await fixture(); await f.service.search(book.title, f.workspaceRootRef)
  const first = await f.service.download(f.input)
  expect(await readFile(first.localTextPath, "utf8")).toBe(original)
  expect(first.cached).toBe(false); expect(first.importedFiles).toHaveLength(2)
  const body = await readFile(join(f.workspaceRootRef, importedPath(first, 1)), "utf8")
  expect(body).toMatch(/^# 第一卷 北方 · 第一章 重逢\n\n米拉/u)
  expect(body).toContain("米拉抵达北方港口"); expect(body).not.toContain("次日出海")
  const second = await f.service.download({ ...f.input, startChapter: 2 })
  expect(second.cached).toBe(true)
  expect(await readFile(join(f.workspaceRootRef, importedPath(second, 1)), "utf8")).toContain("次日出海")
  expect(f.run.mock.calls.filter(call => call[1][1] === "download")).toHaveLength(1)
  expect(await readFile(join(f.workspaceRootRef, importedPath(first, 1)), "utf8")).toBe(body)
  const index = await readFile(join(f.workspaceRootRef, importedPath(second, 0)), "utf8")
  expect(index).toMatch(/^# 原作示例\n\n- 书库/u)
  expect(index).toContain("本次导入 2..2"); expect(index).toContain(book.id)
})

it("redownloads a tampered cached original instead of using corrupt evidence", async () => {
  const f = await fixture(); await f.service.search(book.title, f.workspaceRootRef)
  const first = await f.service.download(f.input); await writeFile(first.localTextPath, "tampered")
  expect((await f.service.download(f.input)).cached).toBe(false)
  expect(f.run.mock.calls.filter(call => call[1][1] === "download")).toHaveLength(2)
})

it("decodes original UTF-16 text and splits an unstructured book into bounded evidence pieces", async () => {
  const f = await fixture(); f.setBody(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("港口的故事。".repeat(3000), "utf16le")]))
  await f.service.search(book.title, f.workspaceRootRef)
  const result = await f.service.download(f.input)
  const content = await readFile(join(f.workspaceRootRef, importedPath(result, 1)), "utf8")
  expect(content).toContain("原文片段 1"); expect(content).toContain("港口的故事")
  expect(content.length).toBeLessThan(8100)
})

it("recognizes the actual volume-prefixed chapter headings used by Wenku full-text exports", async () => {
  const f = await fixture(); f.setBody(Buffer.from("第一卷 序幕\r\n赫萝在麦田醒来。\r\n第一卷 第一幕\r\n罗伦斯赶着马车来到村庄。\r\n第二卷 序幕\r\n下一卷开始。"))
  await f.service.search(book.title, f.workspaceRootRef)
  const first = await f.service.download(f.input)
  const content = await readFile(join(f.workspaceRootRef, importedPath(first, 1)), "utf8")
  expect(content).toContain("# 第一卷 · 序幕")
  expect(content).toContain("麦田醒来"); expect(content).not.toContain("马车")
  const second = await f.service.download({ ...f.input, startChapter: 2 })
  expect(await readFile(join(f.workspaceRootRef, importedPath(second, 1)), "utf8")).toContain("# 第一卷 · 第一幕")
  expect(second.cached).toBe(true)
})

it("rejects error pages and oversized metadata without importing or retrying", async () => {
  const f = await fixture(); f.setBody(Buffer.from("<!doctype html><html>error</html>"))
  await f.service.search(book.title, f.workspaceRootRef)
  await expect(f.service.download(f.input)).rejects.toThrow("错误页")
  expect(f.run.mock.calls.filter(call => call[1][1] === "download")).toHaveLength(1)
  await expect(readFile(join(f.workspaceRootRef, "参考文件/原作资料/原作示例--wenku8-1/README.md"))).rejects.toThrow()
  f.setDetails({ ...book, files: [{ kind: "text", bytes: 65 * 1024 * 1024 }] })
  await expect(f.service.download(f.input)).rejects.toThrow("64MB")
  expect(f.run.mock.calls.filter(call => call[1][1] === "download")).toHaveLength(1)
})

it("stops a cancelled request before launching a process", async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort()
  await expect(f.service.search(book.title, f.workspaceRootRef, controller.signal)).rejects.toThrow()
  expect(f.run).not.toHaveBeenCalled()
})

it("executes the real bundled CLI against a fixture server through search, info, download and cache reuse", async () => {
  const f = await fixture(); let downloads = 0
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/library/api/library?")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ books: [book], total: 1 })); return }
    if (req.url === `/library/api/books/${book.id}`) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(book)); return }
    if (req.url === `/library/api/books/${book.id}/files/text`) { downloads++; res.setHeader("Content-Type", "text/plain"); res.end(original); return }
    res.statusCode = 404; res.end()
  })
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done))
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture server unavailable")
  try {
    const service = new NikowenkuReferenceService(f.root, { runtimeDirectory, siteUrl: `http://127.0.0.1:${String(address.port)}/library/` })
    expect((await service.search(book.title, f.workspaceRootRef)).candidates[0]?.bookId).toBe(book.id)
    const result = await service.download(f.input)
    expect(createHash("sha256").update(await readFile(result.localTextPath)).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"))
    expect((await service.download({ ...f.input, startChapter: 2 })).cached).toBe(true)
    expect(downloads).toBe(1)
  } finally { server.closeAllConnections(); await new Promise<void>(done => { server.close(() => { done() }) }) }
}, 20000)
