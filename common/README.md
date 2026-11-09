# 共用代码

- `backend/`：业务用例、状态门禁、图治理、检索、任务及现有运行时适配。
- `renderer/`：Windows 与 Web 复用的工作台界面及相关测试。
- `web/`：浏览器启动入口及 HTTP 平台桥接。
- `packages/contracts/`：公共协议、数据结构与平台桥接契约。
- `packages/config/`：公共默认配置。
- `packages/prompt-contracts/`：提示词、模型输出约束与 Markdown 预设。

Electron 平台实现留在 `../win/desktop/`，Android 平台实现留在 `../android/mobile/`。当前后端含 Node.js 依赖；完整 Android 本地运行仍需适配。详见 [平台源码目录](../docs/platform-source-layout.md)。
