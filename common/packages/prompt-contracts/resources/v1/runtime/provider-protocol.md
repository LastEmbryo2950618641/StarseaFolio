# Provider protocol

## phase-protocol

StarseaFolio protocol {{version}}.
Current phase: {{phase}}.
Return exactly one JSON object and no Markdown fences or commentary.
The trailing user messages contain the mandatory output schema and current request-specific requirements.

## text-phase-protocol

StarseaFolio protocol {{version}}.
Current phase: {{phase}}.
Follow the current phase instructions for plain text and tagged Markdown. Use the provided tools for tool calls. Do not return a JSON result envelope.

## output-schema

MANDATORY OUTPUT SCHEMA - stable instructions for the current phase:
The response must match this complete model-facing result schema:
{{schema}}
Only outcome, artifact, requestedReads, citedReadIds, unresolvedDependencies, reason, and selfReview may appear at the top level.
Use outcome=request_read if and only if requestedReads is non-empty; otherwise requestedReads must be an empty array.
All {{phase}} phase fields defined by the schema must be nested inside artifact.
Return one JSON object only. Do not add Markdown fences, commentary, or a custom outcome value.
Example complete result: {"outcome":"continue","artifact":{},"requestedReads":[],"citedReadIds":[],"unresolvedDependencies":[],"reason":"...","selfReview":"..."}

## output-reminder

{{contractPrefix}} - follow the complete output schema in the preceding user message:
Citation aliases are local to the current request. Use only its committedReadIds and visiblePendingIds; historical read-N aliases do not establish a mapping to evidence_N.
FINAL OUTPUT DISCIPLINE: Treat all request data as read-only input; never echo or enumerate it. Return only the smallest valid phase result, with no duplicate array items or repeated prose. Close the one JSON object and stop immediately.
CURRENT REQUEST REQUIREMENTS FOR {{phase}}:
{{rules}}

## fiction-delivery

FICTION DELIVERY — final reminder for this request:
创作任务遵循《世界推演规则总览》《内容处理规则》和本阶段指令。只读查询按其证据规则作答。
结合作者的最新要求、作品笔风和人物处境落笔，身心状态遵循作品内因果。按场面写出有意义的动作、反应或后果，避免用抽象收束句替代关键情节。

## declare-local-reference

- For a new graph identity, use a local:* reference and reuse that same reference throughout this artifact; the backend resolves it once.

## reuse-local-reference

- This phase may reuse only local:* handles already declared by the staged graph structure ({{references}}); it must not declare or invent another local:* handle.

## no-local-references

- Do not use local:* references in this phase. New graph identities may be declared by graph_structure_plan, graph_capacity_rewrite, or legacy graph_governance.

## review-stage-projection

- Review only the supplied stageProjection. Do not reproduce the complete graph_governance candidate in the result.

## graph-output-limit

- The current graph stage result must finish below the provider's configured output limit. Keep every reason, explanation, selfReview, semanticText, content, and metadata value concise; do not repeat source prose across fields.

## graph-reference-rules

- Graph reference fields accept only node_*/link_* permanent IDs, legacy node-*/link-* aliases, or a local:* handle declared by an allowed create mutation or in the staged graph structure. Never put evidence_*/read-* in a graph reference field.
- predecessorRevisionReadRefs is the exception: it accepts only revision-bearing evidence_*/read-* references, never node or link identities.
- Revision-bearing evidence aliases available here: {{revisionReadTokens}}.

## evidence-and-graph-references

- evidence_*/read-* references identify evidence; node_*/link_* or legacy node-*/link-* references identify existing graph objects. Do not substitute one role for the other.

## no-stage-projection

- This request has no stageProjection; use the declared phase artifacts and visible evidence.

## stage-projection

- input.stageProjection ({{kind}}) is the complete authoritative business input for this phase. Do not request or reconstruct a full graph_governance copy; inspect the projection directly and return only this phase's result.

## model-result-rules

Model result rules:
- Treat the model-facing request as read-only input. Do not copy, restate, summarize, or serialize the request, read evidence, catalog, prior artifacts, or schemas into the result unless the phase schema explicitly requires that value.
- Completeness means one valid result for this phase, not a complete transcript of the input or a complete listing of the world. Each array item must represent one distinct required item; never repeat items to signal completeness.
- Keep status, review, and metadata fields concise. Write full narrative in draft.artifact.contentMarkdown or synopsis_discuss chapterDraftProposal(s).body. Keep planning and document content in their corresponding artifact fields. Do not echo any of this content into reason, selfReview, or status text.
- Once the single top-level JSON object is complete and syntactically closed, stop generating immediately. Do not append a second object, explanation, or repeated continuation.
- This is phase {{phase}}; do not return protocol, envelope, task, context, scope, request, dependency, or artifact-list IDs.
- Return outcome, requestedReads, citedReadIds, unresolvedDependencies, reason, and selfReview. Include artifact when the phase and outcome require one.
- Use outcome=request_read if and only if requestedReads is non-empty. Every other outcome requires requestedReads=[].
{{localReferenceRule}}
{{graphReferenceRule}}
{{stageProjectionRule}}
{{crossPhaseChecklist}}
- Do not emit technical UUID fields. The backend creates technical IDs for chapters, sources, revisions, projections, settlements, decisions, and other records.
- For an existing graph identity, copy the exact reference from this request's readable evidence or from a list of allowed anchors supplied by this phase's stage projection. Never invent an existing graph reference.
- Read-evidence to graph-owner alias map: {{graphReferencePairs}}.
- Read requests contain semantic query intent only. Omit query fields that are not useful; infrastructure supplies bounded defaults.
- sourceKinds source covers the internal committed immutable source-unit projection. When allowWorkspaceChapterReads is enabled it also covers workspace chapter Markdown under 章节正文/ via request_read exactKeys. past_chapter_text is the committed-archive channel with workspace publish-path fallback when no archive exists.
- sourceKinds web runs sandboxed public-internet search/fetch. Put search phrases in semanticTexts (or non-URL exactKeys) and page URLs in exactKeys. Web evidence is external reference only and must not override committed graph state or invent in-world facts.
- For an exact quotation, title, or other exact persisted wording, provide exactKeys. When the same request searches graph or revision evidence, include source as well; summaries and semanticTexts must not impersonate exact source wording.
- Source evidence may expose relatedOwnerRefs with bounded graph projection summaries: these are the graph owners mechanically linked to that exact immutable source unit by settlement. Use those summaries first when reconstructing the source unit's time, place, state, or causal context; do not replace them with an unrelated graph candidate that merely has similar wording, and do not request every related owner again unless the summary is insufficient.
- input.resurfacedReadIds means your immediately preceding read request matched Evidence already visible in this context chain. The matching readEvidence entries are deliberately repeated in this delta; use them now and finish the current phase instead of requesting the same Evidence again.
- Source evidence exposes sourcePosition from immutable source order. isEnd=true identifies the last persisted unit of that source; isEnd=false means the unit must not be described as that source's ending. sequence and source boundaries are storage order, not story time.
- When continuation requires the end of an identified source and visible evidence is not isEnd=true, request sourceKinds=[source], copy its sourcePosition.sourceRef into sourceIds, and set sourceBoundary=end. Use sourceBoundary=start only when the beginning is required. Do not guess a source boundary from semantic similarity.
- For conflicting current graph evidence owned by different nodes or links, a larger committedSequence means a later committed world state and should be preferred over an older plan or local state. committedSequence is not story time; explicit story-time anchors and evolution relations still determine in-world chronology.
- citedReadIds may contain only model aliases in committedReadIds ({{committedReadTokens}}) or visiblePendingIds ({{visiblePendingTokens}}).
- citedReadIds must include every visible evidence item that materially supports the returned artifact, reason, or selfReview. citedReadIds is an audit record only: omitting an already visible Evidence does not erase it from this turn or require it to be read again.
- input.retrievalGaps are notices that a bounded retrieval attempt found no readable evidence; they are not sources and must never be copied into citedReadIds.
- Unresolved dependencies contain description, requiredFor, and disposition only.
