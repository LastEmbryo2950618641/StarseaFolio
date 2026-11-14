# nikowenku-archive 原作小说资料

星海余页内置 `nikowenku-archive` 0.1.4 的 MIT 许可 JavaScript 源码，替代之前的 LNCrawl 工具。源码来自 https://github.com/LastEmbryo2950618641/niko-cli 的 `packages/nikowenku-archive`，固定提交与逐文件 SHA-256 记录在 `common/tools/nikowenku-archive/upstream.json`。更新时从该上游核对版本和源码，并同步清单、测试与文档。

开发环境直接使用 `common/tools/nikowenku-archive/`；Windows 安装版和便携版通过 `extraResources` 携带相同目录至 `resources/tools/nikowenku-archive/`。构建前校验全部 8 个源码/许可文件，用户端不下载工具、安装 Node/Python 或启动独立服务。CLI 在现有 Node/Electron 运行时的后台进程中执行，`windowsHide` 隐藏控制台；所有参数由代码组装，不执行模型提供的 shell 命令。

工具内置不等于远端书库离线内置。查询和首次下载访问 `https://111.229.32.85/nikowenku-archive/`，无需模型 API Key；书库没有收录或没有正文时明确返回失败，不把同名网文当原作。原文只下载到用户应用数据目录，旧参考 Markdown 不清理、不覆盖。

## 使用链路

1. 先按需读取本作品设定和已存原作参考；缺口优先查公开网络并读取相关页面。
2. `original_work_search` 根据上下文推断的标题搜索书库，返回 `bookId`、标题、原名、作者、简介和语言。搜索也匹配简介，不得只取首条；标题、简介、媒介和版本必须吻合，未说明衍生作品时默认原作。新一轮搜索立即废弃旧候选。
3. `original_work_download` 仅接受当前工作区搜索返回的 `bookId`，下载前再次读取详情，核对 ID、作者、标题和简介；不再接收任意 URL。显式 `chapterLimit` 控制导入范围，`startChapter` 默认为 1，首次建议 1–3 章。
4. CLI 将书库已有完整原文保存至 `<applicationDataRoot>/tools/nikowenku-archive/books/<workspaceHash>/<bookId>/original.txt`，保留原始编码与字节。下载回执和 SHA-256 验证缓存；版本未变且摘要一致时不重复下载。不向源站创建抓取任务。
5. 使用上游文本工具识别 UTF-8、UTF-16、GB18030 与章节，按指定范围导入 `参考文件/原作资料/<书名>--<bookId>/章节/`，索引记录来源、作者、ID、时间、原文位置与本次范围。无章节标题时切分为 8000 字符的编号片段。
6. 导入后刷新工作区目录，Agent 必须再 `request_read` 获取实际章节原文。搜索候选、回执和 README 不算原文证据，不能整本加载进上下文。网络和书库均不足时保留“未核验”的合理推演兜底，不放宽章节、风格或用户必答门禁。

每次 CLI 有输出上限、3 分钟超时及取消支持；失败不自动重试。完整正文上限 64MB，错误页和不完整下载不得导入。旧工具运行时、抓取代码和打包钩子已从当前源码及构建链移除，历史会话的旧状态仅作兼容读取，不重新调用旧工具。

## 验证

```powershell
pnpm verify:nikowenku
pnpm exec vitest run common/backend/test/nikowenku-reference-service.test.ts common/backend/test/original-work-tool-gates.test.ts common/backend/test/original-work-evidence-gate.test.ts common/backend/test/synopsis-workflow-tools.test.ts
pnpm --filter @starseafolio/backend build
pnpm verify:novel-reference -- "狼与香辛料(狼与辛香料)" "赫萝"
```

最后一项使用真实书库与真实内置 CLI，按精确标题匹配，核对简介中给定身份线索，再下载、导入、读取首章并检查第二次分段导入复用缓存；不调用付费模型，不修改用户作品。输出写入临时验收工作区。
