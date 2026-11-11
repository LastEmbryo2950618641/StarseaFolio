import { mkdir, readdir, readFile, realpath, lstat, rm, unlink, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { CHARACTER_DIRECTORY, CHARACTER_RULE_PATH } from "@starseafolio/contracts"

const writes = new Map<string, Promise<unknown>>()
/** Shell protection and field writes share a project lock, so rollback cannot erase a valid concurrent edit. */
export async function withCharacterWriteLock<T>(rootRef: string, action: () => Promise<T>): Promise<T> {
  const root = (await realpath(rootRef)).toLocaleLowerCase()
  const pending = writes.get(root) ?? Promise.resolve()
  const result = pending.catch(() => undefined).then(action)
  writes.set(root, result)
  try { return await result } finally { if (writes.get(root) === result) writes.delete(root) }
}

type Snapshot = { directories: string[]; files: Map<string, Buffer> }
function inside(root: string, path: string): string {
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("人物保护路径必须位于工作区内")
  return target
}
async function capture(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = { directories: [], files: new Map() }
  const visit = async (path: string): Promise<void> => {
    const absolute = inside(root, path)
    let stat
    try { stat = await lstat(absolute) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error }
    if (stat.isSymbolicLink()) throw new Error("人物目录及规则不能使用符号链接")
    if (stat.isDirectory()) {
      snapshot.directories.push(path)
      for (const child of (await readdir(absolute)).sort()) await visit(`${path}/${child}`)
    } else snapshot.files.set(path, await readFile(absolute))
  }
  await visit(CHARACTER_DIRECTORY)
  await visit(CHARACTER_RULE_PATH)
  return snapshot
}
function equal(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a.directories) === JSON.stringify(b.directories) && a.files.size === b.files.size
    && [...a.files].every(([path, content]) => b.files.get(path)?.equals(content))
}

/** Detect and roll back shell writes to character storage; AI must use structured operations. */
export async function withProtectedCharacterFiles<T>(rootRef: string, action: () => Promise<T>): Promise<T> {
  return withCharacterWriteLock(rootRef, async () => {
    const root = await realpath(rootRef)
    const before = await capture(root)
    let result: T | undefined
    let failed = false
    let failure: unknown
    try { result = await action() } catch (error) { failed = true; failure = error }
    let changed = false
    try { changed = !equal(before, await capture(root)) } catch { changed = true }
    if (changed) {
      // Only these two literal, checked descendants may be removed during rollback.
      for (const path of [CHARACTER_DIRECTORY, CHARACTER_RULE_PATH]) {
        const target = inside(root, path)
        // Refuse to follow a replaced parent directory/junction outside the root.
        const parent = await realpath(resolve(target, "..")).catch(() => root)
        const rel = relative(root, parent)
        if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("人物目录父路径被修改，无法安全恢复")
        const stat = await lstat(target).catch(() => undefined)
        if (stat?.isSymbolicLink()) await unlink(target)
        else await rm(target, { recursive: true, force: true })
      }
      for (const path of before.directories) await mkdir(inside(root, path), { recursive: true })
      for (const [path, content] of before.files) {
        await mkdir(resolve(inside(root, path), ".."), { recursive: true })
        await writeFile(inside(root, path), content)
      }
      throw new Error("禁止直接编辑人物 JSON、移动或删除人物目录。此次变更已恢复，请使用 character_update 字段工具")
    }
    if (failed) throw failure
    return result as T
  })
}
