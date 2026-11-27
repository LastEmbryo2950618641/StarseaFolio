import type { StagePromptKind } from "@starseafolio/prompt-contracts"
import { PROMPT_CONTRACT_VERSION } from "@starseafolio/prompt-contracts"

import { digest } from "../../core/index.js"
import type { PromptResource, PromptResourcePort } from "../turns/ports/ai-model-port.js"
import type { WorkspacePort } from "../workspace/index.js"

export type WorkspacePromptCategory =
  | "system"
  | "before-user-message"
  | "after-user-message"
  | "new-chapter"
  | "compose"
  | "ingestion"

const WORKSPACE_PROMPT_SCOPES = ["提示词/用户规则", "提示词/系统记忆"] as const

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/")
}

function matchesWorkspacePromptCategory(relativePath: string, category: WorkspacePromptCategory): boolean {
  const normalized = normalizePath(relativePath)
  if (!normalized.toLowerCase().endsWith(".md")) return false
  const scopePrefix = WORKSPACE_PROMPT_SCOPES.find((scope) => normalized.startsWith(`${scope}/`))
  if (scopePrefix === undefined) return false
  const rest = normalized.slice(scopePrefix.length + 1)
  switch (category) {
    case "system":
      return rest.startsWith("系统提示词/")
    case "before-user-message":
      return rest.startsWith("消息前后/") && rest.includes("消息前")
    case "after-user-message":
      return rest.startsWith("消息前后/") && rest.includes("消息后")
    case "new-chapter":
      return rest.startsWith("阶段提示词/") && rest.includes("新章节")
    case "compose":
      return rest.startsWith("阶段提示词/") && rest.includes("构思")
    case "ingestion":
      return rest.startsWith("阶段提示词/") && rest.includes("章节入库")
  }
}

export async function loadWorkspacePromptSupplements(
  workspace: WorkspacePort | undefined,
  workspaceRootRef: string | undefined,
  category: WorkspacePromptCategory,
): Promise<readonly Readonly<{ relativePath: string; text: string }>[]> {
  if (workspace === undefined || workspaceRootRef === undefined) return []
  try {
    const report = await workspace.validate(workspaceRootRef)
    const matched = report.inventory
      .filter((entry) => entry.kind === "file")
      .map((entry) => normalizePath(entry.path))
      .filter((relativePath) => matchesWorkspacePromptCategory(relativePath, category))
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
    const loaded: Array<Readonly<{ relativePath: string; text: string }>> = []
    for (const relativePath of matched) {
      const content = await workspace.readMarkdown(workspaceRootRef, relativePath)
      const trimmed = content.replaceAll("\r\n", "\n").trim()
      if (trimmed.length === 0) continue
      loaded.push({ relativePath, text: trimmed })
    }
    return loaded
  } catch {
    return []
  }
}

function mergePromptWithSupplements(
  base: PromptResource | undefined,
  supplements: readonly Readonly<{ relativePath: string; text: string }>[],
  fallbackRef: string,
): PromptResource | undefined {
  const parts: string[] = []
  const baseText = base?.text.trim()
  if (baseText !== undefined && baseText.length > 0) parts.push(baseText)
  for (const supplement of supplements) {
    parts.push(`<!-- project-prompt:${supplement.relativePath} -->\n${supplement.text}`)
  }
  if (parts.length === 0) return undefined
  const text = `${parts.join("\n\n---\n\n")}\n`
  return {
    ref: base?.ref ?? `${PROMPT_CONTRACT_VERSION}:${fallbackRef}`,
    version: base?.version ?? PROMPT_CONTRACT_VERSION,
    digest: digest(text),
    text,
  }
}

export async function resolveUserMessageWrapperPrompts(input: Readonly<{
  prompts: PromptResourcePort
  workspace?: WorkspacePort
  workspaceRootRef?: string
}>): Promise<Readonly<{
  before?: PromptResource
  after?: PromptResource
}>> {
  const [baseBefore, baseAfter, beforeSupplements, afterSupplements] = await Promise.all([
    input.prompts.loadBeforeUserMessagePrompt?.(),
    input.prompts.loadAfterUserMessagePrompt?.(),
    loadWorkspacePromptSupplements(input.workspace, input.workspaceRootRef, "before-user-message"),
    loadWorkspacePromptSupplements(input.workspace, input.workspaceRootRef, "after-user-message"),
  ])
  const before = mergePromptWithSupplements(baseBefore, beforeSupplements, "before-user-message")
  const after = mergePromptWithSupplements(baseAfter, afterSupplements, "after-user-message")
  return {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  }
}

export async function resolveStageEntryPrompt(input: Readonly<{
  prompts: PromptResourcePort
  stage: StagePromptKind
  workspace?: WorkspacePort
  workspaceRootRef?: string
}>): Promise<PromptResource | undefined> {
  const workspaceCategory: WorkspacePromptCategory = input.stage === "compose-request"
    ? "compose"
    : input.stage
  const [base, supplements] = await Promise.all([
    input.prompts.loadStageEntryPrompt?.(input.stage),
    input.stage === "compose-request"
      ? Promise.resolve([] as readonly Readonly<{ relativePath: string; text: string }>[])
      : loadWorkspacePromptSupplements(input.workspace, input.workspaceRootRef, workspaceCategory),
  ])
  return mergePromptWithSupplements(base, supplements, `stage:${input.stage}`)
}
