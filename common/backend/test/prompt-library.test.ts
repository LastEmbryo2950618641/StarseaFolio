import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { renderRuntimePrompt, setPromptOverrideResolver } from "../src/core/runtime-prompt.js"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"
import { NodePromptResourceAdapter } from "../src/infrastructure/prompts/node-prompt-resource-adapter.js"
import { PromptLibraryService } from "../src/infrastructure/prompts/prompt-library.js"

const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
const temporaryDirectories: string[] = []

async function temporaryLibrary(): Promise<PromptLibraryService> {
  const root = await mkdtemp(join(tmpdir(), "worldseed-prompt-library-"))
  temporaryDirectories.push(root)
  return new PromptLibraryService(packageRoot, root)
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
    await adapter.savePromptMirror!(root, "提示词/系统规则/base-rules.md", "# 库镜像\n")
    await adapter.savePromptMirror!(root, "世界推演规则/基础规则/base-rules.md", "# 平台镜像\n")
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
})
