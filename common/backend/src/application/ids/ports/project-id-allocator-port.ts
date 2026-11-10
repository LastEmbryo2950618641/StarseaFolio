import type { PersistentIdPrefix, ProjectId } from "@starseafolio/contracts"

export interface ProjectIdAllocatorPort {
  next(projectId: ProjectId, prefix: PersistentIdPrefix): Promise<string>
}
