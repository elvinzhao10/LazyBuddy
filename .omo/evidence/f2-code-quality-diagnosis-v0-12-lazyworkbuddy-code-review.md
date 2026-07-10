# F2 Code Quality Review - diagnosis-v0-12-lazyworkbuddy

Date: 2026-07-09
Scope: `/Users/Admin/Desktop/lazyworkbuddy`
Verdict: FAIL
Recommendation: REQUEST_CHANGES
Code quality status: BLOCK

## Skill-Perspective Check

- `remove-ai-slops` skill perspective: loaded from `/Users/Admin/.codex/plugins/cache/sisyphuslabs/omo/4.16.1/skills/remove-ai-slops/SKILL.md`.
- `programming` skill perspective: loaded from `/Users/Admin/.codex/plugins/cache/sisyphuslabs/omo/4.16.1/skills/programming/SKILL.md`.
- Result: the shell/Python release gates are currently runnable, but the release docs violate both perspectives by preserving stale, contradictory status/version claims. This is misleading success output and maintenance slop. No deletion-only or tautological tests were found in the changed release gates.

## Checks Run

- `git status --short --untracked-files=all`
- `git diff --stat`
- `git diff --name-status`
- `bash -n lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`
- `bash -n lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh`
- `bash -n lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh`
- `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` -> PASS, 50/50
- `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh` -> PASS, 100 links, 0 broken
- `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` -> PASS, 22/22
- `bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh` -> PASS, 16/16
- `CWD=/private/tmp bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh` -> PASS, `all_pass:true`
- Isolated doctor boundary fixture in `/private/tmp/lwb-review-doctor-boundary` confirmed completed-task evidence outside the project root is rejected.

## CRITICAL

None.

## HIGH

1. Release-status docs contradict the canonical current status.
   - `docs/lazyworkbuddy-current-status.md:11` says the package is runtime-verified for v0.12 local release gates.
   - `README-LAZYworkbuddy.md:10`, `docs/lazyworkbuddy-quickstart.md:34`, and `docs/lazyworkbuddy-final-parity-report.md:7` still say package-wide status is `implemented-unverified` until transcripts are recorded.
   - `docs/lazyworkbuddy-final-parity-report.md:13-24` labels every major workflow `implemented-unverified`, and `docs/lazyworkbuddy-final-parity-report.md:45` still warns not to claim package-wide runtime verification until evidence exists.
   - The referenced evidence files do exist and the gates pass locally, so the current docs are internally inconsistent. A user cannot tell whether v0.12 is accepted, pending, or partially verified.

2. The plugin design document still embeds stale release metadata.
   - `docs/lazyworkbuddy-plugin-design.md:103-156` shows a manifest example with `"version": "0.10.0"`.
   - `docs/lazyworkbuddy-plugin-design.md:160-164` says `0.10.0` is current and `0.12.0` is only a target.
   - The actual manifest is `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json:3` with `0.12.0`. This is a release doc and should not ship with stale install/package metadata.

## MEDIUM

1. Project memory has duplicated and conflicting add-on/version guidance.
   - `.workbuddy/memory/MEMORY.md:9` says phases are `v0.x` and never `v1/v2/v3`.
   - `.workbuddy/memory/MEMORY.md:13-14` duplicates "Add-ons deferred to v1 (post-1.0)".
   - This conflicts with the project convention and the known-gaps doc still pointing channels to a `v0.13` optional add-on. It should be reconciled to one future-version story.

2. Pre-existing plan-file drift is still present in the worktree and must not be swept into the v0.12 change.
   - Current status includes deleted `plan/v0.13-add-ons.md`, deleted `plan/v0.14-evaluation-rubric.md`, and untracked `plan/v1.1-add-ons.md`.
   - `.omo/plans/diagnosis-v0-12-lazyworkbuddy.md:28-31` explicitly says these were pre-existing dirty/untracked/deleted files and must not be removed or normalized by v0.12 work.
   - Treat this as a commit-scope hazard, not a v0.12-authored blocker, unless the final commit would include those paths.

## LOW

1. `shellcheck` was unavailable in the environment, so shell static analysis could not be run. `bash -n` and runtime smoke gates passed.

## Blocking Issues

- Fix the release-status contradiction across `README-LAZYworkbuddy.md`, `docs/lazyworkbuddy-quickstart.md`, and `docs/lazyworkbuddy-final-parity-report.md` so they agree with `docs/lazyworkbuddy-current-status.md` and the actual evidence posture.
- Update `docs/lazyworkbuddy-plugin-design.md` to show the real `0.12.0` manifest state, or explicitly mark older examples as historical.
- Reconcile `.workbuddy/memory/MEMORY.md` future-version guidance and remove the duplicate `v1` add-on line.

## Final Status

REQUEST_CHANGES. The runtime gates are green, but the release package is not honest enough to approve because current user-facing docs disagree about the package status and plugin version.
