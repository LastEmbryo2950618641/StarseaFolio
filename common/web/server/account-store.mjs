import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20

export const DEFAULT_MODEL_PROFILES = Object.freeze({
  profiles: Object.freeze([{
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    credentialRef: "model-profile:deepseek",
    apiProtocol: "openai_chat_completions",
    contextWindowTokens: 1_000_000,
    thinkingModeEnabled: true,
    reasoningEffort: "high",
    jsonModeEnabled: false,
    disableResponseStorage: true,
    serviceTier: "auto",
  }]),
  activeProfileId: "deepseek",
})

export class AccountInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = "AccountInputError"
    this.statusCode = statusCode
  }
}

export function normalizeAccountName(name) {
  const trimmed = typeof name === "string" ? name.trim() : ""
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(trimmed)) {
    throw new AccountInputError("账户名需要 2 到 32 位，只能包含字母、数字、下划线或短横线")
  }
  return trimmed
}

export function accountIdFor(name) {
  return createHash("sha256").update(normalizeAccountName(name)).digest("hex").slice(0, 16)
}

export function booksRootFor(booksRoot, accountId) {
  return resolve(booksRoot, "accounts", accountId)
}

export function isInsideRoot(root, target) {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0")) return false
  const base = resolve(root)
  const resolved = resolve(target)
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return resolved === base || resolved.startsWith(prefix)
}

const PATH_KEYS = new Set(["workspaceRootRef", "sourceFolder"])

export function collectGuardedPaths(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectGuardedPaths(item, found)
    return found
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "sourcePaths" && Array.isArray(child)) {
        for (const item of child) if (typeof item === "string") found.push(item)
      } else if (PATH_KEYS.has(key) && typeof child === "string") found.push(child)
      else collectGuardedPaths(child, found)
    }
  }
  return found
}

export function pathOutsideAccount(booksRoot, accountId, payload) {
  const root = booksRootFor(booksRoot, accountId)
  return collectGuardedPaths(payload).find((target) => !isInsideRoot(root, target))
}

export function filterAccountProjects(booksRoot, accountId, data) {
  if (data === null || typeof data !== "object" || !Array.isArray(data.projects)) return data
  const root = booksRootFor(booksRoot, accountId)
  return {
    ...data,
    projects: data.projects.filter((project) => (
      project !== null
      && typeof project === "object"
      && typeof project.workspaceRootRef === "string"
      && isInsideRoot(root, project.workspaceRootRef)
    )),
  }
}

export function hashPassword(password) {
  assertPassword(password)
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`
}

export function verifyPassword(password, stored) {
  const parts = typeof stored === "string" ? stored.split(":") : []
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const salt = Buffer.from(parts[1], "hex")
  const expected = Buffer.from(parts[2], "hex")
  if (salt.length === 0 || expected.length === 0) return false
  const actual = scryptSync(password, salt, expected.length)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 72) {
    throw new AccountInputError("密码需要 6 到 72 位")
  }
}

export function assertAvatar(value) {
  if (typeof value !== "string" || !/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/u.test(value)) {
    throw new AccountInputError("请选择头像")
  }
  if (value.length > 120_000) throw new AccountInputError("头像图片过大，请裁剪后再试")
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex")
}

function liveSessions(sessions) {
  const now = Date.now()
  return Object.fromEntries(Object.entries(sessions ?? {}).filter(([, expiresAt]) => typeof expiresAt === "number" && expiresAt > now))
}

function rememberSession(sessions, token) {
  const next = Object.entries(liveSessions(sessions))
  next.push([hashToken(token), Date.now() + SESSION_TTL_MS])
  next.sort((left, right) => left[1] - right[1])
  while (next.length > MAX_SESSIONS) next.shift()
  return Object.fromEntries(next)
}

function publicProfiles(input) {
  if (input === null || typeof input !== "object" || !Array.isArray(input.profiles)) {
    throw new AccountInputError("模型配置无效")
  }
  if (input.profiles.length === 0 || input.profiles.length > 50 || typeof input.activeProfileId !== "string") {
    throw new AccountInputError("模型配置无效")
  }
  const profiles = input.profiles.map((profile) => {
    if (profile === null || typeof profile !== "object" || typeof profile.id !== "string") {
      throw new AccountInputError("模型配置无效")
    }
    const copy = { ...profile }
    delete copy.apiKey
    delete copy.hasApiKey
    return copy
  })
  if (!profiles.some((profile) => profile.id === input.activeProfileId)) throw new AccountInputError("模型配置无效")
  return { profiles, activeProfileId: input.activeProfileId }
}

async function readState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"))
    return parsed !== null && typeof parsed === "object" && parsed.accounts && typeof parsed.accounts === "object"
      ? parsed
      : { accounts: {} }
  } catch (error) {
    if (error && error.code === "ENOENT") return { accounts: {} }
    throw error
  }
}

async function writeState(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 })
  try {
    await rename(temporary, filePath)
  } catch (error) {
    if (!error || (error.code !== "EEXIST" && error.code !== "EPERM")) throw error
    await rm(filePath, { force: true })
    await rename(temporary, filePath)
  }
}

export function createAccountStore(filePath) {
  let queue = Promise.resolve()
  const enqueue = (task) => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    login(input) {
      return enqueue(async () => {
        const name = normalizeAccountName(input.account)
        assertPassword(input.password)
        assertAvatar(input.avatarDataUrl)
        const accountId = accountIdFor(name)
        const state = await readState(filePath)
        const existing = state.accounts[accountId]
        const created = existing === undefined
        if (!created && !verifyPassword(input.password, existing.passwordHash)) {
          throw new AccountInputError("密码不正确")
        }
        const apiToken = randomBytes(32).toString("base64url")
        state.accounts[accountId] = {
          name,
          passwordHash: created ? hashPassword(input.password) : existing.passwordHash,
          avatarDataUrl: input.avatarDataUrl,
          profiles: created ? structuredClone(DEFAULT_MODEL_PROFILES) : (existing.profiles ?? structuredClone(DEFAULT_MODEL_PROFILES)),
          sessions: rememberSession(existing?.sessions, apiToken),
        }
        await writeState(filePath, state)
        return {
          created,
          apiToken,
          accountId,
          accountName: name,
          avatarDataUrl: input.avatarDataUrl,
          booksRoot: booksRootFor(input.booksRoot, accountId),
        }
      })
    },
    sessionForToken(token) {
      return enqueue(async () => {
        if (typeof token !== "string" || token.length < 20) return undefined
        const state = await readState(filePath)
        const hash = hashToken(token)
        const now = Date.now()
        for (const [accountId, account] of Object.entries(state.accounts)) {
          const expiresAt = account.sessions?.[hash]
          if (typeof expiresAt === "number" && expiresAt > now) {
            return { accountId, accountName: account.name, avatarDataUrl: account.avatarDataUrl }
          }
        }
        return undefined
      })
    },
    dropSession(token) {
      return enqueue(async () => {
        if (typeof token !== "string" || token.length === 0) return
        const state = await readState(filePath)
        const hash = hashToken(token)
        let changed = false
        for (const account of Object.values(state.accounts)) {
          if (account.sessions && Object.prototype.hasOwnProperty.call(account.sessions, hash)) {
            delete account.sessions[hash]
            changed = true
          }
        }
        if (changed) await writeState(filePath, state)
      })
    },
    readProfiles(accountId) {
      return enqueue(async () => {
        const state = await readState(filePath)
        const account = state.accounts[accountId]
        if (account === undefined) throw new Error("账户不存在")
        if (account.profiles === undefined) {
          account.profiles = structuredClone(DEFAULT_MODEL_PROFILES)
          await writeState(filePath, state)
        }
        return structuredClone(account.profiles)
      })
    },
    saveProfiles(accountId, profiles) {
      return enqueue(async () => {
        const state = await readState(filePath)
        const account = state.accounts[accountId]
        if (account === undefined) throw new Error("账户不存在")
        account.profiles = publicProfiles(profiles)
        await writeState(filePath, state)
        return structuredClone(account.profiles)
      })
    },
  }
}
