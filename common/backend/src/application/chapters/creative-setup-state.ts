import { parseCharacterProfile } from "@starseafolio/contracts"

export type CreativeSetupScope = "protagonist" | `volume:${string}`

export type CreativeSetupState = {
  version: 1
  scope: CreativeSetupScope
  status: "collecting" | "awaiting_write" | "ready"
  answers: Record<string, string>
  /** Server-issued question ID to its confirmed field, for explicit-send replay detection. */
  answeredQuestions?: Record<string, string>
  pendingQuestion?: { id: string; field: string }
  settingsPath?: string
  settingsDigest?: string
  updatedAtMs: number
}

export type CreativeSetupField = Readonly<{
  key: string
  label: string
  /** Requires substantive content. Every field still requires an explicit reply. */
  required: boolean
}>

export const protagonistCreativeSetupFields: readonly CreativeSetupField[] = Object.freeze([
  { key: "personality", label: "性格爱好", required: true },
  { key: "appearance", label: "样貌", required: true },
  { key: "age", label: "年龄", required: true },
  { key: "background", label: "身世背景", required: true },
  { key: "goal", label: "目标", required: true },
  { key: "other", label: "其他设定", required: false },
  { key: "remarks", label: "备注", required: false },
].map((field) => Object.freeze(field)))

export const volumeCreativeSetupFields: readonly CreativeSetupField[] = Object.freeze([
  { key: "opening", label: "开篇", required: true },
  { key: "climaxes", label: "高潮", required: true },
  { key: "ending", label: "结尾", required: true },
  { key: "subplots", label: "支线", required: true },
].map((field) => Object.freeze(field)))

const volumeFieldPrompts: Readonly<Record<string, string>> = {
  opening: "主角本卷开场场景",
  climaxes: "本卷一个或多个高潮（多选）",
  ending: "本卷结束结果",
  subplots: "遭遇事件与起止时机/起因高潮结局（多选，无支线可明确选择）",
}

const placeholders = new Set(["继续", "好的", "可以", "好", "嗯", "ok", "okay", "下一步", "继续讨论", "你的想法", "我有自己的想法"])
const nonanswers = new Set(["无", "没有", "暂无", "不知道", "不确定", "随便", "交给ai", "无交给ai", "ai决定", "由ai决定", "你决定", "由你决定", "暂不设置", "待定", "未定", "略", "无所谓", "tbd", "none", "na"])

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid creative setup state: ${message}`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  assert(Object.keys(value).every((key) => keys.includes(key)), "unrecognized field")
}

function validScope(value: unknown): value is CreativeSetupScope {
  return typeof value === "string" && (value === "protagonist"
    || (value.startsWith("volume:") && value.slice(7).trim().length > 0 && value === value.trim()
      && value.slice(7) === value.slice(7).trim() && !/[\r\n\0]/u.test(value)))
}

function timestamp(now: unknown): asserts now is number {
  assert(typeof now === "number" && Number.isSafeInteger(now) && now >= 0, "timestamp must be a nonnegative safe integer")
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function fields(scope: CreativeSetupScope): readonly CreativeSetupField[] {
  return scope === "protagonist" ? protagonistCreativeSetupFields : volumeCreativeSetupFields
}

function answerText(field: CreativeSetupField, value: unknown): string {
  assert(nonempty(value), `${field.key} requires an explicit answer`)
  const answer = value.trim()
  const token = answer.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "")
  assert(token.length > 0 && !placeholders.has(token), `${field.key} cannot be a continuation or acknowledgement`)
  assert(!field.required || !nonanswers.has(token), `${field.key} requires substantive content`)
  return answer
}

/** Validate untrusted persisted JSON and its progression invariants; never infer readiness. */
export function parseCreativeSetupState(value: unknown): CreativeSetupState {
  assert(record(value), "expected an object")
  onlyKeys(value, ["version", "scope", "status", "answers", "answeredQuestions", "pendingQuestion", "settingsPath", "settingsDigest", "updatedAtMs"])
  assert(value.version === 1, "unsupported version")
  assert(validScope(value.scope), "unsupported or empty scope")
  assert(value.status === "collecting" || value.status === "awaiting_write" || value.status === "ready", "unsupported status")
  timestamp(value.updatedAtMs)
  assert(record(value.answers), "answers must be a string record")
  const definitions = fields(value.scope)
  onlyKeys(value.answers, definitions.map((field) => field.key))
  const answers: Record<string, string> = {}
  let next: CreativeSetupField | undefined
  for (const field of definitions) {
    if (!Object.hasOwn(value.answers, field.key)) {
      next ??= field
    } else {
      assert(next === undefined, "answers must follow questionnaire order")
      const answer = value.answers[field.key]
      answerText(field, answer)
      assert(typeof answer === "string", "answers must be strings")
      answers[field.key] = answer
    }
  }
  assert((value.status === "collecting") === (next !== undefined), "status does not match answer completeness")
  const state: CreativeSetupState = {
    version: 1, scope: value.scope, status: value.status, answers, updatedAtMs: value.updatedAtMs,
  }
  if (Object.hasOwn(value, "answeredQuestions")) {
    assert(record(value.answeredQuestions), "answeredQuestions must be a string record")
    state.answeredQuestions = Object.fromEntries(Object.entries(value.answeredQuestions).map(([id, field]) => {
      assert(nonempty(id), "answered question ID is required")
      assert(typeof field === "string" && Object.hasOwn(answers, field), "answered question must reference an answered field")
      return [id, field]
    }))
  }
  if (Object.hasOwn(value, "pendingQuestion")) {
    assert(record(value.pendingQuestion), "invalid pending question")
    onlyKeys(value.pendingQuestion, ["id", "field"])
    assert(nonempty(value.pendingQuestion.id), "question ID is required")
    assert(!Object.hasOwn(state.answeredQuestions ?? {}, value.pendingQuestion.id), "pending question ID has already been answered")
    assert(value.status === "collecting" && next !== undefined && value.pendingQuestion.field === next.key, "pending question must address the current field")
    state.pendingQuestion = { id: value.pendingQuestion.id, field: next.key }
  }
  if (value.status === "ready") {
    assert(nonempty(value.settingsPath) && nonempty(value.settingsDigest), "ready requires a written settings path and digest")
    state.settingsPath = value.settingsPath
    state.settingsDigest = value.settingsDigest
  } else {
    assert(!Object.hasOwn(value, "settingsPath") && !Object.hasOwn(value, "settingsDigest"), "unwritten states cannot have write metadata")
  }
  return state
}

export function initialCreativeSetupState(scope: string, now: number): CreativeSetupState {
  return parseCreativeSetupState({ version: 1, scope, status: "collecting", answers: {}, updatedAtMs: now })
}

export function nextCreativeSetupField(state: CreativeSetupState): CreativeSetupField | undefined {
  const parsed = parseCreativeSetupState(state)
  return fields(parsed.scope).find((field) => !Object.hasOwn(parsed.answers, field.key))
}

/** A retry returns the existing pending identity, without advancing its timestamp. */
export function openCreativeSetupQuestion(state: CreativeSetupState, id: string, now: number): CreativeSetupState {
  const parsed = parseCreativeSetupState(state)
  timestamp(now)
  assert(nonempty(id), "question ID is required")
  assert(parsed.status === "collecting", "questions can only open while collecting")
  if (parsed.pendingQuestion !== undefined) return parsed
  assert(!Object.hasOwn(parsed.answeredQuestions ?? {}, id), "question ID has already been answered")
  const field = nextCreativeSetupField(parsed)
  assert(field !== undefined, "no question remains")
  return { ...parsed, pendingQuestion: { id, field: field.key }, updatedAtMs: now }
}

/** Call only for an explicit user send; autonomous model output is never an answer. */
export function answerCreativeSetupQuestion(
  state: CreativeSetupState,
  input: { questionId: string; answer: string; now: number },
): CreativeSetupState {
  const parsed = parseCreativeSetupState(state)
  timestamp(input.now)
  const pending = parsed.pendingQuestion
  assert(parsed.status === "collecting" && pending !== undefined && pending.id === input.questionId, "stale or unsolicited question answer")
  const field = nextCreativeSetupField(parsed)
  assert(field !== undefined, "no question remains")
  const answers = { ...parsed.answers, [field.key]: answerText(field, input.answer) }
  return {
    version: 1,
    scope: parsed.scope,
    status: fields(parsed.scope).every((definition) => Object.hasOwn(answers, definition.key)) ? "awaiting_write" : "collecting",
    answers,
    answeredQuestions: { ...parsed.answeredQuestions, [pending.id]: pending.field },
    updatedAtMs: input.now,
  }
}

/** The caller acknowledges an actual successful write/readback; this helper performs no I/O. */
export function markCreativeSetupWritten(
  state: CreativeSetupState,
  input: { path: string; digest: string; now: number },
): CreativeSetupState {
  const parsed = parseCreativeSetupState(state)
  assert(parsed.status === "awaiting_write", "only awaiting_write can become ready")
  timestamp(input.now)
  assert(nonempty(input.path) && nonempty(input.digest), "written path and digest are required")
  return { ...parsed, status: "ready", settingsPath: input.path.trim(), settingsDigest: input.digest.trim(), updatedAtMs: input.now }
}

/** Invalidate a prior write without discarding the user's confirmed core. */
export function invalidateCreativeSetupWritten(state: CreativeSetupState, now: number): CreativeSetupState {
  const parsed = parseCreativeSetupState(state)
  timestamp(now)
  assert(parsed.status !== "collecting", "an incomplete questionnaire has no write to invalidate")
  return {
    version: 1, scope: parsed.scope, status: "awaiting_write", answers: parsed.answers,
    ...(parsed.answeredQuestions === undefined ? {} : { answeredQuestions: parsed.answeredQuestions }),
    updatedAtMs: now,
  }
}

function confirmedAnswer(state: CreativeSetupState, field: CreativeSetupField): string {
  const answer = state.answers[field.key]
  assert(answer !== undefined, `${field.key} has not been answered`)
  return answer
}

export function buildCreativeSetupPrompt(state: CreativeSetupState, volumeName?: string): string {
  const parsed = parseCreativeSetupState(state)
  const userRevisionRule = "用户最新明确修订优先于旧答案、旧设定和 AI 提案；已确认内容是当前基线，不是永久冻结。用户明确修改时，仅更新受影响内容并保留其余内容；含义不清或范围不明时才询问，不得把用户举例、疑问或假设自动当成修订。AI 不得擅自改写用户要求，也不能以旧记录否定用户的新要求。"
  if (parsed.scope === "protagonist" && parsed.status === "awaiting_write") {
    return [
      "主角七项用户核心均已明确确认，状态为 awaiting_write；现在仅生成 AI 补充设定，不再提问。",
      userRevisionRule,
      `完整用户核心基线（AI 不得擅自修改、覆盖、省略或重新解释，用户可明确修订）：\n${JSON.stringify(parsed.answers, null, 2)}`,
      "仅返回 artifact.protagonistSupplementFields（字段名到值的对象，不含 schemaVersion 或 fields 外壳），补充符合本书题材与世界观的姓名、身份、性别、能力、人物关系等独立字段；必须有非空姓名。能力可为列表，人物关系可为对象。不要把所有资料写成 Markdown 长文或塞入单个补充字段。用户已指定的姓名、能力、关系及其他核心必须原样保留；AI 只可完善未明确的内容，所有补充须与七项核心一致。",
      "禁止调用任何工具、请求工具调用、读取或写入文件；禁止输出章节、梗概、卷规划、synopsis、outline、正文、其他 artifact 写入字段或讨论选项。",
      "AI 返回的补充不是写入成功证明，不得宣布 ready；由宿主合并用户核心与补充，实际保存并读回核对后才能确认写入。",
    ].join("\n\n")
  }
  const current = nextCreativeSetupField(parsed)
  assert(current !== undefined, "interview prompts require a collecting state")
  // The request already carries every answer verbatim. Reference that single
  // source instead of creating a truncated, potentially contradictory copy.
  const confirmed = fields(parsed.scope).filter((field) => Object.hasOwn(parsed.answers, field.key))
    .map((field) => `${field.key}（${field.label}）`)
  return [
    `创作设定访谈：${parsed.scope === "protagonist" ? "主角" : `卷 ${volumeName ?? parsed.scope.slice(7)}`}。`,
    `当前只询问 ${current.key}（${current.label}）。`,
    parsed.scope === "protagonist" ? "" : `本题内容：${volumeFieldPrompts[current.key] ?? current.label}。`,
    `已确认用户核心字段：${confirmed.join("、") || "（尚无）"}。完整基线见本次请求 input.synopsisDiscuss.creativeSetup.answers，必须逐项完整读取，不得截断或擅自代答；本轮明确修订以 input.userInput 为准。`,
    userRevisionRule,
    "未经用户确认的主线、阶段目标、章节数、节奏安排和选项都只是历史 AI 提案，不得当成既定计划；不得口头确认用户新要求后仍沿用旧方案。",
    parsed.scope === "protagonist" ? "" : "opening、climaxes、ending、subplots 均属于当前卷；ending 必须在当前卷结束前达成，不得降格为全书远期目标或挪到后续卷。围绕用户已确认的本卷主线生成当前问题及选项；支线须服务该主线，不得借支线缩小主线范围。若旧章节数容不下用户目标，应在规划阶段调整篇幅或询问用户，不得替用户删减目标。",
    "用户要求按已有章节推进、稍后提供章节或从原文提取时，应保留该要求并等待用户提供原文，不得把这类指令补成自行编造的开篇、高潮或主线。",
    "结合已有题材、世界观和已确认内容提问；必须由 AI 生成 2-4 个与本书题材及当前问题具体相关的可选答案，choices 中 action 全部为 continue_discuss，不使用通用确认项。",
    "“你的想法”由 UI 单独提供自由输入入口，AI 不要重复生成该选项，也不要将它当成答案。",
    current.required ? "本项必须由用户明确回答具体设定，不接受空白、继续、好的、可以或交给AI等代答。" : "本项仍须用户明确回答，允许用户明确选择“无”或“交给AI”，不可自动跳过。",
    current.key === "subplots" ? "支线须用户明确回答；允许明确选择“无支线”，不可根据沉默推断。" : "",
    "未获用户修改授权时，AI 只能补充不冲突的细节，不能把自己的建议计入已确认答案。",
    "访谈期间仅输出本次问题内容和讨论选项。禁止读取或写入文件、执行写入、调用任何工具或请求工具调用；禁止生成 synopsis、outline、正文等写入内容。",
    "问题确认由宿主绑定并校验；只有显式用户发送才能确认答案。自主消息和继续执行不得推进问卷，不要生成或索取内部问题编号。",
  ].filter(Boolean).join("\n\n")
}

const coreStart = "<!-- creative-setup:protagonist:user-core:start -->"
const coreEnd = "<!-- creative-setup:protagonist:user-core:end -->"
const aiStart = "<!-- creative-setup:protagonist:ai-additions:start -->"
const aiEnd = "<!-- creative-setup:protagonist:ai-additions:end -->"
const markers = [coreStart, coreEnd, aiStart, aiEnd]

type SectionBounds = { start: number; end: number }

function sectionBounds(text: string, start: string, end: string): SectionBounds | undefined {
  const positions = (marker: string): number[] => {
    const result: number[] = []
    let offset = 0
    for (const line of text.split("\n")) {
      if (line.replace(/\r$/u, "") === marker) result.push(offset)
      offset += line.length + 1
    }
    return result
  }
  const starts = positions(start)
  const ends = positions(end)
  if (starts.length === 0 && ends.length === 0) return undefined
  const first = starts[0]
  const last = ends[0]
  assert(starts.length === 1 && ends.length === 1 && first !== undefined && last !== undefined && first < last, "ambiguous or malformed Markdown section boundaries")
  return { start: first, end: last + end.length }
}

function upsertSection(text: string, start: string, end: string, content: string): string {
  const bounds = sectionBounds(text, start, end)
  const section = `${start}\n${content}\n${end}`
  if (bounds !== undefined) return text.slice(0, bounds.start) + section + text.slice(bounds.end)
  const separator = text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"
  return text + separator + section
}

function completeForSerialization(state: CreativeSetupState, protagonist: boolean): CreativeSetupState {
  const parsed = parseCreativeSetupState(state)
  assert((parsed.scope === "protagonist") === protagonist, "wrong serializer for scope")
  assert(parsed.status !== "collecting", "cannot serialize incomplete answers")
  return parsed
}

/** Check the documented user core, while permitting later substantive edits to its values. */
export function protagonistCreativeSetupMarkdownHasContent(markdown: string): boolean {
  try {
    if (markdown.trimStart().startsWith("{")) {
      // The persisted interview state enforces the initial core write. Later field
      // additions/deletions must not reopen the questionnaire or restore removed fields.
      parseCharacterProfile(markdown)
      return true
    }
    const bounds = sectionBounds(markdown, coreStart, coreEnd)
    if (bounds === undefined) return false
    const lines = markdown.slice(bounds.start + coreStart.length, bounds.end - coreEnd.length).split(/\r?\n/u)
    for (const field of protagonistCreativeSetupFields) {
      const heading = `### ${field.label}`
      const matches = lines.flatMap((line, index) => line.trim() === heading ? [index] : [])
      const start = matches[0]
      if (matches.length !== 1 || start === undefined) return false
      const rest = lines.slice(start + 1)
      const end = rest.findIndex(line => /^###\s/u.test(line))
      const value = (end < 0 ? rest : rest.slice(0, end)).map(line => line.replace(/^> ?/u, "")).join("\n")
      answerText(field, value)
    }
    return true
  } catch {
    return false
  }
}

/** Upsert bounded sections only, retaining all pre-existing surrounding content verbatim. */
export function serializeProtagonistCreativeSetupMarkdown(
  state: CreativeSetupState,
  options: { existingMarkdown?: string; aiAdditions?: string } = {},
): string {
  const parsed = completeForSerialization(state, true)
  const existing = options.existingMarkdown ?? ""
  const core = sectionBounds(existing, coreStart, coreEnd)
  const ai = sectionBounds(existing, aiStart, aiEnd)
  assert(core === undefined || ai === undefined || core.end <= ai.start || ai.end <= core.start, "Markdown sections must not overlap")
  // Blockquote every answer line so user-supplied Markdown cannot close the core section.
  const content = ["## 用户核心设定（AI 不得擅自修改，用户可修订）", ...protagonistCreativeSetupFields.map((field) =>
    `### ${field.label}\n${confirmedAnswer(parsed, field).split(/\r?\n/u).map((line) => `> ${line}`).join("\n")}`,
  )].join("\n\n")
  let result = upsertSection(existing, coreStart, coreEnd, content)
  const aiAdditions = options.aiAdditions
  if (aiAdditions !== undefined) {
    assert(!markers.some((marker) => aiAdditions.includes(marker)), "AI additions cannot contain section boundaries")
    result = upsertSection(result, aiStart, aiEnd, `## AI 补充（不得覆盖用户核心）\n\n${aiAdditions.trim()}`)
  }
  return result
}

export function serializeVolumeCreativeSetupText(state: CreativeSetupState): string {
  const parsed = completeForSerialization(state, false)
  return volumeCreativeSetupFields.map((field) => `${field.label}：${confirmedAnswer(parsed, field)}`).join("\n")
}
