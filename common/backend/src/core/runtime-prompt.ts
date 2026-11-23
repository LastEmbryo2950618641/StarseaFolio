import { existsSync, readFileSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const bundledPackageRoot = dirname(dirname(require.resolve("@starseafolio/prompt-contracts")))
const runtimeDirectory = "resources/v1/runtime"
const promptFiles = new Map<string, { modifiedAt: number; size: number; sections: Map<string, string> }>()

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
  return (await readFile(join(packageRoot, resourcePath), "utf8")).replaceAll("\r\n", "\n")
}

/** Resolve a named Markdown section and substitute the current request's values once. */
export function renderRuntimePrompt(
  file: string,
  section: string,
  values: Readonly<Record<string, string | number>> = {},
  packageRoot: string = defaultPromptRoot(),
): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(file)) throw new Error(`Invalid runtime prompt name: ${file}`)
  const path = join(packageRoot, runtimeDirectory, `${file}.md`)
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
