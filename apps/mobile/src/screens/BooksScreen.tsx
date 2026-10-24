import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"

import { cryptoRandomUuid, invokeRpc, type MobileSession, type ProjectListItem } from "../api/client"
import { allocateBookWorkspaceRef, DEFAULT_BOOKS_ROOT } from "../config/defaults"
import { theme } from "../theme"

// Metro resolves PNG from apps/mobile/assets
// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultCover = require("../../assets/project-default-icon.png") as number

type Props = Readonly<{
  session: MobileSession
  onOpenBook: (project: ProjectListItem) => void
  onOpenSettings: () => void
}>

function formatOpenedAgo(lastOpenedAtMs: number | undefined, nowMs: number): string {
  if (lastOpenedAtMs === undefined) return "尚未打开"
  const deltaMs = Math.max(0, nowMs - lastOpenedAtMs)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "刚刚打开"
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)} 天前`
  return new Date(lastOpenedAtMs).toLocaleDateString()
}

export function BooksScreen(props: Props) {
  const { width } = useWindowDimensions()
  const [busy, setBusy] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [nowMs, setNowMs] = useState(() => Date.now())

  const cardWidth = useMemo(() => {
    const pad = 32
    const gap = 14
    const cols = width >= 720 ? 5 : width >= 520 ? 4 : 3
    return Math.floor((width - pad - gap * (cols - 1)) / cols)
  }, [width])

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const data = await invokeRpc<{ projects: ProjectListItem[] }>(props.session, "project.list", {})
      const sorted = [...data.projects].sort(
        (a, b) => (b.lastOpenedAtMs ?? 0) - (a.lastOpenedAtMs ?? 0),
      )
      setProjects(sorted)
      setNowMs(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [props.session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createBook = async (displayNameRaw: string) => {
    const displayName = displayNameRaw.trim() || "未命名作品"
    if (creating) return
    setCreating(true)
    setError(undefined)
    try {
      const projectId = cryptoRandomUuid()
      const workspaceRootRef = allocateBookWorkspaceRef(displayName, DEFAULT_BOOKS_ROOT)
      const created = await invokeRpc<ProjectListItem>(props.session, "project.create", {
        projectId,
        displayName,
        workspaceRootRef,
      })
      setShowCreate(false)
      setDraftName("")
      await refresh()
      props.onOpenBook({
        projectId: created.projectId,
        displayName: created.displayName,
        workspaceRootRef: created.workspaceRootRef,
        lastOpenedAtMs: created.lastOpenedAtMs,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={props.onOpenSettings} hitSlop={8}>
          <Text style={styles.topLink}>设置</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.h1}>我的书籍</Text>
          <Text style={styles.subtitle}>选择一本书继续创作，或添加新书</Text>
        </View>

        {busy ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.loadingText}>正在加载书籍…</Text>
          </View>
        ) : null}

        {error !== undefined ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(undefined)}><Text style={styles.errorDismiss}>×</Text></Pressable>
          </View>
        ) : null}

        <View style={[styles.grid, { gap: 14 }]}>
          {projects.map((item) => (
            <Pressable
              key={item.projectId}
              style={({ pressed }) => [
                styles.card,
                { width: cardWidth },
                pressed ? styles.cardPressed : null,
              ]}
              onPress={() => props.onOpenBook(item)}
            >
              {({ pressed }) => (
                <>
                  <View style={styles.cover}>
                    <Image source={defaultCover} style={styles.coverImage} resizeMode="cover" />
                    {pressed ? (
                      <View style={styles.coverScrim}>
                        <Text style={styles.openChip}>打开</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.displayName}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {formatOpenedAgo(item.lastOpenedAtMs, nowMs)}
                  </Text>
                </>
              )}
            </Pressable>
          ))}

          <Pressable
            style={({ pressed }) => [
              styles.card,
              styles.cardAdd,
              { width: cardWidth },
              pressed ? styles.cardAddPressed : null,
            ]}
            onPress={() => setShowCreate(true)}
          >
            <View style={[styles.cover, styles.coverAdd]}>
              <Text style={styles.plus}>＋</Text>
            </View>
            <Text style={[styles.cardTitle, styles.cardTitleCenter]}>
              {creating ? "正在创建…" : "添加书籍"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal transparent visible={showCreate} animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>创建书籍</Text>
            <Text style={styles.modalHint}>给这本书起个名字（可稍后改）</Text>
            <TextInput
              autoFocus
              placeholder="作品名称"
              placeholderTextColor={theme.textFaint}
              style={styles.modalInput}
              value={draftName}
              onChangeText={setDraftName}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setShowCreate(false); setDraftName("") }}>
                <Text style={styles.topLink}>取消</Text>
              </Pressable>
              <Pressable onPress={() => void createBook("")}>
                <Text style={styles.topLink}>跳过</Text>
              </Pressable>
              <Pressable
                disabled={creating}
                style={styles.primaryBtn}
                onPress={() => void createBook(draftName)}
              >
                {creating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>创建书籍</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgPrimary },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  topLink: { color: theme.textMuted, fontSize: 14 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  header: { gap: 6, marginBottom: 22, marginTop: 8 },
  h1: { color: theme.text, fontSize: 22, fontWeight: "700", letterSpacing: 0.4 },
  subtitle: { color: theme.textMuted, fontSize: 13 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  loadingText: { color: theme.textMuted, fontSize: 13 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(242,63,67,0.14)",
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: { flex: 1, color: theme.dangerText, fontSize: 13 },
  errorDismiss: { color: theme.dangerText, fontSize: 18, paddingHorizontal: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    padding: 8,
    borderRadius: theme.radiusCard,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bgSidebar,
    gap: 7,
    marginBottom: 4,
    flexDirection: "column",
    ...theme.shadow,
  },
  cardPressed: {
    transform: [{ translateY: -2 }],
    borderColor: theme.accentSoftBorder,
    backgroundColor: theme.bgHover,
  },
  cardAdd: {
    borderStyle: "dashed",
    backgroundColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  cardAddPressed: { backgroundColor: theme.accentSoft },
  cover: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: theme.radiusCover,
    overflow: "hidden",
    backgroundColor: theme.bgApp,
  },
  coverImage: { width: "100%", height: "100%" },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  openChip: {
    color: theme.text,
    backgroundColor: theme.accent,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: "600",
  },
  coverAdd: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  plus: { color: theme.textMuted, fontSize: 28, fontWeight: "300" },
  cardTitle: { color: theme.text, fontSize: 12, fontWeight: "700" },
  cardTitleCenter: { textAlign: "center" },
  cardMeta: { color: theme.textFaint, fontSize: 10 },
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.bgOverlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: theme.bgSidebar,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    gap: 10,
    ...theme.shadow,
  },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
  modalHint: { color: theme.textMuted, fontSize: 13 },
  modalInput: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    backgroundColor: theme.bgInput,
  },
  modalActions: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
  },
  primaryBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.text, fontWeight: "600" },
})
