# Command Index Template

Every user-facing command and skill in the system, indexed by name, with source traceability and implementation status.

## Command Index

| # | Name | Type | Source (LazyCodex path) | Target Implementation | Status | Notes |
|---|-----|------|------------------------|----------------------|--------|-------|
| 1 | [COMMAND_NAME] | [command/skill] | [SOURCE_FILE_PATH] | [TARGET_FILE_PATH] | [implemented/adapted/pending/skipped] | [NOTES] |
| 2 | [COMMAND_NAME] | [command/skill] | [SOURCE_FILE_PATH] | [TARGET_FILE_PATH] | [implemented/adapted/pending/skipped] | [NOTES] |

## Type Definitions

- **command** — user-invokable slash command (`/command-name`); typically a thin wrapper around a skill or script
- **skill** — AI-invokable skill (triggered by description match or explicit tool call); defined in SKILL.md
- **internal** — system-internal method not directly invoked by users (e.g., agent definitions, hook scripts)

## Status Definitions

- **implemented** — full semantic parity with source; passes all verification gates
- **adapted** — behavior preserved but implementation surface changed; passes adapted verification gates
- **pending** — planned but not yet implemented; target version assigned in Notes
- **skipped** — intentionally not ported; reason required in Notes

## Example — Lazyworkbuddy Command Index (partial)

| # | Name | Type | Source (LazyCodex path) | Target Implementation | Status | Notes |
|---|-----|------|------------------------|----------------------|--------|-------|
| 1 | `/lazy-init-deep` | command | `reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md` | `lazyworkbuddy-plugin/skills/init-deep/SKILL.md` + `/lazy-init-deep` command wrapper | implemented | 3-phase init: CLAUDE.md scaffold → todo tree → plugin clone |
| 2 | `/lazy-start-work` | command | `reference/lazycodex/plugins/omo/skills/start-work/SKILL.md` | `lazyworkbuddy-plugin/skills/start-work/SKILL.md` + `/lazy-start-work` command wrapper | implemented | 12-phase workflow; 5 subagent types; full taskloop |
| 3 | `/work-summary` | command | `reference/lazycodex/plugins/omo/skills/work-summary/SKILL.md` | `lazyworkbuddy-plugin/skills/work-summary/SKILL.md` | implemented | Summarizes current run state; writes to CLAUDE.md |
| 4 | `/auto-work` | command | `reference/lazycodex/plugins/omo/skills/auto-work/SKILL.md` | `lazyworkbuddy-plugin/skills/auto-work/SKILL.md` + `/auto-work` command | implemented | Looped start-work; continuation via prompt re-entry |
| 5 | `/retry` | command | `reference/lazycodex/plugins/omo/skills/retry/SKILL.md` | `lazyworkbuddy-plugin/skills/retry/SKILL.md` | implemented | Retry failed or undone tasks from task ledger |
| 6 | `plugin-doctor` | internal | `reference/lazycodex/plugins/omo/scripts/plugin-doctor.sh` | `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` | adapted | 47 checks: manifest, skills, agents, hooks, MCP, scripts |
| 7 | `init` (skill) | skill | `reference/lazycodex/plugins/omo/skills/init/SKILL.md` | `lazyworkbuddy-plugin/skills/init/SKILL.md` | implemented | Shallow init; CLAUDE.md only; subset of init-deep |
| 8 | `migration-planner` | skill | N/A (Lazyworkbuddy innovation) | `lazyworkbuddy-plugin/skills/migration-planner/SKILL.md` | implemented | added — no LazyCodex equivalent; 9-step workflow |
| 9 | `ultrawork` | command | `reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md` | `lazyworkbuddy-plugin/skills/ultrawork/SKILL.md` | pending | Browser-dependent Manual-QA workflow; blocked by browser gap (R-004) |

## Summary

| Status | Count | % |
|--------|-------|---|
| implemented | [N] | [N]% |
| adapted | [N] | [N]% |
| pending | [N] | [N]% |
| skipped | [N] | [N]% |
| added | [N] | [N]% |
| **Total** | **[N]** | **100%** |
