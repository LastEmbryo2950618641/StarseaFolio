import { useEffect, useState } from "react"

import {
  defaultNetworkSettings,
  parseNetworkSettings,
  type NetworkSettings,
} from "@starseafolio/config"

const STORAGE_KEY = "worldseed.networkPreferences.v1"

export type { NetworkSettings }

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = { ...defaultNetworkSettings }

export function loadNetworkPreferences(): NetworkSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return { ...DEFAULT_NETWORK_SETTINGS }
    return parseNetworkSettings(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_NETWORK_SETTINGS }
  }
}

export function saveNetworkPreferences(settings: NetworkSettings): NetworkSettings {
  const next = parseNetworkSettings(settings)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore quota / private-mode write failures; in-memory value still applies this session.
  }
  return next
}

export function useNetworkPreferences(): readonly [
  NetworkSettings,
  (patch: Partial<NetworkSettings>) => NetworkSettings,
] {
  const [preferences, setPreferences] = useState<NetworkSettings>(() => loadNetworkPreferences())

  useEffect(() => {
    saveNetworkPreferences(preferences)
  }, [preferences])

  const update = (patch: Partial<NetworkSettings>): NetworkSettings => {
    let next = preferences
    setPreferences((current) => {
      next = parseNetworkSettings({ ...current, ...patch })
      return next
    })
    return next
  }

  return [preferences, update]
}
