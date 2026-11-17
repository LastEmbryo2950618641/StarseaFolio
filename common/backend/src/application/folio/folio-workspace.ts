import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
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

/** Serialize ui-state writes across FolioWorkspace instances for the same root (Windows EPERM). */
const uiStateWriteGates = new Map<string, Promise<unknown>>()

async function withUiStateWriteGate<T>(workspaceRoot: string, run: () => Promise<T>): Promise<T> {
  const key = resolve(workspaceRoot)
  const previous = uiStateWriteGates.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const chained = previous.catch(() => undefined).then(() => gate)
  uiStateWriteGates.set(key, chained)
  await previous.catch(() => undefined)
  try {
    return await run()
  } finally {
    release()
    if (uiStateWriteGates.get(key) === chained) uiStateWriteGates.delete(key)
  }
}

export class FolioWorkspace {
  public constructor(public readonly workspaceRoot: string) {}

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
    const path = join(folioDir(this.workspaceRoot), "ui-state.json")
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const raw = await readFile(path, "utf8")
        if (raw.trim().length === 0) throw new Error("empty ui-state")
        return folioUiStateSchema.parse(JSON.parse(raw))
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
      }
    }
    const fallback = emptyFolioUiState()
    await writeFile(path, `${JSON.stringify(fallback, null, 2)}\n`, "utf8")
    return fallback
  }

  public async writeUiState(state: FolioUiState): Promise<FolioUiState> {
    return withUiStateWriteGate(this.workspaceRoot, async () => {
      await this.ensureLayout()
      const next = folioUiStateSchema.parse({ ...state, updatedAtMs: Date.now() })
      const target = join(folioDir(this.workspaceRoot), "ui-state.json")
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      // Write temp then replace: avoids readers seeing a truncated mid-write file.
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8")
      try {
        await rename(temp, target)
      } catch {
        await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8")
        await rm(temp, { force: true }).catch(() => undefined)
      }
      return next
    })
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
    const donePath = join(folioDir(this.workspaceRoot), "actions", "done", `${action.actionId}.json`)
    try {
      await rename(path, donePath)
    } catch {
      // Another drain claimed it; treat as empty.
      return undefined
    }
    return action
  }

  /** Persist a stage artifact under `.folio/runs/` for later host stages (e.g. settings-write → graph-sync). */
  public async writeRunArtifact(name: string, value: unknown): Promise<string> {
    await this.ensureLayout()
    const path = join(folioDir(this.workspaceRoot), "runs", name)
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    return path
  }

  public async readRunArtifact(name: string): Promise<unknown | undefined> {
    try {
      const raw = await readFile(join(folioDir(this.workspaceRoot), "runs", name), "utf8")
      if (raw.trim().length === 0) return undefined
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }
}

export function settingsExtractionRunArtifactName(revisionTaskId: string): string {
  return `settings-extraction-${revisionTaskId}.json`
}
