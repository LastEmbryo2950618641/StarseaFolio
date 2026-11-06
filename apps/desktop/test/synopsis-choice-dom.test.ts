import { existsSync } from "node:fs"
import { Server as HttpServer } from "node:http"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type {} from "./synopsis-choice.fixture.js"

// Isolated headless fixture only: never attach to the desktop or call a backend/model.
const executable = [
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"], chromium.executablePath(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((path): path is string => path !== undefined && existsSync(path))

describe.skipIf(executable === undefined)("synopsis choice DOM fixture", () => {
  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  let page: Page
  let url: string
  let errors: string[]

  beforeAll(async () => {
    const fixturePath = resolve(import.meta.dirname, "synopsis-choice.fixture.tsx").replaceAll("\\", "/")
    server = await createServer({
      configFile: false, root: resolve(import.meta.dirname, "../src/renderer"),
      cacheDir: resolve(tmpdir(), `worldseed-choice-vite-${String(process.pid)}`),
      esbuild: { jsx: "automatic" },
      server: {
        host: "127.0.0.1", port: 0, fs: { allow: [resolve(import.meta.dirname, "../../..")] },
        // This static fixture needs neither file watching nor speculative transforms.
        watch: null, preTransformRequests: false,
      },
      plugins: [{
        name: "isolated-choice-fixture",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url === "/favicon.ico") { response.statusCode = 204; response.end(); return }
            if (request.url !== "/choice-fixture") { next(); return }
            response.setHeader("Content-Type", "text/html")
            response.end(`<html><head><title>WorldSeed choice fixture</title></head><body><div id="root" style="height:100vh"></div><script type="module" src="/@fs/${fixturePath}"></script></body></html>`)
          })
        },
      }],
    })
    await server.listen()
    const origin = server.resolvedUrls?.local[0]
    if (origin === undefined || executable === undefined) throw new Error("Choice fixture needs a local Vite URL and Chromium executable")
    url = `${origin}choice-fixture`
    browser = await chromium.launch({ executablePath: executable, headless: true })
  }, 30000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      // Stop the client first, then clear HTTP keep-alive sockets before Vite drains its work.
      const httpServer = server?.httpServer
      if (httpServer instanceof HttpServer) httpServer.closeAllConnections()
      await server?.close()
    }
  }, 30000)
  beforeEach(async () => {
    if (browser === undefined) throw new Error("Fixture browser did not start")
    page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    errors = []
    page.on("pageerror", (error) => { errors.push(error.message) })
    page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()) })
    await page.goto(url)
    await page.locator(".synopsis-choice-group").last().waitFor()
  }, 30000)
  afterEach(async () => {
    await page.close()
    expect(errors).toEqual([])
  })

  const latest = () => page.locator(".synopsis-choice-group").last()
  const draft = () => page.locator(".creation-desk-composer > textarea")
  const selected = (label: string) => latest().getByRole("button", { name: label, exact: true })
  const edit = (label: string) => latest().getByRole("button", { name: `编辑选项：${label}`, exact: true })
  const sent = () => page.evaluate(() => window.choiceFixture.sent)

  it("multi-selects every action as draft text, preserving manual text without executing or sending", async () => {
    await draft().fill("方向 A（这是手写的）")
    const labels = ["方向 A", "方向 B", "确认梗概", "确认卷规划", "调用正文推演工具", "确认落盘", "暂不落盘", "确认用草稿经图治理覆盖正式正文", "切换到第2章"]
    for (const label of labels) {
      await selected(label).click()
      expect(await selected(label).getAttribute("aria-pressed")).toBe("true")
    }
    expect(await draft().inputValue()).toContain("用这份梗概写细纲\n确认卷规划\n按细纲写正文")
    await selected("方向 A").click()
    expect(await draft().inputValue()).toContain("方向 A（这是手写的）")
    expect(await draft().inputValue()).not.toContain("\n方向 A\n")
    await edit("方向 B").click()
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("用户改写的 B")
    expect(await draft().inputValue()).toContain("\n用户改写的 B\n")
    expect(await selected("用户改写的 B").getAttribute("aria-pressed")).toBe("true")
    expect(await sent()).toEqual([])
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
  })

  it("restores immutable AI text and the autosaved user variant across tab switches/reload without message collisions", async () => {
    await selected("方向 A").click()
    await edit("方向 A").click()
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("用户方向 A")
    expect(await draft().inputValue()).toBe("用户方向 A")
    await latest().getByRole("tab", { name: "AI生成", exact: true }).click()
    expect(await latest().getByRole("textbox", { name: "AI生成的原始选项" }).inputValue()).toBe("方向 A")
    expect(await latest().getByRole("textbox", { name: "AI生成的原始选项" }).getAttribute("readonly")).not.toBeNull()
    expect(await draft().inputValue()).toBe("方向 A")
    await latest().getByRole("tab", { name: "用户内容", exact: true }).click()
    expect(await draft().inputValue()).toBe("用户方向 A")
    await page.reload()
    await selected("用户方向 A").waitFor()
    expect(await selected("用户方向 A").getAttribute("aria-pressed")).toBe("false")
    expect(await draft().inputValue()).toBe("")
    expect(await page.locator(".synopsis-choice-group").first().getByRole("button", { name: "方向 A", exact: true }).count()).toBe(1)
    await selected("用户方向 A").click()
    expect(await draft().inputValue()).toBe("用户方向 A")
    await page.evaluate(() => { window.choiceFixture.configure({ messageId: "message-3" }); })
    await selected("方向 A").waitFor()
    expect(await latest().getByRole("button", { name: "用户方向 A", exact: true }).count()).toBe(0)
    await selected("确认梗概").click()
    await edit("确认梗概").click()
    expect(await latest().getByRole("textbox", { name: "编辑用户选项内容" }).inputValue()).toBe("确认梗概")
    await latest().getByRole("tab", { name: "AI生成", exact: true }).click()
    expect(await latest().getByRole("textbox", { name: "AI生成的原始选项" }).inputValue()).toBe("确认梗概")
    expect(await draft().inputValue()).toContain("用这份梗概写细纲")
  })

  it("edits your idea in every group, including groups with no AI choices", async () => {
    await page.evaluate(() => { window.choiceFixture.configure({ emptyChoices: true }); })
    expect(await page.getByTestId("synopsis-choice-your-idea").count()).toBe(2)
    await selected("你的想法").click()
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("我自己的完整回答")
    expect(await draft().inputValue()).toBe("我自己的完整回答")
    await selected("我自己的完整回答").click()
    expect(await draft().inputValue()).toBe("")
    await page.reload()
    await selected("我自己的完整回答").waitFor()
    await selected("我自己的完整回答").click()
    await page.getByTestId("creation-desk-send").click()
    expect((await sent())[0]).toMatchObject({ message: "我自己的完整回答", options: { setupAnswerTo: "question-1" } })
  })

  it("selects an unselected pencil option and synchronizes edits and tabs until explicitly deselected", async () => {
    await draft().fill("保留手写内容")
    await selected("方向 B").click()
    expect(await selected("方向 A").getAttribute("aria-pressed")).toBe("false")
    await edit("方向 A").click()
    expect(await selected("方向 A").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n方向 A")
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("铅笔改写的 A")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n铅笔改写的 A")
    expect(await selected("铅笔改写的 A").getAttribute("aria-pressed")).toBe("true")
    await latest().getByRole("tab", { name: "AI生成", exact: true }).click()
    expect(await selected("方向 A").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n方向 A")
    await latest().getByRole("tab", { name: "用户内容", exact: true }).click()
    expect(await selected("铅笔改写的 A").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n铅笔改写的 A")
    await edit("铅笔改写的 A").click()
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n铅笔改写的 A")
    await selected("铅笔改写的 A").click()
    await latest().getByRole("tab", { name: "AI生成", exact: true }).click()
    expect(await selected("方向 A").getAttribute("aria-pressed")).toBe("false")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B")
    await edit("方向 A").click()
    expect(await selected("铅笔改写的 A").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n方向 B\n铅笔改写的 A")
    expect(await sent()).toEqual([])
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
  })

  it("selects an empty idea pencil and synchronizes its first edit while retaining selection across tabs", async () => {
    await draft().fill("保留手写内容")
    await edit("你的想法").click()
    expect(await selected("你的想法").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容")
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("铅笔写下的想法")
    expect(await selected("铅笔写下的想法").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n铅笔写下的想法")
    await latest().getByRole("tab", { name: "AI生成", exact: true }).click()
    expect(await selected("你的想法").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容")
    await latest().getByRole("tab", { name: "用户内容", exact: true }).click()
    expect(await selected("铅笔写下的想法").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("保留手写内容\n铅笔写下的想法")
    await selected("铅笔写下的想法").click()
    expect(await draft().inputValue()).toBe("保留手写内容")
    expect(await sent()).toEqual([])
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
  })

  it("keeps manual copies and interior edits typed into the controlled composer", async () => {
    await selected("方向 A").click()
    await draft().focus()
    await draft().press("Home")
    await page.keyboard.insertText("方向 A")
    await selected("方向 A").click()
    expect(await draft().inputValue()).toBe("方向 A")
    await draft().fill("")
    await selected("方向 B").click()
    await draft().focus()
    await draft().press("Home")
    await draft().press("ArrowRight")
    await page.keyboard.insertText("手写")
    await selected("方向 B").click()
    expect(await draft().inputValue()).toBe("手写")
    expect(await sent()).toEqual([])
  })

  it("sends custom typed answers only on explicit send, using the latest question even without selected buttons", async () => {
    await draft().fill("我的完整自定义回答")
    await draft().dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true })
    expect(await sent()).toEqual([])
    await page.evaluate(() => { window.choiceFixture.configure({ questionId: "question-2" }); })
    await page.getByTestId("creation-desk-send").click()
    expect((await sent())[0]).toMatchObject({ message: "我的完整自定义回答", options: { setupAnswerTo: "question-2" } })
    expect(await draft().inputValue()).toBe("")
    await page.evaluate(() => { window.choiceFixture.configure({ questionId: undefined }); })
    await selected("确认梗概").click()
    await draft().press("Enter")
    expect((await sent())[1]?.message).toBe("用这份梗概写细纲")
    expect((await sent())[1]?.options).not.toHaveProperty("setupAnswerTo")
    expect(await selected("确认梗概").getAttribute("aria-pressed")).toBe("false")
  })

  it("populates style choices and custom style rows through the same editable selection path", async () => {
    await selected("爽文 + 飞卢 + 仙侠").click()
    expect(await draft().inputValue()).toContain("我选择的风格组合是：小说大类规则「表现输出/小说大类规则/爽文.md」")
    await selected("爽文 + 飞卢 + 仙侠").click()
    await latest().getByTestId("style-picker-major").selectOption({ index: 1 })
    await latest().getByTestId("style-picker-subcategory").selectOption({ index: 1 })
    await latest().getByTestId("style-picker-prose").selectOption({ index: 1 })
    await latest().getByRole("button", { name: "编辑风格组合", exact: true }).click()
    const userEditor = latest().getByRole("textbox", { name: "编辑用户选项内容" })
    expect(await userEditor.inputValue()).toContain("笔风规则「表现输出/笔风规则/仙侠.md」")
    expect(await draft().inputValue()).toBe(await userEditor.inputValue())
    await userEditor.fill("我的风格组合要求")
    expect(await selected("我的风格组合要求").getAttribute("aria-pressed")).toBe("true")
    expect(await draft().inputValue()).toBe("我的风格组合要求")
    await selected("我的风格组合要求").click()
    expect(await draft().inputValue()).toBe("")
    expect(await latest().locator(".synopsis-choice-item svg.lucide-send").count()).toBe(0)
    expect(await sent()).toEqual([])
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
  })

  it("keeps edited workflow confirmation text visible and sends it only on explicit submit", async () => {
    await selected("调用正文推演工具").click()
    await edit("调用正文推演工具").click()
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("保留细纲，并加入雨夜氛围")
    expect(await draft().inputValue()).toBe("按细纲写正文\n保留细纲，并加入雨夜氛围")
    expect(await sent()).toEqual([])
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
    await page.getByTestId("creation-desk-send").click()
    expect((await sent())[0]).toMatchObject({ message: "按细纲写正文\n保留细纲，并加入雨夜氛围", options: { setupAnswerTo: "question-1" } })
    expect(await page.evaluate(() => window.choiceFixture.actions)).toEqual([])
    await selected("确认梗概").click()
    await edit("确认梗概").click()
    await latest().getByRole("textbox", { name: "编辑用户选项内容" }).fill("细纲里加强角色动机")
    expect(await draft().inputValue()).toBe("用这份梗概写细纲\n细纲里加强角色动机")
    await selected("细纲里加强角色动机").click()
    expect(await draft().inputValue()).toBe("")
  })

  it("resets selection ownership on restore/scope changes and keeps the existing action visibility guards", async () => {
    await selected("方向 A").click()
    await page.evaluate(() => { window.choiceFixture.restore("方向 A"); })
    await expect.poll(() => selected("方向 A").getAttribute("aria-pressed")).toBe("false")
    await selected("方向 A").click()
    await selected("方向 A").click()
    expect(await draft().inputValue()).toBe("方向 A")
    await page.evaluate(() => { window.choiceFixture.configure({ busy: true }); })
    await expect.poll(() => selected("方向 A").isDisabled()).toBe(true)
    expect(await draft().isDisabled()).toBe(true)
    await page.evaluate(() => { window.choiceFixture.configure({ busy: false, focusLocked: true, chapterWorkflowEnabled: false }); })
    await expect.poll(() => latest().getByRole("button", { name: "切换到第2章", exact: true }).count()).toBe(0)
    expect(await latest().getByRole("button", { name: "调用正文推演工具", exact: true }).count()).toBe(0)
    await selected("方向 B").click()
    await page.evaluate(() => { window.choiceFixture.configure({ sessionId: "session-2" }); })
    await expect.poll(() => selected("方向 B").getAttribute("aria-pressed")).toBe("false")
    expect(await draft().inputValue()).toBe("")
    expect(await sent()).toEqual([])
  })
})
