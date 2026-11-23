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
    // Integration-heavy chapter/turn suites seed a workspace prompt library,
    // run SQLite fixtures, and inject per-stage skills; full parallel runs on
    // Windows can exceed 30s for a single heavy test.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
