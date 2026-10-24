import { useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { checkHealth, type MobileSession } from "../api/client"
import { DEFAULT_SESSION } from "../config/defaults"
import { theme } from "../theme"

type Props = Readonly<{
  session: MobileSession
  onSave: (session: MobileSession) => void
  onResetDefaults: () => void
  onBack: () => void
}>

export function SettingsScreen(props: Props) {
  const [apiBaseUrl, setApiBaseUrl] = useState(props.session.apiBaseUrl)
  const [apiToken, setApiToken] = useState(props.session.apiToken)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const save = async () => {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const next: MobileSession = {
        apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/u, "") || DEFAULT_SESSION.apiBaseUrl,
        apiToken: apiToken.trim() || DEFAULT_SESSION.apiToken,
      }
      const health = await checkHealth(next.apiBaseUrl)
      if (!health.ok) throw new Error("健康检查失败：无法访问 /health")
      props.onSave(next)
      setMessage("已保存并连上后端")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} hitSlop={8}>
          <Text style={styles.link}>← 返回</Text>
        </Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={{ width: 48 }} />
      </View>
      <View style={styles.body}>
        <Text style={styles.hint}>平时不用改。留空保存时会回落到内置默认服务。</Text>
        <Text style={styles.label}>API Base URL</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={DEFAULT_SESSION.apiBaseUrl}
          placeholderTextColor={theme.textFaint}
          style={styles.input}
          value={apiBaseUrl}
          onChangeText={setApiBaseUrl}
        />
        <Text style={styles.label}>API Token</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Bearer Token"
          placeholderTextColor={theme.textFaint}
          secureTextEntry
          style={styles.input}
          value={apiToken}
          onChangeText={setApiToken}
        />
        {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
        {message !== undefined ? <Text style={styles.ok}>{message}</Text> : null}
        <Pressable disabled={busy} style={styles.primaryBtn} onPress={() => void save()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>保存</Text>}
        </Pressable>
        <Pressable
          disabled={busy}
          style={styles.secondary}
          onPress={() => {
            setApiBaseUrl(DEFAULT_SESSION.apiBaseUrl)
            setApiToken(DEFAULT_SESSION.apiToken)
            props.onResetDefaults()
            setMessage("已恢复内置默认")
            setError(undefined)
          }}
        >
          <Text style={styles.secondaryText}>恢复默认</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgPrimary },
  header: {
    backgroundColor: theme.bgSidebar,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: theme.text, fontSize: 16, fontWeight: "700" },
  link: { color: theme.accent, fontSize: 14 },
  body: { padding: 16, gap: 10 },
  hint: { color: theme.textMuted, marginBottom: 8, fontSize: 13 },
  label: { color: theme.textMuted, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    backgroundColor: theme.bgInput,
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: theme.accent,
    borderRadius: theme.radiusMd,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.text, fontWeight: "600" },
  secondary: {
    marginTop: 4,
    borderRadius: theme.radiusMd,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryText: { color: theme.textMuted },
  error: { color: theme.dangerText },
  ok: { color: theme.success },
})
