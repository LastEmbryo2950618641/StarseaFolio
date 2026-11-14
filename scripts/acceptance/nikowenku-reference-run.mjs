import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { NikowenkuReferenceService } from "../../common/backend/dist/infrastructure/web-research/nikowenku-reference-service.js"
import { NodeWorkspaceAdapter } from "../../common/backend/dist/infrastructure/filesystem/node-workspace-adapter.js"

const [title = "狼与香辛料(狼与辛香料)", ...identityClues] = process.argv.slice(2).filter(value => value !== "--")
const root = await mkdtemp(join(tmpdir(), "starseafolio-nikowenku-live-"))
const workspaceRootRef = join(root, "workspace")
await mkdir(workspaceRootRef)
const service = new NikowenkuReferenceService(join(root, "application-data"), {
  runtimeDirectory: resolve("common/tools/nikowenku-archive"),
})
const report = { passed: false, title, workspaceRootRef, realModelCalls: 0, checks: {} }
const normalize = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
try {
  const found = await service.search(title, workspaceRootRef)
  const matches = found.candidates.filter(candidate => normalize(candidate.title) === normalize(title)
    && identityClues.every(clue => candidate.synopsis?.includes(clue)))
  assert.equal(matches.length, 1, "Exact original title and all synopsis identity clues must match one result; no automatic wrong-book fallback")
  const selected = matches[0]
  const workspace = new NodeWorkspaceAdapter()
  const input = { bookId: selected.bookId, title: selected.title, workspaceRootRef, workspace, chapterLimit: 1 }
  const first = await service.download(input)
  assert.equal(first.cached, false)
  assert.equal(first.importedFiles.length, 2)
  const original = await readFile(first.localTextPath)
  assert(original.length > 0)
  const chapter = await workspace.readMarkdown(workspaceRootRef, first.importedFiles[1])
  assert.match(chapter, /^# [^\n]+\n\n/u)
  assert(chapter.replace(/^#.*\n/u, "").trim().length > 0)
  const second = await service.download({ ...input, startChapter: 2 })
  assert.equal(second.cached, true)
  assert.deepEqual(await readFile(second.localTextPath), original)
  assert.notEqual(second.importedFiles[1], first.importedFiles[1])
  const nextChapter = await workspace.readMarkdown(workspaceRootRef, second.importedFiles[1])
  assert.notEqual(nextChapter, chapter)
  assert.equal(await workspace.readMarkdown(workspaceRootRef, first.importedFiles[1]), chapter)
  const empty = await service.search("不存在的原作_" + Date.now(), workspaceRootRef)
  assert.equal(empty.candidates.length, 0)
  await assert.rejects(service.download(input), /本次原作搜索/u)
  report.passed = true
  report.checks = { matchedBook: { bookId: selected.bookId, title: selected.title }, candidateCount: found.candidates.length,
    downloadedOriginalBytes: original.length, importedChapterCharacters: chapter.length, actualChapterRead: true,
    firstChapterHeading: chapter.split("\n")[0], nextChapterHeading: nextChapter.split("\n")[0],
    repeatUsesCache: second.cached, nextChapterImportedSeparately: true, emptySearch: true, staleCandidateRejected: true, noModelOrInstaller: true }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  const path = join(root, "acceptance-report.json")
  await writeFile(path, JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ ...report, reportPath: path }, null, 2))
}
