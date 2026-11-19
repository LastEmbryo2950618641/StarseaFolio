import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ExpandableErrorAlert } from "../src/components/ExpandableErrorAlert.js"

describe("ExpandableErrorAlert", () => {
  it("renders a scrollable preview and a full-text action", () => {
    const message = "DeepSeek response could not satisfy the phase contract: Graph references must be owner IDs read in this turn: 第八章·橄榄林散步, 雅典娜教徒连走高跟鞋"
    const html = renderToStaticMarkup(React.createElement(ExpandableErrorAlert, {
      message,
      title: "图治理任务错误",
      testId: "graph-revision-task-error",
    }))
    expect(html).toContain("expandable-error-preview")
    expect(html).toContain(message)
    expect(html).toContain("查看全文")
    expect(html).toContain('data-testid="graph-revision-task-error-open"')
  })
})
