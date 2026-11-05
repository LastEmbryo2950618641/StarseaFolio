const COVER_WIDTH = 600
const COVER_HEIGHT = 800

/** Generate a deterministic cover for projects that do not have a custom image yet. */
export function defaultBookCoverSrc(displayName: string): string {
  const title = displayName.trim() || "未命名作品"
  const colors = paletteFor(title)
  const lines = splitTitle(title)
  const titleMarkup = lines
    .map((line, index) => `<text x="72" y="${String(530 + index * 62)}" class="title">${escapeXml(line)}</text>`)
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(COVER_WIDTH)}" height="${String(COVER_HEIGHT)}" viewBox="0 0 ${String(COVER_WIDTH)} ${String(COVER_HEIGHT)}">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.background}"/>
      <stop offset="1" stop-color="${colors.deep}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.accent}" stop-opacity=".9"/>
      <stop offset="1" stop-color="${colors.secondary}" stop-opacity=".2"/>
    </linearGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="#ffffff" stroke-opacity=".07" stroke-width="1"/>
    </pattern>
    <style>
      .title { fill: #f7f4ed; font: 700 38px 'Microsoft YaHei', 'Noto Sans SC', sans-serif; letter-spacing: 1px; }
      .label { fill: #f7f4ed; font: 600 14px 'Microsoft YaHei', 'Noto Sans SC', sans-serif; letter-spacing: 4px; opacity: .78; }
    </style>
  </defs>
  <rect width="600" height="800" fill="url(#paper)"/>
  <rect x="26" y="26" width="548" height="748" rx="5" fill="none" stroke="#ffffff" stroke-opacity=".28"/>
  <rect x="26" y="26" width="548" height="748" fill="url(#grid)"/>
  <path d="M-50 310L650 40L650 270L-50 540Z" fill="url(#glow)" opacity=".78"/>
  <circle cx="454" cy="194" r="112" fill="none" stroke="${colors.accent}" stroke-opacity=".5" stroke-width="2"/>
  <circle cx="454" cy="194" r="72" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="1"/>
  <path d="M454 94V294M354 194H554" stroke="#ffffff" stroke-opacity=".18"/>
  <path d="M72 110H230M72 132H180" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>
  <text x="72" y="96" class="label">WORLDSEED · ORIGINAL</text>
  <path d="M72 450H528" stroke="#ffffff" stroke-opacity=".35"/>
  ${titleMarkup}
  <text x="72" y="694" class="label">一部未完待续的故事</text>
  <path d="M72 716H220" stroke="${colors.accent}" stroke-width="4"/>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function splitTitle(title: string): string[] {
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title),
    ({ segment }) => segment,
  )
  if (characters.length <= 9) return [title]
  return [characters.slice(0, Math.ceil(characters.length / 2)).join(""), characters.slice(Math.ceil(characters.length / 2), 18).join("")]
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

function paletteFor(title: string): Readonly<{ background: string; deep: string; accent: string; secondary: string }> {
  let hash = 0
  for (const character of title) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  const palettes = [
    { background: "#263748", deep: "#101820", accent: "#e3b56d", secondary: "#79a8b7" },
    { background: "#3a2b3e", deep: "#171521", accent: "#e7a3a8", secondary: "#8e9bd0" },
    { background: "#33433d", deep: "#151f20", accent: "#d5ba73", secondary: "#82b4a5" },
    { background: "#49362d", deep: "#20191c", accent: "#e1a36f", secondary: "#86a7b4" },
  ] as const
  return palettes[hash % palettes.length] ?? palettes[0]
}
