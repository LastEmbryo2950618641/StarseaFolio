import { describe, expect, it } from "vitest"
import type { PhaseRequestEnvelope } from "@starseafolio/contracts"

import { assembleModelPhaseResult, parseModelPhaseResult } from "../src/infrastructure/models/deepseek/model-phase-result-assembler.js"

describe("discussion result normalization", () => {
  const result = { outcome: "continue", artifact: { assistantMessage: "Updated." }, finalSelfReview: "Reviewed.",
    requestedReads: [], citedReadIds: [], unresolvedDependencies: [], reason: "Done.", selfReview: "Done." }
  it("accepts identical duplicated self-review without mutating provider data", () => {
    const value = { ...result, artifact: { ...result.artifact, finalSelfReview: result.finalSelfReview } }
    const parsed = parseModelPhaseResult(value, "synopsis_discuss")
    expect(parsed).not.toHaveProperty("finalSelfReview")
    expect(parsed.artifact).toMatchObject({ finalSelfReview: "Reviewed." })
    expect(value).toHaveProperty("finalSelfReview", "Reviewed.")
  })
  it("still rejects conflicting self-review, other unknown fields, and misplaced fields in other phases", () => {
    expect(() => parseModelPhaseResult({ ...result, artifact: { ...result.artifact, finalSelfReview: "Conflicting." } }, "synopsis_discuss")).toThrow()
    expect(() => parseModelPhaseResult({ ...result, unknownField: "Unexpected" }, "synopsis_discuss")).toThrow()
    expect(() => parseModelPhaseResult(result, "interpret")).toThrow()
  })
})

describe("graph governance result normalization", () => {
  const result = { outcome: "continue", artifact: {}, executionMode: "local_governance",
    requestedReads: [], citedReadIds: [], unresolvedDependencies: [], reason: "Done", selfReview: "Done" }
  it("moves a misplaced mode into the graph artifact", () => {
    expect(parseModelPhaseResult(result, "graph_governance").artifact).toEqual({ executionMode: "local_governance" })
  })
  it("does not guess between conflicting graph execution modes", () => {
    expect(() => parseModelPhaseResult({ ...result, artifact: { executionMode: "full_governance" } }, "graph_governance")).toThrow()
    expect(() => parseModelPhaseResult(result, "interpret")).toThrow()
  })
})

describe("assembleModelPhaseResult", () => {
  it("merges duplicate source settlement records before coverage validation", () => {
    const request = {
      ...createRequest(),
      phase: "graph_governance" as const,
      input: {
        ...createRequest().input,
        sourceUnitIds: ["source-1"],
        readEvidence: [{
          ...createRequest().input.readEvidence[0],
          ownerId: "node_1",
        }],
      },
    }
    const result = assembleModelPhaseResult({
      outcome: "continue",
      artifact: {
        executionMode: "local_governance",
        mutations: [],
        retrievalProjections: [],
        settlementRecords: [
          { sourceUnitIndex: 0, graphRefs: [{ targetKind: "node", targetRef: "node_1" }], reason: "第一条", status: "derived" },
          { sourceUnitIndex: 0, graphRefs: [{ targetKind: "node", targetRef: "node_1" }], reason: "第二条", status: "derived" },
        ],
        mutationSpacetimeSettlements: [],
        sceneSpacetimeBindings: [],
        affectedFrontierRefs: [],
        archiveOutletRefs: [],
        decisionRecords: [],
      },
      requestedReads: [],
      citedReadIds: [],
      unresolvedDependencies: [],
      reason: "合并重复原文结算",
      selfReview: "同一原文单元只保留一条结算记录",
    }, request)

    expect(result.artifact).toMatchObject({
      settlementRecords: [{
        sourceUnitIndex: 0,
        graphRefs: [{ targetKind: "node", targetRef: "node_1" }],
        reason: "第一条；第二条",
      }],
    })
  })

  it("accepts graph owners exposed through source relatedOwnerRefs", () => {
    const base = createRequest()
    const request = {
      ...base,
      phase: "dependency_audit" as const,
      input: {
        ...base.input,
        sourceUnitIds: ["source-1"],
        readEvidence: [{
          ...base.input.readEvidence[0],
          ownerKind: "source",
          ownerId: "source-1",
          relatedOwnerRefs: [{ ownerKind: "node", ownerId: "node_7" }],
        }],
      },
    }

    expect(() => assembleModelPhaseResult({
      outcome: "continue",
      artifact: {
        missingDependencies: [],
        unplannedContent: [],
        sceneContinuity: [],
        temporalClaims: [{
          claimRef: "claim:related-owner",
          sceneIndex: 0,
          sourceUnitIndexes: [0],
          proseExcerpt: "原文事实",
          referenceDescription: "关联图节点",
          referenceRefs: ["node_7"],
          evidenceRefs: ["evidence_1"],
          timelineRefs: [],
          relationDescription: "由 Source 关联图入口支持",
          verdict: "pass",
          reason: "关联图入口可读",
          missingEvidence: [],
        }],
        informationBoundary: "pass",
      },
      requestedReads: [],
      citedReadIds: ["evidence_1"],
      unresolvedDependencies: [],
      reason: "核对关联图入口",
      selfReview: "只引用当前 Source 暴露的关联节点",
    }, request)).not.toThrow()
  })

  it("keeps local handles declared by governance visible to later graph phases", () => {
    const base = createRequest()
    const request = {
      ...base,
      phase: "graph_retrieval_design" as const,
      input: {
        ...base.input,
        validationArtifacts: {
          graph_governance: {
            mutations: [{
              operation: "create_node",
              ref: "local:governance-node",
              data: { content: { name: "治理阶段节点" } },
            }],
            retrievalProjections: [],
            settlementRecords: [],
            mutationSpacetimeSettlements: [],
            sceneSpacetimeBindings: [],
            affectedFrontierRefs: [],
            archiveOutletRefs: [],
            decisionRecords: [],
          },
          graph_structure_plan: {
            proposals: [{
              proposalRef: "proposal:structure-node",
              mutation: {
                operation: "create_node",
                ref: "local:structure-node",
                data: { content: { name: "结构阶段节点" } },
              },
              reason: "声明结构阶段节点",
              selfReview: "引用句柄来自结构阶段",
            }],
            affectedFrontierRefs: [],
            archiveOutletRefs: [],
            decisionRecords: [{
              decisionKind: "retain",
              proposalRefs: ["proposal:structure-node"],
              reason: "保留结构阶段节点",
              payload: {},
              selfReview: "已覆盖该提案",
            }],
          },
        },
      },
    }

    expect(() => assembleModelPhaseResult({
      outcome: "continue",
      artifact: {
        projections: [
          { ownerRef: "local:governance-node", exactKeys: ["治理节点"], semanticText: "治理节点" },
          { ownerRef: "local:structure-node", exactKeys: ["结构节点"], semanticText: "结构节点" },
        ],
        sourceSettlements: [],
      },
      requestedReads: [],
      citedReadIds: [],
      unresolvedDependencies: [],
      reason: "设计图谱检索投影",
      selfReview: "治理阶段和结构阶段的本地句柄都可见",
    }, request)).not.toThrow()
  })

  it("normalizes a visible evidence alias to its canonical read ID", () => {
    const request = createRequest()

    const result = assembleModelPhaseResult({
      outcome: "continue",
      artifact: {
        workflow: "turn",
        userIntent: "继续观察",
        worldIntent: "保持当前世界连续性",
        presentationIntent: "沿用当前表现规则",
        userClaims: [],
        requiredTimeAnchor: true,
        requiredLocationAnchor: true,
        initialReadHypotheses: [],
      },
      requestedReads: [],
      citedReadIds: ["evidence_2"],
      unresolvedDependencies: [],
      reason: "使用链中已可见的旧引用",
      selfReview: "引用应规范化后校验",
    }, request, () => "00000000-0000-4000-8000-000000000099")

    expect(result.citedReadIds).toEqual(["evidence_1"])
  })

  it("normalizes visible evidence aliases inside phase artifacts", () => {
    const request = { ...createRequest(), phase: "dependency_audit" as const }

    const result = assembleModelPhaseResult({
      outcome: "continue",
      artifact: {
        missingDependencies: [],
        unplannedContent: [],
        sceneContinuity: [],
        temporalClaims: [{
          claimRef: "claim:arrival",
          sceneIndex: 0,
          sourceUnitIndexes: [0],
          proseExcerpt: "他在黄昏抵达。",
          referenceDescription: "黄昏抵达",
          referenceRefs: [],
          evidenceRefs: ["evidence_2"],
          timelineRefs: [],
          relationDescription: "相对前一场景连续",
          verdict: "pass",
          reason: "旧链证据支持该判断",
          missingEvidence: [],
        }],
        informationBoundary: "pass",
      },
      requestedReads: [],
      citedReadIds: ["evidence_2"],
      unresolvedDependencies: [],
      reason: "审查正文时间连续性",
      selfReview: "引用应规范化后再做契约校验",
    }, request, () => "00000000-0000-4000-8000-000000000099")

    expect(result.citedReadIds).toEqual(["evidence_1"])
    expect(result.artifact).toMatchObject({
      temporalClaims: [{ evidenceRefs: ["evidence_1"] }],
    })
  })

  it("accepts only frontier anchors authorized by the stage projection", () => {
    const request = createFrontierRequest()
    const result = assembleModelPhaseResult(frontierResult("node_277"), request)

    expect(result.artifact).toMatchObject({
      frontiers: [{
        frontierAnchorRef: "node_154",
        lastSceneAnchorRefs: ["node_277"],
        correspondenceRefs: ["link_411"],
      }],
    })
    expect(() => assembleModelPhaseResult(frontierResult("node_999"), request))
      .toThrow("previously read anchors")
  })
})

function frontierResult(sceneAnchorRef: string) {
  return {
    outcome: "continue" as const,
    artifact: {
      frontiers: [{
        frontierAnchorRef: "node_154",
        disposition: "active" as const,
        lastSceneAnchorRefs: [sceneAnchorRef],
        lastTimeAnchorRefs: ["node_277"],
        lastLocationAnchorRefs: ["node_154"],
        correspondenceRefs: ["link_411"],
        reason: "继续保留该局部演化入口",
        revisitCondition: "局部状态发生变化时重访",
      }],
    },
    requestedReads: [],
    citedReadIds: [],
    unresolvedDependencies: [],
    reason: "完成前沿结算",
    selfReview: "只复用同一前沿旧锚点",
  }
}

function createFrontierRequest(): PhaseRequestEnvelope {
  const governance = {
    mutations: [],
    retrievalProjections: [],
    settlementRecords: [],
    mutationSpacetimeSettlements: [],
    sceneSpacetimeBindings: [],
    affectedFrontierRefs: ["node_154"],
    archiveOutletRefs: [],
    decisionRecords: [],
  }
  const semanticReview = {
    approvedMutationIndexes: [],
    rejectedMutationIndexes: [],
    approvedSpacetimeBindingIndexes: [],
    rejectedSpacetimeBindingIndexes: [],
    approvedMutationSpacetimeSettlementIndexes: [],
    rejectedMutationSpacetimeSettlementIndexes: [],
    approvedAffectedFrontierRefs: ["node_154"],
    rejectedAffectedFrontierRefs: [],
    verificationProbeAssessments: [],
    sceneInventoryComplete: true,
    graphStillDiscoverable: true,
    graphStillConcise: true,
    continuityPreserved: true,
    spacetimeContinuityPreserved: true,
  }
  return {
    ...createRequest(),
    phase: "frontier_settlement",
    input: {
      workflow: "evolution",
      userInput: "推进后台世界演化",
      chapterSequence: 1,
      allowWorkspaceChapterReads: false,
      sourceUnitIds: [],
      phaseRunIds: [],
      readEvidence: [{
        readId: "evidence_1",
        visibility: "committed",
        ownerKind: "node",
        ownerId: "node_154",
        exactKeys: [],
        semanticText: "寄存处当前状态",
        sourceRefs: [],
        digest: "evidence-digest",
      }],
      retrievalGaps: [],
      artifacts: {},
      validationArtifacts: { graph_governance: governance, semantic_review: semanticReview },
      stageProjection: {
        kind: "frontier_settlement",
        version: 1,
        sourceArtifactDigests: {
          graph_governance: "digest-governance",
          semantic_review: "digest-review",
          settlement_review: "digest-settlement",
        },
        pendingScope: { scopeId: "scope_1", candidateDigest: "digest-scope" },
        projectionDigest: "digest-projection",
        unresolvedIssues: [],
        affectedFrontierRefs: ["node_154"],
        approvedSceneBindings: [],
        archiveOutletRefs: [],
        correspondenceRefs: [],
        priorFrontierStates: [{
          frontierAnchorRef: "node_154",
          lastSceneAnchorRefs: ["node_277"],
          lastTimeAnchorRefs: ["node_277"],
          lastLocationAnchorRefs: ["node_154"],
          correspondenceRefs: ["link_411"],
        }],
      },
    },
  }
}

function createRequest(): PhaseRequestEnvelope {
  return {
    schemaVersion: 1,
    protocolVersion: "1.0.0",
    envelopeId: "00000000-0000-4000-8000-000000000001",
    taskId: "00000000-0000-4000-8000-000000000002",
    turnId: "00000000-0000-4000-8000-000000000003",
    scopeId: "00000000-0000-4000-8000-000000000004",
    contextId: "00000000-0000-4000-8000-000000000005",
    phase: "interpret",
    attempt: 1,
    promptRef: "prompt:interpret",
    promptDigest: "prompt-digest",
    contextViewRef: "context-view",
    committedReadIds: ["evidence_1"],
    visiblePendingIds: [],
    remainingBudget: {
      remainingCalls: 10,
      remainingInputTokens: 100_000,
      remainingOutputTokens: 100_000,
      deadlineAtMs: Date.now() + 60_000,
    },
    input: {
      artifacts: {},
      sourceUnitIds: [],
      readEvidence: [{
        readId: "evidence_1",
        canonicalReadId: "evidence_1",
        readIdAliases: ["evidence_2"],
        versionKey: "node:node_1:revision_1",
        visibility: "committed",
        ownerKind: "node",
        ownerId: "node_1",
        exactKeys: ["旧引用"],
        semanticText: "同一事实版本",
        digest: "projection-a",
        sourceRefs: [],
      }],
    },
  }
}
