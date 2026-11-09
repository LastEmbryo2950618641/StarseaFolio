import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { loadEnvFile } from "node:process"
import { randomUUID } from "node:crypto"
import { fileURLToPath, pathToFileURL } from "node:url"

// Preview the shared mobile workbench against this checkout's backend.
// The backend is bound to loopback; Vite proxies it for LAN phone previews.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const envFile = join(repository, ".env")
if (existsSync(envFile)) loadEnvFile(envFile)
const appData = resolve(process.env.WORLDSEED_APP_DATA_ROOT
  ?? join(process.env.APPDATA ?? join(homedir(), ".config"), "StarseaFolio", "runtime"))
let booksRoot = join(homedir(), ".worldseed")
try {
  const settings = JSON.parse(await readFile(join(appData, "app-settings.json"), "utf8"))
  if (typeof settings.activeWorkDirectory === "string") booksRoot = settings.activeWorkDirectory
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
const { startHttpBackend } = await import(pathToFileURL(join(repository, "common/backend/dist/bootstrap/http-entry.js")).href)
const token = randomUUID()
const backend = await startHttpBackend({
  ...process.env,
  WORLDSEED_APP_DATA_ROOT: appData,
  WORLDSEED_HTTP_HOST: "127.0.0.1",
  WORLDSEED_HTTP_PORT: process.env.WORLDSEED_ANDROID_BACKEND_PORT ?? "8787",
  WORLDSEED_API_TOKEN: token,
  WORLDSEED_API_TOKENS: "",
  WORLDSEED_AUTOMATIC_EVOLUTION_ENABLED: "false",
})
const requireWeb = createRequire(join(repository, "common/web/package.json"))
const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href)
let server
try {
  server = await createServer({
    root: join(repository, "common/web"),
    configFile: join(repository, "common/web/vite.config.ts"),
    mode: "android",
    define: {
      "import.meta.env.VITE_WORLDSEED_API_BASE_URL": JSON.stringify("/api"),
      "import.meta.env.VITE_WORLDSEED_BOOKS_ROOT": JSON.stringify(booksRoot),
    },
    server: {
      host: "0.0.0.0", port: 8081, strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backend.port}`, ws: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
  })
  await server.listen()
  server.printUrls()
} catch (error) {
  await backend.transport.close()
  throw error
}
async function close() {
  await server.close()
  await backend.transport.close()
  process.exit(0)
}
process.once("SIGINT", () => { void close() })
process.once("SIGTERM", () => { void close() })
