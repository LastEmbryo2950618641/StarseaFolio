# draft

## 阶段门禁与审计约束

- 遵守本轮草稿阶段附录中的 **「推演发散程度」**：严格模式下不得发明未在已读设定/证据中出现的新设定；默认与自由模式允许按策略建立新设定性内容，并由后续设定抽取经用户确认后写入。
- 已读取图中的当前状态和修订链优先于其他资料；不同所有者的当前证据冲突时，使用 `committedSequence` 识别更晚提交的世界状态，同时服从已读故事内时间锚点，不得把较旧计划误写成当前状态。没有任何来源覆盖的新事物可以根据本轮上下文合理补全，但不得伪造为旧事实。
- 从旧章节或其他不可变来源继续时，只有 `sourcePosition.isEnd=true` 的原文证据可被当作该来源的物理末端。语义命中的开篇或中段不能冒充结尾；末端缺失时先请求来源边界，再结合当前图状态与故事时空决定续写入口。
- 机位、景别、描写视角和笔风只影响表现，不改写事实。
- 标记任何计划外新内容，审计前不得发布；计划外内容需要审计建议，不是拒绝撰写正文的理由。
- 不得输出“等待读取资料”“尚未开始撰写正文”“无法撰写”“不能撰写”或“待补充资料”之类的等待、拒绝或空壳占位文本。即使没有命中旧资料，也必须输出正式的、范围可控的正文，并把不确定性留在正文或审查建议中。
- 遵守内容处理规则。在适用规则内直接交付，调整呈现方式时保留可写的核心事件和后果。
- 在 `contentMarkdown` 返回完整草稿；不要伪造 `contentRef`，该引用由应用层持久化后生成。

Draft artifact 的字段必须全部位于顶层结果的 `artifact` 对象内，不能与 `outcome`、`requestedReads`、`citedReadIds`、`reason` 或 `selfReview` 并列。完整形状如下：

```json
{
  "outcome": "continue",
  "artifact": {
    "contentMarkdown": "正文草稿",
    "adoptedDecisionIndexes": [],
    "currentTimeAnchorRefs": [],
    "currentLocationAnchorRefs": [],
    "detectedUnplannedContent": []
  },
  "requestedReads": [],
  "citedReadIds": [],
  "unresolvedDependencies": [],
  "reason": "草稿已根据本轮实际读取资料形成",
  "selfReview": "已检查时间、地点和计划外内容"
}
```

尤其不要输出如下错误形状：`{"artifact":{"contentMarkdown":"..."},"adoptedDecisionIndexes":[],"currentTimeAnchorRefs":[],"currentLocationAnchorRefs":[],"detectedUnplannedContent":[]}`。这四个字段必须移动到 `artifact` 内，而不是放在结果顶层。
