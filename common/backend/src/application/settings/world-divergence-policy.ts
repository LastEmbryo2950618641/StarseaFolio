import type { AIPhase, ProjectSettings, WorldDivergenceMode } from "@starseafolio/contracts"
import { renderRuntimePrompt } from "../../core/runtime-prompt.js"

export function resolveWorldDivergenceMode(
  projectSettings: ProjectSettings | undefined,
): WorldDivergenceMode {
  return projectSettings?.execution.worldDivergenceMode ?? "world_consistent"
}

export function allowsSettingsCreate(mode: WorldDivergenceMode): boolean {
  return mode !== "strict"
}

/** Phase appendix injected after the static phase prompt for draft / settings_extraction. */
export function worldDivergencePhaseAppendix(
  mode: WorldDivergenceMode,
  phase: AIPhase,
): string | undefined {
  if (phase !== "draft" && phase !== "settings_extraction") return undefined
  const section = mode.replaceAll("_", "-")
  const stage = phase === "settings_extraction" ? "extraction" : "draft"
  return [
    renderRuntimePrompt("world-divergence", "heading"),
    renderRuntimePrompt("world-divergence", section),
    renderRuntimePrompt("world-divergence", `${section}-${stage}`),
  ].join("\n")
}
