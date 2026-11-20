import { loadWebSession } from "./session.js"

const namespace = "worldseed.account-storage.v1"

function accountPrefix(): string {
  const session = loadWebSession()
  const owner = session.accountId ?? (session.offlinePreview === true ? "android-preview" : "signed-out")
  return `${namespace}.${encodeURIComponent(session.apiBaseUrl)}.${owner}.`
}

export function scopeWebAccountStorage(): void {
  const prefix = accountPrefix()
  if ((globalThis as typeof globalThis & { __worldseedAccountStorageScoped?: boolean }).__worldseedAccountStorageScoped) return
  const originalSetItem = Storage.prototype.setItem
  const originalGetItem = Storage.prototype.getItem
  const originalRemoveItem = Storage.prototype.removeItem
  const originalKey = Storage.prototype.key
  const nativeLength = Object.getOwnPropertyDescriptor(Storage.prototype, "length")?.get
  if (nativeLength === undefined) return

  const scopedKey = (key: string): string => key === "worldseed.web.session.v1" ? key : `${prefix}${key}`

  Storage.prototype.setItem = function (key: string, value: string): void {
    originalSetItem.call(this, scopedKey(key), value)
  }
  Storage.prototype.getItem = function (key: string): string | null {
    return originalGetItem.call(this, scopedKey(key))
  }
  Storage.prototype.removeItem = function (key: string): void {
    originalRemoveItem.call(this, scopedKey(key))
  }
  Storage.prototype.key = function (index: number): string | null {
    const matching: string[] = []
    for (let current = 0; current < nativeLength.call(this); current += 1) {
      const key = originalKey.call(this, current)
      if (key?.startsWith(prefix)) matching.push(key.slice(prefix.length))
    }
    return matching[index] ?? null
  }
  Object.defineProperty(Storage.prototype, "length", {
    configurable: true,
    get() {
      let count = 0
      for (let index = 0; index < nativeLength.call(this); index += 1) {
        if (originalKey.call(this, index)?.startsWith(prefix)) count += 1
      }
      return count
    },
  })
  ;(globalThis as typeof globalThis & { __worldseedAccountStorageScoped?: boolean }).__worldseedAccountStorageScoped = true
}
