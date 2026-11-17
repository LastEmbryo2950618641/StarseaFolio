# 星海写作主 Skill（starsea-writing）

通用写作 skill：提示词、落盘脚本、`.folio/ui-state.json` 协议一体。  
**Codex / Claude / 星海余页** 加载同一份；能力与流程相同。唯一差别：星海余页把 `ui-state` 填进面板；无 GUI 宿主只改磁盘并写出 JSON。

## 宿主差异（仅此）

| | 星海余页 | Codex / Claude |
| --- | --- | --- |
| 工作区目录 | 软件启动已绑定，写 `.folio/host.json` | 无目录则询问用户后写入 |
| 用户输入 | `.folio/actions/<id>.json` | 对话自然语言 |
| 可视化 | 读 `ui-state.json` 填现有 UI | 写出 JSON，无面板 |

## 阶段顺序（不可跳）

1. 开书 / 风格（可 `load_skill`：`book-cold-start`）
2. 卷规划 → 章梗概/细纲 → 草稿
3. 用户确认草稿（「草稿可以，发布正文」或等价确认）
4. `scripts/settings-write` → 设定集
5. `scripts/graph-sync` → 世界图（失败：`graph-continue` / `graph-rerun` / `graph-cancel`）
6. `scripts/chapter-publish` → `章节正文/`

设定抽取、图治理、正文发布 **必须** 走本 skill 脚本，不得依赖宿主内置编排。

## 脚本工具

工作区根目录作为参数传入（`--workspace`）。脚本可读写书目录与 `.folio/`。

| 脚本 | 作用 |
| --- | --- |
| `folio-init.mjs` | 确保 `.folio` 布局与空 `ui-state.json` |
| `hosted-dispatch.mjs` | **宿主主调度**：按 action 调阶段脚本 + hostHandlers |
| `settings-write.mjs` | publish 阶段 1：草稿审核 + 设定抽取写入设定集，并按用户原话融合更新作品风格（`handlers.settingsWrite`） |
| `graph-sync.mjs` | publish 阶段 2：图治理 + 正文（`handlers.publishConfirm`；复用 settings-write 产物） |
| `chapter-publish.mjs` | publish 阶段 3：根据结果收口 ui-state |
| `graph-cancel.mjs` | 取消当前图同步（stub / enqueue 辅助） |
| `graph-rerun.mjs` | 全部阶段重跑（stub / enqueue 辅助） |
| `graph-continue.mjs` | 仅失败阶段继续（stub / enqueue 辅助） |
| `apply-action.mjs` | 无 host 时的离线 action 消费（需 ALLOW_STUB） |

`publish.confirm` 在 hosted 模式下固定走 `settings-write → graph-sync → chapter-publish` 三段 skill 脚本；真实落盘由 hostHandlers 完成，编排属于 skill。

### 阶段职责（诚实边界）

| 阶段脚本 | 已落地 | 仍在图同步任务内 |
| --- | --- | --- |
| `settings-write` | 草稿审核 + `settings_extraction`（提案写入设定集，产物缓存 `.folio/runs/`） | — |
| `graph-sync` | 调用 `publishConfirm`（submit + 等待）；预加载 settings-write 产物并跳过重复抽取 | 图治理各 phase |
| `chapter-publish` | 收口 ui-state / 面板文案 | 正文文件由 publishConfirm/submit 落盘 |

## UI 协议

见 `schema/ui-state.schema.json`、`schema/action.schema.json`。  
脚本与宿主运行器写完磁盘后必须刷新 `ui-state.json`。

## 提示词（本 skill 拥有）

| 路径 | 用途 |
| --- | --- |
| `prompts/synopsis-discuss.md` | 创作台阶段 outcome / schema |
| `prompts/creation-desk-workflow.md` | 创作台工具与门禁流程 |
| `prompts/plot-synopsis-guide.md` | 梗概 / 细纲 |
| `prompts/settings-revision-guide.md` | 设定修订 |

星海余页与 Codex 都从这些路径加载；`resources/v1/` 下同名文件仅为迁移占位，不再承载业务正文。

### 仍由平台层持有（非本 skill 流程正文）— 有意例外

跨阶段硬门禁与索引仍在 `resources/v1/`（`base-rules` / `content-handling` / `webnovel-prose-logic` / `settings-query-guide` / `skill-index` 及非 discuss 的 `phases/*`）。  
**不迁入本 skill**：它们是 TurnOrchestrator sticky 引擎规则与相位契约，宿主无关；本 skill 只拥有创作台→发布编排与讨论类业务提示词（`prompts/`）。平台层继续加载 `resources/v1/`，避免把引擎内核绑死在写作 skill 包上。

## Codex 运行（真实宿主）

优先用 `folio-run`（挂载 `ProjectRuntime` hostHandlers，与星海余页同一套 discuss / graph / publish）：

```bash
node common/backend/dist/cli/folio-run.js --workspace <书目录> ensure
node common/backend/dist/cli/folio-run.js --workspace <书目录> enqueue --name creationDesk.send --input '{"message":"开书：…"}'
node common/backend/dist/cli/folio-run.js --workspace <书目录> enqueue --name publish.confirm --input '{"revisionTaskId":"…","draftVersionId":"…","chapterSequence":1}'
node common/backend/dist/cli/folio-run.js --workspace <书目录> enqueue --name graph.continue --input '{"revisionTaskId":"…"}'
```

`scripts/*.mjs` 在无 hostHandlers 时作离线 stub（只改 ui-state / 落盘标记）；有 hostHandlers 时由宿主执行真实设定抽取、图治理与正文发布，脚本不重复跑。

无 GUI 时先询问用户工作区，再 `ensure`；用户自然语言写成 `.folio/actions` 后 `drain`。

## 与既有 craft skill

去味 / 对话 / 人味等仍可通过 `load_skill` 加载 vendor skill；本 skill 负责 **流程、创作台提示词与落盘宿主协议**。
