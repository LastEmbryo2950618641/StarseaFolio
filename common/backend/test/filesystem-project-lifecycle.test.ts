import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  digest,
  NodeInternalStoreAdapter,
  NodeWorkspaceAdapter,
  openProjectDatabase,
  openRegistryDatabase,
  ProjectLifecycleService,
  projectMigrations,
  SqliteProjectRegistryRepository,
  SqliteProjectRepositoryFactory,
} from "../src/index.js"

const projectId = "00000000-0000-4000-8000-000000000001"
const sourceId = "00000000-0000-4000-8000-000000000002"
const temporaryDirectories: string[] = []

const defaults = {
  worldRulesOverview: "# 世界推演规则总览\n",
  baseRules: "# Worldseed V1 基础规则\n\n平台只读规则。\n",
  contentHandling: "# 内容处理规则\n\n平台只读规则。\n",
  webnovelProseLogic: "# 中文网文正文质量与逻辑\n\n平台只读规则。\n",
  plotSynopsisGuide: "# 剧情梗概讨论引导\n\n平台只读引导。\n", userToSynopsisGuide: "# user->synopsis\n", synopsisToOutlineGuide: "# synopsis->outline\n", outlineToDraftGuide: "# outline->draft\n",
  settingsQueryGuide: "# 设定集默认查询规则\n\n平台只读引导。\n",
  settingsRevisionGuide: "# 设定集修订规则\n\n平台只读引导。\n",
  discussCreationDeskWorkflow: "# 创作台讨论工作流\n\n平台只读。\n",
  agentMemoryIndex: "# Agent 记忆索引\n\n（尚无条目）\n",
  settingsReadme: "# 设定集索引\n",
  referencesReadme: "# 参考文件索引\n",
  descriptionRules: "# 默认描写规则\n\n自动选择描写方式。\n",
  proseStyleRules: "# 默认笔风规则\n\n保持作品语言连续。\n",
  stagingReadme: "# 暂存区\n",
  stagingNotes: "# 本章讨论笔记\n\n（尚无条目）\n",
  stagingCharacters: "# 人物草稿\n\n（尚无条目）\n",
  stagingWorld: "# 世界与规则草稿\n\n（尚无条目）\n",
  stagingPromoteIndex: "# 待落盘清单\n\n（尚无条目）\n",
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "worldseed-filesystem-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Node workspace adapter", () => {
  it("creates prompt files exclusively inside user rule categories without overwriting", async () => {
    const root = temporaryDirectory()
    const adapter = new NodeWorkspaceAdapter()
    for (const category of ["系统提示词", "阶段提示词", "消息前后"]) {
      const target = `提示词/用户规则/${category}/自定义.md`
      await adapter.saveUserMarkdown(root, target, "原文", true)
      await expect(adapter.saveUserMarkdown(root, target, "覆盖", true)).rejects.toThrow(/已存在/u)
      expect(await adapter.readMarkdown(root, target)).toBe("原文")
      await expect(adapter.saveUserMarkdown(root, `提示词/系统记忆/${category}/自定义.md`, "", true)).rejects.toThrow(/用户规则/u)
    }
    await expect(adapter.saveUserMarkdown(root, "提示词/用户规则/未分类.md", "", true)).rejects.toThrow(/分类/u)
    await expect(adapter.createUserDirectory(root, "提示词/用户规则/系统提示词/自定义")).rejects.toThrow(/不能手动新建文件夹/u)
  })

  it("creates a single ideation prompt in each scope for new projects", async () => {
    const root = temporaryDirectory()
    const basePath = "提示词/基础规则/阶段提示词/02-构思阶段.md"
    const adapter = new NodeWorkspaceAdapter()
    const report = await adapter.createLayout(root, {
      ...defaults,
      promptLibraryFiles: [{ relativePath: basePath, markdown: "# 平台构思规则\n" }],
    })

    expect(report.issues).toEqual([])
    expect(await adapter.readMarkdown(root, basePath)).toBe("# 平台构思规则\n")
    for (const scope of ["用户规则", "系统记忆"]) {
      const directory = `提示词/${scope}/阶段提示词`
      expect(readdirSync(join(root, directory))).toEqual(["构思阶段.md"])
      expect(await adapter.readMarkdown(root, `${directory}/构思阶段.md`)).toBe("")
    }
  })

  it("merges old canonical project prompts and retains customized base mirrors in a hidden backup", async () => {
    const root = temporaryDirectory()
    const adapter = new NodeWorkspaceAdapter()
    await adapter.createLayout(root, defaults)
    const base = "提示词/基础规则/阶段提示词"
    const user = "提示词/用户规则/阶段提示词"
    const memory = "提示词/系统记忆/阶段提示词"
    const customBase = "# 项目单独修改过的基础规则\r\n"
    mkdirSync(join(root, base), { recursive: true })
    mkdirSync(join(root, user, "梗概阶段"), { recursive: true })
    writeFileSync(join(root, base, "02-梗概阶段.md"), customBase)
    writeFileSync(join(root, base, "03-草稿阶段.md"), "# 项目草稿基础规则\n")
    writeFileSync(join(root, base, "其他基础规则.md"), "保留基础规则\n")
    writeFileSync(join(root, user, "构思阶段.md"), "已有的构思规则\n")
    writeFileSync(join(root, user, "梗概阶段.md"), "旧梗概规则\n")
    writeFileSync(join(root, user, "草稿阶段.md"), "旧草稿规则\n")
    writeFileSync(join(root, user, "梗概阶段", "梗概阶段.md"), "旧梗概规则\n")
    writeFileSync(join(root, user, "梗概阶段", "自定义.md"), "旧目录内的自定义规则\n")
    writeFileSync(join(root, user, "梗概阶段-自定义.md"), "另一个自定义规则\n")
    writeFileSync(join(root, memory, "梗概阶段.md"), "")
    writeFileSync(join(root, memory, "草稿阶段.md"), "旧草稿记忆\n")

    const baseMirror = { relativePath: `${base}/02-构思阶段.md`, markdown: "# 当前全局构思规则\n" }
    const withBaseMirror = { ...defaults, promptLibraryFiles: [baseMirror] }
    await adapter.ensurePlatformDocuments(root, withBaseMirror)
    const mergedUser = await adapter.readMarkdown(root, `${user}/构思阶段.md`)
    expect(mergedUser).toMatch(/^已有的构思规则\n+## 梗概阶段（旧版）\n\n旧梗概规则\n+## 草稿阶段（旧版）\n\n旧草稿规则\n+$/u)
    expect(await adapter.readMarkdown(root, `${memory}/构思阶段.md`)).toMatch(/^## 草稿阶段（旧版）\n\n旧草稿记忆\n+$/u)
    expect(await adapter.readMarkdown(root, baseMirror.relativePath)).toBe(baseMirror.markdown)
    expect(await adapter.readMarkdown(root, `${base}/其他基础规则.md`)).toBe("保留基础规则\n")
    expect(await adapter.readMarkdown(root, `${user}/梗概阶段-自定义.md`)).toBe("另一个自定义规则\n")
    expect(await adapter.readMarkdown(root, `${user}/梗概阶段-自定义-旧版.md`)).toBe("旧目录内的自定义规则\n")
    const report = await adapter.validate(root)
    expect(report.issues).toEqual([])
    for (const path of [
      `${base}/02-梗概阶段.md`, `${base}/03-草稿阶段.md`, `${user}/梗概阶段`,
      `${user}/梗概阶段.md`, `${user}/草稿阶段.md`, `${memory}/梗概阶段.md`, `${memory}/草稿阶段.md`,
    ]) {
      expect(existsSync(join(root, path))).toBe(false)
    }
    expect(report.inventory.some(({ path }) => path.startsWith(".folio/"))).toBe(false)
    const backupRoot = join(root, ".folio", "prompt-migration")
    const backups = readdirSync(backupRoot)
    expect(backups.map((filename): unknown => JSON.parse(readFileSync(join(backupRoot, filename), "utf8")))).toEqual([
      { path: `${base}/02-梗概阶段.md`, markdown: customBase },
      { path: `${base}/03-草稿阶段.md`, markdown: "# 项目草稿基础规则\n" },
    ])

    // Retry with a remaining old source, as if interrupted just after writing the merge.
    writeFileSync(join(root, user, "草稿阶段.md"), "旧草稿规则\n")
    await adapter.ensurePlatformDocuments(root, withBaseMirror)
    expect(await adapter.readMarkdown(root, `${user}/构思阶段.md`)).toBe(mergedUser)
    expect(existsSync(join(root, user, "草稿阶段.md"))).toBe(false)
    expect(readdirSync(backupRoot)).toEqual(backups)
  })

  it("creates the fixed Markdown workspace and enforces actor permissions", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const adapter = new NodeWorkspaceAdapter()
    const report = await adapter.createLayout(workspaceRoot, defaults)

    expect(report.issues).toEqual([])
    expect(report.inventory.filter((entry) => !entry.path.includes("/") && entry.kind === "directory"))
      .toHaveLength(8)
    expect(await adapter.readMarkdown(workspaceRoot, "提示词/基础规则/阶段提示词/02-构思阶段.md"))
      .toContain("# 构思阶段")
    expect(await adapter.readMarkdown(workspaceRoot, "世界推演规则/基础规则/base-rules.md"))
      .toBe(defaults.baseRules)
    expect(await adapter.readMarkdown(workspaceRoot, "世界推演规则/基础规则/batch-volume-deduction-plan.md"))
      .toContain("卷粒度")
    expect(report.inventory.some((entry) => entry.path === "大纲" && entry.kind === "directory")).toBe(true)
    mkdirSync(join(workspaceRoot, ".worldseed"), { recursive: true })
    writeFileSync(join(workspaceRoot, ".worldseed", "cover.png"), "test-cover")
    expect((await adapter.validate(workspaceRoot)).issues).toEqual([])
    expect(await adapter.readMarkdown(workspaceRoot, "世界推演规则/基础规则/content-handling.md"))
      .toBe(defaults.contentHandling)
    expect(await adapter.readMarkdown(workspaceRoot, "世界推演规则/基础规则/discuss-creation-desk-workflow.md"))
      .toBe(defaults.discussCreationDeskWorkflow)
    expect(await adapter.readMarkdown(workspaceRoot, "提示词/系统记忆/系统提示词/MEMORY.md"))
      .toBe(defaults.agentMemoryIndex)
    expect(await adapter.readMarkdown(workspaceRoot, "设定集/readme.md")).toBe(defaults.settingsReadme)
    expect(await adapter.readMarkdown(workspaceRoot, "参考文件/readme.md")).toBe(defaults.referencesReadme)
    expect(await adapter.readMarkdown(workspaceRoot, "暂存区/readme.md")).toBe(defaults.stagingReadme)
    expect(await adapter.readMarkdown(workspaceRoot, "暂存区/本章讨论笔记.md")).toBe(defaults.stagingNotes)
    expect(await adapter.readMarkdown(workspaceRoot, "暂存区/人物草稿.md")).toBe(defaults.stagingCharacters)
    expect(await adapter.readMarkdown(workspaceRoot, "暂存区/世界与规则草稿.md")).toBe(defaults.stagingWorld)
    expect(await adapter.readMarkdown(workspaceRoot, "暂存区/待落盘清单.md")).toBe(defaults.stagingPromoteIndex)
    expect(report.inventory.some((entry) => entry.path === "表现输出/本作品描写" && entry.kind === "directory")).toBe(true)
    expect(await adapter.readMarkdown(workspaceRoot, "表现输出/描写规则/自动.md")).toContain("同一章")
    expect(await adapter.readMarkdown(workspaceRoot, "表现输出/描写规则/感官描写.md")).toContain("距离或关系发生变化时")
    expect(await adapter.readMarkdown(workspaceRoot, "表现输出/描写规则/感官描写.md")).toContain("详略随场面调整")
    expect(await adapter.readMarkdown(workspaceRoot, "表现输出/描写规则/去AI味.md")).toContain("眼中闪过")
    expect(await adapter.readMarkdown(workspaceRoot, "表现输出/描写规则/去AI味.md")).toContain("信任读者")

    await adapter.saveUserMarkdown(workspaceRoot, "设定集/readme.md", "# 已编辑的设定索引\n")
    expect(await adapter.readMarkdown(workspaceRoot, "设定集/readme.md")).toContain("已编辑")

    await adapter.saveUserMarkdown(workspaceRoot, "设定集/局部/规则.md", "# 规则\n")
    expect(await adapter.readMarkdown(workspaceRoot, "设定集/局部/规则.md")).toBe("# 规则\n")
    await expect(adapter.saveUserMarkdown(
      workspaceRoot,
      "世界推演规则/基础规则/base-rules.md",
      "changed",
    )).rejects.toThrow("固定工作区条目不可修改")
    await expect(adapter.saveUserMarkdown(workspaceRoot, "参考文件/data.json", "{}"))
      .rejects.toThrow("工作区只允许 .md 文件")

    await adapter.updateCharacter(workspaceRoot, { relativePath: "设定集/人物/临时.json", mode: "create", operations: [{ op: "set", field: "姓名", value: "临时" }] })
    await adapter.removeUserMarkdown(workspaceRoot, "设定集/人物/临时.json")
    await expect(adapter.readMarkdown(workspaceRoot, "设定集/人物/临时.json")).rejects.toThrow()
    await expect(adapter.removeUserMarkdown(workspaceRoot, "设定集/readme.md"))
      .rejects.toThrow("固定脚手架")

    await adapter.publishChapter(workspaceRoot, "章节正文/第一卷 测试/第一章 开始.md", "# 第一章 开始\n\n正文。\n")
    expect(readFileSync(join(workspaceRoot, "章节正文", "第一卷 测试", "第一章 开始.md"), "utf8"))
      .toContain("正文")
    await expect(adapter.publishChapter(
      workspaceRoot,
      "章节正文/第一卷 测试/第一章 开始.md",
      "overwrite",
    )).rejects.toThrow()
    expect(await adapter.archivePublishedChapter(workspaceRoot, "章节正文/第一卷 测试/第一章 开始.md"))
      .toBe("章节正文/第一卷 测试/第一章 开始 [已回退].md")
    expect(existsSync(join(workspaceRoot, "章节正文", "第一卷 测试", "第一章 开始.md"))).toBe(false)
    expect(readFileSync(join(workspaceRoot, "章节正文", "第一卷 测试", "第一章 开始 [已回退].md"), "utf8"))
      .toContain("正文")
  })

  it("imports only Markdown files and validates the entire folder before copying", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const source = join(root, "source")
    mkdirSync(join(source, "nested"), { recursive: true })
    writeFileSync(join(source, "one.md"), "# One\n", "utf8")
    writeFileSync(join(source, "nested", "two.md"), "# Two\n", "utf8")
    const adapter = new NodeWorkspaceAdapter()
    await adapter.createLayout(workspaceRoot, defaults)

    expect(await adapter.importMarkdownFolder(workspaceRoot, "参考文件/导入", source)).toBe(2)
    expect(await adapter.readMarkdown(workspaceRoot, "参考文件/导入/nested/two.md")).toContain("Two")

    const invalidSource = join(root, "invalid-source")
    mkdirSync(invalidSource)
    writeFileSync(join(invalidSource, "valid.md"), "valid", "utf8")
    writeFileSync(join(invalidSource, "invalid.txt"), "invalid", "utf8")
    await expect(adapter.importMarkdownFolder(workspaceRoot, "参考文件/失败导入", invalidSource))
      .rejects.toThrow("only .md files")
    await expect(adapter.readMarkdown(workspaceRoot, "参考文件/失败导入/valid.md")).rejects.toThrow()
  })

  it("reports non-Markdown files and unexpected top-level directories without repairing them", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const adapter = new NodeWorkspaceAdapter()
    await adapter.createLayout(workspaceRoot, defaults)
    mkdirSync(join(workspaceRoot, "内部索引"))
    writeFileSync(join(workspaceRoot, "参考文件", "data.json"), "{}", "utf8")

    const issueCodes = (await adapter.validate(workspaceRoot)).issues.map((issue) => issue.code)
    expect(issueCodes).toContain("unexpected_root_entry")
    expect(issueCodes).toContain("invalid_file_type")
    expect(readFileSync(join(workspaceRoot, "参考文件", "data.json"), "utf8")).toBe("{}")
  })

  it("reports either mandatory index document when it is missing", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const adapter = new NodeWorkspaceAdapter()
    await adapter.createLayout(workspaceRoot, defaults)

    unlinkSync(join(workspaceRoot, "设定集", "readme.md"))
    const report = await adapter.validate(workspaceRoot)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "missing_fixed_entry",
      path: "设定集/readme.md",
    }))
  })
})

describe("project lifecycle", () => {
  it("creates, registers, and reopens a physically separated project", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "user-workspace")
    const appDataRoot = join(root, "app-data", "Worldseed")
    const registryDatabase = await openRegistryDatabase(join(appDataRoot, "registry.sqlite"))
    const registry = new SqliteProjectRegistryRepository(registryDatabase)
    const workspace = new NodeWorkspaceAdapter()
    const internalStore = new NodeInternalStoreAdapter(appDataRoot)
    const lifecycle = new ProjectLifecycleService(
      registry,
      workspace,
      internalStore,
      new SqliteProjectRepositoryFactory(),
    )

    const created = await lifecycle.create({
      projectId,
      displayName: "Lifecycle Test",
      workspaceRootRef: workspaceRoot,
      defaults,
      nowMs: 100,
    })
    expect(created.manifest.workspaceRootRef).not.toContain(created.internalStore.internalStoreRef)
    expect(created.internalStore.internalStoreRef).not.toContain(created.manifest.workspaceRootRef)
    expect(created.internalStore.historyGitRef).toBe(join(created.internalStore.internalStoreRef, "history.git"))
    expect(created.internalStore.historyCheckoutRef).toBe(join(created.internalStore.internalStoreRef, "history-checkout"))
    expect(created.internalStore.historyRecoveryRef).toBe(join(created.internalStore.internalStoreRef, "emergency-recovery"))
    expect(() => readFileSync(join(workspaceRoot, ".git", "HEAD"), "utf8")).toThrow()
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "base-rules.md"), "utf8"))
      .toBe(defaults.baseRules)

    const opened = await lifecycle.openByWorkspace(workspaceRoot, 200, defaults)
    expect(opened.manifest.id).toBe(projectId)
    expect((await registry.findById(projectId))?.lastOpenedAtMs).toBe(200)

    const objectRef = await internalStore.writeImmutableDocument(opened.internalStore, sourceId, "# immutable\n")
    expect(await internalStore.readDocument(objectRef)).toBe("# immutable\n")
    await expect(internalStore.writeImmutableDocument(opened.internalStore, sourceId, "replace"))
      .rejects.toThrow()
    await registryDatabase.destroy()
  })

  it("loads existing projects without validating editable sidebar files", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const appDataRoot = join(root, "app-data")
    const registryDatabase = await openRegistryDatabase(join(appDataRoot, "registry.sqlite"))
    const lifecycle = new ProjectLifecycleService(
      new SqliteProjectRegistryRepository(registryDatabase),
      new NodeWorkspaceAdapter(),
      new NodeInternalStoreAdapter(appDataRoot),
      new SqliteProjectRepositoryFactory(),
    )
    await lifecycle.create({
      projectId,
      displayName: "Validation Test",
      workspaceRootRef: workspaceRoot,
      defaults,
      nowMs: 100,
    })

    // Platform base rules are editable/refreshable; a digest change must not
    // strand an otherwise valid existing project.
    writeFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "base-rules.md"), "modified", "utf8")
    await expect(lifecycle.openByWorkspace(workspaceRoot, 200, defaults)).resolves.toBeDefined()
    mkdirSync(join(workspaceRoot, "第六目录"))
    await expect(lifecycle.openByWorkspace(workspaceRoot, 300, defaults)).resolves.toBeDefined()
    expect(existsSync(join(workspaceRoot, "第六目录"))).toBe(true)
    await registryDatabase.destroy()
  })

  it("reconciles manifest when the workspace is valid but platform fixed entries expanded", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const appDataRoot = join(root, "app-data")
    const registryDatabase = await openRegistryDatabase(join(appDataRoot, "registry.sqlite"))
    const lifecycle = new ProjectLifecycleService(
      new SqliteProjectRegistryRepository(registryDatabase),
      new NodeWorkspaceAdapter(),
      new NodeInternalStoreAdapter(appDataRoot),
      new SqliteProjectRepositoryFactory(),
    )
    await lifecycle.create({
      projectId,
      displayName: "Upgrade Test",
      workspaceRootRef: workspaceRoot,
      defaults,
      nowMs: 100,
    })

    const registered = await new SqliteProjectRegistryRepository(registryDatabase).findById(projectId)
    if (registered === undefined) throw new Error("Missing project registration")
    const store = await new NodeInternalStoreAdapter(appDataRoot).inspectProject(
      projectId,
      workspaceRoot,
      registered.internalStoreRef,
    )
    const session = await new SqliteProjectRepositoryFactory().open(store, workspaceRoot)
    try {
      const manifest = await session.repository.readManifest(projectId)
      if (manifest === undefined) throw new Error("Missing project manifest")
      const legacyFixedEntries = manifest.fixedEntries.filter((entry) => (
        entry.key !== "world-rules-overview"
        && entry.key !== "content-handling"
        && entry.key !== "webnovel-prose-logic"
        && entry.key !== "plot-synopsis-guide"
        && entry.key !== "settings-query-guide"
        && entry.key !== "settings-revision-guide"
        && entry.key !== "discuss-creation-desk-workflow"
        && entry.key !== "agent-memory"
        && entry.key !== "agent-memory-index"
        && entry.key !== "work-description-rules"
      ))
      const legacyDigest = digest({
        protocolVersion: manifest.protocolVersion,
        manifestVersion: manifest.manifestVersion,
        fixedEntries: legacyFixedEntries,
        projectId,
        displayName: manifest.displayName,
        workspaceRootRef: workspaceRoot,
        internalStoreRef: store.internalStoreRef,
        baseRulesDigest: digest(defaults.baseRules),
      })
      await session.repository.reconcileManifest({ ...manifest, fixedEntries: legacyFixedEntries, manifestDigest: legacyDigest }, 150)
    } finally {
      await session.close()
    }

    // Simulate an older on-disk workspace that never received the new platform guides.
    unlinkSync(join(workspaceRoot, "世界推演规则", "总览.md"))
    writeFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "content-handling.md"), "# 旧平台规则\n", "utf8")
    unlinkSync(join(workspaceRoot, "世界推演规则", "基础规则", "webnovel-prose-logic.md"))
    unlinkSync(join(workspaceRoot, "世界推演规则", "基础规则", "plot-synopsis-guide.md"))
    unlinkSync(join(workspaceRoot, "世界推演规则", "基础规则", "settings-query-guide.md"))
    unlinkSync(join(workspaceRoot, "世界推演规则", "基础规则", "settings-revision-guide.md"))
    unlinkSync(join(workspaceRoot, "世界推演规则", "基础规则", "discuss-creation-desk-workflow.md"))
    unlinkSync(join(workspaceRoot, "提示词", "系统记忆", "系统提示词", "MEMORY.md"))
    rmdirSync(join(workspaceRoot, "提示词", "系统记忆", "系统提示词"))
    rmdirSync(join(workspaceRoot, "表现输出", "本作品描写"))
    unlinkSync(join(workspaceRoot, "表现输出", "描写规则", "自动.md"))
    unlinkSync(join(workspaceRoot, "表现输出", "描写规则", "感官描写.md"))
    unlinkSync(join(workspaceRoot, "表现输出", "描写规则", "去AI味.md"))
    unlinkSync(join(workspaceRoot, "表现输出", "描写规则", "默认描写规则.md"))
    unlinkSync(join(workspaceRoot, "表现输出", "笔风规则", "默认笔风规则.md"))

    const opened = await lifecycle.openByWorkspace(workspaceRoot, 200, defaults)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "content-handling")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "webnovel-prose-logic")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "plot-synopsis-guide")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "settings-query-guide")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "settings-revision-guide")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "discuss-creation-desk-workflow")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "agent-memory")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "agent-memory-index")).toBe(true)
    expect(opened.manifest.fixedEntries.some((entry) => entry.key === "work-description-rules")).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "本作品描写"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "描写规则", "自动.md"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "描写规则", "感官描写.md"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "描写规则", "去AI味.md"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "描写规则", "默认描写规则.md"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "表现输出", "笔风规则", "默认笔风规则.md"))).toBe(true)
    expect(readFileSync(join(workspaceRoot, "表现输出", "描写规则", "感官描写.md"), "utf8")).toContain("挑人物在意的细节")
    expect(readFileSync(join(workspaceRoot, "表现输出", "描写规则", "去AI味.md"), "utf8")).toContain("去AI味")
    expect(readFileSync(join(workspaceRoot, "表现输出", "描写规则", "默认描写规则.md"), "utf8"))
      .toBe(defaults.descriptionRules)
    expect(readFileSync(join(workspaceRoot, "表现输出", "笔风规则", "默认笔风规则.md"), "utf8"))
      .toBe(defaults.proseStyleRules)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "content-handling.md"), "utf8"))
      .toBe(defaults.contentHandling)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "总览.md"), "utf8"))
      .toBe(defaults.worldRulesOverview)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "webnovel-prose-logic.md"), "utf8"))
      .toBe(defaults.webnovelProseLogic)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "settings-query-guide.md"), "utf8"))
      .toBe(defaults.settingsQueryGuide)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "settings-revision-guide.md"), "utf8"))
      .toBe(defaults.settingsRevisionGuide)
    expect(readFileSync(join(workspaceRoot, "世界推演规则", "基础规则", "discuss-creation-desk-workflow.md"), "utf8"))
      .toBe(defaults.discussCreationDeskWorkflow)
    expect(readFileSync(join(workspaceRoot, "提示词", "系统记忆", "系统提示词", "MEMORY.md"), "utf8"))
      .toBe(defaults.agentMemoryIndex)
    await registryDatabase.destroy()
  })

  it("rejects internal storage nested inside the user workspace", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    mkdirSync(workspaceRoot)
    const adapter = new NodeInternalStoreAdapter(join(workspaceRoot, ".internal"))
    await expect(adapter.prepareProject(projectId, workspaceRoot)).rejects.toThrow("physically separate")
  })

  it("produces a project database that remains independently openable", async () => {
    const root = temporaryDirectory()
    const workspaceRoot = join(root, "workspace")
    const appDataRoot = join(root, "app-data")
    const workspace = new NodeWorkspaceAdapter()
    await workspace.createLayout(workspaceRoot, defaults)
    const internalStore = new NodeInternalStoreAdapter(appDataRoot)
    const store = await internalStore.prepareProject(projectId, workspaceRoot)
    const database = await openProjectDatabase(store.projectDatabaseRef)
    expect(await database.selectFrom("schema_migrations").selectAll().execute()).toHaveLength(projectMigrations.length)
    await database.destroy()
  })
})
