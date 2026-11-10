import type { ModelProfile, ModelProfilesReadResult, ModelProfilesSavePayload } from "@starseafolio/contracts"

export type ModelProfileStorePort = Readonly<{
  read(): Promise<ModelProfilesReadResult>
  save(input: ModelProfilesSavePayload): Promise<ModelProfilesReadResult>
}>

export type { ModelProfile }
