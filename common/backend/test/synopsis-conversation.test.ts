import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"

import { PROTOCOL_VERSION, type ProjectSettings } from "@worldseed/contracts"

import {
  isExplicitWholeVolumePlanningRequest,
  partitionVolumeChapterPlansBySequence,
} from "../src/application/chapters/synopsis-conversation-service.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import type { AIModelPort } from "../src/application/turns/ports/ai-model-port.js"
import { digest } from "../src/core/identity/digest.js"
import {
  openChapterHarness,
  prepareChapterPlanning,
  seedCommittedChapter,
  waitForTask,
  type ChapterHarness,
} from "./helpers/chapter-coordination-harness.js"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function withHarness(run: (harness: ChapterHarness) => Promise<void>): Promise<void> {
  const harness = await openChapterHarness("Synopsis Conversation Test")
  temporaryRoots.push(harness.root)
  try {
    await run(harness)
  } finally {
    await harness.container.close()
  }
}

async function invoke<T>(harness: ChapterHarness, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload,
  })
  if (!response.ok) expect.fail(JSON.stringify(response.error))
  return response.data as T
}

describe("synopsis conversation", () => {
  it("defers later chapter plans during ordinary batch progression", () => {
    const plans = [1, 3, 4].map((chapterSequence) => ({
      chapterSequence,
      synopsisBody: `第${chapterSequence}章梗概`,
      outlineBody: `第${chapterSequence}章细纲`,
    }))

    const result = partitionVolumeChapterPlansBySequence(plans, 1, false)

    expect(result.allowed.map((plan) => plan.chapterSequence)).toEqual([1])
    expect(result.deferred.map((plan) => plan.chapterSequence)).toEqual([3, 4])
  })

  it("allows multiple chapter plans only for an explicit whole-volume request", () => {
    const plans = [1, 3, 4].map((chapterSequence) => ({
      chapterSequence,
      synopsisBody: `第${chapterSequence}章梗概`,
      outlineBody: `第${chapterSequence}章细纲`,
    }))

    const result = partitionVolumeChapterPlansBySequence(plans, 1, true)

    expect(result.allowed).toEqual(plans)
    expect(result.deferred).toEqual([])
  })

  it("does not treat a negated volume-planning request as authorization", () => {
    expect(isExplicitWholeVolumePlanningRequest("请做整卷规划")).toBe(true)
    expect(isExplicitWholeVolumePlanningRequest("这次不要卷规划，按章推进")).toBe(false)
  })

  it("starts a session and creates synopsis placeholder markdown", async () => {
    await withHarness(async (harness) => {
      const started = await invoke<{ session: { synopsisPath: string; chapterSequence: number }; messages: unknown[] }>(
        harness,
        "synopsis.conversation.start",
        {
          projectId: harness.projectId,
          workspaceRootRef: harness.workspaceRootRef,
          title: "雾港站的末班车",
        },
      )
      expect(started.messages).toEqual([])
      expect(started.session.synopsisPath).toContain("[剧情梗概].md")
      const file = readFileSync(join(harness.workspaceRootRef, started.session.synopsisPath), "utf8")
      expect(file).toContain("剧情梗概")
    })
  })

  it("tracks synopsis and outline content state independently of file existence", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      const started = await invoke<{
        session: {
          sessionId: string
          synopsisPath: string
          synopsisContentState: string
          outlineContentState: string
          draftContentState: string
        }
      }>(harness, "synopsis.conversation.start", { ...base, title: "状态测试" })
      expect(started.session.synopsisContentState).toBe("empty")
      expect(started.session.outlineContentState).toBe("empty")
      expect(started.session.draftContentState).toBe("empty")

      await invoke(harness, "workspace.save", {
        ...base,
        relativePath: started.session.synopsisPath,
        content: "# 第一章 状态测试 剧情梗概\n\n主角在雨夜做出关键选择。\n",
      })
      const outlinePath = started.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      await invoke(harness, "workspace.save", {
        ...base,
        relativePath: outlinePath,
        content: "# 第一章 状态测试 剧情细纲\n\n## 分场\n- 主角在雨夜做出选择。\n",
      })

      const listed = await invoke<{
        session: {
          synopsisContentState: string
          outlineContentState: string
          draftContentState: string
        }
      }>(harness, "synopsis.conversation.list", base)
      expect(listed.session.synopsisContentState).toBe("manual_modified")
      expect(listed.session.outlineContentState).toBe("manual_modified")
      expect(listed.session.draftContentState).toBe("empty")
    })
  })

  it("does not write an outline when the synopsis is still only a placeholder", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke<{ session: { synopsisPath: string } }>(harness, "synopsis.conversation.start", {
        ...base,
        title: "待命名",
      })

      const sent = await invoke<{
        session: { synopsisPath: string; synopsisConfirmedAtMs?: number }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })

      const outlinePath = sent.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      expect(sent.session.synopsisConfirmedAtMs).toBeUndefined()
      expect(existsSync(join(harness.workspaceRootRef, outlinePath))).toBe(false)
    })
  })

  it("retries a body-writing response that claims success but omits the draft proposal", async () => {
    let finalDiscussResponses = 0
    const model: AIModelPort = {
      info: { provider: "test", model: "scripted", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        synopsisConversationStreamHub.setTodos(request.projectId, [
          { id: "draft-body", content: "生成正文草稿", status: "completed" },
          { id: "verify-draft", content: "核对草稿已入库", status: "completed" },
        ], Date.now())
        const artifact: Record<string, unknown> = finalDiscussResponses === 0
          ? {
              assistantMessage: "正文已经完成并写入草稿。",
              finalSelfReview: "The response omitted the required structured draft.",
            }
          : {
              assistantMessage: "已生成本章正文草稿。",
              finalSelfReview: "The complete chapter draft is included in the structured proposal.",
              chapterDraftProposal: {
                base: "body",
                heading: "第一章 雨夜旧站台",
                body: "雨夜里，旧站台的灯忽然亮起。林烬停下脚步，听见站台另一端传来急促的敲击声。",
              },
            }
        finalDiscussResponses += 1
        return {
          result: {
            schemaVersion: 1,
            envelopeId: request.envelopeId,
            contextId: request.contextId,
            phase: request.phase,
            outcome: "continue",
            artifact,
            requestedReads: [],
            citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [],
            decisionRecordIds: [],
            unresolvedDependencies: [],
            reason: "Scripted response for the draft proposal recovery regression.",
            selfReview: "The response follows the synopsis discussion contract.",
          },
          usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Missing Draft Proposal Recovery", { model })
    temporaryRoots.push(harness.root)
    try {
      const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
      await prepareChapterPlanning(harness)
      const sent = await invoke<{
        appendedDraft?: { revisionTaskId: string; draftVersionId: string }
        session: { chapterSequence: number; draftContentState: string }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "按细纲写正文草稿",
      })
      expect(finalDiscussResponses).toBeGreaterThanOrEqual(2)
      expect(sent.appendedDraft?.revisionTaskId).toBeTruthy()
      expect(sent.appendedDraft?.draftVersionId).toBeTruthy()
      expect(sent.session.draftContentState).toBe("ai_written")

      const listed = await invoke<Array<{ revisionTaskId: string }>>(
        harness,
        "chapter.draft.list",
        base,
      )
      expect(listed.some((draft) => draft.revisionTaskId === sent.appendedDraft?.revisionTaskId)).toBe(true)
    } finally {
      await harness.container.close()
    }
  }, 30_000)

  it("reports that no draft was saved when the one proposal retry also fails", async () => {
    let calls = 0
    const model: AIModelPort = {
      info: { provider: "test", model: "scripted", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        calls += 1
        synopsisConversationStreamHub.setTodos(request.projectId, [
          { id: "draft-body", content: "生成正文草稿", status: "completed" },
          { id: "verify-draft", content: "核对草稿入库", status: "completed" },
        ], Date.now())
        return {
          result: {
            schemaVersion: 1,
            envelopeId: request.envelopeId,
            contextId: request.contextId,
            phase: request.phase,
            outcome: "continue",
            artifact: {
              assistantMessage: "正文已经完成并写入草稿。",
              finalSelfReview: "This response deliberately omits the structured proposal.",
            },
            requestedReads: [],
            citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [],
            decisionRecordIds: [],
            unresolvedDependencies: [],
            reason: "Scripted missing-proposal response.",
            selfReview: "Valid discussion artifact without the requested draft proposal.",
          },
          usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Missing Draft Proposal Notice", { model })
    temporaryRoots.push(harness.root)
    try {
      const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
      await prepareChapterPlanning(harness)
      const sent = await invoke<{
        appendedDraft?: unknown
        session: { draftContentState: string }
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "按细纲写正文草稿",
      })

      expect(calls).toBe(2)
      expect(sent.appendedDraft).toBeUndefined()
      expect(sent.session.draftContentState).toBe("empty")
      expect(sent.messages.at(-1)?.content).toContain("正文没有写入草稿版本")
    } finally {
      await harness.container.close()
    }
  }, 30_000)

  it("retries an explicit synopsis write when the model only claims it was saved", async () => {
    let calls = 0
    const model: AIModelPort = {
      info: { provider: "test", model: "scripted", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        calls += 1
        synopsisConversationStreamHub.setTodos(request.projectId, [
          { id: "write-synopsis", content: "写入本章梗概", status: "completed" },
          { id: "verify-synopsis", content: "确认梗概已保存", status: "completed" },
        ], Date.now())
        const artifact = calls === 1
          ? {
              assistantMessage: "第一章剧情梗概已经写入。",
              finalSelfReview: "The response deliberately omits synopsisBody.",
            }
          : {
              assistantMessage: "已写入第一章剧情梗概。",
              finalSelfReview: "A complete synopsis is included in synopsisBody.",
              chapterTitle: "断电的第一夜",
              synopsisBody: "# 第一章 断电的第一夜 剧情梗概\n\n停电后，林序留守药房，收到妹妹被困医院的短信；他必须在离开前安排可信的人接管药品，否则药品会失守。",
            }
        return {
          result: {
            schemaVersion: 1,
            envelopeId: request.envelopeId,
            contextId: request.contextId,
            phase: request.phase,
            outcome: "continue",
            artifact,
            requestedReads: [],
            citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [],
            decisionRecordIds: [],
            unresolvedDependencies: [],
            reason: "Scripted synopsis artifact response.",
            selfReview: "Valid synopsis discussion result.",
          },
          usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Missing Synopsis Artifact Recovery", { model })
    temporaryRoots.push(harness.root)
    try {
      const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
      const sent = await invoke<{
        session: { synopsisPath: string; synopsisContentState: string }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "先完成剧情梗概",
        batchProceed: false,
      })

      expect(calls).toBe(2)
      expect(sent.session.synopsisContentState).toBe("ai_written")
      expect(readFileSync(join(harness.workspaceRootRef, sent.session.synopsisPath), "utf8"))
        .toContain("停电后，林序留守药房")
    } finally {
      await harness.container.close()
    }
  }, 30_000)

  it("retries an explicit outline write when the model only claims it was saved", async () => {
    let calls = 0
    const model: AIModelPort = {
      info: { provider: "test", model: "scripted", available: true, contextWindowTokens: 64_000 },
      async execute(request) {
        calls += 1
        synopsisConversationStreamHub.setTodos(request.projectId, [
          { id: "write-outline", content: "写入本章剧情细纲", status: "completed" },
          { id: "verify-outline", content: "核对细纲已保存", status: "completed" },
        ], Date.now())
        const artifact = calls === 1
          ? {
              assistantMessage: "第一章细纲已经写入。",
              finalSelfReview: "The response deliberately omits outlineBody.",
            }
          : {
              assistantMessage: "已写入第一章剧情细纲。",
              finalSelfReview: "A complete outline is included in outlineBody.",
              outlineBody: "# 第一章 断电的第一夜 剧情细纲\n\n## 章定位\n林序必须决定是否离开药房救妹妹。\n\n## 分场\n1. 停电后收到求救短信。\n2. 安排药房交接并冒雨出发。\n",
            }
        return {
          result: {
            schemaVersion: 1,
            envelopeId: request.envelopeId,
            contextId: request.contextId,
            phase: request.phase,
            outcome: "continue",
            artifact,
            requestedReads: [],
            citedReadIds: [...request.committedReadIds],
            producedArtifactIds: [],
            decisionRecordIds: [],
            unresolvedDependencies: [],
            reason: "Scripted outline artifact response.",
            selfReview: "Valid outline discussion result.",
          },
          usage: { inputTokens: 100, outputTokens: 100, latencyMs: 0, modelCalls: 1 },
        }
      },
    }
    const harness = await openChapterHarness("Missing Outline Artifact Recovery", { model })
    temporaryRoots.push(harness.root)
    try {
      const base = { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef }
      const started = await invoke<{ session: { synopsisPath: string } }>(harness, "synopsis.conversation.start", base)
      const synopsis = "# 第一章 断电的第一夜 剧情梗概\n\n停电后，林序收到妹妹被困医院的短信，必须安排药房交接后赶去救援。\n"
      await invoke(harness, "workspace.save", {
        ...base,
        relativePath: started.session.synopsisPath,
        content: synopsis,
      })
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        database.prepare(`
          update synopsis_conversation_sessions
          set synopsis_confirmed_at_ms = ?, last_agent_digest = ?
          where project_id = ? and chapter_sequence = 1
        `).run(Date.now(), digest(synopsis), harness.projectId)
      } finally {
        database.close()
      }

      const sent = await invoke<{ session: { synopsisPath: string } }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })

      expect(calls).toBe(2)
      const outlinePath = sent.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      expect(readFileSync(join(harness.workspaceRootRef, outlinePath), "utf8")).toContain("药房交接并冒雨出发")
    } finally {
      await harness.container.close()
    }
  }, 30_000)

  it("clears a stale synopsis confirmation before allowing outline writes", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", { ...base, title: "待命名" })
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      try {
        database.prepare(`
          update synopsis_conversation_sessions
          set synopsis_confirmed_at_ms = ?
          where project_id = ? and chapter_sequence = 1
        `).run(Date.now(), harness.projectId)
      } finally {
        database.close()
      }

      const sent = await invoke<{
        session: { synopsisPath: string; synopsisConfirmedAtMs?: number }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "用这份梗概写细纲",
      })

      const outlinePath = sent.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      expect(sent.session.synopsisConfirmedAtMs).toBeUndefined()
      expect(existsSync(join(harness.workspaceRootRef, outlinePath))).toBe(false)
    })
  })

  it("persists messages and renames synopsis file when agent sets chapter title", async () => {
    await withHarness(async (harness) => {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      const sent = await invoke<{
        session: { synopsisPath: string; title: string }
        messages: Array<{ role: string; content: string; choices?: unknown[] }>
      }>(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      expect(sent.session.synopsisPath).toBe("章节正文/第一卷 待命名/第一章 世界种子 [剧情梗概].md")
      expect(sent.session.title).toBe("世界种子")
      expect(sent.messages.filter((message) => message.role === "assistant")).toHaveLength(1)
      const file = readFileSync(join(harness.workspaceRootRef, sent.session.synopsisPath), "utf8")
      expect(file).toContain("雨夜站台")
    })
  })

  it("persists messages and overwrites synopsis file on send", async () => {
    await withHarness(async (harness) => {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        title: "开端",
      })
      const sent = await invoke<{
        session: { synopsisPath: string }
        messages: Array<{ role: string; content: string; choices?: unknown[] }>
      }>(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      expect(sent.messages.filter((message) => message.role === "user")).toHaveLength(1)
      expect(sent.messages.filter((message) => message.role === "assistant")).toHaveLength(1)
      expect(sent.messages[1]?.choices?.length ?? 0).toBeGreaterThan(0)
      const file = readFileSync(join(harness.workspaceRootRef, sent.session.synopsisPath), "utf8")
      expect(file).toContain("雨夜站台")
    })
  })

  it("refreshChoices appends hidden context and merges new chips onto the visible message", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      const sent = await invoke<{
        messages: Array<{
          messageId: string
          role: string
          hidden?: boolean
          choices?: Array<{ label: string }>
        }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "这一章从雨夜站台开始",
      })
      const visibleAssistant = sent.messages.find((message) => message.role === "assistant" && message.hidden !== true)
      expect(visibleAssistant?.choices?.length ?? 0).toBeGreaterThan(0)
      const beforeLabels = new Set((visibleAssistant?.choices ?? []).map((choice) => choice.label))
      const refreshed = await invoke<{
        messages: Array<{
          messageId: string
          role: string
          hidden?: boolean
          choices?: Array<{ label: string }>
        }>
      }>(harness, "synopsis.conversation.refreshChoices", {
        ...base,
        messageId: visibleAssistant!.messageId,
      })
      const hidden = refreshed.messages.filter((message) => message.hidden === true)
      expect(hidden.length).toBeGreaterThanOrEqual(2)
      expect(hidden.some((message) => message.role === "user")).toBe(true)
      expect(hidden.some((message) => message.role === "assistant")).toBe(true)
      const updated = refreshed.messages.find((message) => message.messageId === visibleAssistant!.messageId)
      expect((updated?.choices?.length ?? 0)).toBeGreaterThanOrEqual(beforeLabels.size)
      const visibleCount = refreshed.messages.filter((message) => message.hidden !== true).length
      expect(visibleCount).toBe(2)
    })
  })

  it("persists agent goal proposals from synopsis send without applying them", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      const settings = await invoke<ProjectSettings>(harness, "project.settings.read", base)
      await invoke(harness, "project.settings.save", {
        ...base,
        settings: {
          ...settings,
          creationDesk: { ...settings.creationDesk, autoApproveGoalProposals: false },
        },
      })
      await invoke(harness, "synopsis.conversation.start", base)
      const created = await invoke<{ goals: Array<{ goalId: string }> }>(harness, "deduction.goals.create", {
        ...base,
        content: "林序查清雾港站夜班名单来源",
      })
      const goalId = created.goals[0]!.goalId
      const sent = await invoke<{
        pendingProposals?: Array<{ kind: string; payload: { kind: string; goalId?: string } }>
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "这一章从雨夜站台开始，林序要拿到登记簿",
      })
      expect(sent.pendingProposals?.length ?? 0).toBeGreaterThan(0)
      expect(sent.pendingProposals?.[0]?.kind).toBe("set_chapter_progress")
      expect(sent.pendingProposals?.[0]?.payload.goalId).toBe(goalId)

      const snapshot = await invoke<{
        goals: unknown[]
        progress: unknown[]
        pendingProposals: unknown[]
      }>(harness, "deduction.goals.list", base)
      expect(snapshot.goals).toHaveLength(1)
      expect(snapshot.progress).toHaveLength(0)
      expect(snapshot.pendingProposals.length).toBeGreaterThan(0)
    })
  })

  it("resolves turn input from synopsis file before conversation", async () => {
    await withHarness(async (harness) => {
      const started = await invoke<{ session: { sessionId: string; synopsisPath: string } }>(
        harness,
        "synopsis.conversation.start",
        { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      )
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "先讨论一下",
      })
      const resolved = await invoke<{
        userInput: string
        source: string
        deductionGoalBundle?: { activeGoals: unknown[] }
        reconcile?: { warnings: unknown[]; blocking: unknown[] }
      }>(
        harness,
        "synopsis.conversation.resolveTurnInput",
        {
          projectId: harness.projectId,
          workspaceRootRef: harness.workspaceRootRef,
          sessionId: started.session.sessionId,
        },
      )
      expect(resolved.source).toBe("synopsis_file")
      expect(resolved.userInput.length).toBeGreaterThan(0)
      expect(resolved.deductionGoalBundle).toBeDefined()
      expect(resolved.reconcile).toBeDefined()
    })
  })

  it("beginTurn starts a draft turn without locking planned progress", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      await invoke(harness, "synopsis.conversation.send", {
        ...base,
        message: "雨夜站台，林序追查名单",
      })
      const created = await invoke<{ goals: Array<{ goalId: string }> }>(harness, "deduction.goals.create", {
        ...base,
        content: "林序查清雾港站夜班名单来源",
      })
      const goalId = created.goals[0]!.goalId
      await invoke(harness, "deduction.goals.progress.set", {
        ...base,
        goalId,
        chapterSequence: 1,
        summary: "获得登记簿副本",
        status: "planned",
      })

      const begun = await invoke<{ taskId: string }>(harness, "synopsis.conversation.beginTurn", {
        ...base,
        acknowledgeWarnings: true,
      })
      expect(begun.taskId).toMatch(/^[0-9a-f-]{36}$/iu)

      const snapshot = await invoke<{
        progress: Array<{ goalId: string; lockedAtMs?: number; summary: string; status: string }>
      }>(harness, "deduction.goals.list", base)
      const planned = snapshot.progress.find((item) => item.goalId === goalId)
      expect(planned?.summary).toBe("获得登记簿副本")
      expect(planned?.status).toBe("planned")
      expect(planned?.lockedAtMs).toBeUndefined()

      await waitForTask(harness.facade, begun.taskId)
      const completed = await invoke<typeof snapshot>(harness, "deduction.goals.list", base)
      expect(completed.progress.find((item) => item.goalId === goalId)).toEqual(planned)
      expect(await invoke(harness, "chapter.list", base)).toEqual([])
    })
  })

  it("updates unlocked planned progress as the user after a draft turn completes", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", base)
      await invoke(harness, "synopsis.conversation.send", {
        ...base,
        message: "雨夜站台，林序追查名单",
      })
      const created = await invoke<{ goals: Array<{ goalId: string }> }>(harness, "deduction.goals.create", {
        ...base,
        content: "林序查清雾港站夜班名单来源",
      })
      const goalId = created.goals[0]!.goalId
      await invoke(harness, "deduction.goals.progress.set", {
        ...base,
        goalId,
        chapterSequence: 1,
        summary: "获得登记簿副本",
        status: "planned",
      })

      const begun = await invoke<{ taskId: string }>(harness, "synopsis.conversation.beginTurn", {
        ...base,
        acknowledgeWarnings: true,
      })
      await waitForTask(harness.facade, begun.taskId)

      const reviewed = await invoke<{
        progress: Array<{ goalId: string; status: string; source: string; lockedAtMs?: number }>
      }>(harness, "deduction.goals.progress.set", {
        ...base,
        goalId,
        chapterSequence: 1,
        summary: "获得登记簿副本",
        status: "achieved",
      })
      const current = reviewed.progress.find((item) => item.goalId === goalId && item.status !== "superseded")
      expect(current?.status).toBe("achieved")
      expect(current?.source).toBe("user")
      expect(current?.lockedAtMs).toBeUndefined()
    })
  })

  it("beginTurn blocks when synopsis clearly conflicts with locked goal progress", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", {
        ...base,
        title: "无关天气",
      })
      // Overwrite synopsis with content that shares no tokens with the goal constraint.
      const listed = await invoke<{ session: { synopsisPath: string } }>(harness, "synopsis.conversation.list", base)
      await invoke(harness, "workspace.save", {
        ...base,
        relativePath: listed.session.synopsisPath,
        content: "# 第一章 无关天气 剧情梗概\n\n只写晴空与海鸥，完全不提人物行动。\n",
      })
      const created = await invoke<{ goals: Array<{ goalId: string }> }>(harness, "deduction.goals.create", {
        ...base,
        content: "林序查清雾港站夜班名单来源",
      })
      await invoke(harness, "deduction.goals.progress.set", {
        ...base,
        goalId: created.goals[0]!.goalId,
        chapterSequence: 1,
        summary: "禁止出现名单追查",
        status: "planned",
      })

      const response = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION,
        requestId: randomUUID(),
        method: "synopsis.conversation.beginTurn",
        payload: base,
      })
      expect(response.ok).toBe(false)
      if (response.ok) return
      expect(response.error.message).toContain("冲突")
    })
  })

  it("batch_chapter automation auto-confirms synopsis and allows outline in the same turn", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      await invoke(harness, "synopsis.conversation.start", {
        ...base,
        title: "批量开端",
      })
      const sent = await invoke<{
        session: { synopsisPath: string; synopsisConfirmedAtMs?: number }
      }>(harness, "synopsis.conversation.send", {
        ...base,
        message: "【批量推演】请完成本章梗概与细纲",
        automation: "batch_chapter",
      })
      expect(sent.session.synopsisConfirmedAtMs).toBeTypeOf("number")
      const outlinePath = sent.session.synopsisPath.replace("[剧情梗概].md", "[剧情细纲].md")
      const outline = readFileSync(join(harness.workspaceRootRef, outlinePath), "utf8")
      expect(outline.length).toBeGreaterThan(40)
      expect(outline).toContain("剧情细纲")
    })
  })

  it("beginTurn blocks incomplete foreshadow schedules when requireCompleteHookSchedules is on", async () => {
    await withHarness(async (harness) => {
      const base = {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      }
      const settings = await invoke<ProjectSettings>(harness, "project.settings.read", base)
      await invoke(harness, "project.settings.save", {
        ...base,
        settings: {
          ...settings,
          creationDesk: { ...settings.creationDesk, requireCompleteHookSchedules: false },
        },
      })
      await invoke(harness, "synopsis.conversation.start", {
        ...base,
        title: "码头对峙",
      })
      const created = await invoke<{ goals: Array<{ goalId: string }> }>(harness, "deduction.goals.create", {
        ...base,
        content: "雨夜信使未归",
        narrativeKind: "foreshadow",
        scale: "long",
        plantChapterSequence: 1,
      })
      await invoke(harness, "project.settings.save", {
        ...base,
        settings: {
          ...settings,
          creationDesk: { ...settings.creationDesk, requireCompleteHookSchedules: true },
        },
      })

      const blocked = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION,
        requestId: randomUUID(),
        method: "synopsis.conversation.beginTurn",
        payload: base,
      })
      expect(blocked.ok).toBe(false)
      if (blocked.ok) return
      expect(blocked.error.message).toContain("推演清单")
      expect(blocked.error.message).toContain("钩子时限不完整")

      await invoke(harness, "deduction.goals.update", {
        ...base,
        goalId: created.goals[0]!.goalId,
        action: "update_content",
        payoffChapterSequence: 3,
      })
      const begun = await invoke<{ taskId: string }>(harness, "synopsis.conversation.beginTurn", base)
      expect(begun.taskId.length).toBeGreaterThan(0)
    })
  })

  it("runs a request_read round before finalizing synopsis discuss", async () => {
    await withHarness(async (harness) => {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      const sent = await invoke<{
        messages: Array<{
          role: string
          content: string
          searching?: Array<{ query: string; status: string }>
        }>
      }>(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      const assistant = sent.messages.find((message) => message.role === "assistant")
      expect(assistant?.content).toContain("设定集索引")
      expect(assistant?.searching?.some((item) => (
        item.query.includes("reference") || item.query.includes("设定集")
      ))).toBe(true)
    })
  }, 20_000)

  it("setFocus changes chapter after publication without creating a new session", async () => {
    await withHarness(async (harness) => {
      // Match the volume used by the fake model when seeding the published chapter.
      mkdirSync(join(harness.workspaceRootRef, "章节正文/第一卷 世界种子"), { recursive: true })
      const started = await invoke<{ session: { sessionId: string; chapterSequence: number } }>(
        harness,
        "synopsis.conversation.start",
        {
          projectId: harness.projectId,
          workspaceRootRef: harness.workspaceRootRef,
        },
      )
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      await seedCommittedChapter(harness)
      const focused = await invoke<{
        session: { sessionId: string; chapterSequence: number; focusKind: string }
        messages: Array<{ role: string; content: string }>
      }>(harness, "synopsis.conversation.setFocus", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        chapterSequence: 2,
      })
      expect(focused.session.sessionId).toBe(started.session.sessionId)
      expect(focused.session.chapterSequence).toBe(2)
      expect(focused.session.focusKind).toBe("plot_synopsis")
      expect(focused.messages.some((message) => message.role === "user" && message.content.includes("雨夜站台"))).toBe(true)

      const kinded = await invoke<{
        session: { sessionId: string; chapterSequence: number; focusKind: string }
      }>(harness, "synopsis.conversation.setFocus", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        chapterSequence: 2,
        focusKind: "plot_outline",
      })
      expect(kinded.session.sessionId).toBe(started.session.sessionId)
      expect(kinded.session.chapterSequence).toBe(2)
      expect(kinded.session.focusKind).toBe("plot_outline")

      const sent = await invoke<{
        session: { sessionId: string; chapterSequence: number }
        messages: Array<{ role: string }>
      }>(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "下一章改从港口开始",
      })
      expect(sent.session.sessionId).toBe(started.session.sessionId)
      expect(sent.session.chapterSequence).toBe(2)
      expect(sent.messages.filter((message) => message.role === "user")).toHaveLength(2)
    })
  }, 20_000)
})
