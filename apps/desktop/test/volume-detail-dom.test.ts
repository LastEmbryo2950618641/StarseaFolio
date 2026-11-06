import { existsSync } from "node:fs"
import { Server as HttpServer } from "node:http"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type {} from "./volume-detail.fixture.js"

const executable = [
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"], chromium.executablePath(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((path): path is string => path !== undefined && existsSync(path))
const folder = "第一卷 石屑与油墨"
const synopsisPath = `大纲/${folder}.梗概.md`
const outlinePath = `大纲/${folder}.md`

describe.skipIf(executable === undefined)("volume detail DOM refresh", () => {
  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  let page: Page
  let url: string
  let errors: string[]
  beforeAll(async () => {
    const fixturePath = resolve(import.meta.dirname, "volume-detail.fixture.tsx").replaceAll("\\", "/")
    server = await createServer({
      configFile: false, root: resolve(import.meta.dirname, "../src/renderer"),
      cacheDir: resolve(tmpdir(), `worldseed-volume-vite-${String(process.pid)}`),
      esbuild: { jsx: "automatic" },
      server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(import.meta.dirname, "../../..")] }, watch: null, preTransformRequests: false },
      plugins: [{ name: "isolated-volume-fixture", configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url === "/favicon.ico") { response.statusCode = 204; response.end(); return }
          if (request.url !== "/volume-fixture") { next(); return }
          response.setHeader("Content-Type", "text/html")
          response.end(`<html><body><div id="root"></div><script type="module" src="/@fs/${fixturePath}"></script></body></html>`)
        })
      } }],
    })
    await server.listen()
    const origin = server.resolvedUrls?.local[0]
    if (origin === undefined || executable === undefined) throw new Error("Volume fixture needs Vite and Chromium")
    url = `${origin}volume-fixture`
    browser = await chromium.launch({ executablePath: executable, headless: true })
  }, 30000)
  afterAll(async () => {
    try { await browser?.close() } finally {
      const httpServer = server?.httpServer
      if (httpServer instanceof HttpServer) httpServer.closeAllConnections()
      await server?.close()
    }
  }, 30000)
  beforeEach(async () => {
    if (browser === undefined) throw new Error("Volume fixture browser did not start")
    page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    errors = []
    page.on("pageerror", (error) => { errors.push(error.message) })
    page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()) })
    await page.clock.install({ time: new Date("2026-11-06T00:00:00Z") })
    await page.clock.pauseAt(new Date("2026-11-06T00:00:01Z"))
    await page.goto(url)
    await expect.poll(() => page.getByTestId("volume-planning-status").textContent()).toContain("1/5")
    await page.getByTestId("volume-detail-tab-synopsis").click()
    await expect.poll(() => synopsis().textContent()).toContain("卷梗概初版")
    await page.evaluate(() => { window.volumeDetailFixture.loadingFlashes = 0 })
  }, 30000)
  afterEach(async () => {
    await page.close()
    expect(errors).toEqual([])
  })
  const synopsis = () => page.getByTestId("chapter-browse-volume-synopsis")

  it("keeps content, tab and scroll during streaming parent rerenders without rereading files", async () => {
    await page.evaluate((path) => { window.volumeDetailFixture.hold(path) }, synopsisPath)
    const initialReads = await page.evaluate(() => window.volumeDetailFixture.reads.length)
    const rail = page.getByTestId("chapter-browse-detail-rail")
    await rail.evaluate((element) => { element.scrollTop = 200 })
    for (let index = 0; index < 12; index++) {
      await page.evaluate(() => { window.volumeDetailFixture.rerender() })
      await page.clock.runFor(20)
    }
    expect(await synopsis().textContent()).toContain("卷梗概初版")
    expect(await page.getByTestId("volume-detail-tab-synopsis").getAttribute("aria-selected")).toBe("true")
    expect(await rail.evaluate((element) => element.scrollTop)).toBe(200)
    expect(await page.evaluate(() => window.volumeDetailFixture.loadingFlashes)).toBe(0)
    expect(await page.evaluate(() => window.volumeDetailFixture.reads.length)).toBe(initialReads)
  })

  it("refreshes changed planning files in the background, retains content on transient errors and handles deletion", async () => {
    await page.evaluate((path) => { window.volumeDetailFixture.hold(path) }, synopsisPath)
    await page.clock.runFor(2100)
    expect(await synopsis().textContent()).toContain("卷梗概初版")
    await page.clock.runFor(4000)
    expect(await page.evaluate((path) => window.volumeDetailFixture.reads.filter((read) => read.path === path).length, synopsisPath)).toBe(2)
    await page.evaluate((path) => { window.volumeDetailFixture.fail(path, true); window.volumeDetailFixture.release(path) }, synopsisPath)
    await expect.poll(() => page.evaluate(() => window.volumeDetailFixture.activeReads)).toBe(0)
    expect(await synopsis().textContent()).toContain("卷梗概初版")
    await page.evaluate(({ synopsisPath, outlinePath }) => {
      window.volumeDetailFixture.fail(synopsisPath, false)
      window.volumeDetailFixture.setFile(synopsisPath, "新梗概已写入")
      window.volumeDetailFixture.setFile(outlinePath, "新大纲已写入")
      window.volumeDetailFixture.setFile("大纲/第一卷 石屑与油墨.批量计划.md", '```json\n' + JSON.stringify({
        volumeFolderName: "第一卷 石屑与油墨", targetChapterCount: 6, targetWordCount: 12000, synopsisWriteCount: 2, outlineWriteCount: 2,
      }) + '\n```')
    }, { synopsisPath, outlinePath })
    await page.clock.runFor(2100)
    await expect.poll(() => synopsis().textContent()).toContain("新梗概已写入")
    await page.getByTestId("volume-detail-tab-outline").click()
    expect(await page.getByTestId("chapter-browse-volume-outline").textContent()).toContain("新大纲已写入")
    expect(await page.evaluate(() => window.volumeDetailFixture.loadingFlashes)).toBe(0)
    await page.evaluate((path) => { window.volumeDetailFixture.setFile(path, undefined) }, outlinePath)
    await page.clock.runFor(2100)
    await expect.poll(() => page.getByTestId("chapter-browse-volume-outline").textContent()).toContain("卷大纲待写入")
    await page.getByTestId("volume-detail-tab-info").click()
    expect(await page.getByTestId("volume-planning-status").textContent()).toContain("1/6")
    expect(await page.getByTestId("volume-planning-status").textContent()).toContain("写入2次")
  })

  it.each([
    { projectId: "project-2", workspaceRootRef: "workspace-1" },
    { projectId: "project-1", workspaceRootRef: "workspace-2" },
  ])("reloads the same volume path when only its scope changes: %j", async (scope) => {
    await page.evaluate((path) => { window.volumeDetailFixture.hold(path) }, synopsisPath)
    await page.clock.runFor(2100)
    await page.evaluate(({ scope, path }) => {
      window.volumeDetailFixture.setScopedFile(scope.projectId, scope.workspaceRootRef, path, "新作用域的卷梗概")
      window.volumeDetailFixture.configure(scope)
    }, { scope, path: synopsisPath })
    await page.clock.runFor(50)
    await page.evaluate((path) => { window.volumeDetailFixture.release(path) }, synopsisPath)
    await expect.poll(() => synopsis().textContent()).toContain("新作用域的卷梗概")
    expect(await synopsis().textContent()).not.toContain("卷梗概初版")
    expect(await page.evaluate(({ scope, path }) => window.volumeDetailFixture.reads.some((read) =>
      read.projectId === scope.projectId && read.workspaceRootRef === scope.workspaceRootRef && read.path === path),
    { scope, path: synopsisPath })).toBe(true)
  })

  it("ignores pending replies after switching volume, project or workspace, and cleans up on unmount", async () => {
    await page.evaluate((path) => { window.volumeDetailFixture.hold(path) }, synopsisPath)
    await page.clock.runFor(2100)
    await page.evaluate(() => {
      window.volumeDetailFixture.setFile("大纲/第二卷 新卷.梗概.md", "第二卷的梗概")
      window.volumeDetailFixture.configure({ projectId: "project-2", workspaceRootRef: "workspace-2", folderName: "第二卷 新卷", bodyPaths: [] })
    })
    await expect.poll(() => page.getByTestId("chapter-browse-detail-rail").textContent()).toContain("第二卷 新卷")
    await page.getByTestId("volume-detail-tab-synopsis").click()
    await expect.poll(() => synopsis().textContent()).toContain("第二卷的梗概")
    await page.evaluate((path) => { window.volumeDetailFixture.release(path) }, synopsisPath)
    await expect.poll(() => page.evaluate(() => window.volumeDetailFixture.activeReads)).toBe(0)
    expect(await synopsis().textContent()).not.toContain("卷梗概初版")
    await page.evaluate(() => { window.volumeDetailFixture.configure({ mounted: false }) })
    await page.getByTestId("chapter-browse-detail-rail").waitFor({ state: "detached" })
    const readCount = await page.evaluate(() => window.volumeDetailFixture.reads.length)
    await page.clock.runFor(12000)
    expect(await page.evaluate(() => window.volumeDetailFixture.reads.length)).toBe(readCount)
  })

  it("shows planning without waiting for published-body reads and updates words after edits/publication", async () => {
    await page.evaluate(() => {
      window.volumeDetailFixture.hold("章节正文/第二章.md")
      window.volumeDetailFixture.setFile("章节正文/第二章.md", "# 第二章\n\n宇宙洪荒")
      window.volumeDetailFixture.configure({ bodyPaths: ["章节正文/第一章.md", "章节正文/第二章.md"] })
    })
    await page.clock.runFor(100)
    expect(await synopsis().textContent()).toContain("卷梗概初版")
    await page.evaluate(() => { window.volumeDetailFixture.release("章节正文/第二章.md") })
    await page.getByTestId("volume-detail-tab-info").click()
    await expect.poll(() => page.getByTestId("volume-planning-status").textContent()).toContain("8 / 10,000")
    await page.evaluate(() => { window.volumeDetailFixture.setFile("章节正文/第一章.md", "# 第一章\n\n天地玄黄宇宙洪荒") })
    await page.clock.runFor(10200)
    await expect.poll(() => page.getByTestId("volume-planning-status").textContent()).toContain("12 / 10,000")
  })
})
