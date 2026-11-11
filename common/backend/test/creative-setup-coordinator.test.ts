import { describe, expect, it, vi } from "vitest"
import { emptyCharacterProfile, parseCharacterProfile, formatCharacterProfile, applyCharacterFieldOperations } from "@starseafolio/contracts"
import { CreativeSetupCoordinator } from "../src/application/chapters/creative-setup-coordinator.js"
import { answerCreativeSetupQuestion, initialCreativeSetupState, nextCreativeSetupField, openCreativeSetupQuestion,
  markCreativeSetupWritten, type CreativeSetupScope, type CreativeSetupState } from "../src/application/chapters/creative-setup-state.js"

const answers = ["谨慎，热爱锻造", "黑发灰眼", "十七岁", "矿场孤儿", "寻找失踪父母", "姓名林烬", "无"]
function completed(): CreativeSetupState {
  let state = initialCreativeSetupState("protagonist", 1)
  for (const [index, answer] of answers.entries()) {
    state = openCreativeSetupQuestion(state, `q${String(index)}`, index + 2)
    state = answerCreativeSetupQuestion(state, { questionId: `q${String(index)}`, answer, now: index + 2 })
  }
  return state
}
function fixture(initial: CreativeSetupState) {
  const states = new Map<CreativeSetupScope, CreativeSetupState>([[initial.scope, initial]])
  const files = new Map<string, string>()
  let time = 100
  const saveMarkdown = vi.fn((_root: string, path: string, markdown: string) => { files.set(path, markdown); return Promise.resolve() })
  const generate = vi.fn((state: CreativeSetupState) => Promise.resolve({ content: `请填写${nextCreativeSetupField(state)?.label ?? "补充"}`,
    choices: [{ label: "本题材的具体方案一", action: "continue_discuss" as const }, { label: "本题材的具体方案二", action: "continue_discuss" as const }],
    protagonistSupplementMarkdown: "## AI补充\n林烬常备一枚旧铜钱。" }))
  const createCoordinator = () => new CreativeSetupCoordinator({ repository: {
    find: (_project, scope) => Promise.resolve(states.get(scope as CreativeSetupScope)),
    save: (_project, state) => { states.set(state.scope, JSON.parse(JSON.stringify(state)) as CreativeSetupState); return Promise.resolve() },
  }, workspace: { readMarkdown: (_root, path) => { const text = files.get(path); return text === undefined ? Promise.reject(Error("missing")) : Promise.resolve(text) },
    saveUserMarkdown: saveMarkdown,
    updateCharacter: async (_root, update) => {
      const previous = files.get(update.relativePath)
      const profile = previous === undefined ? emptyCharacterProfile("主角") : parseCharacterProfile(previous)
      const content = formatCharacterProfile(applyCharacterFieldOperations(profile, update.operations))
      await saveMarkdown(_root, update.relativePath, content)
      return content
    },
  }, now: () => time++, createId: () => `q-${String(time++)}`, recordSettings: () => Promise.resolve() })
  const coordinator = createCoordinator()
  const input = { projectId: "project", workspaceRootRef: "isolated", volumeFolderName: "第一卷 待命名",
    chapterSequence: 1, message: "开始", priorMessages: [], generate }
  return { states, files, saveMarkdown, generate, coordinator, createCoordinator, input }
}

function deferred() {
  let resolve: () => void = () => { throw new Error("Deferred promise was not initialized") }
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe("creative setup concurrent sends", () => {
  it("rejects simultaneous duplicates across coordinator instances before a second model call", async () => {
    const f = fixture(openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "q-first", 2))
    const entered = deferred()
    const release = deferred()
    f.generate.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return { content: "请确认样貌", choices: [
        { label: "黑发灰眼", action: "continue_discuss" as const },
        { label: "白发黑眼", action: "continue_discuss" as const },
      ], protagonistSupplementMarkdown: "未使用的补充" }
    })
    const input = { ...f.input, message: answers[0] ?? "", setupAnswerTo: "q-first" }
    const first = f.coordinator.advance(input)
    try {
      await entered.promise
      const saved = JSON.stringify([...f.states])
      await expect(f.createCoordinator().advance(input)).rejects.toThrow(/正在处理/u)
      expect(f.generate).toHaveBeenCalledTimes(1)
      expect(JSON.stringify([...f.states])).toBe(saved)
    } finally {
      release.resolve()
      await first
    }
    const result = await first
    if (result === undefined) throw new Error("Expected the next question")
    expect(f.states.get("protagonist")?.pendingQuestion?.id).toBe(result.questionId)
    const replay = await f.createCoordinator().advance({ ...input, priorMessages: [{
      messageId: "assistant", projectId: "project", sessionId: "session", role: "assistant", content: result.content,
      choices: [...result.choices], createdAtMs: 1,
    }] })
    expect(replay?.questionId).toBe(result.questionId)
    expect(replay?.cached).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
  })

  it.each([
    { projectId: "other-project", workspaceRootRef: "isolated" },
    { projectId: "project", workspaceRootRef: "other-workspace" },
  ])("allows an independent project/workspace while another send is active: %j", async (identity) => {
    const first = fixture(initialCreativeSetupState("protagonist", 1))
    const other = fixture(initialCreativeSetupState("protagonist", 1))
    const entered = deferred()
    const release = deferred()
    const generate = async () => {
      entered.resolve()
      await release.promise
      return { content: "请确认性格", choices: [
        { label: "谨慎", action: "continue_discuss" as const },
        { label: "勇敢", action: "continue_discuss" as const },
      ] }
    }
    const pending = first.coordinator.advance({ ...first.input, generate })
    try {
      await entered.promise
      const result = await other.coordinator.advance({ ...other.input, ...identity })
      expect(result?.field).toBe("personality")
      await expect(first.createCoordinator().advance(first.input)).rejects.toThrow(/正在处理/u)
    } finally {
      release.resolve()
      await pending
    }
  })

  it.each(["generation", "write"] as const)("releases the shared guard after a %s failure", async (failure) => {
    const f = fixture(completed())
    if (failure === "generation") f.generate.mockRejectedValueOnce(new Error("temporary failure"))
    else f.saveMarkdown.mockRejectedValueOnce(new Error("temporary failure"))
    await expect(f.coordinator.advance(f.input)).rejects.toThrow("temporary failure")
    const result = await f.createCoordinator().advance(f.input)
    expect(f.states.get("protagonist")?.status).toBe("ready")
    expect(result?.scope).toBe("volume:第一卷 待命名")
    expect(result?.field).toBe("opening")
  })
})

describe("creative setup persistence failure recovery", () => {
  it("writes AI-generated identity, abilities and relations into individual fields without overriding confirmed core", async () => {
    const f = fixture(completed())
    await f.coordinator.advance({ ...f.input, generate: async state => ({
      ...await f.generate(state),
      protagonistSupplementFields: {
        姓名: "林烬", 身份: "矿场学徒", 能力: ["锻造", "修补矿具"],
        人物关系: { 沈砚: "相互照应的矿友" }, 所属阵营: "散修",
        性格爱好: "不得替换用户核心", 年龄: "不得替换用户核心",
      },
    }) })
    const profile = parseCharacterProfile(f.files.get("设定集/人物/主角.json") ?? "")
    expect(profile.fields).toMatchObject({
      姓名: "林烬", 身份: "矿场学徒", 能力: ["锻造", "修补矿具"],
      人物关系: { 沈砚: "相互照应的矿友" }, 所属阵营: "散修",
      性格爱好: answers[0], 年龄: answers[2],
    })
    for (const answer of answers) expect(JSON.stringify(profile)).toContain(answer)
  })

  it("durably closes a ready gate before attempting to restore a missing document", async () => {
    const f = fixture(markCreativeSetupWritten(completed(), { path: "设定集/人物/主角.md", digest: "previous", now: 10 }))
    f.generate.mockRejectedValueOnce(Error("model unavailable"))
    await expect(f.coordinator.advance(f.input)).rejects.toThrow("model unavailable")
    expect(f.states.get("protagonist")?.status).toBe("awaiting_write")
    expect(f.states.get("protagonist")?.answers).toEqual(completed().answers)
    expect(f.states.get("protagonist")?.settingsPath).toBeUndefined()
  })

  it("never marks settings ready when the actual Markdown write fails", async () => {
    const f = fixture(completed())
    f.saveMarkdown.mockRejectedValueOnce(Error("disk full"))
    await expect(f.coordinator.advance(f.input)).rejects.toThrow("disk full")
    expect(f.states.get("protagonist")?.status).toBe("awaiting_write")
    expect(f.states.has("volume:第一卷 待命名")).toBe(false)
    const result = await f.coordinator.advance(f.input)
    expect(f.states.get("protagonist")?.status).toBe("ready")
    expect(result?.field).toBe("opening")
    for (const answer of answers) expect(f.files.get("设定集/人物/主角.json")).toContain(answer)
  })

  it("retries an accepted answer after next-question generation fails without filling another field", async () => {
    const f = fixture(openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "q-first", 2))
    f.generate.mockRejectedValueOnce(Error("model unavailable"))
    const input = { ...f.input, message: answers[0] ?? "", setupAnswerTo: "q-first" }
    await expect(f.coordinator.advance(input)).rejects.toThrow("model unavailable")
    expect(f.states.get("protagonist")?.answers).toEqual({ personality: answers[0] })
    const result = await f.coordinator.advance(input)
    expect(result?.field).toBe("appearance")
    expect(f.states.get("protagonist")?.answers).toEqual({ personality: answers[0] })
    await expect(f.coordinator.advance({ ...input, message: "另一个旧回答" })).rejects.toThrow(/过期/u)
  })

  it("does not call the model again while awaiting the same human response", async () => {
    const f = fixture(initialCreativeSetupState("protagonist", 1))
    const result = await f.coordinator.advance(f.input)
    if (result === undefined) throw Error("expected question")
    const again = await f.coordinator.advance({ ...f.input, priorMessages: [{
      messageId: "assistant", projectId: "project", sessionId: "session", role: "assistant", content: result.content,
      choices: [...result.choices], createdAtMs: 1,
    }] })
    expect(again?.cached).toBe(true)
    expect(again?.questionId).toBe(result.questionId)
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
})
