# Lazyworkbuddy Current Status

> Canonical current-state source for Lazyworkbuddy. Historical version notes may remain in older sections of other docs, but current claims should point here.

Last updated: 2026-07-09

## Version And Release State

- Active phase: **v0.12 diagnosis and release hardening**.
- Package metadata: **0.12.0** in `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json`.
- Package status: **runtime-verified for the v0.12 local release gates recorded in Todo 6**. Evidence: `.omo/evidence/task-6-diagnosis-v0-12-lazyworkbuddy.txt`.
- Dogfood evidence: **runtime-verified for the scripted v0.12 replay**. Evidence: `.omo/evidence/task-5-diagnosis-v0-12-lazyworkbuddy.txt` and `.lazyworkbuddy/runs/dogfood-v0.12/`.
- Scope note: no git tag, publish, marketplace upload, or claim of full semantic MCP/code-navigation parity is included in v0.12.

## Status Labels

- `runtime-verified`: verified by a named command or evidence file.
- `implemented-unverified`: files or scripts exist, but the current release gate has not been rerun or recorded.
- `prompt-only`: documented workflow with no executable/runtime surface yet.
- `heuristic-substitute`: WorkBuddy-native approximation of a LazyCodex capability; useful but not semantic parity.
- `platform-gap`: difference caused by host/platform behavior that Lazyworkbuddy cannot reproduce directly.
- `native-enhancement`: WorkBuddy-only addition that improves on or extends LazyCodex behavior.

## Component Counts

| Surface | Current count | Status | Evidence / next command |
| --- | ---: | --- | --- |
| Skills | 14 | runtime-verified | `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` |
| Command docs | 15 | runtime-verified | `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` |
| Agents | 13 | runtime-verified | `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` |
| Hook events | 12 | runtime-verified | `bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh` |
| MCP servers | 8 | runtime-verified smoke | `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` |

## MCP Server Status

The plugin manifest declares 8 MCP servers:

- `run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`: WorkBuddy-native run-management servers from v0.8.
- `context-graph`, `code-intel`, `docs`: v0.11 context-tooling substitutes.

Capability labels:

- `run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`: `native-enhancement`.
- `context-graph`, `code-intel`: `heuristic-substitute` for LazyCodex codegraph/LSP-like workflows; not full semantic codegraph or LSP parity.
- `docs`: `heuristic-substitute` for docs lookup; registry-backed, not Context7 parity.
- `git_bash` and `grep_app`: `platform-gap` / host substitution; covered by WorkBuddy native shell/search surfaces rather than MCP ports.

## Open Gaps

- The Prometheus plan's separate final verification wave is not marked complete by Todo 6.
- Context graph and code intelligence remain heuristic substitutes, not semantic parity with LazyCodex's external codegraph/LSP stack.
- Channels and native LSP remain platform-level gaps unless WorkBuddy exposes those surfaces.

## Next Verification Commands

Current release-gate commands:

```bash
test -f docs/lazyworkbuddy-current-status.md
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh
bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh
```
