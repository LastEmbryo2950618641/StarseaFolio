# Skill 宿主工作区协议（星海余页可视化 / Codex 同能力）

> **状态：** 已设定目标；实现进行中（协议骨架 + 脚本桩已落地）  
 
> **范围：** 将创作能力从星海余页内置提示词与编排中抽离为通用 skill；星海余页仅绑定工作区并可视化；Codex/Claude 使用同一 skill，能力与流程不折扣。  
> **关联：** [统一章节讨论 Agent](./2026-09-10-unified-chapter-discuss-agent-design.md) · 现有 `resources/skills/book-cold-start` · 图修订取消/重跑/继续（`v0.0.1-38`）

---

## 1. 目标（一次性设定）

**同一份 skill**（提示词 + 落盘脚本 + UI JSON schema）在 Codex/Claude 与星海余页上：

- 能力相同
- 流程相同（开书 → 风格 → 卷/章 → 草稿 → 设定抽取 → 图治理 → 正文落盘）
- 唯一差别：星海余页把 skill 输出的 JSON 填进现有面板；Codex 无面板，JSON 仍写出但不可视化

星海余页 **不** 再拥有业务提示词与落盘编排。软件只做：

1. 启动时绑定工作区目录
2. 把用户操作写成 action 文件
3. 调用 skill 运行器（模型 + skill 脚本）
4. 读取 `ui-state.json` 填充现有 UI

---

## 2. 决策记录

| 议题 | 选择 |
| --- | --- |
| Skill 是否通用 | **是**。Codex/Claude 与星海余页加载同一份 |
| 落盘责任 | **Skill 自带全部脚本工具**；正文、设定集、世界图、章节发布均由脚本改工作区 |
| 界面数据 | Skill 另写 `ui-state.json`；星海余页只渲染 |
| 工作区目录 | 星海余页：软件启动时已设置。Codex：无目录时询问用户 |
| 宿主协议 | **工作区协议**：`.folio/` 交换 action / ui-state / host |
| 图治理与发布 | **必须在 skill 内**（否则 Codex 无同等能力） |
| 软件内旧编排 | **退役**，不双轨长期并存 |
| 图治理失败恢复 | Skill 工具支持取消 / 重跑全部阶段 / 继续失败阶段（与现 UI 三按钮语义一致） |

---

## 3. 仓库与目录布局

### 3.1 Skill 包（与宿主无关）

建议路径（实现时可微调，语义不变）：

```text
skills/starsea-writing/          # 或 prompt-contracts/resources/skills/starsea-writing/
  SKILL.md                       # 提示词、阶段、宿主差异说明
  schema/
    ui-state.schema.json
    action.schema.json
  scripts/
    settings-write.*             # 设定抽取并写入设定集
    graph-sync.*                 # 图治理全流程
    graph-cancel.*
    graph-rerun.*                # 全部阶段重跑
    graph-continue.*             # 仅失败阶段继续
    chapter-publish.*            # 正文落盘
    ...                          # 创作台所需读写脚本
```

书工作区（现有结构保留）：

```text
设定集/
大纲/
章节正文/
表现输出/
参考文件/
.folio/
  host.json                      # { "host": "starseafolio" | "codex", "workspaceRoot": "..." }
  ui-state.json                  # skill 写入；宿主只读渲染
  actions/
    <actionId>.json              # 星海余页写入；运行器消费后归档/删除
  runs/
    <runId>/                     # 可选：阶段日志、失败检查点
```

### 3.2 `host.json`

```json
{
  "host": "starseafolio",
  "workspaceRoot": "D:/books/my-novel",
  "skillId": "starsea-writing",
  "updatedAtMs": 0
}
```

Codex 首次询问目录后写入同样结构，`host: "codex"`。

---

## 4. UI 状态协议

### 4.1 原则

- Skill **写** `ui-state.json`；星海余页 **只读填充** 现有面板。
- 面板字段对齐现有 UI 概念（消息、choices、todos、图阶段、错误），避免另造一套视觉模型。
- 未迁移的面板：该块可为空；宿主显示空态，不回退到旧内置编排。

### 4.2 顶层形状（示意）

```json
{
  "schemaVersion": 1,
  "updatedAtMs": 0,
  "run": {
    "runId": "...",
    "status": "idle | running | awaiting_user | failed | completed",
    "phase": "creation_desk | settings_write | graph_sync | chapter_publish | ...",
    "error": null
  },
  "panels": {
    "creationDesk": {
      "messages": [],
      "choices": [],
      "todos": [],
      "status": "idle | running | failed",
      "error": null
    },
    "graphRevision": {
      "tasks": [],
      "status": "idle | running | failed | completed",
      "error": null
    },
    "chapter": {
      "focus": null,
      "draftLabel": null,
      "publishStatus": null
    }
  }
}
```

`panels.creationDesk.messages` 对齐现有会话消息概念（role、content、reasoning、choices、todos、error）。  
`panels.graphRevision.tasks` 对齐图治理任务列表（阶段记录、取消/重跑/继续可用性、错误文案）。

### 4.3 图治理任务项（示意）

与现 UI 三按钮一致：

- `canCancel` / `canRetry`（重跑全部）/ `canContinue`（仅失败阶段）
- `progress.phases[]`：阶段名、状态、attempt
- 失败时阶段文案由 skill 写入；软件不解释业务语义

---

## 5. Action 协议

### 5.1 星海余页

用户操作 → 写 `.folio/actions/<actionId>.json`，例如：

| 用户动作 | action name |
| --- | --- |
| 创作台发送 | `creationDesk.send` |
| 点选 choice | `creationDesk.choose` |
| 确认草稿发布 | `creationDesk.send`（文案仍可含「草稿可以，发布正文」）或显式 `publish.confirm` |
| 图治理取消 | `graph.cancel` |
| 图治理重跑 | `graph.rerun` |
| 图治理继续 | `graph.continue` |

运行器取走 action → 按 `SKILL.md` 调模型与脚本 → 脚本更新工作区与 `ui-state.json` → UI 刷新。

### 5.2 Codex

不强制写 actions 文件。用户自然语言即输入；skill 在对话循环中调用同一批脚本，并写出同一份 `ui-state.json`。

---

## 6. Skill 流程（两宿主相同）

不可跳阶段；与现产品路径对齐：

1. 开书 / 风格（既有 `book-cold-start` 规则并入或由主 skill 加载）
2. 卷规划 → 章梗概/细纲 → 草稿
3. 用户确认草稿
4. `settings-write`（设定集）
5. `graph-sync`（世界图；失败可 `graph-continue` / `graph-rerun` / `graph-cancel`）
6. `chapter-publish`（`章节正文/` 落盘）

确认草稿后的 4–6 **不得** 由软件内 `publishDraft` / `submitChapterRevision` / `runGraphSync` 执行；这些路径退役后改由 skill 脚本承担同等效果。

---

## 7. 星海余页薄运行器

软件内保留的唯一执行层：

1. 解析并加载 skill 包
2. 维护 `.folio/host.json`
3. 监听 / 消费 `.folio/actions/*`
4. 调模型（凭证、限流、取消信号仍可由软件提供基础设施）
5. 执行 skill `scripts/`（白名单路径，工作区为 cwd/参数）
6. 监视 `ui-state.json` 并映射到现有 React 面板

明确 **不属于** 软件：

- 阶段提示词正文（迁入 `SKILL.md` / skill 资源）
- 设定抽取 / 图治理 / 发布的业务编排
- 对设定集、世界图、章节正文的直接写入（改由脚本）

---

## 8. 错误、取消、失败恢复

| 情况 | 行为 |
| --- | --- |
| 脚本失败 | 写 `run.status=failed`、面板 error；保留可恢复检查点于 `.folio/runs/` |
| 用户取消图治理 | `graph.cancel` → 脚本停当前 run，更新 ui-state |
| 重跑 | `graph.rerun` → 丢弃该次图同步进度，从设定抽取后全流程重开（或 skill 规定的全阶段起点） |
| 继续 | `graph.continue` → 仅重跑失败阶段及后续未完成阶段 |
| 模型 402/网络 | 与业务失败相同：ui-state 标失败；继续可复用检查点 |
| Codex 无 UI | 同样写 ui-state；用户用自然语言要求「继续/重跑/取消」 |

---

## 9. 迁移策略

1. 落地 skill 包骨架：`SKILL.md`、schema、空脚本接口、`.folio` 读写约定
2. 实现薄运行器 + 创作台面板改为只读 `ui-state`
3. 迁设定抽取 / 图治理 / 正文发布脚本；切断软件内 `publishDraft` 图同步编排
4. 退役内置 phase 提示词中已迁入 skill 的部分；旧 API 删除或变为运行器薄封装
5. Codex 验收：同一工作区、无 UI，完整跑通开书到正文落盘
6. 星海余页验收：同一工作区、面板与按钮仅反映 ui-state / 写 actions

不采用「软件旧路径与 skill 双轨长期并存」。切换窗口内可 feature flag，但完成标准是旧编排下线。

---

## 10. 测试要求

- Schema：非法 ui-state / action 必须失败
- 脚本：在临时工作区写入设定集 / 模拟图变更 / 章节文件，断言磁盘结果
- 运行器：给定 action 文件 → 调用脚本桩 → ui-state 更新 → 面板映射字段正确
- 图失败：continue 不重跑已完成阶段；rerun 新开 run
- 宿主差异：仅目录获取与是否可视化不同，脚本调用序列相同（契约测试）

---

## 11. 非目标（本设计不做）

- 重做一套全新视觉设计系统
- 让 Codex 内嵌星海余页 GUI
- 保留软件内第二套提示词「以防万一」
- 本轮改写全部 vendor 写作 skill 文风细则（可被主 skill `load` 复用）

---

## 12. 成功标准

1. 删除或旁路软件内创作/设定/图/发布编排后，星海余页仍能完成开书到正文落盘（仅 skill + 薄运行器 + 可视化）。
2. 同一工作区用 Codex 跑同一 skill，无需星海余页，得到同等磁盘产物。
3. 图治理失败后，Codex 与星海余页都能「继续」或「重跑」，语义一致。
4. 星海余页 UI 的数据来源可追溯为 `ui-state.json`，而非后端硬编码阶段文案驱动业务。
