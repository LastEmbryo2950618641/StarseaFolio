import { spawn } from "node:child_process"
import { pathToFileURL, fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { FolioAction, FolioUiState } from "@starseafolio/contracts"
import type { FolioRuntimeActionHandlers } from "./folio-action-host.js"
import { FolioWorkspace } from "./folio-workspace.js"

const defaultScriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/prompt-contracts/resources/skills/starsea-writing/scripts",
)

export type FolioSkillRunnerDependencies = Readonly<{
  workspaceRoot: string
  scriptsDir?: string
  folio?: FolioWorkspace
  /** When set, StarseaFolio / Codex host runtime executes real publish/graph work. */
  hostHandlers?: FolioRuntimeActionHandlers
  /**
   * Allow offline `scripts/*.mjs` stubs when hostHandlers are absent.
   * Production Codex/StarseaFolio must use hostHandlers (folio-run); stubs are protocol tests only.
   */
  allowOfflineStubs?: boolean
}>

/**
 * Thin host runner: claims Folio actions and dispatches into skill-pack scripts.
 * With hostHandlers, `hosted-dispatch.mjs` owns the flow and calls host capabilities.
 * Without handlers, offline stubs require allowOfflineStubs.
 */
export class FolioSkillRunner {
  private readonly folio: FolioWorkspace
  private readonly scriptsDir: string
  private readonly hostHandlers: FolioRuntimeActionHandlers | undefined
  private readonly allowOfflineStubs: boolean

  public constructor(private readonly dependencies: FolioSkillRunnerDependencies) {
    this.folio = dependencies.folio ?? new FolioWorkspace(dependencies.workspaceRoot)
    this.scriptsDir = dependencies.scriptsDir ?? defaultScriptsDir
    this.hostHandlers = dependencies.hostHandlers
    this.allowOfflineStubs = dependencies.allowOfflineStubs === true
  }

  public async initialize(host: "starseafolio" | "codex" | "claude"): Promise<FolioUiState> {
    await this.folio.ensureLayout()
    await this.folio.writeHost({
      host,
      workspaceRoot: this.dependencies.workspaceRoot,
      skillId: "starsea-writing",
    })
    if (this.hostHandlers === undefined) {
      await this.runScript("folio-init.mjs", ["--host", host])
    }
    if (this.hostHandlers !== undefined) {
      const { syncGraphTasksIntoUiState } = await import("./folio-action-host.js")
      await syncGraphTasksIntoUiState(this.folio, await this.hostHandlers.listGraphTasks())
    }
    return this.folio.readUiState()
  }

  public async enqueue(action: FolioAction): Promise<void> {
    await this.folio.enqueueAction(action)
  }

  public async drainOnce(): Promise<FolioUiState> {
    const action = await this.folio.claimNextAction()
    if (action === undefined) return this.folio.readUiState()
    if (this.hostHandlers !== undefined) {
      return this.dispatchHostedAction(action, this.hostHandlers)
    }
    if (!this.allowOfflineStubs) {
      throw new Error(
        `Folio action ${action.name} 需要 ProjectRuntime hostHandlers（folio-run / 星海余页）。离线 stub 仅用于协议自测（allowOfflineStubs）。`,
      )
    }
    const donePath = join(
      this.dependencies.workspaceRoot,
      ".folio",
      "actions",
      "done",
      `${action.actionId}.json`,
    )
    await this.runScript("apply-action.mjs", ["--action", donePath])
    if (action.name === "publish.confirm") {
      await this.runScript("settings-write.mjs")
      await this.runScript("graph-sync.mjs")
      await this.runScript("chapter-publish.mjs")
    }
    return this.folio.readUiState()
  }

  /** Skill-pack hosted-dispatch.mjs owns action routing; hostHandlers supply real disk/model work. */
  public async dispatchHostedAction(
    action: FolioAction,
    handlers: FolioRuntimeActionHandlers,
  ): Promise<FolioUiState> {
    const moduleUrl = pathToFileURL(join(this.scriptsDir, "hosted-dispatch.mjs")).href
    const hosted = await import(moduleUrl) as {
      executeHostedAction: (
        folio: {
          readUiState: () => Promise<FolioUiState>
          writeUiState: (state: FolioUiState) => Promise<FolioUiState>
        },
        action: FolioAction,
        handlers: FolioRuntimeActionHandlers,
      ) => Promise<FolioUiState>
    }
    return hosted.executeHostedAction(
      {
        readUiState: () => this.folio.readUiState(),
        writeUiState: (state) => this.folio.writeUiState(state),
      },
      action,
      handlers,
    )
  }

  public async runScript(scriptName: string, extraArgs: readonly string[] = []): Promise<string> {
    const scriptPath = join(this.scriptsDir, scriptName)
    const args = [scriptPath, "--workspace", this.dependencies.workspaceRoot, ...extraArgs]
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: this.scriptsDir,
        env: {
          ...process.env,
          ...(this.allowOfflineStubs ? { STARSEA_FOLIO_ALLOW_STUB: "1" } : {}),
        },
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8") })
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${scriptName} exited ${String(code)}: ${stderr || stdout}`))
      })
    })
  }
}
