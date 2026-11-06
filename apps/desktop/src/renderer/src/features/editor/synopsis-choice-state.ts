import type { SynopsisConversationChoice, SynopsisConversationMessage } from "@worldseed/contracts"

export type ChoiceVariant = Readonly<{
  original: string
  edited: string
  active: "ai" | "user"
}>

export type ChoiceStorage = Pick<Storage, "getItem" | "setItem">

export function choiceIdentity(
  workspace: string | undefined,
  message: Pick<SynopsisConversationMessage, "projectId" | "sessionId" | "messageId">,
  choice: SynopsisConversationChoice | "your-idea" | "custom-style",
  occurrence = 0,
): string {
  // Keep the full identity: labels, indices, or hashes alone can collide across refreshed messages.
  return JSON.stringify([
    workspace ?? null, message.projectId, message.sessionId, message.messageId,
    typeof choice === "string" ? choice : [
      choice.label, choice.action, choice.chapterSequence ?? null,
      choice.workStyleSelection === undefined ? null : [
        choice.workStyleSelection.novelMajorCategoryRulePath,
        choice.workStyleSelection.novelSubcategoryRulePath,
        choice.workStyleSelection.proseStyleRulePath,
      ],
      (choice as SynopsisConversationChoice & { setupQuestionId?: string }).setupQuestionId ?? null,
    ],
    occurrence,
  ])
}

function storageKey(identity: string): string {
  return `worldseed.creation-desk.choice.v1:${identity}`
}

export function loadChoiceVariant(identity: string, original: string, storage?: ChoiceStorage): ChoiceVariant {
  const fallback: ChoiceVariant = { original, edited: original, active: "ai" }
  try {
    const raw = (storage ?? window.localStorage).getItem(storageKey(identity))
    if (raw === null) return fallback
    const saved: unknown = JSON.parse(raw)
    if (saved === null || typeof saved !== "object") return fallback
    const value = saved as Record<string, unknown>
    if (value.original !== original || typeof value.edited !== "string"
      || (value.active !== "ai" && value.active !== "user")) return fallback
    return { original, edited: value.edited, active: value.active }
  } catch {
    return fallback
  }
}

export function persistChoiceVariant(identity: string, variant: ChoiceVariant, storage?: ChoiceStorage): void {
  try {
    (storage ?? window.localStorage).setItem(storageKey(identity), JSON.stringify(variant))
  } catch {
    // Editing remains available when local storage is disabled or full.
  }
}

export function formatChoiceStyle(selection: SynopsisConversationChoice["workStyleSelection"]): string {
  if (selection === undefined) return ""
  return `我选择的风格组合是：小说大类规则「${selection.novelMajorCategoryRulePath}」、小说次大类规则「${selection.novelSubcategoryRulePath}」、笔风规则「${selection.proseStyleRulePath}」。请按这三份规则继续。`
}

/** These are draft contributions; no choice is permitted to execute a callback. */
export function choiceContribution(choice: SynopsisConversationChoice): string {
  if (choice.workStyleSelection !== undefined) return formatChoiceStyle(choice.workStyleSelection)
  if (choice.action === "confirm_synopsis") return "用这份梗概写细纲"
  if (choice.action === "start_turn") return "按细纲写正文"
  return choice.label
}

export function latestSetupQuestionId(messages: readonly SynopsisConversationMessage[]): string | undefined {
  const latest = [...messages].reverse().find((message) => message.hidden !== true && message.role === "assistant")
  return latest?.choices?.map((choice) => (
    choice as SynopsisConversationChoice & { setupQuestionId?: string }
  ).setupQuestionId).find((id) => typeof id === "string" && id.length > 0)
}

type DraftPart = Readonly<{ text: string; owner: string | null; separator?: true }>

const textOf = (parts: readonly DraftPart[]): string => parts.map((part) => part.text).join("")

function cleanParts(parts: readonly DraftPart[]): DraftPart[] {
  const result: DraftPart[] = []
  for (const part of parts) {
    if (part.text.length === 0) continue
    if (part.separator && (result.length === 0 || result.at(-1)?.text.endsWith("\n"))) continue
    const previous = result.at(-1)
    if (previous && previous.owner === part.owner && previous.separator === part.separator) {
      result[result.length - 1] = { ...previous, text: previous.text + part.text }
    } else result.push(part)
  }
  while (result.at(-1)?.separator) result.pop()
  return result
}

function sliceParts(parts: readonly DraftPart[], start: number, end: number): DraftPart[] {
  const result: DraftPart[] = []
  let position = 0
  for (const part of parts) {
    const from = Math.max(start - position, 0)
    const to = Math.min(end - position, part.text.length)
    if (to > from) result.push({ ...part, text: part.text.slice(from, to) })
    position += part.text.length
    if (position >= end) break
  }
  return result
}

export function createChoiceComposer() {
  let parts: readonly DraftPart[] = []
  let selected: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  const replaceContribution = (identity: string, text: string): void => {
    if (!selected.has(identity)) return
    const first = parts.findIndex((part) => part.owner === identity)
    const before = parts.slice(0, first < 0 ? parts.length : first).filter((part) => part.owner !== identity)
    const after = first < 0 ? [] : parts.slice(first).filter((part) => part.owner !== identity)
    const prefix = textOf(before)
    const needsSeparator = first < 0 || parts[first]?.separator === true
    parts = cleanParts([
      ...before,
      ...(needsSeparator && text.length > 0 && prefix.length > 0 && !prefix.endsWith("\n")
        ? [{ text: "\n", owner: identity, separator: true as const }] : []),
      { text, owner: identity },
      ...after,
    ])
    notify()
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getDraft: (): string => textOf(parts),
    getSelected: (): ReadonlySet<string> => selected,
    toggle(identity: string, text: string): void {
      if (selected.has(identity)) {
        selected = new Set([...selected].filter((id) => id !== identity))
        parts = cleanParts(parts.filter((part) => part.owner !== identity))
        notify()
      } else {
        selected = new Set([...selected, identity])
        replaceContribution(identity, text)
      }
    },
    replaceContribution,
    /** Apply a textarea edit without ever assigning manually inserted characters to a choice. */
    editDraft(next: string, caret?: number): void {
      const previous = textOf(parts)
      if (next === previous) return
      if (next.length === 0) {
        parts = []
        selected = new Set()
        notify()
        return
      }
      let start = 0
      let oldEnd = previous.length
      let newEnd = next.length
      // The caret disambiguates typing an identical copy immediately before/after a contribution.
      const candidateOldEnd = caret === undefined ? -1 : caret + previous.length - next.length
      if (caret !== undefined && candidateOldEnd >= 0 && candidateOldEnd <= previous.length
        && previous.slice(candidateOldEnd) === next.slice(caret)) {
        oldEnd = candidateOldEnd
        newEnd = caret
      }
      while (start < oldEnd && start < newEnd && previous[start] === next[start]) start += 1
      while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
        oldEnd -= 1
        newEnd -= 1
      }
      // Do not normalize whitespace during typing: even generated newlines can be user-edited.
      parts = [
        ...sliceParts(parts, 0, start),
        { text: next.slice(start, newEnd), owner: null },
        ...sliceParts(parts, oldEnd, previous.length),
      ].filter((part) => part.text.length > 0)
      notify()
    },
    reset(text = ""): void {
      parts = text.length === 0 ? [] : [{ text, owner: null }]
      selected = new Set()
      notify()
    },
  }
}

export type ChoiceComposer = ReturnType<typeof createChoiceComposer>
