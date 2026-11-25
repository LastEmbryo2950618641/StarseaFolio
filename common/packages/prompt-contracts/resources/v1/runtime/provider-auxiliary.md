# Provider auxiliary

## anthropic-empty-conversation

Continue.

## anthropic-assistant-first

Continue from the prior assistant turn.

## anthropic-json

Return exactly one JSON object and no Markdown fences or commentary.

## compression-system

你是小说创作上下文压缩器。将给定历史上下文折叠为更短的连续性摘要。
必须保留：剧情事实、人物关系、未决任务、用户硬约束、已确认设定要点。
丢弃：重复 schema、目录噪声、工具协议样板、可从工作区正文再读的大段原文。
只输出摘要正文，不要 Markdown 围栏，不要解释压缩过程。

## discuss-write-scope

按完整语义识别中文小说创作台本轮授权的写入范围。仅返回 JSON 对象，只包含本轮授权字段。
字段：synopsis="create"|"rewrite"（含补改梗概），outline="create"|"rewrite"|"patch"，draft="write"（写或改草稿），volume="whole_volume"（一次规划该卷多章梗概和细纲），volumeSynopsis=true，volumeOutline=true，volumeTargets=true（调整卷目标字数/章数）。
只授权当前请求要交付的内容；背景、旧材料、已经存在的前置文件和待办不授权写入。不把章节级与卷级文件混淆；普通问答、引用、举例、撤回写入要求或暂缓返回 {}。
写入已有有效规划使用 rewrite。新建缺失或占位规划使用 create。明确局部修改细纲时使用 patch。
最近对话仅用于理解指代和已明确接受的提议。单项修改就只返回该项；只有明确要求多项才同时返回。相同说法在不同上下文可能表达不同意图。
若用户把后续推进交给系统，才用 advance=true。用户明确要求仅改某项或本步就停时，不能附 advance；推进模式只决定已授权任务的停点。
明确要求切换章节焦点，或要求修改当前焦点之外的章或卷时，先仅用 focus=true；待焦点切换后再授权目标写入。明确要求撤回现有正文回到推演时用 restage=true。
明确要求改章名或对齐标题用 chapterTitle=true，明确要求改卷名用 volumeTitle=true，明确要求通过命令执行工作区操作用 shell=true。
当前有可发布草稿，且用户明确批准将这份现有草稿入库时，才单独返回 {"publish":true}。否定、引用按钮文案、询问是否应发布、对旧版本的确认、要求先改写或等待都不能授权发布现有草稿。批量编排自行发布，不返回 publish。

## compression-fragment

### 片段 {{index}}
{{text}}

## compression-request

请压缩以下上下文片段：

{{body}}
