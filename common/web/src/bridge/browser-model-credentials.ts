/** Browser-local credentials, scoped to the connected backend. Never returned to the UI. */
export function browserModelCredentials(scope: string) {
  const key = (reference: string): string => `${scope}\u0000${reference}`
  return {
    get: (reference: string): Promise<string | undefined> => access("readonly", (store) => store.get(key(reference))),
    set: async (reference: string, value: string): Promise<void> => { await access("readwrite", (store) => store.put(value, key(reference))) },
    remove: async (reference: string): Promise<void> => { await access("readwrite", (store) => store.delete(key(reference))) },
  }
}

async function access(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<string | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("starseafolio-model-credentials", 1)
    request.onupgradeneeded = () => { request.result.createObjectStore("credentials") }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(new Error("无法打开本机密钥存储，请检查浏览器存储权限")) }
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("credentials", mode)
      const request = operation(transaction.objectStore("credentials"))
      transaction.oncomplete = () => { resolve(typeof request.result === "string" ? request.result : undefined) }
      transaction.onabort = transaction.onerror = () => { reject(new Error("本机密钥存储失败，请检查浏览器存储权限")) }
    })
  } finally { db.close() }
}
