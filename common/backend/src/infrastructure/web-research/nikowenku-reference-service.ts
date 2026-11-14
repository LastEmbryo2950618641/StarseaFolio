import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { WorkspacePort } from "../../application/workspace/ports/workspace-port.js"

const defaultSite = "https://111.229.32.85/nikowenku-archive/"
const maxTextBytes = 64 * 1024 * 1024
const maxOutputBytes = 1024 * 1024
const validId = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,79}$/u
const unusableSynopsis = /^(?:completed|ongoing|complete|完结|连载中|已完结|已完成|unknown|n\/?a|none|无)$/iu
type RunProcess = (binary: string, args: string[], cwd: string, signal?: AbortSignal, env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>
type Book = { id: string; title: string; originalTitle?: string; author?: string; description?: string; updatedAt?: string; chapterCount?: number; wordCount?: number; language?: string; source?: { name?: string }; files?: Array<{ kind: string; bytes: number }> }
type Candidate = { bookId: string; title: string; url: string; synopsis?: string; author?: string; originalTitle?: string; language?: string; source?: string }
type TextTools = { decodeBook: (bytes: Buffer) => { text: string; encoding: string }; indexBook: (text: string) => { text: string; chapters: Array<{ title: string; volume: string; start: number; end: number }> } }

function bookRecord(value: unknown): Book {
  if (value === null || typeof value !== "object") throw new Error("小说书库返回了无效的书籍信息")
  const book = value as Book
  if (typeof book.id !== "string" || !validId.test(book.id) || typeof book.title !== "string" || !book.title.trim()) throw new Error("小说书库返回了无效的书籍 ID 或标题")
  for (const key of ["description", "author", "originalTitle", "updatedAt", "language"] as const) {
    if (book[key] !== undefined && typeof book[key] !== "string") throw new Error("小说书库返回了无效的书籍字段")
  }
  return book
}

export class NikowenkuReferenceService {
  private readonly dataRoot: string
  private readonly candidates = new Map<string, Map<string, Candidate>>()
  private readonly site: URL

  public constructor(applicationDataRoot: string, private readonly options: Readonly<{ runtimeDirectory?: string; run?: RunProcess; siteUrl?: string }> = {}) {
    this.dataRoot = join(resolve(applicationDataRoot), "tools", "nikowenku-archive", "books")
    this.site = new URL(options.siteUrl ?? defaultSite)
    if (!["https:", "http:"].includes(this.site.protocol) || this.site.username || this.site.password) throw new Error("小说书库地址无效")
    this.site.search = ""; this.site.hash = ""
    if (!this.site.pathname.endsWith("/")) this.site.pathname += "/"
  }

  public async search(title: string, workspaceRootRef: string, signal?: AbortSignal) {
    if (!title.trim() || title.length > 200) throw new Error("原作标题须为 1..200 个字符")
    const key = resolve(workspaceRootRef)
    // A new search immediately invalidates old candidates, including when it fails.
    this.candidates.delete(key)
    const runtime = await this.runtime(signal)
    const result = await this.run(runtime, ["search", title, "--limit", "20", "--json"], this.directory(workspaceRootRef), signal)
    const parsed = JSON.parse(result.stdout) as { books?: unknown; total?: unknown }
    if (!Array.isArray(parsed.books) || !Number.isSafeInteger(parsed.total) || Number(parsed.total) < 0 || parsed.books.length > 20) throw new Error("小说书库返回了无效的搜索结果")
    const candidates = parsed.books.map(bookRecord).map((book): Candidate => ({
      bookId: book.id, title: book.title, url: new URL(`?book=${encodeURIComponent(book.id)}`, this.site).href,
      ...(book.description ? { synopsis: book.description.slice(0, 4000) } : {}),
      ...(book.author ? { author: book.author } : {}),
      ...(book.originalTitle ? { originalTitle: book.originalTitle } : {}),
      ...(book.language ? { language: book.language } : {}),
      ...(book.source?.name ? { source: book.source.name } : {}),
    }))
    // Matches found only in descriptions must not displace an exact title match.
    const normalized = title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
    const score = (candidate: Candidate) => candidate.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === normalized ? 2 : candidate.title.toLocaleLowerCase().includes(title.toLocaleLowerCase()) ? 1 : 0
    candidates.sort((a, b) => score(b) - score(a))
    this.candidates.set(key, new Map(candidates.map(candidate => [candidate.bookId, candidate])))
    return { title, candidates, candidateUrls: candidates.map(candidate => candidate.url), output: `nikowenku-archive：匹配 ${String(parsed.total)} 本；请核对书籍 ID、标题、作者和简介，搜索结果不是原文证据。` }
  }

  public async download(input: Readonly<{ bookId: string; title: string; workspaceRootRef: string; workspace: WorkspacePort; chapterLimit?: number; startChapter?: number; signal?: AbortSignal }>) {
    const candidate = this.candidates.get(resolve(input.workspaceRootRef))?.get(input.bookId)
    if (!validId.test(input.bookId) || candidate === undefined) throw new Error("只能下载本次原作搜索返回的书籍 ID；请先搜索并核对版本")
    if (!candidate.synopsis || candidate.synopsis.trim().length < 12 || unusableSynopsis.test(candidate.synopsis.trim())) throw new Error("该候选没有可核对的作品简介；请先核对目标作品，不得直接下载同名小说")
    if (input.chapterLimit === undefined || !Number.isSafeInteger(input.chapterLimit) || input.chapterLimit < 1 || input.chapterLimit > 20_000) throw new Error("chapterLimit 必须显式指定为 1..20000 的整数")
    const start = input.startChapter ?? 1
    if (!Number.isSafeInteger(start) || start < 1 || start > 20_000) throw new Error("startChapter 必须为 1..20000 的整数")
    const runtime = await this.runtime(input.signal)
    const directory = join(this.directory(input.workspaceRootRef), input.bookId)
    const info = bookRecord(JSON.parse((await this.run(runtime, ["info", input.bookId, "--json"], directory, input.signal)).stdout))
    if (info.id !== input.bookId || info.title !== candidate.title || (candidate.author && info.author !== candidate.author)
      || info.description !== candidate.synopsis && info.description?.slice(0, 4000) !== candidate.synopsis) {
      this.candidates.get(resolve(input.workspaceRootRef))?.delete(input.bookId)
      throw new Error("书籍详情与搜索候选不匹配，请重新搜索并核对原作版本")
    }
    if (info.files?.some(file => file.kind === "text" && file.bytes > maxTextBytes)) throw new Error("小说正文超过 64MB，未下载")
    const localTextPath = join(directory, "original.txt")
    const receiptPath = join(directory, "download.json")
    const version = createHash("sha256").update(JSON.stringify(info)).digest("hex")
    let bytes: Buffer | undefined
    try {
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { version?: string; digest?: string }
      if (receipt.version === version && (await stat(localTextPath)).size <= maxTextBytes) {
        const cached = await readFile(localTextPath)
        if (createHash("sha256").update(cached).digest("hex") === receipt.digest) bytes = cached
      }
    } catch { /* No valid cached original yet. */ }
    const cached = bytes !== undefined
    if (bytes === undefined) {
      const pending = join(directory, `original-${randomUUID()}.txt`)
      try {
        const downloaded = JSON.parse((await this.run(runtime, ["download", input.bookId, "--output", pending, "--json"], directory, input.signal)).stdout) as { id?: string; output?: string; bytes?: number }
        if (downloaded.id !== input.bookId || downloaded.output === undefined || resolve(downloaded.output) !== pending) throw new Error("小说书库下载回执与目标不匹配")
        const size = (await stat(pending)).size
        if (size < 1 || size > maxTextBytes || downloaded.bytes !== size) throw new Error("小说正文为空、超出 64MB 或下载不完整")
        bytes = await readFile(pending)
        const { decodeBook } = await this.textTools(runtime)
        if (!decodeBook(bytes).text.trim() || /^\s*(?:<!doctype html|<html|\{\s*"error")/iu.test(decodeBook(bytes).text)) throw new Error("书库返回了错误页，未导入正文")
        input.signal?.throwIfAborted()
        await rename(pending, localTextPath)
        await writeFile(receiptPath, JSON.stringify({ version, bookId: info.id, digest: createHash("sha256").update(bytes).digest("hex") }) + "\n")
      } finally { await rm(pending, { force: true }) }
    }
    input.signal?.throwIfAborted()
    const tools = await this.textTools(runtime)
    const indexed = tools.indexBook(tools.decodeBook(bytes).text)
    // Unstructured novels are split into bounded pieces, never one whole-book prompt.
    // Wenku full-text files commonly prefix every heading with a volume, e.g.
    // 第一卷 序幕 / 第一卷 第一幕. Preserve these as real chapter boundaries.
    const prefixed = [...indexed.text.matchAll(/^[\t \u3000]*(第[零〇○一二三四五六七八九十百千万两\d０-９]{1,12}[卷部册集])[\t \u3000]+([^\n]{1,80})$/gmu)]
    // A standalone volume heading must not replace correctly indexed chapters
    // below it (第一卷 北方 / 第一章 重逢 / 第二章 约定).
    const hasStandaloneChapters = indexed.chapters.some(chapter => chapter.title !== "全文"
      && !/^第[零〇○一二三四五六七八九十百千万两\d０-９]{1,12}[卷部册集]/u.test(chapter.title))
    const resolvedChapters = prefixed.length > 0 && !hasStandaloneChapters ? prefixed.map((heading, index) => ({
      title: heading[2]?.trim() ?? "章节", volume: heading[1] ?? "", start: heading.index + heading[0].length,
      end: prefixed[index + 1]?.index ?? indexed.text.length,
    })) : indexed.chapters
    const chapters = resolvedChapters.length === 1 && resolvedChapters[0]?.title === "全文"
      ? Array.from({ length: Math.ceil(indexed.text.length / 8000) }, (_, index) => ({ title: `原文片段 ${String(index + 1)}`, volume: "", start: index * 8000, end: Math.min((index + 1) * 8000, indexed.text.length) }))
      : resolvedChapters
    const selected = chapters.slice(start - 1, start - 1 + input.chapterLimit)
    if (!selected.length) throw new Error(`原作只有 ${String(chapters.length)} 个章节/片段，请调整 startChapter`)
    // Use the verified title and ID, not a model-supplied filename or source URL.
    // eslint-disable-next-line no-control-regex -- sanitize filesystem names
    const slug = info.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 70)
    const destination = `参考文件/原作资料/${slug}--${info.id}`
    await input.workspace.createUserDirectory(input.workspaceRootRef, `${destination}/章节`)
    const imported: string[] = []
    for (const [index, chapter] of selected.entries()) {
      input.signal?.throwIfAborted()
      const path = `${destination}/章节/${String(start + index).padStart(5, "0")}.md`
      await input.workspace.saveUserMarkdown(input.workspaceRootRef, path, `# ${chapter.volume ? chapter.volume + " · " : ""}${chapter.title}\n\n${indexed.text.slice(chapter.start, chapter.end).trim()}\n`)
      imported.push(path)
    }
    const indexPath = `${destination}/README.md`
    await input.workspace.saveUserMarkdown(input.workspaceRootRef, indexPath, [
      `# ${info.title}`, "", `- 书库：nikowenku-archive`, `- 书籍 ID：${info.id}`, `- 作者：${info.author ?? "未标注"}`,
      `- 来源：${candidate.url}`, `- 下载时间：${new Date().toISOString()}`, `- 本地原文：${localTextPath}`,
      `- 原文共 ${String(chapters.length)} 个章节/片段；本次导入 ${String(start)}..${String(start + selected.length - 1)}`,
      "- 已下载全本缓存；只有实际读取的章节才是核实依据，不把整本原文注入模型。",
      "- 后续可用 startChapter、chapterLimit 分段导入同一本书，已有原文缓存会复用。", "",
      ...imported.map(path => `- [${basename(path, ".md")}](${path.slice(destination.length + 1)})`), "",
    ].join("\n"))
    return { title: info.title, bookId: info.id, localTextPath, cached, importedFiles: [indexPath, ...imported], output: `nikowenku-archive 原文${cached ? "缓存已复用" : "已下载"}；导入 ${String(selected.length)} 个章节/片段，请 request_read 按需读取原文。` }
  }

  private directory(workspace: string) { return join(this.dataRoot, createHash("sha256").update(resolve(workspace)).digest("hex").slice(0, 20)) }

  private async runtime(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const directory = resolve(this.options.runtimeDirectory ?? fileURLToPath(new URL("../../../../tools/nikowenku-archive/", import.meta.url)))
    try {
      const manifest = JSON.parse(await readFile(join(directory, "upstream.json"), "utf8")) as { name?: string; version?: string; files?: Array<{ path: string; sha256: string }> }
      const required = ["scripts/cli.mjs", "server/library.mjs", "server/text.mjs", "shared/language.mjs", "package.json", "LICENSE", "README.md", "skill/SKILL.md"]
      if (manifest.name !== "nikowenku-archive" || manifest.version !== "0.1.4" || manifest.files?.length !== required.length) throw new Error("清单无效")
      for (const path of required) {
        signal?.throwIfAborted()
        const entry = manifest.files.find(file => file.path === path)
        if (!entry || createHash("sha256").update(await readFile(join(directory, path))).digest("hex") !== entry.sha256) throw new Error(`文件缺失或损坏：${path}`)
      }
      return directory
    } catch (error) { throw new Error(`内置 nikowenku-archive 完整性校验失败，请重新安装完整版本的星海余页：${error instanceof Error ? error.message : String(error)}`) }
  }

  private async textTools(runtime: string) { return await import(pathToFileURL(join(runtime, "server/text.mjs")).href) as TextTools }

  private async run(runtime: string, args: string[], cwd: string, signal?: AbortSignal) {
    await mkdir(cwd, { recursive: true }); signal?.throwIfAborted()
    const commandArgs = [join(runtime, "scripts/cli.mjs"), ...args, "--site", this.site.href]
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    // CLI options always select the bundled catalog; inherited local-mode variables are ignored.
    delete env.ARCHIVE_LIBRARY; delete env.ARCHIVE_STATE_DIR; delete env.ARCHIVE_SITE_URL
    if (this.options.run) return this.options.run(process.execPath, commandArgs, cwd, signal, env)
    return new Promise<{ stdout: string; stderr: string }>((resolveRun, reject) => {
      const child = spawn(process.execPath, commandArgs, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      const stdout: Buffer[] = [], stderr: Buffer[] = []; let size = 0; let timedOut = false; let oversized = false
      const stop = () => { child.kill() }
      const timer = setTimeout(() => { timedOut = true; stop() }, 180_000)
      const aborted = () => { stop() }; signal?.addEventListener("abort", aborted, { once: true })
      if (signal?.aborted) stop()
      const collect = (target: Buffer[]) => (chunk: Buffer) => { size += chunk.length; if (size > maxOutputBytes) { oversized = true; stop() } else target.push(chunk) }
      child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr))
      child.on("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(error) })
      child.on("close", code => {
        clearTimeout(timer); signal?.removeEventListener("abort", aborted)
        if (signal?.aborted) { reject(new Error("原作资料任务已取消")); return }
        if (timedOut) { reject(new Error("小说书库任务超过 3 分钟，已停止本次任务")); return }
        if (oversized) { reject(new Error("小说书库输出超过安全上限")); return }
        if (code !== 0) { reject(new Error(`nikowenku-archive 执行失败：${Buffer.concat(stderr).toString("utf8").slice(-2000)}`)); return }
        resolveRun({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
      })
    })
  }
}
