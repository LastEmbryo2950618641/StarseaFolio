export { isGraphReferenceRepairExhaustedError } from "./graph-reference-repair.js"

type Props = Readonly<{
  heading: string
  error: string
  onContinue(): void
  onDismiss(): void
}>

export function GraphReferenceRepairLimitDialog(props: Props): React.JSX.Element {
  return <div className="dialog-backdrop" role="presentation">
    <section
      className="work-name-prompt-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-reference-repair-limit-title"
      data-testid="graph-reference-repair-limit-dialog"
    >
      <header>
        <div>
          <strong id="graph-reference-repair-limit-title">图引用自动修正已达上限</strong>
          <small>{props.heading}</small>
        </div>
      </header>
      <div className="work-name-prompt-body">
        <p>
          模型多次把章节名、人名等语义名写进了图引用字段，自动修正次数已用尽。
          可以选择再试一轮（继续当前失败阶段），或先留在待重试状态稍后手动处理。
        </p>
        <p className="backend-wait-timeout-method"><code>{props.error}</code></p>
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
}
