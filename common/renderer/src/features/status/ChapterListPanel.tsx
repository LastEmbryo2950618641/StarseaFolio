import { useEffect, useState } from "react"
import type { ChapterRevisionReadResult, ChapterSummary } from "@worldseed/contracts"

import { ChapterBrowseDetailRail } from "../editor/ChapterBrowseDetailRail.js"
import { ChapterPanel } from "../editor/ChapterPanel.js"
import {
  groupChaptersByVolume,
  parseChapterSequenceFromPath,
  type DiscussFocusChapterOption,
} from "../editor/synopsis-path.js"

type Props = Readonly<{
  projectId: string
  workspaceRootRef: string
  chapters: readonly DiscussFocusChapterOption[]
  chapterSummaries: readonly ChapterSummary[]
  unpublishedDrafts: readonly ChapterRevisionReadResult[]
  draftCandidateVersionId?: string
  onSelectDraftCandidate?(revisionTaskId: string, versionId: string): void
  selectedPath?: string
  onOpenBody(path: string): void
}>

export function ChapterListPanel(props: Props): React.JSX.Element {
  const [selectedChapter, setSelectedChapter] = useState<DiscussFocusChapterOption>()
  const [selectedVolumeFolderName, setSelectedVolumeFolderName] = useState<string>()

  useEffect(() => {
    if (selectedChapter === undefined) return
    const current = props.chapters.find((chapter) => chapter.sequence === selectedChapter.sequence)
    if (current === undefined) setSelectedChapter(undefined)
  }, [props.chapters, selectedChapter])

  useEffect(() => {
    if (selectedVolumeFolderName === undefined) return
    const volumeExists = groupChaptersByVolume(props.chapters)
      .some((group) => group.volumeFolderName === selectedVolumeFolderName)
    if (!volumeExists) setSelectedVolumeFolderName(undefined)
  }, [props.chapters, selectedVolumeFolderName])

  if (selectedChapter !== undefined) {
    const current = props.chapters.find((chapter) => chapter.sequence === selectedChapter.sequence) ?? selectedChapter
    return <div className="chapter-list-detail" data-testid="chapter-list-detail">
      <ChapterBrowseDetailRail
        projectId={props.projectId}
        workspaceRootRef={props.workspaceRootRef}
        chapter={current}
        backLabel="返回章节列表"
        unpublishedDrafts={props.unpublishedDrafts}
        {...(props.draftCandidateVersionId === undefined ? {} : { draftCandidateVersionId: props.draftCandidateVersionId })}
        {...(props.onSelectDraftCandidate === undefined ? {} : { onSelectDraftCandidate: props.onSelectDraftCandidate })}
        onOpenBody={props.onOpenBody}
        onBack={() => { setSelectedChapter(undefined) }}
      />
    </div>
  }

  if (selectedVolumeFolderName !== undefined) {
    const volume = groupChaptersByVolume(props.chapters)
      .find((group) => group.volumeFolderName === selectedVolumeFolderName)
    if (volume !== undefined) {
      return <div className="chapter-list-detail" data-testid="chapter-list-detail">
        <ChapterBrowseDetailRail
          projectId={props.projectId}
          workspaceRootRef={props.workspaceRootRef}
          chapter={undefined}
          volume={{ folderName: volume.volumeFolderName, chapters: volume.chapters }}
          backLabel="返回章节列表"
          onOpenBody={props.onOpenBody}
          onBack={() => { setSelectedVolumeFolderName(undefined) }}
        />
      </div>
    }
  }

  return <ChapterPanel
    projectId={props.projectId}
    chapters={props.chapters}
    chapterSummaries={props.chapterSummaries}
    unpublishedDrafts={props.unpublishedDrafts}
    workspaceRootRef={props.workspaceRootRef}
    selectedSequence={props.selectedPath === undefined ? undefined : parseChapterSequenceFromPath(props.selectedPath)}
    {...(selectedVolumeFolderName === undefined ? {} : { selectedVolumeFolderName })}
    onSelectChapter={(chapter) => {
      setSelectedVolumeFolderName(undefined)
      setSelectedChapter(chapter)
    }}
    onSelectVolume={(volumeFolderName) => {
      setSelectedChapter(undefined)
      setSelectedVolumeFolderName(volumeFolderName)
    }}
  />
}
