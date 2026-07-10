---
slug: diagnosis-v0-12-lazyworkbuddy
status: drafting
intent: clear
pending-action: write .omo/plans/diagnosis-v0-12-lazyworkbuddy.md
approach: Diagnosis-backed v0.12 release hardening: reconcile current status, harden doctor/verify gates, produce final release docs/parity package, label MCP capabilities honestly, run a non-trivial dogfood/evidence path, then update memory.
---

# Draft: diagnosis-v0-12-lazyworkbuddy

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
W0 | Single current status source and stale-version cleanup | active | .omo/evidence/task-1-diagnosis-v0-12-lazyworkbuddy.txt
W1 | Doctor/verify become operational gates for hooks, MCP, state, evidence, and boundary warnings | active | .omo/evidence/task-2-diagnosis-v0-12-lazyworkbuddy.txt
W2 | Final release docs/parity package exists and links cleanly | active | .omo/evidence/task-3-diagnosis-v0-12-lazyworkbuddy.txt
W3 | MCP capability taxonomy and parity/gap honesty are explicit | active | .omo/evidence/task-4-diagnosis-v0-12-lazyworkbuddy.txt
W4 | Non-trivial dogfood/replay evidence proves a real harness path | active | .omo/evidence/task-5-diagnosis-v0-12-lazyworkbuddy.txt
W5 | Release metadata, changelog, and project memory agree on v0.12 | active | .omo/evidence/task-6-diagnosis-v0-12-lazyworkbuddy.txt

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
No git tag this turn | Do not tag or publish | `plan/v0.12-release.md` mentions tagging, but destructive/external release lifecycle requires explicit confirmation and dirty worktree exists | yes
No new package-manager CLI | Keep installer/productization as docs/development install unless a simple script already exists | Diagnosis W4 is larger than final release hardening; adding a new CLI package would expand architecture and packaging surface | yes
No nested AGENTS.md generation | Preserve root `AGENTS.md` compat alias and use WorkBuddy memory/docs for v0.12 | `workbuddy.md` is primary memory; init-deep discovery found nested plugin guidance useful later but not required now | yes
Reference repo remains read-only | Only cite `reference/lazycodex/`; never edit it | project rule and safety docs mark reference as canonical/read-only | no

## Findings (cited - path:lines)
- `workbuddy.md:14` says current phase is v0.11, while v0.12 release must update status.
- `plan/v0.12-release.md:9-24` lists required final artifacts including README, quickstart, final parity report, command index, agent orchestration, loop protocol, verification matrix, quality gates, known gaps, dogfood, security, plugin design, MCP/tools, plugin README, and changelog.
- `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md:55-278` maps diagnosis-backed v0.12 workstreams W0-W7: status source, doctor gate, dogfood, boundary enforcement, installer/product surface, MCP labels, loop parity, parity taxonomy.
- `lazyworkbuddy-plugin/README.md:13` still says v0.10.0; `lazyworkbuddy-plugin/README.md:34` says 5 MCP while `.mcp.json` declares 8 servers.
- `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json:3` is 0.10.0 and must become 0.12.0 only after release docs/gates are true.
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh:30-42` runs doctor/smoke/docs/parity/security but not MCP/hook pipeline checks.
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh:43-118` mostly checks structure/placeholders, not all 12 hook command executability, all 8 MCP servers, run evidence, state drift, or boundary warnings.
- LSP status: no active clients and Python/JS/Bash servers missing, so codegraph/direct script reads are the verified source map for this run.
- Dirty worktree before edits: deleted `plan/v0.13-add-ons.md`, deleted `plan/v0.14-evaluation-rubric.md`, untracked `docs/lazyworkbuddy-diagnosis-evaluation-vs-lazycodex-lazytrae.md`, untracked `plan/v1.1-add-ons.md`; do not overwrite or normalize these unless task scope demands it.

## Decisions (with rationale)
- Treat the external LazyTrae diagnosis file as a comparative input, not an instruction to copy LazyTrae architecture. Adapt its workstreams to Lazyworkbuddy's WorkBuddy-native surfaces.
- Prefer shell/Python validation scripts already present over adding a new package manager.
- Version status must use `v0.N` and plugin semver `0.12.0`; do not introduce `v1.1`.
- Runtime-verified claims require command output/evidence paths; otherwise use `implemented-unverified`, `heuristic-substitute`, `platform-gap`, or `native-enhancement`.

## Scope IN
- Create/update release docs required by `plan/v0.12-release.md`.
- Create `docs/lazyworkbuddy-current-status.md`.
- Harden doctor/verify/MCP/hook validation scripts.
- Update plugin README, CHANGELOG, manifest version, status, parity ledger, known gaps, command index, and project memory.
- Produce or refresh dogfood evidence for a non-trivial run path using existing state/loop/hook scripts.
- Record `.omo/start-work/ledger.jsonl` evidence and `.omo/evidence/*` transcripts.

## Scope OUT (Must NOT have)
- Do not edit `reference/lazycodex/`.
- Do not delete, rename, or revert pre-existing dirty worktree changes.
- Do not create git tags, publish packages, push branches, or modify external plugin installation directories.
- Do not claim full semantic parity for heuristic substitutes.
- Do not add a new CLI package unless a worker proves it is already scaffolded and can be completed without expanding scope.

## Open questions
None blocking. Original `$start-work` request counts as approval to generate and execute this plan.

## Approval gate
status: approved-by-start-work-bootstrap
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
