# StarseaFolio Mobile（Android）

手机工作台预览与 Windows 复用 `common/renderer`，通过同一套 `ClientRequest` / `ClientResponse` 访问当前本地后端。旧 Expo 精简界面保留作原生迁移参考，不再是默认 Web 预览。

## 安装

共享工作台预览只需仓库根目录的 pnpm 依赖。本目录的 Expo 原生壳**不在**根 workspace 的默认 `pnpm -r` 里，原生联调时另行安装：

```bash
# 仓库根
pnpm --filter @starseafolio/contracts build

cd android/mobile
npm ci
```

## 运行

```bash
cd android/mobile
npm install
```

### 电脑浏览器调试（推荐）

```bash
npm run web
```

也可在仓库根目录运行 `corepack pnpm dev:android`，打开 `http://localhost:8081/`。

启动命令先构建当前后端，再启动本机 HTTP 后端和共享工作台；使用桌面版的本地书库与当前共享 Markdown 规则，避免旧远端服务缺少新接口。后端仅绑定本机，浏览器经开发代理访问；临时认证由启动脚本管理。

预览具备讨论、章节列表、卷与章节详情、草稿版本、目录、写作设置、任务与图谱等共享界面；窄屏通过顶部导航切换，设置使用可滚动面板。开发预览仍依赖电脑运行，独立 APK 的本地运行适配尚未完成。

### 手机 Expo Go

```bash
npx expo start
```

用 Expo Go 扫码联调旧原生壳。其界面尚未接入新的共享工作台，不用于验收手机功能完整性。需要看旧 Web 界面时使用 `npm run web:legacy`。

### 本地 APK 打包

安装 Node.js 22、JDK 17、Android SDK（API 35、Build Tools 35.0.0、NDK 26.1.10909125、CMake 3.22.1），设置 `JAVA_HOME` 与 `ANDROID_HOME` 并接受 SDK 许可。在仓库根目录执行：

```bash
corepack pnpm install --frozen-lockfile
npm --prefix android/mobile ci
corepack pnpm package:apk --check
corepack pnpm package:apk
```

脚本构建共享契约、生成原生工程，再调用 Gradle。无需 Expo 账号或额外部署构建服务，但首次构建需要联网下载 Gradle、SDK 和 Maven 依赖。生成目录 `android/`、`ios/` 和 `release/` 不提交。

产物为 `android/mobile/release/Starsea-Folio-0.0.1-Android-preview.apk`，默认支持 arm64。可通过环境变量 `STARSEAFOLIO_ANDROID_ARCHITECTURES=arm64-v8a,x86_64` 增加模拟器架构；`--debug` 生成调试包，`--prepare-only` 仅生成原生工程。

默认包使用生成的调试签名，仅用于开发预览；正式发行前需配置并保管固定私钥。首次启动需填写自己的 HTTP 后端地址与访问令牌，包中没有预置账户。**当前 APK 是旧 Expo 原生客户端，尚未包含完整共享工作台或 Android 本地后端。** 手机完整工作台仍通过上述 Web 预览验收。

GitHub Actions 的 **Build EXE and APK** 在推送 `master`、`dev-0.0.1` 或手动运行时生成两端下载产物。也可选用 `eas.json` 的 `preview` 配置进行 EAS 云构建（需要 Expo 账号）；本地构建不使用 EAS。

## 原生迁移边界

目标是保留桌面完整业务能力，并将数据与业务运行能力集成到本地 APK。共享 UI 与手机预览已接通，原生打包入口已提供；Android 壳接入共享工作台、本地文件/SQLite、抓取运行时等适配仍需实现。浏览器文件选择、封面与应用更新等平台桥接能力不代表已达到 Windows 的全部能力。

## 相关文档

- 平台目录与迁移边界：[平台源码目录](../../docs/platform-source-layout.md)
- 当前 HTTP 运行方式：[服务端部署](../../docs/deploy-server-android.md)
