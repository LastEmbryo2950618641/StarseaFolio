import { create } from "zustand"

export type RightTab = "chapters" | "process" | "graph" | "evolution" | "history" | "graph-revisions"

export type ProjectSettingsSection =
  | "execution"
  | "retrieval"
  | "graph"
  | "history"
  | "model"
  | "workDirectory"
  | "about"

type WorkbenchState = Readonly<{
  writingSettingsOpen: boolean
  setWritingSettingsOpen: (open: boolean) => void
  rightTab: RightTab
  setRightTab: (tab: RightTab) => void
  modelDialogOpen: boolean
  projectSettingsOpen: boolean
  projectSettingsSection: ProjectSettingsSection
  openModelDialog: () => void
  closeModelDialog: () => void
  openProjectSettings: (section?: ProjectSettingsSection) => void
  closeProjectSettings: () => void
  openModelFromSettings: () => void
  closeAllDialogs: () => void
}>

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  writingSettingsOpen: false,
  setWritingSettingsOpen: (writingSettingsOpen) => { set({ writingSettingsOpen }); },
  rightTab: "chapters",
  setRightTab: (rightTab) => { set({ rightTab }); },
  modelDialogOpen: false,
  projectSettingsOpen: false,
  projectSettingsSection: "execution",
  openModelDialog: () => { set({ modelDialogOpen: true }); },
  closeModelDialog: () => { set({ modelDialogOpen: false }); },
  openProjectSettings: (section = "execution") => {
    set({ projectSettingsOpen: true, projectSettingsSection: section });
  },
  closeProjectSettings: () => { set({ projectSettingsOpen: false }); },
  openModelFromSettings: () => {
    set({ projectSettingsOpen: false, modelDialogOpen: true });
  },
  closeAllDialogs: () => {
    set({ modelDialogOpen: false, projectSettingsOpen: false, writingSettingsOpen: false });
  },
}))
