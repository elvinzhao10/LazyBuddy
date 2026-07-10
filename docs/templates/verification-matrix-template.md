# Verification Matrix Template

Every adapted or ported method must have a runnable verification gate. This matrix is the "test suite" for a migration. A downstream worker must be able to execute each row and get PASS/FAIL.

## Verification Matrix

| # | Workflow | Command | Expected Result | Evidence Artifact | Status |
|---|---------|---------|----------------|------------------|--------|
| 1 | [WORKFLOW_NAME] | `[VERIFICATION_COMMAND]` | [EXPECTED_OUTPUT_DESCRIPTION] | [EVIDENCE_PATH_OR_TYPE] | [PASS / FAIL / PENDING] |
| 2 | [WORKFLOW_NAME] | `[VERIFICATION_COMMAND]` | [EXPECTED_OUTPUT_DESCRIPTION] | [EVIDENCE_PATH_OR_TYPE] | [PASS / FAIL / PENDING] |

## Row Field Descriptions

- **Workflow** — what user scenario or system behavior is being verified (e.g., "Plugin doctor", "Deep init", "Start-work Phase 2")
- **Command** — the exact shell command or tool invocation that checks the behavior
- **Expected Result** — what output/side effect/state change proves the behavior works
- **Evidence Artifact** — where to find the proof (stdout log, file path, parity ledger entry)
- **Status** — [PASS / FAIL / PENDING] updated after each verification run

## Example — LazyBuddy v0.10 Verification

| # | Workflow | Command | Expected Result | Evidence Artifact | Status |
|---|---------|---------|----------------|------------------|--------|
| 1 | Plugin doctor | `bash scripts/lazybuddy-plugin-doctor.sh` | `47/47 PASS` | stdout result | PASS |
| 2 | Manifest integrity | `bash scripts/lazybuddy-plugin-doctor.sh --check manifest` | Manifest.json valid, all schema fields present | stdout result | PASS |
| 3 | Skill loading | `bash scripts/lazybuddy-plugin-doctor.sh --check skills` | All 20 SKILL.md files have valid YAML frontmatter | stdout result | PASS |
| 4 | Agent definitions | `bash scripts/lazybuddy-plugin-doctor.sh --check agents` | All 15 agent files pass TOML/MD validation | stdout result | PASS |
| 5 | Hook registration | `bash scripts/lazybuddy-plugin-doctor.sh --check hooks` | 8 hooks registered with valid event types and scripts | stdout result | PASS |
| 6 | Deep init — CLAUDE.md | `/lazy-init-deep` → Phase 1 | `.lazybuddy/CLAUDE.md` created at project root | file: `.lazybuddy/CLAUDE.md` | PASS |
| 7 | Deep init — todo tree | `/lazy-init-deep` → Phase 2 | `todo.md` populated from file tree scan | file: `.lazybuddy/todo.md` | PASS |
| 8 | Deep init — plugin clone | `/lazy-init-deep` → Phase 3 | `lazybuddy-plugin/` directory cloned | dir: `lazybuddy-plugin/` | PASS |
| 9 | Start-work — boulder load | `/lazy-start-work "migrate skill X"` → Phase 2 | `.lazybuddy/runs/<run_id>/state.json` created with status "planning" | file: `.lazybuddy/runs/<run_id>/state.json` | PASS |
| 10 | Start-work — agent spawn | `/lazy-start-work` → Phase 3 | 5 subagent tasks dispatched; all return within timeout | TaskOutput for each agent task | PASS |
| 11 | Parity ledger append | Any `init-deep` or migration event | `.lazybuddy/parity-ledger.jsonl` contains new event entry | file: `.lazybuddy/parity-ledger.jsonl` | PASS |
| 12 | Dogfood — init-deep self | `init-deep` on lazybuddy repo | Same repo self-initializes; no circular errors | stdout + parity ledger | PENDING |

## Run Summary

```
[PASS_COUNT]/[TOTAL] PASS | [FAIL_COUNT] FAIL | [PENDING_COUNT] PENDING
Verification pass rate: [PASS_RATE]%
Blocking failures: [LIST_FAILING_GATES]
```
