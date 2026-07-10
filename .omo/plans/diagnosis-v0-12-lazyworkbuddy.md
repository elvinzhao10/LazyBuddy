# diagnosis-v0-12-lazyworkbuddy - Work Plan

## TL;DR (For humans)
**What you'll get:** Lazyworkbuddy v0.12 becomes a release-ready WorkBuddy-native LazyCodex replica package: one current status source, stronger doctor/verify gates, final docs/parity reports, honest MCP capability labels, and evidence from a non-trivial dogfood path.

**Why this approach:** The diagnosis shows the remaining weakness is not scaffold volume; it is proof, status drift, and productization honesty. The plan therefore hardens the existing shell/MCP/hook surfaces instead of inventing a new package layer.

**What it will NOT do:** It will not edit the LazyCodex reference repo, publish/tag anything, overwrite unrelated dirty worktree changes, or claim full parity for heuristic substitutes.

**Effort:** Large
**Risk:** Medium - broad documentation and validation script updates must stay honest and evidence-backed.
**Decisions to sanity-check:** Treat the LazyTrae diagnosis as comparative input; defer git tagging/publishing and new CLI packaging; use existing WorkBuddy plugin scripts as the release gate.

Your next move: execution is already approved by the `$start-work` request. Full execution detail follows below.

---

> TL;DR (machine): Large/medium-risk v0.12 release hardening: status, doctor/verify, docs/parity, MCP labels, dogfood evidence, metadata/memory.

## Scope
### Must have
- `docs/lazyworkbuddy-current-status.md` as the single current status source.
- v0.12 release docs required by `plan/v0.12-release.md`, including `README-LAZYworkbuddy.md`, `docs/lazyworkbuddy-quickstart.md`, and `docs/lazyworkbuddy-final-parity-report.md`.
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` checks all 12 hooks, all 8 MCP entries, state drift/evidence shape, and boundary-warning risks.
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` includes doctor, smoke, docs, parity, security, MCP smoke, and hook pipeline checks.
- Existing README/CHANGELOG/workbuddy/parity/gaps/command docs agree on v0.12, 8 MCP servers, and honest status labels.
- A dogfood or replay run with at least 3 tasks, one mandatory gate-blocking scenario, checkpoint/state sync evidence, and final verifier/review/debugging notes.
### Must NOT have (guardrails, anti-slop, scope boundaries)
- Must not edit `reference/lazycodex/`.
- Must not remove or normalize pre-existing dirty files: deleted `plan/v0.13-add-ons.md`, deleted `plan/v0.14-evaluation-rubric.md`, untracked `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md`, untracked `plan/v1.1-add-ons.md`.
- Must not tag, publish, push, or change external WorkBuddy plugin install locations.
- Must not say heuristic MCP/code-navigation equals LazyCodex codegraph/LSP parity.
- Must not add broad abstractions or a new package manager when existing shell/Python scripts suffice.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD where scripts can be exercised by broken fixture first; docs/status tasks use failing-first file/grep/doc-check proof; dogfood uses real script-surface proof.
- Evidence: `.omo/evidence/task-<N>-diagnosis-v0-12-lazyworkbuddy.txt` plus `.omo/start-work/ledger.jsonl` is authoritative for this Codex orchestration. Lazyworkbuddy runtime dogfood evidence must also live under `.lazyworkbuddy/runs/<run_id>/` and be cited from the `.omo` evidence transcript.
- Required final commands: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`, `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh`, `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh`, `bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh`, `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh`, `git status --short`.
- Every worker must capture `git status --short` before and after scoped edits and keep unrelated dirty files out of scope.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- Wave 1 already dispatched Todo 1, Todo 2, and Todo 4. Their write scopes overlapped in docs, so independent verification must inspect the combined diff before marking them complete.
- Wave 2 runs Todo 3 only after Todo 4 taxonomy is available, and it owns release docs plus plugin README/CHANGELOG integration.
- Wave 3 runs Todo 5 after Todo 2's state/verification behavior is known.
- Wave 4 runs Todo 6 after Todos 1-5 settle so metadata and memory summarize reality.

### File ownership and merge order
| Path group | Owner todo | Notes |
| --- | --- | --- |
| `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`, `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` | Todo 2 | Verification scripts only. |
| `docs/lazyworkbuddy-current-status.md`, `workbuddy.md`, `.workbuddy/memory/MEMORY.md` | Todo 1, then Todo 6 final status pass | Todo 6 may summarize final evidence after all gates. |
| `docs/lazyworkbuddy-mcp-and-tools.md`, `docs/lazyworkbuddy-known-gaps.md`, `docs/lazyworkbuddy-parity-ledger.md`, `docs/lazyworkbuddy-command-index.md` | Todo 4, then Todo 6 final status pass | Todo 3 may cite these but must not rewrite taxonomy rows. |
| `README-LAZYworkbuddy.md`, `docs/lazyworkbuddy-quickstart.md`, `docs/lazyworkbuddy-final-parity-report.md`, release doc updates, `lazyworkbuddy-plugin/README.md`, `lazyworkbuddy-plugin/CHANGELOG.md` | Todo 3, then Todo 6 final metadata pass | Todo 3 must update only stale v0.12/release/parity content in existing docs. |
| `.lazyworkbuddy/runs/dogfood-v0.12/`, `docs/lazyworkbuddy-dogfood-run.md` | Todo 5, then Todo 6 final status pass | Todo 5 must preserve durable runtime evidence. |
| `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json`, `.workbuddy/memory/2026-07-09.md` | Todo 6 | Metadata and memory only after evidence exists. |

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 status source | discovery | 6 | completed candidate; verify with 2, 4 |
| 2 doctor/verify gates | discovery | 5, final verification | 1, 3, 4 |
| 3 release docs package | 1, 4 | 6, final docs check | none |
| 4 MCP labels/parity taxonomy | discovery | 3, 6 | completed candidate; verify with 1, 2 |
| 5 dogfood/replay evidence | 2 | 6, final verification | none if it touches run state |
| 6 release metadata/memory | 1, 3, 4, 5 | final verification | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Create current-status source and reconcile obvious status drift
  What to do / Must NOT do: Create `docs/lazyworkbuddy-current-status.md`; update `lazyworkbuddy-plugin/README.md`, `workbuddy.md`, `.workbuddy/memory/MEMORY.md`, `docs/lazyworkbuddy-parity-ledger.md`, and `docs/lazyworkbuddy-command-index.md` to point to it and agree on v0.12 scope, 8 MCP servers, dogfood status, and status labels. Do not touch unrelated deleted/untracked plan files.
  Parallelization: Wave 1 | Blocked by: discovery | Blocks: 6
  References (executor has NO interview context - be exhaustive): `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:55-78`; `workbuddy.md:14`; `lazyworkbuddy-plugin/README.md:13-34`; `lazyworkbuddy-plugin/.mcp.json`; `docs/lazyworkbuddy-parity-ledger.md:95`; `docs/lazyworkbuddy-known-gaps.md:37-47`.
  Acceptance criteria (agent-executable): `rg -n "Status:|0\\.10\\.0|5 MCP|8 MCP|Currently at" docs/lazyworkbuddy-current-status.md lazyworkbuddy-plugin/README.md workbuddy.md docs/lazyworkbuddy-parity-ledger.md docs/lazyworkbuddy-command-index.md .workbuddy/memory/MEMORY.md` shows no contradictory current-state claim; `test -f docs/lazyworkbuddy-current-status.md`.
  QA scenarios (name the exact tool + invocation): failure: `test -f docs/lazyworkbuddy-current-status.md` must fail before creation; happy: `python3 -c 'from pathlib import Path; p=Path("docs/lazyworkbuddy-current-status.md").read_text(); assert "v0.12" in p and "8 MCP" in p and "implemented-unverified" in p and "heuristic-substitute" in p'` exits 0, and `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh` exits 0. Transcript: `.omo/evidence/task-1-diagnosis-v0-12-lazyworkbuddy.txt`.
  Commit: N | docs(status): add v0.12 current status source

- [x] 2. Harden doctor and aggregate verify as release gates
  What to do / Must NOT do: Update `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` and `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` so doctor checks all 12 hook command targets are present/executable, `.mcp.json` declares 8 servers with existing server scripts, run state has no plan/state drift or missing evidence for completed tasks, and boundary warnings fail active/completed run checks. Add MCP and hook pipeline scripts to aggregate verify. Keep POSIX shell + python3 style; no package manager.
  Parallelization: Wave 1 | Blocked by: discovery | Blocks: 5, final verification
  References (executor has NO interview context - be exhaustive): `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh:43-118`; `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh:30-42`; `lazyworkbuddy-plugin/hooks/hooks.json`; `lazyworkbuddy-plugin/.mcp.json`; `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:81-108`; `docs/lazyworkbuddy-known-gaps.md:165-183`; `lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh`.
  Acceptance criteria (agent-executable): `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` exits 0 on current repo; `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` exits 0 and JSON includes doctor/smoke/docs/parity/security/mcp/hook statuses; a temporary broken-copy fixture for one hook path or MCP server must make the checker fail without modifying real config.
  QA scenarios (name the exact tool + invocation): failure: copy `hooks/hooks.json` to a mktemp dir, replace one `scripts/hooks/*.sh` command with a missing path, run doctor with `CODEBUDDY_PLUGIN_ROOT=<fixture>` and expect non-zero + missing hook text; happy: run `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` and save stdout/stderr to `.omo/evidence/task-2-diagnosis-v0-12-lazyworkbuddy.txt`; cleanup: remove fixture temp dir and verify it no longer exists.
  Commit: N | fix(verify): make v0.12 doctor enforce real gates

- [x] 3. Produce final release docs and parity package
  What to do / Must NOT do: Create/update `README-LAZYworkbuddy.md`, `docs/lazyworkbuddy-quickstart.md`, `docs/lazyworkbuddy-final-parity-report.md`, `docs/lazyworkbuddy-agent-orchestration.md`, `docs/lazyworkbuddy-loop-protocol.md`, `docs/lazyworkbuddy-verification-matrix.md`, `docs/lazyworkbuddy-quality-gates.md`, `docs/lazyworkbuddy-dogfood-run.md`, `docs/lazyworkbuddy-security-and-permissions-plan.md`, `docs/lazyworkbuddy-plugin-design.md`, `docs/lazyworkbuddy-mcp-and-tools.md`, `lazyworkbuddy-plugin/README.md`, and `lazyworkbuddy-plugin/CHANGELOG.md` as needed for v0.12. Existing docs should be updated, not duplicated, where they already exist. Update only stale v0.12/release/parity content; do not rewrite taxonomy rows owned by Todo 4 unless correcting a verified inconsistency.
  Parallelization: Wave 2 | Blocked by: 1, 4 | Blocks: 6
  References (executor has NO interview context - be exhaustive): `plan/v0.12-release.md:9-45`; `docs/lazyworkbuddy-versioned-execution-plan.md:586-635`; `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:222-289`; `docs/lazyworkbuddy-parity-ledger.md`; `docs/lazyworkbuddy-known-gaps.md`; `reference/lazycodex/plugins/omo/skills/start-work/SKILL.md`; `reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md`.
  Acceptance criteria (agent-executable): every required artifact path from `plan/v0.12-release.md` exists; `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh` exits 0; final parity report table includes original LazyCodex method, source path, Lazyworkbuddy equivalent, surface, status, evidence, verification, caveat, and whether original runtime is required.
  QA scenarios (name the exact tool + invocation): failure: before edits, `test -f README-LAZYworkbuddy.md && test -f docs/lazyworkbuddy-final-parity-report.md` should fail; happy: `python3 -c 'from pathlib import Path; required=["README-LAZYworkbuddy.md","docs/lazyworkbuddy-quickstart.md","docs/lazyworkbuddy-final-parity-report.md","docs/lazyworkbuddy-command-index.md","docs/lazyworkbuddy-agent-orchestration.md","docs/lazyworkbuddy-loop-protocol.md","docs/lazyworkbuddy-verification-matrix.md","docs/lazyworkbuddy-quality-gates.md","docs/lazyworkbuddy-known-gaps.md","docs/lazyworkbuddy-dogfood-run.md","docs/lazyworkbuddy-security-and-permissions-plan.md","docs/lazyworkbuddy-plugin-design.md","docs/lazyworkbuddy-mcp-and-tools.md","lazyworkbuddy-plugin/README.md","lazyworkbuddy-plugin/CHANGELOG.md"]; missing=[p for p in required if not Path(p).is_file()]; assert not missing, missing; report=Path("docs/lazyworkbuddy-final-parity-report.md").read_text(); required_cols=["Original LazyCodex method","Original source path","Lazyworkbuddy equivalent","Evidence artifact","Verification method","Known caveats"]; absent=[c for c in required_cols if c not in report]; assert not absent, absent'` exits 0 and transcript is saved to `.omo/evidence/task-3-diagnosis-v0-12-lazyworkbuddy.txt`.
  Commit: N | docs(release): produce v0.12 release package

- [x] 4. Label MCP capabilities and parity taxonomy honestly
  What to do / Must NOT do: Update `docs/lazyworkbuddy-mcp-and-tools.md`, `docs/lazyworkbuddy-known-gaps.md`, `docs/lazyworkbuddy-parity-ledger.md`, and `docs/lazyworkbuddy-command-index.md` so each MCP/tool is labeled `semantic`, `project-tool-backed`, `heuristic`, or `state-only`; separate `reference parity`, `host substitution`, and `native enhancement`; every `runtime-verified` claim has an evidence path or command.
  Parallelization: Wave 1 | Blocked by: discovery | Blocks: 3, 6
  References (executor has NO interview context - be exhaustive): `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:191-253`; `lazyworkbuddy-plugin/.mcp.json`; `lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh`; `docs/lazyworkbuddy-known-gaps.md:37-47`; `docs/lazyworkbuddy-parity-ledger.md:225-235`.
  Acceptance criteria (agent-executable): `python3 -c 'import json,re; from pathlib import Path; servers=json.load(open("lazyworkbuddy-plugin/.mcp.json"))["mcpServers"]; docs="\\n".join(Path(p).read_text() for p in ["docs/lazyworkbuddy-mcp-and-tools.md","docs/lazyworkbuddy-command-index.md"]); missing=[s for s in servers if s not in docs]; assert not missing, missing; assert "heuristic-substitute" in docs and "state-only" in docs and "project-tool-backed" in docs'` exits 0; no line implies context-graph/code-intel are full LazyCodex codegraph/LSP parity.
  QA scenarios (name the exact tool + invocation): failure: `rg -n "heuristic|state-only" docs/lazyworkbuddy-mcp-and-tools.md` must identify missing/insufficient labels before update; happy: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` exits 0 and transcript saved to `.omo/evidence/task-4-diagnosis-v0-12-lazyworkbuddy.txt`.
  Commit: N | docs(parity): label MCP capability honesty

- [x] 5. Create non-trivial dogfood/replay evidence
  What to do / Must NOT do: Use existing `.lazyworkbuddy` state/loop/hook scripts to create or refresh a v0.12 dogfood/replay run with at least 3 tasks, a checkpoint, a deliberately blocked/failing verification or missing-evidence scenario, a repair/resolution event, and final completion evidence. Update `docs/lazyworkbuddy-dogfood-run.md` with exact commands and artifacts. Do not fake evidence; if a gate cannot be exercised, document it as `implemented-unverified` with a next command.
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 6, final verification
  References (executor has NO interview context - be exhaustive): `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:110-134`; `docs/lazyworkbuddy-dogfood-run.md`; `lazyworkbuddy-plugin/scripts/state/create-run.sh`; `lazyworkbuddy-plugin/scripts/state/update-plan-checkbox.sh`; `lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh`; `lazyworkbuddy-plugin/scripts/loop/finalize-run.sh`; `lazyworkbuddy-plugin/scripts/hooks/subagent-stop.sh`; `lazyworkbuddy-plugin/scripts/hooks/stop-gate.sh`.
  Acceptance criteria (agent-executable): use run id `dogfood-v0.12`; dogfood doc lists at least 3 named tasks, 1 checkpoint, 1 blocked/failure/repair cycle, and exact evidence paths; `bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12 --fix` followed by dry-run output contains `NO DRIFT` or equivalent no-change result; stop gate blocks before all plan checkboxes are complete and allows after completion.
  QA scenarios (name the exact tool + invocation): failure: run a missing-evidence `subagent-stop.sh` fixture and expect exit 0 plus JSON `{"continue": false}`; happy: run the documented dogfood/replay commands and save transcript to `.omo/evidence/task-5-diagnosis-v0-12-lazyworkbuddy.txt`; cleanup: remove QA temp dirs and any retry-state files created under `.lazyworkbuddy/executor-verify-state/` for fixture-only session ids, but keep durable `.lazyworkbuddy/runs/dogfood-v0.12` evidence.
  Commit: N | test(dogfood): record v0.12 harness replay evidence

- [x] 6. Finalize v0.12 metadata, memory, and release status
  What to do / Must NOT do: After Todos 1-5 pass, bump `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` to `0.12.0`, update `lazyworkbuddy-plugin/CHANGELOG.md`, `lazyworkbuddy-plugin/README.md`, `workbuddy.md`, `.workbuddy/memory/2026-07-09.md`, `.workbuddy/memory/MEMORY.md`, `docs/lazyworkbuddy-known-gaps.md`, and `docs/lazyworkbuddy-parity-ledger.md` so final status matches evidence. Do not claim any gate passed unless the transcript exists.
  Parallelization: Wave 3 | Blocked by: 1, 3, 4, 5 | Blocks: final verification
  References (executor has NO interview context - be exhaustive): `workbuddy.md:14`; `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json:3`; `lazyworkbuddy-plugin/CHANGELOG.md`; `.workbuddy/rules/lazyworkbuddy-memory.md`; `docs/lazyworkbuddy-run-log-template.md`; `.omo/evidence/task-1..5-diagnosis-v0-12-lazyworkbuddy.txt`.
  Acceptance criteria (agent-executable): `python3 -c 'import json; assert json.load(open("lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json"))["version"]=="0.12.0"'` exits 0; `rg -n "v0\\.12|0\\.12\\.0|diagnosis-v0-12" workbuddy.md lazyworkbuddy-plugin/README.md lazyworkbuddy-plugin/CHANGELOG.md .workbuddy/memory/MEMORY.md docs/lazyworkbuddy-current-status.md` returns current status; `git diff --check` exits 0.
  QA scenarios (name the exact tool + invocation): failure: before bump, `python3 -c 'import json; assert json.load(open("lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json"))["version"]=="0.12.0"'` fails; happy: same command exits 0 after metadata update and transcript saved to `.omo/evidence/task-6-diagnosis-v0-12-lazyworkbuddy.txt`.
  Commit: N | chore(release): mark v0.12 evidence-backed release

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit — lazycodex-gate-reviewer checks every top-level todo is `[x]`, every evidence file exists, and every plan acceptance command appears in `.omo/start-work/ledger.jsonl`; evidence `.omo/evidence/f1-plan-compliance-diagnosis-v0-12-lazyworkbuddy.txt`.
- [x] F2. Code quality review — lazycodex-code-reviewer audits final diff for scope, shell safety, doc honesty, and no reference edits; evidence `.omo/evidence/f2-code-quality-diagnosis-v0-12-lazyworkbuddy.txt`.
- [x] F3. Real manual QA — lazycodex-qa-executor runs `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh`, `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`, `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh`, and `bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh`; all exit 0; evidence `.omo/evidence/f3-manual-qa-diagnosis-v0-12-lazyworkbuddy.txt`.
- [x] F4. Scope fidelity — lazycodex-gate-reviewer verifies no edits under `reference/lazycodex/`, no publish/tag/push, no unrelated dirty worktree changes reverted, and required v0.12 artifacts exist; evidence `.omo/evidence/f4-scope-fidelity-diagnosis-v0-12-lazyworkbuddy.txt`.

## Commit strategy
- Do not commit unless the user explicitly asks.
- Keep changes grouped in the working tree by release-hardening concern.
- If a future commit is requested, use one conventional commit after final verification: `release(v0.12): finalize lazyworkbuddy evidence-backed package`.

## Success criteria
- Final package is usable by a developer in WorkBuddy without reading `reference/lazycodex/`.
- Major LazyCodex workflows have WorkBuddy-native equivalents with source-backed caveats.
- `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` exits 0 and includes MCP/hook gates.
- Required v0.12 docs exist and docs-check passes.
- Known gaps are honest: no unverified runtime parity claim lacks evidence.
- Final answer reports build status, implemented work, unique WorkBuddy adaptation, incomplete work, how to use, exact verification, and 0-5 score estimates.
