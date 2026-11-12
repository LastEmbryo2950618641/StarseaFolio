import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { AccountInputError, booksRootFor, createAccountStore, filterAccountProjects, pathOutsideAccount } from "./account-store.mjs"
import { createCaptchaStore } from "./captcha.mjs"

const PROTOCOL_VERSION = "worldseed.v1"
const FAILURE_WINDOW_MS = 10 * 60 * 1000
const FAILURE_LIMIT = 20
const LOGIN_BODY_LIMIT = 256 * 1024
const RPC_BODY_LIMIT = 8 * 1024 * 1024

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "x-content-type-options": "nosniff",
  })
  res.end(payload)
}

function rpcOk(requestId, data) {
  return { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, data }
}

function rpcFail(requestId, message) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      code: "scope_violation",
      message,
      recoverable: true,
      diagnosticId: randomUUID(),
    },
  }
}

function clientIp(req) {
  const real = req.headers["x-real-ip"]
  if (typeof real === "string" && real.trim().length > 0) return real.trim()
  return req.socket.remoteAddress ?? "local"
}

function bearer(req) {
  const header = req.headers.authorization
  if (typeof header !== "string") return ""
  return /^Bearer\s+(\S+)$/iu.exec(header.trim())?.[1] ?? ""
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new AccountInputError("请求过大", 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function callUpstream({ upstream, serviceToken, method, path, body }) {
  const target = new URL(upstream)
  return new Promise((resolveResponse, reject) => {
    const headers = { authorization: `Bearer ${serviceToken}` }
    if (body.length > 0) {
      headers["content-type"] = "application/json"
      headers["content-length"] = Buffer.byteLength(body)
    }
    const upstreamRequest = httpRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method,
      path,
      headers,
    }, (upstreamResponse) => {
      const chunks = []
      upstreamResponse.on("data", (chunk) => { chunks.push(chunk) })
      upstreamResponse.on("end", () => {
        resolveResponse({
          status: upstreamResponse.statusCode ?? 502,
          contentType: upstreamResponse.headers["content-type"] ?? "application/json; charset=utf-8",
          body: Buffer.concat(chunks),
        })
      })
    })
    upstreamRequest.setTimeout(0)
    upstreamRequest.on("error", reject)
    upstreamRequest.end(body)
  })
}

function writeUpstream(res, result) {
  res.writeHead(result.status, {
    "content-type": result.contentType,
    "cache-control": "no-store",
    "content-length": result.body.length,
    "x-content-type-options": "nosniff",
  })
  res.end(result.body)
}

export function createAccountGate(options) {
  const captchas = options.captchas ?? createCaptchaStore()
  const store = options.store ?? createAccountStore(options.accountsFile)
  const failures = new Map()
  const upstream = new URL(options.upstream)
  if (upstream.protocol !== "http:") throw new Error("account gate upstream must be http")

  const tooManyFailures = (ip) => {
    const now = Date.now()
    const recent = (failures.get(ip) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS)
    failures.set(ip, recent)
    return recent.length >= FAILURE_LIMIT
  }
  const noteFailure = (ip) => {
    const recent = failures.get(ip) ?? []
    recent.push(Date.now())
    failures.set(ip, recent)
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (res.headersSent) return
      if (error instanceof AccountInputError) {
        sendJson(res, error.statusCode, { error: error.message })
        return
      }
      if (error instanceof SyntaxError) {
        sendJson(res, 400, { error: "请求无效" })
        return
      }
      console.error("account-gate", error instanceof Error ? error.message : "failed")
      sendJson(res, 500, { error: "服务暂时不可用" })
    })
  })
  server.requestTimeout = 0
  server.headersTimeout = 60_000

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/auth/health") {
      sendJson(res, 200, { ok: true })
      return
    }
    if (req.method === "GET" && url.pathname === "/auth/captcha") {
      sendJson(res, 200, captchas.issue())
      return
    }
    if (req.method === "GET" && url.pathname === "/health") {
      writeUpstream(res, await callUpstream({
        upstream: options.upstream,
        serviceToken: options.serviceToken,
        method: "GET",
        path: url.pathname,
        body: Buffer.alloc(0),
      }))
      return
    }
    if (req.method === "POST" && url.pathname === "/auth/logout") {
      await store.dropSession(bearer(req))
      res.writeHead(204, { "cache-control": "no-store" })
      res.end()
      return
    }
    if (req.method === "POST" && url.pathname === "/auth/login") {
      await login(req, res)
      return
    }
    if (req.method === "POST" && url.pathname === "/rpc") {
      await rpc(req, res)
      return
    }
    sendJson(res, 404, { error: "not found" })
  }

  async function login(req, res) {
    const ip = clientIp(req)
    if (tooManyFailures(ip)) throw new AccountInputError("尝试过于频繁，请稍后再试", 429)
    const body = JSON.parse((await readBody(req, LOGIN_BODY_LIMIT)).toString("utf8"))
    if (!captchas.take(body?.captchaId, body?.captchaCode)) {
      noteFailure(ip)
      throw new AccountInputError("验证码不正确")
    }
    let result
    try {
      result = await store.login({
        account: body?.account,
        password: body?.password,
        avatarDataUrl: body?.avatarDataUrl,
        booksRoot: options.booksRoot,
      })
    } catch (error) {
      if (error instanceof AccountInputError) noteFailure(ip)
      throw error
    }
    try {
      await mkdir(result.booksRoot, { recursive: true })
    } catch {
      throw new AccountInputError("书籍目录创建失败", 500)
    }
    sendJson(res, 200, result)
  }

  async function rpc(req, res) {
    const token = bearer(req)
    if (token.length === 0 || token === options.serviceToken) {
      sendJson(res, 401, { error: "请先登录" })
      return
    }
    const session = await store.sessionForToken(token)
    if (session === undefined) {
      sendJson(res, 401, { error: "请先登录" })
      return
    }
    const request = JSON.parse((await readBody(req, RPC_BODY_LIMIT)).toString("utf8"))
    if (request === null || typeof request !== "object" || typeof request.method !== "string" || typeof request.requestId !== "string") {
      throw new AccountInputError("请求无效")
    }
    if (request.method === "model.profiles.read") {
      sendJson(res, 200, rpcOk(request.requestId, await store.readProfiles(session.accountId)))
      return
    }
    if (request.method === "model.profiles.save") {
      sendJson(res, 200, rpcOk(request.requestId, await store.saveProfiles(session.accountId, request.payload)))
      return
    }
    if (pathOutsideAccount(options.booksRoot, session.accountId, request.payload) !== undefined) {
      sendJson(res, 200, rpcFail(request.requestId, "书籍路径不属于当前账户"))
      return
    }
    const upstreamResult = await callUpstream({
      upstream: options.upstream,
      serviceToken: options.serviceToken,
      method: "POST",
      path: urlPath(req),
      body: Buffer.from(JSON.stringify(request)),
    })
    if (request.method === "project.list" && upstreamResult.status === 200) {
      try {
        const parsed = JSON.parse(upstreamResult.body.toString("utf8"))
        if (parsed && parsed.ok === true) {
          parsed.data = filterAccountProjects(options.booksRoot, session.accountId, parsed.data)
          upstreamResult.body = Buffer.from(JSON.stringify(parsed))
          upstreamResult.contentType = "application/json; charset=utf-8"
        }
      } catch {
        // Keep the upstream body when it is not the project list envelope.
      }
    }
    writeUpstream(res, upstreamResult)
  }

  return { server, captchas, store }
}

function urlPath(req) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  return `${url.pathname}${url.search}`
}

function runningAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

if (runningAsCli()) {
  const serviceToken = (process.env.WORLDSEED_API_TOKEN ?? "").trim()
  if (serviceToken.length === 0) {
    console.error("account-gate: WORLDSEED_API_TOKEN is missing")
    process.exit(1)
  }
  const { server } = createAccountGate({
    accountsFile: process.env.ACCOUNT_GATE_FILE ?? "/var/lib/worldseed/data/web-accounts.json",
    booksRoot: process.env.ACCOUNT_GATE_BOOKS_ROOT ?? "/var/lib/worldseed/books",
    upstream: process.env.ACCOUNT_GATE_UPSTREAM ?? "http://127.0.0.1:8787",
    serviceToken,
  })
  const port = Number(process.env.ACCOUNT_GATE_PORT ?? 8791)
  server.listen(port, "127.0.0.1", () => {
    console.log(`account-gate listening on 127.0.0.1:${port}`)
  })
}
