# Command Index Template

Every user-facing command and skill in the system, indexed by name with implementation status.

## Command Index

| # | Name | Type | Implementation | Status | Notes |
|---|------|----------------|----------------|--------|-------|
| 1 | [COMMAND_NAME] | [command/skill] | [IMPLEMENTATION_PATH] | [implemented/pending/skipped] | [NOTES] |
| 2 | [COMMAND_NAME] | [command/skill] | [IMPLEMENTATION_PATH] | [implemented/pending/skipped] | [NOTES] |

## Type Definitions

- **command** — user-invokable slash command (`/command-name`); typically a thin wrapper around a skill or script
- **skill** — AI-invokable skill (triggered by description match or explicit tool call); defined in SKILL.md
- **internal** — system-internal method not directly invoked by users (for example, agent definitions and hook scripts)

## Status Definitions

- **implemented** — current behavior is available and passes all required verification gates
- **pending** — planned but not yet implemented; target version assigned in Notes
- **skipped** — intentionally not implemented; reason required in Notes

## Example — LazyBuddy Command Index (partial)

| # | Name | Type | Implementation | Status | Notes |
|---|-----|------|----------------|--------|-------|
| 1 | `/lazy-init-deep` | command | `lazybuddy-plugin/skills/init-deep/SKILL.md` + `/lazy-init-deep` command wrapper | implemented | 3-phase init: CLAUDE.md scaffold → todo tree → plugin clone |
| 2 | `/lazy-start-work` | command | `lazybuddy-plugin/skills/start-work/SKILL.md` + `/lazy-start-work` command wrapper | implemented | 12-phase workflow; 5 subagent types; full taskloop |
| 3 | `/work-summary` | command | `lazybuddy-plugin/skills/work-summary/SKILL.md` | implemented | Summarizes current run state; writes to CLAUDE.md |
| 4 | `/auto-work` | command | `lazybuddy-plugin/skills/auto-work/SKILL.md` + `/auto-work` command | implemented | Looped start-work; continuation via prompt re-entry |
| 5 | `/retry` | command | `lazybuddy-plugin/skills/retry/SKILL.md` | implemented | Retry failed or undone tasks from task ledger |
| 6 | `plugin-doctor` | internal | `lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh` | implemented | Checks manifest, skills, agents, hooks, MCP, and scripts |
| 7 | `init` (skill) | skill | `lazybuddy-plugin/skills/init/SKILL.md` | implemented | Shallow init; CLAUDE.md only; subset of init-deep |
| 8 | `migration-planner` | skill | `lazybuddy-plugin/skills/migration-planner/SKILL.md` | implemented | 9-step workflow |
| 9 | `ultrawork` | command | `lazybuddy-plugin/skills/ultrawork/SKILL.md` | pending | Browser-dependent Manual-QA workflow; blocked by browser gap (R-004) |

## Summary

| Status | Count | % |
|--------|-------|---|
| implemented | [N] | [N]% |
| pending | [N] | [N]% |
| skipped | [N] | [N]% |
| **Total** | **[N]** | **100%** |
