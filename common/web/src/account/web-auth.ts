import { clearWebSession, saveWebSession, type WebSession } from "../bridge/session.js"

export type CaptchaChallenge = Readonly<{ id: string, image: string }>

export type LoginInput = Readonly<{
  apiBaseUrl: string
  account: string
  password: string
  captchaId: string
  captchaCode: string
  avatarDataUrl: string
}>

export async function fetchCaptcha(apiBaseUrl: string): Promise<CaptchaChallenge> {
  const response = await request(`${trimBase(apiBaseUrl)}/auth/captcha`)
  const body = await readBody(response)
  if (!response.ok || !isCaptcha(body)) throw new Error(messageFrom(body, "验证码获取失败"))
  return body
}

export async function loginWebAccount(input: LoginInput): Promise<WebSession> {
  const response = await request(`${trimBase(input.apiBaseUrl)}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account: input.account,
      password: input.password,
      captchaId: input.captchaId,
      captchaCode: input.captchaCode,
      avatarDataUrl: input.avatarDataUrl,
    }),
  })
  const body = await readBody(response)
  if (!response.ok || !isLoginResult(body)) throw new Error(messageFrom(body, "登录失败"))
  const session: WebSession = {
    apiBaseUrl: trimBase(input.apiBaseUrl),
    apiToken: body.apiToken,
    accountId: body.accountId,
    accountName: body.accountName,
    avatarDataUrl: body.avatarDataUrl,
    booksRoot: body.booksRoot,
  }
  saveWebSession(session)
  return session
}

export async function logoutWebAccount(session: WebSession): Promise<void> {
  try {
    if (session.apiToken.trim().length > 0) {
      await fetch(`${trimBase(session.apiBaseUrl)}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.apiToken}` },
      })
    }
  } catch {
    // Local sign-out still proceeds when the account service is unreachable.
  }
  clearWebSession()
  window.location.reload()
}

function trimBase(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/u, "")
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new Error("无法连接账户服务")
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(response.ok ? "服务器响应无效" : "无法连接账户服务")
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.trim().length > 0) {
    return body.error
  }
  return fallback
}

function isCaptcha(body: unknown): body is CaptchaChallenge {
  return body !== null && typeof body === "object"
    && "id" in body && typeof body.id === "string"
    && "image" in body && typeof body.image === "string"
    && body.image.startsWith("data:image/")
}

function isLoginResult(body: unknown): body is Readonly<{
  apiToken: string
  accountId: string
  accountName: string
  avatarDataUrl: string
  booksRoot: string
}> {
  if (body === null || typeof body !== "object") return false
  const record = body as Record<string, unknown>
  return typeof record.apiToken === "string" && record.apiToken.length >= 20
    && typeof record.accountId === "string" && /^[0-9a-f]{16}$/u.test(record.accountId)
    && typeof record.accountName === "string" && record.accountName.length > 0
    && typeof record.avatarDataUrl === "string" && record.avatarDataUrl.startsWith("data:image/")
    && typeof record.booksRoot === "string"
    && record.booksRoot.startsWith("/")
    && record.booksRoot.includes(`/accounts/${record.accountId}`)
    && !record.booksRoot.includes("..")
}
