function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("starseafolio-book-covers", 1)
    request.onupgradeneeded = () => { request.result.createObjectStore("covers") }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error("无法打开封面存储")) }
  })
}

export async function readBrowserCover(key: string): Promise<string | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("covers").objectStore("covers").get(key)
      request.onsuccess = () => { resolve(typeof request.result === "string" ? request.result : undefined) }
      request.onerror = () => { reject(request.error) }
    })
  } finally { db.close() }
}

export async function saveBrowserCover(key: string, dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) throw new Error("封面必须是图片")
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("covers", "readwrite")
      transaction.objectStore("covers").put(dataUrl, key)
      transaction.oncomplete = () => { resolve() }
      transaction.onabort = transaction.onerror = () => { reject(transaction.error ?? new Error("封面保存失败")) }
    })
    return dataUrl
  } finally { db.close() }
}

export function chooseBrowserImage(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.hidden = true
    document.body.append(input)
    input.addEventListener("cancel", () => { input.remove(); resolve(undefined) }, { once: true })
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      input.remove()
      if (file === undefined) { resolve(undefined); return }
      if (!file.type.startsWith("image/")) { reject(new Error("请选择图片文件")); return }
      const reader = new FileReader()
      reader.onload = () => { resolve(String(reader.result)) }
      reader.onerror = () => { reject(reader.error ?? new Error("图片读取失败")) }
      reader.readAsDataURL(file)
    }, { once: true })
    input.click()
  })
}
