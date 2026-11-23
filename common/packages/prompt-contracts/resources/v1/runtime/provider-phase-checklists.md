# Provider phase checklists

## synopsis-discuss-evidence

- {{evidenceCount}} readEvidence item(s) are already visible. Prefer finishing with outcome=continue and a complete artifact; request_read only for missing files.

## synopsis-discuss-no-evidence

- No readEvidence yet. If world/settings context is needed, start with outcome=request_read for 设定集/readme.md (sourceKinds reference).

## synopsis-discuss

- synopsis_discuss must either request_read OR return a complete artifact object; never omit artifact when outcome is continue.
- artifact must include assistantMessage (user-facing) and finalSelfReview; nest chapterTitle/synopsisBody/choices/goalProposals inside artifact when needed.
- Do not put '我先去读设定' style intentions into assistantMessage; use outcome=request_read instead.
{{evidenceRule}}
- Prior published chapter bodies may be read with request_read (章节正文 exactKeys, sourceKinds source) and/or past_chapter_text; focus locks writes, not these reads.

## dependency-narrative-sources

- The complete draft has narrative source unit indexes exactly: {{sourceIndexes}}. sceneContinuity must not be empty and must describe every actual spacetime-distinct scene needed to cover that complete draft; graph_governance will bind all listed source units to these scenes.

## dependency-background-evolution

- This background evolution has no narrative source units. sceneContinuity may be empty only when the evolution artifact itself contains no spacetime-distinct scene that requires continuity auditing.

## dependency-no-narrative-sources

- No narrative source units are present. Do not invent draft scenes; include sceneContinuity entries only for actual phase content that requires spacetime continuity auditing.

## dependency-audit

- This dependency audit belongs to workflow={{workflow}} and currently has {{sourceUnitCount}} persisted narrative source unit(s). Do not infer another workflow from the prose or prior artifacts.
{{sceneRule}}
- A newly inferred person, place, event, object, or other thing does not make a scene unsupported. Audit whether its time, place, prior evolution, and current state are continuous; do not omit the scene merely because some contents are newly created this turn.
- When the draft states a specific past action, continuing state, or existing result, supporting evidence must directly cover the same subject, action or state, and result. A nearby place, related entity, or similar theme is insufficient; request a bounded read when direct support is absent, and otherwise retain uncertainty without rejecting the whole turn.

## rule-assembly

- rule_assembly currently has {{readableWorkspacePathCount}} readable workspace path(s). Select only from those read-evidence paths and never enumerate workspaceCatalog as output.
- selectedWorkspacePaths must contain unique paths. selectionReasons must have exactly the same path keys, with one short sentence per selected path.
- This phase has no long-text field. Never place file contents, rules, catalog entries, or repeated explanations inside any string field.
- Do not copy file contents, catalog entries, evidence payloads, prior artifacts, schemas, or the request into artifact fields. Return the smallest complete JSON result.
- If no additional workspace file is needed, return this compact artifact shape: {"selectedWorkspacePaths":[],"selectionReasons":{},"unresolvedRuleConflicts":[]}.

## semantic-review-no-probes

- No application verification probes are available in this request.

## semantic-review-probes

- The application executed verification probes with indexes: {{probeIndexes}}. Return exactly one verificationProbeAssessment for each of these indexes, preserve each executed descriptor unchanged, and do not add any other index.

## semantic-review

- semantic_review is advisory. Report only indexes and references for which you have an actual review conclusion; do not enumerate no-opinion items.
- affected frontiers available for review: {{frontiers}}.
{{probeRule}}

## temporal-evidence-references

- temporalClaimAssessments[].evidenceRefs accepts only evidence_*/read-* IDs present in this request's readEvidence. Never put node_*, link_*, proposal:* or local:* there; when a claim is supported only by current-turn artifacts or proposal-overlay results, leave evidenceRefs empty and explain that support in narrativeContext and reason.

## governance-review-no-probes

- No application verification probe has been executed yet. You must return outcome=request_read with at least one AI-defined requestedReads[].verificationProbe; do not finish the review and do not fabricate an assessment.
{{temporalEvidenceRule}}

## governance-review-probes

- input.verificationProbeExecutions contains application-executed results for probe indexes: {{probeIndexes}}. These are real execution records, not plans or model-generated claims.
{{probeRecords}}
- Assess each execution from verificationProbeExecutions together with the same request's readEvidence, returnedReadRefs, returnedGraphRefs, returnedProposalRefs, and resultDigest. Return exactly one verificationProbeAssessment for each listed probe index and no other index.
- Do not claim that probe execution results were not provided when these fields are present. A probe may still receive verdict=uncertain or verdict=fail when its actual returned evidence is insufficient.
{{temporalEvidenceRule}}

## background-scene-sources

- This is a background evolution with no narrative source units, so every sourceUnitIndexes array must be empty.

## spacetime-narrative-scene-sources

- Every dependency-audit scene in this turn is a narrative scene and must bind at least one source unit index.

## spacetime-scene-predecessors

Scene {{sceneIndex}}: predecessorSceneIndexes must equal [{{predecessorSceneIndexes}}]

## spacetime-scene-predecessor-anchors

predecessorSceneAnchorRefs must be non-empty

## spacetime-scene-transition-path

transitionPathRefs must be non-empty

## spacetime-scene-correspondence

correspondenceRefs must be non-empty

## graph-spacetime-settlement

- Required dependency-audit scene indexes are exactly: {{sceneIndexes}}. Return one sceneSpacetimeBinding for each listed index, with no missing, duplicate, or extra scene index.
- Required narrative source unit indexes are exactly: {{sourceIndexes}}. Their union across sceneSpacetimeBindings.sourceUnitIndexes must equal this list exactly once, with no missing, duplicate, negative, or extra index.
{{sourceRule}}
{{sceneRequirements}}- proposalSettlements.proposalRefs must cover these proposal references exactly once: {{proposalRefs}}.
- temporalClaimSettlements must cover these temporal claims exactly once and preserve each claim's sceneIndex: {{temporalClaims}}.
- When predecessorRequired is true but predecessorSceneIndexes is empty, the predecessor is outside this turn. Bind it through predecessorSceneAnchorRefs and provide the actual transitionPathRefs that connect the prior state to this scene.
- A predecessorSceneRef may already be a graph or declared local reference; reuse it exactly when valid. When a predecessorSceneRef is evidence, convert it through the supplied evidence-to-graph-owner map before placing it in predecessorSceneAnchorRefs or transitionPathRefs. Never copy an evidence ID into a graph-owner field or invent a graph ID.
- historicalReturnRefs are graph paths only: use node_*/link_* permanent IDs, legacy node-*/link-* aliases, or declared local:* handles; never use evidence_*/read-*.

## spacetime-scene-requirements

- {{requirements}}.

## governance-narrative-scene-sources

- Every dependency-audit scene in this turn is a narrative scene and must bind at least one source unit index, even when that scene has no new graph mutation. Never return an empty sourceUnitIndexes array for one of these scenes.

## graph-governance

- Finalize mutations first, then make mutationSpacetimeSettlements cover every zero-based index in your returned mutations array exactly once. Do not use one-based numbering, omit the final index, or infer a fixed mutation count from the input.
- decisionRecords is advisory detail. Omit repetitive per-mutation decisions; uncovered mutations inherit this phase result's reason and selfReview.
- settlementRecords is an optional mechanical projection. Omit it when it would repeat the scene and mutation settlement data; the backend derives missing source-unit return entries. If you provide it, use zero-based sourceUnitIndex values and do not repeat indexes.
- Required dependency-audit scene indexes are exactly: {{sceneIndexes}}. Return one sceneSpacetimeBinding for each listed index, with no missing, duplicate, or extra scene index.
- Required narrative source unit indexes are exactly: {{sourceIndexes}}. Their union across sceneSpacetimeBindings.sourceUnitIndexes must equal this list exactly once, with no missing, duplicate, negative, or extra index.
{{sourceRule}}
- For each sceneSpacetimeBinding, copy predecessorSceneIndexes exactly from dependency_audit. The first scene may therefore have an empty predecessorSceneIndexes array; never invent scene 0 or another current-turn index just to satisfy predecessorRequired.
- When predecessorRequired is true but predecessorSceneIndexes is empty, the predecessor is outside this turn. Bind it through predecessorSceneAnchorRefs using the exact existing graph-owner aliases mapped from the dependency evidence, and provide the actual transitionPathRefs that connect the prior state to this scene.
- dependency_audit predecessorSceneRefs are evidence references, not graph-owner fields. Convert them through the supplied evidence-to-graph-owner map before placing them in predecessorSceneAnchorRefs or transitionPathRefs; do not copy evidence IDs or invent graph IDs.
- historicalReturnRefs are graph paths only: use node_*/link_* permanent IDs, legacy node-*/link-* aliases, or local:*; never use evidence_*/read-*. Raw chapter/source return is already preserved by settlementRecords.
- edit_node.next must contain the complete latest current projection after applying this turn: preserve stable identity, descriptions, and retrieval information that remain true. Do not return only the changed fragment; revision history already preserves the previous projection.

## graph-structure-plan

- Return only structural proposals, affected frontiers, archive outlets, and their decision records. Do not emit scene bindings, retrieval projections, or spacetime settlements in this phase.
- Give every proposal one unique stable proposalRef and reuse it in decisionRecords; do not replace proposal references with mutation array indexes.
- edit_node.next must contain the complete latest current projection after applying this turn: preserve stable identity, descriptions, and retrieval information that remain true. Do not return only the changed fragment; revision history already preserves the previous projection.

## frontier-empty

artifact.frontiers must be an empty array.

## frontier-length

artifact.frontiers length must be exactly {{approvedFrontierCount}} and must not be empty.

## frontier-position

- artifact.frontiers[{{index}}].frontierAnchorRef must be exactly {{reference}}.

## frontier-scene-anchors

- This turn has approved scene bindings. Choose scene, time, and location anchors only from their corresponding approved anchors; do not promote another readable object to an anchor in this final settlement phase.

## frontier-prior-anchors

- This background evolution has no approved scene binding. Reuse only each frontier's own prior anchors listed below; do not borrow another frontier's anchors or promote another readable object to an anchor.

## frontier-prior-state

- Prior anchors for frontier {{frontierAnchorRef}}:; lastSceneAnchorRefs={{lastSceneAnchorRefs}}; lastTimeAnchorRefs={{lastTimeAnchorRefs}}; lastLocationAnchorRefs={{lastLocationAnchorRefs}}; correspondenceRefs={{correspondenceRefs}}.

## frontier-settlement

- frontier_settlement must settle each approved frontier exactly once. Exact frontier list: {{approvedFrontiers}}.
- Approved frontier count: {{approvedFrontierCount}}. {{lengthRule}}
{{approvedFrontierRequirements}}- A frontier is an independently resumable and discoverable local continuation boundary. It is not a mutation index and not a list of every node or link touched by graph governance; multiple mutations may belong to one frontier.
- Do not manufacture one frontier per mutation or copy the same spacetime anchors into many frontier records. If the approved list is empty, return an empty frontiers array.
- For every non-archived approved frontier, return that frontier's own last scene, time, and location anchors plus a non-empty revisitCondition. Use graph or local references already established in this request; do not invent technical IDs.
{{anchorRule}}{{priorFrontierStates}}

## default-checklist

- Preserve every exact cross-phase checklist item supplied in the model-facing request.

## executed-probe

- Executed probe record: probeIndex={{probeIndex}}; status={{status}}; returnedReadRefs={{returnedReadRefs}}; returnedGraphRefs={{returnedGraphRefs}}; returnedProposalRefs={{returnedProposalRefs}}; resultDigest={{resultDigest}}
