/** Provider-level function tools for discuss native tool calling. */
export const DISCUSS_PROVIDER_TOOL_NAMES = [
  "request_read",
  "character_update",
  "rename_chapter",
  "update_work_metadata",
  "chapter_workflow",
  "publish_draft",
  "restage_chapter",
  "bash",
  "todo_write",
  "memory_write",
  "load_skill",
  "conversation_archive",
  "original_work_search",
  "original_work_download",
] as const

export type DiscussProviderToolName = (typeof DISCUSS_PROVIDER_TOOL_NAMES)[number]

const TOOL_SUMMARIES: Readonly<Record<DiscussProviderToolName, string>> = {
  request_read: "读取讨论所需资料；一次可提交多个读取请求",
  character_update: "人物字段读取或更新",
  rename_chapter: "重命名当前焦点章标题（梗概/细纲/正文同步）",
  update_work_metadata: "更新作品显示名或作品简介",
  chapter_workflow: "正文推演工具：读取、梗概/细纲/草稿与图治理",
  publish_draft: "发布已确认草稿并触发图治理",
  restage_chapter: "回退章节到指定阶段",
  bash: "工作区只读/受限 Bash",
  todo_write: "维护本轮 Todo 清单",
  memory_write: "写入 Agent 记忆索引或主题",
  load_skill: "按需加载平台 Skill",
  conversation_archive: "读取历史会话存档",
  original_work_search: "搜索同人原作资料",
  original_work_download: "下载同人原作章节",
}

export const DISCUSS_PROVIDER_TOOLS = Object.freeze(DISCUSS_PROVIDER_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  function: {
    name,
    description: TOOL_SUMMARIES[name],
    parameters: name === "request_read"
      ? {
          type: "object",
          properties: {
            reads: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                  expectedEvidence: { type: "string" },
                  query: {
                    type: "object",
                    properties: {
                      exactKeys: { type: "array", items: { type: "string" } },
                      semanticTexts: { type: "array", items: { type: "string" } },
                      anchorIds: { type: "array", items: { type: "string" } },
                      directions: { type: "array", items: { type: "string", enum: ["out", "in", "both"] } },
                      maxCandidates: { type: "integer", minimum: 1 },
                      maxDepth: { type: "integer", minimum: 0 },
                      sourceKinds: { type: "array", items: { type: "string", enum: ["graph", "revision", "source", "rule", "reference", "web"] } },
                      conversationArchive: { type: "object", additionalProperties: true },
                      sourceIds: { type: "array", items: { type: "string" } },
                      sourceBoundary: { type: "string", enum: ["start", "end"] },
                      readMode: { type: "string", enum: ["read_full", "list", "grep"] },
                      grepContextLines: { type: "integer", minimum: 0, maximum: 20 },
                      grepMaxMatchesPerFile: { type: "integer", minimum: 1, maximum: 80 },
                      lineStart: { type: "integer", minimum: 1 },
                      lineEnd: { type: "integer", minimum: 1 },
                    },
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
                required: ["reason", "expectedEvidence"],
              },
            },
          },
          required: ["reads"],
          additionalProperties: false,
        }
      : {
          type: "object",
          properties: {
            action: { type: "string", enum: ["describe", "invoke"] },
            arguments: { type: "string", description: "工具参数 JSON 字符串" },
          },
          required: ["action"],
          additionalProperties: false,
        },
  },
})))
