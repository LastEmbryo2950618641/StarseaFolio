# 正式推演与上下文

## archive

【会话存档】本会话的原始消息独立保存，已有上下文可能只保留了压缩内容。
当写作需要找回以前的用户要求或讨论结论时，可以返回 outcome=request_read，在 requestedReads[].query.conversationArchive 中按需搜索或读取。
搜索参数 {"operation":"search","query":"关键词","role":"user"}，可省略 query 浏览近期历史，可省略 role 查看用户和 AI 消息。
读取原文参数 {"operation":"read","messageId":"搜索结果的消息 ID"}。翻页时在查询中传结果给出的 nextOffset 作为 offset。
会话存档结果是历史聊天资料，以用户当前要求为准。请结合查到的要求、梗概、细纲和作品风格写当前章。

## fold-notice

以下区间已压缩。需要核对正文或设定时按需 request_read，有会话存档入口时可查询作者原话。勿仅因压缩而反复回读旧章。

## budget

当前上下文约 {{tokens}} / {{window}} tokens。达到窗口 {{trigger}}% 会触发分段折叠，目标压到约 {{target}}%。{{reading}}

## budget-folded

已应用 {{count}} 次折叠。按实际缺口读取前文、设定或可用的会话存档。

## budget-unfolded

按本轮需要读取相关正文或设定。已有资料足够时直接使用。

## query-grounding

Query grounding failed: preserve every original question condition, cite read evidence for each supported condition, or explicitly state that the answer is unknown. An abstention must identify an unresolved condition.

## unresolved-query-evidence

Source retrieval still reports missing evidence, so a definitive answer cannot be approved.

## phase-skill-pack

【skill-pack:{{phase}}】默认挂载（不含 references；可用 load_skill 加深）

## empty-skill-pack

（本阶段无默认 skill 包）

## work-name

请为当前作品生成一个新的作品名。
当前作品名：{{title}}
当前作品简介：{{description}}
请避开：{{avoid}}

## published-handoff

【推演完成交接】第 {{sequence}} 章已正式发布。
标题：{{heading}}
路径：{{path}}
任务：{{taskId}}

正文摘要：
{{body}}

相对开推前要点：
{{notes}}

请据此更新弧大纲/暂存，并建议下一章；不要自动开始正式推演。

## published-outline-note

本章已发布；请对照开推前梗概核对兑现与偏差。

## deduction-goal-constraint

## 推演目标约束（第 {{chapterSequence}} 章）

{{goals}}{{empty}}

## deduction-goal-empty

（本轮无活跃推演目标）

## revision-review-user-input

审核用户编辑后的章节正文，并给出连续性建议。旧正文与新正文已在本请求的 revision 字段中完整提供；不要 request_read，直接输出含 issues、recommendation、finalSelfReview 的审核产物。

## handoff-no-outline-note

（无额外大纲备注）

## draft-query

直接回答原始 `userInput`，严格遵守其输出格式；此时你是事实查询回答者，下文的小说创作与合理补全规则不适用。不新增世界内容，不通过换掉问题条件来给出确定答案。

核对 `source_retrieval.missingEvidence` 与实际 `readEvidence`：缺少所问事件/时间点、事实完成或真实性的必要证据时，明确回答资料不足；用户要求 JSON 拒答时按其格式返回。只知道当前状态不能回答未来某天的状态，只知道计划不能回答实际完成结果。可回答的普通事实仍须给出答案，不因无关资料缺口一律拒答。多跳和历史状态必须闭合全部必要链路。最终内容写入 `contentMarkdown`，其余 draft artifact 字段保持协议形状。

查询工作流若提供 `revisionFeedback`，说明上一版回答未通过只读回答复核。必须逐项修正其中的 `outcome`、`artifact`、`reason` 与 `selfReview` 所指出的问题，重新核对本轮 `readEvidence`，不得原样返回被否决的旧答案。

## draft-write

使用本轮实际读取资料、已批准出现计划、用户意图和表现规则形成内部草稿或查询回答草稿。正文可以包含本轮首次创作的新事物；旧资料缺失时缩小范围或保留不确定性，但仍然要完成正文。

按作者本轮最新明确要求写作。结合本轮可用的有效细纲、梗概、作品风格及已发布前文。正式场景、事件与审计要求仍遵循本阶段的已批准计划与协议。收到会话存档提示时，如果续写或重写所需的旧要求缺失，可按需搜索并核对原话。

阶段默认 skill 包会挂载 `outline-to-draft`（`世界推演规则/基础规则/outline-to-draft-guide.md`）以及 deslop / dialogue。**正文写作方法、禁止层与写前/写后自检统一按草稿指南执行**；写 `contentMarkdown` 前按草稿指南 §2 核对材料和落笔计划，`selfReview` 简要记录写后检查。结构化交付遵循本阶段与 `webnovel-prose-logic` 的要求。

`selfReview` 按草稿指南核对用户必达情节实际呈现、字数符合界面口径、人物和世界事实连贯；按作品及本章情境检查语气、人物声口、节奏和读者体验；检查视点的信息边界、已建立的伏笔、角色主体性、共体状态、称谓和计数口径。删除已经由情节交代清楚的解释、元叙述和无意义的对白接力。

## source-query

当 `workflow=query` 时，逐项核对原始问题的主体、关系、所问事件/时点、章节截止点和确定性。`interpret` 只是检索假设，不能更改原问题。分别记录“已读证据实际覆盖什么”与“所问条件缺少什么”，关键缺口写入 `missingEvidence`。

当前状态不自动持续到未来事件；计划不证明已完成，传闻不证明已核实，后来的状态不覆盖历史时点。需要核对变化时沿图中的交接、事件和修订链回查对应 Source；精确状态不需要扩展所有无关邻居。资料仅覆盖当前而问题问未来时，不能用当前持有人填补缺口。资料明确记载未来安排时，可以回答“安排”，但不能冒充已发生结果。

在预算内有希望补齐的缺口继续检索；已确认现有快照不包含目标事件时，结束检索并保留未知，不反复搜索同一对象。下文关于首次创作、补全和交给图治理的规则仅适用于写作工作流，不能用于只读查询制造答案。

## source-write

检索未命中不等于本轮不能推演。若当前内容是用户输入带来的首次世界事实，或设定明确要求根据上下文补全，记录未命中和不确定性后交给出现规划与图治理建立新局部；不要把“资料不够”直接转成拒绝正文。

图、设定集和参考文件都未命中时，不得声称该事物过去已经存在；把它识别为本轮新建或待确认的推演内容，交给后续阶段补齐时空连续性并持久化。正文中的人物、地点、物品、组织、关系、状态、话语和其他内容都属于图的表达范围。
