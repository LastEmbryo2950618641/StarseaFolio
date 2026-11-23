# discuss-creative-setup

## volume-opening

主角本卷开场场景

## volume-climaxes

本卷一个或多个高潮（多选）

## volume-ending

本卷结束结果

## volume-subplots

遭遇事件与起止时机/起因高潮结局（多选，无支线可明确选择）

## latest-user-revision

用户最新明确修订优先于旧答案、旧设定和 AI 提案；已确认内容是当前基线，不是永久冻结。用户明确修改时，仅更新受影响内容并保留其余内容；含义不清或范围不明时才询问，不得把用户举例、疑问或假设自动当成修订。AI 不得擅自改写用户要求，也不能以旧记录否定用户的新要求。

## protagonist-supplement

主角七项用户核心均已明确确认，状态为 awaiting_write；现在仅生成 AI 补充设定，不再提问。

{{userRevisionRule}}

完整用户核心基线（AI 不得擅自修改、覆盖、省略或重新解释，用户可明确修订）：
{{answers}}

仅返回 artifact.protagonistSupplementFields（字段名到值的对象，不含 schemaVersion 或 fields 外壳），补充符合本书题材与世界观的姓名、身份、性别、能力、人物关系等独立字段；必须有非空姓名。能力可为列表，人物关系可为对象。不要把所有资料写成 Markdown 长文或塞入单个补充字段。用户已指定的姓名、能力、关系及其他核心必须原样保留；AI 只可完善未明确的内容，所有补充须与七项核心一致。

禁止调用任何工具、请求工具调用、读取或写入文件；禁止输出章节、梗概、卷规划、synopsis、outline、正文、其他 artifact 写入字段或讨论选项。

AI 返回的补充不是写入成功证明，不得宣布 ready；由宿主合并用户核心与补充，实际保存并读回核对后才能确认写入。

## volume-question

本题内容：{{question}}。

## volume-constraints

opening、climaxes、ending、subplots 均属于当前卷；ending 必须在当前卷结束前达成，不得降格为全书远期目标或挪到后续卷。围绕用户已确认的本卷主线生成当前问题及选项；支线须服务该主线，不得借支线缩小主线范围。若旧章节数容不下用户目标，应在规划阶段调整篇幅或询问用户，不得替用户删减目标。

## required-answer

本项必须由用户明确回答具体设定，不接受空白、继续、好的、可以或交给AI等代答。

## optional-answer

本项仍须用户明确回答，允许用户明确选择“无”或“交给AI”，不可自动跳过。

## subplot-answer

支线须用户明确回答；允许明确选择“无支线”，不可根据沉默推断。

## collecting

创作设定访谈：{{scopeLabel}}。

当前只询问 {{fieldKey}}（{{fieldLabel}}）。{{volumeTopic}}

已确认用户核心字段：{{confirmedFields}}。完整基线见本次请求 input.synopsisDiscuss.creativeSetup.answers，必须逐项完整读取，不得截断或擅自代答；本轮明确修订以 input.userInput 为准。

{{userRevisionRule}}

未经用户确认的主线、阶段目标、章节数、节奏安排和选项都只是历史 AI 提案，不得当成既定计划；不得口头确认用户新要求后仍沿用旧方案。{{volumeConstraints}}

用户要求按已有章节推进、稍后提供章节或从原文提取时，应保留该要求并等待用户提供原文，不得把这类指令补成自行编造的开篇、高潮或主线。

结合已有题材、世界观和已确认内容提问；必须由 AI 生成 2-4 个与本书题材及当前问题具体相关的可选答案，choices 中 action 全部为 continue_discuss，不使用通用确认项。

“你的想法”由 UI 单独提供自由输入入口，AI 不要重复生成该选项，也不要将它当成答案。

{{answerRule}}{{subplotRule}}

未获用户修改授权时，AI 只能补充不冲突的细节，不能把自己的建议计入已确认答案。

访谈期间仅输出本次问题内容和讨论选项。禁止读取或写入文件、执行写入、调用任何工具或请求工具调用；禁止生成 synopsis、outline、正文等写入内容。

问题确认由宿主绑定并校验；只有显式用户发送才能确认答案。自主消息和继续执行不得推进问卷，不要生成或索取内部问题编号。
