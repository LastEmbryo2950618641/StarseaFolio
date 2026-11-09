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
  },
})
