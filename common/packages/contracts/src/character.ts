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
