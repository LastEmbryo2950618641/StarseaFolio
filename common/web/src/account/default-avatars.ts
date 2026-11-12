type AvatarKind = "orbit" | "crest" | "quartz" | "tide" | "lantern" | "grove"

const specs: readonly { id: string, background: string, accent: string, kind: AvatarKind }[] = [
  { id: "orbit", background: "#0f766e", accent: "#99f6e4", kind: "orbit" },
  { id: "crest", background: "#b45309", accent: "#fde68a", kind: "crest" },
  { id: "quartz", background: "#6d28d9", accent: "#ddd6fe", kind: "quartz" },
  { id: "tide", background: "#1d4ed8", accent: "#bfdbfe", kind: "tide" },
  { id: "lantern", background: "#be123c", accent: "#fecdd3", kind: "lantern" },
  { id: "grove", background: "#3f6212", accent: "#d9f99d", kind: "grove" },
]

function shape(kind: AvatarKind, accent: string): string {
  switch (kind) {
    case "orbit":
      return `<circle cx="64" cy="64" r="18" fill="none" stroke="${accent}" stroke-width="8"/><circle cx="64" cy="28" r="7" fill="${accent}"/>`
    case "crest":
      return `<path d="M64 28 L92 84 H36 Z" fill="${accent}"/>`
    case "quartz":
      return `<path d="M64 26 L90 46 L80 86 H48 L38 46 Z" fill="${accent}"/>`
    case "tide":
      return `<path d="M24 72c12-18 20-18 32 0s20 18 32 0 20-18 16 0v28H24Z" fill="${accent}"/>`
    case "lantern":
      return `<rect x="48" y="36" width="32" height="44" rx="10" fill="${accent}"/><rect x="58" y="26" width="12" height="12" rx="3" fill="${accent}"/>`
    case "grove":
      return `<circle cx="64" cy="56" r="22" fill="${accent}"/><rect x="58" y="76" width="12" height="24" rx="4" fill="${accent}"/>`
  }
}

export const defaultAvatars: readonly { id: string, dataUrl: string }[] = specs.map((spec) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${spec.background}"/>${shape(spec.kind, spec.accent)}</svg>`
  return { id: spec.id, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }
})
