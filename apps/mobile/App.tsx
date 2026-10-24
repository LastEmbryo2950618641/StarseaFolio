import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

import type { MobileSession, ProjectListItem } from "./src/api/client"
import { DEFAULT_SESSION, resolveSession } from "./src/config/defaults"
import { BooksScreen } from "./src/screens/BooksScreen"
import { ChaptersScreen } from "./src/screens/ChaptersScreen"
import { DiscussScreen } from "./src/screens/DiscussScreen"
import { SettingsScreen } from "./src/screens/SettingsScreen"
import { clearSession, loadSession, saveSession } from "./src/storage/session"
import { theme } from "./src/theme"

type Route =
  | { name: "books" }
  | { name: "settings" }
  | { name: "discuss"; project: ProjectListItem }
  | { name: "chapters"; project: ProjectListItem }

export default function App() {
  const [session, setSession] = useState<MobileSession>(DEFAULT_SESSION)
  const [booting, setBooting] = useState(true)
  const [route, setRoute] = useState<Route>({ name: "books" })

  useEffect(() => {
    void (async () => {
      const saved = await loadSession()
      setSession(resolveSession(saved))
      setBooting(false)
    })()
  }, [])

  if (booting) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bgApp }} />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bgApp }}>
        <StatusBar style="light" />
        {route.name === "books" ? (
          <BooksScreen
            session={session}
            onOpenBook={(project) => setRoute({ name: "discuss", project })}
            onOpenSettings={() => setRoute({ name: "settings" })}
          />
        ) : null}
        {route.name === "settings" ? (
          <SettingsScreen
            session={session}
            onBack={() => setRoute({ name: "books" })}
            onSave={(next) => {
              void saveSession(next)
              setSession(next)
            }}
            onResetDefaults={() => {
              void clearSession()
              setSession(DEFAULT_SESSION)
            }}
          />
        ) : null}
        {route.name === "discuss" ? (
          <DiscussScreen
            session={session}
            project={route.project}
            onBack={() => setRoute({ name: "books" })}
            onOpenChapters={() => setRoute({ name: "chapters", project: route.project })}
          />
        ) : null}
        {route.name === "chapters" ? (
          <ChaptersScreen
            session={session}
            project={route.project}
            onBack={() => setRoute({ name: "discuss", project: route.project })}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}
