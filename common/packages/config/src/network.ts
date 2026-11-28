import { z } from "zod"

/** App-level model HTTP transport prefs (单次请求超时 + 总尝试次数). */
export const networkSettingsSchema = z.object({
  /** Per-request HTTP timeout in milliseconds. */
  requestTimeoutMs: z.number().int().positive().max(7_200_000),
  /** Total transport attempts including the first try. */
  maxAttempts: z.number().int().min(1).max(10),
})
export type NetworkSettings = z.infer<typeof networkSettingsSchema>

export const defaultNetworkSettings = Object.freeze({
  requestTimeoutMs: 300_000,
  maxAttempts: 4,
} as const satisfies NetworkSettings)

export function parseNetworkSettings(raw: unknown): NetworkSettings {
  const parsed = networkSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...defaultNetworkSettings }
}
