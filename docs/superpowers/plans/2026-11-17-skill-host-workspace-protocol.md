# Skill Host Workspace Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `starsea-writing` skill owns prompts, disk scripts, and `ui-state`; StarseaFolio only binds the workspace and renders panels; Codex runs the same skill without UI.

**Architecture:** Skill pack under `prompt-contracts/resources/skills/starsea-writing/` plus a host-agnostic `.folio/` protocol library. StarseaFolio thin runner consumes `.folio/actions`, invokes skill scripts / model, and maps `.folio/ui-state.json` into existing panels. App-owned discuss/settings/graph/publish orchestration is retired after scripts cover the path.

**Tech Stack:** TypeScript monorepo, Zod schemas in `@starseafolio/contracts`, prompt-contracts resources, Vitest, Node scripts callable from skill bash whitelist.

**Spec:** [2026-11-17-skill-host-workspace-protocol-design.md](../specs/2026-11-17-skill-host-workspace-protocol-design.md)

## Global Constraints

- Codex and StarseaFolio must share the same skill capabilities and flow (creation desk → settings → graph → publish).
- Skill scripts own all workspace writes for settings, graph, and chapter body.
- StarseaFolio must not keep a second business prompt/orchestration path after cutover.
- Graph recovery tools: cancel / rerun-all / continue-failed (same semantics as current UI).
- `.folio/ui-state.json` is the only UI data source after cutover.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `common/packages/prompt-contracts/resources/skills/starsea-writing/SKILL.md` | Host-agnostic skill body: stages, tools, host differences |
| `.../schema/ui-state.schema.json` | JSON Schema for ui-state |
| `.../schema/action.schema.json` | JSON Schema for actions |
| `.../scripts/*.mjs` | Disk tools (settings, graph, publish, folio helpers) |
| `common/packages/contracts/src/folio-protocol.ts` | Zod types for host/ui-state/action |
| `common/backend/src/application/folio/folio-workspace.ts` | Read/write `.folio/*` |
| `common/backend/src/application/folio/folio-skill-runner.ts` | Consume actions, run scripts, refresh ui-state |
| `common/backend/test/folio-protocol.test.ts` | Protocol + runner contract tests |
| Renderer panels | Eventually map ui-state only (creation desk first) |

---

## Task 1: Folio protocol types + skill pack skeleton

**Files:**
- Create: `common/packages/contracts/src/folio-protocol.ts`
- Create: skill pack under `resources/skills/starsea-writing/`
- Modify: `common/packages/contracts/src/index.ts` (export)
- Modify: `common/packages/prompt-contracts/src/skill-registry.ts`
- Test: `common/backend/test/folio-protocol.test.ts` (or contracts test)

- [ ] Step 1: Add Zod schemas for `FolioHost`, `FolioUiState`, `FolioAction` matching the design
- [ ] Step 2: Add failing test that validates a minimal ui-state and rejects invalid shape
- [ ] Step 3: Create `SKILL.md`, JSON schemas, and stub scripts that write/update `.folio/ui-state.json`
- [ ] Step 4: Register `starsea-writing` in `PLATFORM_SKILLS`
- [ ] Step 5: Commit

## Task 2: Folio workspace library

**Files:**
- Create: `common/backend/src/application/folio/folio-workspace.ts`
- Test: `common/backend/test/folio-protocol.test.ts`

- [ ] Step 1: Implement `ensureFolioLayout`, `writeHost`, `readUiState`, `writeUiState`, `enqueueAction`, `claimNextAction`
- [ ] Step 2: Tests on temp dirs
- [ ] Step 3: Commit

## Task 3: Thin FolioSkillRunner (script path first)

**Files:**
- Create: `common/backend/src/application/folio/folio-skill-runner.ts`
- Scripts: `ui-state-patch.mjs`, `settings-write.mjs`, `graph-*.mjs`, `chapter-publish.mjs` stubs

- [ ] Step 1: Runner claims action → dispatches to script by action name → script updates ui-state
- [ ] Step 2: Contract test: `creationDesk.send` → ui-state message appended (stub)
- [ ] Step 3: Contract test: `graph.continue` / `graph.rerun` / `graph.cancel` update graph panel flags
- [ ] Step 4: Commit

## Task 4: Wire StarseaFolio creation desk to ui-state (read path)

**Files:**
- Backend facade methods for folio ui-state / enqueue action
- Renderer: creation desk reads ui-state snapshot; send writes action

- [ ] Step 1: Backend API `folio.uiState.read` / `folio.action.enqueue`
- [ ] Step 2: Creation desk poll ui-state; composer enqueue send action
- [ ] Step 3: Tests for mapping
- [ ] Step 4: Commit

## Task 5: Real settings / graph / publish scripts (cutover)

**Files:**
- Move logic from `SettingsExtractionService`, graph sync, `publishDraft` into skill scripts or script-callable services
- Retire app orchestration entry points

- [ ] Step 1: `settings-write` produces settings disk writes + ui-state progress
- [ ] Step 2: `graph-sync` / continue / rerun / cancel
- [ ] Step 3: `chapter-publish`
- [ ] Step 4: `publishDraft` path becomes folio actions only
- [ ] Step 5: Codex README / SKILL host section verified
- [ ] Step 6: Commit + push build

---

## Done when

1. Codex can run the skill on a workspace without StarseaFolio and produce settings + graph + chapter body.
2. StarseaFolio panels are driven by `ui-state.json` for creation desk + graph + publish.
3. App-owned prompt/orchestration for that path is removed or unreachable.
