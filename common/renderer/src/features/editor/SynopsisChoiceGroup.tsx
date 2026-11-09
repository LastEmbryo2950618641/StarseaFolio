import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Pencil, RefreshCw, X } from "lucide-react"
import type { SynopsisConversationChoice, SynopsisConversationMessage } from "@worldseed/contracts"

import { useChoiceComposer } from "./SynopsisChoiceComposerContext.js"
import {
  choiceContribution, choiceIdentity, formatChoiceStyle, loadChoiceVariant, persistChoiceVariant,
  type ChoiceVariant,
} from "./synopsis-choice-state.js"

type ChoiceOption = Readonly<{
  identity: string; label: string; original: string; contribution: string
  command?: string; idea?: true; style?: true
}>

function contributionFor(option: ChoiceOption, variant: ChoiceVariant): string {
  // Keep the exact AI label in the editor; only its unchanged variant uses the protocol wording.
  if (variant.active === "ai" || variant.edited === variant.original) return option.contribution
  // Keep confirmation gates explicit and visible even when the user edits the choice's wording.
  if (option.command !== undefined && variant.edited.trim().length > 0 && !variant.edited.includes(option.command)) {
    return `${option.command}\n${variant.edited}`
  }
  return variant.edited
}

export function SynopsisChoiceGroup(props: Readonly<{
  message: SynopsisConversationMessage
  workspaceRootRef: string | undefined
  choices: readonly SynopsisConversationChoice[]
  disabled: boolean
  refreshing: boolean
  latest: boolean
  novelMajorCategoryRules: readonly string[]
  novelSubcategoryRules: readonly string[]
  proseRules: readonly string[]
  onRefresh(): void
  onFocusComposer(): void
}>): React.JSX.Element {
  const composer = useChoiceComposer()
  const selected = useSyncExternalStore(composer.subscribe, composer.getSelected, composer.getSelected)
  const [variants, setVariants] = useState<Readonly<Record<string, ChoiceVariant>>>({})
  const loadedVariantsRef = useRef(new Map<string, ChoiceVariant>())
  const [editing, setEditing] = useState<string>()
  const [major, setMajor] = useState("")
  const [subcategory, setSubcategory] = useState("")
  const [prose, setProse] = useState("")
  const editorId = useId()
  const options = useMemo(() => {
    const occurrences = new Map<string, number>()
    return props.choices.map((choice): ChoiceOption => {
      const base = choiceIdentity(props.workspaceRootRef, props.message, choice)
      const occurrence = occurrences.get(base) ?? 0
      occurrences.set(base, occurrence + 1)
      return {
        identity: choiceIdentity(props.workspaceRootRef, props.message, choice, occurrence),
        label: choice.action === "start_turn" ? "调用正文推演工具" : choice.label,
        original: choice.label,
        contribution: choiceContribution(choice),
        ...(choice.action === "start_turn" || choice.action === "confirm_synopsis"
          ? { command: choiceContribution(choice) } : {}),
        ...(choice.workStyleSelection === undefined ? {} : { style: true }),
      }
    })
  }, [props.choices, props.message, props.workspaceRootRef])
  const idea: ChoiceOption = {
    identity: choiceIdentity(props.workspaceRootRef, props.message, "your-idea"),
    label: "你的想法", original: "", contribution: "", idea: true,
  }
  const styleText = formatChoiceStyle({
    novelMajorCategoryRulePath: major, novelSubcategoryRulePath: subcategory, proseStyleRulePath: prose,
  })
  const customStyle: ChoiceOption = {
    // Distinct combinations preserve their own immutable originals and edits.
    identity: `${choiceIdentity(props.workspaceRootRef, props.message, "custom-style")}:${JSON.stringify([major, subcategory, prose])}`,
    label: styleText, original: styleText, contribution: styleText, style: true,
  }
  const allOptions = [...options, idea, customStyle]
  const getVariant = (option: ChoiceOption): ChoiceVariant => {
    const cached = variants[option.identity] ?? loadedVariantsRef.current.get(option.identity)
    if (cached !== undefined) return cached
    const loaded = loadChoiceVariant(option.identity, option.original)
    loadedVariantsRef.current.set(option.identity, loaded)
    return loaded
  }
  const updateVariant = (option: ChoiceOption, next: ChoiceVariant): void => {
    setVariants((current) => ({ ...current, [option.identity]: next }))
    persistChoiceVariant(option.identity, next)
    composer.replaceContribution(option.identity, contributionFor(option, next))
  }
  const openEditor = (option: ChoiceOption): void => {
    setEditing(option.identity)
    const current = getVariant(option)
    // Start with the saved user content, retaining the AI original as a separate read-only tab.
    const next: ChoiceVariant = { ...current, active: "user" }
    // Read the live store: clicking an empty idea can select it immediately before opening.
    if (!composer.getSelected().has(option.identity)) {
      composer.toggle(option.identity, contributionFor(option, next))
    }
    updateVariant(option, next)
  }
  const editingOption = allOptions.find((option) => option.identity === editing)
  const editingVariant = editingOption === undefined ? undefined : getVariant(editingOption)
  const renderOption = (option: ChoiceOption): React.JSX.Element => {
    const variant = getVariant(option)
    const label = variant.active === "ai" ? option.label : variant.edited || (option.idea ? "你的想法" : "（空白内容）")
    const pressed = selected.has(option.identity)
    return <div className="synopsis-choice-item" key={option.identity}>
      <button
        type="button"
        className={`synopsis-choice${option.idea ? " synopsis-choice-idea" : ""}${pressed ? " is-selected" : ""}`}
        {...(option.idea ? { "data-testid": "synopsis-choice-your-idea" }
          : option.style ? { "data-testid": "style-choice-use" } : {})}
        aria-pressed={pressed}
        title={pressed ? "取消选择，仅移除此选项填入的内容" : "选择并填入对话框，可多选"}
        disabled={props.disabled}
        onClick={() => {
          composer.toggle(option.identity, contributionFor(option, variant))
          if (option.idea && !pressed && variant.edited.length === 0) openEditor(option)
          else props.onFocusComposer()
        }}
      ><span>{label}</span></button>
      <button
        type="button"
        className="synopsis-choice-edit"
        aria-label={`编辑选项：${label}`}
        aria-expanded={editing === option.identity}
        aria-controls={editing === option.identity ? editorId : undefined}
        disabled={props.disabled}
        onClick={() => { openEditor(option) }}
      ><Pencil size={13} aria-hidden="true" /></button>
    </div>
  }

  return <div className="synopsis-conversation-choices synopsis-choice-group">
    {props.choices.some((choice) => choice.workStyleSelection !== undefined)
      ? <div className="synopsis-style-picker" data-testid="synopsis-style-picker">
          <select aria-label="选择小说大类" data-testid="style-picker-major" value={major} disabled={props.disabled}
            onChange={(event) => { setMajor(event.target.value); setSubcategory(""); setProse("") }}>
            <option value="">选择大类</option>
            {props.novelMajorCategoryRules.map((path) => <option key={path} value={path}>{path.split("/").at(-1)?.replace(/\.md$/u, "")}</option>)}
          </select>
          <select aria-label="选择小说次大类" data-testid="style-picker-subcategory" value={subcategory} disabled={major.length === 0 || props.disabled}
            onChange={(event) => { setSubcategory(event.target.value); setProse("") }}>
            <option value="">选择次大类</option>
            {props.novelSubcategoryRules.map((path) => <option key={path} value={path}>{path.split("/").at(-1)?.replace(/\.md$/u, "")}</option>)}
          </select>
          <select aria-label="选择笔风" data-testid="style-picker-prose" value={prose} disabled={subcategory.length === 0 || props.disabled}
            onChange={(event) => { setProse(event.target.value) }}>
            <option value="">选择笔风</option>
            {props.proseRules.map((path) => <option key={path} value={path}>{path.split("/").at(-1)?.replace(/\.md$/u, "")}</option>)}
          </select>
          <button type="button" className="synopsis-choice synopsis-style-picker-insert" data-testid="style-picker-insert"
            aria-label="编辑风格组合" title="编辑风格组合"
            disabled={!major || !subcategory || !prose || props.disabled}
            onClick={() => { openEditor(customStyle) }}><Pencil size={14} aria-hidden="true" /></button>
          {major && subcategory && prose ? renderOption(customStyle) : null}
        </div> : null}
    {editingOption !== undefined && editingVariant !== undefined
      ? <div className="synopsis-choice-editor" id={editorId} data-testid="synopsis-choice-editor">
          <div className="synopsis-choice-editor-toolbar">
            <div role="tablist" aria-label="选项内容来源">
              {(["ai", "user"] as const).map((tab) => <button
                key={tab} type="button" role="tab" id={`${editorId}-${tab}`} aria-controls={`${editorId}-panel`}
                aria-selected={editingVariant.active === tab} disabled={props.disabled}
                onClick={() => { updateVariant(editingOption, { ...editingVariant, active: tab }) }}
              >{tab === "ai" ? "AI生成" : "用户内容"}</button>)}
            </div>
            <button type="button" className="synopsis-choice-edit" aria-label="关闭选项编辑器" onClick={() => { setEditing(undefined) }}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div role="tabpanel" id={`${editorId}-panel`} aria-labelledby={`${editorId}-${editingVariant.active}`}>
            <textarea
              autoFocus key={editingOption.identity}
              aria-label={editingVariant.active === "ai" ? "AI生成的原始选项" : "编辑用户选项内容"}
              value={editingVariant.active === "ai" ? editingVariant.original : editingVariant.edited}
              readOnly={editingVariant.active === "ai"} disabled={props.disabled} rows={3}
              placeholder={editingOption.idea ? "写下你的想法，会同步到对话框" : undefined}
              onChange={(event) => { updateVariant(editingOption, { ...editingVariant, active: "user", edited: event.target.value }) }}
            />
          </div>
          <p>用户内容自动保存；选择后同步到输入框，点击发送才会提交。</p>
        </div> : null}
    {options.map(renderOption)}
    {renderOption(idea)}
    {props.latest ? <button
      type="button" className={`synopsis-choice-refresh${props.refreshing ? " is-spinning" : ""}`}
      data-testid="synopsis-choice-refresh" title="换一批不同选项" aria-label="换一批不同选项"
      disabled={props.disabled} onClick={props.onRefresh}
    ><RefreshCw size={14} aria-hidden="true" /></button> : null}
  </div>
}
