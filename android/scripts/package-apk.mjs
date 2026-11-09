import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import process from "node:process"
import console from "node:console"
import { repository, run, runCli } from "../../scripts/packaging/build-utils.mjs"

const options = process.argv.slice(2)
if (options.some((arg) => !["--debug", "--prepare-only", "--check"].includes(arg))) {
  throw new Error("Usage: pnpm package:apk [--debug] [--prepare-only] [--check]")
}
const mobile = join(repository, "android/mobile")
const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" }
// Do not load the repository .env: a distribution must not bake in development credentials.
env.EXPO_NO_DOTENV = "1"
if (!existsSync(join(mobile, "node_modules/expo/package.json"))) {
  throw new Error("Android dependencies missing; run npm --prefix android/mobile ci")
}
if (!options.includes("--prepare-only")) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || [
    join(env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "Android/Sdk"),
    join(homedir(), "Android/Sdk"), join(homedir(), "Library/Android/sdk"),
  ].find((path) => existsSync(path))
  if (!sdk || !existsSync(sdk)) throw new Error("Android SDK missing; install Android Studio/SDK and set ANDROID_HOME")
  env.ANDROID_HOME = resolve(sdk)
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME
  if (!env.JAVA_HOME) {
    const javac = (env.PATH ?? env.Path ?? "").split(delimiter)
      .map((path) => join(path, process.platform === "win32" ? "javac.exe" : "javac"))
      .find((path) => existsSync(path))
    if (javac) env.JAVA_HOME = dirname(dirname(javac))
  }
  await run(env.JAVA_HOME ? join(env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java", ["-version"], { env })
  console.log(`Android SDK: ${env.ANDROID_HOME}`)
}
if (options.includes("--check")) process.exit(0)

await runCli(repository, "typescript", "tsc", ["-b", "common/packages/contracts"])
// Native folders are generated, not hand-maintained; never use --clean over local edits.
const packagePath = join(mobile, "package.json")
const originalPackage = await readFile(packagePath, "utf8")
try {
  await runCli(mobile, "expo", "expo", ["prebuild", "--platform", "android", "--no-install"], env)
} finally {
  // Expo rewrites run scripts during prebuild; packaging must not edit tracked source.
  if (await readFile(packagePath, "utf8") !== originalPackage) await writeFile(packagePath, originalPackage)
}
if (options.includes("--prepare-only")) process.exit(0)

const architectures = env.STARSEAFOLIO_ANDROID_ARCHITECTURES ?? "arm64-v8a"
if (!architectures.split(",").every((arch) => ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].includes(arch))) {
  throw new Error("Invalid STARSEAFOLIO_ANDROID_ARCHITECTURES")
}
const debug = options.includes("--debug")
const variant = debug ? "debug" : "release"
const native = join(mobile, "android")
const wrapperProperties = join(native, "gradle/wrapper/gradle-wrapper.properties")
await writeFile(wrapperProperties, (await readFile(wrapperProperties, "utf8"))
  .replace(/gradle-([\d.]+)-all\.zip/u, "gradle-$1-bin.zip")
  .replace(/^networkTimeout=\d+/mu, "networkTimeout=120000"))
const gradleArgs = [debug ? ":app:assembleDebug" : ":app:assembleRelease", "--no-daemon", "--console=plain", `-PreactNativeArchitectures=${architectures}`]
// Launch the same generated Gradle wrapper through Java on every OS, without shell quoting.
const java = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java"
await run(java, ["-Xmx64m", "-Xms64m", "-Dorg.gradle.appname=gradlew", "-classpath",
  join(native, "gradle/wrapper/gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain", ...gradleArgs], { cwd: native, env })
const manifest = JSON.parse(await readFile(join(mobile, "package.json"), "utf8"))
const output = join(mobile, "release")
await mkdir(output, { recursive: true })
const artifact = join(output, `Starsea-Folio-${manifest.version}-Android-${debug ? "debug" : "preview"}.apk`)
await copyFile(join(native, `app/build/outputs/apk/${variant}/app-${variant}.apk`), artifact)
console.log(`APK: ${artifact}`)
console.log("Development APK uses the generated debug signing key; configure a stable private signing key before production distribution.")
