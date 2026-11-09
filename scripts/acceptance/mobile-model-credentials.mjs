/* global window, crypto, fetch, console */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { randomUUID } from "node:crypto"
import process from "node:process"
import { chromium } from "playwright-core"
import { startHttpBackend } from "../../common/backend/dist/bootstrap/http-entry.js"

// Isolated application data and browser storage; only a local mock provider receives requests.
const fixtureRoot = await mkdtemp(join(tmpdir(), "starseafolio-credentials-"))
const workspace = join(fixtureRoot, "book")
const projectId = randomUUID()
const token = randomUUID()
let providerCalls = 0
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer local-test-key")
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "local-test-model" }] }))
      return
    }
    let raw = ""
    for await (const chunk of req) raw += chunk
    const input = JSON.parse(raw)
    assert.equal(input.model, "local-test-model")
    assert.notEqual(input.stream, true)
    providerCalls += 1
    res.end(JSON.stringify({ id: "local-test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({
      outcome: "continue", artifact: { displayName: "本机配置验证成功", alternatives: [], finalSelfReview: "已验证本地测试接口" },
      requestedReads: [], citedReadIds: [], unresolvedDependencies: [], reason: "本地验证", selfReview: "本地验证",
    }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }))
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: error.message } })) }
})
await new Promise((done) => provider.listen(0, "127.0.0.1", done))
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`
const portProbe = createServer()
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done))
const backendPort = portProbe.address().port
await new Promise((done) => portProbe.close(done))
const backend = await startHttpBackend({ ...process.env,
  WORLDSEED_APP_DATA_ROOT: join(fixtureRoot, "runtime"),
  WORLDSEED_PROMPT_ROOT: resolve("common/packages/prompt-contracts"),
  WORLDSEED_HTTP_HOST: "127.0.0.1", WORLDSEED_HTTP_PORT: String(backendPort),
  WORLDSEED_API_TOKEN: token, WORLDSEED_API_TOKENS: "", WORLDSEED_AUTOMATIC_EVOLUTION_ENABLED: "false",
})
async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:${backend.port}/rpc`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ protocolVersion: "worldseed.v1", requestId: randomUUID(), method, payload }) })
  const result = await response.json()
  assert.equal(result.ok, true, result.error?.message)
  return result.data
}
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
  .find((candidate) => candidate && existsSync(candidate))
const browser = await chromium.launch({ executablePath, headless: true })
try {
  await rpc("project.create", { projectId, workspaceRootRef: workspace, displayName: "配置链路隔离测试" })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const requests = []
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  let alias
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON()
    if (request.payload?.workspaceRootRef === alias) request.payload.workspaceRootRef = workspace
    requests.push({ method: request.method, payload: request.payload })
    const response = await fetch(`http://127.0.0.1:${backend.port}/rpc`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(request),
    })
    const result = await response.json()
    if (request.method === "project.list" && result.ok) {
      for (const book of result.data.projects) book.workspaceRootRef = alias
    }
    await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(result) })
  })
  // Determine the preview's book root without printing or reading credentials.
  await page.goto(process.env.WORLDSEED_MOBILE_PREVIEW_URL ?? "http://localhost:8081/")
  alias = await page.evaluate(async () => `${(await import('/src/bridge/session.ts')).DEFAULT_BOOKS_ROOT}/__credentials_fixture__`)
  await page.reload()
  await page.getByRole("button", { name: "书籍操作：配置链路隔离测试", exact: true }).click()
  await page.getByRole("dialog", { name: "书籍操作", exact: true }).getByRole("button", { name: "打开", exact: true }).click()
  await page.getByTestId("model-config-trigger").click()
  const dialog = page.getByTestId("model-configuration-dialog")
  await dialog.locator(".settings-option-row").nth(1).click()
  const field = (name) => dialog.locator("label.model-field").filter({ hasText: name }).locator("input")
  await field("配置名称").fill("本地测试接口")
  await field("Base URL").fill(providerUrl)
  await field("输入兼容服务支持的模型名称").fill("local-test-model")
  await dialog.locator(".secret-input input").fill("local-test-key")
  await dialog.locator("label.model-field").filter({ hasText: "API 协议" }).locator("select").selectOption("openai_chat_completions")
  await dialog.getByRole("button", { name: "保存更改", exact: true }).click()
  await dialog.waitFor({ state: "detached" })
  const metadataSave = requests.find((request) => request.method === "model.profiles.save")
  assert.ok(metadataSave)
  assert.equal(JSON.stringify(metadataSave.payload).includes("local-test-key"), false)
  await page.reload()
  await page.getByRole("button", { name: "书籍操作：配置链路隔离测试", exact: true }).click()
  await page.getByRole("dialog", { name: "书籍操作", exact: true }).getByRole("button", { name: "打开", exact: true }).click()
  await page.getByTestId("model-config-trigger").click()
  await dialog.locator(".settings-option-row").nth(1).click()
  assert.equal(await dialog.locator(".secret-input input").inputValue(), "")
  assert.equal(await dialog.locator(".secret-input input").getAttribute("placeholder"), "已保存（重新输入可替换）")
  await dialog.getByRole("button", { name: "返回模型配置列表", exact: true }).click()
  await dialog.getByRole("button", { name: "返回创作界面", exact: true }).click()
  const result = await page.evaluate(async ({ projectId, workspaceRootRef }) => {
    const config = await window.worldseed.readModelProfiles()
    const profile = config.profiles.find((item) => item.id === config.activeProfileId)
    const { apiKey, hasApiKey, ...model } = profile
    if (!hasApiKey || apiKey !== "") throw new Error("Invalid persisted credential state")
    const catalog = await window.worldseed.listModels({ baseUrl: model.baseUrl, credentialRef: model.credentialRef, apiKey: "" })
    if (catalog.models[0]?.id !== "local-test-model") throw new Error("Catalog did not use saved credentials")
    return window.worldseed.invoke({ protocolVersion: "worldseed.v1", requestId: crypto.randomUUID(), method: "project.suggestDisplayName",
      payload: { projectId, workspaceRootRef, model } })
  }, { projectId, workspaceRootRef: alias })
  assert.equal(result.ok, true, result.error?.message)
  assert.equal(result.data.displayName, "本机配置验证成功")
  assert.equal(providerCalls, 1)
  assert.deepEqual(errors, [])
  console.log("PASS: mobile DOM save, reload persistence, empty-key catalog and selected-model generation through real HTTP backend. Local mock provider only; no user data or paid model calls.")
} finally {
  await browser.close()
  await backend.transport.close()
  await new Promise((done) => provider.close(done))
}
