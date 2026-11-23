import { z } from "zod"

export const WORLD_RULES_OVERVIEW_PATH = "世界推演规则/总览.md"

import { idSchema } from "./ids.js"

export const workspaceOperationStatusValues = ["queued", "running", "completed", "failed"] as const
export const workspaceOperationStatusSchema = z.enum(workspaceOperationStatusValues)

export const workspaceOperationSchema = z.object({
  operationId: idSchema,
  projectId: idSchema,
  kind: z.enum(["save", "import_files", "import_folder", "archive", "restore", "publish"]),
  status: workspaceOperationStatusSchema,
  completedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  currentPath: z.string().optional(),
  errorCode: z.string().optional(),
})
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>
