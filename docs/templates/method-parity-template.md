# Method Parity Template

Every source method — skill, command, agent, hook, MCP server, script — gets one row. Status set determines parity score.

## Parity Ledger

| # | Method Name | Source Path | Target Implementation | Status | Behavioral Equivalence | Notes |
|---|------------|------------|----------------------|--------|-----------------------|-------|
| 1 | [METHOD_NAME] | [SOURCE_FILE_PATH:LINE] | [TARGET_FILE_PATH:LINE] | [matched/adapted/skipped/added] | [PROOF_DESCRIPTION] | [NOTES] |
| 2 | [METHOD_NAME] | [SOURCE_FILE_PATH:LINE] | [TARGET_FILE_PATH:LINE] | [matched/adapted/skipped/added] | [PROOF_DESCRIPTION] | [NOTES] |

**Status definitions:**
- **matched** — exact semantic equivalent exists on target (direct map, no adaptation)
- **adapted** — behavior preserved but implementation surface changed (host-native adaptation)
- **skipped** — intentionally not ported; reason required in Notes
- **added** — target-native enhancement not present in source; label clearly, do not inflate parity

**Skipped reason taxonomy:** `license-boundary`, `platform-limitation`, `out-of-scope`, `superseded-by`, `not-applicable`

## Example — LazyCodex → Lazyworkbuddy

| # | Method Name | Source Path | Target Implementation | Status | Behavioral Equivalence | Notes |
|---|------------|------------|----------------------|--------|-----------------------|-------|
| 1 | `init-deep` | `reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md` | `lazyworkbuddy-plugin/skills/init-deep/SKILL.md` + `/lazy-init-deep` command | adapted | Same initialization flow (CLAUDE.md scaffold + plugin install + todo tree); invocation changed from Codex skill load to WorkBuddy command+skill | Command wrapper added for discoverability |
| 2 | `start-work` | `reference/lazycodex/plugins/omo/skills/start-work/SKILL.md` | `lazyworkbuddy-plugin/skills/start-work/SKILL.md` + `/lazy-start-work` command | adapted | Same workflow (boulder load → plan → phase dispatch → taskloop); `multi_agent_v1.spawn_agent` → WorkBuddy `Agent` tool; `.omo/` → `.lazyworkbuddy/` | Most complex port; 5 subagent types mapped to Agent tool calls |
| 3 | `plugin-doctor` | `reference/lazycodex/plugins/omo/scripts/plugin-doctor.sh` | `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` | adapted | Same check pattern (plugin integrity, manifest, skill deps); paths updated; WorkBuddy-specific checks added | No LazyCodex multi_agent_v1 dependency to verify |
| 4 | `librarian` agent | `reference/lazycodex/plugins/omo/agents/librarian.toml` | `lazyworkbuddy-plugin/agents/lazyworkbuddy-librarian.md` | adapted | Same role (semantic memory indexer); TOML → Markdown agent def; codebase_model tool → Read+Glob+Grep toolset | TOML field-to-MD section mapping documented |
| 5 | `vuepress-dashboard` | `reference/lazycodex/plugins/omo/vuepress-dashboard/` | Not ported | skipped | N/A | out-of-scope — WorkBuddy has native dashboard; VuePress rendering not needed |

## Summary

| Status | Count | % |
|--------|-------|---|
| matched | [N] | [N]% |
| adapted | [N] | [N]% |
| skipped | [N] | [N]% |
| added | [N] | [N]% |
| **Total** | **[N]** | **100%** |

**Behavior preserved:** [N]% of source methods have equivalent behavior on target (matched + adapted / total source methods).
