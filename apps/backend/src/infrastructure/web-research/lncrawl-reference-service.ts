import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import yauzl from "yauzl"
import type { WorkspacePort } from "../../application/workspace/ports/workspace-port.js"
import { htmlToPlainText } from "./web-url-safety.js"

const maxCliOutputBytes = 1_000_000
const maxArchiveBytes = 700 * 1024 * 1024
const maxChapterBytes = 4 * 1024 * 1024
const maxEntries = 20_000
const unusableSynopsisPattern = /^(?:completed|ongoing|complete|完结|连载中|已完结|已完成|进行中|unknown|n\/?a|none|无)$/iu

type RunProcess = (binary: string, args: string[], cwd: string, signal?: AbortSignal, extraEnv?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>
type BundleManifest = { platform?: string; arch?: string; executable?: string; executableDigest?: string }

async function readZipJsonEntries(zipPath: string): Promise<Array<{ name: string; content: string }>> {
  const zip = await new Promise<yauzl.ZipFile>((resolveZip, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, file) => {
      if (error) reject(error)
      else resolveZip(file)
    })
  })
  const results: Array<{ name: string; content: string }> = []
  let totalBytes = 0
  let count = 0
  await new Promise<void>((resolveZip, reject) => {
    zip.on("error", reject)
    zip.on("end", resolveZip)
    zip.on("entry", (entry: yauzl.Entry) => {
      count += 1
      if (count > maxEntries) { reject(new Error("LNCrawl 归档条目超出安全上限")); return; }
      const normalized = entry.fileName.replaceAll("\\", "/")
      if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
        reject(new Error("LNCrawl 归档包含不安全路径")); return;
      }
      if (entry.fileName.endsWith("/") || !normalized.toLowerCase().endsWith(".json")
        || basename(normalized).toLowerCase() === "meta.json") {
        zip.readEntry()
        return
      }
      if (entry.uncompressedSize > maxChapterBytes || totalBytes + entry.uncompressedSize > maxArchiveBytes) {
        reject(new Error("LNCrawl 归档内容超出安全上限")); return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { reject(error); return; }
        const chunks: Buffer[] = []
        let size = 0
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > maxChapterBytes) stream.destroy(new Error("章节 JSON 超出安全上限"))
          else chunks.push(chunk)
        })
        stream.on("error", reject)
        stream.on("end", () => {
          totalBytes += size
          results.push({ name: normalized, content: Buffer.concat(chunks).toString("utf8") })
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  }).finally(() => { zip.close(); })
  return results
}

function chapterMarkdown(entry: { name: string; content: string }): { filename: string; markdown: string } | undefined {
  const parsed: unknown = JSON.parse(entry.content)
  const record = parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  const title = [record.title, record.name, record.chapter].find((value) => typeof value === "string")
  const body = [record.content, record.text, record.body].find((value) => typeof value === "string")
  const safeName = entry.name.slice(0, -extname(entry.name).length).replaceAll("/", "__")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "chapter"
  if (typeof body !== "string") return undefined
  const content = htmlToPlainText(body)
  if (content.length === 0) return undefined
  return {
    filename: `${safeName}.md`,
    markdown: `# ${title?.trim() || safeName}\n\n${content.trim()}\n`,
  }
}

function searchCandidates(output: string): Array<{ title: string; url: string; synopsis?: string }> {
  const candidates: Array<{ title: string; url: string; synopsis?: string }> = []
  let title = ""
  let current: { title: string; url: string; synopsis?: string } | undefined
  // Rich's non-interactive CLI prints titled result blocks. Diagnostic URLs
  // elsewhere in the log are not novel candidates.
  // eslint-disable-next-line no-control-regex -- strip terminal ANSI colour escapes
  for (const line of output.replace(/\u001b\[[0-9;]*m/gu, "").split(/\r?\n/u)) {
    const heading = /^\s*📖\s+(.+?)\s+\(\d+ results?\)\s*$/u.exec(line)
    if (heading !== null) { title = heading[1]?.trim() ?? ""; current = undefined; continue }
    const link = /^\s*➡\uFE0F?\s+(https:\/\/\S+)\s*$/u.exec(line)
    if (title && link?.[1] !== undefined && !candidates.some((item) => item.url === link[1])) {
      current = { title, url: link[1] }
      candidates.push(current)
      continue
    }
    // LNCrawl prints the source-provided synopsis on the indented line after each URL.
    const synopsis = /^\s{4,}(?!➡)(.+?)\s*$/u.exec(line)
    if (current !== undefined && current.synopsis === undefined && synopsis?.[1] !== undefined) {
      current.synopsis = synopsis[1].trim().slice(0, 4_000)
    }
  }
  return candidates
}

function hasDescriptiveSynopsis(value: string | undefined): value is string {
  if (value === undefined) return false
  const synopsis = value.trim()
  return synopsis.length >= 40 && !unusableSynopsisPattern.test(synopsis)
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(path))
    else files.push(path)
  }
  return files
}

export class LncrawlReferenceService {
  private readonly binaryDirectory: string
  private readonly candidatesByWorkspace = new Map<string, Map<string, { title: string; url: string; synopsis?: string }>>()

  public constructor(applicationDataRoot: string, private readonly options: Readonly<{ runtimeDirectory?: string; run?: RunProcess }> = {}) {
    this.binaryDirectory = join(resolve(applicationDataRoot), "tools", "lncrawl")
  }

  public async search(title: string, workspaceRootRef: string, signal?: AbortSignal, source?: string) {
    const binary = await this.bundledCli(signal)
    const dataDirectory = this.dataDirectory(workspaceRootRef)
    await this.prepareBackgroundConfig(dataDirectory)
    const result = await this.run(binary, ["search", title, "--limit", "10", "--timeout", "20", ...(source ? ["--source", source] : [])], dataDirectory, signal, {
      LNCRAWL_DATA_PATH: dataDirectory,
      NO_COLOR: "1", TERM: "dumb", PYTHONIOENCODING: "utf-8", COLUMNS: "300",
    })
    const candidates = searchCandidates(result.stdout)
    const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]))
    this.candidatesByWorkspace.set(resolve(workspaceRootRef), byUrl)
    return { title, output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.slice(0, maxCliOutputBytes), candidates, candidateUrls: [...byUrl.keys()] }
  }

  public async crawl(input: Readonly<{
    url: string
    title: string
    workspaceRootRef: string
    workspace: WorkspacePort
    chapterLimit?: number
    signal?: AbortSignal
  }>) {
    let parsed: URL
    try { parsed = new URL(input.url) } catch { throw new Error("原作候选 URL 无效") }
    const candidate = this.candidatesByWorkspace.get(resolve(input.workspaceRootRef))?.get(input.url)
    if (parsed.protocol !== "https:" || candidate === undefined) {
      throw new Error("只能抓取本次原作搜索返回的 HTTPS 候选 URL；请先搜索并核对版本")
    }
    if (!hasDescriptiveSynopsis(candidate.synopsis)) {
      throw new Error("该候选没有可核对的作品简介；请先通过网络搜索补查作品介绍，再决定是否抓取")
    }
    if (input.chapterLimit === undefined) {
      throw new Error("必须显式指定 chapterLimit，先小范围抓取核验；禁止默认下载全本")
    }
    if (!Number.isSafeInteger(input.chapterLimit) || input.chapterLimit < 1 || input.chapterLimit > maxEntries) {
      throw new Error(`chapterLimit 必须为 1 到 ${String(maxEntries)} 的整数`)
    }
    const binary = await this.bundledCli(input.signal)
    const root = "参考文件/原作资料"
    // eslint-disable-next-line no-control-regex -- forbid control characters in filesystem names
    const slug = input.title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 80) || "原作资料"
    const destination = `${root}/${slug}`
    await input.workspace.createUserDirectory(input.workspaceRootRef, `${destination}/章节`)
    const outputDirectory = this.dataDirectory(input.workspaceRootRef)
    await this.prepareBackgroundConfig(outputDirectory)
    await mkdir(outputDirectory, { recursive: true })
    const before = new Map(await Promise.all((await walkFiles(outputDirectory)).filter((file) => extname(file).toLowerCase() === ".zip")
      .map(async (file) => [file, (await stat(file)).mtimeMs] as const)))
    const result = await this.run(binary, ["crawl", input.url, "--noin", "--first", String(input.chapterLimit), "--format", "json"], outputDirectory, input.signal, {
      LNCRAWL_DATA_PATH: outputDirectory,
      NO_COLOR: "1", TERM: "dumb", PYTHONIOENCODING: "utf-8", COLUMNS: "300",
    })
    const candidates = (await walkFiles(outputDirectory)).filter((file) => extname(file).toLowerCase() === ".zip")
    const latest = (await Promise.all(candidates.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs }))))
      .filter((file) => before.get(file.path) !== file.modified)
      .sort((left, right) => left.modified - right.modified).at(-1)?.path
    if (latest === undefined) throw new Error(`LNCrawl 没有生成 JSON ZIP 归档。${result.stdout.slice(-2000)} ${result.stderr.slice(-1000)}`)
    const jsonEntries = await readZipJsonEntries(latest)
    if (jsonEntries.length === 0) throw new Error("LNCrawl 归档中没有章节 JSON")
    const imported: string[] = []
    for (const entry of jsonEntries) {
      input.signal?.throwIfAborted()
      try {
        const chapter = chapterMarkdown(entry)
        if (chapter === undefined) continue
        const relativePath = `${destination}/章节/${chapter.filename}`
        await input.workspace.saveUserMarkdown(input.workspaceRootRef, relativePath, chapter.markdown)
        imported.push(relativePath)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
    }
    if (imported.length === 0) throw new Error("归档中未找到可导入的章节文本")
    const indexPath = `${destination}/README.md`
    const index = [
      `# ${input.title}`,
      "",
      `- 来源：${input.url}`,
      `- 抓取时间：${new Date().toISOString()}`,
      `- 导入章节：${String(imported.length)}`,
      `- 请求范围：前 ${String(input.chapterLimit)} 章；非全本`,
      "- 原始归档：由 StarseaFolio 保存在应用数据缓存中",
      "",
      ...imported.map((path) => `- [${basename(path, ".md")}](${path.slice(destination.length + 1)})`),
      "",
    ].join("\n")
    await input.workspace.saveUserMarkdown(input.workspaceRootRef, indexPath, index)
    return { title: input.title, importedFiles: [indexPath, ...imported], output: result.stdout.slice(-4000) }
  }

  private dataDirectory(workspaceRootRef: string): string {
    return join(this.binaryDirectory, "books", createHash("sha256")
      .update(resolve(workspaceRootRef)).digest("hex").slice(0, 20))
  }

  private async prepareBackgroundConfig(dataDirectory: string): Promise<void> {
    await mkdir(dataDirectory, { recursive: true })
    const configPath = join(dataDirectory, "config.json")
    const config: Record<string, unknown> = await readFile(configPath, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => ({}))
    const crawler = config.crawler !== null && typeof config.crawler === "object" ? config.crawler : {}
    config.crawler = { ...crawler, can_use_browser: false, ignore_images: true }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  }

  private async bundledCli(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const directory = resolve(this.options.runtimeDirectory
      ?? fileURLToPath(new URL("../../../../desktop/resources/lncrawl/", import.meta.url)))
    const manifest: BundleManifest = await readFile(join(directory, "bundle-manifest.json"), "utf8")
      .then((value) => JSON.parse(value) as BundleManifest)
      .catch(() => { throw new Error("内置 LNCrawl 运行时缺失，请重新安装完整版本的星海余页") })
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
      throw new Error("内置 LNCrawl 运行时平台不匹配，请安装当前平台版本的星海余页")
    }
    if (manifest.executable === undefined || manifest.executableDigest === undefined
      || isAbsolute(manifest.executable) || manifest.executable.includes("..")) {
      throw new Error("内置 LNCrawl 清单无效，请重新安装星海余页")
    }
    const executable = join(directory, manifest.executable)
    const actual = await readFile(executable).then((bytes) => createHash("sha256").update(bytes).digest("hex")).catch(() => "")
    const dependencies = await stat(join(directory, "_internal")).catch(() => undefined)
    if (actual !== manifest.executableDigest || dependencies?.isDirectory() !== true) {
      throw new Error("内置 LNCrawl 完整性校验失败，请重新安装星海余页")
    }
    return executable
  }

  private async run(binary: string, args: string[], cwd: string, signal?: AbortSignal, extraEnv: NodeJS.ProcessEnv = {}) {
    await mkdir(cwd, { recursive: true })
    signal?.throwIfAborted()
    if (this.options.run !== undefined) return this.options.run(binary, args, cwd, signal, extraEnv)
    return new Promise<{ stdout: string; stderr: string }>((resolveRun, reject) => {
      const child = spawn(binary, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let bytes = 0
      let failed = false
      let timedOut = false
      const stopProcessTree = () => {
        if (child.pid === undefined) return
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
          killer.on("error", () => undefined)
        } else child.kill()
      }
      const timeout = setTimeout(() => { timedOut = true; stopProcessTree() }, 180_000)
      const abort = () => { stopProcessTree(); }
      signal?.addEventListener("abort", abort, { once: true })
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes <= maxCliOutputBytes) target.push(chunk)
      }
      child.stdout.on("data", collect(stdout))
      child.stderr.on("data", collect(stderr))
      child.on("error", (error) => { failed = true; clearTimeout(timeout); reject(error) })
      child.on("close", (code, closeSignal) => {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", abort)
        const out = Buffer.concat(stdout).toString("utf8")
        const err = Buffer.concat(stderr).toString("utf8")
        if (signal?.aborted) { reject(new Error("原作资料任务已取消")); return; }
        if (timedOut) { reject(new Error("LNCrawl 执行超过 3 分钟，已停止本次资料任务")); return; }
        if (failed) return
        if (code !== 0) { reject(new Error(`LNCrawl 退出码 ${String(code)}${closeSignal ? ` (${closeSignal})` : ""}：${err.slice(-2000)}`)); return; }
        resolveRun({ stdout: out, stderr: err })
      })
    })
  }
}
