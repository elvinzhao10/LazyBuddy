# Method Inventory Template

Every current method — skill, command, agent, hook, MCP server, or script — gets one row.

## Method Inventory

| # | Method Name | Implementation | Status | Verification | Notes |
|---|------------|----------------|--------|--------------|-------|
| 1 | [METHOD_NAME] | [IMPLEMENTATION_PATH:LINE] | [active/pending/skipped] | [PROOF_DESCRIPTION] | [NOTES] |
| 2 | [METHOD_NAME] | [IMPLEMENTATION_PATH:LINE] | [active/pending/skipped] | [PROOF_DESCRIPTION] | [NOTES] |

**Status definitions:**

- **active** — current behavior is available and verified
- **pending** — planned but not yet implemented; target version assigned in Notes
- **skipped** — intentionally not implemented; reason required in Notes

**Skipped reason taxonomy:** `license-boundary`, `platform-limitation`, `out-of-scope`, `superseded-by`, `not-applicable`

## Example — LazyBuddy Methods

| # | Method Name | Implementation | Status | Verification | Notes |
|---|------------|----------------|--------|--------------|-------|
| 1 | `init-deep` | `lazybuddy-plugin/skills/init-deep/SKILL.md` + `/lazy-init-deep` command | active | Initialization flow creates the project scaffold and task tree | Command wrapper supports discovery |
| 2 | `start-work` | `lazybuddy-plugin/skills/start-work/SKILL.md` + `/lazy-start-work` command | active | Workflow loads a plan, dispatches work, and records progress | Supports task-loop coordination |
| 3 | `plugin-doctor` | `lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh` | active | Checks plugin integrity, manifest, skills, agents, hooks, MCP, and scripts | WorkBuddy-specific checks included |
| 4 | `librarian` agent | `lazybuddy-plugin/agents/lazybuddy-librarian.md` | active | Maintains semantic memory with the configured toolset | Markdown agent definition |
| 5 | `status-dashboard` | Not implemented | skipped | N/A | WorkBuddy has a native dashboard |

## Summary

| Status | Count | % |
|--------|-------|---|
| active | [N] | [N]% |
| pending | [N] | [N]% |
| skipped | [N] | [N]% |
| **Total** | **[N]** | **100%** |

**Verification coverage:** [N]% of active methods have current verification evidence.
