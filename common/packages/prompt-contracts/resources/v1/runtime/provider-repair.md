# Provider repair

## draft-word-count

正文实际 {{count}} 字，要求 {{minimum}}–{{maximum}} 字。请保留用户要求和既有笔风，调整并完整重交正文。

## fiction-delivery-failure

The previous response was a fiction-delivery failure. 按《内容处理规则》和当前阶段重新提交实质产物，保留可呈现的核心事件与后果。需先读取资料时，交付结构化读取请求。

## incomplete-response

The previous response was truncated or syntactically incomplete. Regenerate the complete object from the original request; do not continue or echo the partial response.

## exclusive-tool-request

上一轮非法：toolRequest 不能与章节写入/草稿/choices/focusChange 等同回。本轮二选一——只 toolRequest（另加 assistantMessage+finalSelfReview），或去掉 toolRequest 只交付产物。不要复述上一份无效 JSON。

## invalid-graph-reference

上一轮图引用非法：只能使用本轮可用的图引用（永久 node_*/link_*、旧版 node-*/link-* 别名或已声明的 local:*），不能写章节名、人名或标题。请整份重生成合法 JSON。

## validation-failure

The previous response failed validation. Regenerate the complete object from the original request; do not echo the invalid response.

## validation-error

Validation error: {{error}}

## scene-source-coverage

- Repair scene source coverage completely: the union of all sceneSpacetimeBindings.sourceUnitIndexes must contain each zero-based index from 0 through {{lastSourceIndex}} exactly once.
- Preserve the existing scene bindings and add every missing source unit to the scene that actually covers it; do not use an empty array for a narrative scene and do not move coverage to a later phase.

## source-settlement-coverage

- Repair source settlement coverage completely: settlementRecords.sourceUnitIndex must contain each zero-based index from 0 through {{lastSourceIndex}} exactly once, and every record must have at least one graph return path.

## fiction-delivery-hint

- Follow the current phase and 《内容处理规则》 when regenerating. Preserve the author's requested narrative events and their consequences within the applicable content rules.

## citation-hint

- Current citation allowlist: {{citationAllowlist}}.
- Recheck each citation against readable evidence. Never infer alias mappings, reuse historical aliases, or remove a needed citation to pass validation; request the evidence again if it is missing.

## graph-reference-hint

- Graph reference fields accept owner IDs read in this turn (node_*/link_* permanent IDs or legacy node-*/link-* aliases), anchors explicitly allowed by this phase's stage projection, and declared local:* handles where allowed. Never put chapter titles, character display names, scene labels, or other prose into a graph reference field.
- Read-evidence to graph-owner alias map: {{graphReferencePairs}}.
- Replace each invalid reference in the validation error with an allowed reference that identifies the intended graph object. Do not invent IDs and do not drop required bindings just to pass validation.

## syntax-hint

- The prior result was incomplete or invalid JSON. Regenerate compact JSON with concise prose and close the complete object below the provider's configured output limit.

## repair-contract

REPAIR CONTRACT: the original mandatory output contract is already in the preceding request message.
Regenerate one complete result for the original phase. Return one JSON object with the same top-level shape and all required artifact fields; do not echo or patch only the invalid fragment.
Keep the existing gate and reference rules. Do not omit required coverage or weaken validation to make the response pass.

## original-phase

Original phase: {{phase}}.

## close-result

Close the JSON object immediately after the required result.
