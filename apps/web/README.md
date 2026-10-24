# WorldSeed Web（复用桌面 renderer）

与 Electron 桌面共用 `apps/desktop/src/renderer` UI，通过 `POST /rpc` + Bearer 连接远程 backend。

## 开发

```bash
# 仓库根
pnpm install
pnpm --filter @worldseed/contracts build
pnpm --filter @worldseed/config build
pnpm --filter @worldseed/web dev
```

浏览器打开 `http://localhost:5173`。默认 API：`http://111.229.32.85`。

覆盖会话（控制台）：

```js
localStorage.setItem('worldseed.web.session.v1', JSON.stringify({
  apiBaseUrl: 'http://111.229.32.85',
  apiToken: 'your-token'
}))
location.reload()
```

## 构建

```bash
pnpm --filter @worldseed/web build
```

产物在 `apps/web/dist`，可挂到 Nginx 静态目录。
