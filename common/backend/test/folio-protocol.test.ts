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
      const runner = new FolioSkillRunner({ workspaceRoot: root, allowOfflineStubs: true })
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

  it("executes graph continue through host handlers without stub scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-host-"))
    try {
      let continued = false
      const runner = new FolioSkillRunner({
        workspaceRoot: root,
        hostHandlers: {
          listGraphTasks: async () => [{
            revisionTaskId: "rev-1",
            chapterId: "ch-1",
            heading: "第一章",
            status: continued ? "running" : "failed",
            blocksTurn: true,
            canCancel: true,
            canRetry: true,
            canContinue: !continued,
            updatedAtMs: Date.now(),
            progress: {
              completed: 5,
              total: 7,
              phase: "frontier_settlement",
              phases: [
                { phase: "graph_governance", status: "completed", attempt: 1 },
                { phase: "frontier_settlement", status: continued ? "running" : "failed", attempt: continued ? 2 : 1 },
              ],
            },
          }],
          publishConfirm: async () => ({ ok: true, summary: "ok" }),
          graphCancel: async () => undefined,
          graphRerun: async () => undefined,
          graphContinue: async () => { continued = true },
        },
      })
      await runner.initialize("starseafolio")
      await runner.enqueue({
        actionId: randomUUID(),
        name: "graph.continue",
        createdAtMs: Date.now(),
        input: { revisionTaskId: "rev-1" },
      })
      const state = await runner.drainOnce()
      expect(continued).toBe(true)
      expect(state.panels.graphRevision.tasks[0]?.canContinue).toBe(false)
      expect(state.panels.graphRevision.tasks[0]?.status).toBe("running")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("runs publish.confirm through skill settings-write → graph-sync → chapter-publish stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-publish-stages-"))
    try {
      const stages: string[] = []
      const runner = new FolioSkillRunner({
        workspaceRoot: root,
        hostHandlers: {
          listGraphTasks: async () => [],
          settingsWrite: async () => {
            stages.push("settingsWrite")
            return { ok: true, summary: "reviewed" }
          },
          publishConfirm: async () => {
            stages.push("publishConfirm")
            return { ok: true, summary: "published via skill stages" }
          },
          graphCancel: async () => undefined,
          graphRerun: async () => undefined,
          graphContinue: async () => undefined,
        },
      })
      await runner.initialize("starseafolio")
      await runner.enqueue({
        actionId: randomUUID(),
        name: "publish.confirm",
        createdAtMs: Date.now(),
        input: {
          revisionTaskId: "rev-1",
          draftVersionId: "draft-1",
          chapterSequence: 1,
        },
      })
      const state = await runner.drainOnce()
      expect(stages).toEqual(["settingsWrite", "publishConfirm"])
      expect(state.panels.chapter.publishStatus).toBe("published")
      expect(state.run.phase).toBe("chapter_publish")
      expect(state.panels.creationDesk.messages.at(-1)?.content).toContain("published via skill stages")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("refuses offline publish stubs without allowOfflineStubs or hostHandlers", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-nostub-"))
    try {
      const runner = new FolioSkillRunner({ workspaceRoot: root })
      await runner.initialize("codex")
      await runner.enqueue({
        actionId: randomUUID(),
        name: "publish.confirm",
        createdAtMs: Date.now(),
        input: {},
      })
      await expect(runner.drainOnce()).rejects.toThrow(/hostHandlers|folio-run/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("routes creationDesk.send through host discuss handler into ui-state", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-discuss-"))
    try {
      let called = false
      const runner = new FolioSkillRunner({
        workspaceRoot: root,
        hostHandlers: {
          listGraphTasks: async () => [],
          publishConfirm: async () => ({ ok: true, summary: "ok" }),
          settingsWrite: async () => ({ ok: true, summary: "reviewed" }),
          creationDeskSend: async (action) => {
            called = true
            expect(action.input.message ?? action.input.text).toBe("开书：雨夜旧站台")
            return {
              userText: String(action.input.message ?? action.input.text),
              assistantText: "已记下开书意图。",
            }
          },
          graphCancel: async () => undefined,
          graphRerun: async () => undefined,
          graphContinue: async () => undefined,
        },
      })
      await runner.initialize("starseafolio")
      await runner.enqueue({
        actionId: randomUUID(),
        name: "creationDesk.send",
        createdAtMs: Date.now(),
        input: { message: "开书：雨夜旧站台" },
      })
      const state = await runner.drainOnce()
      expect(called).toBe(true)
      expect(state.panels.creationDesk.messages.map((message) => message.content)).toEqual([
        "开书：雨夜旧站台",
        "已记下开书意图。",
      ])
      expect(state.run.phase).toBe("creation_desk")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("continues a failed graph stage via skill script without rerunning from host code", async () => {
    const root = await mkdtemp(join(tmpdir(), "folio-graph-"))
    try {
      const runner = new FolioSkillRunner({ workspaceRoot: root, allowOfflineStubs: true })
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
