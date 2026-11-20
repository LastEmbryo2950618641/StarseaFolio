import { Editor, type Monaco } from "@monaco-editor/react"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Code2, Eye } from "lucide-react"
import { WORLDSEED_EDITOR_THEME, ensureWorldseedEditorTheme } from "../../monaco.js"
import { UiTooltip } from "../../components/UiTooltip.js"

export type MarkdownViewMode = "render" | "source"

const VIEW_MODE_STORAGE_KEY = "starseafolio.mdDocumentViewMode"

function readStoredViewMode(): MarkdownViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (raw === "source" || raw === "render") return raw
  } catch {
    // ignore storage failures
  }
  return "render"
}

function writeStoredViewMode(mode: MarkdownViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore storage failures
  }
}

type Props = Readonly<{
  content: string
  readOnly: boolean
  onContentChange(value: string): void
}>

export function MarkdownDocumentView(props: Props): React.JSX.Element {
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(() => readStoredViewMode())

  const switchMode = (mode: MarkdownViewMode): void => {
    setViewMode(mode)
    writeStoredViewMode(mode)
  }

  return (
    <div className="md-document-view" data-testid="md-document-view" data-mode={viewMode}>
      <div className="md-view-mode-float" role="toolbar" aria-label="文档视图">
        <UiTooltip label="渲染">
          <button
            type="button"
            className={viewMode === "render" ? "active" : ""}
            aria-label="渲染"
            aria-pressed={viewMode === "render"}
            data-testid="md-view-mode-render"
            onClick={() => { switchMode("render") }}
          >
            <Eye size={14} />
          </button>
        </UiTooltip>
        <UiTooltip label="源码">
          <button
            type="button"
            className={viewMode === "source" ? "active" : ""}
            aria-label="源码"
            aria-pressed={viewMode === "source"}
            data-testid="md-view-mode-source"
            onClick={() => { switchMode("source") }}
          >
            <Code2 size={14} />
          </button>
        </UiTooltip>
      </div>
      {viewMode === "source" ? (
        <Editor
          height="100%"
          language="markdown"
          theme={WORLDSEED_EDITOR_THEME}
          value={props.content}
          beforeMount={(monaco: Monaco) => { ensureWorldseedEditorTheme(monaco) }}
          onChange={(value: string | undefined) => { props.onContentChange(value ?? "") }}
          options={{
            readOnly: props.readOnly,
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 23,
            fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
            wordWrap: "on",
            padding: { top: 20, bottom: 20 },
            scrollBeyondLastLine: false,
            renderLineHighlight: "gutter",
            overviewRulerBorder: false,
            unicodeHighlight: {
              ambiguousCharacters: false,
              invisibleCharacters: false,
              nonBasicASCII: false,
            },
          }}
        />
      ) : (
        <MarkdownPreview content={props.content} />
      )}
    </div>
  )
}

function MarkdownPreview(props: Readonly<{ content: string }>): React.JSX.Element {
  return (
    <div className="md-document-preview" data-testid="md-document-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: MarkdownCode,
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  )
}

function MarkdownCode(props: Readonly<{
  className?: string | undefined
  children?: ReactNode
}>): React.JSX.Element {
  const className = props.className ?? ""
  const match = /language-(\w+)/.exec(className)
  const language = match?.[1]
  const code = String(props.children ?? "").replace(/\n$/, "")

  if (language === "mermaid") {
    return <MermaidDiagram chart={code} />
  }

  if (language !== undefined) {
    return (
      <pre className="md-document-pre">
        <code className={className}>{code}</code>
      </pre>
    )
  }

  return <code className="md-document-inline-code">{props.children}</code>
}

let mermaidReady: Promise<typeof import("mermaid").default> | undefined

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (mermaidReady === undefined) {
    mermaidReady = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        fontFamily: "inherit",
      })
      return mod.default
    })
  }
  return mermaidReady
}

function MermaidDiagram(props: Readonly<{ chart: string }>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const reactId = useId().replace(/:/g, "")
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    if (hostRef.current === null) return

    void (async () => {
      try {
        const mermaid = await loadMermaid()
        const renderId = `md-mermaid-${reactId}-${Math.random().toString(36).slice(2, 9)}`
        const { svg } = await mermaid.render(renderId, props.chart)
        if (cancelled || hostRef.current === null) return
        hostRef.current.innerHTML = svg
        setError(undefined)
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
        if (hostRef.current !== null) hostRef.current.innerHTML = ""
      }
    })()

    return () => {
      cancelled = true
    }
  }, [props.chart, reactId])

  return (
    <div className="md-mermaid-block" data-testid="md-mermaid-block">
      {error === undefined ? null : (
        <pre className="md-mermaid-error" role="alert">{`Mermaid 渲染失败：${error}`}</pre>
      )}
      <div ref={hostRef} className="md-mermaid-host" />
      {error === undefined ? null : (
        <pre className="md-document-pre"><code className="language-mermaid">{props.chart}</code></pre>
      )}
    </div>
  )
}
