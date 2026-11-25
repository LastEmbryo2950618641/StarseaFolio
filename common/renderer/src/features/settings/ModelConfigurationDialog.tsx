import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { ArrowLeft, ChevronRight, Plus, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw, Server, Trash2 } from "lucide-react"

import type { ModelDescriptor, ModelListResult } from "@starseafolio/contracts"

import { getModelCredential, listModelCatalog } from "../../api/client.js"
import { MobileBottomSheet } from "../../components/MobileBottomSheet.js"
import { UiTooltip } from "../../components/UiTooltip.js"
import {
  OPENAI_WIRE_STYLE_OPTIONS,
  PROTOCOL_FAMILY_OPTIONS,
  apiProtocolFromFamily,
  createProfileFromPreset,
  openAIWireStyleOf,
  protocolFamilyOf,
  MODEL_PROVIDER_PRESETS,
  type ModelProfile,
  type ModelProtocolFamily,
  type ModelProviderPresetId,
  type OpenAIWireStyle,
} from "./model-provider-presets.js"

export type { ModelProfile } from "./model-provider-presets.js"

/** Display-only sentinel for a saved key that is not loaded into the draft yet. */
export const SAVED_API_KEY_MASK = "********"

type Props = Readonly<{
  profiles: readonly ModelProfile[]
  activeProfileId: string
  onClose(): void
  onSave(profiles: readonly ModelProfile[], activeProfileId: string): void | Promise<void>
}>

type TestState = "idle" | "testing" | "success" | "error"
type CatalogState = Readonly<{
  signature: string
  status: "loading" | "success" | "error"
  models: readonly ModelDescriptor[]
  error?: string
}>

export function ModelConfigurationDialog({ profiles, activeProfileId, onClose, onSave }: Props): React.JSX.Element {
  const [drafts, setDrafts] = useState<readonly ModelProfile[]>(profiles)
  const [selectedId, setSelectedId] = useState(activeProfileId)
  const [showList, setShowList] = useState(true)
  const [showProviderSheet, setShowProviderSheet] = useState(false)
  const [nextActiveId, setNextActiveId] = useState(activeProfileId)
  const [showApiKey, setShowApiKey] = useState(false)
  const [revealingApiKey, setRevealingApiKey] = useState(false)
  const [testState, setTestState] = useState<TestState>("idle")
  const [message, setMessage] = useState("选择一个配置进行编辑")
  const [saving, setSaving] = useState(false)
  const [catalogs, setCatalogs] = useState<Readonly<Record<string, CatalogState>>>({})
  const selectedProfile = useMemo(() => drafts.find((profile) => profile.id === selectedId) ?? drafts[0], [drafts, selectedId])
  const selectedCatalog = selectedProfile === undefined ? undefined : catalogs[selectedProfile.id]
  const modelListId = useId()
  const canLoadCatalog = selectedProfile !== undefined && hasValidBaseUrl(selectedProfile.baseUrl)
    && (selectedProfile.hasApiKey || selectedProfile.apiKey.trim().length > 0)
  const savedKeyPending = selectedProfile !== undefined
    && selectedProfile.hasApiKey
    && selectedProfile.apiKey.trim().length === 0
  const apiKeyInputValue = savedKeyPending && !showApiKey ? SAVED_API_KEY_MASK : (selectedProfile?.apiKey ?? "")

  const loadModels = useCallback(async (profile: ModelProfile): Promise<ModelListResult> => {
    const signature = catalogSignature(profile)
    setCatalogs((current) => ({
      ...current,
      [profile.id]: { signature, status: "loading", models: [] },
    }))
    try {
      const result = await listModelCatalog({
        baseUrl: profile.baseUrl.trim(),
        credentialRef: profile.credentialRef,
        apiKey: profile.apiKey.trim(),
      })
      if (result.models.length === 0) throw new Error("服务未返回可用模型")
      setCatalogs((current) => current[profile.id]?.signature !== signature ? current : {
        ...current,
        [profile.id]: { signature, status: "success", models: result.models },
      })
      setDrafts((current) => current.map((item) => (
        item.id === profile.id
          && catalogSignature(item) === signature
          && item.model.trim().length === 0
          ? { ...item, model: result.models[0]?.id ?? "" }
          : item
      )))
      return result
    } catch (error) {
      setCatalogs((current) => current[profile.id]?.signature !== signature ? current : {
        ...current,
        [profile.id]: { signature, status: "error", models: [], error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (showProviderSheet) return
      event.preventDefault()
      if (showList) onClose()
      else setShowList(true)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => { window.removeEventListener("keydown", handleKeyDown) }
  }, [onClose, showList, showProviderSheet])

  useEffect(() => {
    setShowApiKey(false)
  }, [selectedId])

  useEffect(() => {
    if (showList || selectedProfile === undefined || !canLoadCatalog) return
    const signature = catalogSignature(selectedProfile)
    if (selectedCatalog?.signature === signature) return
    const timeout = window.setTimeout(() => { void loadModels(selectedProfile).catch(() => {}) }, 500)
    return () => { window.clearTimeout(timeout) }
  }, [canLoadCatalog, loadModels, selectedCatalog?.signature, selectedProfile, showList])

  const updateSelected = (changes: Partial<Omit<ModelProfile, "id">>): void => {
    setDrafts((current) => current.map((profile) => profile.id === selectedId ? { ...profile, ...changes } : profile))
    if ("baseUrl" in changes || "apiKey" in changes) {
      setCatalogs((current) => Object.fromEntries(Object.entries(current).filter(([profileId]) => profileId !== selectedId)))
    }
    setTestState("idle")
    setMessage("配置已修改，尚未保存")
  }

  const validate = (profile: ModelProfile | undefined, requireModel = true): string | undefined => {
    if (profile === undefined) return "请先创建一个模型配置"
    if (profile.name.trim().length === 0) return "请输入配置名称"
    try {
      const parsedUrl = new URL(profile.baseUrl)
      if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
        return "远程模型地址必须使用 HTTPS"
      }
    } catch {
      return "请输入有效的 Base URL"
    }
    if (requireModel && profile.model.trim().length === 0) return "请选择模型"
    if (!Number.isSafeInteger(profile.contextWindowTokens) || profile.contextWindowTokens <= 0) {
      return "最大上下文必须是有效的正整数"
    }
    if (profile.apiKey.trim().length === 0 && !profile.hasApiKey) return "请输入 API Key"
    return undefined
  }

  const openProviderSheet = (): void => {
    if (saving) return
    setShowProviderSheet(true)
  }

  const addProfileFromPreset = (presetId: ModelProviderPresetId): void => {
    const profile = createProfileFromPreset(presetId)
    setDrafts((current) => [...current, profile])
    setSelectedId(profile.id)
    setShowProviderSheet(false)
    setShowList(false)
    setShowApiKey(false)
    setTestState("idle")
    setMessage(presetId === "custom"
      ? "自定义配置已创建：填写 API Key 与服务地址即可，JSON Mode 默认开启"
      : `${profile.name} 预设已填入，核对后填写 API Key 即可`)
  }

  const toggleApiKeyVisibility = async (): Promise<void> => {
    if (selectedProfile === undefined || revealingApiKey) return
    if (showApiKey) {
      setShowApiKey(false)
      return
    }
    if (selectedProfile.apiKey.trim().length > 0) {
      setShowApiKey(true)
      return
    }
    if (!selectedProfile.hasApiKey) {
      setShowApiKey(true)
      return
    }
    setRevealingApiKey(true)
    try {
      const revealed = await getModelCredential(selectedProfile.credentialRef)
      if (revealed === undefined || revealed.trim().length === 0) {
        setTestState("error")
        setMessage("未能读取已保存的 API Key，请重新输入")
        setShowApiKey(true)
        return
      }
      updateSelected({ apiKey: revealed, hasApiKey: true })
      setShowApiKey(true)
    } catch (error) {
      setTestState("error")
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setRevealingApiKey(false)
    }
  }

  const removeProfile = (profileId: string): void => {
    if (drafts.length <= 1) return
    const remaining = drafts.filter((profile) => profile.id !== profileId)
    const fallback = remaining[0]
    setDrafts(remaining)
    setCatalogs((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== profileId)))
    if (selectedId === profileId) setSelectedId(fallback?.id ?? "")
    if (nextActiveId === profileId) setNextActiveId(fallback?.id ?? "")
    setTestState("idle")
    setMessage("配置已删除，尚未保存")
  }

  const testConnection = async (): Promise<void> => {
    const validationError = validate(selectedProfile, false)
    if (validationError !== undefined || selectedProfile === undefined) {
      setTestState("error")
      setMessage(validationError ?? "请选择模型配置")
      return
    }
    setTestState("testing")
    setMessage("正在获取可用模型...")
    try {
      const result = await loadModels(selectedProfile)
      setTestState("success")
      setMessage(`已获取 ${String(result.models.length)} 个可用模型`)
    } catch (error) {
      setTestState("error")
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const save = async (activateSelected: boolean): Promise<void> => {
    if (saving) return
    const profile = activateSelected || !showList ? selectedProfile : drafts.find((item) => item.id === nextActiveId)
    const validationError = validate(profile)
    if (validationError !== undefined || profile === undefined) {
      setTestState("error")
      setMessage(validationError ?? "请选择模型配置")
      if (showList) setShowList(false)
      return
    }
    const activeId = activateSelected ? profile.id : nextActiveId
    setSaving(true)
    try {
      await onSave(drafts.map(normalizeProfile), activeId)
    } catch (error) {
      setTestState("error")
      setMessage(error instanceof Error ? error.message : String(error))
      if (showList) setShowList(false)
    } finally {
      setSaving(false)
    }
  }

  return <section className="model-dialog model-dialog-wide settings-drilldown" data-view={showList ? "list" : "detail"} data-testid="model-configuration-dialog" role="region" aria-labelledby="model-dialog-title">
      <header className="model-dialog-header">
        <button type="button" className="settings-back" autoFocus aria-label={showList ? "返回创作界面" : "返回模型配置列表"} onClick={() => { if (showList) onClose(); else setShowList(true) }}><ArrowLeft size={18} /></button>
        <div><strong id="model-dialog-title">{showList ? "模型配置" : selectedProfile?.name || "添加模型配置"}</strong><span>{showList ? "选择配置进行编辑，或添加新的模型服务" : "先选厂商协议族；OpenAI 可再选接口形态"}</span></div>
      </header>
      <div className="settings-options-page" hidden={!showList} data-testid="model-configuration-list">
        <button type="button" className="settings-option-row settings-option-add" data-testid="model-add-profile" onClick={openProviderSheet} disabled={saving}><Plus size={20} /><span><strong>添加配置</strong><small>选择厂商或自定义服务</small></span><ChevronRight size={18} /></button>
        {drafts.map((profile, index) => <button key={profile.id} type="button" className="settings-option-row" disabled={saving} onClick={() => {
          setSelectedId(profile.id); setShowList(false); setShowApiKey(false); setTestState("idle"); setMessage("选择一个配置进行编辑")
        }}><Server size={20} /><span><strong>{profile.name || `未命名配置 ${String(index + 1)}`}</strong><small>{profile.model || "尚未选择模型"}{profile.id === nextActiveId ? " · 当前使用" : ""}</small></span><ChevronRight size={18} /></button>)}
      </div>
      <div className="model-dialog-layout model-dialog-layout--dropdown" hidden={showList}>
        <div className="model-profile-picker">
          <label htmlFor="model-profile-choice">模型配置 <small>{String(drafts.length)} 个配置</small></label>
          <div className="model-profile-picker-controls">
            <select id="model-profile-choice" aria-label="选择模型配置" data-testid="model-profile-selector"
              value={selectedProfile?.id ?? ""} disabled={saving}
              onChange={(event) => {
                if (event.target.value === "__add_profile__") { openProviderSheet(); return }
                setSelectedId(event.target.value)
                setShowApiKey(false)
                setTestState("idle")
                setMessage("选择一个配置进行编辑")
              }}>
              <option value="__add_profile__">＋ 添加配置</option>
              {selectedProfile === undefined ? <option value="" disabled>请选择或添加配置</option> : null}
              {drafts.map((profile, index) => <option key={profile.id} value={profile.id}>
                {profile.name || `未命名配置 ${String(index + 1)}`}{profile.id === nextActiveId ? " · 当前使用" : ""}
              </option>)}
            </select>
            <UiTooltip label={drafts.length <= 1 ? "至少保留一个配置" : "删除所选配置"}>
              <button type="button" className="model-profile-delete" aria-label="删除所选模型配置"
                disabled={saving || drafts.length <= 1 || selectedProfile === undefined}
                onClick={() => { if (selectedProfile !== undefined) removeProfile(selectedProfile.id) }}><Trash2 size={16} /></button>
            </UiTooltip>
          </div>
        </div>
        <div className="model-editor">
          {selectedProfile === undefined ? <div className="empty-model-editor">请先新增一个模型配置</div> : <>
            <div className="model-dialog-summary">
              <span className="model-summary-icon"><Server size={17} /></span>
              <span><strong>{selectedProfile.model.trim() || "尚未选择模型"}</strong><small>{selectedProfile.baseUrl.trim() || "尚未配置服务地址"}</small></span>
              <em>{selectedProfile.id === nextActiveId ? "当前使用" : !selectedProfile.hasApiKey && selectedProfile.apiKey.trim().length === 0 ? "未配置密钥" : "可切换"}</em>
            </div>
            <label className="model-field">
              <span>配置名称<small>用于区分不同服务与账号</small></span>
              <input value={selectedProfile.name} onChange={(event) => { updateSelected({ name: event.target.value }); }} placeholder="例如：DeepSeek 主账号" spellCheck={false} />
            </label>
            <label className="model-field">
              <span>API 协议<small>先选厂商协议族</small></span>
              <select
                className="model-enum-select"
                data-testid="model-protocol-family"
                value={protocolFamilyOf(selectedProfile.apiProtocol)}
                onChange={(event) => {
                  const family = event.target.value as ModelProtocolFamily
                  const wireStyle = openAIWireStyleOf(selectedProfile.apiProtocol)
                  updateSelected({ apiProtocol: apiProtocolFromFamily(family, wireStyle) })
                }}
              >
                {PROTOCOL_FAMILY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small className="model-field-hint">{PROTOCOL_FAMILY_OPTIONS.find((option) => option.value === protocolFamilyOf(selectedProfile.apiProtocol))?.hint}</small>
            </label>
            {protocolFamilyOf(selectedProfile.apiProtocol) === "openai" ? (
              <label className="model-field">
                <span>OpenAI 接口形态<small>仅 OpenAI 协议族需要选择</small></span>
                <select
                  className="model-enum-select"
                  data-testid="model-openai-wire-style"
                  value={openAIWireStyleOf(selectedProfile.apiProtocol)}
                  onChange={(event) => {
                    const wireStyle = event.target.value as OpenAIWireStyle
                    updateSelected({ apiProtocol: apiProtocolFromFamily("openai", wireStyle) })
                  }}
                >
                  {OPENAI_WIRE_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small className="model-field-hint">{OPENAI_WIRE_STYLE_OPTIONS.find((option) => option.value === openAIWireStyleOf(selectedProfile.apiProtocol))?.hint}</small>
              </label>
            ) : (
              <p className="model-field-hint" data-testid="model-anthropic-wire-note">Anthropic 固定使用 Messages API</p>
            )}
            <label className="model-field">
              <span>Base URL<small>模型服务的 API 根地址</small></span>
              <input value={selectedProfile.baseUrl} onChange={(event) => { updateSelected({ baseUrl: event.target.value }); }} placeholder="https://api.deepseek.com" spellCheck={false} />
            </label>
            <label className="model-field">
              <span>API Key<small>单独保存在本机；自定义配置只要填好 Key 即可生效，不强制 JSON Mode</small></span>
              <div className="secret-input">
                <KeyRound size={15} />
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKeyInputValue}
                  onChange={(event) => {
                    let next = event.target.value
                    if (next.startsWith(SAVED_API_KEY_MASK)) next = next.slice(SAVED_API_KEY_MASK.length)
                    if (next === SAVED_API_KEY_MASK && selectedProfile.hasApiKey) return
                    updateSelected({
                      apiKey: next === SAVED_API_KEY_MASK ? "" : next,
                      hasApiKey: next.trim().length > 0 || selectedProfile.hasApiKey,
                    })
                  }}
                  placeholder={selectedProfile.hasApiKey ? "重新输入可替换" : "输入 API Key"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <UiTooltip label={showApiKey ? "隐藏密钥" : "显示密钥"}>
                  <button
                    type="button"
                    aria-label={showApiKey ? "隐藏密钥" : "显示密钥"}
                    disabled={revealingApiKey}
                    onClick={() => { void toggleApiKeyVisibility() }}
                  >
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </UiTooltip>
              </div>
            </label>
            <label className="model-field">
              <span>模型<small>{selectedCatalog?.status === "loading" ? "正在获取模型…"
                : selectedCatalog?.status === "error" ? "未能获取模型列表，可手动输入模型名称"
                  : "从服务列表选择，或手动输入模型名称"}</small></span>
              <div className="model-select-input">
                <input list={modelListId} value={selectedProfile.model} onChange={(event) => { updateSelected({ model: event.target.value }); }} placeholder="输入或选择模型" spellCheck={false} />
                <datalist id={modelListId}>
                  {selectedCatalog?.models.map((model) => <option value={model.id} key={model.id} />)}
                </datalist>
                <UiTooltip label="重新获取模型列表"><button type="button" aria-label="重新获取模型列表" disabled={!canLoadCatalog || selectedCatalog?.status === "loading"} onClick={() => { void loadModels(selectedProfile).catch(() => {}) }}><RefreshCw size={14} /></button></UiTooltip>
              </div>
            </label>
            <label className="model-field">
              <span>最大上下文<small>该模型单次请求支持的上下文容量，是压缩计算的唯一来源</small></span>
              <input type="number" value={selectedProfile.contextWindowTokens} min={1} step={1} onChange={(event) => { updateSelected({ contextWindowTokens: Number(event.target.value) }); }} />
            </label>
            <div className="model-field">
              <span>深度思考<small>使用当前协议支持的原生推理能力</small></span>
              <button className={`model-toggle ${selectedProfile.thinkingModeEnabled ? "enabled" : ""}`} type="button" role="switch" aria-checked={selectedProfile.thinkingModeEnabled} onClick={() => { updateSelected({ thinkingModeEnabled: !selectedProfile.thinkingModeEnabled }); }}><i /><strong>{selectedProfile.thinkingModeEnabled ? "已开启" : "已关闭"}</strong></button>
            </div>
            <label className="model-field">
              <span>思考强度<small>可选值取决于模型与兼容服务</small></span>
              <select className="model-enum-select" value={selectedProfile.reasoningEffort} disabled={!selectedProfile.thinkingModeEnabled} onChange={(event) => { updateSelected({ reasoningEffort: event.target.value as ModelProfile["reasoningEffort"] }); }}>
                <option value="none">无</option><option value="minimal">最小</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option><option value="max">最大</option>
              </select>
            </label>
            <div className="model-field">
              <span>JSON Mode<small>默认开启，非强制；输出仍由业务 Schema 校验</small></span>
              <button className={`model-toggle ${selectedProfile.jsonModeEnabled ? "enabled" : ""}`} type="button" role="switch" aria-checked={selectedProfile.jsonModeEnabled} onClick={() => { updateSelected({ jsonModeEnabled: !selectedProfile.jsonModeEnabled }); }}><i /><strong>{selectedProfile.jsonModeEnabled ? "已开启" : "已关闭"}</strong></button>
            </div>
            <div className={`model-test-status ${testState}`}>
              {testState === "testing" ? <LoaderCircle size={14} /> : testState === "success" ? <CheckCircle2 size={14} /> : <span />}
              <p>{message}</p>
            </div>
          </>}
        </div>
      </div>
      <footer className="model-dialog-footer">
        <p>配置保存在应用中；API Key 单独保存在当前设备。</p>
        {showList ? null : <><button type="button" className="secondary-command" onClick={() => void testConnection()} disabled={saving || testState === "testing"}>{testState === "testing" ? "测试中..." : "测试连接"}</button>
        <button type="button" className="secondary-command" onClick={() => void save(true)} disabled={saving}>设为当前</button></>}
        <button className="dialog-primary-command" type="button" onClick={() => void save(false)} disabled={saving}>{saving ? "保存中..." : "保存更改"}</button>
      </footer>
      {showProviderSheet ? <MobileBottomSheet title="选择模型厂商" name="model-provider" onClose={() => { setShowProviderSheet(false) }}>
        <div className="model-provider-sheet" data-testid="model-provider-sheet">
          <p className="model-provider-sheet-lead">选择常用厂商自动填充协议与思考/JSON 等差异项；自定义只需填 Key 与地址。</p>
          {MODEL_PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="model-provider-option"
              data-testid={`model-provider-${preset.id}`}
              onClick={() => { addProfileFromPreset(preset.id) }}
            >
              <Server size={20} />
              <span>
                <strong>{preset.name}</strong>
                <small>{preset.description}</small>
                <em>{preset.highlights.join(" · ")}</em>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </MobileBottomSheet> : null}
    </section>
}

export function normalizeProfile(profile: ModelProfile): ModelProfile {
  const trimmedKey = profile.apiKey.trim()
  // Mask sentinel means "keep the vault secret"; never persist asterisks.
  const apiKey = trimmedKey === SAVED_API_KEY_MASK ? "" : trimmedKey
  return {
    ...profile,
    name: profile.name.trim(),
    baseUrl: profile.baseUrl.trim(),
    model: profile.model.trim(),
    apiKey,
    hasApiKey: apiKey.length > 0 || profile.hasApiKey,
  }
}

export function isOfficialDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com"
  } catch {
    return false
  }
}

export function hasValidBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl)
    return parsedUrl.protocol === "https:" || parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1"
  } catch {
    return false
  }
}

export function catalogSignature(profile: ModelProfile): string {
  return `${profile.baseUrl.trim()}\u0000${profile.apiKey.trim() || profile.credentialRef}`
}
