import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

import { renderRuntimePrompt } from "../src/core/runtime-prompt.js"

it("uses the edited Markdown on the next render and substitutes request values only once", () => {
  const root = mkdtempSync(join(tmpdir(), "worldseed-runtime-prompt-"))
  const directory = join(root, "resources/v1/runtime")
  const file = join(directory, "example.md")
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, "# Test\r\n\r\n## draft\r\n\r\nFirst {{value}}\r\n\r\n## other\r\n\r\nIgnored\r\n")
    expect(renderRuntimePrompt("example", "draft", { value: "{{authorText}}" }, root)).toBe("First {{authorText}}")

    writeFileSync(file, "# Test\n\n## draft\n\nUpdated instruction {{value}}\n")
    expect(renderRuntimePrompt("example", "draft", { value: 7 }, root)).toBe("Updated instruction 7")
    expect(() => renderRuntimePrompt("example", "other", {}, root)).toThrow("Missing runtime prompt section")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
