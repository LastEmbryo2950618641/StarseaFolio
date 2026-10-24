import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { invokeRpc, type MobileSession, type ProjectListItem } from "../api/client"
import { theme } from "../theme"

type ChapterRow = Readonly<{
  chapterId: string
  heading: string
  publishPath: string
  sequence?: number
}>

type Props = Readonly<{
  session: MobileSession
  project: ProjectListItem
  onBack: () => void
}>

export function ChaptersScreen(props: Props) {
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [chapters, setChapters] = useState<ChapterRow[]>([])
  const [body, setBody] = useState<string | undefined>()
  const [readingTitle, setReadingTitle] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      await invokeRpc(props.session, "project.open", {
        workspaceRootRef: props.project.workspaceRootRef,
      })
      const data = await invokeRpc<ChapterRow[] | { chapters?: ChapterRow[] }>(
        props.session,
        "chapter.list",
        {
          projectId: props.project.projectId,
          workspaceRootRef: props.project.workspaceRootRef,
        },
      )
      const rows = Array.isArray(data) ? data : (data.chapters ?? [])
      setChapters(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [props.project, props.session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openChapter = async (row: ChapterRow) => {
    setBusy(true)
    setError(undefined)
    try {
      const data = await invokeRpc<{ content?: string; body?: string; heading?: string }>(
        props.session,
        "chapter.read",
        {
          projectId: props.project.projectId,
          workspaceRootRef: props.project.workspaceRootRef,
          chapterId: row.chapterId,
        },
      )
      setReadingTitle(data.heading ?? row.heading)
      setBody(data.body ?? data.content ?? "（空）")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (body !== undefined) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => setBody(undefined)} hitSlop={8}>
            <Text style={styles.link}>← 列表</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{readingTitle}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView style={styles.reader} contentContainerStyle={{ padding: 18 }}>
          <Text style={styles.body}>{body}</Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} hitSlop={8}>
          <Text style={styles.link}>← 讨论</Text>
        </Pressable>
        <Text style={styles.title}>章节</Text>
        <Pressable onPress={() => void refresh()} hitSlop={8}>
          <Text style={styles.link}>刷新</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} /> : null}
      {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.chapterId}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={
          !busy ? <Text style={styles.empty}>暂无章节（先在讨论里推进再回来看）</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            onPress={() => void openChapter(item)}
          >
            <View style={styles.stageDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {item.sequence !== undefined ? `第 ${String(item.sequence)} 章 · ` : ""}
                {item.heading}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.publishPath}</Text>
            </View>
          </Pressable>
        )}
      />
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
  title: { color: theme.text, fontWeight: "700", fontSize: 16 },
  link: { color: theme.accent, fontSize: 14 },
  error: { color: theme.dangerText, paddingHorizontal: 16, paddingTop: 8 },
  empty: { color: theme.textMuted, textAlign: "center", marginTop: 40, fontSize: 13 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.bgSidebar,
    borderRadius: theme.radiusCard,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cardPressed: { backgroundColor: theme.bgHover, borderColor: theme.accentSoftBorder },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.success,
  },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: "600" },
  cardMeta: { color: theme.textFaint, marginTop: 4, fontSize: 11 },
  reader: { flex: 1, backgroundColor: theme.bgApp },
  body: { color: theme.text, lineHeight: 26, fontSize: 16 },
})
