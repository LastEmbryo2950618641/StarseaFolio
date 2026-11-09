import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RevisionDraftVersion } from "@worldseed/contracts"

import { invokeBackend } from "../src/api/client.js"
import { ChapterDraftDetailPanel, loadChapterDraftHistory } from "../src/features/editor/ChapterBrowseDetailRail.js"

vi.mock("../src/api/client.js", () => ({ invokeBackend: vi.fn() }))

const versions: RevisionDraftVersion[] = [
  { versionId: "v1", projectId: "project", revisionTaskId: "old-revision", source: "agent", label: "v1", heading: "第一章", body: "第一版草稿。", bodyDigest: "one", createdAtMs: 1, isLatest: false, isCurrentOfficial: false },
  { versionId: "v2", projectId: "project", revisionTaskId: "published-revision", source: "agent", label: "v2", heading: "第一章", body: "第二版草稿已经成为正文。", bodyDigest: "two", createdAtMs: 2, isLatest: true, isCurrentOfficial: true },
]
const input = { projectId: "project", workspaceRootRef: "workspace", bodyPath: "章节正文/第一章.md" }

describe("chapter sidebar draft history", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads persisted drafts through the chapter when no unpublished task remains", async () => {
    vi.mocked(invokeBackend).mockImplementation(async (method, payload) => {
      if (method === "chapter.resolveByPath") return { activeRevision: { revisionTaskId: "published-revision", status: "completed" } }
      if (method === "chapter.revision.draftVersion.list" && payload.revisionTaskId === "published-revision" && payload.includeChapterHistory === true) return { versions }
      throw new Error(`Unexpected history request: ${method}`)
    })
    expect(await loadChapterDraftHistory(input)).toEqual(versions)
  })

  it("prefers a new unpublished revision while loading all chapter versions", async () => {
    vi.mocked(invokeBackend).mockImplementation(async (method, payload) => {
      if (method === "chapter.revision.draftVersion.list" && payload.revisionTaskId === "new-revision" && payload.includeChapterHistory === true) return { versions }
      throw new Error(`Unexpected history request: ${method}`)
    })
    expect(await loadChapterDraftHistory({ ...input, revisionTaskId: "new-revision" })).toEqual(versions)
  })

  it("shows published versions even without an active revision and does not offer to publish them again", () => {
    const html = renderToStaticMarkup(React.createElement(ChapterDraftDetailPanel, {
      revisionTaskId: undefined, versions, loading: false, selectedVersionId: undefined, onSelectVersion: vi.fn(),
    }))
    expect(html).toContain('value="v1"')
    expect(html).toContain('value="v2"')
    expect(html).toContain("第二版草稿已经成为正文。")
    expect(html).toContain("已发布为当前正文")
    expect(html).not.toContain("暂无可选草稿")
    expect(html).not.toContain("正文候选")
    expect(html).not.toContain("对讨论 Agent 说")
  })

  it("lets the reader select an older version without treating it as the new publication candidate", () => {
    const html = renderToStaticMarkup(React.createElement(ChapterDraftDetailPanel, {
      revisionTaskId: "new-revision", versions, loading: false, selectedVersionId: "v1", onSelectVersion: vi.fn(),
    }))
    expect(html).toContain("第一版草稿。")
    expect(html).toContain("历史草稿")
    expect(html).not.toContain("对讨论 Agent 说")
  })

  it("numbers versions across publication tasks instead of repeating each task's v1", () => {
    const html = renderToStaticMarkup(React.createElement(ChapterDraftDetailPanel, {
      revisionTaskId: undefined, versions: versions.map((version) => ({ ...version, label: "v1" })),
      loading: false, selectedVersionId: undefined, onSelectVersion: vi.fn(),
    }))
    expect(html).toContain("v2 · 讨论agent · 已发布为当前正文")
  })

  it("keeps a current unpublished version as the publication candidate", () => {
    const html = renderToStaticMarkup(React.createElement(ChapterDraftDetailPanel, {
      revisionTaskId: "new-revision", loading: false, selectedVersionId: undefined, onSelectVersion: vi.fn(),
      versions: [...versions.map((version) => ({ ...version, isLatest: false })),
        { ...versions[1]!, versionId: "v3", revisionTaskId: "new-revision", label: "v1", body: "新草稿待发布。", isCurrentOfficial: false }],
    }))
    expect(html).toContain("v3 · 讨论agent · 正文候选")
    expect(html).toContain("新草稿待发布。")
    expect(html).toContain("对讨论 Agent 说")
  })
})
