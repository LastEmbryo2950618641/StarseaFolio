import type { AIPhase } from "@starseafolio/contracts"

/** Canonical prompt documents. Runtime loads these directly; source files stay for compatibility. */
export const SYSTEM_PROMPT_DOCS = Object.freeze([
  "resources/v1/prompt-docs/system/01-world-and-base.md",
  "resources/v1/prompt-docs/system/02-content-and-safety.md",
  "resources/v1/prompt-docs/system/03-writing-voice.md",
  "resources/v1/prompt-docs/system/04-query-facts.md",
  "resources/v1/prompt-docs/system/05-revision-audit.md",
] as const)

export const DISCUSS_SYSTEM_PROMPT_DOC = "resources/v1/prompt-docs/system/06-discuss-skill-index.md" as const
export const BEFORE_USER_MESSAGE_PROMPT_DOC = "resources/v1/prompt-docs/dynamic/01-before-user-message.md" as const
export const AFTER_USER_MESSAGE_PROMPT_DOC = "resources/v1/prompt-docs/dynamic/02-after-user-message.md" as const
export const NEW_CHAPTER_STAGE_PROMPT_DOC = "resources/v1/prompt-docs/stages/01-new-chapter.md" as const
export const COMPOSE_STAGE_PROMPT_DOC = "resources/v1/prompt-docs/stages/02-compose.md" as const
export const INGESTION_STAGE_PROMPT_DOC = "resources/v1/prompt-docs/stages/04-ingestion.md" as const

export const MESSAGE_WRAPPER_MARKERS = Object.freeze({
  before: "message:before-user-message",
  after: "message:after-user-message",
} as const)

export const STAGE_ENTRY_MARKERS = Object.freeze({
  newChapterEntry: "stage:new-chapter-entry",
  composeRequest: "stage:compose-request",
  composeEntry: "stage:compose-entry",
  ingestionEntry: "stage:ingestion-entry",
} as const)

export type StagePromptKind = "new-chapter" | "compose-request" | "compose" | "ingestion"

export type PromptDocDefinition = Readonly<{
  id: string
  resourcePath: string
  tag: "系统" | "消息前" | "消息后" | "新章节阶段" | "构思阶段" | "章节入库阶段"
}>

export const STAGE_PROMPT_DOCS = Object.freeze([
  { id: "new-chapter", resourcePath: NEW_CHAPTER_STAGE_PROMPT_DOC, tag: "新章节阶段" },
  { id: "compose", resourcePath: COMPOSE_STAGE_PROMPT_DOC, tag: "构思阶段" },
  { id: "ingestion", resourcePath: INGESTION_STAGE_PROMPT_DOC, tag: "章节入库阶段" },
] as const satisfies readonly PromptDocDefinition[])

export const DYNAMIC_PROMPT_DOCS = Object.freeze([
  { id: "before-user-message", resourcePath: BEFORE_USER_MESSAGE_PROMPT_DOC, tag: "消息前" },
  { id: "after-user-message", resourcePath: AFTER_USER_MESSAGE_PROMPT_DOC, tag: "消息后" },
] as const satisfies readonly PromptDocDefinition[])

const NEW_CHAPTER_PHASES = ["interpret", "rule_assembly", "source_retrieval", "emergence_planning", "emergence_review"] as const
const INGESTION_PHASES = [
  "settings_extraction",
  "work_style_revision",
  "graph_governance",
  "graph_structure_plan",
  "graph_capacity_rewrite",
  "graph_spacetime_settlement",
  "graph_retrieval_design",
  "graph_governance_review",
  "semantic_review",
  "dependency_audit",
  "settlement_review",
  "frontier_settlement",
  "commit_review",
  "chapter_naming",
  "work_naming",
  "revision_review",
] as const

const STAGE_BY_PHASE: Record<string, (typeof STAGE_PROMPT_DOCS)[number]["id"]> = {
  ...Object.fromEntries(NEW_CHAPTER_PHASES.map((phase) => [phase, "new-chapter"])),
  synopsis_discuss: "compose",
  draft: "compose",
  ...Object.fromEntries(INGESTION_PHASES.map((phase) => [phase, "ingestion"])),
}

const DYNAMIC_BY_PHASE: Partial<Record<AIPhase, string>> = {
  response_review: "after-user-message",
}

export function stagePromptDocForPhase(phase: AIPhase): PromptDocDefinition | undefined {
  const dynamic = DYNAMIC_BY_PHASE[phase]
  if (dynamic !== undefined) {
    return DYNAMIC_PROMPT_DOCS.find((doc) => doc.id === dynamic)
  }
  const stage = STAGE_BY_PHASE[phase]
  return STAGE_PROMPT_DOCS.find((doc) => doc.id === stage)
}

export const STAGE_SKILL_DOCS: Readonly<Record<string, Readonly<{ doc: string; marker: string }>>> = Object.freeze({
  "plot-synopsis": { doc: "compose", marker: "skill:plot-synopsis" },
  "discuss-workflow": { doc: "compose", marker: "skill:discuss-workflow" },
  "starsea-writing": { doc: "compose", marker: "skill:starsea-writing" },
  "user-to-synopsis": { doc: "compose", marker: "skill:user-to-synopsis" },
  "synopsis-to-outline": { doc: "compose", marker: "skill:synopsis-to-outline" },
  "book-cold-start": { doc: "compose", marker: "skill:book-cold-start" },
  "outline-to-draft": { doc: "compose", marker: "skill:outline-to-draft" },
  "settings-revision": { doc: "ingestion", marker: "skill:settings-revision" },
})

export function stagePromptDocForSkill(skillId: string): PromptDocDefinition | undefined {
  const mapping = STAGE_SKILL_DOCS[skillId]
  return mapping === undefined ? undefined : STAGE_PROMPT_DOCS.find((doc) => doc.id === mapping.doc)
}

export function extractPromptDocSection(markdown: string, marker: string): string {
  const start = `<!-- ${marker} -->`
  const end = `<!-- /${marker} -->`
  const startAt = markdown.indexOf(start)
  if (startAt < 0) throw new Error(`Missing prompt document section: ${marker}`)
  const contentAt = startAt + start.length
  const endAt = markdown.indexOf(end, contentAt)
  if (endAt < 0) throw new Error(`Unclosed prompt document section: ${marker}`)
  return markdown.slice(contentAt, endAt).trimStart().replace(/^## [^\n]*\n+/u, "").trim()
}

const INTERNAL_SECTION_BLOCK_PATTERN = /<!--\s*(?:phase|query|skill):[^\s>]+\s*-->[\s\S]*?<!--\s*\/(?:phase|query|skill):[^\s>]+\s*-->/gu

/**
 * Extract a marked section when present; otherwise fall back to user-edited plain markdown
 * (stripping YAML frontmatter and any internal phase/query/skill blocks).
 */
export function extractPromptDocSectionOrFull(markdown: string, marker: string): string {
  const start = `<!-- ${marker} -->`
  if (markdown.includes(start)) {
    return extractPromptDocSection(markdown, marker)
  }
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "")
  return withoutFrontmatter.replace(INTERNAL_SECTION_BLOCK_PATTERN, "").trim()
}
