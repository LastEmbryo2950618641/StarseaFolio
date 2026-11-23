# 星海写作主 Skill（starsea-writing）

通用写作 skill：提示词、落盘脚本、`.folio/ui-state.json` 协议一体。  
Codex、Claude 和星海余页共用创作阶段。星海余页应用通过结构化产物与宿主编排写入。独立脚本宿主使用 `.folio` 协议写入。

## 宿主差异

| | 星海余页 | Codex / Claude |
| --- | --- | --- |
| 工作区目录 | 软件启动已绑定 | 无目录则询问用户后写入 |
| 用户输入 | 创作台会话与应用传入的当前章上下文 | 对话自然语言 |
| 可视化 | 应用展示草稿版本、发布及图同步状态 | 写出 JSON，无面板 |

## 阶段顺序（不可跳）

1. 开书 / 风格（可 `load_skill`：`book-cold-start`）
2. 卷规划 → 章梗概/细纲 → 草稿
3. 用户确认草稿（「草稿可以，发布正文」或等价确认）
4. 设定抽取 → 图治理 → 正文发布

在星海余页应用里用 `chapterDraftProposal(s)` 保存草稿。按《创作台讨论工作流》由宿主处理发布。章节面板批量编排仅在 `batchAutomation=true` 时适用。下面的脚本及 `.folio` 写入约定仅适用于独立脚本宿主。

## 脚本工具

工作区根目录作为参数传入（`--workspace`）。脚本可读写书目录与 `.folio/`。

| 脚本 | 作用 |
| --- | --- |
| `folio-init.mjs` | 确保 `.folio` 布局与空 `ui-state.json` |
| `settings-write.mjs` | 从草稿抽取并写入设定集；更新 ui-state |
| `graph-sync.mjs` | 图治理全流程 |
| `graph-cancel.mjs` | 取消当前图同步 |
| `graph-rerun.mjs` | 全部阶段重跑 |
| `graph-continue.mjs` | 仅失败阶段继续 |
| `chapter-publish.mjs` | 正文落盘 |
| `apply-action.mjs` | 消费一个 action JSON（CLI / Codex） |

## UI 协议

见 `schema/ui-state.schema.json`、`schema/action.schema.json`。  
脚本与宿主运行器写完磁盘后必须刷新 `ui-state.json`。

## 与既有 craft skill

默认挂载的去 AI 味与对话 skill 在执笔或润色时按需参考。句段、语气、对白、详略和停顿服从作者明确要求与作品的实际场面。工具列表提供 `load_skill` 时，可按需加载其他参考。
