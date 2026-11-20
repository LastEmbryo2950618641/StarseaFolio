import { memo, useMemo, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

const CACHE_LIMIT = 64
const markdownCache = new Map<string, ReactNode>()

function remember(key: string, node: ReactNode): ReactNode {
  if (markdownCache.has(key)) markdownCache.delete(key)
  markdownCache.set(key, node)
  if (markdownCache.size > CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value
    if (oldest !== undefined) markdownCache.delete(oldest)
  }
  return node
}

/** Space-for-time: reuse parsed markdown trees for unchanged segment text. */
export const CachedMarkdown = memo(function CachedMarkdown(props: Readonly<{
  text: string
  className?: string
}>): React.JSX.Element {
  const body = useMemo(() => {
    const cached = markdownCache.get(props.text)
    if (cached !== undefined) {
      // Refresh LRU order.
      markdownCache.delete(props.text)
      markdownCache.set(props.text, cached)
      return cached
    }
    return remember(props.text, <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.text}</ReactMarkdown>)
  }, [props.text])

  return props.className === undefined
    ? <>{body}</>
    : <div className={props.className}>{body}</div>
})
