import { createContext, useContext, useMemo, useSyncExternalStore } from "react"

import { createChoiceComposer, type ChoiceComposer } from "./synopsis-choice-state.js"

const ChoiceComposerContext = createContext<ChoiceComposer | null>(null)

export function SynopsisChoiceComposerProvider(props: Readonly<{
  scope: string
  children: React.ReactNode
}>): React.JSX.Element {
  const composer = useMemo(() => createChoiceComposer(), [props.scope])
  return <ChoiceComposerContext.Provider value={composer}>{props.children}</ChoiceComposerContext.Provider>
}

export function useChoiceComposer(): ChoiceComposer {
  const composer = useContext(ChoiceComposerContext)
  if (composer === null) throw new Error("Choice composer provider is missing")
  return composer
}

export function useChoiceDraft(): Readonly<{ composer: ChoiceComposer; draft: string }> {
  const composer = useChoiceComposer()
  const draft = useSyncExternalStore(composer.subscribe, composer.getDraft, composer.getDraft)
  return { composer, draft }
}
