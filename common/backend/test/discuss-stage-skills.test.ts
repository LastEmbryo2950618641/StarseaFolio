import { randomUUID } from "node:crypto"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, type PhaseRequestEnvelope, type SynopsisConversationSendResult } from "@starseafolio/contracts"
import { COMPOSE_TAGS, type DiscussTurnWriteScope } from "@starseafolio/prompt-contracts"
import type { AIModelPort, DiscussTurnClassificationInput } from "../src/application/turns/ports/ai-model-port.js"
import { synopsisConversationStreamHub } from "../src/application/chapters/synopsis-conversation-stream-hub.js"
import { digest, siblingPlanningMarkdownPath } from "../src/core/index.js"
import { FakeAiModelAdapter } from "../src/infrastructure/models/fake-ai-model-adapter.js"
import { openChapterHarness, prepareChapterPlanning, prepareVolumePlanning, seedCommittedChapter, type ChapterHarness } from "./helpers/chapter-coordination-harness.js"

/** discuss 基础包 = 三个阶段共用的指南；其余 skill 由 service 按本轮动作注入 phasePrompt。 */
const BASE_DISCUSS_SKILL_IDS = ["starsea-writing", "discuss-workflow", "plot-synopsis"] as const
const STAGE_ONLY_SKILL_IDS = [
  "user-to-synopsis",
  "synopsis-to-outline",
  "book-cold-start",
  "settings-revision",
  "outline-to-draft",
] as const
const DRAFT_GUIDE_HEADER = "# 用户要求 + 梗概 + 细纲 → 正文草稿"

const synopsis = "# 第一章 雨夜旧站台 剧情梗概\n\n林烬在末班车广播响起前，必须决定是否追查失踪者的线索。"
const outline = "# 第一章 雨夜旧站台 剧情细纲\n\n- 章定位：雨夜站台的选择。\n- 分场：广播响起、车票、回头。\n"

type DiscussCapture = Readonly<{
  phasePromptText: string
  phasePromptDigest: string
  contextMessages: readonly Readonly<{ role: string; kind: string; content: string }>[]
}>

function createDiscussModel(input: Readonly<{
  captures: DiscussCapture[]
  /** 模拟讨论路由给出的本轮写权限；省略时不调用 classifyDiscussTurn（writeScope 为 undefined）。 */
  classifyScope?: (message: string) => DiscussTurnWriteScope
  artifact?: (request: PhaseRequestEnvelope) => Record<string, unknown>
}>): AIModelPort {
  const fake = new FakeAiModelAdapter(randomUUID)
  return {
    info: fake.info,
    ...(input.classifyScope === undefined ? {} : {
      classifyDiscussTurn(args: DiscussTurnClassificationInput) {
        return Promise.resolve({
          scope: input.classifyScope!(args.message),
          usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0, modelCalls: 1 },
        })
      },
    }),
    async execute(request, options) {
      if (request.phase !== "synopsis_discuss") return fake.execute(request, options)
      input.captures.push({
        phasePromptText: options?.phasePrompt?.text ?? "",
        phasePromptDigest: options?.phasePrompt?.digest ?? "",
        contextMessages: (options?.contextMessages ?? []).map((message) => ({
          role: message.role,
          kind: message.kind,
          content: message.content,
        })),
      })
      synopsisConversationStreamHub.setTodos(request.projectId, [
        { id: "write", content: "核对用户本轮要求", status: "completed" },
      ], Date.now())
      return {
        result: {
          schemaVersion: 1,
          envelopeId: request.envelopeId,
          contextId: request.contextId,
          phase: request.phase,
          outcome: "continue",
          requestedReads: [],
          citedReadIds: [...request.committedReadIds],
          producedArtifactIds: [],
          decisionRecordIds: [],
          unresolvedDependencies: [],
          reason: "Fixture",
          selfReview: "Fixture",
          artifact: {
            assistantMessage: "已处理本章请求。",
            finalSelfReview: "Fixture",
            choices: [{ label: "核对本章节奏", action: "continue_discuss" }],
            ...(input.artifact?.(request) ?? {}),
          },
        },
        usage: { inputTokens: 20, outputTokens: 10, latencyMs: 0, modelCalls: 1 },
      }
    },
  }
}

async function send(harness: ChapterHarness, message: string): Promise<SynopsisConversationSendResult> {
  const result = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "synopsis.conversation.send",
    payload: {
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
      message,
      proceedMode: "precise",
      maxModelCalls: 12,
    },
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data as SynopsisConversationSendResult
}

function skillPackMessages(capture: DiscussCapture): readonly string[] {
  return capture.contextMessages
    .filter((message) => message.content.startsWith("【skill-pack:synopsis_discuss】"))
    .map((message) => message.content)
}

function expectBaseSkillPack(capture: DiscussCapture): void {
  const packs = skillPackMessages(capture)
  expect(packs).toHaveLength(1)
  const pack = packs[0]!
  for (const skillId of BASE_DISCUSS_SKILL_IDS) {
    expect(pack).toContain(`【skill:${skillId}】`)
  }
  expect(pack.match(/【skill:[a-z0-9-]+】/gu)).toHaveLength(BASE_DISCUSS_SKILL_IDS.length)
  for (const skillId of STAGE_ONLY_SKILL_IDS) {
    expect(pack).not.toContain(`【skill:${skillId}】`)
  }
}

function expectPhaseSkillIds(harness: ChapterHarness, capture: DiscussCapture, expected: readonly string[]): void {
  for (const skillId of expected) {
    expect(capture.phasePromptText).toContain(`【skill:${skillId}】`)
    expect(capture.phasePromptText.match(new RegExp(`【skill:${skillId}】`, "gu"))).toHaveLength(1)
  }
  for (const skillId of STAGE_ONLY_SKILL_IDS) {
    if (expected.includes(skillId)) continue
    expect(capture.phasePromptText).not.toContain(`【skill:${skillId}】`)
  }
  expect(capture.phasePromptDigest).toBe(digest(capture.phasePromptText))
  // 阶段 skill 只活在本轮 phasePrompt，不写进持久 discuss context。
  for (const skillId of STAGE_ONLY_SKILL_IDS) {
    expect(countPersistedContextMatches(harness, `【skill:${skillId}】`), skillId).toBe(0)
  }
}

function countPersistedContextMatches(harness: ChapterHarness, needle: string): number {
  const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
  try {
    const row = database.prepare(
      "SELECT COUNT(*) AS count FROM synopsis_discuss_context_messages WHERE project_id = ? AND hidden_at IS NULL AND content_text LIKE ?",
    ).get(harness.projectId, `%${needle}%`) as { count: number } | undefined
    return row?.count ?? 0
  } finally {
    database.close()
  }
}

describe("discuss stage skill injection", () => {
  it("uses plain text without a schema repair for explicitly read-only discussion", async () => {
    const model = createDiscussModel({ captures: [], classifyScope: () => ({}), artifact: () => ({
      assistantMessage: "已处理本章请求。\n<creative-choices>\n- 缩短开场铺垫\n- 保留铺垫，提前揭示线索\n</creative-choices>",
    }) })
    const execute = model.execute.bind(model)
    model.execute = async (request, options) => {
      if (request.phase === "synopsis_discuss") {
        expect(options?.outputMode).toBe("text")
        expect(options?.onSchemaRepair).toBeUndefined()
        expect(options?.phasePrompt?.text).toContain("用普通文本回复讨论")
      }
      return execute(request, options)
    }
    const harness = await openChapterHarness("Read-only text discussion", { model })
    try {
      await prepareChapterPlanning(harness)
      const result = await send(harness, "只讨论节奏，先不改文件。")
      expect(result.messages.at(-1)?.content).toContain("已处理本章请求。")
      expect(result.messages.at(-1)?.content).not.toContain("<creative-choices>")
      expect(result.messages.at(-1)?.choices?.map((choice) => choice.label)).toEqual(["缩短开场铺垫", "保留铺垫，提前揭示线索"])
      expect(result.appendedDraft).toBeUndefined()
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it.each([true, false])("checks the current user quote before applying tagged focus (valid=%s)", async (valid) => {
    const message = "把焦点切到第二章。"
    const model = createDiscussModel({ captures: [], classifyScope: () => ({ focus: true }), artifact: () => ({
      assistantMessage: `<chapter-focus>\n2\n${valid ? message : "上一轮说要切到第二章"}\n</chapter-focus>`,
    }) })
    const harness = await openChapterHarness("Tagged focus", { model })
    try {
      await prepareChapterPlanning(harness)
      await seedCommittedChapter(harness)
      const result = await send(harness, message)
      expect(result.session.chapterSequence).toBe(valid ? 2 : 1)
      expect(result.appendedDraft).toBeUndefined()
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("keeps the default pack at the three shared skills and only adds stage skills to the turn prompt", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({ captures })
    const harness = await openChapterHarness("Discuss base skill pack", { model })
    try {
      await prepareChapterPlanning(harness)
      await send(harness, "我们聊聊这一章怎么写。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      // writeScope 缺失且已有细纲：草稿动作按材料判断命中，outline-to-draft 仍走既有指南。
      expectPhaseSkillIds(harness, capture!, [])
      expect(capture!.contextMessages.filter((message) => message.content.startsWith(DRAFT_GUIDE_HEADER)))
        .toHaveLength(1)
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("injects user-to-synopsis when the synopsis is missing", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({ captures })
    const harness = await openChapterHarness("Discuss missing synopsis skill", { model })
    try {
      await prepareVolumePlanning(harness)
      await send(harness, "先把第一章梗概聊出来。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, ["user-to-synopsis"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("injects user-to-synopsis when the router authorizes a synopsis write", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({
      captures,
      classifyScope: () => ({ synopsis: "rewrite" }),
      artifact: () => ({
        assistantMessage: `${COMPOSE_TAGS.synopsisStart}\n${synopsis}\n${COMPOSE_TAGS.synopsisEnd}`,
      }),
    })
    const harness = await openChapterHarness("Discuss synopsis write skill", { model })
    try {
      await prepareChapterPlanning(harness)
      await send(harness, "把梗概改成他赶上末班车。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, ["user-to-synopsis"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("injects synopsis-to-outline when the outline is missing but the synopsis is valid", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({ captures })
    const harness = await openChapterHarness("Discuss missing outline skill", { model })
    try {
      await prepareChapterPlanning(harness)
      const listed = await harness.facade.handle({
        protocolVersion: PROTOCOL_VERSION,
        requestId: randomUUID(),
        method: "synopsis.conversation.list",
        payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef },
      })
      if (!listed.ok) throw new Error(listed.error.message)
      const outlinePath = (listed.data as SynopsisConversationSendResult).session.synopsisPath
        .replace("[剧情梗概].md", "[剧情细纲].md")
      await harness.container.workspace.removeSynopsisMarkdown(harness.workspaceRootRef, outlinePath)
      await send(harness, "接着把细纲补出来。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, ["synopsis-to-outline"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("injects synopsis-to-outline when the router authorizes an outline write", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({
      captures,
      classifyScope: () => ({ outline: "rewrite" }),
      artifact: () => ({
        assistantMessage: `${COMPOSE_TAGS.outlineStart}\n${outline}\n${COMPOSE_TAGS.outlineEnd}`,
      }),
    })
    const harness = await openChapterHarness("Discuss outline write skill", { model })
    try {
      await prepareChapterPlanning(harness)
      await send(harness, "细纲再细一点。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, ["synopsis-to-outline"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("keeps anti-AI rules in the system prefix instead of re-injecting them for a draft write", async () => {
    const captures: DiscussCapture[] = []
    const model = createDiscussModel({
      captures,
      classifyScope: () => ({ draft: "write" }),
      artifact: () => ({
        assistantMessage: `${COMPOSE_TAGS.draftStart}\n# 第一章 雨夜旧站台\n\n广播响了三遍。林烬把车票按在掌心里，最后没有回头。\n${COMPOSE_TAGS.draftEnd}`,
      }),
    })
    const harness = await openChapterHarness("Discuss draft write skills", { model })
    try {
      await prepareChapterPlanning(harness)
      await send(harness, "按细纲写一版正文。")
      const capture = captures[0]
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, [])
      // outline-to-draft 仍只走既有 discussionDraftGuide，不在阶段 skill 里重复。
      expect(capture!.phasePromptText).not.toContain("【skill:outline-to-draft】")
      expect(capture!.contextMessages.filter((message) => message.content.startsWith(DRAFT_GUIDE_HEADER)))
        .toHaveLength(1)
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it("injects book-cold-start while the work style gate is pending", async () => {
    const delegate = new FakeAiModelAdapter(randomUUID)
    const captures: DiscussCapture[] = []
    const model: AIModelPort = {
      info: delegate.info,
      async execute(request, options) {
        captures.push({
          phasePromptText: options?.phasePrompt?.text ?? "",
          phasePromptDigest: options?.phasePrompt?.digest ?? "",
          contextMessages: (options?.contextMessages ?? []).map((message) => ({
            role: message.role,
            kind: message.kind,
            content: message.content,
          })),
        })
        return delegate.execute(request, options)
      },
    }
    const harness = await openChapterHarness("Discuss cold start skill", { model, workStyleGateReady: false })
    try {
      const idea = "灾变来临前，主角发现自己能预知危险。"
      const started = await send(harness, idea)
      expect(started.autoContinue?.message).toBe(idea)
      await send(harness, idea)
      const capture = captures.find((item) => item.phasePromptText.includes("【skill:book-cold-start】"))
      expect(capture).toBeDefined()
      expectBaseSkillPack(capture!)
      expectPhaseSkillIds(harness, capture!, ["book-cold-start"])
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
  it.each([false, true])("validates an authorized compose response before writing (truncated=%s)", async (truncated) => {
    const full = [
      COMPOSE_TAGS.synopsisStart, "林烬在末班车前追上线索。", COMPOSE_TAGS.synopsisEnd,
      COMPOSE_TAGS.outlineStart, "- 章定位：追查。", COMPOSE_TAGS.outlineEnd,
      ...(truncated ? [] : [COMPOSE_TAGS.draftStart, "# 第一章 末班车", "", "林烬跑向站台。", COMPOSE_TAGS.draftEnd]),
    ].join("\n")
    const model = createDiscussModel({
      captures: [],
      classifyScope: () => ({ synopsis: "rewrite", outline: "rewrite", draft: "write" }),
      artifact: () => ({ assistantMessage: full }),
    })
    const execute = model.execute.bind(model)
    model.execute = async (request, options) => {
      if (request.phase === "synopsis_discuss") {
        expect(options?.outputMode).toBe("text")
        expect(options?.phasePrompt?.text).toContain("本轮已获准连写")
        expect(options?.phasePrompt?.text).not.toContain("输出 JSON：顶层含")
        expect(options?.onSchemaRepair).toBeUndefined()
        for (const chunk of [full.slice(0, 20), full.slice(20)]) options?.onPartial?.({ contentDelta: chunk })
      }
      return execute(request, options)
    }
    const harness = await openChapterHarness("Discuss compose text", { model })
    try {
      await prepareChapterPlanning(harness)
      const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
      const currentPaths = (): [string, string] => {
        const { synopsis_path: synopsisPath } = database.prepare(
          "SELECT synopsis_path FROM synopsis_conversation_sessions WHERE project_id = ? AND chapter_sequence = 1",
        ).get(harness.projectId) as { synopsis_path: string }
        return [synopsisPath, siblingPlanningMarkdownPath(synopsisPath, "outline")!]
      }
      const readPlanning = (): string[] => currentPaths().map((path) => readFileSync(join(harness.workspaceRootRef, path), "utf8"))
      try {
        const before = readPlanning()
        const result = send(harness, "重写梗概和细纲，然后接着写草稿。")
        if (truncated) {
          await expect(result).rejects.toThrow(/本次响应不会写入/u)
          expect(readPlanning()).toEqual(before)
        } else {
          await expect(result).resolves.toMatchObject({ appendedDraft: { draftVersionId: expect.any(String) } })
          expect(readPlanning()).toEqual([expect.stringContaining("林烬在末班车前追上线索。"), expect.stringContaining("- 章定位：追查。")])
        }
      } finally {
        database.close()
      }
    } finally {
      await harness.container.close()
      rmSync(harness.root, { recursive: true, force: true })
    }
  })})
