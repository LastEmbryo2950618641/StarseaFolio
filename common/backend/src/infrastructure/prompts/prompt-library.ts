import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

/**
 * 全局提示词库。
 *
 * - 文件存放在应用数据目录的 `prompt-library/` 下，按中文分类。
 * - 提示词加载器优先读取这里的内容，没有覆盖时回退到随包发布的 md。
 * - 工作区里的 `提示词/` 与平台规则投影只是镜像，保存时先写全局库，再同步镜像。
 */

export const PROMPT_LIBRARY_ROOT = "提示词"
export const PROMPT_LIBRARY_CATEGORIES = ["系统规则", "阶段提示", "运行时提示", "写作指南", "技能"] as const

export type PromptLibraryWorkspaceFile = Readonly<{
  relativePath: string
  markdown: string
}>

export type PromptLibraryEntry = Readonly<{
  /** Package-relative resource path, e.g. `resources/v1/phases/draft.md`. */
  resourcePath: string
  /** Library-relative path, e.g. `阶段提示/draft.md`. */
  libraryPath: string
  /** Platform rule projections in the project workspace. */
  workspaceMirrors: readonly string[]
}>

export type PromptLibrarySaveTarget = Readonly<{
  entry: PromptLibraryEntry
  /** Every workspace path that must be updated for this entry. */
  workspacePaths: readonly string[]
}>

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "")
}

function normalizeMarkdown(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd() + "\n"
}

function readMdNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
}

export function createPromptLibraryEntries(promptPackageRoot: string): readonly PromptLibraryEntry[] {
  const resourceRoot = join(promptPackageRoot, "resources")
  const system: PromptLibraryEntry[] = [
    { resourcePath: "resources/v1/world-rules-overview.md", libraryPath: "系统规则/world-rules-overview.md", workspaceMirrors: ["世界推演规则/总览.md"] },
    { resourcePath: "resources/v1/base-rules.md", libraryPath: "系统规则/base-rules.md", workspaceMirrors: ["世界推演规则/基础规则/base-rules.md"] },
    { resourcePath: "resources/v1/content-handling.md", libraryPath: "系统规则/content-handling.md", workspaceMirrors: ["世界推演规则/基础规则/content-handling.md"] },
    { resourcePath: "resources/v1/webnovel-prose-logic.md", libraryPath: "系统规则/webnovel-prose-logic.md", workspaceMirrors: ["世界推演规则/基础规则/webnovel-prose-logic.md"] },
    { resourcePath: "resources/v1/settings-query-guide.md", libraryPath: "系统规则/settings-query-guide.md", workspaceMirrors: ["世界推演规则/基础规则/settings-query-guide.md"] },
    { resourcePath: "resources/v1/skill-index.md", libraryPath: "系统规则/skill-index.md", workspaceMirrors: [] },
  ]
  const guides: PromptLibraryEntry[] = [
    { resourcePath: "resources/v1/plot-synopsis-guide.md", libraryPath: "写作指南/plot-synopsis-guide.md", workspaceMirrors: ["世界推演规则/基础规则/plot-synopsis-guide.md"] },
    { resourcePath: "resources/v1/user-to-synopsis-guide.md", libraryPath: "写作指南/user-to-synopsis-guide.md", workspaceMirrors: ["世界推演规则/基础规则/user-to-synopsis-guide.md"] },
    { resourcePath: "resources/v1/synopsis-to-outline-guide.md", libraryPath: "写作指南/synopsis-to-outline-guide.md", workspaceMirrors: ["世界推演规则/基础规则/synopsis-to-outline-guide.md"] },
    { resourcePath: "resources/v1/outline-to-draft-guide.md", libraryPath: "写作指南/outline-to-draft-guide.md", workspaceMirrors: ["世界推演规则/基础规则/outline-to-draft-guide.md"] },
    { resourcePath: "resources/v1/settings-revision-guide.md", libraryPath: "写作指南/settings-revision-guide.md", workspaceMirrors: ["世界推演规则/基础规则/settings-revision-guide.md"] },
    { resourcePath: "resources/v1/discuss-creation-desk-workflow.md", libraryPath: "写作指南/discuss-creation-desk-workflow.md", workspaceMirrors: ["世界推演规则/基础规则/discuss-creation-desk-workflow.md"] },
    { resourcePath: "resources/v1/guides/batch-volume-deduction-plan.md", libraryPath: "写作指南/batch-volume-deduction-plan.md", workspaceMirrors: ["世界推演规则/基础规则/batch-volume-deduction-plan.md"] },
    { resourcePath: "resources/v1/guides/character-profiles.md", libraryPath: "写作指南/character-profiles.md", workspaceMirrors: ["世界推演规则/人物设定.md"] },
  ]
  const skills: PromptLibraryEntry[] = [
    { resourcePath: "resources/skills/starsea-writing/SKILL.md", libraryPath: "技能/starsea-writing.md", workspaceMirrors: [] },
    { resourcePath: "resources/skills/book-cold-start/SKILL.md", libraryPath: "技能/book-cold-start.md", workspaceMirrors: [] },
    { resourcePath: "resources/vendor/chinese-webnovel-skills/skills/deslop.md", libraryPath: "技能/deslop.md", workspaceMirrors: [] },
    { resourcePath: "resources/vendor/chinese-webnovel-skills/skills/dialogue.md", libraryPath: "技能/dialogue.md", workspaceMirrors: [] },
    { resourcePath: "resources/vendor/chinese-webnovel-skills/skills/human.md", libraryPath: "技能/human.md", workspaceMirrors: [] },
    { resourcePath: "resources/vendor/chinese-webnovel-skills/skills/emotion.md", libraryPath: "技能/emotion.md", workspaceMirrors: [] },
  ]
  const phases = readMdNames(join(resourceRoot, "v1/phases")).map((name): PromptLibraryEntry => ({
    resourcePath: `resources/v1/phases/${name}`,
    libraryPath: `阶段提示/${name}`,
    workspaceMirrors: [],
  }))
  const runtime = readMdNames(join(resourceRoot, "v1/runtime")).map((name): PromptLibraryEntry => ({
    resourcePath: `resources/v1/runtime/${name}`,
    libraryPath: `运行时提示/${name}`,
    workspaceMirrors: [],
  }))
  return [...system, ...phases, ...runtime, ...guides, ...skills]
}

type ResolvedEntry = Readonly<{
  entry: PromptLibraryEntry
  bundledPath: string
  libraryFilePath: string
}>

export class PromptLibraryService {
  public readonly libraryRoot: string
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
    this.entries = createPromptLibraryEntries(promptPackageRoot)
    for (const entry of this.entries) {
      const resolved: ResolvedEntry = {
        entry,
        bundledPath: join(promptPackageRoot, entry.resourcePath),
        libraryFilePath: join(this.libraryRoot, entry.libraryPath),
      }
      this.resolvedByResourcePath.set(normalizePath(entry.resourcePath), resolved)
      this.resolvedByLibraryPath.set(normalizePath(entry.libraryPath), resolved)
      for (const workspacePath of this.workspacePaths(entry)) {
        this.resolvedByWorkspacePath.set(normalizePath(workspacePath), resolved)
      }
    }
  }

  public get currentRevision(): number {
    return this.revision
  }

  /** Seed missing library files from bundled resources. Never overwrites edits. */
  public async ensureSeeded(): Promise<void> {
    const missing = this.entries.filter((entry) => !existsSync(join(this.libraryRoot, entry.libraryPath)))
    await Promise.all(missing.map(async (entry) => {
      const target = join(this.libraryRoot, entry.libraryPath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await this.readBundled(entry.resourcePath), { encoding: "utf8" })
    }))
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
    await mkdir(dirname(resolved.libraryFilePath), { recursive: true })
    await writeFile(resolved.libraryFilePath, content, { encoding: "utf8" })
    this.revision += 1
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
