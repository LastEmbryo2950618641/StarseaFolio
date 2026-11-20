import { describe, expect, it } from "vitest"

import { discussAgentModePromptAppendix } from "../src/application/chapters/discuss-agent-mode.js"

describe("discuss agent mode appendix", () => {
  it("Auto + batchProceed / proceedMode=batch skips confirm gates", () => {
    const viaLegacy = discussAgentModePromptAppendix("auto", { batchProceed: true })
    const viaMode = discussAgentModePromptAppendix("auto", { proceedMode: "batch" })
    for (const auto of [viaLegacy, viaMode]) {
      expect(auto).toContain("推进模式=批量")
      expect(auto).toContain("titleAlignTarget")
      expect(auto).toContain("作品风格未合格时，必须给用户 2–3 个可点击风格 choices")
      expect(auto).toContain("不得自行选风格、自动续跑")
      expect(auto).not.toContain("推进模式=精准")
    }
  })

  it("Auto default (no batch) uses single-chapter proceed rules", () => {
    const auto = discussAgentModePromptAppendix("auto", {})
    expect(auto).toContain("推进模式=单章")
    expect(auto).toContain("正文落入确认前必须停等")
    expect(auto).not.toContain("推进模式=批量 · Auto 自决")
  })

  it("Auto + precise requires every pipeline stop", () => {
    const auto = discussAgentModePromptAppendix("auto", { proceedMode: "precise" })
    expect(auto).toContain("推进模式=精准")
    expect(auto).toContain("用这份梗概写细纲")
    expect(auto).toContain("按细纲写正文")
  })

  it("Accept edits still allows stopping on a real content conflict when batch on", () => {
    const acceptEdits = discussAgentModePromptAppendix("accept_edits", { batchProceed: true })
    expect(acceptEdits).toContain("才停并给 choices")
    expect(acceptEdits).not.toContain("Auto 自决")
  })

  it("custom mode lists auto and stop stages", () => {
    const custom = discussAgentModePromptAppendix("auto", {
      proceedMode: "custom",
      customProceedGates: {
        chapter_requirements: false,
        synopsis_discuss: true,
        outline_discuss: true,
        draft_discuss: true,
        body_discuss: false,
      },
    })
    expect(custom).toContain("推进模式=自定义")
    expect(custom).toContain("自动节点")
    expect(custom).toContain("停等节点")
  })
})
