# LNCrawl 原作参考工具

上游仓库：https://github.com/lncrawl/lightnovel-crawler

官方发布接口：https://api.github.com/repos/lncrawl/lightnovel-crawler/releases/latest

官方提供 CLI：`lncrawl search "作品名"`、`lncrawl crawl "作品链接" --noin --format json`。Windows 官方资产是安装包，构建阶段校验固定版本及官方 SHA-256，再在构建机准备真正的 CLI 与完整依赖。最终安装版与便携版都携带这些资源，用户端不再首次下载、安装或启动独立服务。

上游地址、固定版本、安装包地址及摘要统一在 `third-party/lncrawl/upstream.json` 维护。`scripts/packaging/prepare-lncrawl.mjs` 生成 `win/desktop/resources/lncrawl/`；electron-builder 的 beforePack 钩子强制准备和验证全部资源，缺失时构建失败，不允许发出漏带工具的包。资源包含原版 CLI、依赖、GPL 许可证及对应版本源码归档。大体积生成文件不提交 Git，由构建脚本从上游准备。

发行包运行时位于 `resources/tools/lncrawl/`，开发环境位于 `win/desktop/resources/lncrawl/`；后端只读校验并执行这里的程序。抓取数据库和缓存保存在 `<applicationDataRoot>/tools/lncrawl/books/`，不会写入安装目录。运行时缺失、平台不匹配或可执行文件损坏会清楚报错，不自动下载安装。官方 CLI 的站点规则同步、搜书及下载本身仍需联网。

开发机第一次准备：`pnpm prepare:lncrawl`；运行开发模式时会先检查该资源。更新上游时维护 pin 文件并重新构建 StarseaFolio，用户随软件版本更新获得新运行时。

后台进程使用参数数组和 `windowsHide`，抓取带 `--noin`，禁用浏览器抓取及图片下载；不调用 `app` 命令。单次 CLI 最长 3 分钟，可取消，超时终止进程树。

讨论 Agent 先获取工具介绍，调用 `describe` 后才获得参数。原作查询在风格确认前可用，但不开放章节写入，也不越过主角/卷规划的用户必答门禁。

- `original_work_search`：`title` 必填；`source` 可选，用已知站点名过滤来源。默认目标是用户提到作品的原作/正史，除非用户明确指定同人、二创、AU 或衍生版本。解析每个候选的站点简介并连同标题、URL返回；只把正式结果块的 URL 当候选，错误日志网址不会进入抓取白名单。连载状态、作者或标签不算剧情简介。Agent 先核对媒介、版本、简介、角色与世界观；标题近似的其他网文/同人文不得冒充原作。错作要立即用更具体的标题/别名重搜；没有有效简介时先用网络搜索/详情页补查介绍。
- `original_work_crawl`：`title`、`url`、`chapterLimit` 必填；URL 必须来自当前搜索且候选必须有简介，章节数必须显式指定，不再把省略参数解释为全本。首次建议抓 1-3 章确认作品身份；样本不符立即放弃该候选并重搜，不导入错作。索引明确标注抓取范围。
- 抓取仅导入本次生成或修改的 JSON ZIP，不回退到无关旧包；跳过没有正文的 JSON，HTML 正文转为可检索文本。
- 资料写入 `参考文件/原作资料/<作品名>/`。导入成功后立即刷新当前对话的工作区目录，Agent 可在同一轮通过工作区读取获取新章节证据；索引、搜索摘要和抓取回执本身不算原作正文证据。
- 无候选、超时或抓取失败会进入“未核验”兜底，允许结合用户设定与上下文合理推演，不把推演声称为已核实事实。

定向测试：

```powershell
pnpm exec vitest run common/backend/test/lncrawl-reference-service.test.ts common/backend/test/original-work-tool-gates.test.ts common/backend/test/original-work-evidence-gate.test.ts
pnpm --filter @starseafolio/backend build
node scripts/acceptance/lncrawl-reference-run.mjs "作品搜索词" "可选来源" "简介中的身份线索1" "简介中的身份线索2"
```

最后一项使用真实网络和官方 CLI，在 `.worldseed-data/lncrawl-live-check/workspace` 中搜索、核对简介，只在简介同时包含所有显式身份线索时才下载首章、导入并读取正文；缺线索或不匹配时拒绝抓取，不调用模型、不修改用户作品。可以传入作品搜索词、支持搜索的站点名以及简介中应出现的身份线索。报告为同目录上一级的 `acceptance-report.json`。
