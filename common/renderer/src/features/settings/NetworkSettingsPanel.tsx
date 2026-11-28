import { Globe } from "lucide-react"

import {
  DEFAULT_NETWORK_SETTINGS,
  useNetworkPreferences,
} from "./network-preferences.js"

export function NetworkSettingsPanel(): React.JSX.Element {
  const [preferences, update] = useNetworkPreferences()
  const timeoutMinutes = Math.max(1, Math.round(preferences.requestTimeoutMs / 60_000))

  return <section className="settings-page" data-testid="network-settings-panel">
    <header>
      <span><Globe size={18} /></span>
      <div>
        <h2>网络</h2>
        <p>控制模型单次 HTTP 请求的超时与失败重试；与「推演执行」里的整轮等待上限相互独立。</p>
      </div>
    </header>
    <div className="settings-fields">
      <label className="settings-field-row">
        <span>
          <strong>单次请求超时</strong>
          <small>默认 {String(Math.round(DEFAULT_NETWORK_SETTINGS.requestTimeoutMs / 60_000))} 分钟；超时后按重试次数再试</small>
        </span>
        <span className="settings-number-input">
          <input
            aria-label="单次请求超时"
            type="number"
            min={1}
            max={120}
            step={1}
            value={timeoutMinutes}
            onChange={(event) => {
              const minutes = Math.min(120, Math.max(1, Number(event.target.value) || 1))
              update({ requestTimeoutMs: minutes * 60_000 })
            }}
          />
          <em>分钟</em>
        </span>
      </label>
      <label className="settings-field-row">
        <span>
          <strong>重试次数</strong>
          <small>含首次请求的总尝试次数，默认 {String(DEFAULT_NETWORK_SETTINGS.maxAttempts)} 次</small>
        </span>
        <span className="settings-number-input">
          <input
            aria-label="重试次数"
            type="number"
            min={1}
            max={10}
            step={1}
            value={preferences.maxAttempts}
            onChange={(event) => {
              const maxAttempts = Math.min(10, Math.max(1, Number(event.target.value) || 1))
              update({ maxAttempts })
            }}
          />
          <em>次</em>
        </span>
      </label>
    </div>
  </section>
}
