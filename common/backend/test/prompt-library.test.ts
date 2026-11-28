import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"
import { NodePromptResourceAdapter } from "../src/infrastructure/prompts/node-prompt-resource-adapter.js"
import {
  PROMPT_LIBRARY_SEED_MANIFEST,
  PromptLibraryService,
  type PromptLibrarySeedManifest,
} from "../src/infrastructure/prompts/prompt-library.js"

const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
const temporaryDirectories: string[] = []

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

async function bundledMarkdown(entry: { resourcePath: string }): Promise<string> {
  return normalizeSeedMarkdown(await readFile(join(packageRoot, entry.resourcePath), "utf8"))
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("prompt library", () => {
  it("seeds the fixed system/stage/dynamic prompt documents once", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    expect(library.entries).toHaveLength(10)
    expect(library.entries.some((entry) => entry.libraryPath === "基础规则/系统提示词/06-讨论技能索引.md")).toBe(false)
    expect(library.entries.some((entry) => entry.libraryPath === "基础规则/系统提示词/03-去AI味与写作声音.md")).toBe(true)
    expect(library.entries.some((entry) => entry.libraryPath === "基础规则/阶段提示词/02-构思阶段.md")).toBe(true)
    expect(library.entries.some((entry) => entry.libraryPath === "基础规则/消息前后/02-用户消息后.md")).toBe(true)

    const files = await library.buildWorkspaceMirrorFiles()
    const byPath = new Map(files.map((file) => [file.relativePath, file.markdown]))
    expect(byPath.has("提示词/基础规则/系统提示词/03-去AI味与写作声音.md")).toBe(true)
    expect(byPath.has("提示词/基础规则/阶段提示词/02-构思阶段.md")).toBe(true)
    expect(byPath.has("提示词/基础规则/消息前后/02-用户消息后.md")).toBe(true)
  })

  it("drops retired library copies of the removed skill index", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const retiredPath = join(library.libraryRoot, "基础规则/系统提示词/06-讨论技能索引.md")
    await mkdir(join(library.libraryRoot, "基础规则/系统提示词"), { recursive: true })
    await writeFile(retiredPath, "# 旧索引\n", "utf8")

    await library.ensureSeeded()

    await expect(readFile(retiredPath, "utf8")).rejects.toThrow()
    expect(library.entries.some((entry) => entry.libraryPath === "基础规则/系统提示词/06-讨论技能索引.md")).toBe(false)
  })

  it("prefers a global override for a system prompt document", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const overridePath = join(library.libraryRoot, "基础规则/系统提示词/01-世界与基础规则.md")
    await writeFile(overridePath, "# 我的基础规则\n\nCUSTOM-BASE-RULES\n", "utf8")

    const adapter = new NodePromptResourceAdapter(packageRoot, library)
    expect((await adapter.loadTurnSystemRules()).text).toContain("CUSTOM-BASE-RULES")
    const mirrors = await library.buildWorkspaceMirrorFiles()
    expect(mirrors.find((file) => file.relativePath === "提示词/基础规则/系统提示词/01-世界与基础规则.md")?.markdown)
      .toContain("CUSTOM-BASE-RULES")
  })

  it("applies markerless saved Markdown immediately and keeps the subphase protocol independent", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const prompts = new NodePromptResourceAdapter(packageRoot, library)
    await library.write("基础规则/消息前后/01-用户消息前.md", "前：作者自定义\n")
    await library.write("基础规则/消息前后/02-用户消息后.md", "后：作者自定义\n")
    for (const input of [{ phase: "draft", workflow: "query" }, { phase: "synopsis_discuss", purpose: "discuss_write_scope" }] as const) {
      expect(await prompts.loadUserMessageBrackets(input)).toEqual({ before: "前：作者自定义\n", after: "后：作者自定义\n" })
    }
    await library.write("基础规则/阶段提示词/01-新章节阶段.md", "新章专用\n")
    await library.write("基础规则/阶段提示词/02-构思阶段.md", "构思专用\n")
    await library.write("基础规则/阶段提示词/04-章节入库阶段.md", "入库专用\n")
    expect((await prompts.loadNewChapterDiscussion()).text).toBe("新章专用\n")
    expect((await prompts.loadComposePrompt()).text).toBe("构思专用\n")
    expect((await prompts.loadChapterIngestion()).text).toBe("入库专用\n")
    expect((await prompts.loadPhase("interpret", "ingestion")).text).not.toContain("新章专用")
    expect((await prompts.loadPhase("revision_review", "ingestion")).text).toContain("revision_review")
    expect((await prompts.loadDefaultSkillPack("settings_extraction")).text).toContain("设定集修订规则")
    expect((await prompts.loadOutlineToDraftGuide()).text).toContain("草稿")
    await library.write("基础规则/消息前后/02-用户消息后.md", "保存后的第二版\n")
    expect((await prompts.loadUserMessageBrackets({ phase: "interpret" })).after).toBe("保存后的第二版\n")
  })

  it("maps new prompt document paths back to one library entry", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    expect(library.resolveWorkspacePath("提示词/基础规则/阶段提示词/02-构思阶段.md")?.entry.libraryPath)
      .toBe("基础规则/阶段提示词/02-构思阶段.md")
    expect(library.resolveWorkspacePath("提示词/基础规则/消息前后/用户消息前/01-用户消息前.md")?.entry.libraryPath)
      .toBe("基础规则/消息前后/01-用户消息前.md")
    expect(library.resolveWorkspacePath("设定集/人物/主角.json")).toBeUndefined()
  })

  it("preserves a customized message prompt when moving it to the flat library", async () => {
    const library = await temporaryLibrary()
    const legacyDirectory = join(library.libraryRoot, "基础规则/消息前后/用户消息前")
    const resource = "resources/v1/prompt-docs/dynamic/01-before-user-message.md"
    await mkdir(legacyDirectory, { recursive: true })
    await writeFile(join(legacyDirectory, "01-用户消息前.md"), "自定义消息前提示词\n")

    await library.ensureSeeded()
    await library.ensureSeeded()

    expect(await library.readEffective(resource)).toBe("自定义消息前提示词\n")
    expect(await readFile(join(library.libraryRoot, "基础规则/消息前后/01-用户消息前.md"), "utf8"))
      .toBe("自定义消息前提示词\n")
  })

  it("materializes the prompt documents on project open", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-workspace-"))
    temporaryDirectories.push(root)
    const oldBase = join(root, "提示词/基础规则/消息前后/用户消息前")
    const oldUser = join(root, "提示词/用户规则/消息前后/用户消息后")
    await mkdir(oldBase, { recursive: true })
    await mkdir(oldUser, { recursive: true })
    await writeFile(join(oldBase, "01-用户消息前.md"), "# 消息前\r\n")
    await writeFile(join(oldUser, "规则.md"), "自定义消息后规则\n")
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
        { relativePath: "提示词/基础规则/系统提示词/01-世界与基础规则.md", markdown: "# 规则\n" },
        { relativePath: "提示词/基础规则/阶段提示词/02-构思阶段.md", markdown: "# 构思阶段\n" },
        { relativePath: "提示词/基础规则/消息前后/01-用户消息前.md", markdown: "# 消息前\n" },
      ],
    })
    const adapter = new NodeWorkspaceAdapter()
    expect(await adapter.readMarkdown(root, "提示词/基础规则/系统提示词/01-世界与基础规则.md")).toBe("# 规则\n")
    expect(await adapter.readMarkdown(root, "提示词/基础规则/阶段提示词/02-构思阶段.md")).toBe("# 构思阶段\n")
    expect(await readdir(join(root, "提示词/基础规则/消息前后"))).toEqual(["01-用户消息前.md"])
    expect(await adapter.readMarkdown(root, "提示词/用户规则/消息前后/用户消息后-规则.md")).toBe("自定义消息后规则\n")
    await expect(readdir(oldUser)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("records every seed digest and keeps user edits", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const manifest = await readSeedManifest(library)
    expect(Object.keys(manifest.seeds).sort()).toEqual(library.entries.map((entry) => entry.libraryPath).sort())
    for (const entry of library.entries) {
      const bundled = await bundledMarkdown(entry)
      expect(await readFile(join(library.libraryRoot, entry.libraryPath), "utf8")).toBe(bundled)
      expect(manifest.seeds[entry.libraryPath]).toBe(seedDigest(bundled))
    }

    const targetPath = "基础规则/系统提示词/03-去AI味与写作声音.md"
    const seededDigest = manifest.seeds[targetPath]
    const edited = "# 本鱼改过的写作声音\n\nKEEP-MY-EDIT\n"
    await library.write(targetPath, edited)
    await library.ensureSeeded()
    expect(await readFile(join(library.libraryRoot, targetPath), "utf8")).toBe(edited)
    expect((await readSeedManifest(library)).seeds[targetPath]).toBe(seededDigest)
  })

  it("updates a document whose file still matches the recorded seed digest", async () => {
    const library = await temporaryLibrary()
    await library.ensureSeeded()
    const targetPath = "基础规则/阶段提示词/02-构思阶段.md"
    const previousSeed = "# 旧版阶段提示词\n\nOLD-SEED-CONTENT\n"
    await writeFile(join(library.libraryRoot, targetPath), previousSeed, "utf8")
    const manifest = await readSeedManifest(library)
    await writeFile(
      join(library.libraryRoot, PROMPT_LIBRARY_SEED_MANIFEST),
      `${JSON.stringify({ version: 1, seeds: { ...manifest.seeds, [targetPath]: seedDigest(previousSeed) } }, null, 2)}\n`,
      "utf8",
    )

    await library.ensureSeeded()
    const bundled = await bundledMarkdown({ resourcePath: "resources/v1/prompt-docs/stages/02-compose.md" })
    expect(await readFile(join(library.libraryRoot, targetPath), "utf8")).toBe(bundled)
    expect((await readSeedManifest(library)).seeds[targetPath]).toBe(seedDigest(bundled))
  })

  it("loads old custom rules from the merged compose document", async () => {
    const library = await temporaryLibrary()
    const directory = join(library.libraryRoot, "基础规则/阶段提示词")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "细纲阶段.md"), "我的旧细纲规则\n")
    const draft = await bundledMarkdown({ resourcePath: "resources/v1/prompt-docs/stages/03-draft.md" })
    await writeFile(join(directory, "03-草稿阶段.md"), draft.replace("<!-- /skill:outline-to-draft -->", "我的旧草稿规则\n\n<!-- /skill:outline-to-draft -->"))
    await library.ensureSeeded()
    const adapter = new NodePromptResourceAdapter(packageRoot, library)
    expect((await adapter.loadComposePrompt()).text).toContain("我的旧细纲规则")
    expect((await adapter.loadOutlineToDraftGuide()).text).toContain("我的旧草稿规则")
  })

  it("serializes concurrent seeding without leaving temp files", async () => {
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
