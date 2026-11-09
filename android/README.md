# Android 平台

`mobile/` 保存 Expo 原生壳与 Android 配置，使用独立 npm 依赖安装。当前手机工作台预览复用 `common/renderer` 的完整界面，由 `scripts/dev-web.mjs` 启动本机当前版本后端和 8081 预览。

在仓库根目录运行 `corepack pnpm dev:android`，浏览器打开 `http://localhost:8081/`；手机与电脑同网时可打开终端打印的 Network 地址。预览使用本机桌面书库，不连接旧 VPS。

手机工作台有讨论、章节、目录、写作设置和工具入口；章节及卷详情以独立内容页显示。此预览需要电脑运行开发服务，尚不等同于独立 APK。

启动预览后运行 `corepack pnpm verify:mobile-workbench-dom`，会在 320、390、840 和 1366 像素宽度下检查书库、设置、目录文件、卷与章节详情、任务面板和导航；检查会拦截生成及内容写入请求。结果与截图位于 `output/mobile-workbench/`。

运行方式见 [mobile/README.md](mobile/README.md)。共享源码及本地 APK 的迁移边界见 [平台源码目录](../docs/platform-source-layout.md)。

安装原生依赖 `npm --prefix android/mobile ci` 后，运行 `corepack pnpm package:apk` 可打包现有 Expo HTTP 客户端，产物位于 `android/mobile/release/`。需要 JDK 17 和 Android SDK；该 APK 尚未内置完整共享工作台与本地后端，详见上述打包说明。
