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
export const AFTER_USER_MESSAGE_PROMPT_DOC = "resources/v1/prompt-docs/dynamic/02-after-user-message.md" as const

export type PromptDocDefinition = Readonly<{
  id: string
  resourcePath: string
  tag: "系统" | "消息前" | "消息后" | "新章节阶段" | "梗概阶段" | "草稿阶段" | "章节入库阶段"
}>

export const STAGE_PROMPT_DOCS = Object.freeze([
  { id: "new-chapter", resourcePath: "resources/v1/prompt-docs/stages/01-new-chapter.md", tag: "新章节阶段" },
  { id: "synopsis", resourcePath: "resources/v1/prompt-docs/stages/02-synopsis.md", tag: "梗概阶段" },
  { id: "draft", resourcePath: "resources/v1/prompt-docs/stages/03-draft.md", tag: "草稿阶段" },
  { id: "ingestion", resourcePath: "resources/v1/prompt-docs/stages/04-ingestion.md", tag: "章节入库阶段" },
] as const satisfies readonly PromptDocDefinition[])

export const DYNAMIC_PROMPT_DOCS = Object.freeze([
  { id: "before-user-message", resourcePath: "resources/v1/prompt-docs/dynamic/01-before-user-message.md", tag: "消息前" },
  { id: "after-user-message", resourcePath: "resources/v1/prompt-docs/dynamic/02-after-user-message.md", tag: "消息后" },
] as const satisfies readonly PromptDocDefinition[])

const NEW_CHAPTER_PHASES = ["interpret", "rule_assembly", "source_retrieval", "emergence_planning", "emergence_review"] as const
const INGESTION_PHASES = [
  "settings_extraction",
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

const STAGE_BY_PHASE: Record<string, "new-chapter" | "synopsis" | "draft" | "ingestion"> = {
  ...Object.fromEntries(NEW_CHAPTER_PHASES.map((phase) => [phase, "new-chapter"])),
  synopsis_discuss: "synopsis",
  draft: "draft",
  ...Object.fromEntries(INGESTION_PHASES.map((phase) => [phase, "ingestion"])),
}

const DYNAMIC_BY_PHASE: Partial<Record<AIPhase, string>> = {
  work_style_revision: "before-user-message",
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
  "plot-synopsis": { doc: "synopsis", marker: "skill:plot-synopsis" },
  "discuss-workflow": { doc: "synopsis", marker: "skill:discuss-workflow" },
  "starsea-writing": { doc: "synopsis", marker: "skill:starsea-writing" },
  "user-to-synopsis": { doc: "synopsis", marker: "skill:user-to-synopsis" },
  "synopsis-to-outline": { doc: "synopsis", marker: "skill:synopsis-to-outline" },
  "book-cold-start": { doc: "synopsis", marker: "skill:book-cold-start" },
  "outline-to-draft": { doc: "draft", marker: "skill:outline-to-draft" },
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
