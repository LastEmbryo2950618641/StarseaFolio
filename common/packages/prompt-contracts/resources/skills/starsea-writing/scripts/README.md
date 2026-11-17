# starsea-writing scripts

## 真实执行（Codex / 星海余页）

`FolioSkillRunner` 在有 hostHandlers 时 **始终** 进入 `hosted-dispatch.mjs`：

1. `creationDesk.send` → `handlers.creationDeskSend` + sync ui-state  
2. `publish.confirm` → `settings-write`（审核 + 设定抽取）→ `graph-sync`（`publishConfirm`，预加载抽取产物）→ `chapter-publish`  
3. `graph.*` → 对应 handler + 同步 graph 面板  

```bash
node common/backend/dist/cli/folio-run.js --workspace <书目录> ensure
node common/backend/dist/cli/folio-run.js --workspace <书目录> enqueue --name publish.confirm --input '{"revisionTaskId":"…","draftVersionId":"…","chapterSequence":1}'
```

编排在 skill 脚本；磁盘/模型能力由 hostHandlers（`ProjectRuntime`）提供。设定抽取产物缓存在 `.folio/runs/settings-extraction-<revisionTaskId>.json`。

## 离线 stub（仅协议自测）

无 hostHandlers 时默认拒绝。`allowOfflineStubs: true`（或 `STARSEA_FOLIO_ALLOW_STUB=1`）才允许 CLI stub 写占位文件。
