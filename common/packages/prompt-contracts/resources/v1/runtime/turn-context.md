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
