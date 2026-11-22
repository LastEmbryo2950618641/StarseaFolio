import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { aiPhaseValues } from "@starseafolio/contracts"
import { describe, expect, it } from "vitest"

import {
  BASE_RULES_RESOURCE,
  CONTENT_HANDLING_RESOURCE,
  OUTLINE_TO_DRAFT_GUIDE_RESOURCE,
  PLOT_SYNOPSIS_GUIDE_RESOURCE,
  SETTINGS_QUERY_GUIDE_RESOURCE,
  SETTINGS_REVISION_GUIDE_RESOURCE,
  SYNOPSIS_TO_OUTLINE_GUIDE_RESOURCE,
  USER_TO_SYNOPSIS_GUIDE_RESOURCE,
  WEBNOVEL_PROSE_LOGIC_RESOURCE,
  WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES,
  SKILL_INDEX_RESOURCE,
  PLATFORM_BASE_RULE_RESOURCES,
  PLATFORM_SKILLS,
  defaultSkillIdsForPhase,
  assertFrontierSettlementCoversReview,
  assertGraphGovernanceReferenceContract,
  assertPhaseReferenceContract,
  assertSpacetimeGovernanceCoverage,
  graphStructurePlanArtifactSchema,
  graphSpacetimeSettlementArtifactSchema,
  graphGovernanceArtifactSchema,
  isAllowedPhaseTransition,
  parsePhaseResult,
  phaseArtifactJsonSchema,
  promptDefinitions,
  settingsExtractionArtifactSchema,
  synopsisDiscussArtifactSchema,
  synopsisPresentationWriteSchema,
} from "../src/index.js"

const envelopeId = "00000000-0000-4000-8000-000000000001"
const contextId = "00000000-0000-4000-8000-000000000002"

describe("prompt contracts", () => {
  it("rejects graph structure plans whose AI decisions do not cover every proposal", () => {
    expect(() => graphStructurePlanArtifactSchema.parse({
      proposals: [
        {
          proposalRef: "proposal:first",
          mutation: { operation: "create_node", ref: "local:first", data: { content: "first" } },
          reason: "Create the first node",
          selfReview: "The first node is needed",
        },
        {
          proposalRef: "proposal:second",
          mutation: { operation: "create_node", ref: "local:second", data: { content: "second" } },
          reason: "Create the second node",
          selfReview: "The second node is needed",
        },
      ],
      affectedFrontierRefs: [],
      archiveOutletRefs: [],
      decisionRecords: [{
        decisionKind: "create",
        proposalRefs: ["proposal:first"],
        reason: "Only the first proposal has an AI decision",
        payload: {},
        selfReview: "The second proposal is intentionally left uncovered for this regression test",
      }],
    })).toThrow(/decision records must cover every proposal/u)
  })

  it("ships one immutable resource for every phase", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const resources = [
      BASE_RULES_RESOURCE,
      CONTENT_HANDLING_RESOURCE,
      WEBNOVEL_PROSE_LOGIC_RESOURCE,
      PLOT_SYNOPSIS_GUIDE_RESOURCE,
      SETTINGS_QUERY_GUIDE_RESOURCE,
      SETTINGS_REVISION_GUIDE_RESOURCE,
      SKILL_INDEX_RESOURCE,
      ...WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES,
      ...aiPhaseValues.map((phase) => promptDefinitions[phase].resourcePath),
    ]

    expect(new Set(resources).size).toBe(aiPhaseValues.length + 7 + WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES.length)
    for (const resource of resources) {
      const path = resolve(packageRoot, resource)
      expect(existsSync(path), resource).toBe(true)
      expect(readFileSync(path, "utf8").trim().length, resource).toBeGreaterThan(80)
    }
  })

  it("keeps platform composites thin (no vendor fulltext; skill index only)", () => {
    expect(PLATFORM_BASE_RULE_RESOURCES).toEqual([
      BASE_RULES_RESOURCE,
      CONTENT_HANDLING_RESOURCE,
      WEBNOVEL_PROSE_LOGIC_RESOURCE,
      SETTINGS_QUERY_GUIDE_RESOURCE,
      SKILL_INDEX_RESOURCE,
    ])
    for (const vendor of WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES) {
      expect(PLATFORM_BASE_RULE_RESOURCES).not.toContain(vendor)
    }
    expect(defaultSkillIdsForPhase("draft")).toEqual(["webnovel-deslop", "webnovel-dialogue", "outline-to-draft"])
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("discuss-workflow")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("user-to-synopsis")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("synopsis-to-outline")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).not.toContain("outline-to-draft")
    expect(PLATFORM_SKILLS.length).toBeGreaterThanOrEqual(7)
  })

  it("uses shared Markdown rules for cold-start category and prose recommendations", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const readResource = (resource: string): string => readFileSync(resolve(packageRoot, resource), "utf8")
    const skillIndex = readResource("resources/v1/skill-index.md")
    const coldStart = readResource("resources/skills/book-cold-start/SKILL.md")
    const stylePack = readResource("resources/skills/book-cold-start/references/style-pack-spec.md")

    expect(skillIndex).not.toContain("genre-style-presets")
    expect(coldStart).toContain("表现输出/小说大类规则/")
    expect(coldStart).toContain("表现输出/小说次大类规则/")
    expect(coldStart).toContain("表现输出/笔风规则/")
    expect(stylePack).toContain("结合用户构思、目标读者和所选 Markdown 正文描述倾向")
    expect(stylePack).toContain("每一种写法都可按场景调整")
    expect(stylePack).not.toContain("题材默认")
  })

  it("infers fanfiction source titles and checks local chapter references before nikowenku-archive", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const readResource = (resource: string): string => readFileSync(resolve(packageRoot, resource), "utf8")
    const referenceGuide = readResource(SETTINGS_QUERY_GUIDE_RESOURCE)
    const discussWorkflow = readResource("resources/v1/discuss-creation-desk-workflow.md")

    for (const text of [referenceGuide, discussWorkflow]) {
      expect(text).toContain("参考文件/原作资料/")
      expect(text).toContain("original_work_search")
      expect(text).toContain("不要要求用户先")
      expect(text).toContain("request_read")
      expect(text).toContain("AU")
    }
    expect(referenceGuide).toContain("original_work_download")
    expect(discussWorkflow).toContain("应用负责下载、校验和导入")
  })

  it("ships chinese-webnovel-skills vendor write rules verbatim-ish (MIT attribution header)", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    for (const resource of WEBNOVEL_VENDOR_WRITE_RULE_RESOURCES) {
      const text = readFileSync(resolve(packageRoot, resource), "utf8")
      expect(text).toContain("tance-mang/chinese-webnovel-skills")
      expect(text).toContain("不改正文")
    }
  })

  it("ships autonomous graph evolution and bounded retrieval standards to executable prompts", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const readResource = (resource: string): string => readFileSync(resolve(packageRoot, resource), "utf8")
    const baseRules = readResource(BASE_RULES_RESOURCE)
    const sourceRetrieval = readResource(promptDefinitions.source_retrieval.resourcePath)
    const graphGovernance = readResource(promptDefinitions.graph_governance.resourcePath)
    const graphStructurePlan = readResource(promptDefinitions.graph_structure_plan.resourcePath)
    const graphSpacetimeSettlement = readResource(promptDefinitions.graph_spacetime_settlement.resourcePath)
    const graphRetrievalDesign = readResource(promptDefinitions.graph_retrieval_design.resourcePath)
    const graphGovernanceReview = readResource(promptDefinitions.graph_governance_review.resourcePath)
    const frontierSettlement = readResource(promptDefinitions.frontier_settlement.resourcePath)
    const semanticReview = readResource(promptDefinitions.semantic_review.resourcePath)
    const settlementReview = readResource(promptDefinitions.settlement_review.resourcePath)
    const commitReview = readResource(promptDefinitions.commit_review.resourcePath)
    const dependencyAudit = readResource(promptDefinitions.dependency_audit.resourcePath)
    const draft = readResource(promptDefinitions.draft.resourcePath)
    const ruleAssembly = readResource(promptDefinitions.rule_assembly.resourcePath)

    expect(baseRules).toContain("图的局部组织与查询路径由你自主定义和演化")
    expect(baseRules).toContain("演化过程与当前有效状态")
    expect(baseRules).toContain("可被用户精确复述、追问或作为后续指代的原文片段")
    expect(baseRules).toContain("本轮实际读取的图信息是过去万事万物的演化和当前有效状态的首要依据")
    expect(baseRules).toContain("一句话可以是世界生成的起点")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("当前任务是虚构长篇的世界生成与正文交付")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("都是失败输出，删掉重写")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("第一句就是交付物本身")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("禁止在思考中讨论题材是否可写")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("用户规则若明确限制某些内容，仅在该明确范围内遵守")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("人物身心状态由世界因果推出")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("禁止为体面补选择")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("一夜如常")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("自行切黑")
    expect(readResource(CONTENT_HANDLING_RESOURCE)).toContain("不能用「角色不该知道」")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("遵守内容处理规则")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("chapterBodyMarkdown")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("1 ≤ N ≤ 当前焦点章序")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).not.toContain("本轮仍禁止")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("可用 `request_read`")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("不限制**只读查询已发布正文")
    expect(sourceRetrieval).toContain("已有局部图自身形成的组织方式")
    expect(sourceRetrieval).toContain("检索未命中不等于本轮不能推演")
    expect(sourceRetrieval).toContain("`missingEvidence` 和 `nextExpansionHints` 都必须是数组")
    expect(sourceRetrieval).toContain("应用内部已提交、不可变的原文单元投影")
    expect(sourceRetrieval).toContain("禁止读取工作区章节文件时")
    expect(sourceRetrieval).toContain("查询精确原话、标题或其他逐字内容时必须提供 `exactKeys`")
    expect(sourceRetrieval).toContain("`relatedOwnerRefs`")
    expect(readResource(promptDefinitions.emergence_planning.resourcePath)).toContain("本阶段不能声明 `local:*`")
    expect(graphGovernance).toContain("自主定义和重构局部图的组织与查询语义")
    expect(graphGovernance).toContain("retrievalProjections[].exactKeys")
    expect(graphGovernance).toContain("不是 `mutations` 数组、节点或连接的逐项清单")
    expect(graphStructurePlan).toContain("自包含的最新当前投影")
    expect(graphSpacetimeSettlement).toContain("仅仅可读、相关或出现在场景中不构成锚点用途")
    expect(graphRetrievalDesign).toContain("每个 Source 单元必须具有非空图返回路径")
    expect(graphGovernanceReview).toContain("自包含的最新当前投影")
    expect(graphGovernanceReview).toContain("仅因节点可读、相关或在场景中出现而充当锚点")
    expect(frontierSettlement).toContain("不能因为某个无关节点可读")
    expect(semanticReview).toContain("不是修改项、节点或连接的逐项清单")
    expect(draft).toContain("不得输出“等待读取资料")
    expect(draft).toContain("遵守内容处理规则")
    expect(readResource(promptDefinitions.draft.resourcePath)).toContain("不能用「角色未知」")
    expect(readResource(promptDefinitions.interpret.resourcePath)).toContain("遵守内容处理规则")
    expect(semanticReview).toContain("有限预算内")
    expect(semanticReview).toContain("可精确复述或再次指代的正文片段")
    expect(settlementReview).toContain("演化过程与当前有效状态")
    expect(commitReview).toContain("准确恢复相关当前状态、历史过程和原文")
    expect(dependencyAudit).toContain("AI 自主提炼")
    expect(dependencyAudit).toContain("不使用固定时间词表")
    expect(dependencyAudit).toContain("`temporalClaims`")
    expect(dependencyAudit).toContain("主体、动作或状态以及结果")
    expect(graphSpacetimeSettlement).toContain("`temporalClaimSettlements`")
    expect(graphSpacetimeSettlement).toContain("恰好覆盖")
    expect(graphGovernanceReview).toContain("`temporalClaimAssessments`")
    expect(commitReview).toContain("`continuityAdvice`")
    expect(commitReview).toContain("不能阻断提交")
    expect(ruleAssembly).toContain("这些内容只作为判断输入，绝不能复制到输出")
    expect(ruleAssembly).toContain("设定集默认查询规则")
    expect(sourceRetrieval).toContain("设定集默认查询规则")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("设定集修订规则")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).toContain("表现输出/本作品描写/*.md")
    const synopsisPrompt = readResource(promptDefinitions.synopsis_discuss.resourcePath)
    expect(synopsisPrompt).toContain("开书顺序与硬门禁")
    expect(synopsisPrompt).toContain("按 `book-cold-start`")
    expect(synopsisPrompt).toContain("固定规则来源")
    const coldStart = readResource("resources/skills/book-cold-start/SKILL.md")
    expect(coldStart).toContain("表现输出/本作品描写/作品风格.md")
    expect(coldStart).toContain("8 节均有正向定义")
    expect(coldStart).toContain("人称指称")
    expect(coldStart).toContain("表现输出/笔风规则/")
    expect(coldStart).toContain("时代科技生活")
    expect(coldStart).toContain("不调用 `todo_write`")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("book-cold-start")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("discuss-workflow")
    expect(defaultSkillIdsForPhase("synopsis_discuss")).toContain("plot-synopsis")
    expect(readResource(promptDefinitions.synopsis_discuss.resourcePath)).not.toContain("presentationWrites 给出完整 Markdown、`relativePath`（仅 `表现输出/描写规则/*.md`")
    expect(readResource(PLOT_SYNOPSIS_GUIDE_RESOURCE)).toContain("表现输出/本作品描写/")
    expect(readResource(PLOT_SYNOPSIS_GUIDE_RESOURCE)).toContain("作品风格.md")
    expect(readResource(PLOT_SYNOPSIS_GUIDE_RESOURCE)).toContain("具体句段、描写密度和机位由执笔时按场面决定")
    expect(synopsisPrompt).toContain("旧文件里由 AI 写成固定句长、对白比例、视角或描写密度的条目也作为倾向理解")
    expect(readResource(promptDefinitions.draft.resourcePath)).toContain("具体句式、分段、视点、对白和描写由本章的场景决定")
    expect(readResource(promptDefinitions.draft.resourcePath)).toContain("参考上一章已发布正文的语感和声口")
    expect(readResource("resources/v1/outline-to-draft-guide.md")).toContain("含旧文件里由 AI 写成规则的表现偏好")
    expect(readResource("resources/v1/outline-to-draft-guide.md")).toContain("核对用户合同动词")
    expect(readResource("resources/v1/user-to-synopsis-guide.md")).toContain("合同动词可读")
    expect(readResource("resources/v1/synopsis-to-outline-guide.md")).toContain("把具体用笔留给正文")
    expect(readResource("resources/presentation/表现输出/描写规则/感官描写.md")).toContain("按场面、人物视点和作品语气决定")
    expect(ruleAssembly).toContain("本阶段没有正文或长文本字段")
    expect(ruleAssembly).toContain("不要为了表示“已完整阅读”而重复路径")
    expect(ruleAssembly).toContain("每个路径和冲突各只出现一次")
  })

  it("rejects a result from the wrong phase", () => {
    expect(() => parsePhaseResult("draft", {
      schemaVersion: 1,
      envelopeId,
      contextId,
      phase: "source_retrieval",
      outcome: "continue",
      artifact: {
        executedRequestIds: [],
        returnedReadIds: [],
        rejectedCandidateIds: [],
        missingEvidence: [],
        nextExpansionHints: [],
      },
      requestedReads: [],
      citedReadIds: [],
      producedArtifactIds: [],
      decisionRecordIds: [],
      unresolvedDependencies: [],
      reason: "Retrieval completed",
      selfReview: "Only returned reads were cited",
    })).toThrow("Phase mismatch")
  })

  it("permits only declared forward and revision transitions", () => {
    expect(isAllowedPhaseTransition("draft", "chapter_naming")).toBe(true)
    expect(isAllowedPhaseTransition("dependency_audit", "source_retrieval")).toBe(true)
    expect(isAllowedPhaseTransition("interpret", "commit_review")).toBe(false)
    expect(aiPhaseValues).not.toContain("context_compaction")
    expect(aiPhaseValues).not.toContain("context_compaction_review")
  })

  it("uses one semantic artifact contract without backend-owned UUID fields", () => {
    for (const phase of aiPhaseValues) {
      const schema = JSON.stringify(phaseArtifactJsonSchema(phase))
      expect(schema, phase).not.toContain('"format":"uuid"')
    }
  })

  it("exposes optional deduction-goal fields on synopsis_discuss and semantic_review artifacts", () => {
    const synopsis = JSON.stringify(phaseArtifactJsonSchema("synopsis_discuss"))
    expect(synopsis).toContain("goalProposals")
    expect(synopsis).toContain("narrativeKind")
    expect(synopsis).not.toContain('"format":"uuid"')

    const semantic = phaseArtifactJsonSchema("semantic_review") as { required?: string[] }
    expect(JSON.stringify(semantic)).toContain("goalCompliance")
    expect(semantic.required ?? []).not.toContain("goalCompliance")
  })

  it("mentions narrative goal taxonomy in synopsis discuss prompt", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const prompt = readFileSync(
      resolve(packageRoot, promptDefinitions.synopsis_discuss.resourcePath),
      "utf8",
    )
    expect(prompt).toContain("narrativeKind")
    expect(prompt).toContain("戏核")
    expect(prompt).toContain("维护主路径是你")
    expect(prompt).toContain("人物最小档案")
    expect(prompt).toContain("姓名、性别、性格、背景")
    expect(prompt).toContain("团体豁免")
    expect(prompt).toContain("hookScheduleAudit")
    expect(prompt).toContain("不确定的兑现章可以暂不填")
    expect(prompt).toContain("伏笔跟进")
    expect(prompt).toContain("批量推演模式")
  })

  it("requires outline-to-prose translation rules in the draft prompt", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const draft = readFileSync(resolve(packageRoot, promptDefinitions.draft.resourcePath), "utf8")
    expect(draft).toContain("细纲 → 正文")
    expect(draft).toContain("翻译，不要照抄")
    expect(draft).toContain("禁止层")
    expect(draft).toContain("第X章")
    expect(draft).toContain("服从细纲 = 演出其要求的场面与约束")
  })

  it("preserves explicit user scope, status changes, and chapter length across writing stages", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const userToSynopsis = readFileSync(resolve(packageRoot, USER_TO_SYNOPSIS_GUIDE_RESOURCE), "utf8")
    const synopsisToOutline = readFileSync(resolve(packageRoot, SYNOPSIS_TO_OUTLINE_GUIDE_RESOURCE), "utf8")
    const outlineToDraft = readFileSync(resolve(packageRoot, OUTLINE_TO_DRAFT_GUIDE_RESOURCE), "utf8")
    const plotSynopsis = readFileSync(resolve(packageRoot, PLOT_SYNOPSIS_GUIDE_RESOURCE), "utf8")
    const synopsisDiscuss = readFileSync(resolve(packageRoot, promptDefinitions.synopsis_discuss.resourcePath), "utf8")
    const draft = readFileSync(resolve(packageRoot, promptDefinitions.draft.resourcePath), "utf8")
    const prose = readFileSync(resolve(packageRoot, WEBNOVEL_PROSE_LOGIC_RESOURCE), "utf8")

    expect(userToSynopsis).toContain("在其指定范围内以最新指令为准")
    expect(plotSynopsis).toContain("用户本轮明确要求重写或改变既有事实时，在指定范围内以最新指令为准")
    expect(userToSynopsis).toContain("场景数量/尺度")
    expect(userToSynopsis).toContain("开放范围先覆盖用户点名的个人与类别")
    expect(synopsisToOutline).toContain("叙事尺度")
    expect(synopsisToOutline).toContain("不把一章一主峰作为固定结构")
    expect(synopsisToOutline).toContain("首次执行及相关方照办")
    expect(outlineToDraft).toContain("不得用估算代替计数")
    expect(outlineToDraft).toContain("蒙太奇是否覆盖全部指定对象")
    expect(outlineToDraft).toContain("完整呈现用户指定的场面、结果、覆盖范围和场景数量")
    expect(outlineToDraft).toContain("阅读体验共同成立")
    expect(outlineToDraft).toContain("理解本书的语感，再按本章需要选择")
    expect(outlineToDraft).toContain("切镜不另算新场")
    expect(outlineToDraft).toContain("单个切镜可以通过行动、反应、信息、关系、对照、节奏、空间或氛围融入整体")
    expect(outlineToDraft).toContain("先覆盖用户点名的个人与类别")
    expect(userToSynopsis).toContain("不要求每场填满同一组要素")
    expect(synopsisToOutline).toContain("不要求每场都具备全部要素")
    expect(outlineToDraft).toContain("选择合适的叙事方式")
    expect(outlineToDraft).toContain("按本章类型与场景功能检查推进是否成立")
    expect(outlineToDraft).toContain("不要求每段都承担相同的推进任务")
    expect(plotSynopsis).toContain("不要求每场都加压或推进同一格情绪")
    expect(draft).toContain("正文主体按界面口径计数并落在范围内")
    expect(draft).toContain("阶段结果必须在本章发生")
    expect(draft).toContain("宏观蒙太奇")
    expect(draft).toContain("不写成阵营反应清单")
    expect(draft).toContain("按场景选择写法")
    expect(draft).toContain("允许场景承担停顿、氛围或铺垫")
    expect(draft).toContain("场内可用切镜呈现同一事件的跨地域影响")
    expect(synopsisDiscuss).toContain("先调用 `load_skill` 加载 `outline-to-draft`")
    expect(synopsisDiscuss).not.toContain("可先 `load_skill` `outline-to-draft`")
    expect(synopsisDiscuss).toContain("planningWriteIntent")
    expect(synopsisDiscuss).toContain("不能靠用户消息关键词、正则或固定口令")
    expect(synopsisDiscuss).toContain("引用、举例、提问、否定、暂缓以及仅讨论方案都不是写入授权")
    expect(synopsisDiscuss).toContain("本轮明确要求新写、重写或局部修改时，直接提交相应完整内容/补丁，不要再次询问是否覆盖")
    expect(synopsisDiscuss).not.toContain("未确认禁 `outlineBody`/`bodyEdits`")
    expect(synopsisDiscuss).not.toContain("若你准备改写法或拆章，须")
    expect(synopsisDiscuss).toContain("只有拟议方案会改变用户明确合同中的必达项、范围或本轮交付内容时，才须明示差异并征询")
    expect(synopsisDiscuss).toContain("宿主若发现草稿提案已返回但指南未加载，会先加载指南并要求本轮重新生成")
    expect(synopsisDiscuss).toContain("有任何梗概、细纲、草稿或整卷规划结构化写入时，`planningWriteIntent` 必须存在且逐项匹配写入产物")
    expect(synopsisDiscuss).toContain("planningWriteIntent`（按完整语义标记梗概 `create`|`rewrite`、细纲 `create`|`rewrite`|`patch`、草稿 `write`、整卷规划 `whole_volume`")
    expect(prose).toContain("蒙太奇保结果")
    expect(prose).toContain("整章长度服从创作台预算")
    expect(prose).toContain("不要求每种手段都出现")
    expect(prose).toContain("不把要求逐条改写成说明或动作清单")
    expect(prose).toContain("不规定固定章数")
  })

  it("keeps scene structure and chapter endings adaptive to the requested story", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const outlineToDraft = readFileSync(resolve(packageRoot, OUTLINE_TO_DRAFT_GUIDE_RESOURCE), "utf8")
    const synopsisToOutline = readFileSync(resolve(packageRoot, SYNOPSIS_TO_OUTLINE_GUIDE_RESOURCE), "utf8")
    const plotSynopsis = readFileSync(resolve(packageRoot, PLOT_SYNOPSIS_GUIDE_RESOURCE), "utf8")
    const draft = readFileSync(resolve(packageRoot, promptDefinitions.draft.resourcePath), "utf8")
    const prose = readFileSync(resolve(packageRoot, WEBNOVEL_PROSE_LOGIC_RESOURCE), "utf8")

    expect(outlineToDraft).toContain("围绕本章要给读者的体验选写法")
    expect(outlineToDraft).toContain("不预设统一的场景节拍或结尾形式")
    expect(outlineToDraft).not.toContain("- 目标 / 冲突 / 转折 / 结尾钩子")
    expect(outlineToDraft).not.toContain("起因与目标 → 升级 → 临界信号 → 结果")
    expect(synopsisToOutline).toContain("不把一章一主峰作为固定结构")
    expect(synopsisToOutline).toContain("按场景功能选择组织方式")
    expect(plotSynopsis).toContain("只有当本章适合留下新悬念时才安排结尾钩")
    expect(plotSynopsis).toContain("一章一主峰仅作为分析工具")
    expect(plotSynopsis).toContain("不要求每章都制造显著改变")
    expect(plotSynopsis).not.toContain("短章 1–3 步、常规 3–6 步")
    expect(plotSynopsis).toContain("不把标题当成每场必须填满的字段")
    expect(synopsisToOutline).toContain("不作为每场的固定栏位")
    expect(synopsisToOutline).not.toContain("须至少新增一类")
    expect(outlineToDraft).toContain("不要求每章都有冲突、反转或新钩子")
    expect(outlineToDraft).not.toContain("章末唯一钩是什么")
    expect(draft).toContain("按场景选择写法")
    expect(draft).not.toContain("一章一主峰把细纲已锁定场面改软或删掉")
    expect(prose).toContain("章节结尾按当前叙事任务选择落点")
    expect(prose).not.toContain("章末只留一个钩")
    expect(prose).not.toContain("一章一主峰")
  })

  it("accepts model-interpreted planning write intents without parsing the user message", () => {
    const parsed = synopsisDiscussArtifactSchema.parse({
      assistantMessage: "按用户要求重写梗概并局部修订细纲。",
      synopsisBody: "# 梗概\n\n新梗概。",
      bodyEdits: {
        target: "outline",
        ops: [{ oldText: "旧内容", newText: "新内容" }],
      },
      planningWriteIntent: {
        synopsis: "rewrite",
        outline: "patch",
        draft: "write",
        volume: "whole_volume",
      },
      finalSelfReview: "The user explicitly requested both changes.",
    })

    expect(parsed.planningWriteIntent).toEqual({
      synopsis: "rewrite",
      outline: "patch",
      draft: "write",
      volume: "whole_volume",
    })
    expect(synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "无效规划写入意图",
      planningWriteIntent: { synopsis: "patch" },
      finalSelfReview: "Synopsis only allows create or rewrite.",
    }).success).toBe(false)
  })

  it("requires matching intent for every structured planning write", () => {
    expect(synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "已重写梗概。",
      synopsisBody: "# 新梗概\n\n内容。",
      finalSelfReview: "完整梗概已按最新要求更新。",
    }).success).toBe(false)
    expect(synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "已更新细纲。",
      outlineBody: "# 细纲\n\n内容。",
      planningWriteIntent: { outline: "rewrite" },
      finalSelfReview: "完整细纲与写入意图一致。",
    }).success).toBe(true)
    expect(synopsisDiscussArtifactSchema.safeParse({
      assistantMessage: "已写草稿。",
      chapterDraftProposal: { base: "body", heading: "第一章", body: "正文。" },
      planningWriteIntent: { draft: "write" },
      finalSelfReview: "草稿与写入意图一致。",
    }).success).toBe(true)
  })

  it("requires character personality in settings revision and draft prompts", () => {
    const packageRoot = resolve(process.cwd(), "common/packages/prompt-contracts")
    const revision = readFileSync(resolve(packageRoot, SETTINGS_REVISION_GUIDE_RESOURCE), "utf8")
    const draft = readFileSync(resolve(packageRoot, promptDefinitions.draft.resourcePath), "utf8")
    const extraction = readFileSync(
      resolve(packageRoot, promptDefinitions.settings_extraction.resourcePath),
      "utf8",
    )
    expect(revision).toContain("## 性格")
    expect(revision).toContain("## 背景")
    expect(revision).toContain("姓名、性别、性格、背景")
    expect(draft).toContain("人物按性格行事")
    expect(draft).toContain("姓名与最小档案")
    expect(extraction).toContain("## 性格")
    expect(extraction).toContain("姓名")
    expect(extraction).toContain("性别")
  })

  it("keeps rule assembly semantic and lets the runtime own its snapshot identity", () => {
    const result = phaseArtifactJsonSchema("rule_assembly")
    expect(JSON.stringify(result)).toContain("selectedWorkspacePaths")
    expect(JSON.stringify(result)).not.toContain("ruleSnapshotId")
    expect(JSON.stringify(result)).not.toContain("presentationRuleVersionIds")
  })

  it("keeps backend document references out of the draft artifact", () => {
    expect(JSON.stringify(phaseArtifactJsonSchema("draft"))).not.toContain("contentRef")
  })

  it("requires existing planning references to point at graph identities read this turn", () => {
    const planning = {
      decisions: [{
        pressureEvidenceRefs: [],
        action: "reuse",
        existingAnchorRefs: ["chapter-evidence-id"],
        timeAnchorRefs: [],
        locationAnchorRefs: [],
        informationBoundaryRefs: [],
        reason: "Continue the same traveler",
      }],
    }

    expect(() => {
      assertPhaseReferenceContract("emergence_planning", planning, {
        readableEvidenceIds: new Set(),
        readableGraphIds: new Set(["traveler-node-id"]),
        readableWorkspacePaths: new Set(),
      })
    })
      .toThrow("owner IDs read in this turn")
  })

  it("rejects undeclared local graph handles without interpreting their semantics", () => {
    const governance = {
      mutations: [{
        operation: "create_node",
        ref: "local:place",
        data: { content: { relatedRef: "local:missing" } },
      }],
      retrievalProjections: [],
      settlementRecords: [],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [],
      affectedFrontierRefs: [],
      archiveOutletRefs: [],
      decisionRecords: [],
    }

    expect(() => assertGraphGovernanceReferenceContract(governance, new Set()))
      .toThrow("readable graph owners or declared local handles")
  })

  it("rejects undeclared local handles in graph retrieval design", () => {
    expect(() => assertPhaseReferenceContract(
      "graph_retrieval_design",
      {
        projections: [],
        sourceSettlements: [{
          sourceUnitIndex: 0,
          graphRefs: [{ targetKind: "node", targetRef: "local:stale_handle" }],
          reason: "Return through the referenced graph owner",
          status: "bound",
        }],
      },
      {
        readableGraphIds: new Set(["node_1"]),
        readableEvidenceIds: new Set(),
        readableWorkspacePaths: new Set(),
        declaredLocalGraphRefs: new Set(["local:current_handle"]),
      },
    )).toThrow("readable graph owners or declared local handles")
  })

  it("accepts readable owners and current local handles in graph retrieval design", () => {
    expect(() => assertPhaseReferenceContract(
      "graph_retrieval_design",
      {
        projections: [
          { ownerRef: "node_1", exactKeys: ["existing"], semanticText: "Existing owner" },
          { ownerRef: "local:current_handle", exactKeys: ["current"], semanticText: "Current owner" },
        ],
        sourceSettlements: [{
          sourceUnitIndex: 0,
          graphRefs: [
            { targetKind: "node", targetRef: "node_1" },
            { targetKind: "node", targetRef: "local:current_handle", proposalRef: "proposal:current" },
          ],
          reason: "Return through both graph owners",
          status: "bound",
        }],
      },
      {
        readableGraphIds: new Set(["node_1"]),
        readableEvidenceIds: new Set(),
        readableWorkspacePaths: new Set(),
        declaredLocalGraphRefs: new Set(["local:current_handle"]),
      },
    )).not.toThrow()
  })

  it("does not impose a code-owned graph creation count", () => {
    const governance = {
      mutations: [
        { operation: "create_node", ref: "local:first", data: { content: {} } },
        { operation: "create_node", ref: "local:second", data: { content: {} } },
      ],
      retrievalProjections: [],
      settlementRecords: [],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [],
      affectedFrontierRefs: [],
      archiveOutletRefs: [],
      decisionRecords: [],
    }

    expect(() => assertGraphGovernanceReferenceContract(governance, new Set())).not.toThrow()
  })

  it("requires frontier settlement to preserve the AI-approved frontier set", () => {
    const review = {
      approvedMutationIndexes: [],
      rejectedMutationIndexes: [],
      approvedSpacetimeBindingIndexes: [],
      rejectedSpacetimeBindingIndexes: [],
      approvedMutationSpacetimeSettlementIndexes: [],
      rejectedMutationSpacetimeSettlementIndexes: [],
      approvedAffectedFrontierRefs: ["local:frontier"],
      rejectedAffectedFrontierRefs: [],
      verificationProbeAssessments: [],
      sceneInventoryComplete: true,
      graphStillDiscoverable: true,
      graphStillConcise: true,
      continuityPreserved: true,
      spacetimeContinuityPreserved: true,
    }
    const settlement = {
      frontiers: [{
        frontierAnchorRef: "local:not-approved",
        disposition: "active",
        lastSceneAnchorRefs: ["local:scene"],
        lastTimeAnchorRefs: ["local:time"],
        lastLocationAnchorRefs: ["local:place"],
        correspondenceRefs: [],
        reason: "continue later",
        revisitCondition: "when local pressure changes",
      }],
    }

    expect(() => assertFrontierSettlementCoversReview(review, settlement))
      .toThrow("must contain every approved reference exactly once")
  })

  it("rejects a frontier time anchor that was not established by spacetime governance", () => {
    const review = {
      approvedMutationIndexes: [],
      rejectedMutationIndexes: [],
      approvedSpacetimeBindingIndexes: [0],
      rejectedSpacetimeBindingIndexes: [],
      approvedMutationSpacetimeSettlementIndexes: [],
      rejectedMutationSpacetimeSettlementIndexes: [],
      approvedAffectedFrontierRefs: ["local:frontier"],
      rejectedAffectedFrontierRefs: [],
      verificationProbeAssessments: [],
      sceneInventoryComplete: true,
      graphStillDiscoverable: true,
      graphStillConcise: true,
      continuityPreserved: true,
      spacetimeContinuityPreserved: true,
    }
    const governance = {
      mutations: [],
      retrievalProjections: [],
      settlementRecords: [],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [{
        sceneIndex: 0,
        sceneAnchorRef: "local:scene",
        sourceUnitIndexes: [],
        temporalReferenceRefs: ["local:time"],
        timeAnchorRefs: ["local:time"],
        spatialReferenceRefs: ["local:place"],
        locationAnchorRefs: ["local:place"],
        predecessorSceneIndexes: [],
        predecessorSceneAnchorRefs: [],
        transitionPathRefs: [],
        correspondenceRefs: [],
        explanation: "Established scene anchors",
        selfReview: "Each anchor has one governed role",
      }],
      affectedFrontierRefs: ["local:frontier"],
      archiveOutletRefs: [],
      decisionRecords: [],
    }
    const settlement = {
      frontiers: [{
        frontierAnchorRef: "local:frontier",
        disposition: "active",
        lastSceneAnchorRefs: ["local:scene"],
        lastTimeAnchorRefs: ["local:object"],
        lastLocationAnchorRefs: ["local:place"],
        correspondenceRefs: [],
        reason: "continue later",
        revisitCondition: "when local pressure changes",
      }],
    }

    expect(() => assertFrontierSettlementCoversReview(review, settlement, governance))
      .toThrow("time anchors must come from approved spacetime bindings")
  })

  it("allows a background frontier to reuse only its own previously read anchors", () => {
    const review = {
      approvedMutationIndexes: [],
      rejectedMutationIndexes: [],
      approvedSpacetimeBindingIndexes: [],
      rejectedSpacetimeBindingIndexes: [],
      approvedMutationSpacetimeSettlementIndexes: [],
      rejectedMutationSpacetimeSettlementIndexes: [],
      approvedAffectedFrontierRefs: ["local:frontier"],
      rejectedAffectedFrontierRefs: [],
      verificationProbeAssessments: [],
      sceneInventoryComplete: true,
      graphStillDiscoverable: true,
      graphStillConcise: true,
      continuityPreserved: true,
      spacetimeContinuityPreserved: true,
    }
    const governance = {
      mutations: [],
      retrievalProjections: [],
      settlementRecords: [],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [],
      affectedFrontierRefs: ["local:frontier"],
      archiveOutletRefs: [],
      decisionRecords: [],
    }
    const projection = {
      kind: "frontier_settlement",
      version: 1,
      sourceArtifactDigests: {
        graph_governance: "digest-governance",
        semantic_review: "digest-review",
        settlement_review: "digest-settlement",
      },
      pendingScope: { scopeId: "scope_1", candidateDigest: "digest-scope" },
      projectionDigest: "digest-projection",
      unresolvedIssues: [],
      affectedFrontierRefs: ["local:frontier"],
      approvedSceneBindings: [],
      archiveOutletRefs: [],
      correspondenceRefs: [],
      priorFrontierStates: [{
        frontierAnchorRef: "local:frontier",
        lastSceneAnchorRefs: ["local:old-scene"],
        lastTimeAnchorRefs: ["local:old-time"],
        lastLocationAnchorRefs: ["local:old-place"],
        correspondenceRefs: [],
      }],
    }
    const settlement = {
      frontiers: [{
        frontierAnchorRef: "local:frontier",
        disposition: "active",
        lastSceneAnchorRefs: ["local:old-scene"],
        lastTimeAnchorRefs: ["local:old-time"],
        lastLocationAnchorRefs: ["local:old-place"],
        correspondenceRefs: [],
        reason: "continue later",
        revisitCondition: "when local pressure changes",
      }],
    }

    expect(() => assertFrontierSettlementCoversReview(review, settlement, governance, projection)).not.toThrow()
    expect(() => assertFrontierSettlementCoversReview(review, {
      frontiers: [{
        ...settlement.frontiers[0],
        lastTimeAnchorRefs: ["local:unrelated-time"],
      }],
    }, governance, projection)).toThrow("previously read anchors")
  })

  it("rejects duplicate narrative source coverage across scene bindings", () => {
    const dependency = {
      missingDependencies: [],
      unplannedContent: [],
      sceneContinuity: [{
        sceneIndex: 0,
        sceneDescription: "one scene",
        predecessorSceneIndexes: [],
        predecessorSceneRefs: [],
        predecessorRequired: false,
        predecessorReason: "none",
        correspondenceRequired: false,
        correspondenceReason: "none",
        timeContinuity: "pass",
        locationContinuity: "pass",
        crossReferenceContinuity: "pass",
        reason: "continuous",
      }],
      temporalClaims: [],
      informationBoundary: "pass",
    }
    const governance = {
      mutations: [],
      retrievalProjections: [],
      settlementRecords: [
        { sourceUnitIndex: 0, graphRefs: [], reason: "settled", status: "settled" },
        { sourceUnitIndex: 1, graphRefs: [], reason: "settled", status: "settled" },
      ],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [{
        sceneIndex: 0,
        sceneAnchorRef: "scene",
        sourceUnitIndexes: [0, 0, 1],
        temporalReferenceRefs: ["time"],
        timeAnchorRefs: ["time"],
        spatialReferenceRefs: ["space"],
        locationAnchorRefs: ["space"],
        predecessorSceneIndexes: [],
        predecessorSceneAnchorRefs: [],
        transitionPathRefs: [],
        correspondenceRefs: [],
        explanation: "covers the scene",
        selfReview: "duplicate source unit is invalid",
      }],
      affectedFrontierRefs: [],
      archiveOutletRefs: [],
      decisionRecords: [],
    }

    expect(() => assertSpacetimeGovernanceCoverage(dependency, governance, 2))
      .toThrow("Scene source coverage must contain every index exactly once")
  })

  it("rejects staged world effects without an effective scene", () => {
    expect(() => graphSpacetimeSettlementArtifactSchema.parse({
      sceneSpacetimeBindings: [],
      temporalClaimSettlements: [],
      proposalSettlements: [{
        proposalRefs: ["proposal:world-effect"],
        effectDisposition: "world_effect",
        effectiveSceneBindingIndexes: [],
        effectiveExistingSceneAnchorRefs: [],
        currentEntryRefs: ["local:world-effect"],
        predecessorRevisionRequired: false,
        predecessorRevisionReadRefs: [],
        historicalReturnRefs: ["local:world-effect"],
        reason: "The proposal changes the persistent world",
        selfReview: "No effective scene was established",
      }],
    })).toThrow("world_effect requires an effective scene")
  })

  it("requires no-change graph governance to contain no mutations", () => {
    expect(() => graphGovernanceArtifactSchema.parse({
      executionMode: "no_change",
      mutations: [{
        operation: "create_node",
        ref: "local:new",
        data: { content: "new fact" },
      }],
      retrievalProjections: [],
      settlementRecords: [],
      mutationSpacetimeSettlements: [],
      sceneSpacetimeBindings: [],
      affectedFrontierRefs: [],
      archiveOutletRefs: [],
      decisionRecords: [],
    })).toThrow("no_change graph governance cannot contain mutations")
  })

  it("restricts presentationWrites to this-work overlay files with size caps", () => {
    expect(synopsisPresentationWriteSchema.parse({
      relativePath: "表现输出/本作品描写/压抑氛围.md",
      markdown: "# 压抑\n",
      mode: "create",
    }).relativePath).toBe("表现输出/本作品描写/压抑氛围.md")
    expect(() => synopsisPresentationWriteSchema.parse({
      relativePath: "表现输出/描写规则/近景跟随.md",
      markdown: "# 近景\n",
      mode: "create",
    })).toThrow(/本作品描写/)
    expect(() => synopsisPresentationWriteSchema.parse({
      relativePath: "表现输出/本作品描写/nested/x.md",
      markdown: "# nested\n",
      mode: "create",
    })).toThrow(/本作品描写/)
    expect(() => synopsisPresentationWriteSchema.parse({
      relativePath: "表现输出/本作品描写/过长.md",
      markdown: "字".repeat(4001),
      mode: "update",
    })).toThrow()
  })

  it("treats empty synopsisBody as omitted so schema repair can continue", () => {
    const parsed = synopsisDiscussArtifactSchema.parse({
      assistantMessage: "先把戏核收窄，再决定要不要重写细纲。",
      finalSelfReview: "本轮只改对话，没有覆盖空梗概。",
      synopsisBody: "",
    })
    expect(parsed.synopsisBody).toBeUndefined()
  })

  it("allows settings_extraction artifacts without finalSelfReview", () => {
    const parsed = settingsExtractionArtifactSchema.parse({
      summary: "本轮无新设定需要沉淀。",
      proposals: [],
    })
    expect(parsed.finalSelfReview).toBeUndefined()
    expect(settingsExtractionArtifactSchema.parse({
      summary: "抽出一处地点。",
      proposals: [],
      finalSelfReview: "已自检。",
    }).finalSelfReview).toBe("已自检。")
  })

  it("accepts chapterDraftProposal and promote_draft_to_body", () => {
    const parsed = synopsisDiscussArtifactSchema.parse({
      assistantMessage: "已写入新草稿。",
      planningWriteIntent: { draft: "write" },
      chapterDraftProposal: {
        heading: "第一章 虫与蝶",
        body: "雨还在下。",
      },
      choices: [{
        label: "是否确认用这份草稿覆盖正式正文（当前正文将备份为旧版本）",
        action: "promote_draft_to_body",
      }],
      finalSelfReview: "Official file unchanged.",
    })
    expect(parsed.chapterDraftProposal?.body).toBe("雨还在下。")
    expect(parsed.choices?.[0]?.action).toBe("promote_draft_to_body")
  })

  it("accepts AI-selected creation-desk settings and requires a complete word-count range", () => {
    const parsed = synopsisDiscussArtifactSchema.parse({
      assistantMessage: "已按本书类型设置笔风和单章篇幅。",
      creationDeskSettings: {
        descriptionRulePath: "表现输出/描写规则/自动.md",
        proseStyleRulePath: "表现输出/笔风规则/网文白话.md",
        minimumWordCount: 2500,
        maximumWordCount: 3500,
        boundaryPace: "advance_allowed",
        causalityFocus: "action",
      },
      finalSelfReview: "设置值完整且范围有效。",
    })
    expect(parsed.creationDeskSettings?.proseStyleRulePath).toBe("表现输出/笔风规则/网文白话.md")
    expect(() => synopsisDiscussArtifactSchema.parse({
      assistantMessage: "只调整了最小字数。",
      creationDeskSettings: { minimumWordCount: 2500 },
      finalSelfReview: "范围不完整。",
    })).toThrow(/minimumWordCount.*maximumWordCount|同时/u)
    expect(() => synopsisDiscussArtifactSchema.parse({
      assistantMessage: "范围颠倒。",
      creationDeskSettings: { minimumWordCount: 4000, maximumWordCount: 3000 },
      finalSelfReview: "范围无效。",
    })).toThrow(/最小字数/u)
  })

  it("accepts volumeChapterPlans and chapterDraftProposals for batch volume workflow", () => {
    const parsed = synopsisDiscussArtifactSchema.parse({
      assistantMessage: "本卷规划与草稿已齐。",
      planningWriteIntent: { volume: "whole_volume", draft: "write" },
      volumePlanMeta: { targetWordCount: 80_000, targetChapterCount: 2 },
      volumeChapterPlans: [{
        chapterSequence: 1,
        chapterTitle: "抵达",
        synopsisBody: "# 第一章 抵达\n\n主角到站。",
        outlineBody: "# 第一章 抵达\n\n## 分场\n- 到站",
      }, {
        chapterSequence: 2,
        synopsisBody: "# 第二章 离开\n\n主角离开。",
        outlineBody: "# 第二章 离开\n\n## 分场\n- 离开",
      }],
      chapterDraftProposals: [{
        chapterSequence: 1,
        heading: "第一章 抵达",
        body: "雨还在下。",
      }],
      finalSelfReview: "Batch fields valid.",
    })
    expect(parsed.volumeChapterPlans).toHaveLength(2)
    expect(parsed.chapterDraftProposals?.[0]?.chapterSequence).toBe(1)
    expect(parsed.volumePlanMeta?.targetChapterCount).toBe(2)
  })

  it("requires both volume targets and accepts a distinct volume synopsis artifact", () => {
    const base = {
      assistantMessage: "卷规划已完成。",
      finalSelfReview: "卷级产物有效。",
    }
    expect(synopsisDiscussArtifactSchema.safeParse({
      ...base,
      volumePlanMeta: { targetChapterCount: 8 },
    }).success).toBe(false)
    const parsed = synopsisDiscussArtifactSchema.parse({
      ...base,
      volumePlanMeta: { targetChapterCount: 8, targetWordCount: 24_000 },
      volumeSynopsis: { markdown: "# 第一卷梗概\n主线与卷末转折。" },
      arcPlan: { markdown: "# 第一卷大纲\n第一章与第二章的关键事件。" },
    })
    expect(parsed.volumeSynopsis?.markdown).toContain("卷末转折")
  })
})
