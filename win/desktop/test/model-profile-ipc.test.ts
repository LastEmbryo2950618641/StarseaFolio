import { expect, it, vi } from "vitest"
import type { ClientRequest } from "@starseafolio/contracts"

import type { BackendProcess } from "../src/main/backend-process.js"
import type { FileCredentialVault } from "../src/main/credential-vault.js"
import { registerIpcRouter } from "../src/main/ipc-router.js"

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
}))

vi.mock("electron", () => ({
  app: {},
  dialog: {},
  net: {},
  shell: {},
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => { handlers.set(channel, handler) } },
}))

it("returns the committed custom selection and 3M context from the desktop save", async () => {
  const custom = {
    id: "custom",
    name: "Custom service",
    baseUrl: "https://example.test/v1",
    model: "manual-model",
    credentialRef: "model-profile:custom",
    contextWindowTokens: 3_000_000,
  }
  const deepSeek = {
    ...custom,
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    credentialRef: "model-profile:deepseek",
    contextWindowTokens: 1_000_000,
  }
  const invoke = vi.fn(async (request: ClientRequest) => {
    if (request.method !== "model.profiles.save") throw new Error(`Unexpected ${request.method}`)
    return { ok: true, data: request.payload }
  })
  const vault = { has: vi.fn(async (ref: string) => ref === custom.credentialRef), set: vi.fn(), remove: vi.fn() }
  registerIpcRouter({ invoke } as unknown as BackendProcess, {} as Parameters<typeof registerIpcRouter>[1], vault as unknown as FileCredentialVault, "unused")
  const save = handlers.get("worldseed:model-profiles:save")
  if (save === undefined) throw new Error("Missing model profiles save handler")

  await expect(save(undefined, {
    profiles: [{ ...deepSeek, apiKey: "", hasApiKey: false }, { ...custom, apiKey: "test-key", hasApiKey: true }],
    activeProfileId: custom.id,
  })).resolves.toMatchObject({
    activeProfileId: custom.id,
    profiles: [expect.objectContaining({ id: deepSeek.id }), { ...custom, apiKey: "", hasApiKey: true }],
  })
  expect(invoke).toHaveBeenCalledOnce()
  expect(vault.set).toHaveBeenCalledWith(custom.credentialRef, "test-key")
  expect(invoke.mock.calls[0]?.[0].payload).not.toHaveProperty("profiles.1.apiKey")
})
