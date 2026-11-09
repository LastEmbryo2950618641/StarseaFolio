import type { Kysely } from "kysely"

import {
  parseCreativeSetupState,
  type CreativeSetupState,
} from "../../../application/chapters/creative-setup-state.js"
import type { ProjectDatabase } from "../database-types.js"
import { decodeJson, encodeJson } from "../json-codec.js"

export class SqliteCreativeSetupRepository {
  public constructor(private readonly database: Kysely<ProjectDatabase>) {}

  public async find(projectId: string, scope: string): Promise<CreativeSetupState | undefined> {
    const row = await this.database.selectFrom("creative_setup_states")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("scope", "=", scope)
      .executeTakeFirst()
    if (row === undefined) return undefined
    const state = parseCreativeSetupState(decodeJson(row.state_json))
    if (state.scope !== row.scope || state.updatedAtMs !== row.updated_at_ms) {
      throw new Error("Invalid creative setup state: persisted scope or timestamp mismatch")
    }
    return state
  }

  public async save(projectId: string, state: CreativeSetupState): Promise<void> {
    const parsed = parseCreativeSetupState(state)
    const stateJson = encodeJson(parsed)
    await this.database.insertInto("creative_setup_states").values({
      project_id: projectId,
      scope: parsed.scope,
      state_json: stateJson,
      updated_at_ms: parsed.updatedAtMs,
    }).onConflict((conflict) => conflict.columns(["project_id", "scope"]).doUpdateSet({
      state_json: stateJson,
      updated_at_ms: parsed.updatedAtMs,
    })).executeTakeFirstOrThrow()
  }
}
