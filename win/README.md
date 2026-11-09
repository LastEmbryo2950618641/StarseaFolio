# Windows 平台

`desktop/` 保存 Electron Main、Preload、原生文件与窗口操作、Windows 资源及安装包配置。

共享工作台源码位于 `../common/renderer/`，共享后端位于 `../common/backend/`。平台通信契约位于 `../common/packages/contracts/src/platform-bridge.ts`。

在仓库根目录运行 `corepack pnpm dev:win`；打包运行 `corepack pnpm package:win`。

`corepack pnpm package:exe` 是同一打包入口，会先构建共享后端和 Electron，再生成 `win/desktop/release/Starsea-Folio-<version>-Setup.exe` 与 `Starsea-Folio-<version>-Portable.exe`。`--dir` 仅生成未安装目录。

本地构建需要 Windows、Node.js 22 和 Visual Studio 2022 Build Tools（C++ 桌面开发与 Windows SDK），用于编译 SQLite 原生依赖；首次打包需联网下载 Electron 和内置抓取运行时。命令不会自动发布安装包。GitHub Actions 的 **Build EXE and APK** 提供已配置编译工具的双平台构建环境，产物在该次运行的 Artifacts 中下载；**Release Windows** 保留正式发布入口。
