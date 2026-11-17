import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  emptyFolioUiState,
  folioActionSchema,
  folioUiStateSchema,
} from "@starseafolio/contracts"
import { FolioWorkspace } from "../src/application/folio/folio-workspace.js"
import { FolioSkillRunner } from "../src/application/folio/folio-skill-runner.js"

describe("folio protocol", () => {
  it("rejects an invalid ui-state payload", () => {
    expect(() => folioUiStateSchema.parse({ schemaVersion: 2 })).toThrow()
  })

  it("round-trips host, ui-state, and actions on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-proto-"))
    try {
      const folio = new FolioWorkspace(root)
      await folio.writeHost({ host: "starseafolio", workspaceRoot: root, skillId: "starsea-writing" })
      const state = emptyFolioUiState()
      await folio.writeUiState(state)
      const loaded = await folio.readUiState()
      expect(loaded.schemaVersion).toBe(1)
      expect(loaded.panels.creationDesk.status).toBe("idle")

      const action = folioActionSchema.parse({
        actionId: randomUUID(),
        name: "creationDesk.send",
        createdAtMs: Date.now(),
        input: { text: "hello" },
      })
      await folio.enqueueAction(action)
      const claimed = await folio.claimNextAction()
      expect(claimed).toMatchObject({ name: "creationDesk.send", input: { text: "hello" } })
      expect(await folio.claimNextAction()).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("runs skill scripts for send and publish stubs without app orchestration", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-runner-"))
    try {
      const runner = new FolioSkillRunner({ workspaceRoot: root })
      await runner.initialize("codex")
      await runner.enqueue({
        actionId: randomUUID(),
        name: "creationDesk.send",
        createdAtMs: Date.now(),
        input: { text: "开书：雨夜旧站台" },
      })
      const afterSend = await runner.drainOnce()
      expect(afterSend.panels.creationDesk.messages.some((message) => message.role === "user")).toBe(true)

      await runner.enqueue({
        actionId: randomUUID(),
        name: "publish.confirm",
        createdAtMs: Date.now(),
        input: { text: "草稿可以，发布正文" },
      })
      const afterPublish = await runner.drainOnce()
      expect(afterPublish.panels.chapter.publishStatus).toBe("published")
      expect(afterPublish.run.status).toBe("completed")
      const marker = await readFile(join(root, "设定集", ".starsea-writing-settings-write.json"), "utf8")
      expect(marker).toContain("\"stub\": true")
      const chapter = await readFile(join(root, "章节正文", "第一章（starsea-writing-stub）.md"), "utf8")
      expect(chapter).toContain("chapter-publish stub")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)

  it("continues a failed graph stage via skill script without rerunning from host code", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-graph-"))
    try {
      const runner = new FolioSkillRunner({ workspaceRoot: root })
      await runner.initialize("codex")
      await expect(runner.runScript("graph-sync.mjs", ["--fail-at", "frontier_settlement"])).rejects.toThrow()
      const failed = await new FolioWorkspace(root).readUiState()
      expect(failed.panels.graphRevision.tasks[0]).toMatchObject({
        status: "failed",
        canContinue: true,
        canRetry: true,
      })
      await runner.runScript("graph-continue.mjs")
      const continued = await new FolioWorkspace(root).readUiState()
      expect(continued.panels.graphRevision.tasks[0]?.status).toBe("running")
      expect(continued.panels.graphRevision.tasks[0]?.progress.phases.some((phase) => (
        phase.phase === "frontier_settlement" && phase.status === "running"
      ))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})
