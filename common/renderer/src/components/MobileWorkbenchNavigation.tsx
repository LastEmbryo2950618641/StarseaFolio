import { BookOpenText, FolderTree, MessageCircle, Settings2, Wrench } from "lucide-react"

export type MobileWorkbenchPane = "editor" | "files" | "tools" | "details"

export function MobileWorkbenchNavigation(props: Readonly<{
  pane: MobileWorkbenchPane
  chaptersActive: boolean
  onDiscussion(): void
  onChapters(): void
  onDirectory(): void
  onWritingSettings(): void
  onTools(): void
}>): React.JSX.Element {
  const items = [
    { label: "讨论", icon: MessageCircle, active: props.pane === "editor" && !props.chaptersActive, run: props.onDiscussion },
    { label: "章节", icon: BookOpenText, active: props.pane === "details" || (props.pane === "editor" && props.chaptersActive), run: props.onChapters },
    { label: "目录", icon: FolderTree, active: props.pane === "files", run: props.onDirectory },
    { label: "写作设置", icon: Settings2, active: false, run: props.onWritingSettings },
    { label: "工具", icon: Wrench, active: props.pane === "tools", run: props.onTools },
  ]
  return <nav className="mobile-workbench-nav" aria-label="手机工作台">
    {items.map(({ label, icon: Icon, active, run }) => <button
      type="button" key={label} aria-current={active ? "page" : undefined} onClick={run}
    ><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
  </nav>
}
