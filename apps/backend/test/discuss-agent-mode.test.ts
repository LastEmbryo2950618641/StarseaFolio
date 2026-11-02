import { describe, expect, it } from "vitest"

import { discussAgentModePromptAppendix } from "../src/application/chapters/discuss-agent-mode.js"

describe("discuss agent mode appendix", () => {
  it("Auto + batchProceed skips confirm gates", () => {
    const auto = discussAgentModePromptAppendix("auto", { batchProceed: true })
    expect(auto).toContain("批量推进=开")
    expect(auto).toContain("titleAlignTarget")
    expect(auto).toContain("作品风格未合格时，必须给用户 2–3 个可点击风格 choices")
    expect(auto).toContain("不得自行选风格、自动续跑")
    expect(auto).not.toContain("批量推进=关")
  })

  it("Auto without batchProceed requires step confirms", () => {
    const auto = discussAgentModePromptAppendix("auto", { batchProceed: false })
    expect(auto).toContain("批量推进=关")
    expect(auto).toContain("用这份梗概写细纲")
    expect(auto).toContain("按细纲写正文")
    expect(auto).not.toContain("批量推进=开 · Auto 自决")
  })

  it("Accept edits still allows stopping on a real content conflict when batch on", () => {
    const acceptEdits = discussAgentModePromptAppendix("accept_edits", { batchProceed: true })
    expect(acceptEdits).toContain("才停并给 choices")
    expect(acceptEdits).not.toContain("Auto 自决")
  })
})
