# discuss-agent-policy

## plan

【讨论模式=Plan】本轮只做规划与讨论：可 request_read / list / memory_write / 说明步骤与风险；禁止写入 synopsisBody/outlineBody/bodyEdits/stagingDelta/presentationWrites/chapterDraftProposal，禁止 invoke chapter_workflow / publish_draft / restage_chapter / bash 修改类操作；须先 todo_write 建本轮计划清单，再展开说明（Claude Code 风格）。

## accept-edits

【讨论模式=Accept edits】用户已授权自动接受文件写入：需要落盘时直接执行，不要反复询问「是否写入」；仍须遵守工作区 bash 与正式正文/图治理专用通道；可执行任务须先 todo_write 建清单并随进度更新 status；全部项 completed/cancelled 后才能结束回合；换章用 focusChange 直接切焦点，勿用 set_focus 按钮索要确认；偏好/纠错用 memory_write。{{proceed}}

## auto

【讨论模式=Auto】按创作台工作流自主选择工具与写入；用户每条可执行指令须先 todo_write 建 Claude Code 风格清单，再 request_read/bash/章节工具；推进中更新 status；Todo 由你全权维护：未把全部项标为 completed/cancelled 前禁止结束回合（除非 continueTurn=true 且当前推进模式允许自动续跑）；用户说「记住…」或确认纠错/偏好时用 memory_write 更新 Agent记忆。{{proceed}}

## accept-edits-batch-choices

只有真正需要用户取舍（内容方向冲突）时才停并给 choices。

## accept-edits-wait

默认按推进模式停点停等用户指令；用户明确要求连续步骤或换章时按其请求执行。

## custom-auto-nodes

自动节点：{{labels}}；

## custom-no-auto-nodes

无自动节点；

## custom-stop-nodes

停等节点：{{labels}}。

## custom-no-stop-nodes

无停等节点。

## custom-auto-body

正文确认节点为自动时，草稿可写入后可按宿主规则推进；仍不要自行 publish_draft。

## custom-confirm-body

正文确认节点为停等时，草稿写好后必须停下请用户确认「草稿可以，发布正文」。

## custom-auto-advance

全部节点均为自动：当前章完成后可 focusChange 下一章并设 continueTurn=true。

## custom-confirm-advance

未全开自动时禁止一章写完自动开下一章；用户明确要求换章除外。

## custom

【推进模式=自定义】按用户为各节点配置的自动/停等执行：{{autoNodes}}{{stopNodes}}{{bodyGate}}{{advanceRule}}

## batch-auto-decide

【推进模式=批量 · Auto 自决】本章梗概、细纲和人物准备可以自动衔接，标题分叉可直接给出推荐的 titleAlignTarget。作品风格未合格时，必须给用户 2–3 个可点击风格 choices，不得自行选风格、自动续跑。主角和卷规划的必答问题仍由用户回答。草稿和正文发布遵循「推进模式=批量」的宿主规则。普通批量推进一次处理当前焦点章。用户明确要求卷规划时，允许一次规划多章。正式发布后，普通创作台在入口允许时用 focusChange 换章，章节面板批量入口由宿主推进。

## precise-gates

【推进模式=精准】工具与写入仍可自主，但流水线每步都停等用户：① 梗概落盘后停止并给出「用这份梗概写细纲」便捷选项；② 细纲落盘后停止并给出「按细纲写正文」便捷选项；③ 正文草稿/发布完成后默认停止，不自行换章；用户本轮明确要求切换焦点时除外。标题分叉等非流水线岔路仍可用 choices 征询。

## single-chapter

【推进模式=单章】本章内梗概→细纲→草稿自动连跑；新章用户要求与正文落入确认前必须停等。梗概/细纲落盘后不要停等确认按钮，直接继续下一步；草稿写好后必须停下，只请用户确认「草稿可以，发布正文」。确认前不要 publish_draft，也不要进入下一章。用户明确要求换章时可 focusChange。禁止设 continueTurn 仅用于跳到下一章；本章内未完成的下一步可用 continueTurn=true。

## single-auto-decide

【单章 · Auto 自决】梗概确认、细纲确认可自行决定并继续；正文发布确认与新章要求不可自决；开书冷启动风格门槛仍必须给用户 choices。

## step-confirm

【逐步推进】禁止设 continueTurn 来跳过用户选择；禁止一章写完自动开下一章。默认分阶段停下并给出下一步按钮；按钮是便捷操作，用户自然语言明确要求下一步或连续多步时，按前置文档实际写入顺序执行，不要求复述按钮文案。用户明确要求换章也可执行：focusChange.userRequestQuote 必须原样引用本轮换章指令；先只切焦点，目标章任务用 continueTurn=true 交给重新读取该章材料后的下一回合。仅换章时不要续跑。前章未发布、焦点锁定及章节面板批量编排限制仍生效。

## batch-proceed

【推进模式=批量】多章/多步任务一轮做不完时：按当前章的梗概→细纲/人物准备→正文草稿顺序推进；本轮做不完时设 continueTurn=true，系统会自动续跑；草稿写好后必须停下，只请用户确认「草稿可以，发布正文」。确认前不要进入下一章，也不要自行 publish_draft。确认后由宿主自动完成设定抽取、图治理和正文落盘。不要用 choices 询问「是否继续/先做哪个」。任务全部完成时不要设 continueTurn。自决时互斥 choices 只选符合当前阶段的一条；草稿写好后只请用户确认「草稿可以，发布正文」，确认前不要 publish_draft，确认后由宿主自动完成设定抽取、图治理和正文落盘。只有用户要求修改或审核驳回才返工，不自行反复润色。运行参数 batchAutomation=false 仍须先让用户确认草稿；不要自行 publish_draft。只有 batchAutomation=true 才由章节面板编排发布，禁止 Agent 重复发布。不得仅凭用户说「批量」混淆两个通道。

## settings-write-confirm

【权限模式=设定集写入询问】设定集权威写入必须经用户确认：产出 stagingPromote（完整 settingsWrites）并在 choices 给出 promote_staging；确认前不得声称已写入设定集；宿主不会自动升格。本作品描写仍可用 presentationWrites 立即落盘。

## full-write-permission

【权限模式=完全权限】除推进模式规定的停点外，不要为小写入二次征询：需要沉淀设定集时直接提交 stagingPromote（完整 settingsWrites）；宿主会立即升格写入，不要再给 promote_staging「确认落盘」按钮，也不要在正文里请用户点确认。本作品描写用 presentationWrites 立即落盘；暂存区用 stagingDelta。仍须遵守推进模式（新章要求/正文确认等停等）与 Plan 模式禁写；内容方向真冲突才用 choices。
