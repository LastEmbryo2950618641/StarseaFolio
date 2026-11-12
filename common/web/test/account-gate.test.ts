import { createServer, type Server } from "node:http"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createAccountGate } from "../server/account-gate.mjs"

const avatar = "data:image/png;base64,aaaa"
const serviceToken = "service-token"

describe("web account gate", () => {
  let directory: string | undefined
  let upstreamServer: Server | undefined
  let gateServer: Server | undefined

  afterEach(async () => {
    await close(gateServer)
    await close(upstreamServer)
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    directory = undefined
    upstreamServer = undefined
    gateServer = undefined
  })

  it("keeps each account inside its own books and profiles", async () => {
    directory = await mkdtemp(join(tmpdir(), "starsea-gate-"))
    const accountsFile = join(directory, "web-accounts.json")
    let ownedRoot = ""
    let upstreamCalls = 0
    let lastAuthorization = ""
    upstreamServer = createServer((req, res) => {
      upstreamCalls += 1
      lastAuthorization = typeof req.headers.authorization === "string" ? req.headers.authorization : ""
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => { chunks.push(chunk) })
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8")
        const request = body.length === 0 ? {} : JSON.parse(body) as { requestId?: string, method?: string }
        const projects = [
          { projectId: "00000000-0000-4000-8000-000000000001", displayName: "mine", workspaceRootRef: join(ownedRoot, "amber"), lastOpenedAtMs: 1 },
          { projectId: "00000000-0000-4000-8000-000000000002", displayName: "other", workspaceRootRef: join(directory ?? "", "other-book"), lastOpenedAtMs: 1 },
        ]
        const data = request.method === "project.list" ? { projects } : { echoed: true }
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ protocolVersion: "worldseed.v1", requestId: request.requestId, ok: true, data }))
      })
    })
    const upstreamPort = await listen(upstreamServer)
    const gate = createAccountGate({
      accountsFile,
      booksRoot: directory,
      upstream: `http://127.0.0.1:${upstreamPort}`,
      serviceToken,
    }) as { server: Server, captchas: { codeFor: (id: string) => string | undefined } }
    gateServer = gate.server
    const port = await listen(gateServer)
    const base = `http://127.0.0.1:${port}`

    const issued = async (): Promise<{ id: string, code: string }> => {
      const body = await (await fetch(`${base}/auth/captcha`)).json() as { id: string }
      const code = gate.captchas.codeFor(body.id)
      if (code === undefined) throw new Error("missing captcha")
      return { id: body.id, code }
    }
    const login = async (account: string, password: string, captcha: { id: string, code: string }): Promise<Response> => fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, password, captchaId: captcha.id, captchaCode: captcha.code, avatarDataUrl: avatar }),
    })

    const wrongCaptcha = await issued()
    const rejectedCaptcha = await login("星海", "secret12", { ...wrongCaptcha, code: "ZZZZ" })
    expect(rejectedCaptcha.status).toBe(400)
    expect(await rejectedCaptcha.json()).toMatchObject({ error: "验证码不正确" })

    const captcha = await issued()
    const createdResponse = await login("星海", "secret12", captcha)
    const created = await createdResponse.json() as { created: boolean, apiToken: string, accountId: string, booksRoot: string, accountName: string }
    expect(createdResponse.status).toBe(200)
    expect(created.created).toBe(true)
    expect(created.accountName).toBe("星海")
    ownedRoot = created.booksRoot
    await access(ownedRoot)
    expect((await login("星海", "secret12", captcha)).status).toBe(400)
    expect(await (await login("星海", "nope123", await issued())).json()).toMatchObject({ error: "密码不正确" })

    const callsBeforeList = upstreamCalls
    const listed = await (await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${created.apiToken}` },
      body: JSON.stringify({ protocolVersion: "worldseed.v1", requestId: crypto.randomUUID(), method: "project.list", payload: {} }),
    })).json() as { ok: boolean, data: { projects: { displayName: string }[] } }
    expect(lastAuthorization).toBe(`Bearer ${serviceToken}`)
    expect(upstreamCalls).toBe(callsBeforeList + 1)
    expect(listed.data.projects.map((project) => project.displayName)).toEqual(["mine"])

    const callsBeforeReject = upstreamCalls
    const forbidden = await (await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${created.apiToken}` },
      body: JSON.stringify({
        protocolVersion: "worldseed.v1",
        requestId: crypto.randomUUID(),
        method: "project.create",
        payload: { workspaceRootRef: join(directory, "other-book") },
      }),
    })).json() as { ok: boolean, error: { message: string } }
    expect(forbidden.ok).toBe(false)
    expect(forbidden.error.message).toBe("书籍路径不属于当前账户")
    expect(upstreamCalls).toBe(callsBeforeReject)

    const shared = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ protocolVersion: "worldseed.v1", requestId: crypto.randomUUID(), method: "project.list", payload: {} }),
    })
    expect(shared.status).toBe(401)
    expect(upstreamCalls).toBe(callsBeforeReject)

    const saved = await (await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${created.apiToken}` },
      body: JSON.stringify({
        protocolVersion: "worldseed.v1",
        requestId: crypto.randomUUID(),
        method: "model.profiles.save",
        payload: { profiles: [{ id: "deepseek", name: "Private", apiKey: "should-not-store" }], activeProfileId: "deepseek" },
      }),
    })).json() as { ok: boolean, data: { profiles: { name: string, apiKey?: string }[] } }
    expect(saved.ok).toBe(true)
    expect(saved.data.profiles[0]).toMatchObject({ name: "Private" })
    expect(saved.data.profiles[0]?.apiKey).toBeUndefined()
    expect(upstreamCalls).toBe(callsBeforeReject)
    expect(await readFile(accountsFile, "utf8")).not.toContain("should-not-store")

    const other = await (await login("海星", "secret12", await issued())).json() as { apiToken: string }
    const otherProfiles = await (await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${other.apiToken}` },
      body: JSON.stringify({ protocolVersion: "worldseed.v1", requestId: crypto.randomUUID(), method: "model.profiles.read", payload: {} }),
    })).json() as { data: { profiles: { name: string }[] } }
    expect(otherProfiles.data.profiles[0]?.name).toBe("DeepSeek")
    expect(upstreamCalls).toBe(callsBeforeReject)
  }, 20_000)
})

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("missing port")
  return address.port
}

async function close(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve() })
  })
}
