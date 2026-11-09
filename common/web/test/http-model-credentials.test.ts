import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION, clientRequestSchema } from "@worldseed/contracts"
import { installHttpWorldseedBridge } from "../src/bridge/http-worldseed.js"

const secrets = vi.hoisted(() => new Map<string, string>())
vi.mock("../src/bridge/browser-model-credentials.js", () => ({
  browserModelCredentials: (scope: string) => ({
    get: (ref: string) => Promise.resolve(secrets.get(`${scope}:${ref}`)),
    set: (ref: string, value: string) => { secrets.set(`${scope}:${ref}`, value); return Promise.resolve() },
    remove: (ref: string) => { secrets.delete(`${scope}:${ref}`); return Promise.resolve() },
  }),
}))

const session = { apiBaseUrl: "https://backend.example", apiToken: "test-session" }
const profile = {
  id: "chosen", name: "Chosen provider", baseUrl: "https://provider.example", model: "chosen-model",
  credentialRef: "profile:chosen", apiProtocol: "openai_responses" as const,
  contextWindowTokens: 200_000, thinkingModeEnabled: false, reasoningEffort: "low" as const,
  jsonModeEnabled: false, disableResponseStorage: true, serviceTier: "auto" as const,
}
let requests: Array<{ method: string; payload: unknown }>
beforeEach(() => {
  secrets.clear()
  requests = []
  vi.stubGlobal("window", {})
  vi.stubGlobal("fetch", vi.fn((_url: string, options: { body: string }) => {
    const request = clientRequestSchema.parse(JSON.parse(options.body))
    requests.push(request)
    const data = request.method.startsWith("model.profiles.")
      ? { profiles: [profile], activeProfileId: profile.id }
      : { models: [{ id: profile.model }] }
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, ok: true, data }) })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe("HTTP model credentials", () => {
  it("reports missing credentials honestly and does not expose saved keys", async () => {
    const bridge = installHttpWorldseedBridge(session)
    expect((await bridge.readModelProfiles()).profiles[0]?.hasApiKey).toBe(false)
    secrets.set(`${session.apiBaseUrl}:${profile.credentialRef}`, "test-secret")
    expect((await bridge.readModelProfiles()).profiles[0]).toMatchObject({ hasApiKey: true, apiKey: "" })
  })

  it("persists a supplied key separately from profile metadata and retains it across bridge reloads", async () => {
    const bridge = installHttpWorldseedBridge(session)
    const saved = await bridge.saveModelProfiles({ profiles: [{ ...profile, apiKey: " test-secret ", hasApiKey: true }], activeProfileId: profile.id })
    expect(secrets.get(`${session.apiBaseUrl}:${profile.credentialRef}`)).toBe("test-secret")
    expect(requests.find((request) => request.method === "model.profiles.save")?.payload).toEqual({ profiles: [profile], activeProfileId: profile.id })
    expect(saved.profiles[0]).toMatchObject({ apiKey: "", hasApiKey: true })
    const reloaded = installHttpWorldseedBridge(session)
    await reloaded.saveModelProfiles({ profiles: [{ ...profile, apiKey: "", hasApiKey: true }], activeProfileId: profile.id })
    expect((await reloaded.readModelProfiles()).profiles[0]?.hasApiKey).toBe(true)
  })

  it("preserves the selected model and resolves its key before sending model work", async () => {
    secrets.set(`${session.apiBaseUrl}:${profile.credentialRef}`, "test-secret")
    const bridge = installHttpWorldseedBridge(session)
    await bridge.invoke({ protocolVersion: PROTOCOL_VERSION, requestId: crypto.randomUUID(), method: "synopsis.conversation.send", payload: { model: profile, marker: "retain" } })
    expect(requests.at(-1)?.payload).toEqual({ model: { ...profile, apiKey: "test-secret" }, marker: "retain" })
  })

  it("resolves saved credentials when refreshing the model catalog", async () => {
    secrets.set(`${session.apiBaseUrl}:${profile.credentialRef}`, "test-secret")
    await installHttpWorldseedBridge(session).listModels({ baseUrl: profile.baseUrl, credentialRef: profile.credentialRef, apiKey: "" })
    expect(requests.at(-1)?.payload).toEqual({ baseUrl: profile.baseUrl, apiKey: "test-secret" })
  })

  it("blocks a missing credential before submitting work instead of silently dropping selection", async () => {
    const bridge = installHttpWorldseedBridge(session)
    await expect(bridge.invoke({ protocolVersion: PROTOCOL_VERSION, requestId: crypto.randomUUID(), method: "synopsis.conversation.send", payload: { model: profile } })).rejects.toThrow(/API Key/)
    expect(requests).toHaveLength(0)
  })

  it("clears a key when explicitly removed and keeps credentials isolated between backends", async () => {
    secrets.set(`${session.apiBaseUrl}:${profile.credentialRef}`, "test-secret")
    const other = installHttpWorldseedBridge({ ...session, apiBaseUrl: "https://other.example" })
    expect((await other.readModelProfiles()).profiles[0]?.hasApiKey).toBe(false)
    await installHttpWorldseedBridge(session).saveModelProfiles({ profiles: [{ ...profile, apiKey: "", hasApiKey: false }], activeProfileId: profile.id })
    expect(secrets.has(`${session.apiBaseUrl}:${profile.credentialRef}`)).toBe(false)
  })

  it("does not turn a read failure into a fictitious configured profile", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))
    await expect(installHttpWorldseedBridge(session).readModelProfiles()).rejects.toThrow("offline")
  })
})
