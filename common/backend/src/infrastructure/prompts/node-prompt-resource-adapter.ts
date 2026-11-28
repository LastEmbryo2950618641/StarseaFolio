import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { AIPhase } from "@starseafolio/contracts"
import {
  AFTER_USER_MESSAGE_PROMPT_DOC,
  BEFORE_USER_MESSAGE_PROMPT_DOC,
  BASE_RULES_RESOURCE,
  CONTENT_HANDLING_RESOURCE,
  DISCUSS_CREATION_DESK_WORKFLOW_RESOURCE,
  OUTLINE_TO_DRAFT_GUIDE_RESOURCE,
  PLOT_SYNOPSIS_GUIDE_RESOURCE,
  PROMPT_CONTRACT_VERSION,
  SETTINGS_QUERY_GUIDE_RESOURCE,
  SETTINGS_REVISION_GUIDE_RESOURCE,
  SYNOPSIS_TO_OUTLINE_GUIDE_RESOURCE,
  USER_TO_SYNOPSIS_GUIDE_RESOURCE,
  WEBNOVEL_PROSE_LOGIC_RESOURCE,
  WORLD_RULES_OVERVIEW_RESOURCE,
  PLATFORM_BASE_RULE_RESOURCES,
  SYNOPSIS_DISCUSS_BASE_RULE_RESOURCES,
  defaultSkillIdsForPhase,
  tryExtractPromptDocSection,
  sharedStageMarkdown,
  STAGE_PROMPT_DOCS,
  formatSkillEvidenceHeader,
  listPlatformSkills,
  resolvePromptDefinition,
  resolveSkillDefinition,
  stagePromptDocForPhase,
  stagePromptDocForSkill,
  STAGE_SKILL_DOCS,
  SYNOPSIS_SKILLS_PROTOCOL,
} from "@starseafolio/prompt-contracts"

import type {
  LoadedSkillResource,
  PromptResource,
  PromptResourcePort,
  UserMessageBracketInput,
  UserMessageBrackets,
} from "../../application/index.js"
import { digest } from "../../core/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import type { PromptLibraryService } from "./prompt-library.js"

export class NodePromptResourceAdapter implements PromptResourcePort {
  public constructor(
    private readonly promptPackageRoot: string,
    private readonly promptLibrary?: Pick<PromptLibraryService, "readOverride">,
  ) {}

  public async loadWorldRulesOverview(): Promise<PromptResource> {
    return this.load(WORLD_RULES_OVERVIEW_RESOURCE)
  }

  public async loadBaseRules(): Promise<PromptResource> {
    return this.load(BASE_RULES_RESOURCE)
  }

  public async loadContentHandling(): Promise<PromptResource> {
    return this.load(CONTENT_HANDLING_RESOURCE)
  }

  public async loadWebnovelProseLogic(): Promise<PromptResource> {
    return this.load(WEBNOVEL_PROSE_LOGIC_RESOURCE)
  }

  public async loadPlotSynopsisGuide(): Promise<PromptResource> {
    return this.load(PLOT_SYNOPSIS_GUIDE_RESOURCE)
  }

  public async loadUserToSynopsisGuide(): Promise<PromptResource> {
    return this.loadStageGuide("user-to-synopsis", USER_TO_SYNOPSIS_GUIDE_RESOURCE)
  }

  public async loadSynopsisToOutlineGuide(): Promise<PromptResource> {
    return this.loadStageGuide("synopsis-to-outline", SYNOPSIS_TO_OUTLINE_GUIDE_RESOURCE)
  }

  public async loadOutlineToDraftGuide(): Promise<PromptResource> {
    return this.loadStageGuide("outline-to-draft", OUTLINE_TO_DRAFT_GUIDE_RESOURCE)
  }

  public async loadSettingsQueryGuide(): Promise<PromptResource> {
    return this.load(SETTINGS_QUERY_GUIDE_RESOURCE)
  }

  public async loadSettingsRevisionGuide(): Promise<PromptResource> {
    return this.load(SETTINGS_REVISION_GUIDE_RESOURCE)
  }

  public async loadDiscussCreationDeskWorkflow(): Promise<PromptResource> {
    return this.load(DISCUSS_CREATION_DESK_WORKFLOW_RESOURCE)
  }

  public async loadTurnSystemRules(): Promise<PromptResource> {
    return this.loadComposite("turn-system-rules", PLATFORM_BASE_RULE_RESOURCES)
  }

  public async loadSynopsisDiscussSystemRules(): Promise<PromptResource> {
    return this.loadComposite("synopsis-discuss-system-rules", SYNOPSIS_DISCUSS_BASE_RULE_RESOURCES)
  }

  public async loadPhase(phase: AIPhase, stage?: "ingestion" | "compose"): Promise<PromptResource> {
    const doc = stagePromptDocForPhase(phase)
    // 技术子阶段正文以阶段文档里的 phase 小节为准；显式 stage 只用于排除不属于该业务阶段的阶段。
    if (doc !== undefined && (stage === undefined || doc.id === stage)) {
      const marker = `phase:${phase.replaceAll("_", "-")}`
      const text = tryExtractPromptDocSection(await this.readBundledOrOverride(doc.resourcePath), marker)
      if (text !== undefined) return this.sectionResource(doc.resourcePath, marker, text)
    }
    return this.load(resolvePromptDefinition(phase).resourcePath)
  }

  public async listSkills(): Promise<readonly Readonly<{
    id: string
    name: string
    summary: string
    injectPolicy: string
    defaultPhases: readonly string[]
  }>[]> {
    return listPlatformSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      injectPolicy: skill.injectPolicy,
      defaultPhases: [...skill.defaultPhases],
    }))
  }

  public async loadSkill(
    skillId: string,
    options?: Readonly<{ includeReferences?: boolean }>,
  ): Promise<LoadedSkillResource> {
    const skill = resolveSkillDefinition(skillId)
    if (skill === undefined) {
      throw new Error(`Unknown skill: ${skillId}`)
    }
    const includeReferences = options?.includeReferences === true
    const stageSkill = STAGE_SKILL_DOCS[skillId]
    if (stageSkill !== undefined) {
      const stageDoc = stagePromptDocForSkill(skillId)
      if (stageDoc === undefined) throw new Error(`Missing stage document for skill: ${skillId}`)
      const markdown = await this.readBundledOrOverride(stageDoc.resourcePath)
      const text = composePromptTexts([
        formatSkillEvidenceHeader(skill.id, includeReferences),
        tryExtractPromptDocSection(markdown, stageSkill.marker) ?? (await this.load(skill.primaryResource)).text,
      ])
      return {
        skillId: skill.id,
        includeReferences,
        ref: `${PROMPT_CONTRACT_VERSION}:skill:${skill.id}`,
        version: PROMPT_CONTRACT_VERSION,
        digest: digest(text),
        text,
      }
    }
    const paths = includeReferences
      ? [skill.primaryResource, ...skill.referenceResources]
      : [skill.primaryResource]
    const parts = await Promise.all(paths.map((resourcePath) => this.load(resourcePath)))
    const header = formatSkillEvidenceHeader(skill.id, includeReferences)
    const text = composePromptTexts([header, ...parts.map((part) => part.text)])
    return {
      skillId: skill.id,
      includeReferences,
      ref: `${PROMPT_CONTRACT_VERSION}:skill:${skill.id}${includeReferences ? "+refs" : ""}`,
      version: PROMPT_CONTRACT_VERSION,
      digest: digest(text),
      text,
    }
  }

  public async loadNewChapterDiscussion(): Promise<PromptResource> {
    return this.loadBusinessStage("new-chapter")
  }

  public async loadComposePrompt(): Promise<PromptResource> {
    return this.loadBusinessStage("compose", "phase:synopsis-discuss")
  }

  public async loadChapterIngestion(): Promise<PromptResource> {
    return this.loadBusinessStage("ingestion")
  }

  private async loadBusinessStage(id: (typeof STAGE_PROMPT_DOCS)[number]["id"], section?: string): Promise<PromptResource> {
    const { resourcePath } = STAGE_PROMPT_DOCS.find((doc) => doc.id === id)!
    const markdown = await this.readBundledOrOverride(resourcePath)
    const shared = sharedStageMarkdown(markdown)
    const specific = section === undefined ? undefined : tryExtractPromptDocSection(markdown, section)
    const text = specific === undefined ? shared : composePromptTexts([shared, specific])
    return this.sectionResource(resourcePath, "stage", text)
  }

  public loadAfterUserMessageReminder(): Promise<PromptResource> {
    return this.load(AFTER_USER_MESSAGE_PROMPT_DOC)
  }

  public async loadUserMessageBrackets(_input: UserMessageBracketInput): Promise<UserMessageBrackets> {
    const [before, after] = await Promise.all([
      this.readBundledOrOverride(BEFORE_USER_MESSAGE_PROMPT_DOC),
      this.readBundledOrOverride(AFTER_USER_MESSAGE_PROMPT_DOC),
    ])
    return { before, after }
  }

  private sectionResource(resourcePath: string, section: string, text: string): PromptResource {
    return { ref: `${PROMPT_CONTRACT_VERSION}:${resourcePath}#${section}`, version: PROMPT_CONTRACT_VERSION, digest: digest(text), text }
  }

  public async loadDefaultSkillPack(phase: AIPhase | "synopsis_discuss"): Promise<PromptResource> {
    const skillIds = defaultSkillIdsForPhase(phase)
    if (skillIds.length === 0) {
      const empty = `${formatSkillEvidenceHeader("none", false)}\n${renderRuntimePrompt("turn-context", "empty-skill-pack", {}, this.promptPackageRoot)}\n`
      return {
        ref: `${PROMPT_CONTRACT_VERSION}:skill-pack:${phase}:empty`,
        version: PROMPT_CONTRACT_VERSION,
        digest: digest(empty),
        text: empty,
      }
    }
    const loaded = await Promise.all(skillIds.map((id) => this.loadSkill(id, { includeReferences: false })))
    const envelope = JSON.stringify({
      protocol: SYNOPSIS_SKILLS_PROTOCOL,
      kind: "default_pack",
      phase,
      skillIds,
    })
    const text = composePromptTexts([
      renderRuntimePrompt("turn-context", "phase-skill-pack", { phase }, this.promptPackageRoot),
      envelope,
      ...loaded.map((part) => part.text),
    ])
    return {
      ref: `${PROMPT_CONTRACT_VERSION}:skill-pack:${phase}`,
      version: PROMPT_CONTRACT_VERSION,
      digest: digest(text),
      text,
    }
  }

  private async loadStageGuide(skillId: string, fallbackResource: string): Promise<PromptResource> {
    const doc = stagePromptDocForSkill(skillId)
    const marker = STAGE_SKILL_DOCS[skillId]?.marker
    if (doc === undefined || marker === undefined) return this.load(fallbackResource)
    const section = tryExtractPromptDocSection(await this.readBundledOrOverride(doc.resourcePath), marker)
    if (section === undefined) return this.load(fallbackResource)
    const text = normalizePrompt(section)
    return { ref: `${PROMPT_CONTRACT_VERSION}:${doc.resourcePath}#${marker}`, version: PROMPT_CONTRACT_VERSION, digest: digest(text), text }
  }

  private async load(resourcePath: string): Promise<PromptResource> {
    const text = await this.readBundledOrOverride(resourcePath)
    return {
      ref: `${PROMPT_CONTRACT_VERSION}:${resourcePath}`,
      version: PROMPT_CONTRACT_VERSION,
      digest: digest(text),
      text,
    }
  }

  private async readBundledOrOverride(resourcePath: string): Promise<string> {
    const override = await this.promptLibrary?.readOverride(resourcePath)
    return normalizePrompt(override ?? await readFile(resolve(this.promptPackageRoot, resourcePath), "utf8"))
  }

  private async loadComposite(refSuffix: string, resourcePaths: readonly string[]): Promise<PromptResource> {
    const parts = await Promise.all(resourcePaths.map((resourcePath) => this.load(resourcePath)))
    const text = composePromptTexts(parts.map((part) => part.text))
    return {
      ref: `${PROMPT_CONTRACT_VERSION}:${refSuffix}`,
      version: PROMPT_CONTRACT_VERSION,
      digest: digest(text),
      text,
    }
  }
}

export function composePromptTexts(segments: readonly string[]): string {
  return segments
    .map((segment) => segment.replaceAll("\r\n", "\n").trim())
    .filter((segment) => segment.length > 0)
    .join("\n\n---\n\n") + "\n"
}

function normalizePrompt(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd() + "\n"
}
