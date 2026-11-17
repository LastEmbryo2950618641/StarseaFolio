# Platform skills (scripts)

Skill **bodies** live in `resources/vendor/chinese-webnovel-skills/` and `resources/v1/*-guide.md` (see `src/skill-registry.ts`).

**Host protocol skill:** `starsea-writing/` — `SKILL.md`, `.folio` ui-state/action schemas, and disk scripts (`settings-write`, `graph-*`, `chapter-publish`, `apply-action`). Codex and StarseaFolio share this pack.

Other optional scripts next to skill ids:

- `webnovel-deslop/scripts/scan-template-tells.mjs`
- `webnovel-dialogue/scripts/scan-dialogue-pingpong.mjs`

Discuss `bash` may run them when the host resolves a whitelisted skill script path (see backend `skill-script-whitelist.ts`).
