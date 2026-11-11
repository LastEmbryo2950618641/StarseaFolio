import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CHARACTER_DIRECTORY, CHARACTER_RULE_PATH, CHARACTER_GUIDE, PROTOCOL_VERSION, characterUpdateSchema, parseCharacterProfile, settingsProposalPayloadSchema } from "@starseafolio/contracts"
import { NodeWorkspaceAdapter } from "../src/infrastructure/filesystem/node-workspace-adapter.js"
import { NodeWorkspaceSnapshotAdapter } from "../src/infrastructure/filesystem/node-workspace-snapshot-adapter.js"
import { NodeWorkspaceCatalogAdapter } from "../src/infrastructure/filesystem/node-workspace-catalog-adapter.js"
import { withProtectedCharacterFiles } from "../src/infrastructure/filesystem/character-file-protection.js"
import type { WorkspaceDefaultDocuments } from "../src/application/workspace/ports/workspace-port.js"
import { executeSynopsisTool, synopsisToolCatalog } from "../src/application/chapters/synopsis-workflow-tools.js"
import { openChapterHarness } from "./helpers/chapter-coordination-harness.js"

const temporaryRoots: string[] = []
const path = `${CHARACTER_DIRECTORY}/林照.json`
const defaults: WorkspaceDefaultDocuments = {
  baseRules: "# 基础规则\n", contentHandling: "# 内容\n", webnovelProseLogic: "# 正文\n", plotSynopsisGuide: "# 梗概\n",
  settingsQueryGuide: "# 查询\n", settingsRevisionGuide: "# 修订\n", discussCreationDeskWorkflow: "# 讨论\n",
  agentMemoryIndex: "# 记忆\n", settingsReadme: "# 设定\n", referencesReadme: "# 参考\n", descriptionRules: "# 描写\n",
  proseStyleRules: "# 笔风\n", stagingReadme: "# 暂存\n", stagingNotes: "# 笔记\n", stagingCharacters: "# 人物草稿\n",
  stagingWorld: "# 世界草稿\n", stagingPromoteIndex: "# 待落盘\n",
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "starseafolio-character-"))
  temporaryRoots.push(root)
  const workspace = new NodeWorkspaceAdapter()
  await workspace.createLayout(root, defaults)
  const create = () => workspace.updateCharacter(root, { relativePath: path, mode: "create", operations: [{ op: "set", field: "姓名", value: "林照" }] })
  return { root, workspace, create }
}
afterEach(async () => { for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe("character documents", () => {
  it("materializes immutable scaffolds and upgrades old books without replacing legacy data", async () => {
    const f = await fixture()
    await rm(join(f.root, CHARACTER_DIRECTORY), { recursive: true })
    await rm(join(f.root, CHARACTER_RULE_PATH))
    await mkdir(join(f.root, CHARACTER_DIRECTORY))
    await writeFile(join(f.root, CHARACTER_DIRECTORY, "旧角色.md"), "# 旧人物：原文保留\n")
    await f.workspace.ensurePlatformDocuments(f.root, defaults)
    expect(await f.workspace.readMarkdown(f.root, CHARACTER_RULE_PATH)).toBe(CHARACTER_GUIDE)
    expect(await f.workspace.readMarkdown(f.root, `${CHARACTER_DIRECTORY}/旧角色.md`)).toContain("原文保留")
    expect((await f.workspace.validate(f.root)).issues).toEqual([])
    await expect(f.workspace.createUserDirectory(f.root, CHARACTER_DIRECTORY)).rejects.toThrow(/固定/u)
    await expect(f.workspace.removeUserMarkdown(f.root, CHARACTER_DIRECTORY)).rejects.toThrow(/固定/u)
    await expect(f.workspace.saveUserMarkdown(f.root, CHARACTER_RULE_PATH, "changed")).rejects.toThrow()
    await expect(f.workspace.removeUserMarkdown(f.root, CHARACTER_RULE_PATH)).rejects.toThrow()
  })

  it("creates pretty JSON and changes only the requested fields, including custom fields and deletions", async () => {
    const f = await fixture()
    const original = await f.create()
    expect(original).toContain('\n  "schemaVersion": 1,\n  "fields": {')
    const content = await f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", expectedContent: original, operations: [
      { op: "set", field: "所属阵营", value: "观星社" },
      { op: "set", field: "人物关系", value: [{ 姓名: "沈砚", 关系: "同门" }] },
      { op: "delete", field: "备注" },
    ] })
    const document = parseCharacterProfile(content)
    expect(Object.keys(document)).toEqual(["schemaVersion", "fields"])
    expect(document.fields.姓名).toBe("林照")
    expect(document.fields.所属阵营).toBe("观星社")
    expect(document.fields.人物关系).toEqual([{ 姓名: "沈砚", 关系: "同门" }])
    expect(document.fields).not.toHaveProperty("备注")
    expect(await f.workspace.readMarkdown(f.root, path)).toBe(content)
  })

  it("blocks generic text writes, invalid operations, duplicate creation and stale editor overwrites", async () => {
    const f = await fixture()
    const original = await f.create()
    await expect(f.workspace.saveUserMarkdown(f.root, path, "{}" )).rejects.toThrow(/字段接口/u)
    await expect(f.workspace.saveUserMarkdown(f.root, `${CHARACTER_DIRECTORY}/新人物.md`, "# 人物")).rejects.toThrow(/字段接口/u)
    await expect(f.workspace.createUserDirectory(f.root, `${CHARACTER_DIRECTORY}/子文件夹`)).rejects.toThrow()
    await expect(f.create()).rejects.toThrow(/已存在/u)
    expect(characterUpdateSchema.safeParse({ relativePath: path, mode: "update", operations: [{ op: "set", field: "姓名", value: "changed" }], content: "{}" }).success).toBe(false)
    expect(characterUpdateSchema.safeParse({ relativePath: path, mode: "update", operations: [{ op: "set", field: "__proto__", value: {} }] }).success).toBe(false)
    expect(characterUpdateSchema.safeParse({ relativePath: "设定集/人物/../a.json", mode: "create", operations: [] }).success).toBe(false)
    await f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", operations: [{ op: "set", field: "目标", value: "登顶" }] })
    await expect(f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", expectedContent: original, operations: [{ op: "delete", field: "目标" }] })).rejects.toThrow(/重新打开/u)
    expect(parseCharacterProfile(await f.workspace.readMarkdown(f.root, path)).fields.目标).toBe("登顶")
  })

  it("serializes concurrent updates without losing unrelated fields", async () => {
    const f = await fixture()
    await f.create()
    await Promise.all([
      f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", operations: [{ op: "set", field: "目标", value: "登顶" }] }),
      f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", operations: [{ op: "set", field: "年龄", value: 17 }] }),
    ])
    expect(parseCharacterProfile(await f.workspace.readMarkdown(f.root, path)).fields).toMatchObject({ 目标: "登顶", 年龄: 17 })
  })

  it("includes character JSON in catalog and history snapshots and restores it", async () => {
    const f = await fixture()
    const original = await f.create()
    const catalog = await new NodeWorkspaceCatalogAdapter(f.workspace).createSnapshot({ snapshotId: randomUUID(), projectId: randomUUID(), workspaceRootRef: f.root, generatedAtMs: 1 })
    expect(catalog.entries.some(entry => entry.relativePath === path && entry.entryKind === "file")).toBe(true)
    const snapshots = new NodeWorkspaceSnapshotAdapter(f.workspace)
    const snapshot = await snapshots.capture(f.root)
    await f.workspace.updateCharacter(f.root, { relativePath: path, mode: "update", operations: [{ op: "set", field: "年龄", value: 18 }] })
    await snapshots.restore(f.root, snapshot)
    expect(await f.workspace.readMarkdown(f.root, path)).toBe(original)
    await snapshots.restore(f.root, { ...snapshot, files: snapshot.files.filter(file => file.relativePath !== CHARACTER_RULE_PATH) })
    expect(await f.workspace.readMarkdown(f.root, CHARACTER_RULE_PATH)).toBe(CHARACTER_GUIDE)
  })

  it("rolls back direct shell edits and preserves unrelated files", async () => {
    const f = await fixture()
    const original = await f.create()
    await expect(withProtectedCharacterFiles(f.root, async () => {
      await writeFile(join(f.root, path), '{"corrupt":true}')
      await writeFile(join(f.root, "参考文件/安全.md"), "kept")
    })).rejects.toThrow(/字段工具/u)
    expect(await readFile(join(f.root, path), "utf8")).toBe(original)
    expect(await readFile(join(f.root, "参考文件/安全.md"), "utf8")).toBe("kept")
    await expect(withProtectedCharacterFiles(f.root, async () => {
      await rm(join(f.root, CHARACTER_DIRECTORY), { recursive: true })
    })).rejects.toThrow(/已恢复/u)
    expect(await readFile(join(f.root, path), "utf8")).toBe(original)
  })

  it("discloses character tool arguments on demand and invokes actual field writes", async () => {
    const f = await fixture()
    const callbacks = { updateCharacter: async ({ update }: { update: Parameters<NodeWorkspaceAdapter["updateCharacter"]>[1] }) => ({ relativePath: update.relativePath, content: await f.workspace.updateCharacter(f.root, update) }) }
    expect(synopsisToolCatalog(callbacks)).not.toContain('"operations"')
    const context = { projectId: randomUUID(), sessionId: randomUUID(), workspaceRootRef: f.root, chapterSequence: 1, model: { execute: vi.fn() } }
    const base = { context, callbacks, listDrafts: () => Promise.resolve([]) }
    const argumentsText = JSON.stringify({ relativePath: path, mode: "create", operations: [{ op: "set", field: "姓名", value: "林照" }] })
    expect(await executeSynopsisTool({ ...base, visibleMessages: [], request: { name: "character_update", action: "invoke", arguments: argumentsText } })).toMatchObject({ code: "describe_required" })
    const description = await executeSynopsisTool({ ...base, visibleMessages: [], request: { name: "character_update", action: "describe" } })
    expect(description.parameters).toHaveProperty("operations")
    const result = await executeSynopsisTool({ ...base, visibleMessages: [{ messageId: randomUUID(), sequence: 1, role: "system", kind: "phase_instruction", content: JSON.stringify(description) }], request: { name: "character_update", action: "invoke", arguments: argumentsText } })
    expect(result.status).toBe("character_updated")
    expect(parseCharacterProfile(await f.workspace.readMarkdown(f.root, path)).fields.姓名).toBe("林照")
  })

  it("supports RPC saves, extraction approval and lineage restore through field operations", async () => {
    const h = await openChapterHarness("人物字段回归")
    temporaryRoots.push(h.root)
    try {
      const response = await h.facade.handle({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), method: "workspace.character.update", payload: {
        projectId: h.projectId, workspaceRootRef: h.workspaceRootRef, relativePath: path, mode: "create", operations: [{ op: "set", field: "姓名", value: "林照" }],
      } })
      expect(response.ok).toBe(true)
      const runtime = await h.container.getRuntime(h.projectId, h.workspaceRootRef)
      await runtime.updateCharacter({ relativePath: "设定集/人物/主角.json", mode: "update", operations: [{ op: "delete", field: "性格爱好" }] })
      await expect(runtime.assertCreativeSetupReady("第一卷 待命名")).resolves.toBeUndefined()
      const lineage = runtime.createSettingsLineageService()
      const original = (await lineage.list({ relativePath: path })).entries[0]
      if (original === undefined) throw new Error("人物沿革未创建")
      const extraction = runtime.createSettingsExtractionService()
      const proposals = await extraction.createProposalsFromArtifact({ projectId: h.projectId, taskId: randomUUID(), phaseRunId: randomUUID(), proposals: [{ payload: settingsProposalPayloadSchema.parse({
        kind: "update", relativePath: path, characterOperations: [{ op: "set", field: "目标", value: "找到故人" }],
      }) }] })
      await extraction.approveProposals({ projectId: h.projectId, workspaceRootRef: h.workspaceRootRef, proposalIds: proposals.map(p => p.proposalId) })
      expect(parseCharacterProfile(await runtime.readMarkdown(path)).fields.目标).toBe("找到故人")
      await lineage.restoreAsCurrent({ commitId: original.commitId, confirmPhrase: "恢复为当前" })
      expect(parseCharacterProfile(await runtime.readMarkdown(path)).fields.目标).toBe("")
      expect(settingsProposalPayloadSchema.safeParse({ kind: "update", relativePath: path, markdown: '{"fields":{}}' }).success).toBe(false)
    } finally { await h.container.close() }
  })
})
