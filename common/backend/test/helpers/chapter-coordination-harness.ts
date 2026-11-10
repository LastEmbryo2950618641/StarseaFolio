import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"

import { PROTOCOL_VERSION } from "@starseafolio/contracts"

import type { AIModelPort } from "../../src/application/turns/ports/ai-model-port.js"
import {
  answerCreativeSetupQuestion,
  initialCreativeSetupState,
  markCreativeSetupWritten,
  openCreativeSetupQuestion,
  serializeProtagonistCreativeSetupMarkdown,
  type CreativeSetupState,
} from "../../src/application/chapters/creative-setup-state.js"
import {
  incrementVolumePlanningWriteCount,
  serializeVolumePlanningState,
  type VolumePlanningState,
} from "../../src/application/chapters/volume-planning-gate.js"
import {
  BackendContainer,
  BackendFacade,
  type BackendContainer as BackendContainerType,
} from "../../src/index.js"
import { FakeAiModelAdapter } from "../../src/infrastructure/models/fake-ai-model-adapter.js"
import { siblingPlanningMarkdownPath } from "../../src/core/chapters/synopsis-path.js"
import { DEFAULT_VOLUME_FOLDER_NAME } from "../../src/core/chapters/chapter-volume.js"
import { digest } from "../../src/core/identity/digest.js"
import { assessWorkStyleMarkdown, WORK_STYLE_RULE_PATH } from "../../src/core/workspace/work-style-gate.js"
import { SqliteCreativeSetupRepository } from "../../src/infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import { openProjectDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js"

export const confirmedVolumeStorylineFixture = Object.freeze({
  storyline: Object.freeze({
    opening: "雨夜里，主角在旧站台发现失踪者留下的信。",
    climaxes: "追查信件时遭到阻拦，主角找到失踪者的真正去向。",
    ending: "主角解开旧站台的疑案，带着新的线索启程。",
    subplots: "无支线",
  }),
  storylineConfirmedAtMs: 1,
}) satisfies Pick<VolumePlanningState, "storyline" | "storylineConfirmedAtMs">

export type ChapterHarness = Readonly<{
  root: string
  workspaceRootRef: string
  applicationDataRoot: string
  projectId: string
  container: BackendContainerType
  facade: BackendFacade
}>

export async function openChapterHarness(
  displayName = "Conversation Test",
  options?: Readonly<{ model?: AIModelPort; workStyleGateReady?: boolean; creativeSetupReady?: boolean }>,
): Promise<ChapterHarness> {
  const root = mkdtempSync(join(tmpdir(), "worldseed-chapter-harness-"))
  const workspaceRootRef = join(root, "workspace")
  const applicationDataRoot = join(root, "application-data")
  const promptPackageRoot = fileURLToPath(new URL("../../../../common/packages/prompt-contracts/", import.meta.url))
  const projectId = randomUUID()
  const container = await BackendContainer.open({
    applicationDataRoot,
    promptPackageRoot,
    model: options?.model ?? new FakeAiModelAdapter(randomUUID),
  })
  const facade = new BackendFacade(container)
  await facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "project.create",
    payload: { projectId, displayName, workspaceRootRef },
  })
  if (options?.workStyleGateReady !== false) {
    const styleMarkdown = [
      "# 作品风格",
      "## 1. 语体笔风\n主锚：表现输出/笔风规则/仙侠.md。语气硬朗冷峻，描写密度适中，感官偏视觉。",
      "## 2. 时代科技生活\n冷兵器与符箓并行；货币用灵石；机构写宗门与城卫，不写现代警察。",
      "## 3. 规则称谓能力\n战力用境界名落笔；技能先效果后名称；称谓按辈分与阵营。",
      "## 4. 命名\n人名双/三音节错开姓与偏旁；常同框禁止同姓墙。正例：林烬、沈砚。反例：凌寒与凌霜同批不合格。势力正派用宗门，商会用阁。",
      "## 5. 角色声口\n主角短句、少形容词，示例：「先活下来再说。」配角谋士长句带停顿，示例：「若依我看……此局已半输。」",
      "## 6. 尺度意象章钩\n暴力写后果不写虐杀展览；章末钩落在选择代价。",
      "## 7. 人称指称\n第三人称限知，贴林烬；正文以姓名为主。示例句：林烬抬眼，没接话。",
      "## 8. 句子与对话\n句长偏短；对白白话口语；禁对白乒乓，群戏按受损者到权力高位分层。正例：「滚。」反例：全员使用同一书面腔。",
    ].join("\n\n")
    const styleAssessment = assessWorkStyleMarkdown(styleMarkdown)
    if (!styleAssessment.complete) {
      throw new Error(`Test style fixture is incomplete: ${styleAssessment.weakHeadings.join("; ")}`)
    }
    await container.workspace.saveUserMarkdown(workspaceRootRef, WORK_STYLE_RULE_PATH, styleMarkdown)
    const database = new Database(join(applicationDataRoot, "projects", projectId, "project.sqlite"))
    try {
      database.prepare(`
        INSERT INTO work_style_gate_states (
          project_id, status, selected_prose_style_path, style_digest, updated_at_ms
        ) VALUES (?, 'ready', ?, ?, ?)
      `).run(projectId, "表现输出/笔风规则/仙侠.md", digest(styleMarkdown), Date.now())
    } finally {
      database.close()
    }
  }
  const harness = { root, workspaceRootRef, applicationDataRoot, projectId, container, facade }
  if (options?.creativeSetupReady !== false) await seedCreativeSetup(harness)
  return harness
}

async function saveFixtureMarkdown(harness: ChapterHarness, path: string, markdown: string): Promise<string> {
  await harness.container.workspace.saveUserMarkdown(harness.workspaceRootRef, path, markdown)
  const saved = await harness.container.workspace.readMarkdown(harness.workspaceRootRef, path)
  if (digest(saved) !== digest(markdown)) throw new Error(`Fixture Markdown readback failed: ${path}`)
  return saved
}

async function answerFixtureQuestions(
  repository: SqliteCreativeSetupRepository,
  projectId: string,
  scope: string,
  answers: readonly string[],
): Promise<CreativeSetupState> {
  let state = initialCreativeSetupState(scope, Date.now())
  for (const answer of answers) {
    const questionId = randomUUID()
    state = openCreativeSetupQuestion(state, questionId, Date.now())
    await repository.save(projectId, state)
    state = answerCreativeSetupQuestion(state, { questionId, answer, now: Date.now() })
    await repository.save(projectId, state)
  }
  if (state.status !== "awaiting_write") throw new Error(`Fixture questionnaire is incomplete: ${scope}`)
  return state
}

async function seedCreativeSetup(harness: ChapterHarness): Promise<void> {
  const database = await openProjectDatabase(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
  try {
    const repository = new SqliteCreativeSetupRepository(database)
    const protagonist = await answerFixtureQuestions(repository, harness.projectId, "protagonist", [
      "谨慎坚韧，喜欢追查旧事", "黑发灰眼，左手有旧伤", "二十七岁", "在旧站台长大的旅人，故友突然失踪",
      "找到失踪的故友并查明真相", "姓名林烬", "无",
    ])
    const protagonistPath = "设定集/人物/主角.md"
    const protagonistMarkdown = await saveFixtureMarkdown(harness, protagonistPath,
      serializeProtagonistCreativeSetupMarkdown(protagonist, { aiAdditions: "林烬善于辨认笔迹，与失踪的故友自幼相识。" }))
    await repository.save(harness.projectId, markCreativeSetupWritten(protagonist, {
      path: protagonistPath, digest: digest(protagonistMarkdown), now: Date.now(),
    }))

    const story = confirmedVolumeStorylineFixture.storyline
    const volume = await answerFixtureQuestions(repository, harness.projectId, `volume:${DEFAULT_VOLUME_FOLDER_NAME}`,
      [story.opening, story.climaxes, story.ending, story.subplots])
    const volumePath = `大纲/${DEFAULT_VOLUME_FOLDER_NAME}.批量计划.md`
    const volumeMarkdown = await saveFixtureMarkdown(harness, volumePath, serializeVolumePlanningState({
      volumeFolderName: DEFAULT_VOLUME_FOLDER_NAME,
      startSequence: 1,
      targetChapterCount: 0,
      targetWordCount: 0,
      synopsisWriteCount: 0,
      outlineWriteCount: 0,
      ...confirmedVolumeStorylineFixture,
    }))
    await repository.save(harness.projectId, markCreativeSetupWritten(volume, {
      path: volumePath, digest: digest(volumeMarkdown), now: Date.now(),
    }))
  } finally {
    await database.destroy()
  }
}

export async function prepareVolumePlanning(harness: ChapterHarness, volumeFolderName: string = DEFAULT_VOLUME_FOLDER_NAME): Promise<void> {
  let plan: VolumePlanningState = {
    volumeFolderName, startSequence: 1, targetChapterCount: 8, targetWordCount: 24000,
    synopsisWriteCount: 0, outlineWriteCount: 0, ...confirmedVolumeStorylineFixture,
  }
  await saveFixtureMarkdown(harness, `大纲/${volumeFolderName}.梗概.md`,
    "# 卷梗概\n\n主角从旧站台发现线索，沿途追查失踪者，最终查明故友的去向。\n")
  plan = incrementVolumePlanningWriteCount(plan, "synopsis")
  await saveFixtureMarkdown(harness, `大纲/${volumeFolderName}.md`,
    "# 卷大纲\n\n前四章发现信件并追查线索，后四章揭示失踪原因，在旧站台解开疑案。\n")
  plan = incrementVolumePlanningWriteCount(plan, "outline")
  await saveFixtureMarkdown(harness, `大纲/${volumeFolderName}.批量计划.md`, serializeVolumePlanningState(plan))
}

export async function runTurn(
  facade: BackendFacade,
  projectId: string,
  workspaceRootRef: string,
  userInput: string,
  chapterSequence: number,
): Promise<string> {
  const started = await facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "turn.start",
    payload: { projectId, workspaceRootRef, userInput, chapterSequence },
  })
  if (!started.ok) throw new Error(started.error.message)
  const taskId = (started.data as { taskId: string }).taskId
  await waitForTask(facade, taskId)
  return taskId
}

export async function waitForTask(facade: BackendFacade, taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "turn.status",
      payload: { taskId },
    })
    if (!status.ok) throw new Error(status.error.message)
    const snapshot = status.data as { status: string }
    if (snapshot.status === "completed") return
    if (["failed", "cancelled"].includes(snapshot.status)) {
      throw new Error(`Task ${taskId} ended with ${snapshot.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Task ${taskId} did not complete`)
}

export async function waitForRevisionGraphSync(
  facade: BackendFacade,
  projectId: string,
  workspaceRootRef: string,
  revisionTaskId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const revision = await facade.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "chapter.readRevision",
      payload: { projectId, workspaceRootRef, revisionTaskId },
    })
    if (!revision.ok) throw new Error(revision.error.message)
    if ((revision.data as { graphSyncStatus: string }).graphSyncStatus === "completed") return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Revision ${revisionTaskId} graph sync did not complete`)
}

export async function listFirstChapter(facade: BackendFacade, projectId: string, workspaceRootRef: string) {
  const listed = await facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "chapter.list",
    payload: { projectId, workspaceRootRef },
  })
  if (!listed.ok || !Array.isArray(listed.data) || listed.data.length === 0) {
    throw new Error("chapter.list failed or returned no chapters")
  }
  return listed.data[0] as { chapterId: string; sourceId: string; publishPath: string; heading?: string }
}

export async function prepareChapterPlanning(harness: ChapterHarness): Promise<void> {
  const started = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "synopsis.conversation.start",
    payload: {
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
      title: "雨夜旧站台",
    },
  })
  if (!started.ok) throw new Error(started.error.message)
  const session = (started.data as { session: { synopsisPath: string } }).session
  const volumeFolderName = session.synopsisPath.split("/")[1]
  if (volumeFolderName === undefined) throw new Error("Test session did not create a volume folder")
  await prepareVolumePlanning(harness, volumeFolderName)
  const outlinePath = siblingPlanningMarkdownPath(session.synopsisPath, "outline")
  if (outlinePath === undefined) throw new Error("Test session did not create a synopsis path")
  const synopsisMarkdown = "# 第一章 雨夜旧站台 剧情梗概\n\n旧站台的灯引出一段等待，主角必须在雨停前作出选择。\n"
  const outlineMarkdown = "# 第一章 雨夜旧站台 剧情细纲\n\n- 章定位：让主角发现无人认领的灯。\n- 分场：雨夜站台、灯下选择。\n- 人物准备：主角与失踪者建立因果线。\n"
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, session.synopsisPath, synopsisMarkdown)
  await harness.container.workspace.saveSynopsisMarkdown(harness.workspaceRootRef, outlinePath, outlineMarkdown)
  const database = new Database(join(harness.applicationDataRoot, "projects", harness.projectId, "project.sqlite"))
  try {
    database.prepare(`
      update synopsis_conversation_sessions
      set synopsis_confirmed_at_ms = ?, last_agent_digest = ?, last_outline_agent_digest = ?, focus_kind = 'chapter_body'
      where project_id = ? and chapter_sequence = 1
    `).run(Date.now(), digest(synopsisMarkdown), digest(outlineMarkdown), harness.projectId)
  } finally {
    database.close()
  }
}

export async function seedCommittedChapter(harness: ChapterHarness): Promise<{
  chapterId: string
  sourceId: string
  body: string
  heading: string
}> {
  await prepareChapterPlanning(harness)
  await runTurn(
    harness.facade,
    harness.projectId,
    harness.workspaceRootRef,
    "雨夜里，旧站台尽头亮起一盏无人认领的灯。",
    1,
  )
  const runtime = harness.container.getCurrentRuntime()
  if (runtime === undefined) throw new Error("Project runtime not open")
  const drafts = await runtime.createChapterRevisionService().listUnpublished(harness.projectId)
  const draft = drafts.find((item) => item.chapterSequence === 1)
  if (draft !== undefined) {
    const submitted = await harness.facade.handle({
      protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "chapter.submitRevision",
      payload: { projectId: harness.projectId, workspaceRootRef: harness.workspaceRootRef,
        revisionTaskId: draft.revisionTaskId, mode: "direct", forced: true },
    })
    if (!submitted.ok) throw new Error(submitted.error.message)
    await waitForRevisionGraphSync(harness.facade, harness.projectId, harness.workspaceRootRef, draft.revisionTaskId)
  }
  const chapter = await listFirstChapter(harness.facade, harness.projectId, harness.workspaceRootRef)
  const read = await harness.facade.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: "chapter.read",
    payload: {
      projectId: harness.projectId,
      workspaceRootRef: harness.workspaceRootRef,
      chapterId: chapter.chapterId,
    },
  })
  if (!read.ok) throw new Error(read.error.message)
  const data = read.data as { body: string; heading: string }
  return { chapterId: chapter.chapterId, sourceId: chapter.sourceId, body: data.body, heading: data.heading }
}
