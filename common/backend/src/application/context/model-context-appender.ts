import type { PhaseRequestEnvelope, VisibleModelContextMessage } from "@starseafolio/contracts"

export const MODEL_CONTEXT_DELTA_HEADER = "Worldseed context delta JSON:"

export class ModelContextAppender {
  public createDelta(
    request: PhaseRequestEnvelope,
    modelRequest: unknown,
    previousMessages: readonly VisibleModelContextMessage[],
  ): unknown {
    const source = asRecord(modelRequest)
    const input = asRecord(source.input)
    const previousDeltas = previousMessages.flatMap((message) => parseDelta(message.content))
    const previousInputs = previousDeltas.map((delta) => asRecord(asRecord(delta).input))
    const firstRequestInTurn = !previousMessages.some((message) => (
      message.turnId === request.turnId && message.kind === "phase_request"
    ))
    const resurfacedReadIds = arrayOfStrings(input.resurfacedReadIds)
    const readEvidence = selectNewEvidence(input.readEvidence, previousInputs, resurfacedReadIds)
    const presentationEvidence = readEvidence.filter(isPresentationEvidence)
    const factualEvidence = readEvidence.filter((evidence) => !isPresentationEvidence(evidence))
    const readIds = new Set(readEvidence.flatMap((value) => {
      const readId = asRecord(value).readId
      return typeof readId === "string" ? [readId] : []
    }))
    const retrievalGaps = selectNewStructuralValues(input.retrievalGaps, previousInputs, "retrievalGaps")
    const graphCapacity = selectChangedStructuralValue(input.graphCapacity, previousInputs, "graphCapacity")
    const verificationProbeExecutions = selectNewProbeExecutions(
      input.verificationProbeExecutions,
      previousInputs,
    )
    const stageProjection = selectChangedStageProjection(input.stageProjection, previousInputs)
    const revision = selectChangedStructuralValue(input.revision, previousInputs, "revision")
    const artifacts = selectChangedArtifacts(input.artifacts, previousDeltas)
    const workspaceCatalogAlreadyVisible = previousInputs.some((previous) => previous.workspaceCatalog !== undefined)
    const coreInput = firstRequestInTurn ? selectCoreTurnInput(input, previousInputs) : {}
    const chapterProse = resolveVisibleChapterProse(coreInput, previousInputs)
    const slimmedArtifacts = slimDuplicateDraftProse(
      slimGovernanceSettlementsForContext(artifacts),
      chapterProse,
    )
    const deltaInput = {
      ...(input.workspaceCatalog === undefined || workspaceCatalogAlreadyVisible
        ? {}
        : { workspaceCatalog: input.workspaceCatalog }),
      ...(factualEvidence.length === 0 ? {} : { readEvidence: factualEvidence }),
      ...(resurfacedReadIds.length === 0 ? {} : { resurfacedReadIds }),
      ...coreInput,
      ...(revision === undefined ? {} : { revision }),
      ...(presentationEvidence.length === 0 ? {} : { presentationEvidence }),
      ...(retrievalGaps.length === 0 ? {} : { retrievalGaps }),
      ...(graphCapacity === undefined ? {} : { graphCapacity }),
      ...(verificationProbeExecutions.length === 0 ? {} : { verificationProbeExecutions }),
      ...(stageProjection === undefined ? {} : { stageProjection }),
      ...(Object.keys(slimmedArtifacts).length === 0 ? {} : { artifacts: slimmedArtifacts }),
    }
    const committedReadIds = arrayOfStrings(source.committedReadIds).filter((readId) => readIds.has(readId))
    const visiblePendingIds = arrayOfStrings(source.visiblePendingIds).filter((readId) => readIds.has(readId))
    return {
      phase: source.phase,
      protocolVersion: source.protocolVersion,
      committedReadIds,
      visiblePendingIds,
      remainingBudget: source.remainingBudget,
      input: deltaInput,
    }
  }

  public formatDelta(delta: unknown): string {
    return `${MODEL_CONTEXT_DELTA_HEADER}\n${JSON.stringify(delta)}`
  }
}

function selectChangedStageProjection(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
): unknown {
  if (value === undefined) return undefined
  const projection = asRecord(value)
  const projectionDigest = projection.projectionDigest
  if (typeof projectionDigest !== "string") {
    return selectChangedStructuralValue(value, previousInputs, "stageProjection")
  }
  const alreadyVisible = previousInputs.some((input) => (
    asRecord(input.stageProjection).projectionDigest === projectionDigest
  ))
  return alreadyVisible ? undefined : value
}

function isPresentationEvidence(value: unknown): boolean {
  return asRecord(value).ownerKind === "workspace:presentation"
}

function selectCoreTurnInput(
  input: Record<string, unknown>,
  previousInputs: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const entries: [string, unknown][] = [
    "workflow",
    "userInput",
    "userRequirements",
    "chapterSequence",
    "allowWorkspaceChapterReads",
    "presentation",
    "projectSettings",
  ].flatMap((key): [string, unknown][] => input[key] === undefined ? [] : [[key, input[key]]])
  if (input.synopsisDiscuss !== undefined) {
    entries.push(["synopsisDiscuss", slimSynopsisDiscuss(input.synopsisDiscuss, previousInputs)])
  }
  return Object.fromEntries(entries)
}

function slimSynopsisDiscuss(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const discuss = { ...asRecord(value) }
  delete discuss.conversationHistory
  const previous = previousInputs.map((input) => asRecord(input.synopsisDiscuss))
  const lastSynopsis = [...previous].reverse().find((item) => typeof item.synopsisMarkdown === "string")
  const lastOutline = [...previous].reverse().find((item) => typeof item.outlineMarkdown === "string")
  const lastBody = [...previous].reverse().find((item) => typeof item.chapterBodyMarkdown === "string")
  const lastDraft = [...previous].reverse().find((item) => typeof item.latestDraftMarkdown === "string")
  if (
    typeof discuss.synopsisMarkdown === "string"
    && lastSynopsis?.synopsisMarkdown === discuss.synopsisMarkdown
  ) {
    delete discuss.synopsisMarkdown
  }
  if (
    typeof discuss.outlineMarkdown === "string"
    && lastOutline?.outlineMarkdown === discuss.outlineMarkdown
  ) {
    delete discuss.outlineMarkdown
  }
  if (
    typeof discuss.chapterBodyMarkdown === "string"
    && lastBody?.chapterBodyMarkdown === discuss.chapterBodyMarkdown
  ) {
    delete discuss.chapterBodyMarkdown
  }
  if (
    typeof discuss.latestDraftMarkdown === "string"
    && lastDraft?.latestDraftMarkdown === discuss.latestDraftMarkdown
  ) {
    delete discuss.latestDraftMarkdown
  }
  return discuss
}

function selectChangedStructuralValue(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
  key: string,
): unknown {
  if (value === undefined) return undefined
  const serialized = JSON.stringify(value)
  const previousValues = previousInputs.flatMap((input) => (
    input[key] === undefined ? [] : [JSON.stringify(input[key])]
  ))
  return previousValues.at(-1) === serialized ? undefined : value
}

function selectNewEvidence(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
  resurfacedReadIds: readonly string[],
): unknown[] {
  if (!Array.isArray(value)) return []
  const resurfaced = new Set(resurfacedReadIds)
  const previousIdentities = new Set(previousInputs.flatMap((input) => [
    ...arrayOfUnknowns(input.readEvidence),
    ...arrayOfUnknowns(input.presentationEvidence),
  ].flatMap(evidenceIdentities)))
  return value.filter((evidence) => {
    if (evidenceReadIds(evidence).some((readId) => resurfaced.has(readId))) return true
    const identities = evidenceIdentities(evidence)
    return identities.length === 0 || !identities.some((identity) => previousIdentities.has(identity))
  })
}

function evidenceReadIds(value: unknown): string[] {
  const evidence = asRecord(value)
  return [
    evidence.readId,
    evidence.canonicalReadId,
    ...arrayOfUnknowns(evidence.readIdAliases),
  ].filter((readId): readId is string => typeof readId === "string")
}

function evidenceIdentities(value: unknown): string[] {
  const evidence = asRecord(value)
  // read-N is allocated anew for every model request, so it cannot identify a
  // fact across requests. Reusing that alias used to silently drop new web bodies.
  const readIds = evidenceReadIds(evidence)
  const versionKey = typeof evidence.versionKey === "string" ? evidence.versionKey : undefined
  const content = evidence.digest ?? evidence.semanticText
  const contentIdentity = versionKey === undefined
    && readIds.some((readId) => /^read-\d+$/u.test(readId))
    && typeof content === "string"
    ? [`content:${JSON.stringify([evidence.ownerKind, evidence.ownerId, content])}`]
    : []
  // Same workspace/graph owner already on the chain should not be re-appended just
  // because a later read allocated a new versionKey or digest. Resurface explicitly
  // when the model must see a refreshed copy.
  const ownerIdentity = typeof evidence.ownerKind === "string" && typeof evidence.ownerId === "string"
    ? [`owner:${evidence.ownerKind}:${evidence.ownerId}`]
    : []
  return [
    ...ownerIdentity,
    ...(versionKey === undefined ? [] : [`version:${versionKey}`]),
    ...contentIdentity,
    ...readIds.filter((readId) => !/^read-\d+$/u.test(readId)).map((readId) => `read:${readId}`),
  ]
}

function selectNewStructuralValues(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
  key: string,
): unknown[] {
  if (!Array.isArray(value)) return []
  const previous = new Set(previousInputs.flatMap((input) => (
    Array.isArray(input[key]) ? input[key].map((item) => JSON.stringify(item)) : []
  )))
  return value.filter((item) => !previous.has(JSON.stringify(item)))
}

function selectNewProbeExecutions(
  value: unknown,
  previousInputs: readonly Record<string, unknown>[],
): unknown[] {
  if (!Array.isArray(value)) return []
  const previousIndexes = new Set(previousInputs.flatMap((input) => (
    Array.isArray(input.verificationProbeExecutions)
      ? input.verificationProbeExecutions.flatMap((item) => {
        const probeIndex = asRecord(item).probeIndex
        return typeof probeIndex === "number" ? [probeIndex] : []
      })
      : []
  )))
  return value.filter((item) => {
    const probeIndex = asRecord(item).probeIndex
    return typeof probeIndex !== "number" || !previousIndexes.has(probeIndex)
  })
}

function selectChangedArtifacts(
  value: unknown,
  previousDeltas: readonly unknown[],
): Record<string, unknown> {
  const artifacts = asRecord(value)
  const previousArtifacts = previousDeltas
    .map((delta) => asRecord(asRecord(delta).input).artifacts)
    .map(asRecord)
  return Object.fromEntries(Object.entries(artifacts).filter(([artifactPhase, artifact]) => {
    const previousArtifact = previousArtifacts
      .flatMap((previous) => previous[artifactPhase] === undefined ? [] : [previous[artifactPhase]])
      .at(-1)
    return previousArtifact === undefined || JSON.stringify(previousArtifact) !== JSON.stringify(artifact)
  }))
}

/** Prefer a single chapter prose copy: drop draft.contentMarkdown when it matches userInput already on the chain. */
function resolveVisibleChapterProse(
  coreInput: Record<string, unknown>,
  previousInputs: readonly Record<string, unknown>[],
): string | undefined {
  if (typeof coreInput.userInput === "string" && coreInput.userInput.length > 0) {
    return coreInput.userInput
  }
  for (let index = previousInputs.length - 1; index >= 0; index -= 1) {
    const previous = previousInputs[index]?.userInput
    if (typeof previous === "string" && previous.length > 0) return previous
  }
  return undefined
}

function slimDuplicateDraftProse(
  artifacts: Record<string, unknown>,
  chapterProse: string | undefined,
): Record<string, unknown> {
  if (chapterProse === undefined || artifacts.draft === undefined) return artifacts
  const draft = asRecord(artifacts.draft)
  if (draft.contentMarkdown !== chapterProse) return artifacts
  const { contentMarkdown: _omit, ...rest } = draft
  return {
    ...artifacts,
    draft: rest,
  }
}

/**
 * Compress repeated settlement reasons/graphRef arrays when graph_governance enters the
 * model chain. Orchestrator state keeps the full artifact; only the delta is slimmed.
 */
function slimGovernanceSettlementsForContext(
  artifacts: Record<string, unknown>,
): Record<string, unknown> {
  const governance = artifacts.graph_governance
  if (governance === undefined) return artifacts
  const record = asRecord(governance)
  const settlements = arrayOfUnknowns(record.settlementRecords)
  if (settlements.length === 0) return artifacts
  const reasonSets: Array<{ reason: string }> = []
  const reasonIndexes = new Map<string, number>()
  const graphRefSets: Array<{ graphRefs: unknown }> = []
  const graphRefIndexes = new Map<string, number>()
  const compactRecords = settlements.map((item) => {
    const settlement = asRecord(item)
    const reason = typeof settlement.reason === "string" ? settlement.reason : ""
    let reasonIndex = reasonIndexes.get(reason)
    if (reasonIndex === undefined) {
      reasonIndex = reasonSets.length
      reasonIndexes.set(reason, reasonIndex)
      reasonSets.push({ reason })
    }
    const graphRefs = settlement.graphRefs
    const graphKey = JSON.stringify(graphRefs ?? null)
    let graphRefSetIndex = graphRefIndexes.get(graphKey)
    if (graphRefSetIndex === undefined) {
      graphRefSetIndex = graphRefSets.length
      graphRefIndexes.set(graphKey, graphRefSetIndex)
      graphRefSets.push({ graphRefs })
    }
    return {
      sourceUnitIndex: settlement.sourceUnitIndex,
      graphRefSetIndex,
      reasonIndex,
      status: settlement.status,
    }
  })
  return {
    ...artifacts,
    graph_governance: {
      ...record,
      settlementReasonSets: reasonSets,
      settlementGraphRefSets: graphRefSets,
      settlementRecords: compactRecords,
    },
  }
}

function parseDelta(content: string): unknown[] {
  if (!content.startsWith(`${MODEL_CONTEXT_DELTA_HEADER}\n`)) return []
  try {
    return [JSON.parse(content.slice(MODEL_CONTEXT_DELTA_HEADER.length + 1)) as unknown]
  } catch {
    return []
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function arrayOfUnknowns(value: unknown): unknown[] {
  return Array.isArray(value) ? value as unknown[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
