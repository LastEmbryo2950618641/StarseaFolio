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

去味 / 对话 / 人味等仍可通过 `load_skill` 加载 vendor skill；本 skill 负责 **流程与落盘宿主协议**。
