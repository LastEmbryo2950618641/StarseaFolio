import { randomUUID } from "node:crypto"
import { WORLD_RULES_OVERVIEW_PATH } from "@starseafolio/contracts"
import { CHARACTER_DIRECTORY, CHARACTER_RULE_PATH, isCharacterProfilePath, characterUpdateSchema, emptyCharacterProfile, parseCharacterProfile, formatCharacterProfile, applyCharacterFieldOperations, type CharacterUpdate } from "@starseafolio/contracts"
import { constants } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path"

import {
  assertUserCanCreateMarkdown,
  assertUserCanCreateDirectory,
  assertUserCanDeleteVolumeDirectory,
  assertUserCanDeleteMarkdown,
  assertVolumeSequenceAvailable,
  assertWorkspaceMutationAllowed,
  AUTO_DESCRIPTION_RULE_MARKDOWN,
  AUTO_DESCRIPTION_RULE_PATH,
  SENSORY_DESCRIPTION_RULE_MARKDOWN,
  SENSORY_DESCRIPTION_RULE_PATH,
  DEAI_DESCRIPTION_RULE_MARKDOWN,
  DEAI_DESCRIPTION_RULE_PATH,
  WORK_STYLE_RULE_PATH,
  digest,
  deriveVolumeDirectoryPath,
  fixedWorkspaceEntries,
  deriveRetiredChapterBodyPath,
  isChapterBodyMarkdownPath,
  isBookCoverInventoryEntry,
  isFolioHostInventoryEntry,
  isRetiredChapterBodyMarkdownPath,
  isSharedPresentationPath,
  isChapterPlanningMarkdownPath,
  isVolumeDirectoryPath,
  normalizeWorkspacePath,
  validateVolumeFolderName,
  validateWorkspaceInventory,
  type WorkspaceInventoryEntry,
  type WorkspaceValidationIssue,
} from "../../core/index.js"
import { readBundledPromptMarkdown } from "../../core/runtime-prompt.js"
import { withCharacterWriteLock } from "./character-file-protection.js"
import type {
  WorkspaceDefaultDocuments,
  WorkspacePort,
  WorkspaceValidationReport,
} from "../../application/index.js"

const BATCH_VOLUME_GUIDE_RESOURCE = "resources/v1/guides/batch-volume-deduction-plan.md"
const CHARACTER_GUIDE_RESOURCE = "resources/v1/guides/character-profiles.md"
const WORK_STYLE_SEED_RESOURCE = "resources/v1/workspace/work-style-seed.md"

export class NodeWorkspaceAdapter implements WorkspacePort {
  public constructor(private readonly sharedPresentationRoot?: string) {}

  private async documentRoot(workspaceRootRef: string, path: string): Promise<string> {
    const root = await realpath(resolve(workspaceRootRef))
    return this.sharedPresentationRoot !== undefined && isSharedPresentationPath(normalizeWorkspacePath(path))
      ? realpath(this.sharedPresentationRoot)
      : root
  }

  public async createLayout(
    workspaceRootRef: string,
    defaults: WorkspaceDefaultDocuments,
  ): Promise<WorkspaceValidationReport> {
    const requestedRoot = resolve(workspaceRootRef)
    await mkdir(requestedRoot, { recursive: true })
    const root = await realpath(requestedRoot)
    const existing = await readdir(root)
    if (existing.length > 0) {
      throw new Error("A new project workspace must be empty")
    }

    for (const entry of fixedWorkspaceEntries) {
      if (this.sharedPresentationRoot !== undefined && isSharedPresentationPath(entry.relativePath)) continue
      const path = resolveInside(root, entry.relativePath)
      if (entry.entryKind === "directory") {
        await mkdir(path, { recursive: true })
      }
    }
    await writeFile(resolveInside(root, WORLD_RULES_OVERVIEW_PATH), defaults.worldRulesOverview, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/base-rules.md"), defaults.baseRules, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/content-handling.md"), defaults.contentHandling, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/webnovel-prose-logic.md"), defaults.webnovelProseLogic, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/plot-synopsis-guide.md"), defaults.plotSynopsisGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/user-to-synopsis-guide.md"), defaults.userToSynopsisGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/synopsis-to-outline-guide.md"), defaults.synopsisToOutlineGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/outline-to-draft-guide.md"), defaults.outlineToDraftGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/settings-query-guide.md"), defaults.settingsQueryGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "世界推演规则/基础规则/settings-revision-guide.md"), defaults.settingsRevisionGuide, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(
      resolveInside(root, "世界推演规则/基础规则/discuss-creation-desk-workflow.md"),
      defaults.discussCreationDeskWorkflow,
      { encoding: "utf8", flag: "wx" },
    )
    await writeFile(
      resolveInside(root, "世界推演规则/基础规则/batch-volume-deduction-plan.md"),
      await readBundledPromptMarkdown(BATCH_VOLUME_GUIDE_RESOURCE),
      { encoding: "utf8", flag: "wx" },
    )
    await writeFile(resolveInside(root, "提示词/系统记忆/系统提示词/MEMORY.md"), defaults.agentMemoryIndex, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, CHARACTER_RULE_PATH), await readBundledPromptMarkdown(CHARACTER_GUIDE_RESOURCE), { encoding: "utf8", flag: "wx" })
    await writeFile(resolveInside(root, "设定集/readme.md"), defaults.settingsReadme, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "设定集/作品简介.md"), "# 作品简介\n", {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "参考文件/readme.md"), defaults.referencesReadme, {
      encoding: "utf8",
      flag: "wx",
    })
    if (this.sharedPresentationRoot === undefined) {
      await writeFile(resolveInside(root, AUTO_DESCRIPTION_RULE_PATH), AUTO_DESCRIPTION_RULE_MARKDOWN, {
        encoding: "utf8",
        flag: "wx",
      })
      await writeFile(resolveInside(root, SENSORY_DESCRIPTION_RULE_PATH), SENSORY_DESCRIPTION_RULE_MARKDOWN, {
        encoding: "utf8",
        flag: "wx",
      })
      await writeFile(resolveInside(root, DEAI_DESCRIPTION_RULE_PATH), DEAI_DESCRIPTION_RULE_MARKDOWN, {
        encoding: "utf8",
        flag: "wx",
      })
      await writeFile(resolveInside(root, "表现输出/描写规则/默认描写规则.md"), defaults.descriptionRules, {
        encoding: "utf8",
        flag: "wx",
      })
      await writeFile(resolveInside(root, "表现输出/笔风规则/默认笔风规则.md"), defaults.proseStyleRules, {
        encoding: "utf8",
        flag: "wx",
      })
    }
    await writeFile(resolveInside(root, "暂存区/readme.md"), defaults.stagingReadme, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "暂存区/本章讨论笔记.md"), defaults.stagingNotes, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "暂存区/人物草稿.md"), defaults.stagingCharacters, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "暂存区/世界与规则草稿.md"), defaults.stagingWorld, {
      encoding: "utf8",
      flag: "wx",
    })
    await writeFile(resolveInside(root, "暂存区/待落盘清单.md"), defaults.stagingPromoteIndex, {
      encoding: "utf8",
      flag: "wx",
    })
    await Promise.all((defaults.promptLibraryFiles ?? []).map((file) => (
      ensurePromptFile(root, file.relativePath, file.markdown)
    )))
    return this.validate(root)
  }
  public async ensurePlatformDocuments(
    workspaceRootRef: string,
    defaults: WorkspaceDefaultDocuments,
  ): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    await assertParentChainContainsNoLinks(root, resolveInside(root, `${CHARACTER_DIRECTORY}/placeholder.json`))
    await mkdir(resolveInside(root, CHARACTER_DIRECTORY), { recursive: true })
    await writeFileIfMissing(resolveInside(root, "设定集/作品简介.md"), "# 作品简介\n")
    await assertParentChainContainsNoLinks(root, resolveInside(root, "世界推演规则/基础规则/base-rules.md"))
    await mkdir(resolveInside(root, "世界推演规则/基础规则"), { recursive: true })
    const platformRules: ReadonlyArray<readonly [string, string]> = [
      [CHARACTER_RULE_PATH, await readBundledPromptMarkdown(CHARACTER_GUIDE_RESOURCE)],
      [WORLD_RULES_OVERVIEW_PATH, defaults.worldRulesOverview],
      ["世界推演规则/基础规则/content-handling.md", defaults.contentHandling],
      ["世界推演规则/基础规则/webnovel-prose-logic.md", defaults.webnovelProseLogic],
      ["世界推演规则/基础规则/plot-synopsis-guide.md", defaults.plotSynopsisGuide],
      ["世界推演规则/基础规则/user-to-synopsis-guide.md", defaults.userToSynopsisGuide],
      ["世界推演规则/基础规则/synopsis-to-outline-guide.md", defaults.synopsisToOutlineGuide],
      ["世界推演规则/基础规则/outline-to-draft-guide.md", defaults.outlineToDraftGuide],
      ["世界推演规则/基础规则/settings-query-guide.md", defaults.settingsQueryGuide],
      ["世界推演规则/基础规则/settings-revision-guide.md", defaults.settingsRevisionGuide],
      ["世界推演规则/基础规则/discuss-creation-desk-workflow.md", defaults.discussCreationDeskWorkflow],
      ["世界推演规则/基础规则/batch-volume-deduction-plan.md", await readBundledPromptMarkdown(BATCH_VOLUME_GUIDE_RESOURCE)],
    ]
    for (const [relativePath, markdown] of platformRules) {
      await refreshPlatformRule(root, relativePath, markdown)
    }
    await mkdir(resolveInside(root, "提示词/系统记忆/系统提示词"), { recursive: true })
    await writeFileIfMissing(
      resolveInside(root, "提示词/系统记忆/系统提示词/MEMORY.md"),
      defaults.agentMemoryIndex,
    )
    await mkdir(resolveInside(root, "大纲"), { recursive: true })
    await mkdir(resolveInside(root, "表现输出/本作品描写"), { recursive: true })
    await writeFileIfMissing(resolveInside(root, WORK_STYLE_RULE_PATH), await readBundledPromptMarkdown(WORK_STYLE_SEED_RESOURCE))
    if (this.sharedPresentationRoot === undefined) {
      await mkdir(resolveInside(root, "表现输出/描写规则"), { recursive: true })
      await mkdir(resolveInside(root, "表现输出/笔风规则"), { recursive: true })
      await writeFileIfMissing(resolveInside(root, AUTO_DESCRIPTION_RULE_PATH), AUTO_DESCRIPTION_RULE_MARKDOWN)
      await writeFileIfMissing(resolveInside(root, SENSORY_DESCRIPTION_RULE_PATH), SENSORY_DESCRIPTION_RULE_MARKDOWN)
      await writeFileIfMissing(resolveInside(root, DEAI_DESCRIPTION_RULE_PATH), DEAI_DESCRIPTION_RULE_MARKDOWN)
      await writeFileIfMissing(resolveInside(root, "表现输出/描写规则/默认描写规则.md"), defaults.descriptionRules)
      await writeFileIfMissing(resolveInside(root, "表现输出/笔风规则/默认笔风规则.md"), defaults.proseStyleRules)
    }
    await mkdir(resolveInside(root, "暂存区"), { recursive: true })
    await writeFileIfMissing(resolveInside(root, "暂存区/readme.md"), defaults.stagingReadme)
    await writeFileIfMissing(resolveInside(root, "暂存区/本章讨论笔记.md"), defaults.stagingNotes)
    await writeFileIfMissing(resolveInside(root, "暂存区/人物草稿.md"), defaults.stagingCharacters)
    await writeFileIfMissing(resolveInside(root, "暂存区/世界与规则草稿.md"), defaults.stagingWorld)
    await writeFileIfMissing(resolveInside(root, "暂存区/待落盘清单.md"), defaults.stagingPromoteIndex)
    await mkdir(resolveInside(root, "提示词"), { recursive: true })
    const promptScopes = ["基础规则", "用户规则", "系统记忆"]
    const promptCategories = [
      "系统提示词",
      "阶段提示词",
      "消息前后/用户消息前",
      "消息前后/用户消息后",
    ]
    for (const scope of promptScopes) {
      for (const category of promptCategories) {
        await mkdir(resolveInside(root, `提示词/${scope}/${category}`), { recursive: true })
      }
    }
    await migrateLegacyPromptScope(root, "世界推演规则/用户规则", "提示词/用户规则/系统提示词")
    await migrateLegacyPromptScope(root, "世界推演规则/Agent记忆", "提示词/系统记忆/系统提示词")
    await migrateFlatStagePromptFolders(root)
    // Migration may create parent directories after the main scaffold pass; ensure all leaf folders exist.
    for (const scope of promptScopes) {
      for (const category of promptCategories) {
        await mkdir(resolveInside(root, `提示词/${scope}/${category}`), { recursive: true })
      }
    }
    const emptyProjectPromptDocs = [
      "用户规则/系统提示词/用户规则.md",
      "用户规则/阶段提示词/新章节阶段.md",
      "用户规则/阶段提示词/梗概阶段.md",
      "用户规则/阶段提示词/草稿阶段.md",
      "用户规则/阶段提示词/章节入库阶段.md",
      "用户规则/消息前后/用户消息前.md",
      "用户规则/消息前后/用户消息后.md",
      "系统记忆/系统提示词/系统记忆.md",
      "系统记忆/阶段提示词/新章节阶段.md",
      "系统记忆/阶段提示词/梗概阶段.md",
      "系统记忆/阶段提示词/草稿阶段.md",
      "系统记忆/阶段提示词/章节入库阶段.md",
      "系统记忆/消息前后/用户消息前.md",
      "系统记忆/消息前后/用户消息后.md",
    ]
    for (const relativePath of emptyProjectPromptDocs) {
      await writeFileIfMissing(resolveInside(root, `提示词/${relativePath}`), "")
    }
    await Promise.all((defaults.promptLibraryFiles ?? []).map((file) => (
      refreshPromptFile(root, file.relativePath, file.markdown)
    )))
    await migrateLegacyWorldPlanFolder(root)
  }

  public async validate(workspaceRootRef: string): Promise<WorkspaceValidationReport> {
    const root = await realpath(resolve(workspaceRootRef))
    const { inventory, issues: scanIssues } = await scanWorkspace(root, this.sharedPresentationRoot !== undefined)
    if (this.sharedPresentationRoot !== undefined) {
      const shared = await scanWorkspace(await realpath(this.sharedPresentationRoot))
      inventory.push(...shared.inventory.filter((entry) => isSharedPresentationPath(entry.path)))
      scanIssues.push(...shared.issues)
    }
    const issues = [...scanIssues, ...validateWorkspaceInventory(inventory)]
    issues.push(...await validateFixedWorkspaceEntries(root, issues, this.sharedPresentationRoot))
    const baseRulesPath = resolveInside(root, "世界推演规则/基础规则/base-rules.md")
    let baseRulesDigest = "missing"
    try {
      baseRulesDigest = digest(await readFile(baseRulesPath, "utf8"))
    } catch {
      if (!issues.some((issue) => issue.path === "世界推演规则/基础规则/base-rules.md")) {
        issues.push({
          code: "missing_fixed_entry",
          path: "世界推演规则/基础规则/base-rules.md",
          message: "Platform base rules projection is missing",
        })
      }
    }
    return {
      workspaceRootRef: root,
      ...(this.sharedPresentationRoot === undefined ? {} : { sharedPresentationRoot: this.sharedPresentationRoot }),
      // Validate every scanned entry first. Cover assets and the .folio host
      // tree stay on disk, but they are not writing documents for the UI,
      // AI catalog, or history.
      inventory: inventory.filter((entry) => (
        !isBookCoverInventoryEntry(entry.path, entry.kind)
        && !isFolioHostInventoryEntry(entry.path, entry.kind)
      )),
      issues,
      baseRulesDigest,
    }
  }

  public async readMarkdown(workspaceRootRef: string, relativePath: string): Promise<string> {
    const root = await this.documentRoot(workspaceRootRef, relativePath)
    const normalized = normalizeWorkspacePath(relativePath)
    if (!normalized.endsWith(".md") && !isCharacterProfilePath(normalized)) {
      throw new Error("Only Markdown files can be read from the user workspace")
    }
    const path = await resolveExistingInside(root, normalized)
    return readFile(path, "utf8")
  }

  public async saveUserMarkdown(workspaceRootRef: string, relativePath: string, content: string): Promise<void> {
    const root = await this.documentRoot(workspaceRootRef, relativePath)
    const normalized = assertWorkspaceMutationAllowed(relativePath, "file", "user")
    if (normalized === "设定集/作品简介.md" && content.replace(/^\s*#\s*作品简介\s*/u, "").trim().length > 300) {
      throw new Error("作品简介不能超过 300 字")
    }
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    await mkdir(resolve(path, ".."), { recursive: true })
    await writeFile(path, content, { encoding: "utf8" })
  }

  /** Platform-owned prompt mirror: bypass user read-only rules, still validate path shape. */
  public async savePromptMirror(workspaceRootRef: string, relativePath: string, content: string): Promise<void> {
    const normalized = assertWorkspaceMutationAllowed(relativePath, "file", "platform")
    const root = await realpath(resolve(workspaceRootRef))
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    await mkdir(resolve(path, ".."), { recursive: true })
    await writeFile(path, content, { encoding: "utf8" })
  }

  /**
   * Field updates share a project write lock and always apply against the latest on-disk
   * profile. A stale expectedContent only means "rebase onto newer writes"; it must not fail
   * graph-governance / extraction pipelines that queue multiple updates for the same file.
   */
  public async updateCharacter(workspaceRootRef: string, rawUpdate: CharacterUpdate): Promise<string> {
    const update = characterUpdateSchema.parse(rawUpdate)
    const root = await realpath(resolve(workspaceRootRef))
    const path = resolveInside(root, update.relativePath)
    return withCharacterWriteLock(root, async () => {
      await assertParentChainContainsNoLinks(root, path)
      const existingStat = await lstat(path).catch((error: unknown) => { if (!isNotFoundError(error)) throw error; return undefined })
      if (existingStat !== undefined && (!existingStat.isFile() || existingStat.isSymbolicLink())) throw new Error("人物资料必须为普通文件，禁止链接")
      let previous: string | undefined
      try { previous = await readFile(path, "utf8") } catch (error) { if (!isNotFoundError(error)) throw error }
      if (update.mode === "create" && previous !== undefined) throw new Error("人物已存在，请使用字段更新，不能覆盖创建")
      if (update.mode === "update" && previous === undefined) throw new Error("人物不存在，请先创建")
      // Ignore stale expectedContent: earlier writers already held the lock and landed first.
      // Rebase this writer's operations onto the newest content so concurrent updates serialize.
      const profile = previous === undefined ? emptyCharacterProfile(basename(path, ".json")) : parseCharacterProfile(previous)
      const content = formatCharacterProfile(applyCharacterFieldOperations(profile, update.operations))
      if (content.length > 1_000_000) throw new Error("人物资料过大")
      await mkdir(resolve(path, ".."), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      return content
    })
  }

  public async createUserDirectory(workspaceRootRef: string, relativePath: string): Promise<void> {
    const root = await this.documentRoot(workspaceRootRef, relativePath)
    const normalized = assertUserCanCreateDirectory(relativePath)
    if (isVolumeDirectoryPath(normalized)) {
      const folderName = normalized.slice("章节正文/".length)
      const existing = await this.listVolumeFolderNames(root)
      assertVolumeSequenceAvailable(folderName, existing)
    }
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    await mkdir(path, { recursive: true })
  }

  public async removeUserMarkdown(workspaceRootRef: string, relativePath: string): Promise<void> {
    const root = await this.documentRoot(workspaceRootRef, relativePath)
    const normalized = assertUserCanDeleteMarkdown(relativePath)
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    try {
      await unlink(path)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }

  public async listVolumeFolderNames(workspaceRootRef: string): Promise<readonly string[]> {
    const root = await realpath(resolve(workspaceRootRef))
    const chaptersRoot = resolveInside(root, "章节正文")
    let names: string[] = []
    try {
      const entries = await readdir(chaptersRoot, { withFileTypes: true })
      names = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => validateVolumeFolderName(name).ok)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
    return names
  }

  public async removeEmptyVolumeDirectory(workspaceRootRef: string, relativePath: string): Promise<void> {
    await this.removeVolumeDirectory(workspaceRootRef, relativePath)
  }

  public async removeVolumeDirectory(workspaceRootRef: string, relativePath: string): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    const normalized = assertUserCanDeleteVolumeDirectory(relativePath)
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    let children: string[]
    try {
      children = await readdir(path)
    } catch (error) {
      if (isNotFoundError(error)) return
      throw error
    }
    const bodyFiles: string[] = []
    const removableFiles: string[] = []
    for (const name of children) {
      const childRelative = `${normalized}/${name}`
      const childAbsolute = resolveInside(root, childRelative)
      const stats = await lstat(childAbsolute)
      if (stats.isSymbolicLink()) {
        throw new Error(`卷文件夹含符号链接，不能删除：${childRelative}`)
      }
      if (stats.isDirectory()) {
        throw new Error(`卷文件夹含嵌套目录，不能删除：${childRelative}`)
      }
      if (!stats.isFile() || !name.endsWith(".md")) {
        throw new Error(`卷文件夹含不可自动清理的文件，不能删除：${childRelative}`)
      }
      if (isChapterBodyMarkdownPath(childRelative)) {
        bodyFiles.push(childRelative)
        continue
      }
      if (isChapterPlanningMarkdownPath(childRelative)) {
        removableFiles.push(childRelative)
        continue
      }
      // Unknown markdown under a volume: treat as body to be safe.
      bodyFiles.push(childRelative)
    }
    if (bodyFiles.length > 0) {
      throw new Error(
        `卷文件夹含正式章节正文，不能直接删除（请先走章节修订/迁移）。冲突文件：${bodyFiles.join("、")}`,
      )
    }
    for (const file of removableFiles) {
      try {
        await unlink(resolveInside(root, file))
      } catch (error) {
        if (!isNotFoundError(error)) throw error
      }
    }
    await rmdir(path)
  }

  public async renameVolumeDirectory(
    workspaceRootRef: string,
    fromFolderName: string,
    toFolderName: string,
  ): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    const fromValidated = validateVolumeFolderName(fromFolderName)
    const toValidated = validateVolumeFolderName(toFolderName)
    if (!fromValidated.ok) throw new Error(fromValidated.reason)
    if (!toValidated.ok) throw new Error(toValidated.reason)
    if (fromValidated.folderName === toValidated.folderName) return
    if (fromValidated.sequence !== toValidated.sequence) {
      throw new Error(
        `卷原地重命名必须保持同一序号（当前 ${fromValidated.folderName} → ${toValidated.folderName}）`,
      )
    }
    const existing = await this.listVolumeFolderNames(root)
    assertVolumeSequenceAvailable(toValidated.folderName, existing, {
      excludeFolderName: fromValidated.folderName,
    })
    const fromPath = resolveInside(root, deriveVolumeDirectoryPath(fromValidated.folderName))
    const toPath = resolveInside(root, deriveVolumeDirectoryPath(toValidated.folderName))
    await assertParentChainContainsNoLinks(root, fromPath)
    await assertParentChainContainsNoLinks(root, toPath)
    try {
      await lstat(toPath)
      throw new Error(`目标卷文件夹已存在：${toValidated.folderName}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("目标卷文件夹已存在")) throw error
      if (!isNotFoundError(error)) throw error
    }
    await rename(fromPath, toPath)
  }

  public async saveSynopsisMarkdown(workspaceRootRef: string, relativePath: string, content: string): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    const normalized = assertWorkspaceMutationAllowed(relativePath, "file", "platform")
    if (!isChapterPlanningMarkdownPath(normalized)) {
      throw new Error(`Only synopsis/outline markdown paths can be saved through synopsis workflow: ${normalized}`)
    }
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    await this.ensureVolumeParentDirectory(root, normalized)
    await writeFile(path, content, { encoding: "utf8" })
  }

  public async removeSynopsisMarkdown(workspaceRootRef: string, relativePath: string): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    // Allow removing both canonical and legacy/invalid planning-named files (cleanup).
    const normalized = normalizeWorkspacePath(relativePath)
    if (!isChapterPlanningMarkdownPath(normalized)) {
      throw new Error(`Only synopsis/outline markdown paths can be removed through synopsis workflow: ${normalized}`)
    }
    const path = resolveInside(root, normalized)
    try {
      await unlink(path)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }

  public async publishChapter(workspaceRootRef: string, relativePath: string, content: string): Promise<void> {
    const root = await realpath(resolve(workspaceRootRef))
    const normalized = assertWorkspaceMutationAllowed(relativePath, "file", "chapter_publisher")
    const path = resolveInside(root, normalized)
    await assertParentChainContainsNoLinks(root, path)
    await mkdir(resolve(path, ".."), { recursive: true })
    try {
      await writeFile(path, content, { encoding: "utf8", flag: "wx" })
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      const existing = await readFile(path, "utf8")
      if (existing !== content) throw new Error(`Chapter already exists with different content: ${normalized}`)
    }
  }

  public async archivePublishedChapter(workspaceRootRef: string, relativePath: string): Promise<string> {
    const root = await realpath(resolve(workspaceRootRef))
    const normalized = normalizeWorkspacePath(relativePath)
    if (isRetiredChapterBodyMarkdownPath(normalized)) return normalized
    if (!isChapterBodyMarkdownPath(normalized)) {
      throw new Error(`Only live published chapter bodies can be archived: ${normalized}`)
    }
    assertWorkspaceMutationAllowed(normalized, "file", "chapter_publisher")
    const retiredRelative = deriveRetiredChapterBodyPath(normalized)
    assertWorkspaceMutationAllowed(retiredRelative, "file", "chapter_publisher")
    const currentPath = resolveInside(root, normalized)
    const retiredPath = resolveInside(root, retiredRelative)
    await assertParentChainContainsNoLinks(root, currentPath)
    await assertParentChainContainsNoLinks(root, retiredPath)
    try {
      await lstat(currentPath)
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error(`Published chapter body not found: ${normalized}`)
      }
      throw error
    }
    try {
      await lstat(retiredPath)
      throw new Error(`Retired chapter path already exists: ${retiredRelative}`)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
    await rename(currentPath, retiredPath)
    return retiredRelative
  }

  public async replacePublishedChapter(
    workspaceRootRef: string,
    currentRelativePath: string,
    nextRelativePath: string,
    expectedDigest: string,
    content: string,
  ): Promise<void> {
    const { currentPath, nextPath, currentContent, nextContent } = await this.inspectChapterReplacement(
      workspaceRootRef, currentRelativePath, nextRelativePath, expectedDigest, content,
    )
    if (nextContent !== content) {
      await mkdir(resolve(nextPath, ".."), { recursive: true })
      await writeFile(nextPath, content, { encoding: "utf8" })
    }
    if (currentPath !== nextPath && currentContent !== undefined) await unlink(currentPath)
  }

  public async validatePublishedChapterReplacement(
    workspaceRootRef: string,
    currentRelativePath: string,
    nextRelativePath: string,
    expectedDigest: string,
    content: string,
  ): Promise<void> {
    await this.inspectChapterReplacement(workspaceRootRef, currentRelativePath, nextRelativePath, expectedDigest, content)
  }

  private async inspectChapterReplacement(
    workspaceRootRef: string,
    currentRelativePath: string,
    nextRelativePath: string,
    expectedDigest: string,
    content: string,
  ) {
    const root = await realpath(resolve(workspaceRootRef))
    const currentNormalized = assertWorkspaceMutationAllowed(currentRelativePath, "file", "chapter_publisher")
    const nextNormalized = assertWorkspaceMutationAllowed(nextRelativePath, "file", "chapter_publisher")
    const currentPath = resolveInside(root, currentNormalized)
    const nextPath = resolveInside(root, nextNormalized)
    await assertParentChainContainsNoLinks(root, currentPath)
    await assertParentChainContainsNoLinks(root, nextPath)
    let currentContent: string | undefined
    try {
      currentContent = await readFile(currentPath, "utf8")
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
    let nextContent = currentPath === nextPath ? currentContent : undefined
    if (currentPath !== nextPath) {
      try {
        nextContent = await readFile(nextPath, "utf8")
      } catch (error) {
        if (!isNotFoundError(error)) throw error
      }
    }
    if (currentContent !== undefined && digest(currentContent) !== expectedDigest && currentContent !== content) {
      throw new Error(`Published chapter changed outside the revision workflow: ${currentNormalized}`)
    }
    const baseMovedToTarget = currentContent === undefined && nextContent !== undefined
      && digest(nextContent) === expectedDigest
    if (currentPath !== nextPath && nextContent !== undefined && nextContent !== content && !baseMovedToTarget) {
      throw new Error(`Chapter title conflicts with an existing file: ${nextNormalized}`)
    }
    if (currentContent === undefined && nextContent === undefined) {
      throw new Error(`Published chapter is missing: ${currentNormalized}`)
    }
    return { currentPath, nextPath, currentContent, nextContent }
  }

  public async importMarkdownFiles(
    workspaceRootRef: string,
    destination: string,
    sourcePaths: readonly string[],
  ): Promise<number> {
    const copies = await Promise.all(sourcePaths.map(async (sourcePath) => {
      const source = await realpath(resolve(sourcePath))
      const sourceStats = await lstat(source)
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || extname(source) !== ".md") {
        throw new Error(`Imported files must be regular .md files: ${sourcePath}`)
      }
      const targetRelativePath = normalizeWorkspacePath(`${destination}/${basename(source)}`)
      assertUserCanCreateMarkdown(targetRelativePath)
      const root = await this.documentRoot(workspaceRootRef, targetRelativePath)
      return { source, root, target: resolveInside(root, targetRelativePath) }
    }))
    for (const copy of copies) {
      await assertParentChainContainsNoLinks(copy.root, copy.target)
      await mkdir(resolve(copy.target, ".."), { recursive: true })
      await copyFile(copy.source, copy.target, constants.COPYFILE_EXCL)
    }
    return copies.length
  }

  public async importMarkdownFolder(
    workspaceRootRef: string,
    destination: string,
    sourceFolder: string,
  ): Promise<number> {
    const sourceRoot = await realpath(resolve(sourceFolder))
    const sourceStats = await lstat(sourceRoot)
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new Error("Imported folder must be a regular directory")
    }
    const files = await scanImportFolder(sourceRoot, sourceRoot)
    const copies = await Promise.all(files.map(async (source) => {
      const sourceRelativePath = relative(sourceRoot, source).replaceAll("\\", "/")
      const targetRelativePath = normalizeWorkspacePath(`${destination}/${sourceRelativePath}`)
      assertUserCanCreateMarkdown(targetRelativePath)
      const root = await this.documentRoot(workspaceRootRef, targetRelativePath)
      return { source, root, target: resolveInside(root, targetRelativePath) }
    }))
    for (const copy of copies) {
      await assertParentChainContainsNoLinks(copy.root, copy.target)
      await mkdir(resolve(copy.target, ".."), { recursive: true })
      await copyFile(copy.source, copy.target, constants.COPYFILE_EXCL)
    }
    return copies.length
  }

  /**
   * Creating planning/chapter files must not silently mkdir a second folder for an
   * already-used volume sequence (the explicit createVolume gate alone is not enough).
   */
  private async ensureVolumeParentDirectory(root: string, relativeFilePath: string): Promise<void> {
    const normalized = relativeFilePath.replaceAll("\\", "/")
    const slash = normalized.lastIndexOf("/")
    if (slash <= 0) {
      throw new Error(`Invalid planning path without volume parent: ${normalized}`)
    }
    const parentRelative = normalized.slice(0, slash)
    const parentAbsolute = resolveInside(root, parentRelative)
    let parentExists = false
    try {
      await lstat(parentAbsolute)
      parentExists = true
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
    if (!parentExists && isVolumeDirectoryPath(parentRelative)) {
      const folderName = parentRelative.slice("章节正文/".length)
      const existing = await this.listVolumeFolderNames(root)
      assertVolumeSequenceAvailable(folderName, existing)
    }
    await mkdir(parentAbsolute, { recursive: true })
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "EEXIST"
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error
  }
}

async function ensurePromptFile(root: string, relativePath: string, markdown: string): Promise<void> {
  const path = resolveInside(root, relativePath)
  await assertParentChainContainsNoLinks(root, path)
  await mkdir(resolve(path, ".."), { recursive: true })
  await writeFileIfMissing(path, markdown)
}

async function refreshPromptFile(root: string, relativePath: string, markdown: string): Promise<void> {
  const path = resolveInside(root, relativePath)
  await mkdir(resolve(path, ".."), { recursive: true })
  await refreshPlatformRule(root, relativePath, markdown)
}

async function refreshPlatformRule(root: string, relativePath: string, markdown: string): Promise<void> {
  const path = resolveInside(root, relativePath)
  await assertParentChainContainsNoLinks(root, path)
  try {
    const current = await lstat(path)
    if (!current.isFile() || current.isSymbolicLink()) throw new Error("Platform rules must use regular files")
    const original = await readFile(path, "utf8")
    if (original.replaceAll("\r\n", "\n") === markdown.replaceAll("\r\n", "\n")) return
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
  const pendingPath = `${path}.${randomUUID()}.tmp`
  await writeFile(pendingPath, markdown, { encoding: "utf8", flag: "wx" })
  try {
    await rename(pendingPath, path)
  } finally {
    await rm(pendingPath, { force: true })
  }
}

async function migrateLegacyPromptScope(root: string, sourcePath: string, targetPath: string): Promise<void> {
  const source = resolveInside(root, sourcePath)
  const target = resolveInside(root, targetPath)
  try {
    const entries = await readdir(source, { withFileTypes: true })
    await mkdir(target, { recursive: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const targetFile = join(target, entry.name)
      try {
        await lstat(targetFile)
      } catch {
        await copyFile(join(source, entry.name), targetFile)
      }
    }
  } catch {
    // No legacy folder; nothing to migrate.
  }
}

async function migrateFlatStagePromptFolders(root: string): Promise<void> {
  const stages = ["新章节阶段", "梗概阶段", "草稿阶段", "章节入库阶段"]
  for (const scope of ["基础规则", "用户规则", "系统记忆"]) {
    const category = resolveInside(root, `提示词/${scope}/阶段提示词`)
    for (const stage of stages) {
      const legacy = join(category, stage)
      try {
        const entries = await readdir(legacy, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue
          const flatName = entry.name.includes(stage) ? entry.name : `${stage}-${entry.name}`
          const target = join(category, flatName)
          try { await lstat(target) } catch { await copyFile(join(legacy, entry.name), target) }
        }
        await rm(legacy, { recursive: true, force: true })
      } catch {
        // Legacy folder absent.
      }
    }
  }
}

/** Move legacy `世界推演规划/{卷}/卷大纲.md` → `大纲/{卷}.md`, then remove the old root. */
async function migrateLegacyWorldPlanFolder(root: string): Promise<void> {
  const legacyRoot = resolveInside(root, "世界推演规划")
  let names: string[]
  try {
    names = await readdir(legacyRoot)
  } catch {
    return
  }
  await mkdir(resolveInside(root, "大纲"), { recursive: true })
  for (const name of names) {
    if (name === "批量推演规划.md") continue
    const source = join(legacyRoot, name, "卷大纲.md")
    const target = resolveInside(root, `大纲/${name}.md`)
    try {
      const content = await readFile(source, "utf8")
      await writeFileIfMissing(target, content)
    } catch {
      // missing outline — skip
    }
  }
  try {
    await rm(legacyRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}

function resolveInside(root: string, relativePath: string): string {
  const normalized = normalizeWorkspacePath(relativePath)
  const target = resolve(root, ...normalized.split("/"))
  const fromRoot = relative(root, target)
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Workspace path escapes the project root")
  }
  return target
}

async function resolveExistingInside(root: string, relativePath: string): Promise<string> {
  const candidate = resolveInside(root, relativePath)
  const target = await realpath(candidate)
  const fromRoot = relative(root, target)
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Workspace path resolves outside the project root")
  }
  const stats = await lstat(candidate)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Workspace document must be a regular file")
  }
  return target
}

async function assertParentChainContainsNoLinks(root: string, target: string): Promise<void> {
  let current = resolve(target, "..")
  while (current !== root) {
    const fromRoot = relative(root, current)
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error("Workspace parent escapes the project root")
    }
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error("Symbolic links and directory junctions are not allowed in the workspace")
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        current = resolve(current, "..")
        continue
      }
      throw error
    }
    current = resolve(current, "..")
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function scanWorkspace(root: string, omitSharedPresentation = false): Promise<{
  inventory: WorkspaceInventoryEntry[]
  issues: WorkspaceValidationIssue[]
}> {
  const inventory: WorkspaceInventoryEntry[] = []
  const issues: WorkspaceValidationIssue[] = []

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).replaceAll("\\", "/")
      if (omitSharedPresentation && isSharedPresentationPath(relativePath)) continue
      // Folio writers leave short-lived ui-state.*.tmp files; never inventory them.
      if (relativePath.startsWith(".folio/") && relativePath.endsWith(".tmp")) continue
      let stats
      try {
        stats = await lstat(path)
      } catch (error) {
        // A concurrent writer may rename/delete the entry between readdir and lstat.
        if (isNotFoundError(error)) continue
        throw error
      }
      if (stats.isSymbolicLink()) {
        issues.push({ code: "invalid_path", path: relativePath, message: "Symbolic links and directory junctions are not allowed" })
        continue
      }
      if (stats.isDirectory()) {
        inventory.push({ path: relativePath, kind: "directory" })
        await visit(path)
      } else if (stats.isFile()) {
        inventory.push({ path: relativePath, kind: "file" })
      } else {
        issues.push({ code: "invalid_path", path: relativePath, message: "Only directories and regular Markdown files are allowed" })
      }
    }
  }

  await visit(root)
  return { inventory, issues }
}

async function validateFixedWorkspaceEntries(
  root: string,
  existingIssues: readonly WorkspaceValidationIssue[],
  sharedPresentationRoot?: string,
): Promise<WorkspaceValidationIssue[]> {
  const issueKeys = new Set(existingIssues.map((issue) => `${issue.code}:${issue.path}`))
  const missingIssues: WorkspaceValidationIssue[] = []
  for (const entry of fixedWorkspaceEntries) {
    const issueKey = `missing_fixed_entry:${entry.relativePath}`
    if (issueKeys.has(issueKey)) {
      continue
    }
    try {
      const documentRoot = sharedPresentationRoot !== undefined && isSharedPresentationPath(entry.relativePath)
        ? sharedPresentationRoot : root
      const stats = await lstat(resolveInside(documentRoot, entry.relativePath))
      if (entry.entryKind === "directory" && stats.isDirectory()) {
        continue
      }
      if (entry.entryKind === "file" && stats.isFile()) {
        continue
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error
      }
    }
    missingIssues.push({
      code: "missing_fixed_entry",
      path: entry.relativePath,
      message: "Required fixed workspace entry is missing",
    })
  }
  return missingIssues
}

async function scanImportFolder(root: string, directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) {
      throw new Error(`Imported folders cannot contain symbolic links: ${relative(root, path)}`)
    }
    if (stats.isDirectory()) {
      files.push(...await scanImportFolder(root, path))
    } else if (stats.isFile() && extname(path) === ".md") {
      files.push(path)
    } else {
      throw new Error(`Imported folders can contain only .md files: ${relative(root, path)}`)
    }
  }
  return files
}
