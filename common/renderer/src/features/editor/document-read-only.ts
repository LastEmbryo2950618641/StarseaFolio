import { isChapterPlanningMarkdownPath } from "./synopsis-path.js"

/**
 * 只有「正式章节正文」在通用编辑器里只读（走章节修订流程）。
 * 提示词、平台规则镜像与普通 Markdown 都可直接编辑；章节梗概/细纲仍可编辑。
 */
export function isWorkspaceDocumentReadOnly(path: string | undefined): boolean {
  return path !== undefined
    && (/^大纲\/[^/]+\.卷状态\.md$/iu.test(path)
      || (path.startsWith("章节正文/") && !isChapterPlanningMarkdownPath(path)))
}
