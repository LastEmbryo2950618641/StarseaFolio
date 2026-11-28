/**
 * Real-model acceptance: create a book with a real GPT-compatible endpoint, then write one chapter.
 *
 * Env:
 *   WORLDSEED_REAL_BASE_URL   (default https://www.aiwanwu.cc/v1)
 *   WORLDSEED_REAL_API_KEY    (required)
 *   WORLDSEED_REAL_MODEL      (default gpt-6.2-sol)
 *   WORLDSEED_REAL_WORKSPACE  (default .worldseed-data/real-gpt/book)
 *   WORLDSEED_REAL_APP_DATA   (default .worldseed-data/real-gpt/runtime)
 */
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  BackendContainer,
  BackendFacade,
  createModelFromSelection,
  WORK_STYLE_RULE_PATH,
} from "../../common/backend/dist/index.js"

const protocolVersion = "worldseed.v1"
const baseUrl = (process.env.WORLDSEED_REAL_BASE_URL ?? "https://www.aiwanwu.cc/v1").replace(/\/+$/u, "")
const apiKey = requireEnv("WORLDSEED_REAL_API_KEY")
const model = process.env.WORLDSEED_REAL_MODEL ?? "gpt-6.2-sol"
const runStamp = new Date().toISOString().replace(/[:.]/gu, "-")
const workspaceRootRef = resolve(
  process.env.WORLDSEED_REAL_WORKSPACE ?? `.worldseed-data/real-gpt/book-${runStamp}`,
)
const applicationDataRoot = resolve(process.env.WORLDSEED_REAL_APP_DATA ?? `.worldseed-data/real-gpt/runtime-${runStamp}`)
const promptPackageRoot = resolve("common/packages/prompt-contracts")
const reportPath = resolve(process.env.WORLDSEED_REAL_REPORT ?? `.worldseed-data/real-gpt/report-${runStamp}.json`)

const steps = []
const report = { startedAt: new Date().toISOString(), baseUrl, model, workspaceRootRef, applicationDataRoot, steps }

function requireEnv(name) {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) throw new Error(`Missing ${name}`)
  return value.trim()
}

function record(id, status, evidence) {
  steps.push({ id, status, evidence, at: new Date().toISOString() })
  const text = typeof evidence === "string" ? evidence : JSON.stringify(evidence)
  console.log(`[${status}] ${id}: ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`)
}

async function main() {
  await mkdir(workspaceRootRef, { recursive: true })
  await mkdir(applicationDataRoot, { recursive: true })

  const selection = {
    baseUrl,
    model,
    apiKey,
    credentialRef: "turn-api-key",
    contextWindowTokens: 400_000,
    apiProtocol: "openai_chat_completions",
    thinkingModeEnabled: false,
    jsonModeEnabled: false,
  }
  const container = await BackendContainer.open({
    applicationDataRoot,
    promptPackageRoot,
    model: createModelFromSelection(promptPackageRoot, selection),
  })
  const facade = new BackendFacade(container)
  const call = async (method, payload) => {
    let lastError
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const response = await facade.handle({
        protocolVersion,
        requestId: randomUUID(),
        method,
        payload: { ...payload, ...(needsModel(method) ? { model: selection } : {}) },
      })
      if (response.ok) return response.data
      lastError = new Error(`${method} failed: ${response.error.message}`)
      const retryable = /502|503|504|timed out|Connection error|ECONNRESET|fetch failed|temporarily unavailable|overloaded|terminated|构思流协议错误|构思段顺序错误|结束标签与当前段不匹配|缺少完整的梗概|精准构思必须一次交齐|缺少梗概、细纲、草稿|未写入任何材料|推演目标提案缺少有效 kind|首包数据/iu
        .test(response.error.message)
      if (!retryable) break
      record(`retry.${method}`, "warn", `attempt ${String(attempt)}: ${response.error.message.slice(0, 160)}`)
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 3_000 * attempt * attempt)))
    }
    throw lastError
  }
  // The container needs a real model for discuss/turn calls; project creation itself does not.
  const projectId = randomUUID()
  const created = await call("project.create", {
    projectId,
    displayName: `真实模型验收·${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    workspaceRootRef,
  })
  record("project.create", "pass", created)

  // 预写《作品风格》会被系统识别为“风格已恢复”，从而跳过冷启动访谈；
  // 这里只在门禁尚未通过时补写，确保仍有主角与卷主支线的真实确认。
  const styleProbe = await call("workspace.read", {
    projectId,
    workspaceRootRef,
    relativePath: WORK_STYLE_RULE_PATH,
  }).catch(() => undefined)
  if (styleProbe === undefined) {
    record("work_style.precheck", "pass", "尚未写入，保持冷启动流程")
  }

  const listed = await call("synopsis.conversation.start", { projectId, workspaceRootRef })
  record("synopsis.start", "pass", { chapterSequence: listed.session.chapterSequence, synopsisPath: listed.session.synopsisPath })

  const sent = async (message, extra) => call("synopsis.conversation.send", {
    projectId,
    workspaceRootRef,
    message,
    maxModelCalls: 20,
    deadlineMs: 900_000,
    ...extra,
  })

  // 1. 卷始门禁：进入第一卷。
  const volumeStart = await sent("开始第一卷。", { proceedMode: "precise" })
  const volumeStarted = volumeStart.session.volumeLifecycle?.started === true
    || /已确认卷始|卷始/u.test(lastAssistant(volumeStart))
  record("volume.start", volumeStarted ? "pass" : "fail", lastAssistant(volumeStart))
  if (!volumeStarted) throw new Error("卷始门禁未通过")

  // 2. 冷启动：选择风格后由模型撰写《作品风格》，再按服务端签发的访谈问题逐项作答。
  const styleChoice = "我选择的风格组合是：小说大类规则「表现输出/小说大类规则/传统文学.md」、"
    + "小说次大类规则「表现输出/小说次大类规则/菠萝包.md」、笔风规则「表现输出/笔风规则/悬疑恐怖.md」"
  let current = await sent(styleChoice, { proceedMode: "precise" })
  record("style.select", "pass", lastAssistant(current))

  const protagonistAnswers = [
    "谨慎、记性极好，喜欢在旧物里找线索",
    "黑发，眉骨有旧伤，常穿深色外套",
    "二十九岁",
    "在老站台附近长大，父母早逝，独自生活",
    "查清三年前那位朋友失踪的真相",
    "姓名陈默",
    "无",
  ]
  const volumeAnswers = [
    "雨夜旧站台收到一封没有署名的信",
    "追查信件时遭到警告；在废弃候车室找到关键物证",
    "查清朋友失踪的经过，并决定是否把真相交出去",
    "第二封来信会在中段出现；旧站台的值班员是关键人物",
  ]
  const answersByScope = {
    protagonist: protagonistAnswers,
    "volume:第一卷 待命名": volumeAnswers,
  }
  for (let guard = 0; guard < 40; guard += 1) {
    const question = current.awaitingSetupInput
    if (question === undefined) {
      current = await sent("继续", { proceedMode: "precise", maxModelCalls: 16 })
      if (current.awaitingSetupInput === undefined) break
      continue
    }
    const pool = answersByScope[question.scope] ?? []
    const answer = pool.shift()
    if (answer === undefined) throw new Error(`访谈问题多于预设答案：${question.scope}/${question.field}`)
    record(`setup.answer.${question.scope}.${question.field}`, "pass", answer)
    current = await sent(answer, {
      proceedMode: "precise",
      setupAnswerTo: question.questionId,
      maxModelCalls: 16,
    })
  }
  record("setup.complete", current.awaitingSetupInput === undefined ? "pass" : "fail", lastAssistant(current))
  if (current.awaitingSetupInput !== undefined) {
    throw new Error(`访谈未结束：仍在等待 ${current.awaitingSetupInput.scope}/${current.awaitingSetupInput.field}`)
  }

  // 3. 卷规划首次写入（硬门禁）：已确认的主支线落成卷梗概、卷大纲与章数字数目标。
  const planPath = "大纲/第一卷 待命名.批量计划.md"
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const written = await readWorkspaceFile(call, projectId, workspaceRootRef, planPath)
    if (written !== undefined && /targetChapterCount/u.test(written)) break
    const volumeTurn = await sent(
      "请按我已确认的开场、高潮、结局和支线时机，写入本卷卷梗概、卷大纲，并给出目标章数与目标字数。",
      { proceedMode: "precise", maxModelCalls: 16 },
    )
    record(`volume.plan.attempt${String(attempt + 1)}`, "pass", lastAssistant(volumeTurn))
  }
  const planMarkdown = await readWorkspaceFile(call, projectId, workspaceRootRef, planPath)
  record("volume.plan", planMarkdown === undefined ? "fail" : "pass", planMarkdown?.slice(0, 300) ?? "<missing>")
  if (planMarkdown === undefined) throw new Error("卷规划未写入，后续构思无法进行")

  const discussed = await sent(
    "我要写一本都市异闻小说：主角在雨夜旧站台捡到一封没有署名的信，信里提到一位三年前失踪的朋友。请先帮我把这一章的要求理清楚。",
    { proceedMode: "precise", maxModelCalls: 16 },
  )
  record("discuss.requirements", "pass", lastAssistant(discussed))

  const composed = await sent("开始构思", { proceedMode: "precise", preciseAction: "start_compose", maxModelCalls: 28 })
  record("compose.start", composed.appendedDraft === undefined ? "fail" : "pass", {
    assistant: lastAssistant(composed),
    draftVersionId: composed.appendedDraft?.draftVersionId,
    choices: choiceLabels(composed),
  })
  if (composed.appendedDraft === undefined) throw new Error("Compose did not produce a draft")

  const draftId = composed.appendedDraft.draftVersionId
  const revisionTaskId = composed.appendedDraft.revisionTaskId
  let published = await call("synopsis.conversation.send", {
    projectId,
    workspaceRootRef,
    message: "发布正文",
    proceedMode: "precise",
    preciseAction: "publish",
    publishDraftVersionId: draftId,
    chapterSequence: composed.session.chapterSequence,
    maxModelCalls: 40,
    deadlineMs: 900_000,
  })
  const publishAssistant = lastAssistant(published)
  const publishLooksFailed = /expected object|received undefined|入库失败|尚未落盘|未返回产物|request_read/iu.test(publishAssistant)
  record("publish", publishLooksFailed ? "warn" : "pass", publishAssistant)

  let publishOk = (await call("chapter.list", { projectId, workspaceRootRef })).length > 0
  // After a failed ingest, recover via folio continue/rerun — do not re-send precise publish
  // (the draft may already be locked into a graph-sync checkpoint). Then poll until chapters
  // appear or the graph task settles; folio drain returns before graph sync finishes.
  for (let attempt = 0; attempt < 3 && !publishOk; attempt += 1) {
    let kicked = false
    if (typeof revisionTaskId === "string" && revisionTaskId.length > 0) {
      for (const name of ["graph.continue", "graph.rerun"]) {
        try {
          await call("folio.action.enqueue", {
            projectId,
            workspaceRootRef,
            name,
            input: { revisionTaskId },
            drain: true,
          })
          record(`publish.folio.${name}.${String(attempt + 1)}`, "warn", `${name} drained`)
          kicked = true
          break
        } catch (error) {
          record(`publish.folio.${name}.${String(attempt + 1)}`, "warn", error instanceof Error ? error.message.slice(0, 160) : String(error))
        }
      }
    }

    const recoverable = await call("turn.recoverable.list", { projectId, workspaceRootRef }).catch(() => ({ tasks: [] }))
    const task = (recoverable.tasks ?? [])[0]
    if (!kicked && task !== undefined) {
      record(`publish.recover.${String(attempt + 1)}`, "warn", `resume ${task.taskId} phase=${task.phase ?? "?"}`)
      // Fire-and-forget style: resume may return a handle while work continues.
      await call("turn.resume", {
        projectId,
        workspaceRootRef,
        taskId: task.taskId,
        mode: "retry_phase",
        resetMetricIds: task.blockedMetrics ?? [],
        maxModelCalls: 40,
        deadlineMs: 900_000,
      }).catch((error) => {
        record(`publish.recover.${String(attempt + 1)}.error`, "warn", error instanceof Error ? error.message.slice(0, 160) : String(error))
      })
      kicked = true
    }

    const waitDeadline = Date.now() + 600_000
    while (Date.now() < waitDeadline) {
      const chaptersNow = await call("chapter.list", { projectId, workspaceRootRef })
      if (chaptersNow.length > 0) {
        publishOk = true
        break
      }
      const graphs = await call("chapter.graphRevision.list", { projectId, workspaceRootRef }).catch(() => [])
      const related = (Array.isArray(graphs) ? graphs : []).filter((item) => (
        item?.revisionTaskId === revisionTaskId || item?.id === revisionTaskId
      ))
      const busy = related.some((item) => /running|pending|committing/iu.test(String(item?.status ?? item?.graphSyncStatus ?? "")))
      record(`publish.wait.${String(attempt + 1)}`, "warn", {
        related: related.map((item) => ({
          status: item?.status,
          graphSyncStatus: item?.graphSyncStatus,
          error: item?.error,
        })),
        busy,
      })
      if (!busy) break
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
    published = await call("synopsis.conversation.list", { projectId, workspaceRootRef })
    if (publishOk) break
  }
  record("publish.recovered", publishOk ? "pass" : "fail", lastAssistant(published))

  const chapters = await call("chapter.list", { projectId, workspaceRootRef })
  record("chapter.list", chapters.length > 0 ? "pass" : "fail", chapters)

  report.completedAt = new Date().toISOString()
  report.status = steps.every((step) => step.status !== "fail") && chapters.length > 0 ? "pass" : "fail"
  await mkdir(resolve(reportPath, ".."), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify({ status: report.status, reportPath }, null, 2))
  await container.close()
  process.exit(report.status === "pass" ? 0 : 1)
}

function needsModel(method) {
  return method === "synopsis.conversation.send"
    || method.startsWith("turn.")
    || method === "folio.action.enqueue"
}

function workStyleMarkdown() {
  return [
    "# 作品风格",
    "小说笔风：表现输出/笔风规则/悬疑恐怖.md",
    "小说大类规则：表现输出/小说大类规则/传统文学.md",
    "小说次大类规则：表现输出/小说次大类规则/菠萝包.md",
    "## 1. 语体笔风\n主锚：克制、冷峻的都市异闻笔调；描写密度适中，偏视觉与听觉；少解释，多动作与感官。",
    "## 2. 时代科技生活\n当代都市；随身手机、末班地铁、老式站台并存；机构写派出所、社区与地铁站务，不写玄幻门派。",
    "## 3. 规则称谓能力\n本作没有超能力；一切异常都以现实线索与人为痕迹解释；人物称谓按都市习惯。",
    "## 4. 命名\n人名用双音节或三音节，姓氏错开。正例：林烬、周砚。反例：林霜与林雪同批出现。地点用真实的城市物件命名。",
    "## 5. 角色声口\n主角说话短、少修饰，示例：「先看监控。」配角话多但绕，示例：「你要是现在就报警……那我可就不好交代了。」",
    "## 6. 尺度意象章钩\n暴力写后果，不展示过程；章末落在一个具体物件或选择代价上。",
    "## 7. 人称指称\n第三人称限知，贴主角；正文以姓名为主。示例句：林烬把信折好，没抬头。",
    "## 8. 句子与对话\n句长偏短，段落按场景切；对话白话口语，禁全员书面腔。正例：「走吧。」反例：众人齐声以标准书面语表态。",
  ].join("\n\n")
}

async function readWorkspaceFile(call, projectId, workspaceRootRef, relativePath) {
  try {
    const result = await call("workspace.read", { projectId, workspaceRootRef, relativePath })
    return typeof result?.content === "string" ? result.content : undefined
  } catch {
    return undefined
  }
}

function lastAssistant(result) {
  return result.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? ""
}

function choiceLabels(result) {
  return (result.messages.filter((message) => message.role === "assistant").at(-1)?.choices ?? [])
    .map((choice) => choice.label)
}

main().catch(async (error) => {
  record("fatal", "fail", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error))
  report.completedAt = new Date().toISOString()
  report.status = "fail"
  try {
    await mkdir(resolve(reportPath, ".."), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  } catch { /* keep original error */ }
  process.exit(1)
})
