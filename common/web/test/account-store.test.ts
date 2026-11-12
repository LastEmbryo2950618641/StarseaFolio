import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  accountIdFor,
  booksRootFor,
  createAccountStore,
  filterAccountProjects,
  hashPassword,
  isInsideRoot,
  pathOutsideAccount,
  verifyPassword,
} from "../server/account-store.mjs"

const avatar = "data:image/png;base64,aaaa"

describe("web account store", () => {
  it("keeps book paths inside one account and checks passwords without storing them", async () => {
    const parent = resolve(tmpdir(), "starsea-account-root")
    const root = booksRootFor(parent, "abc")
    expect(isInsideRoot(root, join(root, "amber-book"))).toBe(true)
    expect(isInsideRoot(root, join(root, "..", "other"))).toBe(false)
    expect(isInsideRoot(root, join(parent, "accounts", "abc-evil"))).toBe(false)
    expect(pathOutsideAccount(parent, "abc", { nested: { workspaceRootRef: join(root, "book") } })).toBeUndefined()
    expect(pathOutsideAccount(parent, "abc", { sourcePaths: [join(parent, "notes.md")] })).toBe(join(parent, "notes.md"))
    expect(filterAccountProjects(parent, "abc", {
      projects: [
        { workspaceRootRef: join(root, "mine") },
        { workspaceRootRef: join(parent, "shared") },
      ],
    }).projects).toEqual([{ workspaceRootRef: join(root, "mine") }])

    expect(() => accountIdFor("a")).toThrow(/账户名/)
    expect(accountIdFor("星海")).toMatch(/^[0-9a-f]{16}$/u)
    const hashed = hashPassword("secret12")
    expect(verifyPassword("secret12", hashed)).toBe(true)
    expect(verifyPassword("secret13", hashed)).toBe(false)

    const directory = await mkdtemp(join(tmpdir(), "starsea-accounts-"))
    try {
      const store = createAccountStore(join(directory, "accounts.json"))
      const created = await store.login({ account: "星海", password: "secret12", avatarDataUrl: avatar, booksRoot: directory })
      const again = await store.login({ account: "星海", password: "secret12", avatarDataUrl: "data:image/svg+xml;charset=utf-8,bbb", booksRoot: directory })
      expect(created.created).toBe(true)
      expect(again.created).toBe(false)
      expect(again.accountId).toBe(created.accountId)
      expect(again.avatarDataUrl).toContain("svg")
      await expect(store.login({ account: "星海", password: "nope123", avatarDataUrl: avatar, booksRoot: directory })).rejects.toThrow("密码不正确")
      expect((await store.sessionForToken(created.apiToken))?.accountId).toBe(created.accountId)
      expect(await store.sessionForToken("not-a-real-session-token")).toBeUndefined()
      const disk = await readFile(join(directory, "accounts.json"), "utf8")
      expect(disk).not.toContain("secret12")
      expect(disk).not.toContain(created.apiToken)
      const saved = await store.saveProfiles(created.accountId, {
        profiles: [{ id: "deepseek", name: "DeepSeek", apiKey: "should-not-store" }],
        activeProfileId: "deepseek",
      })
      expect(saved.profiles[0]?.apiKey).toBeUndefined()
      expect(await readFile(join(directory, "accounts.json"), "utf8")).not.toContain("should-not-store")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
