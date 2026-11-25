# discuss-messages

## focus-changed-resume

焦点已切换到第{{focusSequence}}章。继续完成用户本次原始请求：
{{userMessage}}
先读取当前焦点章的已保存材料；只完成本次请求。未入库前不要进入下一阶段材料，也不要自动跳章。推进模式仍保持原设置。

## style-approved

继续：作品风格已由用户选定并通过审核，现在进入主角罗盘，逐项询问并等待用户确认核心设定，再询问本卷主线与支线。

## volume-story-required

继续：当前卷必须先由用户确认主线与支线。请依次询问开场场景、一个或多个高潮、卷末结局及支线事件与时机，给出贴合主题的选项并等待用户发送。

## volume-planning-complete

继续：当前卷首次规划已通过写入门禁。从第一章新章要求阶段开始讨论；梗概入库前不要把本轮当成梗概讨论，也不要越级写细纲或草稿。

## published-focus-changed

继续：第{{chapterSequence}}章正文已发布且图治理已完成，焦点已切换到第{{focusSequence}}章。进入该章新章要求阶段；先对齐本章要写什么，梗概入库前不要写入细纲或草稿。

## published-advance

继续：第{{chapterSequence}}章正文已发布且图治理已完成。若当前卷仍有未完成章节，本轮只切换焦点到第{{nextSequence}}章并设置 continueTurn=true，下一回合从新章要求阶段开始；不要同轮向旧焦点写入新章材料。若当前卷已完成则结束任务或开新卷。

## draft-saved

继续：当前章草稿已入库（{{draftLabel}}），构思阶段完成。请用户确认「草稿可以，发布正文」后才开始章节入库（正文确认）；确认前不要调用 publish_draft，也不要进入下一章。

## synopsis-saved

继续：第{{chapterSequence}}章剧情梗概已入库，进入构思阶段。构思会连续完成细纲与草稿；三样全部落盘后停等，不要在中途停下要确认。

## outline-saved

继续：第{{chapterSequence}}章细纲已入库，构思阶段继续：接着生成草稿；草稿落盘后构思完成，再请用户确认正文。草稿入库前不要发布正文。

## workflow-synopsis-appendix

---

## 剧情梗概（附录·冲突以细纲为准，用户合同仍须覆盖）

{{synopsis}}

## workflow-continue-from-archive

继续当前章的正文推演。需要前情或旧要求时查阅会话存档。

## advance-after-publication

继续：第{{chapterSequence}}章正文已发布且图治理已完成。若当前卷仍有未完成章节，本轮只切换焦点到第{{nextSequence}}章并设置 continueTurn=true，下一回合从新章要求阶段开始讨论；梗概入库前不要把本轮当成梗概讨论，也不要越级写细纲或草稿。若当前卷已完成则结束任务或开新卷。

## stay-in-chapter-requirements

继续：仍在{{stageLabel}}阶段。先与用户对齐本章要写什么；在梗概入库前不要写入剧情梗概以外的下一阶段材料，也不要把本轮当成梗概讨论。

## stay-in-synopsis

继续：仍在{{stageLabel}}阶段。针对已入库梗概讨论完善；在细纲入库前不要写入细纲或草稿。

## stay-in-outline

继续：仍在{{stageLabel}}阶段。针对已入库细纲讨论；在草稿入库前不要写入正文草稿。

## stay-in-draft

继续：仍在{{stageLabel}}阶段。针对已入库草稿讨论修改；用户确认「草稿可以，发布正文」前不要发布。

## stay-in-body

继续：仍在{{stageLabel}}阶段。请用户确认「草稿可以，发布正文」；确认前不要进入下一章。

## carried-todos

【上轮未完成 Todo 已带入本轮】
{{todos}}
处理完本条用户消息（如岔路选择）后，继续推进这些项；用 todo_write merge=true 更新状态。
要放弃某项须显式标 cancelled，不能用新列表把它覆盖丢掉。仍有未完成项而本轮做不完时设 continueTurn=true。

## todo-settled

- 当前 Todo 已全部结清。请交付当前阶段的结构化 artifact；无需再次调用 todo_write 结清清单。

## write-scope

【本轮写入范围】{{writeScope}}
按以上范围交付。只改指定材料，旧文件与 Todo 完成状态不计入本轮写入。已有前置材料仅供引用。批量规划保留用户手改材料，先读这些文件并以其内容为准。只有 advance=true 才可按推进模式主动延伸。草稿发布、卷首写及必答问答由宿主管理。

## react-reminder

创作台 ReAct 提醒：
- 当前已可见 readEvidence {{evidenceCount}} 条；优先基于这些证据给出正式结论。
- 若仍缺文件，使用 outcome=request_read；工具调用用 outcome=continue + artifact.toolRequest；否则返回最终 artifact。artifact 至少含 assistantMessage 与 finalSelfReview。
- 禁止把「我先去读设定/索引」写进 assistantMessage 当作最终回复。

## post-turn-handoff

正式推演已完成，请根据系统交接消息分析正文落成情况。
更新弧大纲/暂存区笔记，并建议下一章梗概修订；禁止开始正式推演。

{{handoff}}

## refresh-choices

请换一批决策选项。
要求：
1. 新选项的含义不得与下列已有选项重复，也避免同义改写：
{{labels}}
2. 仍用 choices 返回可点选按钮；方向类用 continue_discuss，结构性动作（如 confirm_synopsis / confirm_arc_plan / start_turn / promote_staging）仅在仍适用时保留。
3. assistantMessage 一两句说明换了什么方向即可，不要长篇铺垫，也不要改写梗概文件，除非为支撑新选项所必需。
4. 这是静默刷新：只产出新 choices，不要假设用户会看到完整对话气泡。
