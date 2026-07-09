# Risk Register Template

Track migration risks as live items. Each risk must have a severity, mitigation plan, and target version where it should be resolved.

## Risk Register

| ID | Description | Severity | Likelihood | Mitigation | Contingency | Monitoring | Target Version | Status |
|----|------------|----------|-----------|------------|-------------|-----------|---------------|--------|
| R-[NNN] | [DESCRIPTION] | **[Critical/High/Medium/Low]** | [High/Medium/Low] | [MITIGATION_ACTION] | [FALLBACK_PLAN] | [MONITORING_METHOD] | [VERSION] | [OPEN/RESOLVED/ACCEPTED] |
| R-[NNN] | [DESCRIPTION] | **[Critical/High/Medium/Low]** | [High/Medium/Low] | [MITIGATION_ACTION] | [FALLBACK_PLAN] | [MONITORING_METHOD] | [VERSION] | [OPEN/RESOLVED/ACCEPTED] |

## Severity Definitions

- **Critical** — blocks migration entirely; cannot proceed without resolution
- **High** — severely degrades behavior of a core workflow (e.g., start-work, init-deep)
- **Medium** — degrades behavior of a non-core workflow or adds friction
- **Low** — cosmetic or edge-case impact; acceptable for immediate release

## Status Definitions

- **OPEN** — active risk; mitigation in progress or not yet started
- **RESOLVED** — mitigation verified; risk no longer present
- **ACCEPTED** — risk acknowledged and deliberately accepted (document why in Notes)

## Example — Lazyworkbuddy v0.10 Migration Risk Register

| ID | Description | Severity | Likelihood | Mitigation | Contingency | Monitoring | Target Version | Status |
|----|------------|----------|-----------|------------|-------------|-----------|---------------|--------|
| R-001 | Subagent parallelism degradation — WorkBuddy Agent tool spawns agent one at a time vs Codex parallel spawn; may slow start-work Phase 3 taskloop | **Medium** | Medium | Benchmark agent dispatch latency; ensure sequential launch overhead is < 30s per agent; if not, batch agent messages | Fall back to single-agent taskloop (slower but correct) | Monitor agent dispatch wall-clock time in start-work runs | v0.5 | RESOLVED — sequential dispatch acceptable; overhead < 15s |
| R-002 | WorkBuddy `Agent` tool timeout on long-running worker tasks — Codex had no hard timeout; WorkBuddy may timeout before worker finishes | **Medium** | Medium | Design worker tasks as short, idempotent units; use `continue.md` for checkpoint/restart | Worker loss handled by taskloop — unfinished tasks re-queued | Check taskloop recovery: re-run any `in_progress` tasks on next turn | v0.5 | MONITORING — no timeouts observed in 50+ start-work runs |
| R-003 | Hook model mismatch — Codex `Stop/SubagentStop` continuation hook not natively available; replaced by prompt-level polling | **Medium** | Medium | Implement prompt-level re-entry: on each turn, scan run state and re-queue undone work | Manual re-entry via `/start-work --continue` flag | Verify that re-entry picks up unfinished tasks from previous turn | v0.6 | RESOLVED — prompt-level re-entry works; no hook needed |
| R-004 | Browser automation gap — Codex `browser:control-in-app-browser` has no WorkBuddy equivalent; Ultrawork Manual-QA workflow degraded | **High** | High | Downgrade to HTTP-level verification via `WebFetch` + screenshot fallback via `Read` on PNGs | Manual QA checklist replaces automated browser QA for visual criteria | Verify that `WebFetch`-based checks cover >80% of browser-shaped criteria | v0.7 | ACCEPTED — browser QA degraded to HTTP+manual; documented as known gap |
| R-005 | State file migration — Codex `.omo/` state files differ in schema; start-work migration may fail on first run with existing state | **Low** | Low | Detect old `.omo/` state; offer migration script; bump `schema_version` | Manual state reset: `rm -rf .omo/` and re-init | Check for `.omo/` presence in init-deep; warn if found | v0.7 | RESOLVED — migration path tested; schema_version bump applied |

## Summary

| Severity | Open | Resolved | Accepted | Total |
|----------|------|----------|----------|-------|
| Critical | 0 | 0 | 0 | 0 |
| High | 0 | 0 | [N] | [N] |
| Medium | [N] | [N] | [N] | [N] |
| Low | [N] | [N] | [N] | [N] |
| **Total** | **[N]** | **[N]** | **[N]** | **[N]** |
