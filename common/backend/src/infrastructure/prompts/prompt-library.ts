import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

/**
 * 全局提示词库。
 *
 * - 文件存放在应用数据目录的 `prompt-library/` 下，按中文分类。
 * - 提示词加载器优先读取这里的内容，没有覆盖时回退到随包发布的 md。
 * - 工作区里的 `提示词/` 与平台规则投影只是镜像，保存时先写全局库，再同步镜像。
 * - 库根目录的 `.seed-manifest.json` 记录每个 libraryPath 最近一次 seed 的 sha256。
 *   升级时只有「文件内容仍等于上次 seed」的条目才会被新随包内容替换，用户编辑一律保留。
 */

export const PROMPT_LIBRARY_ROOT = "提示词"
export const PROMPT_LIBRARY_CATEGORIES = ["基础规则", "用户规则", "系统记忆"] as const
/** Seed digest manifest living at the prompt library root. */
export const PROMPT_LIBRARY_SEED_MANIFEST = ".seed-manifest.json"

/**
 * 已下线的提示词库文件：独立 skill 索引已并入系统提示词，
 * 升级时从库里删除旧副本，避免面板里继续显示过时索引。
 */
export const RETIRED_LIBRARY_PATHS = [
  "基础规则/系统提示词/06-讨论技能索引.md",
  "系统规则/skill-index.md",
] as const

const COMPOSE_RESOURCE = "resources/v1/prompt-docs/stages/02-compose.md"
const LEGACY_COMPOSE_DOCS = [
  ["02-梗概阶段.md", "resources/v1/prompt-docs/stages/02-synopsis.md"],
  ["03-草稿阶段.md", "resources/v1/prompt-docs/stages/03-draft.md"],
  ["细纲阶段.md", "resources/v1/synopsis-to-outline-guide.md"],
] as const

const SEED_MANIFEST_VERSION = 1
const SEED_DIGEST_PATTERN = /^[0-9a-f]{64}$/u

export type PromptLibraryWorkspaceFile = Readonly<{
  relativePath: string
  markdown: string
}>

export type PromptLibraryEntry = Readonly<{
  /** Package-relative resource path, e.g. `resources/v1/phases/draft.md`. */
  resourcePath: string
  /** Library-relative path, e.g. `阶段提示/draft.md`. */
  libraryPath: string
  /** Previous location used by builds with nested message prompt folders. */
  legacyLibraryPath?: string
  /** Platform rule projections in the project workspace. */
  workspaceMirrors: readonly string[]
}>

export type PromptLibrarySaveTarget = Readonly<{
  entry: PromptLibraryEntry
  /** Every workspace path that must be updated for this entry. */
  workspacePaths: readonly string[]
}>

export type PromptLibrarySeedManifest = Readonly<{
  version: number
  /** libraryPath -> sha256 of the normalized content that was seeded. */
  seeds: Readonly<Record<string, string>>
}>

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "")
}

function normalizeMarkdown(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd() + "\n"
}

/** sha256 over the same normalized form used for library files and bundled resources. */
function seedDigest(markdown: string): string {
  return createHash("sha256").update(normalizeMarkdown(markdown), "utf8").digest("hex")
}

function parseSeedManifest(raw: string): PromptLibrarySeedManifest | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  const record = value as { version?: unknown; seeds?: unknown }
  if (record.version !== SEED_MANIFEST_VERSION) return undefined
  if (typeof record.seeds !== "object" || record.seeds === null || Array.isArray(record.seeds)) return undefined
  const seeds: Record<string, string> = {}
  for (const [key, digest] of Object.entries(record.seeds)) {
    if (typeof digest !== "string" || !SEED_DIGEST_PATTERN.test(digest)) continue
    seeds[normalizePath(key)] = digest
  }
  return { version: SEED_MANIFEST_VERSION, seeds }
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/** Write through a unique temp file + rename so readers never observe a partial file. */
async function writeTextAtomically(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: "utf8" })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Serialize seed/edit writes per library root inside this process.
 * Seeding reads a file's digest and may then overwrite it, so a concurrent user save
 * must never land between that read and the overwrite.
 */
const libraryQueues = new Map<string, Promise<void>>()

function withLibraryLock<T>(libraryRoot: string, task: () => Promise<T>): Promise<T> {
  const previous = libraryQueues.get(libraryRoot) ?? Promise.resolve()
  const running = previous.then(task, task)
  const tail = running.then(() => undefined, () => undefined)
  libraryQueues.set(libraryRoot, tail)
  void tail.finally(() => {
    if (libraryQueues.get(libraryRoot) === tail) libraryQueues.delete(libraryRoot)
  })
  return running
}

export function createPromptLibraryEntries(promptPackageRoot: string): readonly PromptLibraryEntry[] {
  void promptPackageRoot
  return [
    { resourcePath: "resources/v1/prompt-docs/system/01-world-and-base.md", libraryPath: "基础规则/系统提示词/01-世界与基础规则.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/system/02-content-and-safety.md", libraryPath: "基础规则/系统提示词/02-内容处理与安全边界.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/system/03-writing-voice.md", libraryPath: "基础规则/系统提示词/03-去AI味与写作声音.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/system/04-query-facts.md", libraryPath: "基础规则/系统提示词/04-查询事实规则.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/system/05-revision-audit.md", libraryPath: "基础规则/系统提示词/05-修订审核规则.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/dynamic/01-before-user-message.md", libraryPath: "基础规则/消息前后/01-用户消息前.md", legacyLibraryPath: "基础规则/消息前后/用户消息前/01-用户消息前.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/dynamic/02-after-user-message.md", libraryPath: "基础规则/消息前后/02-用户消息后.md", legacyLibraryPath: "基础规则/消息前后/用户消息后/02-用户消息后.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/stages/01-new-chapter.md", libraryPath: "基础规则/阶段提示词/01-新章节阶段.md", workspaceMirrors: [] },
    { resourcePath: COMPOSE_RESOURCE, libraryPath: "基础规则/阶段提示词/02-构思阶段.md", workspaceMirrors: [] },
    { resourcePath: "resources/v1/prompt-docs/stages/04-ingestion.md", libraryPath: "基础规则/阶段提示词/04-章节入库阶段.md", workspaceMirrors: [] },
  ]
}

type ResolvedEntry = Readonly<{
  entry: PromptLibraryEntry
  bundledPath: string
  libraryFilePath: string
}>

export class PromptLibraryService {
  public readonly libraryRoot: string
  public readonly seedManifestPath: string
  public readonly entries: readonly PromptLibraryEntry[]
  private readonly resolvedByResourcePath = new Map<string, ResolvedEntry>()
  private readonly resolvedByLibraryPath = new Map<string, ResolvedEntry>()
  private readonly resolvedByWorkspacePath = new Map<string, ResolvedEntry>()
  private revision = 0

  public constructor(
    private readonly promptPackageRoot: string,
    libraryRoot: string,
  ) {
    this.libraryRoot = resolve(libraryRoot)
    this.seedManifestPath = join(this.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST)
    this.entries = createPromptLibraryEntries(promptPackageRoot)
    for (const entry of this.entries) {
      const resolved: ResolvedEntry = {
        entry,
        bundledPath: join(promptPackageRoot, entry.resourcePath),
        libraryFilePath: join(this.libraryRoot, entry.libraryPath),
      }
      this.resolvedByResourcePath.set(normalizePath(entry.resourcePath), resolved)
      this.resolvedByLibraryPath.set(normalizePath(entry.libraryPath), resolved)
      if (entry.legacyLibraryPath !== undefined) {
        this.resolvedByWorkspacePath.set(`${PROMPT_LIBRARY_ROOT}/${entry.legacyLibraryPath}`, resolved)
      }
      for (const workspacePath of this.workspacePaths(entry)) {
        this.resolvedByWorkspacePath.set(normalizePath(workspacePath), resolved)
      }
    }
  }

  public get currentRevision(): number {
    return this.revision
  }

  /**
   * Seed the global prompt library from bundled resources.
   *
   * - Missing files are written from the bundle.
   * - Files still matching their recorded seed digest are refreshed when the bundle changes.
   * - User-edited files are never overwritten.
   * - Libraries created before `.seed-manifest.json` existed are migrated by matching the
   *   `legacySeedDigests` shipped in v0.0.1-118 (commit 53d07bc): only untouched files update.
   */
  public async ensureSeeded(): Promise<void> {
    await withLibraryLock(this.libraryRoot, async () => {
      const manifest = await this.readSeedManifest()
      const seeds = new Map<string, string>(Object.entries(manifest?.seeds ?? {}))
      const bundled = await Promise.all(this.entries.map(async (entry) => ({
        entry,
        markdown: await this.readBundled(entry.resourcePath),
      })))
      let changed = false
      for (const { entry, markdown } of bundled) {
        const key = normalizePath(entry.libraryPath)
        const target = join(this.libraryRoot, entry.libraryPath)
        const bundledDigest = seedDigest(markdown)
        const current = await readTextIfPresent(target)
        if (current === undefined && entry.resourcePath === COMPOSE_RESOURCE) {
          const merged = await this.migrateComposeMarkdown(markdown, seeds)
          await writeTextAtomically(target, merged)
          seeds.set(key, bundledDigest)
          changed = true
          continue
        }
        if (current === undefined) {
          const legacyPath = entry.legacyLibraryPath
          const legacy = legacyPath === undefined ? undefined : await readTextIfPresent(join(this.libraryRoot, legacyPath))
          const previousSeed = legacyPath === undefined ? undefined : seeds.get(legacyPath)
          const edited = legacy !== undefined && seedDigest(legacy) !== (previousSeed ?? bundledDigest)
          await writeTextAtomically(target, edited ? legacy : markdown)
          seeds.set(key, edited ? previousSeed ?? bundledDigest : bundledDigest)
          changed = true
          continue
        }
        const currentDigest = seedDigest(current)
        const recordedSeed = seeds.get(key)
        if (recordedSeed !== undefined) {
          if (currentDigest !== recordedSeed) continue // User edit: keep file and baseline.
          if (currentDigest !== bundledDigest) {
            await writeTextAtomically(target, markdown)
            changed = true
          }
          if (recordedSeed !== bundledDigest) {
            seeds.set(key, bundledDigest)
            changed = true
          }
          continue
        }
        if (currentDigest === bundledDigest) {
          // Content already equals this bundle, e.g. seeded by a build without a manifest.
          seeds.set(key, bundledDigest)
          changed = true
          continue
        }
        const legacyDigest = legacySeedDigests[key]
        if (legacyDigest !== undefined && currentDigest === legacyDigest) {
          await writeTextAtomically(target, markdown)
          seeds.set(key, bundledDigest)
          changed = true
          continue
        }
        if (legacyDigest !== undefined) {
          // Legacy file the user edited: keep content, remember which seed it came from.
          seeds.set(key, legacyDigest)
          changed = true
        }
      }
      if (changed || (manifest === undefined && this.entries.length > 0)) {
        const nextManifest: PromptLibrarySeedManifest = {
          version: SEED_MANIFEST_VERSION,
          seeds: Object.fromEntries(seeds),
        }
        await writeTextAtomically(this.seedManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)
      }
      for (const retired of RETIRED_LIBRARY_PATHS) {
        const retiredKey = normalizePath(retired)
        if (!existsSync(join(this.libraryRoot, retired))) continue
        await rm(join(this.libraryRoot, retired), { force: true })
        if (seeds.delete(retiredKey)) {
          await writeTextAtomically(this.seedManifestPath, `${JSON.stringify({
            version: SEED_MANIFEST_VERSION,
            seeds: Object.fromEntries(seeds),
          }, null, 2)}\n`)
        }
      }
    })
  }

  private async migrateComposeMarkdown(markdown: string, seeds: ReadonlyMap<string, string>): Promise<string> {
    let merged = markdown
    const supplemental: string[] = []
    const blocks = /<!-- ((?:phase|skill):[\w-]+) -->[\s\S]*?<!-- \/\1 -->/gu
    for (const [name, resourcePath] of LEGACY_COMPOSE_DOCS) {
      const key = `基础规则/阶段提示词/${name}`
      const legacy = await readTextIfPresent(join(this.libraryRoot, key))
      if (legacy === undefined) continue
      const baseline = await this.readBundled(resourcePath)
      if (seedDigest(legacy) === (seeds.get(key) ?? seedDigest(baseline))) continue
      const originalBlocks = new Map(Array.from(baseline.matchAll(blocks), (match) => [match[1], match[0]]))
      let recognized = false
      for (const match of normalizeMarkdown(legacy).matchAll(blocks)) {
        const marker = match[1]
        const currentBlock = Array.from(merged.matchAll(blocks)).find((block) => block[1] === marker)
        if (currentBlock === undefined) continue
        recognized = true
        if (originalBlocks.get(marker) !== match[0]) merged = merged.replace(currentBlock[0], () => match[0])
      }
      if (!recognized) supplemental.push(`## 迁移自 ${name}\n\n${legacy.trim()}`)
    }
    if (supplemental.length > 0) {
      merged = merged.replace("<!-- /phase:synopsis-discuss -->", () => `${supplemental.join("\n\n")}\n\n<!-- /phase:synopsis-discuss -->`)
    }
    return normalizeMarkdown(merged)
  }

  public async readOverride(resourcePath: string): Promise<string | undefined> {
    const resolved = this.resolvedByResourcePath.get(normalizePath(resourcePath))
    if (resolved === undefined) return undefined
    try {
      return await readFile(resolved.libraryFilePath, "utf8")
    } catch {
      return undefined
    }
  }

  public async readEffective(resourcePath: string): Promise<string> {
    return await this.readOverride(resourcePath) ?? await this.readBundled(resourcePath)
  }

  public async write(libraryPath: string, content: string): Promise<void> {
    const resolved = this.resolvedByLibraryPath.get(normalizePath(libraryPath))
    if (resolved === undefined) throw new Error(`Unknown prompt library path: ${libraryPath}`)
    await withLibraryLock(this.libraryRoot, async () => {
      await writeTextAtomically(resolved.libraryFilePath, content)
      this.revision += 1
    })
  }

  /** Resolve a workspace path (platform mirror or `提示词/...`) to its library entry. */
  public resolveWorkspacePath(workspacePath: string): PromptLibrarySaveTarget | undefined {
    const resolved = this.resolvedByWorkspacePath.get(normalizePath(workspacePath))
    if (resolved === undefined) return undefined
    return {
      entry: resolved.entry,
      workspacePaths: this.workspacePaths(resolved.entry),
    }
  }

  /** All workspace paths for a library entry, including the `提示词/...` mirror. */
  public workspacePaths(entry: PromptLibraryEntry): readonly string[] {
    const paths = new Set<string>([`${PROMPT_LIBRARY_ROOT}/${entry.libraryPath}`, ...entry.workspaceMirrors])
    return [...paths]
  }

  /** Build the files that should be materialized in a project workspace. */
  public async buildWorkspaceMirrorFiles(): Promise<readonly PromptLibraryWorkspaceFile[]> {
    await this.ensureSeeded()
    const files = new Map<string, string>()
    const perEntry = await Promise.all(this.entries.map(async (entry) => ({
      paths: this.workspacePaths(entry),
      markdown: normalizeMarkdown(await this.readEffective(entry.resourcePath)),
    })))
    for (const item of perEntry) {
      for (const relativePath of item.paths) files.set(relativePath, item.markdown)
    }
    return [...files.entries()].map(([relativePath, markdown]) => ({ relativePath, markdown }))
  }

  /** Sync path for runtime prompt sections (`renderRuntimePrompt`). */
  public runtimeOverridePath(file: string): string | undefined {
    return this.overridePathFor(`resources/v1/runtime/${file}.md`)
  }

  /** Sync path for resources read through `readBundledPromptMarkdown`. */
  public resourceOverridePath(resourcePath: string): string | undefined {
    return this.overridePathFor(resourcePath)
  }

  private overridePathFor(resourcePath: string): string | undefined {
    const resolved = this.resolvedByResourcePath.get(normalizePath(resourcePath))
    if (resolved === undefined || !existsSync(resolved.libraryFilePath)) return undefined
    return resolved.libraryFilePath
  }

  private async readSeedManifest(): Promise<PromptLibrarySeedManifest | undefined> {
    const raw = await readTextIfPresent(this.seedManifestPath)
    return raw === undefined ? undefined : parseSeedManifest(raw)
  }

  private async readBundled(resourcePath: string): Promise<string> {
    return normalizeMarkdown(await readFile(join(this.promptPackageRoot, resourcePath), "utf8"))
  }
}

/** Read the canonical bundled prompt library path for a resource, for tests/diagnostics. */
export function resolvePromptLibraryFilePath(promptPackageRoot: string, libraryRoot: string, libraryPath: string): string {
  const entries = createPromptLibraryEntries(promptPackageRoot)
  const entry = entries.find((item) => normalizePath(item.libraryPath) === normalizePath(libraryPath))
  if (entry === undefined) throw new Error(`Unknown prompt library path: ${libraryPath}`)
  return join(resolve(libraryRoot), entry.libraryPath)
}

/**
 * Seed digests shipped with v0.0.1-118 (commit `53d07bc`, the release that introduced the
 * editable global prompt library), keyed by library path.
 *
 * Generated from `git show 53d07bc:common/packages/prompt-contracts/<resourcePath>` after
 * applying the same normalization as `normalizeMarkdown` (CRLF -> LF, trimEnd, trailing
 * newline), then sha256. Only used for the one-time migration of libraries that predate
 * `.seed-manifest.json`; matching files are untouched seeds, everything else is a user edit.
 */
export const legacySeedDigests: Readonly<Record<string, string>> = {
  "技能/book-cold-start.md": "485c0aaa0fdf069e1a9b8681e8f4c85cfa600e7c804943ca2f7e788dbf89839e",
  "技能/deslop.md": "d291ecc8467a8a27dd6b373fe8e5b20df239e645dfe2da41a12300b355ac1e6f",
  "技能/dialogue.md": "9f7513c0c0ef597cdb9d942dd2974ddc39a11c64e4a44b4e442c5ec370edf45f",
  "技能/emotion.md": "b0e93c9667506992df61113529d0aaeb24e2325e2bb0b329bd18e3b21a64490e",
  "技能/human.md": "8b7c62297f1f34c85b0e37ced6231e7afac46af1b985dc949c1579570c36e073",
  "技能/starsea-writing.md": "262d8ec371ede48205fac03e63cbad8d983691a89b0096efec7b1d0a516570b6",
  "阶段提示/chapter-naming.md": "16bfba8f801ebf4e72ae96872af725645417ab502db121cb58aa36107c194513",
  "阶段提示/commit-review.md": "7acb49fa98012e7ccb3be0e8c9043ccd05cea0eb65a70901c49a295a523528b2",
  "阶段提示/dependency-audit.md": "8b0f86c36c74cb1ebcf9c9d817fd79fc02d2ce791f66760085c2a24115b0ae4b",
  "阶段提示/draft.md": "17392e4c8702ea3cd1d11fc187cdf5d4283aecccdc9f772a6688caa53446c0d3",
  "阶段提示/emergence-planning.md": "65c24b5ffff070b134fcd65b37d55e66d5093519ea154048486de6d4750739e6",
  "阶段提示/emergence-review.md": "a229df0d3043c6b34683db8138f5156a9ada19f650359ca682dcd5dcef8cb67a",
  "阶段提示/frontier-settlement.md": "d3b8ab8c62ad1b14b84d0c66a064348b32e11ab86b77b3158d11a68f375e569f",
  "阶段提示/graph-capacity-rewrite.md": "0cedf9371104233fed17183788e34a0d16c26d56a8f80fdbff21402964134a51",
  "阶段提示/graph-governance-review.md": "7dbe6d5d54acaaedf0e51b16fc5d3b7e623befa15345089088ae99f1ac60f267",
  "阶段提示/graph-governance.md": "2101e57aa73797916f472f469f852ecb246fd9d73392ae062df8702803be4281",
  "阶段提示/graph-retrieval-design.md": "4785beeb03d900a47242f7527193df420896efb061dfef415222d2be40fd56e4",
  "阶段提示/graph-spacetime-settlement.md": "a0887cf3e9e708974b56b80429a4043c5ee0baa4f09159774f4198eaabf57328",
  "阶段提示/graph-structure-plan.md": "0feca363f37c3d3051062623dcaf2e57e0c1a216e86756ac4a5e6c4c4ee40043",
  "阶段提示/interpret.md": "e2b9803502bddd6061ebca324121f2f98a7884da795209aa2de0e7f15d17806c",
  "阶段提示/response-review.md": "e3a8433abd3162da80825b7d9958d959e2e341b494b06cb6d4c058b01c7f50f8",
  "阶段提示/revision-review.md": "3745ef7ecfb2c37c3350b57e195394978f588e9d23f8cd9f8b406a03a43db340",
  "阶段提示/rule-assembly.md": "99ee5ab49180e9c177b69abfd8df8100f2f53c29a57df53a1dc718404278d73c",
  "阶段提示/semantic-review.md": "2b6492cec192fa3bebdc34a9e375745bab1f3ea678f666707155cf543f881b6c",
  "阶段提示/settings-extraction.md": "92b382ef0ed3cce1f7b0db83adbffb588fac29ed3451ee6a45264d71ac6ef2fd",
  "阶段提示/settlement-review.md": "82ab9af0ce1a03bfb4c9507711fd04d7a60deae74afb77fd5255a2eac041fba9",
  "阶段提示/source-retrieval.md": "69eff61edfca2c63a021f2bafccbbcc6c7344806faa30a2d5b5b41cfdcaf8160",
  "阶段提示/synopsis-discuss.md": "385bd996e7a318527f6473c44e7ef164b67110fe731a4fba6e38169aad3f3660",
  "阶段提示/work-naming.md": "e4d4194af2cec92bad4be96dac39b38b14044a791b64c3d0093d3849a804e495",
  "阶段提示/work-style-revision.md": "06259a591b3ef716c8c72b544f6b2be072ce0408d1fa39cb186c6f2809474e3b",
  "系统规则/base-rules.md": "604619585bdc6bfb34e934563ea2c5b6153b7831d1c0c9440bf3aa06b0d75e2a",
  "系统规则/content-handling.md": "5a83fd254afc11dae8116ff81a6ba2a35e3b3bffe2907773895d48a61d09377f",
  "系统规则/settings-query-guide.md": "cb12bd5d1b06b1e1cfdef42e1a5a6ee0a9513b27b135fdfc846c141a7087d069",
  "系统规则/webnovel-prose-logic.md": "b34392e3fe88a795fa72d964ed0005d09204a78ef1e537db08db9c3a706d4270",
  "系统规则/world-rules-overview.md": "e949bce2c3c2c1d203630ab621a982e9b39564a50cfa382641643c6ae2574711",
  "写作指南/batch-volume-deduction-plan.md": "5e07ba4505920b81a9c8bd12cd19fe729b2ba1a035aa3b50b9d956e397cab946",
  "写作指南/character-profiles.md": "3b49124ba7bd35b3564fb2994d8e875ff74d335b8ad5be8c769118e9c5cfa79e",
  "写作指南/discuss-creation-desk-workflow.md": "5fd8168fbfd6944b3c0cf8f97b9604516cf4567fd71ac3f10b2c9feeb81c0ad3",
  "写作指南/outline-to-draft-guide.md": "2d101849b051b9b126347f41d27796d43d2ed034ba3e67f650afb9a7b7fcdeaf",
  "写作指南/plot-synopsis-guide.md": "5b59c498a9524e576a05df57fa33d79e6fe3ffd609bb1cf4d1df6475d0c1849a",
  "写作指南/settings-revision-guide.md": "0af58246d672891b1eea7760fdb3d2f7eabd8dc6a8e9a2e4ba56c0e90a2fc775",
  "写作指南/synopsis-to-outline-guide.md": "0a088f742feac8b220b98441ab0cf8d871937e2a9f38a65dca122e61b927dcb3",
  "写作指南/user-to-synopsis-guide.md": "77ef27d46a1b2e3c37df367a6a30bf29ecbbe19b1b8716de9febdf3edcac0808",
  "运行时提示/chapter-settings.md": "0d4ad89239857a98e39cea9f178167c7b899564ef51f00b7fb7ebfeb31b9e7e3",
  "运行时提示/discuss-agent-policy.md": "c116dd7c466c958c33fc36a4e08c54b8b422645e7aca1a77af3154411498e912",
  "运行时提示/discuss-appendices.md": "5e908953be5e0b3c9d33d67f525972672806a550df9ae5c10da0aea475a81527",
  "运行时提示/discuss-block-notes.md": "b813166f3467b9131c92dfb9b86209d7a745659a35dfade95ceffab091296dd6",
  "运行时提示/discuss-creative-setup.md": "3e14792f5dfb50f494465dd8e8dc23a7d162e5456f33593d76954d8c5f7bd15c",
  "运行时提示/discuss-evidence.md": "7202dd7ca66c626d5ea31f5c256f1970d5214e0734f45ae006ed18607dce4362",
  "运行时提示/discuss-messages.md": "750771f4bce2038c110eb535732c9d2089cdaaf7ae6cf935a5349330dce5c669",
  "运行时提示/discuss-repairs.md": "6dc16001105273a8e788ba4a947c4762ea77d18cd9cb36fb76bc7391e0010d50",
  "运行时提示/discuss-session.md": "bbef0fab8ac92c79c1c5353837b9372598d1bdc4f3c0aa6c0aa62e2d7a00c1e4",
  "运行时提示/discuss-tools.md": "e22451673ac99115c2dd462134ca3b9a39337e7b085d5a3cfb98f678b239490f",
  "运行时提示/evidence-format.md": "9a43b226b999a81fd1cf16acf209ca52e9a50437afd487948a774fc1d7ccb2d6",
  "运行时提示/original-work-evidence.md": "5f720ee41722f7078b367b51ace0370d6ee3cd2b37043516246068a9f27e49bb",
  "运行时提示/presentation-evidence.md": "449a353006bcaf59175c7348756676571758d818f53ff8cd6554c11f2fa1ef6d",
  "运行时提示/provider-auxiliary.md": "7a46ee200bc0f7698fd94b6cdd71eb9766497375d13f89ae2c0a48bb4a9c0283",
  "运行时提示/provider-phase-checklists.md": "fb5931be14caa460d07a7fe118426e729f873843b04e66db33f2e6d88ebfee7e",
  "运行时提示/provider-protocol.md": "12478ed8b0963a1a6f9929f286be86bc571e55abc3bf09f1290d0ae6301f4665",
  "运行时提示/provider-repair.md": "31f61c9e1d8ed26797e024c8a47efa0503e13900f44c5a40071262534c82a25a",
  "运行时提示/turn-context.md": "8afc92ed77e03284b71ea0a774e4ba82df2877adf011d4fd99aed75c0ddafb7a",
  "运行时提示/world-divergence.md": "2563e7478f5009156f5ffe1b86e2facafab681e51e97b220ccd3b96e91c15620",
}
