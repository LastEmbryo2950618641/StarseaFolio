# StarseaFolio Mobile（Expo / Android）

手机端走**同一套后端** `ClientRequest` / `ClientResponse`：`POST /rpc` + `WS /events`。  
**不要**把服务器 SSH 密码填进 App；只用部署时配置的 `WORLDSEED_API_TOKEN`。

## 安装

本目录**不在**根 workspace 的默认 `pnpm -r` 里（避免 Expo 拖垮桌面依赖）。先构建 contracts，再在本目录装依赖：

```bash
# 仓库根
pnpm --filter @worldseed/contracts build

cd apps/mobile
npm install
# 或: pnpm install
```

## 运行

```bash
cd apps/mobile
npm install
```

### 电脑浏览器调试（推荐）

```bash
npm run web
```

浏览器打开 Expo 给出的本地地址（一般是 `http://localhost:8081`）。  
启动后直接进书库，内置默认连 `http://111.229.32.85`；需要改地址/Token 时在书库右上角「设置」。

### 手机 Expo Go

```bash
npx expo start
```

用 Expo Go 扫码联调。

### APK（尚未打包）

仓库里**没有**现成 `.apk`。要安装包可用：

```bash
# 需 Expo 账号；云端出 APK
npx eas-cli build -p android --profile preview
```

或本机 Android SDK：`npx expo prebuild` 后再 `npx expo run:android`。

## 第一版能力

- 连接健康检查 `/health`
- 书库 `project.list` / `project.open`
- 创作台讨论 `synopsis.conversation.*`
- 章节列表与阅读 `chapter.list` / `chapter.read`

不做：世界图、Monaco、本机选目录、批量推演全屏运维。

## 相关文档

- 服务端部署：[docs/deploy-server-android.md](../../docs/deploy-server-android.md)
