---
title: 06 讨论技能索引
---

# 06 讨论技能索引


## skill-index

# 平台 Skill 索引（按需加载）

宿主按阶段注入默认 skill：`default(phase)` 只在该阶段默认挂载。梗概/细纲思维链、开书冷启动与扩展写作 skill 属于**按动作注入或 onDemand**：上下文已有全文时直接遵守；缺失且本轮动作需要时，用 `load_skill` 按需加载，不要默认假设它们已在上下文中。设定修订 skill 在 `settings_extraction` 阶段默认挂载；讨论侧不默认注入，需要时仍按 `load_skill` 加载。

arguments 示例：`{"skillId":"webnovel-dialogue","includeReferences":false}`。

| id | 名称 | 策略 | 何时用 |
|----|------|------|--------|
| `webnovel-deslop` | 去 AI 味（deslop） | default(draft) | 写正文或润色时用；改工整/排比/翻译腔/空洞抒情。 |
| `webnovel-dialogue` | 对话与台词 | default(draft) | 写对白时用；人物声口、潜台词与对白节奏的参考，按作品和场面取用。 |
| `webnovel-human` | 人味 / 失控感 | onDemand | 表面去味后仍像说明书时用：非理性、留白、私货。 |
| `webnovel-emotion` | 情绪演出 | onDemand | 喊情绪不演、缺身体反应时用；查情绪→外显对照。 |
| `starsea-writing` | 星海写作主 Skill | default(synopsis_discuss) | 写作阶段与宿主交付。创作台走结构化草稿和宿主发布，独立脚本宿主使用 `.folio`。 |
| `book-cold-start` | 开书冷启动 | onDemand | 开书时按需加载：一句话→绑笔风的风格备选（命名/对话硬字段）→8维落盘→卷大纲；未完成禁正文。 |
| `style-bible` | 项目风格手册与声口 | onDemand | 旁白距离、角色声音矩阵、称呼与禁改平。 |
| `naming-consistency` | 命名称谓一致性 | onDemand | 防撞名、称呼术语前后一致。 |
| `dialogue-subtext` | 对话潜台词与战术话轮 | onDemand | 议程/潜台词/群戏分层；改同声对白。 |
| `style-profile` | 文风剖析协议 | onDemand | 从对标书抽文风手册。 |
| `discuss-workflow` | 创作台讨论工作流 | default(synopsis_discuss) | 创作台 outcome/工具/门禁流程；讨论回合默认挂载。 |
| `plot-synopsis` | 梗概与细纲共同指南 | default(synopsis_discuss) | 写/改梗概或细纲时的共同规则：文件路径、上下文、连续性、正式推演门禁、动作互斥、语气与边界；阶段专属标准见对应指南。 |
| `user-to-synopsis` | 用户输入→梗概思维链 | onDemand | 写/改梗概时按动作注入或按需加载：把用户本轮要求收成章级梗概前的讨论、内部思维链与落笔闸。 |
| `synopsis-to-outline` | 用户+梗概→细纲思维链 | onDemand | 写/改细纲时按动作注入或按需加载：必须合并用户要求与梗概，禁止只扩写梗概；含增量与合同守恒自检。 |
| `outline-to-draft` | 用户+梗概+细纲→草稿思维链 | default(draft) | 正式 draft 默认；讨论侧写草稿时注入或按需加载。唯一共享草稿写作指南：续写、合同兑现、字数/视点/禁止层；设定沉淀走抽取/暂存。规划梗概/细纲勿套用。 |
| `settings-revision` | 设定修订指南 | default(settings_extraction) | 正式推演设定抽取默认挂载；创作台讨论改设定时仍按需 `load_skill`。 |

## 描写场面卡（工作区）

Auto 模式只注入 `表现输出/描写规则/自动.md` + 感官/去AI味基线；其他场面卡用 `request_read`（`sourceKinds:["rule"]`）或锁定下拉按需加载。

