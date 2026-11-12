# 星海余页 · StarseaFolio

与结衣一起，把一个小小的构思写成长篇故事。

**星海余页（StarseaFolio）**是一款 AI 辅助小说创作软件。你决定故事的方向，智能助手结衣协助选择文风、完善主角、规划每一卷，并逐章生成梗概、大纲和草稿。知识图谱保存故事中的事实与原文依据，让长篇创作中的人物、设定和事件有据可查。

## 写作工作台

- **从构思到章节**：讨论创作方向、目标读者与笔风，完善主角设定，再确定每卷的主线、支线、章节数和预计字数。
- **梗概、大纲、草稿与正文**：分别编辑和保留草稿版本；草稿经过审核与图治理后才能成为正式正文。
- **按你的节奏推进**：逐章引导，或按卷规划批量推进；任务面板展示进度、失败原因和可用的恢复操作。
- **故事资料与长期记忆**：用 Markdown 管理设定集、描写规则和参考资料，用知识图谱召回已保存的事实及原文证据。
- **同人资料核实**：结合本地设定、网络检索与内置小说抓取工具查找依据；资料的可用性取决于来源站点与原作形式。
- **自己的模型配置**：配置模型服务和凭据，在工作台查看上下文与 Token 用量。

这些是当前产品的工作方式，不代表全部长期设计目标都已验收。具体边界与验证记录见 [设计与实施状态](docs/implementation-status.md)，图谱内核的长期目标见 [图谱与推演设计目标](docs/graph-design-goals.md)。

## 下载

前往 [GitHub Releases](https://github.com/LastEmbryo2950618641/StarseaFolio/releases/latest) 下载：

- **Windows**：`Starsea-Folio-<version>-Setup.exe` 安装包，或 `Starsea-Folio-<version>-Portable.exe` 便携包。
- **Android**：`Starsea-Folio-<version>-Android-preview.apk` 预览包。

Windows 版在本机保存书库并运行后端，调用模型服务需要网络和自己的服务配置。**目前 APK 是依赖 HTTP 后端的 Expo 预览客户端，尚未包含完整共享工作台或 Android 本地后端**；手机完整工作台可通过开发预览体验。APK 使用开发签名，当前平台差异见 [Android 说明](android/mobile/README.md)。

## 开发与打包

源码按平台组织，共享业务与界面只维护一份：

| 目录 | 职责 |
| --- | --- |
| `win/desktop` | Windows Electron 窗口、系统集成与安装包 |
| `android/mobile` | Expo 原生客户端与 Android 配置 |
| `android/scripts` | 手机工作台预览与 APK 构建入口 |
| `common/backend` | 创作流程、状态门禁、图治理、检索和任务 |
| `common/renderer` | 共享 React 写作工作台 |
| `common/web` | 浏览器入口与 HTTP 桥接 |
| `common/packages` | 共享契约、配置、提示词与 Markdown 预设 |

安装 Node.js 22 和 Corepack 后，在仓库根目录运行：

```bash
corepack pnpm install --frozen-lockfile

# Windows 开发
corepack pnpm dev:win

# 手机共享工作台预览：http://localhost:8081/
corepack pnpm dev:android

# Windows Setup 与 Portable EXE
corepack pnpm package:exe

# Android 预览 APK
npm --prefix android/mobile ci
corepack pnpm package:apk
```

EXE 输出到 `win/desktop/release/`，APK 输出到 `android/mobile/release/`。Windows 打包需要 Visual Studio 2022 C++ Build Tools；Android 打包需要 JDK 17 和 Android SDK。完整要求见 [Windows 说明](win/README.md)、[Android 说明](android/mobile/README.md) 和 [平台源码目录](docs/platform-source-layout.md)。

推送 `master` 或 `dev-0.0.1` 会触发 **Build EXE and APK**：构建 Windows 与 Android 包，两端都成功后发布 GitHub Release，并同时把浏览器端和网页账户网关部署到 `http://111.229.32.85/StarseaFolio/`。网页按账户隔离数据，桌面和安卓保持离线。构建产物也可在 Actions 的 Artifacts 下载。

## 技术文档

- [设计与实施状态](docs/implementation-status.md)：区分设计、实现、原型和实际验收。
- [代码架构](docs/project-code-architecture.md)、[后端架构](docs/backend-architecture.md)、[后端开发原则](docs/backend-coding-principles.md)。
- [图谱与推演设计目标](docs/graph-design-goals.md)、[系统设计](docs/system-design.md)、[规则与资料层级](docs/rule-and-source-layers.md)。
- [上下文与 KV 缓存](docs/context-and-kv-cache.md)、[AI 阶段契约](docs/ai-phase-contracts.md)、[章节修改协调](docs/chapter-modification-coordination.md)。
- [工作台设计](docs/ui-design.md)、[世界内容生成规则](docs/world-emergence-rules.md)、[V1 冻结基线](docs/v1-freeze.md)。

为兼容已有书库、凭据和部署配置，存储键、历史数据路径、应用标识与部分环境变量仍接受原有技术标识。这些兼容标识不作为产品名称展示，已有数据无需手工改名。开发环境变量见 [.env.example](.env.example)，后端运行方式见 [HTTP 后端说明](docs/deploy-server-android.md)。
