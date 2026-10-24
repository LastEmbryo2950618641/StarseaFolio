import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { invokeRpc, type MobileSession, type ProjectListItem } from "../api/client"
import { theme } from "../theme"

type ChatLine = Readonly<{
  id: string
  role: "user" | "assistant" | "system"
  text: string
}>

type ConversationMessage = Readonly<{
  messageId: string
  role: "user" | "assistant" | "system"
  content: string
  choices?: readonly { label: string }[]
  hidden?: boolean
}>

type ListResult = Readonly<{
  session?: { sessionId: string }
  messages: readonly ConversationMessage[]
}>

type SendResult = Readonly<{
  session: { sessionId: string }
  messages: readonly ConversationMessage[]
}>

type Props = Readonly<{
  session: MobileSession
  project: ProjectListItem
  onBack: () => void
  onOpenChapters: () => void
}>

const DEFAULT_PRESENTATION = {
  minimumWordCount: 2000,
  maximumWordCount: 3000,
} as const

function toLines(messages: readonly ConversationMessage[]): ChatLine[] {
  return messages
    .filter((m) => m.hidden !== true && m.content.trim().length > 0)
    .map((m) => ({
      id: m.messageId,
      role: m.role,
      text: m.content,
    }))
}

function lastAssistantText(messages: readonly ConversationMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m === undefined || m.role !== "assistant" || m.hidden === true) continue
    const text = m.content.trim()
    if (text.length > 0) return text
    if (m.choices !== undefined && m.choices.length > 0) {
      return m.choices.map((c) => `· ${c.label}`).join("\n")
    }
  }
  return "（本轮无文本回复，可点章节查看落盘）"
}

export function DiscussScreen(props: Props) {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [sessionReady, setSessionReady] = useState(false)

  const ensureConversation = useCallback(async () => {
    setError(undefined)
    try {
      await invokeRpc(props.session, "project.open", {
        workspaceRootRef: props.project.workspaceRootRef,
      })
      let listed = await invokeRpc<ListResult>(props.session, "synopsis.conversation.list", {
        projectId: props.project.projectId,
        workspaceRootRef: props.project.workspaceRootRef,
      })
      if (listed.session === undefined) {
        listed = await invokeRpc<ListResult>(props.session, "synopsis.conversation.start", {
          projectId: props.project.projectId,
          workspaceRootRef: props.project.workspaceRootRef,
          title: "mobile",
        })
      }
      setLines(toLines(listed.messages ?? []))
      setSessionReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [props.project, props.session])

  useEffect(() => {
    void ensureConversation()
  }, [ensureConversation])

  const send = async () => {
    const message = draft.trim()
    if (message.length === 0 || busy) return
    setBusy(true)
    setError(undefined)
    setDraft("")
    setLines((current) => [
      ...current,
      { id: `u-${String(Date.now())}`, role: "user", text: message },
    ])
    try {
      const sent = await invokeRpc<SendResult>(props.session, "synopsis.conversation.send", {
        projectId: props.project.projectId,
        workspaceRootRef: props.project.workspaceRootRef,
        message,
        presentation: DEFAULT_PRESENTATION,
      })
      const assistant = lastAssistantText(sent.messages ?? [])
      setLines((current) => [
        ...current,
        { id: `a-${String(Date.now())}`, role: "assistant", text: assistant },
      ])
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
          <Text style={styles.link}>← 书库</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{props.project.displayName}</Text>
        <Pressable onPress={props.onOpenChapters} hitSlop={8}>
          <Text style={styles.link}>章节</Text>
        </Pressable>
      </View>
      <View style={styles.desk}>
        {!sessionReady && error === undefined ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />
        ) : null}
        {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          data={lines}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            sessionReady ? (
              <Text style={styles.emptyHint}>跟桌面创作台一样：先聊卖点 / 大纲，再落章。</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === "user" ? styles.user : styles.assistant]}>
              <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            editable={!busy && sessionReady}
            multiline
            placeholder="说一句卖点或继续讨论…"
            placeholderTextColor={theme.textFaint}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
          />
          <Pressable
            disabled={busy || !sessionReady}
            style={[styles.send, (busy || !sessionReady) ? styles.sendDisabled : null]}
            onPress={() => void send()}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>发送</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgApp },
  header: {
    backgroundColor: theme.bgSidebar,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { flex: 1, textAlign: "center", color: theme.text, fontWeight: "700", fontSize: 15 },
  link: { color: theme.accent, fontSize: 14 },
  desk: { flex: 1, backgroundColor: theme.bgPrimary },
  error: { color: theme.dangerText, paddingHorizontal: 16, paddingTop: 8 },
  emptyHint: { color: theme.textMuted, textAlign: "center", marginTop: 40, fontSize: 13 },
  bubble: { borderRadius: theme.radiusMd, padding: 12, maxWidth: "92%" },
  user: { alignSelf: "flex-end", backgroundColor: theme.bgActive },
  assistant: {
    alignSelf: "flex-start",
    backgroundColor: theme.bgSidebar,
    borderWidth: 1,
    borderColor: theme.border,
  },
  bubbleText: { color: theme.text, lineHeight: 20, fontSize: 14 },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bgSidebar,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    backgroundColor: theme.bgInput,
  },
  send: {
    backgroundColor: theme.accent,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: "center",
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: theme.text, fontWeight: "600" },
})
