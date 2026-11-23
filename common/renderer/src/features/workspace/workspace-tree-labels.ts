/**
 * 工作目录树的显示名映射表。
 *
 * 只影响左侧树的界面展示，落盘与读写仍然使用真实文件名；新增基础规则文档时
 * 在这里补一行即可。键为工作区相对路径，值为给作者看的中文用途名。
 */
export const BASE_RULE_FILE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "世界推演规则/基础规则/base-rules.md": "基础规则",
  "世界推演规则/基础规则/content-handling.md": "内容处理规则",
  "世界推演规则/基础规则/webnovel-prose-logic.md": "网文行文逻辑",
  "世界推演规则/基础规则/plot-synopsis-guide.md": "剧情梗概指南",
  "世界推演规则/基础规则/user-to-synopsis-guide.md": "用户要求→梗概",
  "世界推演规则/基础规则/synopsis-to-outline-guide.md": "梗概→细纲",
  "世界推演规则/基础规则/outline-to-draft-guide.md": "细纲→正文草稿",
  "世界推演规则/基础规则/settings-query-guide.md": "设定查询规则",
  "世界推演规则/基础规则/settings-revision-guide.md": "设定修订规则",
  "世界推演规则/基础规则/discuss-creation-desk-workflow.md": "创作台讨论工作流",
  "世界推演规则/基础规则/batch-volume-deduction-plan.md": "整卷推演规划",
})

function normalizeTreeLabelPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "")
}

/** 返回树中展示的名称；没有映射时保持真实文件名。 */
export function workspaceTreeLabel(path: string, fileName: string): string {
  return BASE_RULE_FILE_DISPLAY_NAMES[normalizeTreeLabelPath(path)] ?? fileName
}
