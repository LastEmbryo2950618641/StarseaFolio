import type { ModelListPayload, ModelListResult } from "@starseafolio/contracts"

export type ModelCatalogPort = Readonly<{
  list(input: ModelListPayload): Promise<ModelListResult>
}>
