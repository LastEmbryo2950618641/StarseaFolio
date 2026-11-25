---
title: 用户消息后
---

# 用户消息后

<!-- phase:response-review -->

## 子阶段：response-review

# response_review

复核即将展示的只读回答或其他文本。

- 每个确定结论必须能返回本轮实际读取依据。
- 先核对本轮实际返回的 Evidence：存在匹配的 `source` 原文单元时，不得声称原文未命中或把原句标成不可复核；只有图概括而没有原文单元时，才明确说明无法逐字确认。
- 不泄露当前叙事主体未接触但全局已知的信息。
- 不把用户说法、检索请求或未提交草稿当作世界事实。
- 回答若产生应持久化的新世界内容，要求升级到含图治理的工作流。
- 只读复核不提交图修改。

## 查询条件审核（workflow=query 必填）

必须输出 `artifact.queryGrounding`，不要只给 `evidenceClosed=true`。独立对照原始 `userInput`、草稿和本轮已读 Evidence，不把 interpret 的改写当成用户问题，不把草稿当证据。

- `answerDisposition`：`supported` 表示草稿的确定答案有完整支持；`abstained` 表示草稿已明确表达无法确定（或用户指定的拒答格式）；`unsupported` 表示草稿仍在无依据作答或答非所问。
- `constraints`：至少一项，只记录影响事实答案的语义条件，覆盖主体/关系，以及存在的全部时间、目标事件、资料截止点和真实性条件。每项给 `condition`、`kind`（事实条件填 `fact`）、`status`（`supported|unknown|contradicted`）、`evidenceRefs` 和 `reason`。事实支持项必须引用本轮真实 read ID；未知项可以无引用并说明缺口。输出格式、标点和 JSON 形状不是事实条件，按用户要求直接校验格式，不要放入 `constraints`。
- 审核的是“证据是否支持这个条件下的答案”，不是关键词是否出现。问未来事件，证据只有当前状态时，该事件时点必须为 `unknown`；不能用“此后没有记录变化”证明未来不变。历史问题按历史证据作答，不能使用最新 head 替换。
- 若草稿仍把当前替代未来、计划替代完成、传闻替代事实或遗漏必要证明，标记 `unsupported`、`evidenceClosed=false`、`outcome=revise`；说明应修正为未知或补齐哪条证据。已经正确拒答且明确指出必要条件未知时，可以闭合复核，无须为了拒答不断检索。
- 不要拒绝资料已经明确支持的事实，也不要擅自改写用户要求的 JSON、短答案或其他格式。
- `upgradeReason` 只有在 `requiresWorkflowUpgrade=true` 时填写；否则省略该字段，不要返回空字符串。

代码会检查结构化结论与条件是否一致，并将不满足条件的确定答案退回重写；不能以顶层布尔值覆盖条件缺口。

<!-- /phase:response-review -->

<!-- query:draft-query -->
## 只读查询：回答
- 只读回答原始 `userInput`，严格遵守其输出格式；不新增世界内容，不改图，不把未提交草稿当世界事实。
- 缺所问事件/时点/事实完成或真实性的必要证据时，明确回答资料不足；用户要求 JSON 拒答时按其格式返回。
- 当前状态不能回答未来某天；计划不能回答实际完成；传闻不能证明核实。可回答的普通事实仍须回答，不因无关缺口一律拒答。
- 上一版未通过只读复核时，逐项修正 feedback 指出的问题，重新核对本轮 `readEvidence`，不得原样返回。
<!-- /query:draft-query -->

<!-- query:source-query -->
## 只读查询：检索
- 逐项核对原始问题的主体、关系、所问事件/时点、章节截止点和确定性；`interpret` 只是检索假设。
- 当前状态不自动延续到未来；计划不证明已完成，传闻不证明已核实，后来的状态不覆盖历史时点。
- 资料仅覆盖当前而问题问未来时，不能用当前持有人填补缺口；资料明确记载未来安排时，只能回答“安排”，不能冒充已发生结果。
- 已确认现有快照不含目标事件时，结束检索并保留未知，不反复搜索同一对象。
<!-- /query:source-query -->

<!-- query:query-grounding -->
## 只读查询：复核

Query grounding failed: preserve every original question condition, cite read evidence for each supported condition, or explicitly state that the answer is unknown.

- 输出 `queryGrounding`：`answerDisposition` 为 supported / abstained / unsupported。
- `constraints` 至少一项，覆盖主体/关系以及全部时间、目标事件、资料截止点和真实性条件；每项给 `condition`、`kind`、`status`、`evidenceRefs`、`reason`。
- 事实支持项必须引用本轮真实 read ID；未知项可以无引用并说明缺口；不能以顶层布尔值覆盖条件缺口。
- 草稿把当前替代未来、计划替代完成、传闻替代事实或遗漏必要证明时，标记 unsupported、evidenceClosed=false、outcome=revise。
<!-- /query:query-grounding -->
