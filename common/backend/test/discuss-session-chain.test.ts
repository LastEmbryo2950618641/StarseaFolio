import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PROTOCOL_VERSION } from "@starseafolio/contracts"
import { afterEach, describe, expect, it } from "vitest"

import {
  collectDiscussReadEvidenceFromContext,
  FakeAiModelAdapter,
  MODEL_CONTEXT_DELTA_HEADER,
  SqliteProjectRepository,
  SqliteSynopsisConversationRepository,
  digest,
  fixedWorkspaceEntries,
  openProjectDatabase,
  type AIModelPort,
  type ModelExecutionOptions,
  type PhaseModelExecution,
  type PhaseRequestEnvelope,
  type ProjectManifest,
} from "../src/index.js"
import { openChapterHarness, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "worldseed-discuss-chain-"))
  temporaryDirectories.push(directory)
  return directory
}

async function createDiscussStoreFixture() {
  const directory = temporaryDirectory()
  const database = await openProjectDatabase(join(directory, "discuss-chain.sqlite"))
  const projectId = "00000000-0000-4000-8000-000000000101"
  const sessionId = "00000000-0000-4000-8000-000000000102"
  const projectRepository = new SqliteProjectRepository(
    database,
    join(directory, "workspace"),
    join(directory, "internal"),
  )
  const manifest: ProjectManifest = {
    id: projectId,
    protocolVersion: "worldseed.v1",
    manifestVersion: 1,
    displayName: "Discuss Chain",
    workspaceRootRef: join(directory, "workspace"),
    fixedEntries: fixedWorkspaceEntries,
    internalStoreRef: join(directory, "internal"),
    manifestDigest: digest(fixedWorkspaceEntries),
  }
  await projectRepository.create({
    projectId,
    name: manifest.displayName,
    manifestVersion: 1,
    committedSequence: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
  }, manifest)
  const conversation = new SqliteSynopsisConversationRepository(database)
  await conversation.createSession({
    sessionId,
    projectId,
    chapterSequence: 1,
    synopsisPath: "章节正文/第一卷 待命名/第一章 测试 [剧情梗概].md",
    title: "测试",
    createdAtMs: 2,
  })
  return { database, projectId, sessionId, conversation }
}

function parseDeltaContent(content: string | undefined): Record<string, unknown> {
  if (content === undefined || !content.startsWith(`${MODEL_CONTEXT_DELTA_HEADER}\n`)) return {}
  return JSON.parse(content.slice(MODEL_CONTEXT_DELTA_HEADER.length + 1)) as Record<string, unknown>
}

class RecordingFakeModel implements AIModelPort {
  public readonly calls: Array<Readonly<{
    turnId: string
    envelopeId: string
    contextKinds: readonly string[]
    systemRules?: string
    contextTurnIds: readonly (string | undefined)[]
    delta: Record<string, unknown>
    evidenceOwnerIds: readonly string[]
    conversationHistory: unknown
    synopsisMarkdown: unknown
  }>> = []

  public constructor(private readonly inner: FakeAiModelAdapter = new FakeAiModelAdapter()) {}

  public get info() {
    return this.inner.info
  }

  public compressContext(input: Parameters<FakeAiModelAdapter["compressContext"]>[0]) {
    return this.inner.compressContext(input)
  }

  public async execute(
    request: PhaseRequestEnvelope,
    options?: ModelExecutionOptions,
  ): Promise<PhaseModelExecution> {
    if (request.phase === "synopsis_discuss") {
      // These tests isolate context deltas; their fake delivers completed work,
      // so seed the required checklist rather than bypassing the production gate.
      synopsisConversationStreamHub.setTodos(request.projectId, [
        { id: "read", content: "读取本章资料", status: "completed" },
        { id: "deliver", content: "交付本章梗概", status: "completed" },
      ], Date.now())
    }
    const execution = await this.inner.execute(request, options)
    const delta = parseDeltaContent(execution.contextExchange?.requestMessages[0]?.content)
    const input = (delta.input ?? {}) as Record<string, unknown>
    const discuss = (input.synopsisDiscuss ?? {}) as Record<string, unknown>
    const evidence = [
      ...asRecords(input.readEvidence),
      ...asRecords(input.presentationEvidence),
    ]
    this.calls.push({
      turnId: request.turnId,
      envelopeId: request.envelopeId,
      contextKinds: (options?.contextMessages ?? []).map((message) => message.kind),
      systemRules: options?.contextMessages?.find((message) => message.kind === "system_rules")?.content,
      contextTurnIds: (options?.contextMessages ?? []).map((message) => message.turnId),
      delta,
      evidenceOwnerIds: evidence.flatMap((item) => (
        typeof item.ownerId === "string" ? [item.ownerId] : []
      )),
      conversationHistory: discuss.conversationHistory,
      synopsisMarkdown: discuss.synopsisMarkdown,
    })
    return execution
  }
}

class ReactThenContinueModel implements AIModelPort {
  public readonly recorder = new RecordingFakeModel()
  private firstDiscussCall = true

  public get info() {
    return this.recorder.info
  }

  public compressContext(input: Parameters<RecordingFakeModel["compressContext"]>[0]) {
    return this.recorder.compressContext(input)
  }

  public async execute(
    request: PhaseRequestEnvelope,
    options?: ModelExecutionOptions,
  ): Promise<PhaseModelExecution> {
    const execution = await this.recorder.execute(request, options)
    if (request.phase !== "synopsis_discuss" || !this.firstDiscussCall) return execution
    this.firstDiscussCall = false
    return {
      ...execution,
      result: {
        ...execution.result,
        outcome: "request_read",
        artifact: undefined,
        requestedReads: [{
          requestId: randomUUID(),
          reason: "Read staging notes after bootstrap evidence is already visible",
          expectedEvidence: "暂存区说明",
          query: {
            exactKeys: ["暂存区/readme.md"],
            semanticTexts: ["暂存区"],
            anchorIds: [],
            directions: ["both"],
            maxCandidates: 2,
            maxDepth: 1,
            sourceKinds: ["reference"],
          },
        }],
      },
    }
  }
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : []
}

async function invoke<T>(
  harness: ChapterHarness,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method,
    payload,
  })
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data as T
}

describe("collectDiscussReadEvidenceFromContext", () => {
  it("collects unique readEvidence objects from JSON discuss context messages", () => {
    const evidence = collectDiscussReadEvidenceFromContext([{
      messageId: "m1",
      sequence: 0,
      role: "assistant",
      kind: "phase_result",
      content: JSON.stringify({
        input: {
          readEvidence: [{
            readId: "evidence_1",
            visibility: "committed",
            ownerKind: "workspace",
            ownerId: "设定集/readme.md",
            exactKeys: ["readme"],
            semanticText: "设定集索引",
            sourceRefs: [],
            digest: "d1",
          }],
        },
      }),
    }, {
      messageId: "m2",
      sequence: 1,
      role: "assistant",
      kind: "phase_result",
      content: JSON.stringify({
        nested: {
          readEvidence: [{
            readId: "evidence_1",
            visibility: "committed",
            ownerKind: "workspace",
            ownerId: "设定集/readme.md",
            exactKeys: ["readme"],
            semanticText: "设定集索引",
            sourceRefs: [],
            digest: "d1",
          }, {
            readId: "evidence_2",
            visibility: "pending",
            ownerKind: "node",
            ownerId: "node_1",
            exactKeys: ["钥匙"],
            semanticText: "旧铜钥匙",
            sourceRefs: [],
            digest: "d2",
          }],
        },
      }),
    }, {
      messageId: "m3",
      sequence: 2,
      role: "user",
      kind: "phase_request",
      content: "not json",
    }])

    expect(evidence.map((item) => item.readId)).toEqual(["evidence_1", "evidence_2"])
  })
})

describe("discuss session chain store", () => {
  it("paginates original messages and limits archive access to the current project and session", async () => {
    const { database, projectId, sessionId, conversation } = await createDiscussStoreFixture()
    const scope = { projectId, sessionId, offset: 0 }
    const body = `夜半来信\n${"甲".repeat(2_394)}𠮷\n照原计划行动。  `
    const userMessageId = randomUUID()
    const hiddenId = randomUUID()
    const deletedId = randomUUID()
    const otherSessionId = randomUUID()
    const otherSessionMessageId = randomUUID()
    try {
      await conversation.appendMessage({
        projectId, sessionId, messageId: userMessageId, role: "user", content: body, createdAtMs: 3,
      })
      for (let index = 0; index < 6; index += 1) {
        await conversation.appendMessage({
          projectId, sessionId, messageId: randomUUID(), role: "assistant",
          content: `已收到来信 ${index}`, createdAtMs: 4 + index,
        })
      }
      await conversation.appendMessage({
        projectId, sessionId, messageId: hiddenId, role: "assistant", content: "隐藏来信", hidden: true, createdAtMs: 11,
      })
      await conversation.appendMessage({
        projectId, sessionId, messageId: deletedId, role: "user", content: "撤下来信", createdAtMs: 12,
      })
      await conversation.deleteLastVisibleUserTurn(sessionId)
      await conversation.updateSession({ sessionId, status: "completed", updatedAtMs: 13 })
      await conversation.createSession({
        projectId, sessionId: otherSessionId, chapterSequence: 2,
        synopsisPath: "章节正文/第一卷 待命名/第二章 测试 [剧情梗概].md", title: "测试", createdAtMs: 14,
      })
      await conversation.appendMessage({
        projectId, sessionId: otherSessionId, messageId: otherSessionMessageId, role: "user", content: "另一会话的来信", createdAtMs: 15,
      })

      const first = await conversation.searchArchivedMessages({ ...scope, query: "来信" })
      expect(first.matches).toHaveLength(6)
      expect(first.nextOffset).toBe(6)
      const next = await conversation.searchArchivedMessages({ ...scope, query: "来信", offset: first.nextOffset! })
      expect(next).toEqual({ matches: [{
        messageId: userMessageId, role: "user", createdAtMs: 3, excerpt: expect.stringContaining("夜半来信"),
      }] })
      const read = await conversation.readArchivedMessage({ ...scope, messageId: userMessageId })
      expect(read).toMatchObject({ content: expect.stringMatching(/𠮷$/u), nextOffset: 2_400 })
      const remainder = await conversation.readArchivedMessage({ ...scope, messageId: userMessageId, offset: read!.nextOffset! })
      expect(read!.content + remainder!.content).toEqual(body)

      const wrongProject = { ...scope, projectId: randomUUID() }
      expect(await conversation.searchArchivedMessages({ ...wrongProject, query: "来信" })).toEqual({ matches: [] })
      expect(await conversation.readArchivedMessage({ ...wrongProject, messageId: userMessageId })).toBeUndefined()
      for (const messageId of [hiddenId, deletedId, otherSessionMessageId]) {
        expect(await conversation.readArchivedMessage({ ...scope, messageId })).toBeUndefined()
      }
    } finally {
      await database.destroy()
    }
  })

  it("stores visible discuss context messages per session without touching model_context_chains", async () => {
    const fixture = await createDiscussStoreFixture()
    await fixture.conversation.appendDiscussContextMessages({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      createdAtMs: 10,
      messages: [{
        role: "system",
        kind: "system_rules",
        content: "创作台讨论规则",
      }, {
        role: "user",
        kind: "phase_request",
        taskId: fixture.sessionId,
        turnId: "00000000-0000-4000-8000-000000000201",
        phase: "synopsis_discuss",
        content: "Worldseed context delta JSON:\n{\"input\":{\"userInput\":\"第一轮\"}}",
      }],
    })

    const visible = await fixture.conversation.listDiscussContextMessages(fixture.sessionId)
    expect(visible).toHaveLength(2)
    expect(visible[0]).toMatchObject({
      chainId: fixture.sessionId,
      role: "system",
      kind: "system_rules",
      sequence: 0,
    })
    expect(visible[1]?.turnId).toBe("00000000-0000-4000-8000-000000000201")

    await fixture.conversation.hideDiscussContextMessages(
      fixture.sessionId,
      [visible[1]?.messageId as string],
      20,
    )
    const afterHide = await fixture.conversation.listDiscussContextMessages(fixture.sessionId)
    expect(afterHide.map((message) => message.kind)).toEqual(["system_rules"])

    const chainCount = await fixture.database.selectFrom("model_context_chains").selectAll().execute()
    const turnMessages = await fixture.database.selectFrom("model_context_messages").selectAll().execute()
    expect(chainCount).toEqual([])
    expect(turnMessages).toEqual([])
    await fixture.database.destroy()
  })

  it("deletes the last send's discuss context messages by turn id", async () => {
    const fixture = await createDiscussStoreFixture()
    const firstTurn = "00000000-0000-4000-8000-000000000301"
    const secondTurn = "00000000-0000-4000-8000-000000000302"
    await fixture.conversation.appendDiscussContextMessages({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      createdAtMs: 10,
      messages: [
        { role: "system", kind: "system_rules", content: "rules" },
        {
          role: "user",
          kind: "phase_request",
          turnId: firstTurn,
          phase: "synopsis_discuss",
          content: "delta-one",
        },
        {
          role: "user",
          kind: "phase_request",
          turnId: secondTurn,
          phase: "synopsis_discuss",
          content: "delta-two",
        },
      ],
    })
    await fixture.conversation.deleteDiscussContextMessagesForTurn(fixture.sessionId, secondTurn)
    const remaining = await fixture.conversation.listDiscussContextMessages(fixture.sessionId)
    expect(remaining.map((message) => message.turnId)).toEqual([undefined, firstTurn])
    await fixture.database.destroy()
  })

  it("keeps the measured input after compaction hides the response that recorded it", async () => {
    const fixture = await createDiscussStoreFixture()
    await fixture.conversation.appendDiscussContextMessages({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      createdAtMs: 10,
      messages: [{ role: "assistant", kind: "phase_response", content: "上一轮回复" }],
    })
    await fixture.conversation.saveDiscussUsage({
      projectId: fixture.projectId,
      usage: { inputTokens: 589_800, outputTokens: 100, lastRequestInputTokens: 589_800 },
      updatedAtMs: 11,
    })
    const visible = await fixture.conversation.listDiscussContextMessages(fixture.sessionId)
    await fixture.conversation.hideDiscussContextMessages(fixture.sessionId, visible.map((message) => message.messageId), 12)
    await expect(fixture.conversation.loadDiscussContextInputTokens(fixture.projectId, fixture.sessionId)).resolves.toBe(589_800)
    await fixture.database.destroy()
  })

  it("lets the active session reuse a completed chapter sequence", async () => {
    const fixture = await createDiscussStoreFixture()
    await fixture.conversation.updateSession({
      sessionId: fixture.sessionId,
      status: "completed",
      updatedAtMs: 3,
    })
    const activeSessionId = "00000000-0000-4000-8000-000000000103"
    await fixture.conversation.createSession({
      sessionId: activeSessionId,
      projectId: fixture.projectId,
      chapterSequence: 2,
      synopsisPath: "章节正文/第一卷 待命名/第二章 测试 [剧情梗概].md",
      title: "测试",
      createdAtMs: 4,
    })
    await fixture.conversation.updateSession({
      sessionId: activeSessionId,
      chapterSequence: 1,
      synopsisPath: "章节正文/第一卷 待命名/第一章 测试 [剧情梗概].md",
      updatedAtMs: 5,
    })
    const active = await fixture.conversation.findActiveSession(fixture.projectId)
    expect(active?.sessionId).toBe(activeSessionId)
    expect(active?.chapterSequence).toBe(1)
    await fixture.database.destroy()
  })
})

describe("discuss session chain", () => {
  it("keeps one turnId across ReAct rounds and only deltas new evidence", async () => {
    const model = new ReactThenContinueModel()
    const harness = await openChapterHarness("Discuss ReAct Chain", { model })
    temporaryDirectories.push(harness.root)
    try {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      const discussCalls = model.recorder.calls.filter((call) => call.delta.phase === "synopsis_discuss"
        || call.contextKinds.includes("system_rules"))
      expect(discussCalls.length).toBeGreaterThanOrEqual(2)
      expect(discussCalls[1]?.turnId).toBe(discussCalls[0]?.turnId)
      expect(discussCalls[1]?.envelopeId).not.toBe(discussCalls[0]?.envelopeId)
      expect(discussCalls[1]?.contextTurnIds).toContain(discussCalls[0]?.turnId)
      expect(discussCalls[1]?.evidenceOwnerIds.some((ownerId) => ownerId.includes("描写规则"))).toBe(false)
      expect(discussCalls[0]?.conversationHistory).toBeUndefined()
    } finally {
      await harness.container.close()
    }
  }, 20_000)

  it("refreshes the fixed rules for an existing session and keeps its prior turns", async () => {
    const model = new RecordingFakeModel()
    const harness = await openChapterHarness("Discuss Second Send", { model })
    temporaryDirectories.push(harness.root)
    try {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      const afterFirst = model.calls.length
      const upgradeDatabase = await openProjectDatabase(join(
        harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite",
      ))
      try {
        await upgradeDatabase.updateTable("synopsis_discuss_context_messages")
          .set({ content_text: "旧版讨论规则", content_digest: digest("旧版讨论规则") })
          .where("kind", "=", "system_rules").execute()
      } finally {
        await upgradeDatabase.destroy()
      }
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "把站台雨声再压一点",
      })
      const secondSend = model.calls.slice(afterFirst)
      expect(secondSend.length).toBeGreaterThan(0)
      expect(secondSend[0]?.contextKinds).toContain("phase_request")
      expect(secondSend[0]?.systemRules).toContain("你负责虚构小说的创作与续写")
      expect(secondSend[0]?.conversationHistory).toBeUndefined()
      expect(secondSend[0]?.evidenceOwnerIds.some((ownerId) => ownerId.includes("描写规则"))).toBe(false)

      const database = await openProjectDatabase(join(
        harness.applicationDataRoot,
        "projects",
        harness.projectId,
        "project.sqlite",
      ))
      try {
        const turnChains = await database.selectFrom("model_context_chains").selectAll().execute()
        expect(turnChains).toEqual([])
        const session = await new SqliteSynopsisConversationRepository(database).findActiveSession(harness.projectId)
        expect(session).toBeDefined()
        const stored = await new SqliteSynopsisConversationRepository(database)
          .listDiscussContextMessages(session?.sessionId as string)
        expect(stored.filter((message) => message.kind === "system_rules")).toHaveLength(1)
        expect(stored.some((message) => message.kind === "phase_request")).toBe(true)
      } finally {
        await database.destroy()
      }
    } finally {
      await harness.container.close()
    }
  }, 20_000)

  it("appends each author turn with its before/after markdown and never rewrites earlier ones", async () => {
    const model = new RecordingFakeModel()
    const harness = await openChapterHarness("Discuss Append Only", { model })
    temporaryDirectories.push(harness.root)
    try {
      await invoke(harness, "synopsis.conversation.start", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
      })
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "这一章从雨夜站台开始",
      })
      const afterFirst = model.calls.length
      await invoke(harness, "synopsis.conversation.send", {
        projectId: harness.projectId,
        workspaceRootRef: harness.workspaceRootRef,
        message: "把站台雨声再压一点",
      })
      const secondSend = model.calls.slice(afterFirst)
      expect(secondSend.length).toBeGreaterThan(0)
      // 第二轮请求里仍能找到第一轮的用户原文，说明历史只追加、没有被重写。
      expect(secondSend[0]?.contextKinds).toContain("author_message")
      const database = await openProjectDatabase(join(
        harness.applicationDataRoot,
        "projects",
        harness.projectId,
        "project.sqlite",
      ))
      try {
        const session = await new SqliteSynopsisConversationRepository(database).findActiveSession(harness.projectId)
        const stored = await new SqliteSynopsisConversationRepository(database)
          .listDiscussContextMessages(session?.sessionId as string)
        const authorMessages = stored.filter((message) => message.kind === "author_message")
        expect(authorMessages.map((message) => message.content)).toEqual([
          "这一章从雨夜站台开始",
          "把站台雨声再压一点",
        ])
        // 第一轮注入的技能包与阶段提示仍在链里：只追加，不因下一轮而消失。
        const firstTurnMessages = stored.filter((message) => message.kind === "phase_instruction"
          && message.content?.startsWith("【skill-pack:synopsis_discuss】") === true)
        expect(firstTurnMessages.length).toBeGreaterThanOrEqual(2)
        expect(stored.filter((message) => message.kind === "author_bracket").length).toBeGreaterThan(0)
      } finally {
        await database.destroy()
      }
    } finally {
      await harness.container.close()
    }
  }, 20_000)
})
