import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  emptyFolioUiState,
  folioActionSchema,
  folioHostSchema,
  folioUiStateSchema,
  type FolioAction,
  type FolioHost,
  type FolioUiState,
} from "@starseafolio/contracts"

export function folioDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".folio")
}

export class FolioWorkspace {
  public constructor(private readonly workspaceRoot: string) {}

  public async ensureLayout(): Promise<void> {
    const root = folioDir(this.workspaceRoot)
    await mkdir(join(root, "actions", "done"), { recursive: true })
    await mkdir(join(root, "runs"), { recursive: true })
    const uiPath = join(root, "ui-state.json")
    try {
      await readFile(uiPath, "utf8")
    } catch {
      const initial = emptyFolioUiState()
      await writeFile(uiPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8")
    }
  }

  public async writeHost(host: Omit<FolioHost, "updatedAtMs"> & { updatedAtMs?: number }): Promise<FolioHost> {
    await this.ensureLayout()
    const record = folioHostSchema.parse({
      ...host,
      updatedAtMs: host.updatedAtMs ?? Date.now(),
    })
    await writeFile(join(folioDir(this.workspaceRoot), "host.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8")
    return record
  }

  public async readHost(): Promise<FolioHost | undefined> {
    try {
      const raw = await readFile(join(folioDir(this.workspaceRoot), "host.json"), "utf8")
      return folioHostSchema.parse(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  public async readUiState(): Promise<FolioUiState> {
    await this.ensureLayout()
    const raw = await readFile(join(folioDir(this.workspaceRoot), "ui-state.json"), "utf8")
    return folioUiStateSchema.parse(JSON.parse(raw))
  }

  public async writeUiState(state: FolioUiState): Promise<FolioUiState> {
    await this.ensureLayout()
    const next = folioUiStateSchema.parse({ ...state, updatedAtMs: Date.now() })
    const target = join(folioDir(this.workspaceRoot), "ui-state.json")
    // Unique temp name so concurrent writers never fight over the same pid.tmp path.
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8")
    try {
      await rm(target, { force: true })
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
    return next
  }

  public async enqueueAction(action: FolioAction): Promise<string> {
    await this.ensureLayout()
    const parsed = folioActionSchema.parse(action)
    const path = join(folioDir(this.workspaceRoot), "actions", `${parsed.actionId}.json`)
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
    return path
  }

  public async listPendingActionPaths(): Promise<readonly string[]> {
    await this.ensureLayout()
    const names = await readdir(join(folioDir(this.workspaceRoot), "actions"))
    return names.filter((name) => name.endsWith(".json")).sort()
      .map((name) => join(folioDir(this.workspaceRoot), "actions", name))
  }

  public async claimNextAction(): Promise<FolioAction | undefined> {
    const [path] = await this.listPendingActionPaths()
    if (path === undefined) return undefined
    const raw = await readFile(path, "utf8")
    const action = folioActionSchema.parse(JSON.parse(raw))
    await rename(path, join(folioDir(this.workspaceRoot), "actions", "done", `${action.actionId}.json`))
    return action
  }
}
