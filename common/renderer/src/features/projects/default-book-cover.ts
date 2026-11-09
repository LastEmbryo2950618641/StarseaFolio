const COVER_WIDTH = 600
const COVER_HEIGHT = 800

/** Generate a deterministic flat-color cover for projects without a custom image. */
export function defaultBookCoverSrc(displayName: string): string {
  const title = displayName.trim() || "未命名作品"
  const colors = paletteFor(title)
  const lines = splitTitle(title)
  const titleMarkup = lines
    .map((line, index) => `<text x="64" y="${String(594 + index * 58)}" class="title">${escapeXml(line)}</text>`)
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(COVER_WIDTH)}" height="${String(COVER_HEIGHT)}" viewBox="0 0 ${String(COVER_WIDTH)} ${String(COVER_HEIGHT)}">
  <style>
    .title { fill: ${colors.ink}; font: 700 42px 'Microsoft YaHei', 'Noto Sans SC', sans-serif; }
    .brand { fill: ${colors.ink}; font: 600 13px 'Arial', sans-serif; letter-spacing: 2px; opacity: .72; }
  </style>
  <rect width="600" height="800" fill="${colors.background}"/>
  <path d="M0 0H600V260L0 500Z" fill="${colors.shape}"/>
  <path d="M0 500L600 260V800H0Z" fill="${colors.accent}"/>
  <path d="M414 0H600V260L414 334Z" fill="${colors.highlight}"/>
  <text x="64" y="78" class="brand">StarseaFolio</text>
  <rect x="64" y="524" width="54" height="5" fill="${colors.ink}"/>
  ${titleMarkup}
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function splitTitle(title: string): string[] {
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title),
    ({ segment }) => segment,
  )
  if (characters.length <= 9) return [title]
  const midpoint = Math.ceil(characters.length / 2)
  return [characters.slice(0, midpoint).join(""), characters.slice(midpoint, 18).join("")]
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character)
}

function paletteFor(title: string): Readonly<{
  background: string
  shape: string
  accent: string
  highlight: string
  ink: string
}> {
  let hash = 0
  for (const character of title) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  const palettes = [
    { background: "#2537c9", shape: "#435cf1", accent: "#f3c744", highlight: "#39c982", ink: "#ffffff" },
    { background: "#a62972", shape: "#e34791", accent: "#ffd34f", highlight: "#35c9cf", ink: "#ffffff" },
    { background: "#087b91", shape: "#08a9a3", accent: "#ffb83f", highlight: "#ff5e79", ink: "#ffffff" },
    { background: "#5736bd", shape: "#8054ed", accent: "#ffbd45", highlight: "#f14f73", ink: "#ffffff" },
  ] as const
  return palettes[hash % palettes.length] ?? palettes[0]
}
