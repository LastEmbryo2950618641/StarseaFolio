import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { renderRuntimePrompt, setPromptOverrideResolver } from "../src/core/runtime-prompt.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"
import { NodePromptResourceAdapter } from "../src/infrastructure/prompts/node-prompt-resource-adapter.js"
import {
  legacySeedDigests,
  PROMPT_LIBRARY_SEED_MANIFEST,
  PromptLibraryService,
  type PromptLibrarySeedManifest,
} from "../src/infrastructure/prompts/prompt-library.js"

const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
const temporaryDirectories: string[] = []
/** Commit that first shipped the editable global prompt library (v0.0.1-118). */
const legacySeedCommit = "53d07bc"

async function temporaryLibrary(): Promise<PromptLibraryService> {
  const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-library-"))
  temporaryDirectories.push(root)
  return new PromptLibraryService(packageRoot, root)
}

function normalizeSeedMarkdown(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd() + "\n"
}

function seedDigest(markdown: string): string {
  return createHash("sha256").update(normalizeSeedMarkdown(markdown), "utf8").digest("hex")
}

async function readSeedManifest(library: PromptLibraryService): Promise<PromptLibrarySeedManifest> {
  const raw = await readFile(join(library.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST), "utf8")
  return JSON.parse(raw) as PromptLibrarySeedManifest
}

const legacyResourceCache = new Map<string, string | undefined>()

function readLegacyResource(resourcePath: string): string | undefined {
  if (legacyResourceCache.has(resourcePath)) return legacyResourceCache.get(resourcePath)
  let markdown: string | undefined
  try {
    markdown = execFileSync("git", ["show", `${legacySeedCommit}:common/packages/prompt-contracts/${resourcePath}`], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    markdown = undefined
  }
  legacyResourceCache.set(resourcePath, markdown)
  return markdown
}

const legacyHistoryAvailable = readLegacyResource("resources/v1/phases/draft.md") !== undefined

/** Recreate the library exactly as v0.0.1-118 seeded it: normalized md files, no manifest. */
async function seedLegacyLibrary(library: PromptLibraryService): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  for (const entry of library.entries) {
    const legacy = readLegacyResource(entry.resourcePath)
    if (legacy === undefined) continue
    const markdown = normalizeSeedMarkdown(legacy)
    contents.set(entry.libraryPath, markdown)
    const target = join(library.libraryRoot, entry.libraryPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, markdown, "utf8")
  }
  return contents
}

async function bundledMarkdown(entry: { resourcePath: string }): Promise<string> {
  return normalizeSeedMarkdown(await readFile(join(packageRoot, entry.resourcePath), "utf8"))
}

afterEach(async () => {
  setPromptOverrideResolver(undefined)
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("prompt library", () => {
  it("seeds every platform prompt once and builds categorized workspace mirrors", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    expect(library.entries.length).toBeGreaterThanOrEqual(62)
    expect(library.entries.some((entry) => entry.libraryPath === "阶段提示/draft.md")).toBe(true)
    expect(library.entries.some((entry) => entry.libraryPath === "运行时提示/provider-protocol.md")).toBe(true)
    expect(library.entries.some((entry) => entry.libraryPath === "技能/deslop.md")).toBe(true)

    const files = await library.buildWorkspaceMirrorFiles()
    const byPath = new Map(files.map((file) => [file.relativePath, file.markdown]))
    expect(byPath.has("提示词/系统规则/base-rules.md")).toBe(true)
    expect(byPath.has("提示词/阶段提示/draft.md")).toBe(true)
    expect(byPath.has("提示词/技能/deslop.md")).toBe(true)
    expect(byPath.get("世界推演规则/基础规则/base-rules.md")).toBe(byPath.get("提示词/系统规则/base-rules.md"))
    expect(byPath.get("世界推演规则/总览.md")).toContain("世界推演规则总览")
  })

  it("prefers the global override in the prompt adapter and workspace mirrors", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const overridePath = join(library.libraryRoot, "系统规则/base-rules.md")
    await writeFile(overridePath, "# 我的基础规则\n\nCUSTOM-BASE-RULES\n", "utf8")

    const adapter = new NodePromptResourceAdapter(packageRoot, library)
    expect((await adapter.loadBaseRules()).text).toContain("CUSTOM-BASE-RULES")
    const mirrors = await library.buildWorkspaceMirrorFiles()
    expect(mirrors.find((file) => file.relativePath === "世界推演规则/基础规则/base-rules.md")?.markdown)
      .toContain("CUSTOM-BASE-RULES")
    expect(mirrors.find((file) => file.relativePath === "提示词/系统规则/base-rules.md")?.markdown)
      .toContain("CUSTOM-BASE-RULES")
    expect(await readFile(join(library.libraryRoot, "系统规则/base-rules.md"), "utf8")).toContain("CUSTOM-BASE-RULES")
  })

  it("maps every editable prompt mirror path back to one library entry", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const fromPlatform = library.resolveWorkspacePath("世界推演规则/基础规则/base-rules.md")
    const fromLibrary = library.resolveWorkspacePath("提示词/系统规则/base-rules.md")
    expect(fromPlatform?.entry.libraryPath).toBe("系统规则/base-rules.md")
    expect(fromLibrary?.entry.libraryPath).toBe("系统规则/base-rules.md")
    expect(fromLibrary?.workspacePaths).toEqual(expect.arrayContaining([
      "提示词/系统规则/base-rules.md",
      "世界推演规则/基础规则/base-rules.md",
    ]))
    expect(library.resolveWorkspacePath("提示词/阶段提示/draft.md")?.entry.libraryPath).toBe("阶段提示/draft.md")
    expect(library.resolveWorkspacePath("设定集/人物/主角.json")).toBeUndefined()
  })

  it("routes runtime prompt edits through the global override resolver", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const bundled = await readFile(join(library.libraryRoot, "运行时提示/provider-protocol.md"), "utf8")
    await writeFile(
      join(library.libraryRoot, "运行时提示/provider-protocol.md"),
      bundled.replace("StarseaFolio protocol {{version}}.", "StarseaFolio protocol {{version}}. CUSTOM-RUNTIME."),
      "utf8",
    )
    setPromptOverrideResolver({
      runtimePath: (file) => library.runtimeOverridePath(file),
      resourcePath: (path) => library.resourceOverridePath(path),
    })
    expect(renderRuntimePrompt("provider-protocol", "phase-protocol", { version: "worldseed.v1", phase: "draft" }))
      .toContain("CUSTOM-RUNTIME")
  })

  it("writes platform prompt mirrors through the platform actor", async () => {
    const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-mirror-"))
    temporaryDirectories.push(root)
    await mkdir(join(root, "提示词"), { recursive: true })
    const adapter = new NodeWorkspaceAdapter()
    await adapter.savePromptMirror(root, "提示词/系统规则/base-rules.md", "# 库镜像\n")
    await adapter.savePromptMirror(root, "世界推演规则/基础规则/base-rules.md", "# 平台镜像\n")
    expect(await adapter.readMarkdown(root, "提示词/系统规则/base-rules.md")).toBe("# 库镜像\n")
    expect(await adapter.readMarkdown(root, "世界推演规则/基础规则/base-rules.md")).toBe("# 平台镜像\n")
  })

  it("materializes the prompt library and platform mirrors on project open", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-workspace-"))
    temporaryDirectories.push(root)
    await new NodeWorkspaceAdapter().ensurePlatformDocuments(root, {
      worldRulesOverview: "# 总览\n",
      baseRules: "# 规则\n",
      contentHandling: "",
      webnovelProseLogic: "",
      plotSynopsisGuide: "",
      userToSynopsisGuide: "",
      synopsisToOutlineGuide: "",
      outlineToDraftGuide: "",
      settingsQueryGuide: "",
      settingsRevisionGuide: "",
      discussCreationDeskWorkflow: "",
      agentMemoryIndex: "",
      settingsReadme: "",
      referencesReadme: "",
      descriptionRules: "",
      proseStyleRules: "",
      stagingReadme: "",
      stagingNotes: "",
      stagingCharacters: "",
      stagingWorld: "",
      stagingPromoteIndex: "",
      promptLibraryFiles: [
        { relativePath: "提示词/系统规则/base-rules.md", markdown: "# 规则\n" },
        { relativePath: "世界推演规则/基础规则/base-rules.md", markdown: "# 规则\n" },
        { relativePath: "提示词/阶段提示/draft.md", markdown: "# draft\n" },
      ],
    })
    const adapter = new NodeWorkspaceAdapter()
    expect(await adapter.readMarkdown(root, "提示词/系统规则/base-rules.md")).toBe("# 规则\n")
    expect(await adapter.readMarkdown(root, "世界推演规则/基础规则/base-rules.md")).toBe("# 规则\n")
    expect(await adapter.readMarkdown(root, "提示词/阶段提示/draft.md")).toContain("# draft")
  })

  it("seeds a fresh library and records every seed digest in the manifest", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()

    const manifest = await readSeedManifest(library)
    expect(manifest.version).toBe(1)
    expect(Object.keys(manifest.seeds).sort()).toEqual(library.entries.map((entry) => entry.libraryPath).sort())
    for (const entry of library.entries) {
      const bundled = await bundledMarkdown(entry)
      expect(await readFile(join(library.libraryRoot, entry.libraryPath), "utf8")).toBe(bundled)
      expect(manifest.seeds[entry.libraryPath]).toBe(seedDigest(bundled))
    }

    const manifestBefore = await readFile(join(library.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST), "utf8")
    await library.ensureSeeded()
    expect(await readFile(join(library.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST), "utf8")).toBe(manifestBefore)
  })

  it.skipIf(!legacyHistoryAvailable)("migrates a v0.0.1-118 library without a manifest and keeps user edits", async () => {
    const library = await temporaryLibrary()
    const legacyContents = await seedLegacyLibrary(library)
    expect(legacyContents.size).toBeGreaterThan(0)

    // The shipped legacy digests must identify the v0.0.1-118 content exactly.
    for (const entry of library.entries) {
      const legacy = legacyContents.get(entry.libraryPath)
      if (legacy === undefined) continue
      expect(legacySeedDigests[entry.libraryPath]).toBe(seedDigest(legacy))
    }

    const changedEntry = (await Promise.all(library.entries.map(async (entry) => ({
      entry,
      legacy: legacyContents.get(entry.libraryPath),
      bundled: await bundledMarkdown(entry),
    })))).find((item) => item.legacy !== undefined && item.legacy !== item.bundled)
    expect(changedEntry).toBeDefined()
    if (changedEntry === undefined) throw new Error("Expected at least one prompt resource to change in this release")
    const editedPath = changedEntry.entry.libraryPath
    const editedContent = `${legacyContents.get(editedPath) ?? ""}\n\n本鱼自己的改动\n`
    await writeFile(join(library.libraryRoot, editedPath), editedContent, "utf8")

    await library.ensureSeeded()

    const manifest = await readSeedManifest(library)
    let refreshed = 0
    for (const entry of library.entries) {
      const bundled = await bundledMarkdown(entry)
      const legacy = legacyContents.get(entry.libraryPath)
      const actual = await readFile(join(library.libraryRoot, entry.libraryPath), "utf8")
      if (entry.libraryPath === editedPath) {
        expect(actual).toBe(editedContent)
        expect(manifest.seeds[entry.libraryPath]).toBe(seedDigest(legacy ?? ""))
        continue
      }
      expect(actual).toBe(bundled)
      expect(manifest.seeds[entry.libraryPath]).toBe(seedDigest(bundled))
      if (legacy !== undefined && legacy !== bundled) refreshed += 1
    }
    expect(refreshed).toBeGreaterThan(0)
    expect(Object.keys(manifest.seeds)).toHaveLength(library.entries.length)
  })

  it("updates a library whose files still match the recorded seed digest", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const targetPath = "写作指南/user-to-synopsis-guide.md"
    const previousSeed = "# 旧版提示词\n\nOLD-SEED-CONTENT\n"

    // Simulate a seed written by an earlier build whose bundled markdown has since changed.
    await writeFile(join(library.libraryRoot, targetPath), previousSeed, "utf8")
    const manifest = await readSeedManifest(library)
    await writeFile(
      join(library.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST),
      `${JSON.stringify({ version: 1, seeds: { ...manifest.seeds, [targetPath]: seedDigest(previousSeed) } }, null, 2)}\n`,
      "utf8",
    )

    await library.ensureSeeded()

    const bundled = await bundledMarkdown({ resourcePath: "resources/v1/user-to-synopsis-guide.md" })
    expect(await readFile(join(library.libraryRoot, targetPath), "utf8")).toBe(bundled)
    expect((await readSeedManifest(library)).seeds[targetPath]).toBe(seedDigest(bundled))
  })

  it("keeps user edits when the recorded seed digest no longer matches", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const targetPath = "系统规则/base-rules.md"
    const seededDigest = (await readSeedManifest(library)).seeds[targetPath]
    const edited = "# 本鱼改过的规则\n\nKEEP-MY-EDIT\n"

    await library.write(targetPath, edited)
    await library.ensureSeeded()

    expect(await readFile(join(library.libraryRoot, targetPath), "utf8")).toBe(edited)
    expect((await readSeedManifest(library)).seeds[targetPath]).toBe(seededDigest)
  })

  it("serializes concurrent seeding of the same library across service instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-library-shared-"))
    temporaryDirectories.push(root)
    const libraries = Array.from({ length: 4 }, () => new PromptLibraryService(packageRoot, root))

    await Promise.all(libraries.map((library) => library.ensureSeeded()))

    const [first] = libraries
    if (first === undefined) throw new Error("Expected at least one prompt library instance")
    const manifest = await readSeedManifest(first)
    expect(Object.keys(manifest.seeds)).toHaveLength(first.entries.length)
    const files = await readdir(root, { recursive: true })
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([])
  })
})
