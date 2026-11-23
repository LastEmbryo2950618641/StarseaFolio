import { joinWorkspacePath } from "../projects/book-path.js"

/** 共享给所有作品的描写/笔风规则目录；这些文件不在项目工作区内。 */
const SHARED_PRESENTATION_RULE_PREFIXES = [
  "表现输出/描写规则/",
  "表现输出/笔风规则/",
] as const

export function isSharedPresentationRulePath(path: string): boolean {
  return SHARED_PRESENTATION_RULE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** 把工作区相对路径还原成可在资源管理器/其他工具里直接使用的绝对路径。 */
export function resolveWorkspaceAbsolutePath(
  relativePath: string,
  roots: Readonly<{ workspaceRootRef: string; sharedPresentationRoot?: string | undefined }>,
): string {
  const root = isSharedPresentationRulePath(relativePath)
    ? roots.sharedPresentationRoot ?? roots.workspaceRootRef
    : roots.workspaceRootRef
  return joinWorkspacePath(root, relativePath)
}
