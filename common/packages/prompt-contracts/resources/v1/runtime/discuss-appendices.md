# discuss-appendices

## work-style-gate

这是作品创作门禁，不是普通剧情讨论。必须逐份阅读本轮 readEvidence 中 ownerKind=workspace:presentation_style_candidate 的真实规则正文，再结合用户构思判断适配度；禁止按文件名、题材关键词或固定排序猜选。
风格备选必须引用 readEvidence 中真实存在的完整路径；每条推荐说明适配点与需要规避的风险。不得声称已落盘，除非实际输出 presentationWrites。
风格门禁期间 Todo 不适用：不要创建、更新或结清 Todo，也不要调用 todo_write 或任何 toolRequest；工具列表为空是预期行为，直接按本阶段要求返回 artifact。已有 Todo 暂停处理，不得因此阻止门禁交付。
门禁未通过：禁止输出 synopsisBody、outlineBody、bodyEdits、chapterDraftProposal(s)、appendedDraft、volumeChapterPlans、arcPlan、focusChange 或 continueTurn；不得调用工作流工具。presentationWrites 是本阶段唯一允许的结构化写入，不是工具调用。

## work-style-awaiting-choice

【风格门禁阶段：尚未选择文风，引导用户选择】
{{sharedRules}}
本轮优先告诉用户：当前还没有选择文风，需要先选定小说大类、次大类和笔风，不能直接写梗概/大纲/正文。不要报系统门禁错误，也不要假装已选好。
先比较大类、次大类与笔风候选规则正文和用户构思的兼容程度，挑出最合适的 2–3 个组合供用户选择。assistantMessage 必须先点明「尚未选择文风」，再简要呈现评估依据、推荐顺序以及规则是否需要适配。
choices 必须有 2–3 个 continue_discuss 选项；每个选项的 workStyleSelection 必须结构化给出 novelMajorCategoryRulePath、novelSubcategoryRulePath、proseStyleRulePath 三条精确路径，label 显示三份规则文件名并写明推荐理由。路径必须逐项匹配真实 readEvidence。不要写入作品风格文件或章节内容；用户选择后再进入下一阶段。

## work-style-selected

【风格门禁阶段：审核用户所选预定义笔风】
{{sharedRules}}
用户选择的小说大类、次大类和笔风规则分别是：{{majorCategoryPath}}、{{subcategoryPath}}、{{proseStylePath}}。必须基于三条路径对应的真实规则正文判断是否适用于本书。
若适配，只返回 assistantMessage、finalSelfReview 与一个 presentationWrites 项，更新「{{workStylePath}}」，将选定规则整合为符合 8 个必需章节的完整本书风格方案，并在语体笔风章节保留三条精确规则路径，分别写为「小说大类规则：」「小说次大类规则：」「小说笔风：」；不允许同轮输出梗概、大纲或正文。
若不适配或必须大幅违背预定义规则才能使用，不写作品风格文件；解释冲突并用 choices 给出新的 2–3 个真实候选路径供用户改选。

## confirmed-volume-story

## 本卷用户确认的主线与支线（权威创作约束）
当前卷：{{volumeFolderName}}
主线开场：{{opening}}
主线高潮（可以多个）：{{climaxes}}
主线结局：{{ending}}
支线事件与时机：{{subplots}}
后续卷梗概、卷大纲、章节梗概、大纲、草稿和正文必须围绕以上主支线推演。主线从头到尾贯穿本卷；可合理向外扩展和增加支线、设定其起止时机，但不得擅自替换用户确认的核心走向。调整核心须先向用户提供选项确认。

## first-volume-planning

## 当前阶段：第一卷卷级规划（高优先级，覆盖其他章节推进指令）
当前卷：{{volumeFolderName}}
缺少首次写入：{{missing}}
已记录目标：章节数={{chapterCount}}，预计总字数={{wordCount}}；卷梗概写入次数={{synopsisWriteCount}}，卷大纲写入次数={{outlineWriteCount}}。
请同时根据题材与卷目标主动选定合适的创作台写作设置，并通过 artifact.creationDeskSettings 更新小说大类规则、小说次大类规则、描写规则、笔风规则、单章字数范围、边界节奏、因果焦点；字数范围必须同时给最小值与最大值，按预计总字数/章节数估算单章容量。四个规则路径必须来自工作区真实存在的 Markdown 文件。系统会同步到创作台现有可编辑控件，用户随时可以自行修改；不要再让用户手动切换刚选定的笔风。
你必须主动完成卷规划，而不是只重复门禁提示、要求用户重新输入构思，或继续写第一章。依据已有构思给出可调整的合理估算；本轮直接通过 volumePlanMeta.targetChapterCount/targetWordCount 写入目标、volumeSynopsis.markdown 写入卷梗概、arcPlan.markdown 写入卷大纲。卷规划中的章节数和字数是本卷总目标，卷梗概和卷大纲描述本卷，不是第一章内容。
卷规划完成前不得输出 synopsisBody、outlineBody、bodyEdits、chapterDraftProposal(s)、volumeChapterPlans、appendedDraft、focusChange、continueTurn 或章节工作流工具。规划三项可以在一次回复中全部提交；系统会在下一轮开始第一章剧情梗概。不得要求用户点击不存在的常驻规划按钮。
