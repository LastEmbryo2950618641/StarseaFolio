import { creationDeskSettingsUpdateSchema, type CreationDeskSettingsUpdate } from "@starseafolio/contracts"

import { ComposeProtocolError } from "./compose-artifact.js"
import { extractBlock } from "./creative-setup-output.js"

const open = "<writing-settings>"
const close = "</writing-settings>"
const stringKeys = new Set([
  "descriptionRulePath", "proseStyleRulePath", "novelMajorCategoryRulePath", "novelSubcategoryRulePath",
  "boundaryPace", "causalityFocus",
])
const numberKeys = new Set(["minimumWordCount", "maximumWordCount"])

export function parseComposeWritingSettings(text: string): {
  prose: string
  creationDeskSettings?: CreationDeskSettingsUpdate
} {
  if (!text.includes(open) && !text.includes(close)) return { prose: text }
  const block = extractBlock(text, open, close)
  const entries = new Map<string, string | number>()
  for (const line of block.content.split(/\r?\n/u)) {
    const match = /^([A-Za-z]+):\s*(\S.*)$/u.exec(line.trim())
    const key = match?.[1]
    const value = match?.[2]
    if (key === undefined || value === undefined || entries.has(key)) {
      throw new ComposeProtocolError("写作设置块存在重复字段或无效行。")
    }
    if (stringKeys.has(key)) entries.set(key, value)
    else if (numberKeys.has(key) && /^[1-9]\d*$/u.test(value)) entries.set(key, Number(value))
    else throw new ComposeProtocolError(`写作设置块存在无效字段：${key}`)
  }
  const settings = creationDeskSettingsUpdateSchema.safeParse(Object.fromEntries(entries))
  if (!settings.success) throw new ComposeProtocolError("写作设置块未通过字段校验。")
  return { prose: `${block.before}\n${block.after}`, creationDeskSettings: settings.data }
}
