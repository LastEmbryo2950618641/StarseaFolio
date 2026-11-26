import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { AIPhase } from "@starseafolio/contracts"
import {
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
  extractPromptDocSection,
  formatSkillEvidenceHeader,
  listPlatformSkills,
  resolvePromptDefinition,
  resolveSkillDefinition,
  stagePromptDocForPhase,
  stagePromptDocForSkill,
  STAGE_SKILL_DOCS,
  SYNOPSIS_SKILLS_PROTOCOL,
} from "@starseafolio/prompt-contracts"

import type { LoadedSkillResource, PromptResource, PromptResourcePort } from "../../application/index.js"
import { digest } from "../../core/index.js"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"
import type { PromptLibraryService } from "./prompt-library.js"

export class NodePromptResourceAdapter implements PromptResourcePort {
  public constructor(
    private readonly promptPackageRoot: string,
    private readonly promptLibrary?: PromptLibraryService,
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

  public async loadPhase(phase: AIPhase): Promise<PromptResource> {
    const stageDoc = stagePromptDocForPhase(phase)
    if (stageDoc === undefined) {
      return this.load(resolvePromptDefinition(phase).resourcePath)
    }
    const markdown = await this.readBundledOrOverride(stageDoc.resourcePath)
    const marker = `phase:${phase.replaceAll("_", "-")}`
    return {
      ref: `${PROMPT_CONTRACT_VERSION}:${stageDoc.resourcePath}#${marker}`,
      version: PROMPT_CONTRACT_VERSION,
      digest: digest(extractPromptDocSection(markdown, marker)),
      text: extractPromptDocSection(markdown, marker),
    }
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
        extractPromptDocSection(markdown, stageSkill.marker),
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
    const text = normalizePrompt(extractPromptDocSection(await this.readBundledOrOverride(doc.resourcePath), marker))
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
