# discuss-repairs

## batch-automation

【批量推演模式】卷规划用 volumeChapterPlans 一次写齐多章 synopsisBody+outlineBody；正文默认用 chapterDraftProposals（或焦点章 chapterDraftProposal）写草稿，禁止优先 chapter_workflow；勿 publish_draft（图治理由前端按章串行）；少给需点击的 choices；禁止输出 set_focus / focusChange（焦点由前端推进）；不要停在等待用户确认梗概。

## synopsis-missing

当前剧情梗概缺失或仍是占位内容：本轮只写 synopsisBody，不得输出 outlineBody/bodyEdits 或正文。给出符合用户当前诉求的后续选项；不能要求用户使用固定口令确认梗概。

## outline-missing

当前剧情梗概已存在：须按 synopsis-to-outline-guide，合并「用户本次要求 + 梗概」写细纲，禁止只对着梗概扩写。梗概确认按钮只是便捷选项，不是门禁。用户明确要求提取、补全或继续写细纲时，本轮应输出合格 outlineBody（引导 §4.1：必填章定位/分场/信息边界/风险待决；不适用节写「本节：无」；须含相对梗概的增量，禁止同构扩写；用户合同∪梗概事件须被分场覆盖），尊重用户这轮具体要求，不要要求固定确认说法或重复询问。细纲尚未写入前不要输出正文草稿。

## title-alignment-auto

检测到标题分叉：正文「{{bodyHeading}}」≠ 规划「{{planningHeading}}」。Auto 模式：直接输出 titleAlignTarget={{target}} 完成对齐，不要用 choices 征询。

## title-alignment-confirm

检测到标题分叉：正文「{{bodyHeading}}」≠ 规划「{{planningHeading}}」。优先用 choices 征询，用户确认后输出 titleAlignTarget（推荐 {{target}}）。

## title-alignment-remediation

同章正文与梗概/细纲标题不一致；右侧关联栏可能误显示「尚未创建」。 先用 choices 请用户选择统一到正文或统一到细纲。 用户确认后输出 titleAlignTarget=body|planning（可辅以 chapterTitle）。 验收：文件树同章只剩一个折叠入口，关联栏梗概/细纲变为已创建。

## budget-grace

模型调用轮次较多：请 outcome=continue 直接给出完整 artifact，避免继续 request_read。

## last-call

这是最后一轮模型调用：必须 outcome=continue，禁止 request_read。

## held-proposals

【已暂存写入提案】上一轮结构化内容已暂存，尚未落盘。本轮只需补齐提示要求的 Todo、choices 或写作设置；未修改的正文与规划无需重复输出。写入前仍会重新验证全部门禁。

## artifact-missing

上一轮模型结果无效：outcome=continue 时缺少 artifact 对象。请立即返回完整 JSON，artifact 内必须有 assistantMessage 与 finalSelfReview。这一轮没有落盘。

## model-result-rejected

模型结果被拒绝，没有落盘。原因：{{reason}}

## release-held-on-focus

本轮先处理换章，先前暂存的旧章写入已取消，没有落盘。

## focus-change-quote

【换章指令补正，仅一次】上一轮提出切到第{{focusSequence}}章，但 focusChange.userRequestQuote 缺失或不在本轮 userMessage 中。先核对本轮用户是否要求换章；若是，原样摘录该指令到 userRequestQuote，只返回 focusChange、assistantMessage、finalSelfReview 和可选 choices，用户还要求目标章写作时加 continueTurn=true；只换章不续跑。不要提交任何章节内容，不要补交旧章草稿，也不要调用工具。若本轮用户未要求换章，撤回该动作并说明。系统仅补正一次，仍不合格就停止且不应用该回复的章节改动。

## creative-setup

当前是用户必答的主角罗盘/卷主支线问答，禁止调用工具或写章节。请只提出当前字段问题和至少两个贴合主题的 continue_discuss 选项；收集完成时仅补充 protagonistSupplementFields，必须有非空姓名，身份、能力、人物关系等分别填入字段，不得替换用户核心。本轮章节写入没有落盘。

## original-work-archive-import

【同人原作核验·读取结果】nikowenku-archive 已导入资料，但本轮尚未把本地索引/章节读入 readEvidence。请 outcome=request_read，exactKeys 指向 参考文件/原作资料/ 下与当前问题相关的 Markdown，只读所需片段后再作答。

## tool-contract

toolRequest 必须单独使用 outcome=continue，不能与 request_read 同回。这一轮没有落盘。

## draft-guide-host-notice

【宿主已注入 outline-to-draft】正文草稿指南已在本轮上下文（见同轮「# 用户要求 + 梗概 + 细纲 → 正文草稿」）。禁止再调 load_skill(outline-to-draft)；禁止因工具列表无 load_skill 而用英文空转或改走捷径。直接按该指南全文走思维链后提交 chapterDraftProposal。

## draft-guide-for-tool

请先结合用户本轮要求、梗概、细纲和作品笔风重新核对，再调用正文推演工具；上一轮没有执行该工具。

## release-held-on-tool

本轮改为调用 {{toolName}}，先前暂存的写入已取消，没有落盘。

## tool-failed-without-result

{{toolName}} 执行失败，没有产生落盘结果。原因：{{reason}}

## tool-failed

{{toolName}} 执行失败，没有落盘。原因：{{reason}}

## artifact-invalid

上一轮缺少合法 artifact（{{validationIssues}}）。请 outcome=continue 并返回完整 artifact（assistantMessage、finalSelfReview 必填）。这一轮没有落盘。

## write-scope

【本轮写入范围】{{issues}}。请按宿主提供的范围重新交付。待办标记与旧文件不能代替本轮产物。

## draft-guide-for-proposal

请按用户本轮要求并结合有效梗概、细纲和作品笔风重新生成完整草稿提案；上一轮草稿没有写入。

## draft-word-count

【草稿字数】{{issues}}。按正文去除空白后计数。请调整后提交完整正文，保留用户指定情节和笔风。

## volume-plan-required

【卷规划首写必交】当前仍处于卷级规划阶段，不能只解释门禁或继续讨论第一章。本轮请根据用户构思主动提出一份可修改的第一卷方案，并一次提交 volumePlanMeta（targetChapterCount、targetWordCount）、volumeSynopsis.markdown、arcPlan.markdown 三项完整结构化内容；缺少用户细节时合理估算并标明可调整，不要反问后停住。禁止输出任何章节级梗概、细纲、草稿或正文。已提交的章节内容没有落盘。

## creation-desk-settings-required

【卷规划写作设置必交】你刚才只在 assistantMessage 中声称切换设置，系统没有应用该文字。必须在 artifact.creationDeskSettings 返回完整字段：descriptionRulePath、proseStyleRulePath、novelMajorCategoryRulePath、novelSubcategoryRulePath、minimumWordCount、maximumWordCount、boundaryPace、causalityFocus。规则路径必须逐字来自本轮工作区真实 Markdown 文件；字数按卷总字数/章节数估算；未返回前禁止声称已切换或已同步。

## style-recommendations-required

风格门禁要求你先阅读全部 workspace:presentation_style_candidate 证据，再给至少两个分别绑定大类、次大类、笔风真实 Markdown 路径的 continue_discuss 推荐；只做风格评估，不写任何文件。本轮文件写入没有落盘。

## style-write-required

审核所选笔风「{{selectedPath}}」后，必须给出完整合格的 {{workStylePath}}，且保留所选路径；若不适配，提供至少两个绑定真实候选路径的替代方案。禁止写章节内容。本轮章节内容没有落盘。

## synopsis-required

【剧情梗概必交】用户要求写入当前焦点第{{chapterSequence}}章剧情梗概，但当前文件仍是空占位。本轮必须在 synopsisBody 提交完整、非空的梗概 Markdown；assistantMessage、暂存区、细纲或正文都不能代替。不得声称已写入，也不得推进细纲或草稿。
请直接返回结构化 synopsisBody，不要再 request_read 或继续规划后续章节。

## outline-required

【剧情细纲必交】用户已要求为当前焦点第{{chapterSequence}}章写入细纲，但文件仍为空。必须在 outlineBody 提交完整、非空的细纲 Markdown；assistantMessage、暂存区或正文草稿都不能代替。不得声称已写入，也不得推进正文草稿。
请直接返回结构化 outlineBody，不要再 request_read 或继续规划后续章节。

## draft-required

【草稿提案必交】用户已明确要求为当前焦点第{{chapterSequence}}章写正文草稿。必须在 artifact.chapterDraftProposal 中提交完整、非空正文（或在 chapterDraftProposals 中提交 chapterSequence={{chapterSequence}} 的完整正文）；assistantMessage、暂存区文件或工具说明都不能代替草稿提案。没有结构化提案就不会创建草稿版本，也不得声称已写入或已保存。
请直接返回完整提案，不要再 request_read 或重复解释流程。

## draft-sequence

【草稿序号修复】当前焦点是第{{chapterSequence}}章，但本轮草稿提案均未通过顺序门禁。请重新输出当前焦点章完整正文到 chapterDraftProposal；若用 chapterDraftProposals，chapterSequence 必须为 {{chapterSequence}}。被拒绝的提案没有进入草稿轴，assistantMessage 不得声称已生成或已保存草稿。

## choices-required

【停止前选项必交】本轮将结束并等待用户。请基于当前阶段补充至少两个彼此有区别、可直接执行的 choices，通常提供推荐路径与调整路径；每个 action 用 continue_discuss。不要只在 assistantMessage 中列选项。

## release-held-on-read

本轮改为读取，先前暂存的写入已取消，没有落盘。

## choices-required-before-write

【停止前选项必交】本轮将结束并等待用户。请基于当前阶段补充至少两个彼此有区别、可直接执行的 choices，通常提供推荐路径与调整路径；每个 action 用 continue_discuss。不要只在 assistantMessage 中列选项。本轮还没有落盘。

## phase-contract-tool-exclusive

上一轮 phase contract 失败：toolRequest 不可与章节写入、草稿提案、choices、focusChange 等动作同回。本轮只做一件事：若需工具，outcome=continue 且 artifact 仅含 assistantMessage、finalSelfReview、toolRequest；若已可交付，不要带 toolRequest，直接返回写入类字段。先等工具结果再继续。

## phase-contract-invalid

上一轮 phase contract 失败：{{validationIssue}}。请按校验错误整份重写合法 artifact，不要复述无效 JSON。

## schema-validation

上一份模型输出没有通过校验，系统已要求重生成。被拒绝的那份没有落盘。
{{issues}}
后面这条通过校验的结果才算数；不要把被拒绝的那份说成已写入。

## goal-schedule

【门禁·钩子时限】goalProposals 中以下伏笔/高潮缺起势章或兑现章（设置要求完整）：
{{issues}}
请根据卷规划/细纲自行推断并补齐 plantChapterSequence 与 payoffChapterSequence（起势 ≤ 兑现），重新输出完整 artifact；
确实无法确定的，改为 narrativeKind=general 或暂不提该条，不要询问用户。这次提交没有落盘。

## todo-required

本轮尚未调用 todo_write，创作台 Todo 面板仍为空。请先 describe+invoke todo_write（merge=false，至少 2 项真实步骤，将第一项标 in_progress），再 request_read / bash / 章节工具或交付写入类 artifact。禁止只在 assistantMessage 里列「脚本轮清单/步骤」却不写 Todo。

## todo-incomplete

本轮 Todo 仍有 pending/in_progress 项，不能结束回合。你对 Todo 有完全写入权限：请先 outcome=continue + toolRequest 调用 todo_write（merge=true），把已做完的标 completed，做不到/不再做的标 cancelled，下一项标 in_progress；全部项均为 completed 或 cancelled 后，再交付最终 artifact。禁止清单未结清就停下来只写 assistantMessage。

## todo-no-progress

todo_write 已连续多次重复或只调整任务清单，没有推进实际工作。不要再次提交相同清单；请直接返回当前阶段的最终 artifact 和可执行 choices。未完成项应保留 pending/in_progress 并说明阻塞原因，不得虚报 completed 或 cancelled。

## tool-exclusive

门禁：toolRequest 与写入类字段同回，系统只保留了工具调用。同回的写入、choices、focusChange 没有落盘。不要声称这些字段已经保存。先完成当前工具，再重新交付被去掉的字段。

## chapter-sequence

门禁：正文新章草稿只能开到第{{nextSequence}}章（chapter_index 下一序号）。{{deferred}} 的 chapterDraftProposal(s) 没有落盘。不要再跳号开草稿，也不要声称已经生成或保存。请更新 Todo：先完成第{{nextSequence}}章草稿并走图修订发布为正文，再写下一章。
