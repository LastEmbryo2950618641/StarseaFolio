# discuss-tools

## describe-required

请先 describe 获取参数格式与撰写说明，再 invoke

## catalog-instruction

按需使用 artifact.toolRequest；先 action=describe 再 action=invoke；arguments 为 JSON 字符串。工具与正文通道流程以《创作台讨论工作流》为准（系统规则已注入）；每次请求只带 assistantMessage、finalSelfReview、toolRequest；锁定本轮 chapterSequence。

## character-update-guide

先读取世界推演规则/人物设定.md及已有人物 JSON。一人一档；可以新增、删除、更改 fields 字段，不能直接编辑 JSON 文本或 schemaVersion。创建用 create，已存在用 update，不能替换整个文档。用户确认与正文事实优先。

## chapter-workflow-guide

【正文推演工具】把情节推演成**草稿**（不是正式正文）。默认作用于焦点章。userInput 写清事件、人物动机、因果与信息边界、场景起止、预期结局和要改进之处；必须先有当前章有效的剧情梗概、细纲和人物准备，再参考这些材料及证据；梗概确认状态不作为门禁。heading 为标题（单章时）。批量：可传 chapterSequences（绝对章号数组），一次 invoke 为多章各生成草稿；勿在同轮 publish_draft。只追加草稿版本，不修订图、不覆盖正式正文；可多次调用比较草稿。若用户已提供完整正文、只需落库并图治理：不要调用本工具，改用 `chapterDraftProposal` / `chapterDraftProposals`，再图治理。工具可能因项目设置关闭而不可用；关闭时改用草稿提案字段。

## publish-draft-guide

【发布正文】用户确认「草稿可以，发布正文」后，宿主会自动执行：设定抽取写入设定集，并按用户原话融合更新作品风格 → 图治理 → 正文落盘。确认前不要调用本工具，也不要再询问设定或图治理。若仍由你调用：必须从 drafts 或先前工具结果中选择明确 revisionTaskId+draftVersionId，不能用 latest。正式正文不存在独立「旧版本」轴：只有草稿可回退/比较；正文落盘前必须经过本工具。草稿审核、设定抽取和图治理都在本工具内自动完成；审核发现设定或逻辑冲突会驳回并退回梗概阶段。status=completed 即已发布，可直接继续下一章；status 仍为 graph_sync_pending 表示同步未完成，不能声称已发布，也不要停下来请用户选择——系统会自动续跑。

## restage-chapter-guide

把当前焦点章的工作区表面回退到更早阶段，以便按新方向重写。targetStage=synopsis：清零梗概确认、删除本章细纲、把正式正文改名为「… [已回退].md」移出树表面；之后须重写 synopsisBody，有效梗概存在后即可写 outlineBody，不要求用户使用固定确认说法；需要新正文时：要么正文推演工具生成草稿，要么 chapterDraftProposal 直接落用户正文为草稿，再图治理工具发布。targetStage=outline：仅归档正式正文，保留梗概与细纲；适合「细纲仍可用、只要重写正文」。reason 写清用户意图（如「第一章按新梗概重写，覆盖旧细纲与正文」）。不可改章节号；图/世界线历史 checkout 不在本工具范围内。调用后根据返回的 cleared/archived 路径再继续写入，不能假装旧细纲/正文仍是权威表面。

## bash-guide

【bash】在项目**工作区**内执行 shell（Windows 为 cmd；默认 cwd=工作区根）。硬约束：cwd 必须在工作区内；创建/修改/删除/重定向等变更只能落在工作区内。允许：从工作区外 copy/cp/robocopy 等**拷入**工作区后再改；只读列举/查看外部路径可以。读本机目录/正文：优先 request_read 绝对路径，不要先用 bash 硬闯含中文/全角标点/感叹号的路径。禁止：在工作区外落地修改；把正式正文发布、图治理、梗概确认等权威流程用 bash 冒充。失败时：把 exitCode/stderr 直接告诉用户，禁止默默改用工作区材料顶替本机路径内容。区分：工作区=整部项目根（含设定集/章节正文/大纲/暂存区等）；暂存区=工作区内的 `暂存区/` 中间态，不是设定集权威。command 为一条非交互命令；超长输出会被截断。详规见《创作台讨论工作流》。平台 skill 只读校验（需已知绝对路径）：scan-template-tells.mjs / scan-dialogue-pingpong.mjs（见 skill-script-whitelist）。

## todo-write-guide

【todo_write】Claude Code 风格任务清单（创作台 Todo 面板）。可执行任务必须先写再动手；你有完全写入权限。开局：merge=false 写入 ≥2 项真实步骤；将第一项标 in_progress。推进：merge=true 更新 status（完成→completed，下一步→in_progress）；同一时刻最多一个 in_progress。收尾（Auto/Accept edits）：结束前须把全部项标 completed 或 cancelled，否则系统会打回。禁止只在 assistantMessage 列步骤却不调用本工具；这不是设定集目标（deduction goals）。

## memory-write-guide

【memory_write】Codex 风格跨回合 Agent 记忆。索引 MEMORY.md 启动时注入（前 200 行/25KB）；详情写主题文件。何时写：用户说「记住…」、确认纠错/偏好、或开放约定需跨会话保留时。target=index：替换 世界推演规则/Agent记忆/MEMORY.md（保持精炼索引+指向主题文件的链接）。target=topic：替换同目录下某 .md（filename 仅单层文件名）；索引里用一行摘要+路径引用。勿把整章设定/正文塞进记忆；设定权威仍在设定集。Plan 模式也可用本工具。

## load-skill-guide

【load_skill】按需加载平台写作/讨论 skill 全文（去味、对话、人味、情绪、工作流等）。写正文草稿：若上下文已有「# 用户要求 + 梗概 + 细纲 → 正文草稿」或「宿主已注入 outline-to-draft」，视为已加载，禁止再 load outline-to-draft，也禁止因工具列表无 load_skill 而停顿；仅该标题缺失时才 load。系统规则只含短索引；默认阶段包可能已挂主 skill，仍缺细则时再 load。includeReferences=true 会明显增大上下文，仅在主正文不够用时开启。描写场面卡不在本工具：用 request_read + sourceKinds:["rule"] 读 表现输出/描写规则/。

## conversation-archive-guide

只读检索当前会话的历史消息。search 返回摘要和消息 ID，read 按页返回原文、发言角色和时间。需要恢复旧要求时先按主题搜用户原话，关键词找不到时缩短关键词或浏览相邻历史。可以反复查阅同一条消息。用历史上下文理解本轮任务。以当前用户要求为准，历史消息和旧回复不能单独授权写入、发布或更改焦点。

## original-work-search-guide

默认搜索用户提到作品的原作/正史资料；只有用户明确要求同人、二创、AU 或特定衍生版本时，才搜索该衍生作品。标题相似或含原作名的其他网文/同人文不得冒充原作。返回 bookId、标题、原名、作者、简介、语言和来源。搜索也会匹配简介和标签，不能把提到原作的其他书当作目标；逐个核对简介、角色和世界观。简介不符立即用更具体的标题/别名重搜；状态词、作者和标签不算剧情简介，缺少剧情介绍时先查公开网络。多个版本仍有歧义时询问用户，不得直接下载第一条。先确认原作媒介与版本。若目标是视觉小说、漫画、动画等非小说作品，或 nikowenku-archive 没有能核验的原作文本，就用公开网络核实正史资料；不得为了调用抓取工具而改抓同名网文。应用已内置 nikowenku-archive 的 JavaScript CLI 源码，后台直接使用现有运行时执行，无需另装工具或启动服务；书目查询和首次下载需要联网，后续优先复用已下载原文。

## original-work-download-guide

确认简介、作者与原作版本后按 bookId 下载书库已有完整正文到本地缓存，再按 startChapter/chapterLimit 导入参考文件/原作资料/。首次导入 1-3 章并 request_read 核验角色和设定；实际文本不符时停止引用并立即重搜。本工具不向源站发起抓取任务。相同正文的后续分段导入复用缓存；无章节标题时切为有编号的原文片段。索引记录真实下载来源和本次导入范围，不能把回执、索引或未读原文当已核实事实，更不能整本塞入上下文。没有匹配书籍、正文不可用或下载失败时保留未核验状态，用公开网络或明确标注的合理推演兜底，不自动反复下载。

## character-update-definition

在设定集/人物下一人一个 JSON，通过字段操作新建人物或增删改资料，禁止直接编辑 JSON。

## character-update-scenario

准备新角色、完善主角或修订任何人物设定时；先读取世界推演规则/人物设定.md。

## chapter-workflow-definition

推演本章情节并生成/追加草稿，不写正式正文。

## chapter-workflow-scenario

需要 AI 新写或重推正文草稿时；用户已提供完整正文时不要用。

## publish-draft-definition

将指定草稿版本经图治理转换为正式正文并覆盖工作区正文文件。

## publish-draft-scenario

已有满意草稿（推演生成或 chapterDraftProposal 导入）后发布为正式正文。

## restage-chapter-definition

把本章工作区表面回退到梗概或细纲阶段，并归档正式正文（可选清除细纲）。

## restage-chapter-scenario

用户要求从某章重写梗概并覆盖已有细纲/正文；或保留细纲只重写正文。

## bash-definition

在项目工作区内执行 shell；可从外部拷贝进工作区，修改只能落在工作区。

## bash-scenario

需要列目录、拷入外部资料、在工作区做脚本化整理时；正式正文/图治理仍走专用工具。

## todo-write-definition

写入/更新 Claude Code 风格任务清单，供创作台 Todo 面板展示。

## todo-write-scenario

用户每条可执行指令开始时必须先调用；建清单后再读文件/bash/章节工具，并随进度更新 status。

## memory-write-definition

写入跨讨论回合的 MEMORY.md 索引或主题记忆文件。

## memory-write-scenario

用户要求记住偏好/纠错/约定，或需把稳定工作记忆落到 世界推演规则/Agent记忆/。

## load-skill-definition

按需注入平台 skill 正文（去味/对话/人味/情绪/讨论指南等）。

## load-skill-scenario

索引不够、默认包未覆盖、或需要 references 细则时。

## conversation-archive-definition

只读搜索和分页查阅当前会话的原始用户消息与 AI 回复。

## conversation-archive-scenario

上下文已压缩，继续或重写时需要核对之前的要求、讨论结论或原话。

## original-work-search-definition

根据上下文推断作品名，搜索原作资料候选并核对版本。

## original-work-search-scenario

创作同人或需要核实现实原作设定时；先查本地资料，缺失时搜索。

## original-work-download-definition

按书籍 ID 下载 nikowenku-archive 原文到本机缓存，按章导入项目参考资料库。

## original-work-download-scenario

搜索结果的作者、简介和版本已确认匹配，按需导入少量章节查证。

## chapter-workflow-unavailable

正文推演工具未启用：请在项目设置中开启「正文推演工具」，或改用 chapterDraftProposal / chapterDraftProposals 写草稿

## publish-confirmation-required

草稿需要用户先确认「草稿可以，发布正文」。确认后宿主会自动完成设定抽取、图治理和正文落盘，不要再次调用本工具。

## draft-not-in-focus

指定草稿不属于当前捕获的焦点章，请 describe 获取本章版本

## character-update-parameter-relative-path

设定集/人物/人物名.json

## character-update-parameter-operations

Array<{op:"set",field:string,value:JSON值}|{op:"delete",field:string}>

## character-update-parameter-expected-content

可选，读取到的原文作基线；若已有并发写入，服务端会重读最新内容后按顺序叠加本次操作

## chapter-workflow-parameter-chapter-sequences

number[] (optional；批量时一次产出多章草稿)

## bash-parameter-cwd

string (optional, default=工作区根)

## todo-write-parameter-merge

boolean (optional, default false；true=按 id 合并更新，false=整表替换)

## memory-write-parameter-markdown

string (required；整文件替换内容)

## memory-write-parameter-filename

string (target=topic 时必填；如 preferences.md，落在 世界推演规则/Agent记忆/)

## load-skill-parameter-skill-id

string (required；见系统规则中的 Skill 索引)

## load-skill-parameter-include-references

boolean (optional；true 时附带 references 长文，默认 false)

## conversation-archive-parameter-operation

必填，"search" 或 "read"

## conversation-archive-parameter-query

仅 search 可用。可选，消息原文中的短语，留空按时间从近到远浏览。

## conversation-archive-parameter-role

仅 search 可用。可选，"user" 或 "assistant"。

## conversation-archive-parameter-message-id

read 必填。使用 search 返回的消息 ID。

## conversation-archive-parameter-offset

可选，默认 0。下一页传上一页返回的 nextOffset。

## original-work-search-parameter-title

string (required；从上下文推断原作标题或别名，搜索内置 nikowenku-archive 书库)

## original-work-download-parameter-title

string (required；确认后的原作标题)

## original-work-download-parameter-book-id

string (required；当前 original_work_search 返回且简介与目标吻合的 bookId，禁止传任意 URL)

## original-work-download-parameter-chapter-limit

integer (required；1..20000，本次导入的章节/片段数)

## original-work-download-parameter-start-chapter

integer (optional；1..20000，导入的起始章/片段，默认 1)
