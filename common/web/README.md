# StarseaFolio Web（复用桌面 renderer）

与 Electron 桌面共用 `common/renderer` UI，通过 `POST /rpc` + Bearer 连接远程 backend。

模型配置中的 API Key 单独保存在当前浏览器的 IndexedDB，按后端地址和密钥引用隔离；读取配置只返回是否已保存，不回填密钥。发送模型请求或获取模型列表时，桥接层读取本机密钥并随请求传给后端，保留用户选择的模型、接口协议和参数。远程连接应使用 HTTPS。浏览器数据清除、换浏览器或换设备后需重新填写密钥；此前旧网页桥接没有保存的密钥也需要重新填写。

手机工作台本地预览运行 `pnpm dev:android`，访问 `http://localhost:8081/`，使用当前源码的本机后端。

定向验证：`node scripts/acceptance/mobile-model-credentials.mjs`。该脚本使用隔离书籍、应用数据和浏览器存储，经过真实 HTTP 后端连接本地模拟模型服务，不调用付费模型或修改用户数据。

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

产物在 `common/web/dist`，可挂到 Nginx 静态目录。
