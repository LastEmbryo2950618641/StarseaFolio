import { createHash } from "node:crypto"

export function parseBenchmarkAnswer(markdown) {
  const text = markdown.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")
  const result = JSON.parse(text)
  if (!result || Array.isArray(result) || typeof result.answer !== "string" || typeof result.abstain !== "boolean") {
    throw new Error("Answer must be a JSON object with string answer and boolean abstain")
  }
  return { answer: result.answer, abstain: result.abstain }
}

// Only source text actually supplied to the model earns original-evidence credit.
export function sourceEvidenceFromTrace(calls, sourceMap) {
  const evidence = new Map()
  for (const call of calls) {
    for (const item of call.request?.input?.readEvidence ?? []) {
      if (item.ownerKind !== "source") continue
      const source = sourceMap.get(item.ownerId)
      if (!source || typeof item.semanticText !== "string" || !item.semanticText.trim() || !source.body.includes(item.semanticText)) continue
      evidence.set(JSON.stringify([source.source_key, item.semanticText]), {
        source_key: source.source_key, content: item.semanticText,
      })
    }
  }
  return [...evidence.values()]
}

export function auditQueryIsolation(calls, taskId, sourceMap, snapshotChapter) {
  const issues = []
  if (calls.length === 0) issues.push("no_model_calls_audited")
  for (const call of calls) {
    for (const message of call.contextMessages ?? []) {
      if (message.taskId !== taskId && message.kind !== "system_rules") {
        issues.push(`inherited_message:${message.messageId}`)
      }
      if (message.kind === "canonical_chapter") issues.push("canonical_chapter_in_context")
    }
    for (const item of call.request?.input?.readEvidence ?? []) {
      if (item.visibility !== "committed") issues.push(`uncommitted_evidence:${item.readId}`)
      if (item.ownerKind?.startsWith("workspace") && /(?:chapters|正文)/iu.test(item.ownerId)) {
        issues.push(`workspace_chapter_read:${item.ownerId}`)
      }
      if (item.ownerKind === "source") {
        const source = sourceMap.get(item.ownerId)
        if (!source) issues.push(`unmapped_source:${item.ownerId}`)
        else if (source.sequence > snapshotChapter) issues.push(`future_source:${source.source_key}`)
      }
    }
  }
  return { passed: issues.length === 0, issues: [...new Set(issues)], auditedCalls: calls.length }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
