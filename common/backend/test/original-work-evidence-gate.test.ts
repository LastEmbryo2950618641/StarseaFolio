import { describe, expect, it } from "vitest"

import {
  detectsOriginalWorkContext,
  hasOriginalWorkEvidence,
  originalWorkEvidenceRepairHint,
  readOriginalWorkEvidenceStage,
} from "../src/application/chapters/original-work-evidence-gate.js"

describe("original work evidence gate", () => {
  it("detects fanfiction mode without treating keywords as factual evidence", () => {
    expect(detectsOriginalWorkContext({ synopsisMarkdown: "这是 Fate 同人，主角进入冬木市。" })).toBe(true)
    expect(detectsOriginalWorkContext({ synopsisMarkdown: "主角成为间桐家继承人，圣杯战争即将开始。" })).toBe(true)
    expect(detectsOriginalWorkContext({ synopsisMarkdown: "原创修仙故事，主角从山村开始。" })).toBe(false)
  })

  it("accepts only returned web evidence or imported local reference evidence", () => {
    const base = {
      readId: "read-1",
      visibility: "committed" as const,
      ownerKind: "workspace:reference",
      ownerId: "参考文件/原作资料/Fate/第一章.md",
      exactKeys: ["参考文件/原作资料/Fate/第一章.md"],
      semanticText: "间桐慎二通过伪臣之书管理 Rider 的契约。",
      sourceRefs: [],
      digest: "digest",
      stateRole: "current" as const,
      temporalRole: "current" as const,
    }
    expect(hasOriginalWorkEvidence([base])).toBe(true)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "参考文件/原作资料/Fate/README.md", exactKeys: [], semanticText: "原作参考资料目录" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "设定集/readme.md", exactKeys: [], ownerKind: "workspace:reference" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "https://example.com/fate", exactKeys: [], ownerKind: "web:page" }])).toBe(true)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "https://example.com/fate", exactKeys: [], ownerKind: "web:search" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "web:diagnostic:query", exactKeys: [], ownerKind: "web:diagnostic" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "web:disabled:query", exactKeys: [], ownerKind: "web:disabled" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerId: "设定集/人物.md", exactKeys: [], ownerKind: "workspace:settings", semanticText: "# 慎二\n本作中慎二与 Rider 通过伪臣之书建立契约。" }])).toBe(true)
    expect(hasOriginalWorkEvidence([{ ...base, semanticText: "# 原作资料\n" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerKind: "workspace:reference:partial" }])).toBe(false)
    expect(hasOriginalWorkEvidence([{ ...base, ownerKind: "workspace:references:grep", semanticText: "# grep\nmatches: 0\nkeywords: 慎二" }])).toBe(false)
  })

  it("reads persisted stages and gives the ordered fallback instruction", () => {
    expect(readOriginalWorkEvidenceStage([
      { role: "system", kind: "phase_instruction", content: JSON.stringify({ protocol: "synopsis-tools-v1", status: "reference_candidates_found" }) },
      { role: "system", kind: "phase_instruction", content: JSON.stringify({ protocol: "synopsis-tools-v1", status: "reference_imported" }) },
    ])).toBe("archive_imported")
    expect(originalWorkEvidenceRepairHint({ stage: "none", hasWebResearch: true, hasArchive: true })).toContain("公开网络")
    expect(originalWorkEvidenceRepairHint({ stage: "archive_searched", hasWebResearch: true, hasArchive: true })).toContain("original_work_download")
    expect(readOriginalWorkEvidenceStage([{ role: "system", kind: "phase_instruction", content: JSON.stringify({ protocol: "synopsis-tools-v1", status: "reference_candidate_rejected" }) }])).toBe("archive_candidate_rejected")
    expect(originalWorkEvidenceRepairHint({ stage: "archive_candidate_rejected", hasWebResearch: true, hasArchive: true })).toContain("重新 invoke original_work_search")
    expect(originalWorkEvidenceRepairHint({ stage: "archive_imported", hasWebResearch: false, hasArchive: false })).toContain("未核验")
  })

  it("ends an unsuccessful reference attempt so no-match and network failures do not cause an evidence loop", () => {
    const message = (value: object) => ({ role: "system", kind: "phase_instruction", content: JSON.stringify({ protocol: "synopsis-tools-v1", ...value }) })
    expect(readOriginalWorkEvidenceStage([message({ status: "reference_candidates_found", result: { candidateUrls: [] } })])).toBe("archive_unavailable")
    expect(readOriginalWorkEvidenceStage([message({ name: "original_work_download", action: "invoke", status: "error", code: "tool_failed" })])).toBe("archive_unavailable")
    expect(readOriginalWorkEvidenceStage([message({ name: "original_work_download", action: "invoke", status: "error", code: "describe_required" })])).toBe("none")
    expect(originalWorkEvidenceRepairHint({ stage: "archive_unavailable", hasWebResearch: true, hasArchive: true })).toContain("未核验")
  })

  it("keeps old imported evidence but repeats searches with the new provider after old-provider failures", () => {
    const message = (stage: string) => ({ role: "system", kind: "phase_instruction", content: JSON.stringify({ protocol: "original-work-evidence-gate-v1", stage }) })
    expect(readOriginalWorkEvidenceStage([message("lncrawl_imported")])).toBe("archive_imported")
    expect(readOriginalWorkEvidenceStage([message("lncrawl_searched")])).toBe("web_attempted")
    expect(readOriginalWorkEvidenceStage([message("lncrawl_unavailable")])).toBe("web_attempted")
  })
})
