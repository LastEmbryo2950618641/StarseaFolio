import { existsSync, readFileSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { extractPromptDocSection } from "@starseafolio/prompt-contracts"

const require = createRequire(import.meta.url)
const bundledPackageRoot = dirname(dirname(require.resolve("@starseafolio/prompt-contracts")))
const runtimeDirectory = "resources/v1/runtime"
const promptFiles = new Map<string, { modifiedAt: number; size: number; sections: Map<string, string> }>()

export type PromptOverrideResolver = Readonly<{
  runtimePath(file: string): string | undefined
  resourcePath(resourcePath: string): string | undefined
}>

let promptOverrideResolver: PromptOverrideResolver | undefined

/** Wire the global prompt library in once at backend startup. */
export function setPromptOverrideResolver(resolver: PromptOverrideResolver | undefined): void {
  promptOverrideResolver = resolver
}

function shouldUseOverride(packageRoot: string): boolean {
  return promptOverrideResolver !== undefined && packageRoot === defaultPromptRoot()
}

function resolveMarkdownPath(relativePath: string, packageRoot: string): string {
  return shouldUseOverride(packageRoot)
    ? promptOverrideResolver?.resourcePath(relativePath) ?? join(packageRoot, relativePath)
    : join(packageRoot, relativePath)
}

function defaultPromptRoot(): string {
  const electronResources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const packagedRoot = electronResources === undefined ? undefined : join(electronResources, "prompt-contracts")
  return process.env.WORLDSEED_PROMPT_ROOT
    ?? (packagedRoot !== undefined && existsSync(join(packagedRoot, runtimeDirectory)) ? packagedRoot : bundledPackageRoot)
}

export async function readBundledPromptMarkdown(
  resourcePath: string,
  packageRoot: string = defaultPromptRoot(),
): Promise<string> {
  return (await readFile(resolveMarkdownPath(resourcePath, packageRoot), "utf8")).replaceAll("\r\n", "\n")
}

/** Read one marker-delimited section from a canonical prompt document. */
export async function renderPromptDocSection(
  resourcePath: string,
  marker: string,
  packageRoot: string = defaultPromptRoot(),
): Promise<string> {
  return extractPromptDocSection(await readBundledPromptMarkdown(resourcePath, packageRoot), marker)
}

/** Synchronous variant for sync review helpers. */
export function renderPromptDocSectionSync(
  resourcePath: string,
  marker: string,
  packageRoot: string = defaultPromptRoot(),
): string {
  const path = resolveMarkdownPath(resourcePath, packageRoot)
  return extractPromptDocSection(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), marker)
}

/** Resolve a named Markdown section and substitute the current request's values once. */
export function renderRuntimePrompt(
  file: string,
  section: string,
  values: Readonly<Record<string, string | number>> = {},
  packageRoot: string = defaultPromptRoot(),
): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(file)) throw new Error(`Invalid runtime prompt name: ${file}`)
  const path = shouldUseOverride(packageRoot)
    ? promptOverrideResolver?.runtimePath(file) ?? join(packageRoot, runtimeDirectory, `${file}.md`)
    : join(packageRoot, runtimeDirectory, `${file}.md`)
  const { mtimeMs, size } = statSync(path)
  let cached = promptFiles.get(path)
  if (cached?.modifiedAt !== mtimeMs || cached.size !== size) {
    const markdown = readFileSync(path, "utf8").replaceAll("\r\n", "\n")
    const headings = [...markdown.matchAll(/^## ([a-z][a-z0-9-]*)[\t ]*$/gmu)]
    const sections = new Map<string, string>()
    for (const [index, heading] of headings.entries()) {
      const name = heading[1]
      if (name === undefined) continue
      if (sections.has(name)) throw new Error(`Duplicate runtime prompt section: ${file}/${name}`)
      sections.set(name, markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim())
    }
    cached = { modifiedAt: mtimeMs, size, sections }
    promptFiles.set(path, cached)
  }
  const template = cached.sections.get(section)
  if (!template) throw new Error(`Missing runtime prompt section: ${file}/${section}`)
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing runtime prompt value: ${file}/${section}/${name}`)
    return String(values[name])
  })
}
