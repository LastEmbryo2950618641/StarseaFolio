import { randomBytes, randomInt } from "node:crypto"

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const TTL_MS = 5 * 60 * 1000

function captchaImage(code) {
  const letters = [...code].map((character, index) => {
    const x = 16 + index * 28
    const y = 32 + randomInt(-4, 5)
    const rotation = randomInt(-16, 17)
    return `<text x="${x}" y="${y}" fill="#d6deeb" font-size="26" font-family="sans-serif" transform="rotate(${rotation} ${x} ${y})">${character}</text>`
  }).join("")
  const noise = Array.from({ length: 4 }, () => (
    `<line x1="${randomInt(0, 128)}" y1="${randomInt(0, 48)}" x2="${randomInt(0, 128)}" y2="${randomInt(0, 48)}" stroke="#6b7280" stroke-width="1"/>`
  )).join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="48" viewBox="0 0 128 48"><rect width="128" height="48" rx="6" fill="#1e1f22"/>${noise}${letters}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function createCaptchaStore() {
  const entries = new Map()
  return {
    issue() {
      const now = Date.now()
      for (const [id, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(id)
      }
      const code = Array.from({ length: 4 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("")
      const id = randomBytes(16).toString("hex")
      entries.set(id, { code, expiresAt: now + TTL_MS })
      return { id, image: captchaImage(code) }
    },
    take(id, code) {
      const entry = entries.get(typeof id === "string" ? id : "")
      if (entry === undefined) return false
      entries.delete(id)
      if (entry.expiresAt <= Date.now()) return false
      return entry.code.toLowerCase() === String(code ?? "").trim().toLowerCase()
    },
    codeFor(id) {
      return entries.get(id)?.code
    },
  }
}
