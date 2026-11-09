import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { ClientRequest, ClientResponse } from "@worldseed/contracts"

import { ChapterBrowseDetailRail } from "../src/features/editor/ChapterBrowseDetailRail.js"
import "../src/styles/global.css"

type Context = { projectId: string; workspaceRootRef: string; folderName: string; bodyPaths: string[]; mounted: boolean }
type Read = { projectId: string; workspaceRootRef: string; path: string }
export type VolumeDetailFixture = {
  reads: Read[]
  activeReads: number
  maxActiveReads: number
  loadingFlashes: number
  configure(patch: Partial<Context>): void
  rerender(): void
  setFile(path: string, content: string | undefined): void
  setScopedFile(projectId: string, workspaceRootRef: string, path: string, content: string): void
  fail(path: string, failed: boolean): void
  hold(path: string): void
  release(path: string): void
}
declare global { interface Window { volumeDetailFixture: VolumeDetailFixture } }

const files = new Map<string, string>()
const scopedFiles = new Map<string, string>()
const failures = new Set<string>()
const held = new Map<string, (() => void)[]>()
const folder = "第一卷 石屑与油墨"
files.set(`大纲/${folder}.梗概.md`, "卷梗概初版\n" + "保留阅读位置和原有内容。\n".repeat(160))
files.set(`大纲/${folder}.md`, "卷大纲初版")
files.set(`大纲/${folder}.批量计划.md`, '```json\n' + JSON.stringify({
  volumeFolderName: folder, targetChapterCount: 5, targetWordCount: 10000, synopsisWriteCount: 1, outlineWriteCount: 1,
}) + '\n```')
files.set("章节正文/第一章.md", "# 第一章\n\n天地玄黄")

const fixture: VolumeDetailFixture = {
  reads: [], activeReads: 0, maxActiveReads: 0, loadingFlashes: 0,
  configure: () => {}, rerender: () => {},
  setFile: (path, content) => { if (content === undefined) files.delete(path); else files.set(path, content) },
  setScopedFile: (projectId, workspaceRootRef, path, content) => { scopedFiles.set(JSON.stringify([projectId, workspaceRootRef, path]), content) },
  fail: (path, failed) => { if (failed) failures.add(path); else failures.delete(path) },
  hold: (path) => { held.set(path, []) },
  release: (path) => { const waiting = held.get(path) ?? []; held.delete(path); waiting.forEach((resolve) => { resolve() }) },
}
window.volumeDetailFixture = fixture

async function invoke(request: ClientRequest): Promise<ClientResponse> {
  if (request.method === "deduction.goals.list") {
    return { protocolVersion: request.protocolVersion, requestId: request.requestId, ok: true,
      data: { projectId: "project-1", goals: [], progress: [], pendingProposals: [], updatedAtMs: 0 } }
  }
  if (request.method !== "workspace.read") throw new Error(`Unexpected fixture method: ${request.method}`)
  const payload = request.payload as { projectId: string; workspaceRootRef: string; relativePath: string }
  const path = payload.relativePath
  fixture.reads.push({ projectId: payload.projectId, workspaceRootRef: payload.workspaceRootRef, path })
  fixture.activeReads++
  fixture.maxActiveReads = Math.max(fixture.maxActiveReads, fixture.activeReads)
  const content = scopedFiles.get(JSON.stringify([payload.projectId, payload.workspaceRootRef, path])) ?? files.get(path)
  try {
    const waiting = held.get(path)
    if (waiting !== undefined) await new Promise<void>((resolve) => { waiting.push(resolve) })
    if (failures.has(path)) throw new Error("EIO: temporarily unavailable")
    if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`)
    return { protocolVersion: request.protocolVersion, requestId: request.requestId, ok: true, data: { content } }
  } finally {
    fixture.activeReads--
  }
}
// Only these two read methods are available; there is no real backend or model.
window.worldseed = { invoke } as NonNullable<Window["worldseed"]>

function Fixture(): React.JSX.Element {
  const [context, setContext] = useState<Context>({
    projectId: "project-1", workspaceRootRef: "workspace-1", folderName: folder,
    bodyPaths: ["章节正文/第一章.md"], mounted: true,
  })
  const [, setTick] = useState(0)
  fixture.configure = (patch) => { setContext((current) => ({ ...current, ...patch })) }
  fixture.rerender = () => { setTick((tick) => tick + 1) }
  return <div style={{ height: 600, width: 380 }}>
    {context.mounted ? <ChapterBrowseDetailRail
      projectId={context.projectId} workspaceRootRef={context.workspaceRootRef} chapter={undefined}
      volume={{ folderName: context.folderName, chapters: context.bodyPaths.map((bodyPath, index) => ({
        sequence: index + 1, label: `第${String(index + 1)}章`, volumeFolderName: context.folderName, bodyPath,
      })) }}
      onOpenBody={() => {}}
    /> : null}
  </div>
}

const root = document.getElementById("root")
if (root === null) throw new Error("Volume fixture root is missing")
new MutationObserver(() => {
  if (/正在读取卷(?:梗概|大纲)/u.test(root.textContent)) fixture.loadingFlashes++
}).observe(root, { childList: true, subtree: true, characterData: true })
createRoot(root).render(<Fixture />)
