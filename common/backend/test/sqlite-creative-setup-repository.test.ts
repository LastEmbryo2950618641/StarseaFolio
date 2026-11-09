import BetterSqlite3 from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kysely, SqliteDialect, sql } from "kysely"
import { afterEach, describe, expect, it } from "vitest"

import {
  answerCreativeSetupQuestion,
  initialCreativeSetupState,
  markCreativeSetupWritten,
  openCreativeSetupQuestion,
  type CreativeSetupState,
} from "../src/application/chapters/creative-setup-state.js"
import type { ProjectDatabase } from "../src/infrastructure/sqlite/database-types.js"
import { migrateSqliteDatabase } from "../src/infrastructure/sqlite/migrations/migration-runner.js"
import { projectMigrations } from "../src/infrastructure/sqlite/migrations/project-migrations.js"
import { SqliteCreativeSetupRepository } from "../src/infrastructure/sqlite/repositories/sqlite-creative-setup-repository.js"
import { openProjectDatabase } from "../src/infrastructure/sqlite/sqlite-database.js"

const directories: string[] = []
const databases = new Set<Kysely<ProjectDatabase>>()

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "worldseed-creative-setup-"))
  directories.push(directory)
  return join(directory, "project.sqlite")
}

async function open(path: string): Promise<Kysely<ProjectDatabase>> {
  const database = await openProjectDatabase(path)
  databases.add(database)
  return database
}

async function close(database: Kysely<ProjectDatabase>): Promise<void> {
  await database.destroy()
  databases.delete(database)
}

async function seedProject(database: Kysely<ProjectDatabase>, id = "project-a"): Promise<void> {
  await database.insertInto("projects").values({
    id, name: id, manifest_version: 1, committed_sequence: 0, created_at: 1, updated_at: 1,
  }).execute()
}

function answeredVolume(): CreativeSetupState {
  let state = initialCreativeSetupState("volume:第一卷", 1)
  for (const [index, answer] of ["医师抵达边城", "识破投毒者", "启程寻找妹妹", "无支线"].entries()) {
    const id = `q-${String(index)}`
    state = answerCreativeSetupQuestion(openCreativeSetupQuestion(state, id, 2), { questionId: id, answer, now: 3 })
  }
  return state
}

afterEach(async () => {
  for (const database of databases) await close(database)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("SQLite creative setup repository", () => {
  it("persists pending question IDs across a real SQLite close and reopen", async () => {
    const path = databasePath()
    const database = await open(path)
    await seedProject(database)
    const repository = new SqliteCreativeSetupRepository(database)
    expect(await repository.find("project-a", "protagonist")).toBeUndefined()
    const pending = openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "stable-question", 2)
    await repository.save("project-a", pending)
    await close(database)

    const reopened = await open(path)
    const resumedRepository = new SqliteCreativeSetupRepository(reopened)
    const resumed = await resumedRepository.find("project-a", "protagonist")
    expect(resumed).toEqual(pending)
    if (resumed === undefined) throw new Error("Pending setup did not survive reopen")
    expect(openCreativeSetupQuestion(resumed, "retry-id", 3).pendingQuestion?.id).toBe("stable-question")
    const answered = answerCreativeSetupQuestion(resumed, { questionId: "stable-question", answer: "坚韧而克制", now: 4 })
    await resumedRepository.save("project-a", answered)
    expect(await resumedRepository.find("project-a", "protagonist")).toEqual(answered)
    expect(await reopened.selectFrom("creative_setup_states").selectAll().execute()).toHaveLength(1)
  })

  it("isolates project and volume scopes and upserts without replacing their neighbors", async () => {
    const database = await open(databasePath())
    await seedProject(database)
    await seedProject(database, "project-b")
    const repository = new SqliteCreativeSetupRepository(database)
    await repository.save("project-a", initialCreativeSetupState("protagonist", 1))
    await repository.save("project-b", initialCreativeSetupState("protagonist", 2))
    await repository.save("project-a", initialCreativeSetupState("volume:第一卷", 3))
    await repository.save("project-a", initialCreativeSetupState("volume:第二卷", 4))
    await repository.save("project-a", openCreativeSetupQuestion(initialCreativeSetupState("protagonist", 1), "new-question", 5))
    expect((await repository.find("project-a", "protagonist"))?.pendingQuestion?.id).toBe("new-question")
    expect((await repository.find("project-b", "protagonist"))?.updatedAtMs).toBe(2)
    expect((await repository.find("project-a", "volume:第一卷"))?.updatedAtMs).toBe(3)
    expect((await repository.find("project-a", "volume:第二卷"))?.updatedAtMs).toBe(4)
    expect(await repository.find("project-b", "volume:第一卷")).toBeUndefined()
    expect(await database.selectFrom("creative_setup_states").selectAll().execute()).toHaveLength(4)
  })

  it("persists awaiting_write and explicit ready acknowledgements independently of file existence", async () => {
    const path = databasePath()
    let database = await open(path)
    await seedProject(database)
    const state = answeredVolume()
    await new SqliteCreativeSetupRepository(database).save("project-a", state)
    await close(database)
    database = await open(path)
    const repository = new SqliteCreativeSetupRepository(database)
    expect((await repository.find("project-a", "volume:第一卷"))?.status).toBe("awaiting_write")
    const ready = markCreativeSetupWritten(state, { path: "不存在的卷设定.md", digest: "written-digest", now: 10 })
    await repository.save("project-a", ready)
    await close(database)
    database = await open(path)
    expect(await new SqliteCreativeSetupRepository(database).find("project-a", "volume:第一卷")).toEqual(ready)
  })

  it.each([
    "not-json",
    "null",
    JSON.stringify({ version: 2, scope: "protagonist", status: "ready", answers: {}, updatedAtMs: 1 }),
    JSON.stringify({ version: 1, scope: "protagonist", status: "ready", answers: {}, settingsPath: "existing.md", settingsDigest: "existing", updatedAtMs: 1 }),
    JSON.stringify({ version: 1, scope: "volume:wrong", status: "collecting", answers: {}, updatedAtMs: 1 }),
    JSON.stringify({ version: 1, scope: "protagonist", status: "collecting", answers: {}, pendingQuestion: { id: "q", field: "goal" }, updatedAtMs: 1 }),
    JSON.stringify({ version: 1, scope: "protagonist", status: "collecting", answers: {}, updatedAtMs: 99 }),
  ])("rejects corrupted persisted JSON instead of defaulting or auto-readying: %s", async (stateJson) => {
    const database = await open(databasePath())
    await seedProject(database)
    await sql`INSERT INTO creative_setup_states (project_id, scope, state_json, updated_at_ms)
      VALUES ('project-a', 'protagonist', ${stateJson}, 1)`.execute(database)
    await expect(new SqliteCreativeSetupRepository(database).find("project-a", "protagonist")).rejects.toThrow()
  })

  it("validates before saving, preserves existing data on failure, and enforces project foreign keys", async () => {
    const database = await open(databasePath())
    await seedProject(database)
    const repository = new SqliteCreativeSetupRepository(database)
    const state = initialCreativeSetupState("protagonist", 1)
    await repository.save("project-a", state)
    await expect(repository.save("project-a", { ...state, status: "ready" })).rejects.toThrow()
    expect(await repository.find("project-a", "protagonist")).toEqual(state)
    await expect(repository.save("missing-project", state)).rejects.toThrow(/FOREIGN KEY/)
  })

  it("appends a migration to existing projects without grandfathering any setup as ready", async () => {
    const path = databasePath()
    const legacy = new Kysely<ProjectDatabase>({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) })
    databases.add(legacy)
    await migrateSqliteDatabase(legacy, projectMigrations.slice(0, 57))
    await seedProject(legacy)
    const before = await legacy.selectFrom("schema_migrations").selectAll().orderBy("version").execute()
    await close(legacy)

    const migrated = await open(path)
    const after = await migrated.selectFrom("schema_migrations").selectAll().orderBy("version").execute()
    expect(after.slice(0, 57)).toEqual(before)
    expect(after.at(-1)).toMatchObject({ version: 58, name: "058_creative_setup_states" })
    expect(await new SqliteCreativeSetupRepository(migrated).find("project-a", "protagonist")).toBeUndefined()
    expect(await migrated.selectFrom("creative_setup_states").selectAll().execute()).toEqual([])
    const columns = await sql<{ name: string; pk: number }>`PRAGMA table_info(creative_setup_states)`.execute(migrated)
    expect(columns.rows.map(({ name, pk }) => ({ name, pk }))).toEqual([
      { name: "project_id", pk: 1 }, { name: "scope", pk: 2 }, { name: "state_json", pk: 0 }, { name: "updated_at_ms", pk: 0 },
    ])
  })
})
