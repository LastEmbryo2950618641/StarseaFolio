import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

import {
  ProjectLifecycleService,
  type AIModelPort,
  type ModelCatalogPort,
  type ModelProfileStorePort,
  type CreatedProject,
  type CreateProjectInput,
} from "../application/index.js"
import type { InternalProjectStore, ProjectRepositoryFactory, WorkspaceDefaultDocuments, WorkspacePort } from "../application/workspace/index.js"
import type { RegisteredProject } from "../application/projects/index.js"
import { NodeInternalStoreAdapter, NodeWorkspaceAdapter } from "../infrastructure/filesystem/index.js"
import { NodePromptResourceAdapter, PromptLibraryService } from "../infrastructure/prompts/index.js"
import { setPromptOverrideResolver } from "../core/runtime-prompt.js"
import {
  createModelFromEnvironment,
  createModelFromSelection,
  DeepSeekModelCatalogAdapter,
  type DeepSeekModelSelection,
} from "../infrastructure/models/index.js"
import {
  SqliteProjectRegistryRepository,
  SqliteModelProfileStore,
  SqliteProjectRepositoryFactory,
  openRegistryDatabase,
} from "../infrastructure/sqlite/index.js"
import type { Kysely } from "kysely"
import type { RegistryDatabase } from "../infrastructure/sqlite/database-types.js"
import { readBundledPromptMarkdown } from "../core/runtime-prompt.js"
import { ProjectRuntime } from "./project-runtime.js"
import { SharedPresentationLibrary } from "../infrastructure/filesystem/shared-presentation-library.js"

export type BackendContainerOptions = Readonly<{
  applicationDataRoot: string
  promptPackageRoot: string
  nikowenkuRuntimeDirectory?: string
  model?: AIModelPort
  modelCatalog?: ModelCatalogPort
  modelProfiles?: ModelProfileStorePort
  workspaceDefaults?: WorkspaceDefaultDocuments
  createId?: () => string
  now?: () => number
}>

export class BackendContainer {
  public readonly workspace: NodeWorkspaceAdapter
  private readonly sharedPresentation: SharedPresentationLibrary
  public readonly internalStore: NodeInternalStoreAdapter
  public readonly model: AIModelPort
  public readonly modelCatalog: ModelCatalogPort
  public readonly modelProfiles: ModelProfileStorePort
  public readonly createId: () => string
  public readonly now: () => number
  private readonly lifecycle: ProjectLifecycleService
  private readonly registryDatabase: Kysely<RegistryDatabase>
  private readonly projectRepositoryFactory: ProjectRepositoryFactory
  private readonly promptPackageRoot: string
  private readonly applicationDataRoot: string
  private readonly nikowenkuRuntimeDirectory: string | undefined
  private readonly workspaceDefaults: WorkspaceDefaultDocuments | undefined
  private readonly promptLibrary: PromptLibraryService
  private cachedDefaults: Readonly<{ revision: number; defaults: WorkspaceDefaultDocuments }> | undefined
  private currentRuntime: ProjectRuntime | undefined

  private constructor(
    options: BackendContainerOptions,
    registryDatabase: Kysely<RegistryDatabase>,
  ) {
    this.registryDatabase = registryDatabase
    this.sharedPresentation = new SharedPresentationLibrary(
      resolve(options.applicationDataRoot),
      resolve(options.promptPackageRoot, "resources/presentation"),
    )
    this.workspace = new NodeWorkspaceAdapter(this.sharedPresentation.root)
    this.internalStore = new NodeInternalStoreAdapter(options.applicationDataRoot)
    this.applicationDataRoot = resolve(options.applicationDataRoot)
    this.promptPackageRoot = resolve(options.promptPackageRoot)
    this.promptLibrary = new PromptLibraryService(
      this.promptPackageRoot,
      join(this.applicationDataRoot, "prompt-library"),
    )
    setPromptOverrideResolver({
      runtimePath: (file) => this.promptLibrary.runtimeOverridePath(file),
      resourcePath: (path) => this.promptLibrary.resourceOverridePath(path),
    })
    this.nikowenkuRuntimeDirectory = options.nikowenkuRuntimeDirectory
    this.model = options.model ?? createModelFromEnvironment(
      this.promptPackageRoot,
      this.promptLibrary,
    )
    this.modelCatalog = options.modelCatalog ?? new DeepSeekModelCatalogAdapter()
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.modelProfiles = options.modelProfiles ?? new SqliteModelProfileStore(this.registryDatabase, this.now)
    this.workspaceDefaults = options.workspaceDefaults
    this.projectRepositoryFactory = new SqliteProjectRepositoryFactory()
    this.lifecycle = new ProjectLifecycleService(
      new SqliteProjectRegistryRepository(this.registryDatabase),
      this.workspace,
      this.internalStore,
      this.projectRepositoryFactory,
    )
  }

  public static async open(options: BackendContainerOptions): Promise<BackendContainer> {
    const applicationDataRoot = resolve(options.applicationDataRoot)
    const registryDatabase = await openRegistryDatabase(join(applicationDataRoot, "registry.sqlite"))
    try {
      const container = new BackendContainer(options, registryDatabase)
      await container.sharedPresentation.initialize()
      const projects = await registryDatabase.selectFrom("registered_projects")
        .select("workspace_root_ref").orderBy("workspace_root_ref").execute()
      for (const project of projects) await container.sharedPresentation.migrate(project.workspace_root_ref)
      return container
    } catch (error) {
      await registryDatabase.destroy()
      throw error
    }
  }

  public async createProject(input: Omit<CreateProjectInput, "defaults" | "nowMs">): Promise<CreatedProject> {
    const defaults = await this.resolveWorkspaceDefaults()
    const created = await this.lifecycle.create({
      ...input,
      defaults,
      nowMs: this.now(),
    })
    await this.openRuntime(created.internalStore, input.workspaceRootRef, input.projectId)
    return created
  }

  public async openProject(workspaceRootRef: string): Promise<CreatedProject> {
    await this.sharedPresentation.migrate(workspaceRootRef)
    const defaults = await this.resolveWorkspaceDefaults()
    const opened = await this.lifecycle.openByWorkspace(workspaceRootRef, this.now(), defaults)
    await this.openRuntime(opened.internalStore, opened.manifest.workspaceRootRef, opened.manifest.id)
    return opened
  }

  public async listProjects(): Promise<readonly RegisteredProject[]> {
    return this.lifecycle.listRegistered()
  }

  public async deleteProject(input: Readonly<{
    projectId: string
    workspaceRootRef: string
    mode: "keep_data" | "include_data"
  }>): Promise<void> {
    const resolvedRoot = resolve(input.workspaceRootRef)
    if (
      this.currentRuntime !== undefined
      && this.currentRuntime.projectId === input.projectId
      && this.currentRuntime.workspaceRootRef === resolvedRoot
      && !this.currentRuntime.isClosed()
    ) {
      await this.currentRuntime.close()
      this.currentRuntime = undefined
    }
    await this.lifecycle.deleteRegistered(input)
  }

  public async peekProjectDisplayName(project: RegisteredProject): Promise<string | undefined> {
    return this.lifecycle.peekDisplayName(project)
  }

  public async getRuntime(projectId: string, workspaceRootRef: string): Promise<ProjectRuntime> {
    const resolvedRoot = resolve(workspaceRootRef)
    if (
      this.currentRuntime !== undefined
      && this.currentRuntime.projectId === projectId
      && this.currentRuntime.workspaceRootRef === resolvedRoot
      && !this.currentRuntime.isClosed()
    ) {
      return this.currentRuntime
    }
    const opened = await this.openProject(workspaceRootRef)
    if (opened.manifest.id !== projectId) {
      throw new Error("The workspace belongs to a different project")
    }
    if (this.currentRuntime === undefined || this.currentRuntime.isClosed()) {
      throw new Error("Project runtime failed to open")
    }
    return this.currentRuntime
  }

  public async validateProject(workspaceRootRef: string): Promise<Awaited<ReturnType<WorkspacePort["validate"]>>> {
    return this.workspace.validate(workspaceRootRef)
  }

  public getCurrentRuntime(): ProjectRuntime | undefined {
    return this.currentRuntime
  }

  public createModelFromSelection(selection: DeepSeekModelSelection): AIModelPort {
    return createModelFromSelection(this.promptPackageRoot, selection, this.promptLibrary)
  }

  public async close(): Promise<void> {
    await this.currentRuntime?.close()
    await this.registryDatabase.destroy()
  }

  private async openRuntime(store: InternalProjectStore, workspaceRootRef: string, projectId: string): Promise<void> {
    const previous = this.currentRuntime
    this.currentRuntime = undefined
    if (previous !== undefined && !previous.isClosed()) {
      await previous.close()
    }
    this.currentRuntime = await ProjectRuntime.open(
      projectId,
      resolve(workspaceRootRef),
      store,
      this.internalStore,
      this.promptPackageRoot,
      this.workspace,
      this.applicationDataRoot,
      this.nikowenkuRuntimeDirectory,
      this.promptLibrary,
    )
    await this.currentRuntime.ensureSettingsLineageSeeded()
    await this.currentRuntime.rematerializeMissingPublishedBodies()
  }

  private async resolveWorkspaceDefaults(): Promise<WorkspaceDefaultDocuments> {
    if (this.workspaceDefaults !== undefined) return this.workspaceDefaults
    await this.promptLibrary.ensureSeeded()
    if (this.cachedDefaults?.revision === this.promptLibrary.currentRevision) {
      return this.cachedDefaults.defaults
    }
    const prompts = new NodePromptResourceAdapter(this.promptPackageRoot, this.promptLibrary)
    const [
      worldRulesOverview,
      baseRules,
      contentHandling,
      webnovelProseLogic,
      plotSynopsisGuide,
      userToSynopsisGuide,
      synopsisToOutlineGuide,
      outlineToDraftGuide,
      settingsQueryGuide,
      settingsRevisionGuide,
      discussCreationDeskWorkflow,
    ] = await Promise.all([
      prompts.loadWorldRulesOverview(),
      prompts.loadBaseRules(),
      prompts.loadContentHandling(),
      prompts.loadWebnovelProseLogic(),
      prompts.loadPlotSynopsisGuide(),
      prompts.loadUserToSynopsisGuide(),
      prompts.loadSynopsisToOutlineGuide(),
      prompts.loadOutlineToDraftGuide(),
      prompts.loadSettingsQueryGuide(),
      prompts.loadSettingsRevisionGuide(),
      prompts.loadDiscussCreationDeskWorkflow(),
    ])
    const readSeed = (name: string) => readBundledPromptMarkdown(`resources/v1/workspace/${name}.md`, this.promptPackageRoot)
    const [
      agentMemoryIndex,
      settingsReadme,
      referencesReadme,
      descriptionRules,
      proseStyleRules,
      stagingReadme,
      stagingNotes,
      stagingCharacters,
      stagingWorld,
      stagingPromoteIndex,
    ] = await Promise.all([
      readSeed("agent-memory-index"),
      readSeed("settings-index"),
      readSeed("reference-index"),
      readSeed("description-placeholder"),
      readSeed("prose-placeholder"),
      readSeed("staging-index"),
      readSeed("staging-notes"),
      readSeed("staging-characters"),
      readSeed("staging-world"),
      readSeed("staging-promotion"),
    ])
    const defaults: WorkspaceDefaultDocuments = {
      worldRulesOverview: worldRulesOverview.text,
      baseRules: baseRules.text,
      contentHandling: contentHandling.text,
      webnovelProseLogic: webnovelProseLogic.text,
      plotSynopsisGuide: plotSynopsisGuide.text,
      userToSynopsisGuide: userToSynopsisGuide.text,
      synopsisToOutlineGuide: synopsisToOutlineGuide.text,
      outlineToDraftGuide: outlineToDraftGuide.text,
      settingsQueryGuide: settingsQueryGuide.text,
      settingsRevisionGuide: settingsRevisionGuide.text,
      discussCreationDeskWorkflow: discussCreationDeskWorkflow.text,
      agentMemoryIndex,
      settingsReadme,
      referencesReadme,
      descriptionRules,
      proseStyleRules,
      stagingReadme,
      stagingNotes,
      stagingCharacters,
      stagingWorld,
      stagingPromoteIndex,
      promptLibraryFiles: await this.promptLibrary.buildWorkspaceMirrorFiles(),
    }
    this.cachedDefaults = { revision: this.promptLibrary.currentRevision, defaults }
    return defaults
  }
}
