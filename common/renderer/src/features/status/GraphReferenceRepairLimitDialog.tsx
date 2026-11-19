import { AlertTriangle } from "lucide-react"
import { createPortal } from "react-dom"

import {
  parseInvalidGraphReferenceLabels,
} from "./graph-reference-repair.js"

export { isGraphReferenceRepairExhaustedError } from "./graph-reference-repair.js"

type Props = Readonly<{
  heading: string
  error: string
  onContinue(): void
  onDismiss(): void
}>

export function GraphReferenceRepairLimitDialog(props: Props): React.JSX.Element {
  const invalidLabels = parseInvalidGraphReferenceLabels(props.error)
  // Right-rail ancestors use transform; portal to body so fixed centering covers the window.
  const dialog = <div className="dialog-backdrop" role="presentation">
    <section
      className="work-name-prompt-dialog graph-reference-repair-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-reference-repair-limit-title"
      data-testid="graph-reference-repair-limit-dialog"
    >
      <header>
        <span className="work-name-prompt-icon" aria-hidden="true"><AlertTriangle size={16} /></span>
        <div>
          <strong id="graph-reference-repair-limit-title">图引用自动修正已达上限</strong>
          <small title={props.heading}>{props.heading}</small>
        </div>
      </header>
      <div className="work-name-prompt-body">
        <p>
          模型把章节名、人名等语义名写进了图引用字段，自动修正次数已用尽。
          可以再试一轮当前失败阶段，或稍后在图治理任务里手动处理。
        </p>
        {invalidLabels.length === 0 ? null : <div className="graph-reference-repair-invalid">
          <span className="graph-reference-repair-invalid-label">本次非法引用</span>
          <ul>
            {invalidLabels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </div>}
      </div>
      <footer>
        <button type="button" data-testid="graph-reference-repair-limit-dismiss" onClick={props.onDismiss}>
          稍后处理
        </button>
        <button
          type="button"
          className="dialog-primary-command"
          data-testid="graph-reference-repair-limit-continue"
          onClick={props.onContinue}
        >
          继续再试
        </button>
      </footer>
    </section>
  </div>
  if (typeof document === "undefined") return dialog
  return createPortal(dialog, document.body)
}
