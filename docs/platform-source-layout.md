# 平台源码目录

源码按 `win/`、`android/`、`common/` 分组。新增功能先判断是否属于平台能力；业务规则、协议和可复用界面归入 `common/`。

```text
win/
  desktop/                 Electron 窗口、IPC、系统菜单、文件选择和 Windows 打包
    src/main/
    src/preload/
    resources/             Windows 图标等平台资源
android/
  mobile/                  Expo 移动端入口、移动界面与 Android 配置
  scripts/                 手机共享工作台开发预览与 APK 打包入口
common/
  backend/                 共用业务用例、状态门禁、图治理、检索和任务逻辑
  renderer/                共用 React 工作台、编辑器、章节与设置界面
    src/
    test/
  web/                     浏览器启动入口与 HTTP 平台桥接
  packages/
    contracts/             RPC、数据结构及平台桥接契约
    config/                共用默认配置
    prompt-contracts/      提示词、输出约束及共享 Markdown 预设
scripts/                   仓库构建、打包与验收脚本
docs/                      设计、运行与开发文档
third-party/               第三方上游版本及来源记录
```

## 依赖边界

- Windows 壳、Web 入口及手机 Web 预览复用 `common/renderer`，不分别复制工作台源码。手机通过导航切换目录、章节/卷详情和工具面板，写作设置复用同一组字段。
- 平台桥接接口位于 `common/packages/contracts/src/platform-bridge.ts`；Electron 的实现位于 `win/desktop/src/preload/`，浏览器的实现位于 `common/web/src/bridge/`。
- 共用工作台与契约不导入 Electron。Windows 系统操作由平台桥接提供。
- `common/backend` 保留现有 Node.js 运行环境和 SQLite、文件、抓取适配器。本次目录迁移不等于这些依赖已经支持 Android 本地运行；APK 的本地运行环境和平台适配仍需实现。
- `android/mobile` 保留独立 npm 安装与 React Native 的 React 版本，避免与共用 Web 工作台的 React 版本混用。
- 手机 Web 预览启动当前本机 HTTP 后端，使用桌面本地书库；旧 Expo 原生壳仍通过 HTTP 访问服务。独立 APK、本地运行环境及平台文件操作的完整迁移尚未完成。

## 开发入口

```bash
# 根目录安装与共用包构建
corepack pnpm install --frozen-lockfile
corepack pnpm exec tsc -b

# Windows
corepack pnpm dev:win

# 共用 Web 工作台
corepack pnpm dev:web

# Android 依赖与预览
npm --prefix android/mobile install
corepack pnpm dev:android:web
```

Windows 构建仍使用 `corepack pnpm package:win`，产物位于 `win/desktop/release/`。Electron renderer 构建产物仍位于 `win/desktop/out/renderer/`，共用源文件位于 `common/renderer/`。

## 双平台打包入口

- Windows：`corepack pnpm package:exe`（也可用 `package:win`），生成 Setup 与 Portable EXE，需要 Windows 和 MSVC C++ 编译环境。
- Android：先 `npm --prefix android/mobile ci`，再 `corepack pnpm package:apk`（也可用 `package:android`），产物在 `android/mobile/release/`，需要 JDK 17 与 Android SDK。该包仍为依赖 HTTP 后端的 Expo 原生客户端，不代表完整工作台或本地后端迁移完成。
- `.github/workflows/build-packages.yml` 是唯一的构建与发布入口（Build EXE and APK）：在推送 `master`、`dev-0.0.1`、版本标签或手动运行时构建 EXE 与预览 APK，上传 Artifacts；两端都成功后，发布到同一个 GitHub Release 并更新 Windows 的 latest.json。

具体环境、签名和架构选项见 `win/README.md`、`android/mobile/README.md`。

开发者运行中的旧进程可能仍引用移动前路径；目录迁移后应从上述新入口重新启动。

## 本次迁移验证

- pnpm frozen/offline 安装通过；锁文件的依赖定义与快照部分保持一致，仅调整 workspace 路径并登记共享 renderer。
- 所有 workspace 类型检查通过；Android 独立类型检查和 2 项现有测试通过。
- 共用后端、Windows Electron 和 Web 构建通过；Android Expo Web 导出通过。
- 从临时工作目录启动共用 HTTP 后端，验证健康检查、项目创建及工作区目录读取，模型调用数为 0。
- 完整测试为 1326 项通过、54 项失败。对迁移前 HEAD 快照复跑失败文件，得到相同的 54 项失败，按文件与用例名称比较未发现新增失败。原有失败包括未满足当前卷门禁的旧测试及数据库迁移数量断言过时；本次不修改这些业务约束。
- 此处的构建和导出验证不代表已生成 APK，也不代表 Android 本地运行环境已完成。
