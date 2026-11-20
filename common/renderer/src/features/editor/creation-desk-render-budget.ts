/** Keep the last N history bubbles mounted; older ones stay collapsed stubs. */
export const CREATION_DESK_MESSAGE_WINDOW = 24

/** Live thinking markdown above this length only keeps the tail mounted. */
export const CREATION_DESK_THINKING_STREAM_FULL_CHARS = 4_000
export const CREATION_DESK_THINKING_STREAM_TAIL_CHARS = 2_500

export function windowCreationDeskMessages<T>(
  messages: readonly T[],
  expanded: boolean,
  windowSize: number = CREATION_DESK_MESSAGE_WINDOW,
): Readonly<{ visible: readonly T[]; hiddenCount: number }> {
  if (expanded || messages.length <= windowSize) {
    return { visible: messages, hiddenCount: 0 }
  }
  return {
    visible: messages.slice(-windowSize),
    hiddenCount: messages.length - windowSize,
  }
}

export function truncateThinkingForLiveRender(
  text: string,
  streaming: boolean,
): Readonly<{ text: string; truncated: boolean }> {
  if (!streaming || text.length <= CREATION_DESK_THINKING_STREAM_FULL_CHARS) {
    return { text, truncated: false }
  }
  return {
    text: text.slice(-CREATION_DESK_THINKING_STREAM_TAIL_CHARS),
    truncated: true,
  }
}
