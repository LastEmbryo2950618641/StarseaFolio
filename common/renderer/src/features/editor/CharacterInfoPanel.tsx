import { useLayoutEffect, useRef, useState } from "react"
import { Check, Pencil, Plus, Trash2, UserRound, X } from "lucide-react"
import { characterFieldNameSchema, formatCharacterProfile, parseCharacterProfile, type CharacterFieldValue } from "@starseafolio/contracts"
import "./character-info.css"

type Props = { content: string; readOnly: boolean; onContentChange: (content: string) => void }

/** Field controls never expose the document envelope or editable JSON source. */
export function CharacterInfoPanel({ content, readOnly, onContentChange }: Props): React.JSX.Element {
  const [error, setError] = useState("")
  let profile
  try { profile = parseCharacterProfile(content) } catch {
    return <div className="character-info-panel" role="alert">人物资料格式不合法，已阻止编辑以保护原数据。请恢复有效的人物资料版本。</div>
  }
  const update = (field: string, value: CharacterFieldValue): boolean => {
    try {
      onContentChange(formatCharacterProfile({ ...profile, fields: { ...profile.fields, [field]: value } }))
      setError("")
      return true
    } catch { setError("字段内容过大或格式不合法，未覆盖原资料"); return false }
  }
  const remove = (field: string): void => {
    const fields = { ...profile.fields }
    Reflect.deleteProperty(fields, field)
    onContentChange(formatCharacterProfile({ ...profile, fields }))
  }
  const field = (key: string, variant?: string): React.JSX.Element => <InlineField key={key} label={key} value={profile.fields[key] ?? null}
    variant={variant} onApply={readOnly ? undefined : next => update(key, next)} onDelete={readOnly ? undefined : () => { remove(key) }} />
  const select = (keys: readonly string[]) => keys.filter(key => Object.hasOwn(profile.fields, key))
  const additional = Object.keys(profile.fields).filter(key => !groupedFields.has(key))
  return <section className="character-info-panel" aria-label="人物信息" data-testid="character-info-panel">
    <div className="character-sheet">
      <header className="character-profile-header">
        <div className="character-profile-avatar" aria-hidden="true"><UserRound size={28} strokeWidth={1.7} /></div>
        <div className="character-profile-heading"><span className="character-profile-eyebrow">人物档案</span>{field("姓名", "name")}{field("身份", "identity")}</div>
      </header>
      <div className="character-read-view">
        {select(basicFields).length ? <div className="character-profile-facts">{select(basicFields).map(key => field(key))}</div> : null}
        <ReadSection title="人物内核" keys={select(coreFields)} renderField={field} />
        <ReadSection title="能力与关系" keys={select(connectionFields)} renderField={field} />
        <ReadSection title="补充资料" keys={additional} renderField={field} />
      </div>
      {readOnly ? null : <AddFieldControl label="人物" existingKeys={Object.keys(profile.fields)} onAdd={update} />}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </section>
}

const basicFields = ["年龄", "性别", "别称"]
const coreFields = ["性格爱好", "样貌", "身世背景", "目标"]
const connectionFields = ["能力", "人物关系"]
const groupedFields = new Set(["姓名", "身份", ...basicFields, ...coreFields, ...connectionFields])

function ReadSection({ title, keys, renderField }: {
  title: string; keys: string[]; renderField: (key: string) => React.JSX.Element
}): React.JSX.Element | null {
  if (keys.length === 0) return null
  return <section className="character-read-section" aria-label={title}>
    <h3>{title}</h3><div className="character-read-entries">{keys.map(key => renderField(key))}</div>
  </section>
}

function InlineField({ label, displayLabel = label, value, onApply, onDelete, variant = "" }: {
  label: string; displayLabel?: string; value: CharacterFieldValue; variant?: string | undefined
  onApply?: ((next: CharacterFieldValue) => boolean) | undefined; onDelete?: (() => void) | undefined
}): React.JSX.Element {
  const [draft, setDraft] = useState<CharacterFieldValue>(value)
  const [original, setOriginal] = useState("")
  const [editing, setEditing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const active = editing && !!onApply
  const finish = (): void => {
    if (JSON.stringify(value) !== original) { setConflict(true); return }
    if (onApply?.(draft)) { setEditing(false); setConflict(false) }
  }
  return <div className={`character-inline-field${variant ? ` is-${variant}` : ""}${active ? " is-editing" : ""}`} data-character-field={label}>
    <div className="character-inline-label"><span>{displayLabel}</span>{!onApply || active ? null : <button className="character-pencil" type="button" title={`编辑${displayLabel}`} aria-label={`编辑 ${label}`} onClick={() => {
      setDraft(value); setOriginal(JSON.stringify(value)); setConflict(false); setEditing(true)
    }}><Pencil size={13} /></button>}</div>
    <div className="character-inline-content">{active ? <div className="character-inline-editor" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(false) } }}>
      <FieldValueEditor label={label} value={draft} onChange={setDraft} />
      {conflict ? <p role="alert">此项资料已更新，请取消后重新编辑，避免覆盖新内容。</p> : null}
      <div className="character-inline-actions">
        <button className="character-apply" type="button" onClick={finish}><Check size={14} />完成</button>
        <button type="button" onClick={() => { setEditing(false); setConflict(false) }}><X size={14} />取消</button>
        {onDelete ? <button className="character-delete" type="button" aria-label={`删除字段 ${label}`} onClick={onDelete}><Trash2 size={14} />删除字段</button> : null}
        <span>完成后统一保存</span>
      </div>
    </div> : <ReadValue value={value} label={label} onChange={onApply} />}</div>
  </div>
}

function ReadValue({ value, label, onChange }: { value: CharacterFieldValue; label: string; onChange?: ((next: CharacterFieldValue) => boolean) | undefined }): React.JSX.Element {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return <span className="character-value-empty">未填写</span>
  }
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>
  if (typeof value === "string" || typeof value === "number") return <p className="character-value-text">{value}</p>
  if (Array.isArray(value)) return <div className="character-value-list">{value.map((item, index) => <InlineField key={index} label={`${label} ${String(index + 1)}`} displayLabel={String(index + 1).padStart(2, "0")} value={item}
    onApply={onChange ? next => onChange(value.map((old, i) => i === index ? next : old)) : undefined}
    onDelete={onChange ? () => { onChange(value.filter((_, i) => i !== index)) } : undefined} />)}</div>
  return <div className="character-value-details">{Object.entries(value).map(([key, item]) => <InlineField key={key} label={`${label} ${key}`} displayLabel={key} value={item}
    onApply={onChange ? next => onChange({ ...value, [key]: next }) : undefined}
    onDelete={onChange ? () => { const next = { ...value }; Reflect.deleteProperty(next, key); onChange(next) } : undefined} />)}</div>
}

function FieldValueEditor({ label, value, onChange }: { label: string; value: CharacterFieldValue; onChange: (value: CharacterFieldValue) => void }): React.JSX.Element {
  if (typeof value === "boolean") return <label className="character-checkbox"><input type="checkbox" aria-label={label} checked={value} onChange={event => { onChange(event.target.checked) }} />{value ? "是" : "否"}</label>
  if (typeof value === "number") return <input autoFocus type="number" aria-label={label} value={value} onChange={event => { if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) onChange(Number(event.target.value)) }} />
  if (typeof value === "string" || value === null) return <CharacterTextInput label={label} value={value ?? ""} onChange={onChange} />
  return <div className="character-collection-editor">
    <ReadValue value={value} label={label} onChange={next => { onChange(next); return true }} />
    <AddFieldControl label={label} isList={Array.isArray(value)} existingKeys={Object.keys(value)} onAdd={(key, text) => {
      onChange(Array.isArray(value) ? [...value, text] : { ...value, [key]: text }); return true
    }} />
  </div>
}

function CharacterTextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${String(input.scrollHeight + 2)}px`
  }, [value])
  return <textarea ref={ref} autoFocus aria-label={label} placeholder="填写内容" rows={2} value={value} onChange={event => { onChange(event.target.value) }} />
}

function AddFieldControl({ label, existingKeys, onAdd, isList = false }: {
  label: string; existingKeys: string[]; isList?: boolean; onAdd: (key: string, value: string) => boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const close = (): void => { setOpen(false); setName(""); setText(""); setError("") }
  const add = (): void => {
    const key = characterFieldNameSchema.safeParse(name.trim())
    if (!isList && !key.success) { setError("请输入有效的字段名"); return }
    if (!isList && existingKeys.includes(name.trim())) { setError("此字段已存在，请更换字段名"); return }
    if (existingKeys.length >= 200) { setError("字段数量已达200项上限"); return }
    if (!text.trim()) { setError("请填写内容后再添加"); return }
    if (onAdd(isList ? "" : name.trim(), text)) close()
  }
  return <div className="character-add-control">
    {open ? <div className="character-field-composer" role="group" aria-label={`${label} 添加${isList ? "条目" : "字段"}`} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); close() }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); add() }
    }}>
      <div className="character-composer-heading"><span>{isList ? "新增条目" : "新增字段"}</span><button className="character-pencil" type="button" aria-label={`取消添加 ${label}`} onClick={close}><X size={15} /></button></div>
      <div className="character-composer-fields">
        {isList ? null : <label><span>字段名 <small>KEY</small></span><input autoFocus aria-label={`${label} 新字段名`} placeholder="例如：擅长兵器" value={name} onChange={event => { setName(event.target.value); setError("") }} /></label>}
        <label><span>内容 <small>VALUE</small></span><textarea autoFocus={isList} aria-label={`${label} 新字段内容`} placeholder="填写这项资料的具体内容" rows={3} value={text} onChange={event => { setText(event.target.value); setError("") }} /></label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="character-composer-actions"><button type="button" onClick={close}>取消</button><button className="character-apply" type="button" onClick={add}><Plus size={14} />确认添加</button></div>
    </div> : <button className="character-add-trigger" type="button" aria-label={`${label} 添加${isList ? "条目" : "字段"}`} onClick={() => { setOpen(true) }}><Plus size={14} />{isList ? "添加条目" : "添加字段"}</button>}
  </div>
}
