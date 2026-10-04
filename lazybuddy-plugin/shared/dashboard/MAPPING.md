# Dashboard projection contract v1

This directory is a dependency-free Node 18-compatible read model. It does not
write run state, execute a verifier, authorize a task, dispatch workers, or provide
an HTTP endpoint. The committed state remains the execution authority.

## Public exports

- `projection.mjs`: `projectSnapshot(input, completionProof?)`, `parseContract(name,
  value)`, `stableJSON(value)`, `ContractError` (`code`, `location`). Projection
  returns a detached, schema-validated snapshot. Identical inputs produce identical
  snapshot and cursor bytes using `stableJSON`; no clock or random IDs are used.
- `contracts/schema.mjs`: `schema`, `definitions`. The bundled
  `contracts/lazyseries-dashboard.v1.schema.json` is the equivalent JSON Schema
  2020-12 contract. Regenerate with `JSON.stringify(schema, null, 2) + '\n'`.
- `contracts/parse.mjs`: the public contract parser above plus internal boundary
  helpers. Supported schemas are snapshot, task, criterion, criterion_history,
  scenario, attempt, decision, queued_plan, command, acknowledgement, provenance,
  cursor, source_cursor, capabilities, progress, observation and issue.
- `adapters/runtime.mjs`: `adaptRuntime(source, runId)`.
- `adapters/host.mjs`: `adaptHost(source)`.
- Both adapters return `{records, cursor, issues}`. Normalized records carry
  `event`, inert `payload`, `provenance`, `dedup_key`, and `identity`. These last two
  fields are reduction details; snapshot observations omit them.
- `adapters/completion.mjs`: `readBuddyCompletion(projectRoot, {authorityPath,
  packageVersion})` produces an opaque in-process proof using Buddy's existing
  `scripts/completion-assessment.js`. `completionApplies` is read-only. Deserialized
  JSON cannot impersonate a proof. Other siblings must supply their own read
  boundary before promoting completion; the pure baseline works without it.
- `projector.mjs`: `main(argv)` returns 0 for a valid snapshot, 65 for rejected
  input or required resynchronization. A resync diagnostic snapshot can be written
  for inspection but must never be treated as a live result.

## Input binding

```js
{
  project_id: 'project:1', run_id: 'run-1', revision: 7, plan_revision: 2,
  state: {schema_version: '2', run_id: 'run-1', tasks: [], decisions: [], acknowledgements: []},
  sources: [{kind: 'runtime', id: 'runtime', generation: '1', text: '...\n'}],
  // Optional independent project queue boundary:
  queue_revision: 0, queue: [],
  // Optional authenticated adapter reports, never inferred from event silence:
  capabilities: {embedding: 'unobserved', chat_handoff: 'unobserved', wake: 'unobserved', observations: 'unobserved'},
  // Optional current source identity for evidence compatibility:
  source_revision: '<HEAD>', plan_digest: '<approved-plan-sha256>',
  previous_cursor: undefined
}
```

`revision` must come from the committed transaction revision. Never substitute a
source timestamp. The CLI reads `.revision` before and after all files and refuses
pending journals or a changing revision. Service code must capture the same
consistent input through the transaction boundary. CLI read checks are for
quiescent recorded replay, not a replacement for the service's locked snapshot.

Legacy state schema absent/1/2 (string or numeric) upgrades to projection schema 1.
Legacy `pending`, `queued`, `ready`, `blocked` map to `not_started`; `in_progress`
to `running`; `done`/`complete` to `finished`. Unknown status/schema rejects. A
legacy task missing criteria has an empty required denominator and is unverified.
Task titles prefer title, then description, then ID. No evidence path implies a
receipt. State is authoritative for task execution and current criterion versions;
ledger task updates are retained observations and never overwrite newer state.

Snapshot `freshness: snapshot` means a coherent captured observation, not an open
connection. Connection state belongs to the service/UI. Missing capabilities are
`unobserved`; explicit unavailable stays unavailable. No timing, ownership,
attempt, pass or concurrency is inferred from dependency geometry or silence.

## Source formats and ordering

| kind | Envelope | Identity |
|---|---|---|
| runtime | `schema_version:1,event_id,ts,run_id,event,event_payload` | run + event_id |
| legacy | `ts,run_id,event,...flattenedPayload`, optional event_id | same run/event_id for mirrors; otherwise source/generation/line |
| host | `schema_version:1,contract_version:'1.0.0',record_type:'canonical-event',event_id,host,raw_event,canonical_event,occurred_at,surface,payload` | host + event_id |
| hook | actual Buddy `normalized-hook-event` output, schema 1, session_id, cwd, consumer with completion_authority:false | session + event_id |

The host canonical adapter validates the existing host envelope and surface shape;
the distinct normalized-hook path accepts actual lifecycle producer output without
fabricating a host surface receipt. Host/hook events remain advisory observations.
An unknown runtime event is preserved as an observation; canonical host
`unsupported` remains explicit. Unknown canonical host vocabulary/schema rejects.

Order is supplied source order, then physical line order. Use canonical runtime
before its legacy mirror. Identical mirrors deduplicate; colliding IDs reject.
Repeated ID-less records on different physical lines remain distinct because no
stable producer ID exists. Timestamps are preserved only for display, never sorting
or causality. Cross-source temporal order is deliberately not claimed.

Cursor binds project/run/revision, state digest, independent queue revision/digest, and each source's ID, generation,
complete line count and prefix digest. Comparing a prior cursor detects revision
regression/gap, same-revision state changes, removed/shortened/replaced sources and
prefix mutations. Generation must be stable across ordinary append/atomic writes;
change it on deliberate rotation. A gap/rotation produces `resync_required`.
Malformed JSON or unterminated nonempty tails retain only the complete valid prefix
and force resync, with exact source/line diagnostics; incompatible parsed schemas
throw `ContractError`. A fresh full snapshot can establish a new cursor after the
service resolves the diagnostic. Cursor streaming and durable replay are P2 work.

Limits: 8 MiB per input/source, 64 sources, 10,000 records/items per collection,
64 KiB per event line, 8,192 characters per user text field. CLI subprocess QA uses
15-second bounds. No input field is executed as code or shell.

## Attempts and evidence

Runtime `attempt_result` uses an attempt payload without `provenance`; the adapter
adds real provenance. Required fields are `id,task_id,criterion_id,criterion_version,
plan_revision,consumed_plan_revision,worker_id,parent_task_id,source_revision,
execution,verification,started_at,finished_at,evidence`. Nullable fields represent
unobserved data. Worker/parent identity and consumed revision are only explicit
observations; parent must exist and a consumed revision must equal dispatch
revision. Running attempt updates retain identity. A terminal attempt is immutable;
a retry gets a new ID. This preserves failed/cancelled attempts, and never alters
the existing single-authoritative-running-task rule.

A reported `verified` result is downgraded to unverified unless current authority
independently assesses the receipt. Failed execution is failed, cancelled is
unverified, unavailable is unavailable. A result for a different criterion version,
plan revision or current source revision marks current evidence stale. Old
criterion definitions live in `history`; old attempts/evidence remain present.

The Buddy completion reader reuses checks for current Git HEAD, clean worktree,
package version, plan digest/checkbox, receipt identity, zero exit, artifact hash,
independent verifier and approved review hash. Proof also must match projection
run/source/plan and criterion version (legacy authority defaults to version 1).
It never overrides failed/stale/unavailable/verifying results or unfinished tasks.
The named denominator is `required_criteria`, with explicit version list, optional
and not-applicable counts. Empty required criteria never imply verified.

## Typed operations for B1/B2/B3

Every command has `schema_version:1,command_id,target,expected_revision,operation,
payload`. Target is `{project_id,run_id,id}`; project-queue operations use null
run_id. There is no actor field: the authenticated service supplies actor identity.

| operation | payload |
|---|---|
| amend_task | scope and/or priority (nonempty) |
| add_dependency / remove_dependency | prerequisite_id |
| add_criterion | criterion_id, requirement, applicability, scenarios |
| amend_criterion | criterion_id, requirement, expected_version |
| add_scenario / amend_scenario | criterion_id, scenario `{id,requirement,verifier_ref}` |
| create_queued_plan | plan (queued_plan schema) |
| amend_queued_plan | title and/or readiness (nonempty) |
| reorder_queued_plan | plan_ids |
| attach_evidence | criterion_id, evidence `{path,sha256,provenance}` |
| propose_decision | decision (decision schema) |
| supersede_decision | decision_id, replacement (decision schema) |

No generic patch, shell, arbitrary file write or manual pass operation exists.
Attached evidence is a submission, never a verdict. Command schema checks shape;
B1/B2 must additionally validate operation-specific references, allowed decision
transitions, project/run binding, current revision, graph validity and idempotency
under the existing journal/lock. The projector rejects cycles and unknown task
references in an accepted snapshot, but is not a transactional edit validator.

Acknowledgements include schema_version, command_id, target, status, revision,
plan_revision, consumed_plan_revision and reason. Status is `saved`, `pending_agent`,
`applied`, `conflict` or `rejected`. Applied requires consumed_plan_revision equal
to plan_revision. B4 alone emits actual consumption; dashboard persistence cannot
manufacture it. Queue revision is independent from run revision, exposed alongside
queue entries in the snapshot; B2 supplies its authoritative store.

## CLI and tests

```
node lazybuddy-plugin/shared/dashboard/projector.mjs --project-root /actual/project --run-dir /actual/project/.lazybuddy/runs/run-1 --project-id project:1 --hook-events /captured/hook.jsonl --output snapshot.json --cursor-output cursor.json
node lazybuddy-plugin/shared/dashboard/projector.mjs --input captured-input.json --previous-cursor cursor.json --output replay.json
node --test lazybuddy-plugin/shared/dashboard/test/projection.test.mjs
node lazybuddy-plugin/shared/dashboard/test/manual-qa.mjs --evidence-dir /absolute/evidence
```

Optional `--host-events` accepts canonical host NDJSON, `--hook-events` normalized
hook NDJSON. The fixture-input CLI never accepts completion proofs. Paths supplied
to this local replay tool are operator inputs, not browser file access endpoints.
Fixtures are synthetic and labeled; `manual-qa.mjs` drives existing real package
producers, preserves their outputs, and removes its registered temporary project.
It makes no authenticated native-host or browser-readiness claim.
