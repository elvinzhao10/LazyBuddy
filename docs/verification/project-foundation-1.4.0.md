# Project foundation checkpoint for LazySeries 1.4.0

**Date:** 5 October 2026. **Scope:** first project-record implementation in LazyBuddy.
**Starting commit:** `b4c38b5d4fbee28449001b7fc1e0ac1639393150`.
**Local branch:** `codex/project-foundation-1.4.0`.

This checkpoint implements the persistent record beneath the proposed project
dashboard: one repository root, one selected native runtime, and multiple
plans sharing durable project items. It is a contributor entry point and a
reviewed data/persistence slice. It does not claim the redesigned dashboard or
the six-product release is complete.

## Implemented behavior

The new [project module](../../lazybuddy-plugin/shared/project/README.md)
defines source-backed features, principles, requirements, decisions and plan
records. The native CLI initializes this record before any execution run
exists. Registering an original Markdown document captures its content hash;
recording an item extracts its title and text from the complete document or a
unique heading outside fenced code. A command cannot substitute arbitrary
title/text while claiming that original source.

Plans reference stable item IDs and the item revisions they considered. A
source edit is first an observation. Explicitly refreshing the registered
source and affected item accepts the new text; only changed item content or
metadata advances its revision. Older plan references then become stale while
their historical declared lifecycle remains intact. Matching references alone
does not assess semantic compatibility: `alignment` remains `unassessed`.

The native store serializes concurrent writers and publishes current state
with its command receipt as one atomic file. Stale project revisions return a
conflict. Replaying an identical command returns its original receipt without
adding a revision or rewriting state, even if the source has since moved or
disappeared. Command ID reuse with different content rejects.

Existing native runtime state is a separate authority. A project plan can link
an inspected native project/run identity, including a different legacy native
project ID. The link creates no run, changes no native proof, and claims no
execution observation, revision consumption or verifier result.

## Acceptance evidence

The independent combined gate passed **100 tests, with no failures or skips**:
40 pure project-model cases, 10 real-process Buddy CLI cases, and 50 existing
dashboard projection/proof-boundary cases. All six implementation files and
three project test files had identical hashes before and after that gate.
The recorded environment was Node `v24.19.0`, Python `3.12.14`, Linux x86_64.
This does not establish an exercised native host or compatibility on an
untested operating system/runtime version.

| Behavioral check | Observed outcome |
| --- | --- |
| Read before initialization | Original documents remained unchanged and no native project directory was created. |
| Project creation and reload | Revision 0 without a run; repeated `init` and `read` did not rewrite state. |
| Continuity across plans and a new process | Three plans became four while one feature and one principle kept their IDs; six original Markdown files were unchanged. |
| Competing commands | Exactly one saved and one conflicted; one revision and one receipt were stored. |
| Replay after moving the source | Original receipt returned; state hash and inode stayed identical; the missing source was still reported missing. |
| Requirement amendment | Requirement revision changed 1→2; feature/principle stayed at 1; older references became stale and historical completion remained declared complete. |
| Unknown directory and native state | Caller files, existing native run/queue/service files and settings sentinels were preserved. |
| Corrupted command digest | Both read and write rejected `INVALID_HISTORY` without changing the corrupted file. |
| Duplicate JSON keys | The public CLI rejected top-level and nested duplicates as `INVALID_JSON`; no revision or receipt was added. |

An additional independent store gate passed **24/24 cases**, with no failures
or skips, against unchanged implementation and QA source hashes. It exercises unsafe paths, hard links,
symlink ancestors, actual concurrent processes, interrupted publication,
external edits, native identity links and bootstrap refusal. Its fault hooks
are test-only Python instrumentation scoped to disposable fixture roots;
there is no production fault-injection option.

A separate real queue-activation check created a native run through the old
queue CLI, then registered and linked it through the new project CLI. **All
nine native run files and three queue files remained byte-identical.** The
project ID stayed `project:durable` while the native identity stayed
`project:b2` / `run-one`. This checks identity preservation, not host dispatch
or verification.

### Evidence files and reproduction

- [Combined gate manifest and exact source hashes](project-foundation-1.4.0/combined-gate.json)
- [Combined gate output](project-foundation-1.4.0/combined-gate.txt)
- [Store gate manifest](project-foundation-1.4.0/store-gate.json)
- [Store gate output](project-foundation-1.4.0/store-gate.txt)
- [Final adversarial test-file check](project-foundation-1.4.0/adversarial-final-gate.json)
- [Final adversarial test output](project-foundation-1.4.0/adversarial-final-gate.txt)
- [Comparison of the existing dashboard and vendor files](project-foundation-1.4.0/protected-dashboard-comparison.json)
- [Native identity result](project-foundation-1.4.0/native-identity.json)
- [Project model acceptance tests](../../lazybuddy-plugin/shared/project/test/project-model.test.mjs)
- [Independent adversarial model tests](../../lazybuddy-plugin/shared/project/test/project-adversarial.test.mjs)
- [Real-process CLI tests](../../lazybuddy-plugin/shared/project/test/project-cli.test.mjs)
- [Native identity reproduction](../../lazybuddy-plugin/shared/project/qa/native-identity.mjs)
- [Store boundary and crash QA](../../lazybuddy-plugin/shared/project/qa/README.md)

Run from the repository root:

```bash
node --test lazybuddy-plugin/shared/project/test/*.test.mjs \
  lazybuddy-plugin/shared/dashboard/test/projection.test.mjs \
  lazybuddy-plugin/shared/dashboard/test/proof-boundary.test.mjs

node lazybuddy-plugin/shared/project/qa/native-identity.mjs

node --test lazybuddy-plugin/shared/project/qa/store-boundary.test.mjs
```

The gate manifests describe the exact tested files rather than granting a
blanket approval to future changes. Existing dashboard code and the inspected
vendor pins were compared against the starting commit and remained unchanged.
After the combined gate, an extra final blank line was removed from the
adversarial test file to satisfy `git diff --check`; its 15 cases passed again
at the delivered file hash. This repeated run does not add to the 124-case total.

## Defects caught and repaired during this checkpoint

1. **Inconsistent read/write history validation.** A corrupted retained
   command digest originally rejected a mutation but still rendered through
   the projection. Canonical hashing now lives in one helper and the shared
   state validator checks it before either operation. This is local
   consistency validation, not a signature or authenticated authorship.
2. **Duplicate keys normalized before strict parsing.** The Node CLI originally
   parsed and reserialized stdin before the native parser saw it. It now
   preserves bounded original bytes so duplicate keys cannot be silently
   collapsed at the public command boundary. Real CLI regressions exercise
   both top-level and nested duplicates.

## Known limits and next execution gates

| Boundary | Current behavior and remaining work |
| --- | --- |
| First-time ownership setup | A kill before durable ownership can leave an unidentifiable directory or empty owner record. Retry refuses with `PROJECT_DIRECTORY_COLLISION` or `INVALID_JSON`, preserving caller data. Automatic recovery of this bootstrap window is not implemented. Normal atomic state-command retries are covered after ownership exists. |
| Repository identity | The native repository key hashes one canonical root path. Stable Git/worktree identity, moved-root rebinding and the neutral `.lazyseries/project.json` registry remain pending. |
| Source authority | Current imported text and command receipts are durable. There is no complete archive of old Markdown bodies, transactional original-source editing, or coherent multi-document amendment yet. |
| Baseline meaning | Item revisions reflect exact extracted text/metadata comparison. Applicability, accepted alternatives, proposal authority, semantic conflicts and reconciliation remain pending. The `issues` list is not an overall health verdict. |
| Runtime integration | Only Buddy's native command path is implemented. All six names exist in the pure model contract; the other five adapters and family distribution are pending. The new directory is outside the existing hash-pinned dashboard core. |
| Presentation and observations | The project-only browser shell, nested production graphs, chat delivery/consumption, usage, Git/worktrees/CI, architecture observations, research and report navigation still require implementation. |

In the larger T01–T28 execution specification, this is a subset of **T02
(project contracts)** and **T04 (project identity/source registration)**. It
does not close either entire work package or the full G0/G1/G2 gates. The
original private `.omo` plan, ledger and evidence named in the supplied run
report were unavailable in this checkout and have not been manufactured or
imported as verified history.

The next checkpoint is to complete the remaining contract and renderer work
under T02/T03 and review G0, then implement portable identity and source-edit
authority through T04–T08. The visual project shell must consume these real
snapshots and commands; the illustrative design is not a substitute for that
integration. Native sibling ports follow the contract and Buddy acceptance
gates, preserving their own lifecycle, permissions and evidence boundaries.
