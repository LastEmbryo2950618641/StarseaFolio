import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { emptyCharacterProfile, formatCharacterProfile } from "@starseafolio/contracts"
import { CharacterInfoPanel } from "../src/features/editor/CharacterInfoPanel.js"

describe("character information panel", () => {
  it("defaults to a readable character profile without exposing editing controls or the JSON envelope", () => {
    const profile = emptyCharacterProfile("林照")
    profile.fields.人物关系 = [{ 姓名: "沈砚", 关系: "同门" }]
    profile.fields.所属阵营 = "观星社"
    const html = renderToStaticMarkup(React.createElement(CharacterInfoPanel, { content: formatCharacterProfile(profile), readOnly: false, onContentChange() {} }))
    expect(html).toContain("林照")
    expect(html).toContain("所属阵营")
    expect(html).toContain("同门")
    expect(html).toContain('aria-label="编辑 姓名"')
    expect(html).toContain('aria-label="编辑 所属阵营"')
    expect(html).toContain('aria-label="编辑 人物关系 1 关系"')
    expect(html).not.toContain("编辑资料")
    expect(html).not.toContain("返回预览")
    expect(html).toContain("人物内核")
    expect(html).toContain("能力与关系")
    expect(html).not.toContain("<textarea")
    expect(html).not.toContain("<input")
    expect(html).not.toContain("删除字段")
    expect(html).not.toContain("新增字段名称")
    expect(html).not.toContain("schemaVersion")
    expect(html).not.toContain("monaco")
  })
  it("keeps malformed files intact and removes editing controls in readonly mode", () => {
    const invalid = renderToStaticMarkup(React.createElement(CharacterInfoPanel, { content: "{", readOnly: false, onContentChange() {} }))
    expect(invalid).toContain('role="alert"')
    expect(invalid).not.toContain("textarea")
    const readonly = renderToStaticMarkup(React.createElement(CharacterInfoPanel, { content: formatCharacterProfile(emptyCharacterProfile("林照")), readOnly: true, onContentChange() {} }))
    expect(readonly).not.toContain("新增字段名称")
    expect(readonly).not.toContain("删除字段")
    expect(readonly).not.toContain("编辑资料")
    expect(readonly).not.toContain('aria-label="编辑 ')
    expect(readonly).not.toContain("<textarea")
    expect(readonly).not.toContain("<input")
  })
  it("displays nested objects, lists, booleans, zero and empty values as text", () => {
    const profile = emptyCharacterProfile("林照")
    profile.fields.能力 = { 修剑: "修复旧剑", 招式: ["劈刺", "格挡"] }
    profile.fields.已觉醒 = false
    profile.fields.修为 = 0
    profile.fields.待定信息 = null
    const html = renderToStaticMarkup(React.createElement(CharacterInfoPanel, { content: formatCharacterProfile(profile), readOnly: false, onContentChange() {} }))
    for (const text of ["修剑", "修复旧剑", "劈刺", "格挡", "已觉醒", "否", "修为", ">0<", "未填写"]) expect(html).toContain(text)
    expect(html).not.toContain("[object Object]")
    expect(html).not.toContain("<textarea")
  })
})
