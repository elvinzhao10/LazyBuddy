# LazyBuddy Plugin Changelog

> **Historical/non-operational record.** This dated change history is retained for context only. In a repository checkout, current guidance is in `README.md`, `AGENTS.md`, and `lazybuddy-plugin/README.md`; a copied package should use its local `README.md`.

## v1.2.1 — Compatibility and release verification (2026-08-30)

- Added a blocking cross-platform PR safety net and weekly Node compatibility
  coverage, including stabilized macOS Node 26 module behavior.
- Made efficiency evaluations standalone and corrected diagnostic and security
  fixtures while preserving their evidence and product-boundary checks.
- Advanced current package, runtime, release, and documentation authorities to
  v1.2.1 while retaining v1.2.0 history and migration semantics.

## v1.2.0 — Evidence-bound execution and release integrity (2026-08-28)

- Required fresh revision-bound completion evidence, atomic recoverable run
  state, task-owned leases, bounded cost telemetry, and deterministic
  risk-scaled verification.
- Bound CodeBuddy and WorkBuddy adapters/status to current executable,
  capability, build, and session fingerprints.
- Hardened Python preflight, network, MCP, filesystem, dirty-tree, and
  lifecycle ownership boundaries while preserving user-modified state.
- Updated current plugin, marketplace, tooling, MCP, lifecycle, candidate, and
  documentation authorities to v1.2.0; historical artifacts and independent
  contract versions remain unchanged.
- Added release-version classification, immutable-history checks, offline
  package installation, and synchronized paired-product parity gates.

## v1.1.0 — Native host readiness boundaries (2026-08-19)

This documentation-only release is the current human-facing status guide. It
does not change package manifests, publish a marketplace artifact, or claim a
live host loaded LazyBuddy. It names `codebuddy-cli`, `codebuddy-ide`, and
`workbuddy`; keeps marketplace as the default full-plugin route for CodeBuddy
IDE and WorkBuddy; and keeps Skills/manual MCP recovery-only and mutually
exclusive with the full-plugin route.

v2 status language distinguishes native modes `invoke-documented`,
`observe-only`, `descriptor-only`, and `unavailable`; public labels
`documented-tested`, `documented-untested`, `observed-build-specific`, and
`unavailable`; and `package`, `probe`, and `current-session` evidence scopes.
Package readiness does not prove a live host. Removal preserves credentials and
all non-LazyBuddy or host-managed entries.

W4.5 and W4.6 are historical v1.0.3 test labels, not current v1.1.0
host-readiness or publication evidence.

## v1.0.3 — Adaptive harness (2026-07-20)

The durable route requires **Node.js LTS 20 or newer** and **Git**, accepts only
`https://github.com/elvinzhao10/LazyBuddy.git`, and provides `onboard`,
`update`, `status`, and plan-first `offboard`. It owns only
`LazyBuddy/{active.json,launcher.js,releases/,receipts/,rollback/,staging/,locks/}`.
`node "<install-root>/LazyBuddy/launcher.js"` works after source deletion.
Same-version ref movement requires `--confirm-revision <full-sha>`; runtime
replacement uses scoped offboard/re-onboard. Package success leaves **HOST
READINESS: PENDING**. Historical WorkBuddy feedback is observed behavior, not
an endorsement of installation through private host state.

### Added

- Local-first onboarding guidance keeps package readiness separate from host
  readiness; host readiness remains **PENDING** until a fresh host session is
  observed.
- Adaptive harness contract (`adaptive-harness-contract.v1.json`) shared
  byte-identical across LazyTrae and LazyBuddy, with paired sha256 digest
  parity and no runtime coupling between repositories.
- Ten behavioral fixtures under `contracts/fixtures/v103/` covering direct,
  assisted, planned, orchestrated, long-horizon, provider-fallback,
  explicit-override, escalation-bound, and responsibility-ownership
  scenarios.
- Thin adaptive adapter for LazyBuddy (`lazybuddy_adaptive_detector.py`,
  `lazybuddy_adaptive_mapping.py`, `lazybuddy_adaptive_snapshot.py`,
  `lazybuddy_adaptive_explanation.py`, `lazybuddy_adaptive_hosts.py`) that
  extends the existing detector, policy, capability, and state seams without
  duplicating execution logic.
- Optional additive `adaptive` snapshot block in run/loop state
  (single-writer, backward-compatible); existing v1.0.2 state without the
  block continues to load.
- Deterministic seven-step decision policy: explicit override then compatible
  continuation then long-horizon then orchestrated then planned then
  assisted then direct, selecting the lowest sufficient mode.
- Bounded escalation: at most two automatic depth escalations per decision,
  after which a blocked-state record is produced.
- Authority-safe capability fallback with substitution reporting through
  existing status surfaces.
- Full-plugin CodeBuddy and WorkBuddy adaptive mappings; the Skills/MCP-only
  route remains an explicitly degraded fallback, not the product target.
- Adaptive explanation through existing status/capability surfaces (mode,
  selected stages, responsibilities, capabilities, not-selected, approval
  required).

### Changed

- Plugin manifests, marketplace metadata, tooling packages, hook/verifier
  banners, documentation clients, and public install guidance updated to
  v1.0.3.
- Existing status/capability surface extended with adaptive explanation when
  an `adaptive` block is present in state.

### Verified behavior

- Continuation resume: compatible snapshots resume the saved stage, mode, and
  escalation state. Incompatible request or revision snapshots reclassify from
  `understand` without mutating prior state. The W4.5 continuation suite passes.
- Evidence freshness: revision fingerprints are carried in adaptive snapshots;
  a changed fingerprint triggers stale reclassification and re-verification
  signalling. The existing `lazy-verifier` surface is reused without a
  parallel lineage store. The W4.6 evidence-freshness suite passes.
- Shared fixture parity: the LazyBuddy runtime matches all ten complete v1.0.3
  snapshots when fixture identity inputs (`decisionId`, `hostFingerprint`,
  `revisionFingerprint`, and `scopeFingerprint`) are supplied separately. The
  all-ten detector regression validates each full decision and snapshot.
- Combined W4.5/W4.6 verification passes 12/12 tests.

### Known Gap (host-only)

- Live-host QA: WorkBuddy and CodeBuddy live-host verification PENDING (no
  live host available in the release session). Package evidence and full
  fixture parity do not substitute for live-host evidence.

### Unchanged

- Authority boundaries: read-only and package-owned capabilities activate
  automatically; installations, persistence, host settings, credentials, and
  remote access require approval.
- Host-readiness boundaries: package evidence is not live-host evidence.
- No new MCP servers, remote providers, host settings, or production
  dependencies. The six existing MCP servers (run-ledger, verification,
  status-dashboard, context-graph, code-intel, docs) plus the lsp server keep
  their identities.
- No cross-repository runtime dependencies.
- No state-store replacement or memory migration.
- No dynamic command or hook registration.
- Explicit named workflows (`lazy-init-deep`, `lazy-ulw-plan`,
  `lazy-start-work`, `lazy-ulw-loop`, `lazy-review-work`) remain
  authoritative.


## v1.0.2 — Current-message onboarding intent (2026-07-18)

- Added the local-first onboarding hotfix: the copied package and local
  CodeBuddy marketplace metadata can be checked from a permanent folder
  without implying a live host installation.
- Made onboarding scan the complete current message and honor the rightmost
  conflicting explicit route while preserving compatible details.
- Routed the exact mixed InitDeep/WorkBuddy UI request to the later WorkBuddy
  UI intent without expanding host-setting or installation authority.
- Aligned active manifests, tooling packages, MCP identities, hook/verifier
  banners, documentation clients, and public install guidance with v1.0.2.
- Made the release-root local marketplace the documented CodeBuddy CLI route:
  add the absolute local root, install `lazybuddy@lazybuddy`, then start a fresh
  session as three separate actions. `--plugin-dir` remains development-only.
- Qualified CodeBuddy IDE and WorkBuddy plugin behavior as observed-build
  routes, retained Skills plus six manual MCP connectors as the supported
  fallback, and documented collision-free migration between the two.
- Clarified `.codebuddy/settings.json` versus ignored
  `.codebuddy/settings.local.json` scope and kept secrets out of committed
  configuration.

### Post-prerelease host-route correction (2026-07-19)

- Made the release-root CodeBuddy marketplace commands the preferred full-plugin
  route for CodeBuddy IDE whenever its CLI is available; the supplied IDE GUI
  Add local directory flow failed, so the UI path is now explicitly
  observed-build-only.
- Recorded the supplied WorkBuddy v5.2.6 macOS build's durable route: after
  explicit user approval, current host-schema inspection, and a validated
  additive merge plan preserving existing registry entries, prepare the cache
  with absolute MCP launchers and explicit project context, then perform one
  GUI **Skills → Plugins → lazybuddy → +** binding. If that schema/merge plan
  cannot be established, use the Skills plus six-MCP fallback. The GUI Install
  action hangs in an orphaned `plugin validate` and is no longer presented as
  an install step; hand-edited `known_marketplaces.json` is documented as
  non-durable.
- Kept Skills plus six manual MCP connectors as the fallback, with commands,
  agents, and hooks excluded unless a fresh host session proves them.

### Verification boundary

- Package checks establish local package readiness only; host readiness still
  requires a fresh CodeBuddy or WorkBuddy session, one real Skill/command, and
  observed state for all six MCP connections. Otherwise host readiness remains
  pending.

## v1.0.1 — Stable CI isolation (2026-07-17)

- Split deterministic package and publication validation from timing-sensitive
  subprocess and CodeGraph lifecycle regressions.
- Kept the deterministic `validate` job suitable for required branch
  protection while exposing lifecycle regressions as a separate advisory job.
- Pinned both CI jobs to macOS 15, gave lifecycle checks their own timeout
  budget, and retained the complete blocking suite for release publication.
- Added regression coverage that prevents lifecycle tests from leaking back
  into the deterministic gate or normal package checks from running twice.

## v1.0.0 — Stable public release (2026-07-17)

- Published the verified package and publication-gate separation as the stable
  LazyBuddy baseline.
- Preserved package-boundary, operational-guidance, security, MCP, receipt,
  marketplace, and legal protections as blocking checks.
- Aligned active plugin, runtime, hook, tooling, and documentation client
  identities with the v1.0.0 release.

## v0.19.0 — Package and publication gate separation (2026-07-17)

- Separated repository-root publication checks from installed package health so
  copied packages remain independent of parent learner documentation.
- Corrected Markdown validation to accept existing file or directory targets
  while continuing to reject empty, missing, and escaping local links.
- Retained package-boundary, operational-guidance, security, manifest, MCP, and
  immutable-marketplace protections as blocking package checks.

## v0.18.0 — Release identity alignment (2026-07-16)

- Aligned CodeBuddy and WorkBuddy manifests, marketplace metadata, MCP server
  metadata, hook/banner text, documentation User-Agent, and package-owned
  tooling metadata with the v0.18.0 release identity.
- Kept the `v017` capability-readiness records as historical fixtures and
  added a v0.18 fixture for the active release contract.
- Defined verifier timeout cleanup as best-effort process-group termination
  for trusted package-owned checks, with detectable-descendant reporting rather
  than a descendant-cleanup guarantee or security-sandbox claim.

## v0.17.0 — LazySeries tooling foundation (2026-07-12)

- Added the package-owned, local-first tooling foundation: host-or-owned
  `rg`/`sg`, repository-native verification, read-only TypeScript/JavaScript
  and Python LSP navigation, and explicitly enabled real CodeGraph.
- Added disabled-by-default Context7 and experimental `grep_app` registration
  fragments. They never alter host configuration or persist credentials.
- Kept all tooling lifecycle state receipt-owned, with safe uninstall and no
  LazyCodex/OmO operational dependency.

## v0.15.0-alpha.3 — Self-contained package cleanup (2026-07-12)

- Released package-only documentation contracts: copied plugin validation no
  longer depends on repository-root `docs/` or `dev/`.
- Updated manifest, marketplace, MCP server, hook, and verification metadata
  to `0.15.0-alpha.3`.

## v0.15.0-alpha.2 — Host Contract and Release Metadata Audit (2026-07-11)

- Clarified CodeBuddy plugin loading, WorkBuddy marketplace/session verification, and the verified local Skill-import/manual-MCP fallback.
- Corrected CodeBuddy command namespace examples to `/lazybuddy:lazy-<command>`.
- Updated manifest, marketplace, MCP server, and release metadata to `0.15.0-alpha.2`.

## v0.15.0-alpha.1 — Fresh Workspace Load Check (2026-07-11)

- Added an exact 14-skill, 14-command, 13-agent, 12-hook, and 6-MCP readiness check.
- Run the check during onboarding and from the host-executed SessionStart hook, so a newly opened repository reports partial plugin loading immediately.

## v0.12.0 — Release Hardening (2026-07-09)

- **Added** final release docs package: root README, quickstart, and final parity report.
- **Recorded** non-trivial v0.12 dogfood replay evidence under `.lazybuddy/runs/dogfood-v0.12/` and `.omo/evidence/task-5-diagnosis-v0-12-lazybuddy.txt`.
- **Verified** release gates in Todo 6: doctor 50/50, aggregate verify `all_pass:true`, MCP smoke 22/22, hook pipeline 16/16, docs check passing, and plugin metadata version `0.12.0`.
- **Documented** honest parity posture: context tooling is a WorkBuddy host substitution, not full LazyCodex codegraph/LSP/Context7 semantic parity.
- **Bumped** installable plugin metadata to `0.12.0`.

## v0.11.0 — Dogfood Run (2026-07-09)

- **Dogfood run completed** — full lifecycle (init-deep → ulw-plan → start-work → verify → review → finalize) on a real task
- **Fixed** stale plugin description in `.workbuddy/settings.json` (suggested enabling plugin when already enabled)
- **Created** `docs/lazybuddy-dogfood-run.md` — comprehensive dogfood report with UX problems, parity gaps, and suggested fixes
- **Discovered G-016** — plan checkbox / state.json task inconsistency (two representations can diverge)
- **Identified 5 v0.12 improvements** — plan sync script, CHANGELOG auto-update, verify auto-events, plan-task sync, finalize cross-check
- **4 events recorded** in events.jsonl: run_created → task_updated → verification_passed → run_completed
- All verification: doctor 47/47, smoke-test 105/105, verify.sh all_pass:true

## v0.10.0 — Migration Planner (2026-07-09)

- **Hardened** `migration-planner` Skill with the 9-step migration workflow + 11 disciplines
- **Created** `lazybuddy-migration-planner` agent
- **Created** 7 migration templates + 3 docs (migration-planner, self-adapter, migration-examples)
- Self-adapter cites 24 source paths and references all known gaps for honesty

## v0.9.0 — Hardening (2026-07-09)

- **Resolved** known gaps G-007 through G-015 (all marked fixed)
- **Hardened** `start-work`: worktree discipline, debugging runtime audit, full DoneClaim/AdversarialVerify JSON schema
- **Hardened** `ulw-loop`: 3-level iteration caps (5/goal, 3/failure, 500/100 total), dynamic steering (7 types), final quality gate, ATLAS delegation model
- **Hardened** `ultrawork`: subagent transition barriers, GREEN-step PR/branch refresh, atomic commits
- **Hardened** `verifier` + `reviewer` + `librarian` (protocols, dimensions, update triggers)
- **Created** `lazybuddy-context-miner` agent (G-015 fix)
- **Created** 4 verification check scripts + 4 protocol docs

## v0.8.0 — MCP Servers & Dashboard (2026-07-09)

- **Implemented** 5 MCP servers (30 tools): `run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`
- **Populated** `.mcp.json` with all 5 servers (bash command, `required: false`)
- **Created** 5 MCP prompt commands + dashboard mockup + 4 MCP docs
- Note: these servers are WorkBuddy-native (run state, parity, verification) — NOT LazyCodex's context servers (context7/codegraph/lsp/git_bash/grep_app). Context-tooling parity is a tracked gap (G-003, P2).

## v0.7.0 — State Ledger & Autonomous Loop (2026-07-09)

- **Created** `.lazybuddy/runs/<run_id>/` state tree (state.json, events.jsonl, checkpoints, evidence, verification, review, agent_outputs, artifacts, memory_updates)
- **Implemented** 10 state scripts + 5 loop scripts (create-run, load-run, update-task, append-event, checkpoint, recover-run, summarize-run, validate-state, list-runs, latest-run; next-task, run-cycle, classify-failure, create-repair-task, finalize-run)
- **Created** 5 docs (loop-protocol, checkpoint-format, runbook, state-schema, run-log-example)
- **Updated** 5 skills with State Ledger Integration sections
- End-to-end ledger test verified (create → plan/tasks → next-task → checkpoint → stop-gate blocks → finalize refuses → events populated)

## v0.6.0 — Hooks & Safety Gates (2026-07-09)

- **Implemented** 12 lifecycle hooks with real enforcement logic (3 enforcement + 9 advisory)
- Enforcement: `Stop` (stop-gate blocks premature completion), `SubagentStop` (evidence verification, max 3 retries), `PreToolUse` (denies secrets/destructive ops)
- Advisory: SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, PreCompact, StopFailure, TaskCreated, TaskCompleted, SubagentStart
- All 12 hook scripts executable; manual test plan passed

## v0.5.0 — Subagents & Orchestration (2026-07-09)

- **Created** 13 agent role definitions (8 LazyCodex-mapped + 5 WorkBuddy-native)
- Valid YAML frontmatter (model, effort, maxTurns, tools, disallowedTools, isolation) on all agents
- Read-only enforcement on verifier/reviewer/gate-reviewer/security-auditor; `disallowedTools:[Agent]` on implementer
- Created 4 orchestration docs (agent-inventory, agent-orchestration, handoff-protocol, parallelism-policy)

## v0.4.0 — Skills & Commands (2026-07-09)

- **Ported** 14 skills from LazyCodex with full WorkBuddy-native adaptation (init-deep, ulw-plan, start-work, ulw-loop, ultrawork, review-work, programming, remove-ai-slops, git-master, debugging, verifier, reviewer, librarian, migration-planner)
- **Wrote** 8 command files replacing v0.3 placeholders
- Tool translation applied across all files (multi_agent_v1 → Agent tool, .omo/ → .lazybuddy/, ${PLUGIN_ROOT} → ${CODEBUDDY_PLUGIN_ROOT}, AGENTS.md → workbuddy.md)

## v0.3.0 — Plugin Scaffold (2026-07-09)

- **Created** plugin structure: `.codebuddy-plugin/plugin.json`, component directories
- **Created** 8 placeholder commands + 8 placeholder skills (stubs for v0.4)
- **Created** hooks scaffold (`hooks/hooks.json`) — 12 event types (populated with real commands in v0.6)
- **Created** MCP scaffold (`.mcp.json`) — `mcpServers` populated with 5 servers in v0.8
- **Created** validation scripts: plugin-doctor, smoke-test, docs-check, parity-check
- _Note: at v0.3, components were placeholders. Real runtime behavior arrived in v0.4+._

---

_Versioning follows semantic versioning from v1.0.0 onward. Historical v0.x
entries remain as the pre-stable development record._
