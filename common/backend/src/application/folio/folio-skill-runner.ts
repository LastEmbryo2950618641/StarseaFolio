import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { FolioAction, FolioUiState } from "@starseafolio/contracts"
import { FolioWorkspace } from "./folio-workspace.js"

const defaultScriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/prompt-contracts/resources/skills/starsea-writing/scripts",
)

export type FolioSkillRunnerDependencies = Readonly<{
  workspaceRoot: string
  scriptsDir?: string
  folio?: FolioWorkspace
}>

/**
 * Thin host runner: enqueue/claim Folio actions and invoke skill scripts.
 * Business prompts and disk writes live in the skill pack, not here.
 */
export class FolioSkillRunner {
  private readonly folio: FolioWorkspace
  private readonly scriptsDir: string

  public constructor(private readonly dependencies: FolioSkillRunnerDependencies) {
    this.folio = dependencies.folio ?? new FolioWorkspace(dependencies.workspaceRoot)
    this.scriptsDir = dependencies.scriptsDir ?? defaultScriptsDir
  }

  public async initialize(host: "starseafolio" | "codex" | "claude"): Promise<FolioUiState> {
    await this.folio.ensureLayout()
    await this.folio.writeHost({
      host,
      workspaceRoot: this.dependencies.workspaceRoot,
      skillId: "starsea-writing",
    })
    await this.runScript("folio-init.mjs", [`--host`, host])
    return this.folio.readUiState()
  }

  public async enqueue(action: FolioAction): Promise<void> {
    await this.folio.enqueueAction(action)
  }

  public async drainOnce(): Promise<FolioUiState> {
    const action = await this.folio.claimNextAction()
    if (action === undefined) return this.folio.readUiState()
    // Re-queue into a temp done-restore path by writing action file for apply-action --action
    // apply-action claims from pending; we already claimed. Pass via stdin file in done/.
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

  public async runScript(scriptName: string, extraArgs: readonly string[] = []): Promise<string> {
    const scriptPath = join(this.scriptsDir, scriptName)
    const args = [scriptPath, "--workspace", this.dependencies.workspaceRoot, ...extraArgs]
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: this.scriptsDir })
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
