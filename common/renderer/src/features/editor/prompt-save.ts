import { isPromptPath } from "../workspace/prompt-paths.js"

export type PromptSaveRequest = Readonly<{ path: string; content: string }>

export type SaveWorkspaceFileOptions = Readonly<{
  path: string
  content: string
  /** 仅提示词路径调用：弹窗确认是否写入全局提示词库。 */
  confirmPromptSave(request: PromptSaveRequest): Promise<boolean>
  /** 原保存逻辑（章节模式不经过此入口）。 */
  persist(path: string, content: string): Promise<void>
}>

/**
 * 通用 Markdown 保存编排：提示词路径先确认、确认后才落盘；取消则原地不动。
 * 抽成纯函数以便在没有 DOM 的测试环境里断言调用顺序。
 */
export async function saveWorkspaceFile(options: SaveWorkspaceFileOptions): Promise<"saved" | "cancelled"> {
  if (isPromptPath(options.path)) {
    const confirmed = await options.confirmPromptSave({ path: options.path, content: options.content })
    if (!confirmed) return "cancelled"
  }
  await options.persist(options.path, options.content)
  return "saved"
}
