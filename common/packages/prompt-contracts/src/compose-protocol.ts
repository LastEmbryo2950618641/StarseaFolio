/** Pure-text compose protocol for discussion turns. HTML tags delimit three sections. */
export const COMPOSE_TAGS = Object.freeze({
  synopsisStart: "<compose-synopsis>",
  synopsisEnd: "</compose-synopsis>",
  outlineStart: "<compose-outline>",
  outlineEnd: "</compose-outline>",
  draftStart: "<compose-draft>",
  draftEnd: "</compose-draft>",
} as const)

export type ComposeSection = "synopsis" | "outline" | "draft"
export type ComposeEvent =
  | Readonly<{ type: "section_start"; section: ComposeSection }>
  | Readonly<{ type: "section_end"; section: ComposeSection }>
  | Readonly<{ type: "section_delta"; section: ComposeSection; text: string }>
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "error"; message: string }>

type OpenSection = Readonly<{ section: ComposeSection; text: string }>

const TAG_ORDER: readonly ComposeSection[] = ["synopsis", "outline", "draft"]
const TAG_BY_SECTION: Readonly<Record<ComposeSection, Readonly<{ start: string; end: string }>>> = {
  synopsis: { start: COMPOSE_TAGS.synopsisStart, end: COMPOSE_TAGS.synopsisEnd },
  outline: { start: COMPOSE_TAGS.outlineStart, end: COMPOSE_TAGS.outlineEnd },
  draft: { start: COMPOSE_TAGS.draftStart, end: COMPOSE_TAGS.draftEnd },
}
const ALL_TAGS = TAG_ORDER.flatMap((section) => [TAG_BY_SECTION[section].start, TAG_BY_SECTION[section].end])

/**
 * Incremental parser. Tags may be split across model chunks; only complete tags
 * change state. Text outside sections is returned as plain text.
 */
export class ComposeStreamParser {
  private buffer = ""
  private open: OpenSection | undefined
  private nextIndex = 0
  private readonly completed = new Map<ComposeSection, string>()

  public constructor(private readonly expectedSections: readonly ComposeSection[] = TAG_ORDER) {}

  public push(delta: string): readonly ComposeEvent[] {
    this.buffer += delta
    return this.consume(false)
  }

  public finish(): readonly ComposeEvent[] {
    const events = this.consume(true)
    if (this.open !== undefined) {
      events.push({ type: "error", message: `未闭合的构思段：${this.open.section}` })
    }
    return events
  }

  public sections(): Readonly<Partial<Record<ComposeSection, string>>> {
    return Object.fromEntries(this.completed)
  }

  private consume(final: boolean): ComposeEvent[] {
    const events: ComposeEvent[] = []
    let index = 0
    while (index < this.buffer.length) {
      const tag = ALL_TAGS.find((candidate) => this.buffer.startsWith(candidate, index))
      if (tag !== undefined) {
        this.applyTag(tag, events)
        index += tag.length
        continue
      }
      const rest = this.buffer.slice(index)
      if (!final && rest.startsWith("<") && ALL_TAGS.some((candidate) => candidate.startsWith(rest))) {
        break
      }
      const next = rest.indexOf("<", 1)
      const text = next < 0 ? rest : rest.slice(0, next)
      if (text.length > 0) {
        this.appendText(text, events)
        index += text.length
      } else {
        index += 1
      }
    }
    this.buffer = this.buffer.slice(index)
    return events
  }

  private applyTag(tag: string, events: ComposeEvent[]): void {
    const section = TAG_ORDER.find((candidate) => TAG_BY_SECTION[candidate].start === tag
      || TAG_BY_SECTION[candidate].end === tag)
    if (section === undefined) return
    const isStart = TAG_BY_SECTION[section].start === tag
    if (isStart) {
      if (this.open !== undefined) {
        events.push({ type: "error", message: `标签嵌套或未闭合：${this.open.section}` })
        return
      }
      if (this.expectedSections[this.nextIndex] !== section) {
        events.push({ type: "error", message: `构思段顺序错误：${section}` })
        return
      }
      this.open = { section, text: "" }
      events.push({ type: "section_start", section })
      return
    }
    if (this.open?.section !== section) {
      events.push({ type: "error", message: `结束标签与当前段不匹配：${section}` })
      return
    }
    this.completed.set(section, this.open.text)
    this.open = undefined
    this.nextIndex += 1
    events.push({ type: "section_end", section })
  }

  private appendText(text: string, events: ComposeEvent[]): void {
    if (this.open === undefined) {
      events.push({ type: "text", text })
      return
    }
    this.open = { section: this.open.section, text: this.open.text + text }
    events.push({ type: "section_delta", section: this.open.section, text })
  }
}

export function parseComposeDocument(markdown: string, expectedSections?: readonly ComposeSection[]): Readonly<{
  sections: Readonly<Partial<Record<ComposeSection, string>>>
  text: string
  errors: readonly string[]
}> {
  const parser = new ComposeStreamParser(expectedSections)
  const events = [...parser.push(markdown), ...parser.finish()]
  return {
    sections: parser.sections(),
    text: events.filter((event): event is Extract<ComposeEvent, { type: "text" }> => event.type === "text")
      .map((event) => event.text).join(""),
    errors: events.filter((event): event is Extract<ComposeEvent, { type: "error" }> => event.type === "error")
      .map((event) => event.message),
  }
}

export function stripComposeTags(markdown: string): string {
  return ALL_TAGS.reduce((text, tag) => text.replaceAll(tag, ""), markdown)
}
