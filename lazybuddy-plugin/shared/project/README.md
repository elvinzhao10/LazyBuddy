# Persistent project record: first implementation slice

This directory implements a project record that survives individual plans and
agent sessions. It registers existing Markdown, imports stable baseline items,
and connects several plans to the same feature, requirement, principle, or
decision. A native run is optional.

The [contract](contract.mjs), [model](model.mjs), and
[projection](projection.mjs) recognize all six LazySeries runtime names. The
[CLI](cli.mjs) resolves its [native
bridge](../../scripts/state/project-dashboard-bridge.py) in the owning package:
Buddy canonically, and each port ships its own bridge beside the vendored tree
(Trae is the exception — its owning adapter is a Node store that does not ship
this bridge); repository identity is runtime-neutral through
`.lazyseries/project.json`. Runtime enums are not evidence of sibling
integration.

## Ownership and entry points

| File | Responsibility |
| --- | --- |
| [contract.mjs](contract.mjs) | Strict JSON shapes, identities, operations, references, and history validation. |
| [model.mjs](model.mjs) | Pure creation and command reduction; source extraction, revisions, CAS, and idempotency. |
| [history.mjs](history.mjs) | Canonical command digests for local history consistency, without authenticated proof claims. |
| [projection.mjs](projection.mjs) | Accepted-item summaries, plan contributions, source freshness, and outdated baseline references. |
| [cli.mjs](cli.mjs) | `init`, `read`, and JSON-stdin `command`; invokes the native bridge. |
| [project-dashboard-bridge.py](../../scripts/state/project-dashboard-bridge.py) | Private storage, filesystem captures, native-run identity inspection, locking, and atomic publication. |

The CLI's `--reduce` path is an internal pure-model entry point. Supplying its
capture context is not native filesystem or verification authority.

## Register a baseline and an original plan

Use the repository-supported Node runtime and Python 3.10+. The native bridge
currently requires POSIX `fcntl` and directory-descriptor operations. Run these
examples from a fresh checkout's root. Replace `project_root` with that checkout's
absolute, canonical path; the shipped fixtures provide existing Markdown inputs.
For a real project, substitute its original document paths and identities.

```bash
project_root=/absolute/canonical/path/to/this-checkout

project_cli() {
  node lazybuddy-plugin/shared/project/cli.mjs "$1" \
    --project-root "$project_root" \
    --project-id project:offline-notebook \
    --actor contributor:you
}

project_cli init
project_cli read
```

`init` creates revision 0 or returns the existing matching record. `read`
returns a snapshot without adding a command revision. **`--actor` is local
attribution, not an authenticated user or proof of user approval.** A caller
must obtain any required authorization outside this interface.

The following sequence assumes no intervening commands. On an existing record,
use its current snapshot `revision` for each `expected_revision` and fresh
command IDs. Replace the two uppercase SHA-256 placeholders with the corresponding
64-character `snapshot.sources[].accepted_sha256` from registration output;
placeholder strings themselves intentionally fail validation.

```bash
project_cli command <<'JSON'
{
  "schema_version": 1,
  "command_id": "example:register-requirements",
  "project_id": "project:offline-notebook",
  "expected_revision": 0,
  "operation": "register_source",
  "payload": {
    "id": "source:requirements",
    "path": "lazybuddy-plugin/shared/project/test/fixtures/offline-notebook/requirements.md",
    "role": "requirements"
  }
}
JSON
```

Registration captures the actual file. The caller cannot provide its title or
text as authority. Bind two enduring items to unique headings in that capture:

```bash
project_cli command <<'JSON'
{
  "schema_version": 1,
  "command_id": "example:record-baseline",
  "project_id": "project:offline-notebook",
  "expected_revision": 1,
  "operation": "record_baseline_items",
  "payload": {
    "items": [
      {
        "id": "feature:notes",
        "kind": "feature",
        "state": "accepted",
        "source": {
          "source_id": "source:requirements",
          "sha256": "REQUIREMENTS_SHA256_FROM_REGISTER_SNAPSHOT",
          "anchor_id": "heading:feature:notes — Personal notes"
        }
      },
      {
        "id": "requirement:offline",
        "kind": "requirement",
        "state": "accepted",
        "strength": "binding",
        "source": {
          "source_id": "source:requirements",
          "sha256": "REQUIREMENTS_SHA256_FROM_REGISTER_SNAPSHOT",
          "anchor_id": "heading:requirement:offline — Work without a network"
        }
      }
    ]
  }
}
JSON
```

Register the original plan document separately, then reference the existing
baseline item revisions:

```bash
project_cli command <<'JSON'
{
  "schema_version": 1,
  "command_id": "example:register-search-source",
  "project_id": "project:offline-notebook",
  "expected_revision": 2,
  "operation": "register_source",
  "payload": {
    "id": "source:search",
    "path": "lazybuddy-plugin/shared/project/test/fixtures/offline-notebook/plans/search.md",
    "role": "plan"
  }
}
JSON

project_cli command <<'JSON'
{
  "schema_version": 1,
  "command_id": "example:register-search-plan",
  "project_id": "project:offline-notebook",
  "expected_revision": 3,
  "operation": "register_plan",
  "payload": {
    "id": "plan:search",
    "source": {
      "source_id": "source:search",
      "sha256": "SEARCH_SHA256_FROM_REGISTER_SNAPSHOT",
      "anchor_id": "document"
    },
    "declared_lifecycle": "planned",
    "baseline_refs": [
      { "item_id": "feature:notes", "item_revision": 1 },
      { "item_id": "requirement:offline", "item_revision": 1 }
    ]
  }
}
JSON
```

Successful commands return `{ receipt, snapshot }`. More plans can reference
those same item IDs. `contributing_plan_ids` records these declared links; it
does not establish implemented contributions. Heading anchors use exact,
unique ATX heading titles outside fenced examples. `document` binds the whole
file. The native bridge accepts UTF-8 `.md`/`.markdown` sources up to 1 MiB and
rejects unsafe paths and protected native storage.

## Changes, revisions, and retries

**Registered originals are rewritten only through the journaled `source.edit`
and `amend_baseline` routes.** Both land their file writes inside one journaled
transaction (intent first, atomic publication, crash recovery that never
overwrites a newer external edit) and splice only targeted lines, so fenced
examples, unrelated prose, and line endings keep their exact bytes. An
external edit outside those routes is never adopted silently: `read` reports
changed source observations while retaining the accepted baseline and plan
text. Accepting external content explicitly:

1. Reissue `register_source` for the source ID/path/role with a new command ID
   and current project revision. This accepts the new digest in the registry.
2. Reissue `record_baseline_items` for the affected anchors, or `register_plan`
   for the plan, using that newly registered digest. Registry refresh alone
   does not replace imported item or plan text.

An item's revision changes when its extracted title/text or accepted metadata
changes. Through `record_baseline_items` this is an exact comparison, not
language-level semantic analysis. The accepted-amendment route
(`amend_baseline`) additionally treats a whitespace-only difference outside
fenced examples as wording: it updates the record's bytes while preserving the
item's semantic revision and every reference pinned to it. Updating only the
source digest after an edit outside the item's anchor leaves its item revision
unchanged. A baseline-changing command advances `baseline_revision` once.
Plans retain their explicit item-revision references; outdated ones become
`stale`, including historical completed plans, without reopening those plans
automatically.

Every newly accepted command advances project `revision`, including an accepted
no-op. Replaying the same command ID and body returns its original receipt
without rolling state back, even after source removal. Different content under
that ID raises `IDEMPOTENCY_CONFLICT`. A stale `expected_revision` returns a
`conflict` receipt with `REVISION_CONFLICT`; it does not append a saved receipt.
Read the latest state before composing a new command.

## Accepted baseline amendments

`amend_baseline` is the authority-checked acceptance route for baseline change
(spec §3.3). One command, one receipt, one journaled transaction:

- `authority` (required) records the acceptance reference — a user instruction
  or a delegated mandate recorded as such. An acceptance without it is refused
  before anything mutates, and a recorded proposal without acceptance
  authority never touches the accepted baseline.
- `source` + `edits` apply the document change through the same AST editor as
  `source.edit` (stable anchors; `expected_sha256` and
  `expected_source_revision` are CAS guards).
- `items` re-record the affected baseline records against the post-amendment
  digest, including applicability (repository-wide, component, environment, or
  an explicit migration period). A wording-only difference preserves the item's
  semantic revision; a behavioral change bumps it, advances `baseline_revision`
  once, and emits invalidation facts naming exactly the plans that considered
  an older revision — carried-forward references moved by this same
  transaction are marked as such, everything else stays pending for
  reconciliation. The facts are retained on the receipt and surfaced by the
  snapshot's `invalidations` list.
- `plan_updates` carry linked non-historical plans' baseline references to the
  amended revisions coherently. A completed, superseded, or abandoned plan
  keeps the revisions it considered (`HISTORICAL_PLAN_IMMUTABLE`): its later
  alignment becomes unassessed without reopening its execution.
- `proposal_id` optionally accepts a recorded `BaselineProposal`; its state
  moves to `accepted` and the acceptance authority is recorded on it.

An unaccepted suggestion stays a `BaselineProposal` in `proposed` state with
zero baseline effect; accepted requirements without a contributing plan stay
visible in `summary.unassigned_item_ids`.

## Native-run links and interpretation

The fourth operation, `link_native_run`, has exactly this payload:

```json
{
  "plan_id": "plan:search",
  "native_project_id": "NATIVE_PROJECT_ID_FROM_EXISTING_RUN",
  "run_id": "EXISTING_RUN_ID"
}
```

Use the usual command envelope and current revision. The bridge inspects
`.lazybuddy/runs/<run_id>/state.json`; `run_id` and `dashboard_project_id` must
match. It creates no run and records only an inspected identity link. Native
execution, revision consumption, agent activity, and proof remain unobserved
through this CLI.

`declared_lifecycle` is imported metadata. Checkboxes, `completed`, accepted
baseline items, and saved command receipts grant no verification. Projection
`alignment` remains `unassessed`; current revision references do not establish
semantic compatibility. Source observations distinguish `current`, `changed`,
`missing`, `unavailable`, and `unobserved`.

The snapshot's `issues` list covers source registry freshness and outdated
baseline references. An empty list is not an overall project-health verdict;
individual imported items can still reference an older source capture.

## Storage and recovery boundaries

The native store is `.lazybuddy/project/`: `owner.json` binds the project ID and
repository key, `state.json` retains current imported records plus saved command
receipts, and `lock` serializes bridge access. Identity is anchored by the
runtime-neutral `.lazyseries/project.json` registry at the repository root: it
holds a generated stable repository key plus a source pointer list (ids, roles,
paths — no document bodies, no execution authority) and is created only by
explicit `init`, never by a read. The native `owner.json` records its registry
link. A moved root and linked Git worktrees resolve to the same registry
identity; `git worktree list --porcelain -z` facts distinguish worktrees and
their separate working revisions without flattening them. A store created under
the earlier canonical-path identity migrates additively through explicit
`init`: `state.json` and its retained receipts stay byte-identical, the owner
records the replaced path key, and reads before migration keep working.

The store is user-owned and private; symlinks, hard-linked state files,
directory replacement, unsafe permissions, and ownership collisions are
rejected. State and its receipts publish together with locking, content checks,
`fsync`, and atomic replacement. Source recapture detects changes before
publication but does not transact with external editors.

After a valid durable `owner.json` exists, `init` can finish matching-owner
partial initialization containing only the recognized owner, lock, and
temporary-state names. State and command-receipt publication use the atomic
path; retry an interrupted command with its original ID and body.

Bootstrap **before durable ownership is not automatically recoverable**. A kill
after creating the project directory can leave no owner and cause
`PROJECT_DIRECTORY_COLLISION`; a kill after opening the owner file can leave an
empty owner and cause `INVALID_JSON`. These refusals preserve the directory's
contents instead of adopting or deleting unidentified files. This is not
general corruption repair or permission takeover: retain the rejected store
for diagnosis rather than deleting owner/state files to bypass an error.

Current baseline text and receipts are durable. An immutable archive of every
older Markdown body is **not built**: receipts retain commands and digests,
not a complete recoverable document-version history.

## Contributor handoff

The Buddy-side proof — the model tests (`test/project-model.test.mjs`), the
adversarial tests (`test/project-adversarial.test.mjs`), the native CLI tests
(`test/project-cli.test.mjs`), and the offline-notebook fixtures
(`test/fixtures/offline-notebook/`) — specify continuity across
plans/reloads, explicit source refresh, revision conflicts, idempotency,
anchors, and refusal of fabricated verification. Those files are named here as
text, not links, because the family selection deliberately excludes `test/`
from the pinned distribution: sibling ports receive the runtime modules and the
portable qa harness only and author their own adapter tests, so a link would
resolve only in this source repository. The focused entry point is:

```bash
node --test lazybuddy-plugin/shared/project/test/*.test.mjs
```

This README records implementation behavior, not a test-pass certificate.

Since the first slice, the pending list has landed: the project dashboard
views and native chat routes live in the dashboard layer, this tree ships as
the byte-pinned project vendor family (siblings receive it verbatim through
`project.vendor.json` at their plugin's `shared/project`), and each sibling's
native adapter is port-authored outside this tree. Conflict assessment remains
deterministic only — no language-level semantic analysis is built. The runtime
enums above are still not evidence of sibling native integration.
