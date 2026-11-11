import { z } from "zod"

export const CHARACTER_DIRECTORY = "设定集/人物"
export const CHARACTER_RULE_PATH = "世界推演规则/人物设定.md"

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) < 32) return true
  return false
}

export function isCharacterProfilePath(path: string): boolean {
  return /^设定集\/人物\/[^/\\<>:"|?*]+\.json$/u.test(path) && !hasControlCharacters(path)
    && !path.split("/").some(part => part === "." || part === ".." || part.endsWith(" "))
}

export type CharacterFieldValue = string | number | boolean | null | CharacterFieldValue[] | { [key: string]: CharacterFieldValue }
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"])
export const characterFieldNameSchema = z.string().min(1).max(100)
  .refine(value => value === value.trim() && !forbiddenKeys.has(value) && !hasControlCharacters(value), "非法人物字段名")
export const characterFieldValueSchema: z.ZodType<CharacterFieldValue> = z.lazy(() => z.union([
  z.string().max(100_000), z.number(), z.boolean(), z.null(),
  z.array(characterFieldValueSchema).max(1000),
  z.record(characterFieldNameSchema, characterFieldValueSchema),
]))
export const characterProfileSchema = z.object({
  schemaVersion: z.literal(1),
  fields: z.record(characterFieldNameSchema, characterFieldValueSchema).refine(fields => Object.keys(fields).length <= 200, "人物字段不能超过200项"),
}).strict()
export type CharacterProfile = z.infer<typeof characterProfileSchema>

export const characterFieldOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), field: characterFieldNameSchema, value: characterFieldValueSchema }).strict(),
  z.object({ op: z.literal("delete"), field: characterFieldNameSchema }).strict(),
])
export const characterUpdateSchema = z.object({
  relativePath: z.string().refine(isCharacterProfilePath, "人物必须位于设定集/人物下，一人一个 .json 文件"),
  mode: z.enum(["create", "update"]),
  operations: z.array(characterFieldOperationSchema).min(1).max(200),
  /** Optional optimistic lock. Stale editors must not overwrite AI changes. */
  expectedContent: z.string().optional(),
}).strict()
export type CharacterUpdate = z.infer<typeof characterUpdateSchema>

export const CHARACTER_DEFAULT_FIELDS = ["姓名", "身份", "性格爱好", "样貌", "年龄", "身世背景", "目标", "能力", "人物关系", "其他信息", "备注"] as const
export function emptyCharacterProfile(name: string): CharacterProfile {
  return { schemaVersion: 1, fields: Object.fromEntries(CHARACTER_DEFAULT_FIELDS.map(key => [key, key === "姓名" ? name : ""])) }
}
export function parseCharacterProfile(content: string): CharacterProfile {
  if (content.length > 1_000_000) throw new Error("人物资料过大，请拆分为独立人物")
  return characterProfileSchema.parse(JSON.parse(content))
}
export function formatCharacterProfile(profile: CharacterProfile): string {
  return JSON.stringify(characterProfileSchema.parse(profile), null, 2) + "\n"
}
export function applyCharacterFieldOperations(profile: CharacterProfile, operations: CharacterUpdate["operations"]): CharacterProfile {
  const fields = { ...characterProfileSchema.parse(profile).fields }
  for (const operation of z.array(characterFieldOperationSchema).min(1).max(200).parse(operations)) {
    if (operation.op === "delete") Reflect.deleteProperty(fields, operation.field)
    else fields[operation.field] = operation.value
  }
  return characterProfileSchema.parse({ schemaVersion: 1, fields })
}

export const CHARACTER_GUIDE = `# 人物设定

## 存放与结构
设定集/人物 是固定目录，不能改名或删除。每人一个 JSON，文件名使用人物名（主角访谈使用 主角.json），不要为同一人物重复建档。旧 Markdown 仅供兼容阅读；新增人物不得使用 Markdown。
JSON 外层固定为 schemaVersion: 1 与 fields 对象。程序以两个空格缩进格式化保存，禁止通过 workspace.save、stagingPromote、文本替换、bash 或脚本直接编辑 JSON。

推荐 fields 字段：姓名、身份、性格爱好、样貌、年龄、身世背景、目标、能力、人物关系、其他信息、备注。未确定值留空，不编造已确认事实。年龄可用字符串表达；关系可为对象或列表。
允许根据剧情新增、删除、更改 fields 内的字段，包括自定义字段，值可为字符串、数字、布尔值、null、数组或对象。不允许变更外层结构或 schemaVersion。

## AI 操作
先读取已有 JSON 与本规则。使用 character_update 工具：首次 describe 获取参数，然后 invoke。创建 mode=create，更新 mode=update；relativePath 为 设定集/人物/姓名.json；operations 为字段操作列表。
set 操作示例：{"op":"set","field":"所属阵营","value":"观星社"}；delete 操作示例：{"op":"delete","field":"旧称号"}。不传完整 JSON 文本，不使用 markdown 参数。修改嵌套资料时先读取该字段，再仅提交该字段的新值；保留其他内容。读取结果中的 content 可作为 expectedContent 防止并发覆盖。
用户已确认的主角核心、已发布正文事实及原作证据优先；不得擅自覆盖。新增角色准备与后续修订都使用此工具，工具实际成功后才宣布写入。
`
