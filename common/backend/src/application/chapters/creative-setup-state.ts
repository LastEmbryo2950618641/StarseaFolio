import { parseCharacterProfile } from "@starseafolio/contracts"

import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

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
  opening: renderRuntimePrompt("discuss-creative-setup", "volume-opening"),
  climaxes: renderRuntimePrompt("discuss-creative-setup", "volume-climaxes"),
  ending: renderRuntimePrompt("discuss-creative-setup", "volume-ending"),
  subplots: renderRuntimePrompt("discuss-creative-setup", "volume-subplots"),
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
  const userRevisionRule = renderRuntimePrompt("discuss-creative-setup", "latest-user-revision")
  if (parsed.scope === "protagonist" && parsed.status === "awaiting_write") {
    return renderRuntimePrompt("discuss-creative-setup", "protagonist-supplement", {
      userRevisionRule,
      answers: JSON.stringify(parsed.answers, null, 2),
    })
  }
  const current = nextCreativeSetupField(parsed)
  assert(current !== undefined, "interview prompts require a collecting state")
  // The request already carries every answer verbatim. Reference that single
  // source instead of creating a truncated, potentially contradictory copy.
  const confirmed = fields(parsed.scope).filter((field) => Object.hasOwn(parsed.answers, field.key))
    .map((field) => `${field.key}（${field.label}）`)
  const isProtagonist = parsed.scope === "protagonist"
  return renderRuntimePrompt("discuss-creative-setup", "collecting", {
    scopeLabel: isProtagonist ? "主角" : `卷 ${volumeName ?? parsed.scope.slice(7)}`,
    fieldKey: current.key,
    fieldLabel: current.label,
    volumeTopic: isProtagonist ? "" : "\n\n" + renderRuntimePrompt("discuss-creative-setup", "volume-question", {
      question: volumeFieldPrompts[current.key] ?? current.label,
    }),
    confirmedFields: confirmed.join("、") || "（尚无）",
    userRevisionRule,
    volumeConstraints: isProtagonist ? "" : "\n\n" + renderRuntimePrompt("discuss-creative-setup", "volume-constraints"),
    answerRule: renderRuntimePrompt("discuss-creative-setup", current.required ? "required-answer" : "optional-answer"),
    subplotRule: current.key === "subplots" ? "\n\n" + renderRuntimePrompt("discuss-creative-setup", "subplot-answer") : "",
  })
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
