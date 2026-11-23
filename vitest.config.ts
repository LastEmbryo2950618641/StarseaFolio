import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    include: [
      "win/**/test/**/*.test.ts",
      "common/**/test/**/*.test.ts",
      "scripts/**/test/**/*.test.mjs",
    ],
    passWithNoTests: false,
    // Integration-heavy chapter/turn suites seed a workspace prompt library and
    // SQLite fixtures; 5s default is too tight on Windows filesystems.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
