export const MAX_OPEN_EDITOR_DOCUMENTS = 10

export type EditorDocument = Readonly<{
  path: string
  content?: string
  savedContent?: string
}>

export function openEditorDocument(
  documents: readonly EditorDocument[],
  path: string,
): Readonly<{ accepted: boolean; documents: readonly EditorDocument[] }> {
  if (documents.some((document) => document.path === path)) return { accepted: true, documents }
  if (documents.length >= MAX_OPEN_EDITOR_DOCUMENTS) return { accepted: false, documents }
  return { accepted: true, documents: [...documents, { path }] }
}

export function updateEditorDocument(
  documents: readonly EditorDocument[],
  path: string,
  changes: Partial<Pick<EditorDocument, "content" | "savedContent">>,
): readonly EditorDocument[] {
  return documents.map((document) => document.path === path ? { ...document, ...changes } : document)
}

export function saveEditorDocument(
  documents: readonly EditorDocument[],
  path: string,
  savedContent: string,
): readonly EditorDocument[] {
  return updateEditorDocument(documents, path, { savedContent })
}

export function closeEditorDocument(
  documents: readonly EditorDocument[],
  path: string,
  activePath: string | undefined,
): Readonly<{ documents: readonly EditorDocument[]; activePath: string | undefined }> {
  const index = documents.findIndex((document) => document.path === path)
  if (index < 0) return { documents, activePath }
  const remaining = documents.filter((document) => document.path !== path)
  return {
    documents: remaining,
    activePath: activePath === path ? remaining[Math.min(index, remaining.length - 1)]?.path : activePath,
  }
}
