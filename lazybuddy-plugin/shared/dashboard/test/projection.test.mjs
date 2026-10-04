import "./receipt-attempt.test.mjs";

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { projectSnapshot, parseContract, stableJSON } from '../projection.mjs';
import { completionFixture } from './completion-fixture.mjs';
import { readBuddyCompletion } from '../adapters/completion.mjs';
import { schema } from '../contracts/schema.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy.json', import.meta.url)));
const input = () => structuredClone(fixture);
const criterion = (overrides = {}) => ({ id: 'c1', task_id: 'task-1', version: 1, requirement: 'Command produces artifact',
  applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [], ...overrides });
const event = (eventId, payload = {}, timestamp = '2026-10-04T10:00:00Z') => ({ schema_version: 1, event_id: eventId,
  run_id: 'run-1', event: 'observation', event_payload: payload, ts: timestamp });
const source = (records, kind = 'runtime', id = kind) => ({ kind, id, generation: '1', text: records.map(item => JSON.stringify(item) + '\n').join('') });
const attempt = (overrides = {}) => ({ id: 'a1', task_id: 'task-1', criterion_id: 'c1', criterion_version: 1,
  plan_revision: 1, consumed_plan_revision: null, worker_id: null, parent_task_id: null, source_revision: null,
  execution: 'finished', verification: 'verified', started_at: null, finished_at: null, evidence: [], ...overrides });
function withAttempt(overrides = {}, requirement = {}) {
  const value = input(); value.state.tasks[0].criteria = [criterion(requirement)];
  value.sources = [source([{ ...event('e1', attempt(overrides)), event: 'attempt_result' }])]; return value;
}
test('legacy completion remains unverified with absent host observations', () => {
  // Given: legacy done and a planned branch. When: projecting committed state.
  const snapshot = projectSnapshot(input());
  // Then: no inferred attempt, pass, concurrency or host capability.
  assert.equal(snapshot.tasks[0].execution, 'finished'); assert.equal(snapshot.tasks[0].verification, 'unverified');
  assert.deepEqual(snapshot.tasks[0].attempts, []); assert.equal(snapshot.tasks[1].execution, 'not_started');
  assert.equal(snapshot.capabilities.observations, 'unobserved');
});
test('replay produces byte-identical snapshot and cursor despite descending timestamps', () => {
  // Given: source order differs from clock order.
  const value = input(); value.sources = [source([event('e1', {}, '2026-10-04T12:00:00Z'), event('e2')])];
  // When: replaying twice. Then: source order and bytes are deterministic.
  const first = projectSnapshot(value); const second = projectSnapshot(value);
  assert.equal(stableJSON(first), stableJSON(second)); assert.equal(first.observations[0].provenance.source_event_id, 'e1');
});
test('canonical and mirrored runtime identities deduplicate while ID-less updates survive', () => {
  // Given: actual producer envelopes and a legacy-only task update.
  const value = input(); const canonical = event('e1', { message: 'observed' });
  value.sources = [source([canonical]), source([{ ts: canonical.ts, run_id: 'run-1', event: 'observation', event_id: 'e1', message: 'observed' },
    { ts: canonical.ts, run_id: 'run-1', event: 'task_updated', task_id: 'task-1', status: 'done' }], 'legacy')];
  // When: projecting. Then: one mirrored event and one retained update.
  const actual = projectSnapshot(value); assert.equal(actual.observations.length, 2); assert.equal(actual.observations[1].event, 'task_updated');
});
test('a reused source event ID with different content is rejected', () => {
  // Given: a colliding ID. When/Then: boundary rejects content ambiguity.
  const value = input(); value.sources = [source([event('e1'), event('e1', { changed: true })])];
  assert.throws(() => projectSnapshot(value), /EVENT_ID_COLLISION/);
});
for (const [name, overrides, expected] of [
  ['failed command', { execution: 'failed' }, 'failed'], ['cancelled command', { execution: 'cancelled' }, 'unverified'],
  ['unavailable check', { verification: 'unavailable' }, 'unavailable'], ['running check', { execution: 'running', verification: 'verifying' }, 'verifying'],
  ['unverified claimed pass', {}, 'unverified'], ['old criterion', { criterion_version: 0 }, 'stale'],
  ['old dispatch revision', { plan_revision: 0 }, 'stale'],
]) test(`${name} cannot become an applicable verified result`, () => {
  // Given: an explicit attempt result. When: projection consumes it. Then: truthful evidence state.
  const actual = projectSnapshot(withAttempt(overrides)); assert.equal(actual.tasks[0].criteria[0].verification, expected);
  assert.equal(actual.tasks[0].progress.verified, 0); assert.equal(actual.tasks[0].attempts.length, 1);
});
test('old criterion history and evidence survive a requirement amendment', () => {
  // Given: new criterion version retaining previous requirement/result references.
  const value = withAttempt({}, { version: 2, history: [{ version: 1, requirement: 'Original requirement', result_ids: ['a1'] }] });
  // When: projecting. Then: current result stale, previous requirement retained.
  const actual = projectSnapshot(value).tasks[0]; assert.equal(actual.criteria[0].verification, 'stale');
  assert.equal(actual.criteria[0].history[0].version, 1); assert.equal(actual.attempts[0].criterion_version, 1);
});
test('required denominator excludes optional and not-applicable criteria', () => {
  // Given: three distinct applicability classes. When: projecting. Then: only required count in denominator.
  const value = input(); value.state.tasks[0].criteria = [criterion(), criterion({ id: 'optional', applicability: 'optional' }), criterion({ id: 'na', applicability: 'not_applicable' })];
  const actual = projectSnapshot(value).tasks[0].progress; assert.equal(actual.total, 1); assert.equal(actual.optional, 1); assert.equal(actual.not_applicable, 1);
});
for (const [name, suffix] of [['incomplete', '{'], ['corrupt', '{\n']]) test(`${name} tail forces explicit resync`, () => {
  // Given: a valid prefix with invalid tail. When: projecting. Then: no healthy cursor claim.
  const value = input(); value.sources = [source([event('e1')])]; value.sources[0].text += suffix;
  const actual = projectSnapshot(value); assert.equal(actual.freshness, 'resync_required'); assert.equal(actual.observations.length, 1);
});
test('rotated sources and revision gaps require resync', () => {
  // Given: previous cursor from a different prefix. When: reading a later revision. Then: both reasons exposed.
  const value = input(); value.sources = [source([event('e1')])]; const old = projectSnapshot(value).cursor;
  value.previous_cursor = old; value.sources = [source([event('e2')])]; value.revision += 2;
  const codes = projectSnapshot(value).issues.map(item => item.code); assert.ok(codes.includes('SOURCE_ROTATED')); assert.ok(codes.includes('REVISION_GAP'));
});
test('same revision changed state is detected', () => {
  // Given: state altered without a commit. When: reconciling cursor. Then: stale state is explicit.
  const value = input(); value.previous_cursor = projectSnapshot(value).cursor; value.state.tasks[0].title = 'Changed';
  assert.equal(projectSnapshot(value).issues[0].code, 'STATE_CHANGED_WITHOUT_REVISION');
});
test('untrusted text remains inert and a fake proof cannot verify', () => {
  // Given: command-looking task text and a raw pass claim. When: projecting. Then: text only, unverified.
  const value = withAttempt(); value.state.tasks[0].title = '$(touch /tmp/DO-NOT-CREATE) <script>throw 1</script>';
  const actual = projectSnapshot(value, { status: 'ready' }); assert.equal(actual.tasks[0].title, value.state.tasks[0].title);
  assert.equal(actual.tasks[0].verification, 'unverified');
});
for (const [name, change, reason] of [
  ['future state schema', value => { value.state.schema_version = 99; }, 'UNSUPPORTED_STATE_SCHEMA'],
  ['unknown task state', value => { value.state.tasks[0].status = 'magic'; }, 'UNKNOWN_TASK_STATUS'],
  ['cycle', value => { value.state.tasks[0].depends_on = ['task-2']; }, 'DEPENDENCY_CYCLE'],
  ['cross-run event', value => { value.sources = [source([{ ...event('e1'), run_id: 'elsewhere' }])]; }, 'RUN_ID_MISMATCH'],
  ['incompatible runtime envelope', value => { value.sources = [source([{ ...event('e1'), schema_version: 7 }])]; }, 'UNSUPPORTED_RUNTIME_SCHEMA'],
]) test(`rejects ${name}`, () => {
  // Given: malformed boundary input. When/Then: projection rejects explicitly.
  const value = input(); change(value); assert.throws(() => projectSnapshot(value), new RegExp(reason));
});
test('command contract rejects arbitrary writes, manual pass and oversized amendments', () => {
  // Given: a supported command structure. When/Then: forbidden operations fail parsing.
  const command = { schema_version: 1, command_id: 'cmd:1', target: { project_id: 'p', run_id: 'r', id: 't' }, expected_revision: 1,
    operation: 'amend_task', payload: { scope: 'updated' } };
  assert.equal(parseContract('command', command).operation, 'amend_task');
  for (const operation of ['set_pass', 'write_file', 'shell', 'patch']) assert.throws(() => parseContract('command', { ...command, operation }));
  assert.throws(() => parseContract('command', { ...command, payload: { scope: 'x'.repeat(8193) } }));
  assert.throws(() => parseContract('command', { ...command, actor: 'admin' }));
});
test('applied acknowledgement requires exact consumed revision', () => {
  // Given: an acknowledgement before actual revision consumption. When/Then: applied rejected.
  const ack = { schema_version: 1, command_id: 'c', target: { project_id: 'p', run_id: 'r', id: 't' },
    status: 'applied', revision: 2, plan_revision: 2, consumed_plan_revision: null, reason: null };
  assert.throws(() => parseContract('acknowledgement', ack), /UNCONSUMED_REVISION/);
});
test('published JSON schema matches executable contracts', () => {
  // Given: bundled machine-readable schema. When: loading it. Then: exact contract identity.
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../contracts/lazyseries-dashboard.v1.schema.json', import.meta.url))), schema);
});
test('host observations use distinct identities and cannot complete a task', () => {
  // Given: canonical host envelopes and an identically named runtime ID.
  const value = input(); const host = JSON.parse(fs.readFileSync(new URL('./fixtures/host.json', import.meta.url)));
  value.sources = [source([{ ...host, canonical_event: 'task-completed', payload: { task_id: 'task-2' } }], 'host'), source([event(host.event_id)])];
  // When: projecting. Then: observations remain separate and task remains pending.
  const actual = projectSnapshot(value); assert.equal(actual.observations.length, 2); assert.equal(actual.tasks[1].execution, 'not_started');
});
test('unsupported host observation remains explicit with no capability promotion', () => {
  // Given: valid unsupported canonical observation. When: projecting. Then: preserved and unobserved capabilities.
  const value = input(); const host = JSON.parse(fs.readFileSync(new URL('./fixtures/host.json', import.meta.url)));
  value.sources = [source([{ ...host, canonical_event: 'unsupported' }], 'host')];
  const actual = projectSnapshot(value); assert.equal(actual.observations[0].event, 'unsupported'); assert.equal(actual.capabilities.embedding, 'unobserved');
});
test('runtime envelopes cannot masquerade as host observations', () => {
  // Given: runtime envelope on host source. When/Then: rejects incompatible schema.
  const value = input(); value.sources = [source([event('e1')], 'host')]; assert.throws(() => projectSnapshot(value));
});
test('explicit worker attempts retain dispatch identity without changing running authority', () => {
  // Given: a worker observation tied to its authoritative parent and consumed revision.
  const value = withAttempt({ execution: 'running', verification: 'verifying', worker_id: 'worker:1', parent_task_id: 'task-1', consumed_plan_revision: 1 });
  // When: projecting. Then: identity retained; no additional task marked running.
  const actual = projectSnapshot(value); assert.equal(actual.tasks[0].attempts[0].worker_id, 'worker:1');
  assert.equal(actual.tasks[1].execution, 'not_started');
});
test('only an applicable assessment of on-disk authority verifies a criterion', async () => {
  // Given: independently reviewed receipt with actual files and current Git identity (unit fixture).
  const fixture = completionFixture();
  try {
    const value = input(); value.state.tasks[0].criteria = [criterion()]; value.source_revision = fixture.head; value.plan_digest = fixture.plan_digest;
    // When: using the existing completion assessor at the read boundary.
    const captured = await fixture.capture(value);
    const proof = readBuddyCompletion(captured, fixture.options); const actual = projectSnapshot(captured, proof);
    // Then: the applicable criterion is verified using the authority, not a JSON pass claim.
    assert.equal(actual.tasks[0].verification, 'verified'); assert.equal(actual.tasks[0].progress.verified, 1);
  } finally { fixture.cleanup(); }
});
for (const [name, mutate] of [
  ['dirty worktree', fixture => fixture.write('untracked.txt', 'dirty')],
  ['failed receipt', fixture => fixture.write('.lazybuddy/receipt.json', { ...fixture.receipt, exit_code: 1 })],
  ['tampered artifact', fixture => fixture.write('.lazybuddy/artifact.txt', 'tampered')],
]) test(`${name} cannot use a completion receipt as proof`, async () => {
  // Given: a receipt invalidated at its actual authority boundary.
  const fixture = completionFixture();
  try {
    mutate(fixture); const value = input(); value.state.tasks[0].criteria = [criterion()]; value.source_revision = fixture.head; value.plan_digest = fixture.plan_digest;
    // When: projecting the assessment. Then: no verified criterion.
    const captured = await fixture.capture(value);
    const actual = projectSnapshot(captured, readBuddyCompletion(captured, fixture.options)); assert.equal(actual.tasks[0].progress.verified, 0);
  } finally { fixture.cleanup(); }
});
test('retry retains failed attempt and does not promote a later claimed pass', () => {
  // Given: failed terminal attempt followed by a distinct retry.
  const value = withAttempt({ execution: 'failed' }); value.sources[0].text += JSON.stringify({ ...event('e2', attempt({ id: 'retry' })), event: 'attempt_result' }) + '\n';
  // When: replaying. Then: failure remains inspectable and retry is unverified.
  const task = projectSnapshot(value).tasks[0]; assert.equal(task.attempts.length, 2); assert.equal(task.attempts[0].verification, 'failed'); assert.equal(task.criteria[0].verification, 'unverified');
});
test('terminal attempt IDs cannot be rewritten by a retry', () => {
  // Given: retry reuses a terminal attempt identity. When/Then: history rewriting rejected.
  const value = withAttempt({ execution: 'failed' }); value.sources[0].text += JSON.stringify({ ...event('e2', attempt()), event: 'attempt_result' }) + '\n';
  assert.throws(() => projectSnapshot(value), /TERMINAL_ATTEMPT_REWRITTEN/);
});
test('project queue has an independent cursor revision', () => {
  // Given: queue committed independently of the selected run. When: projecting. Then: cursor carries its revision.
  const value = input(); value.queue_revision = 4; value.queue = [{ id: 'plan:next', project_id: value.project_id, title: 'Future work', priority: 0,
    readiness: 'held', prerequisites: [], decision_id: null, revision: 4 }];
  const snapshot = projectSnapshot(value); assert.equal(snapshot.cursor.queue_revision, 4); assert.equal(snapshot.queue[0].readiness, 'held');
  assert.equal(snapshot.tasks[1].execution, 'not_started');
});
test('all bounded operation classes parse without arbitrary patch or pass fields', () => {
  // Given: domain-specific command payloads, independently enumerated.
  const decision = { id: 'd1', title: 'Decision', choice: null, rationale: 'Need a choice', scope: ['task-1'], alternatives: [], reference: null, state: 'proposed', supersedes: null, revision: 1 };
  const scenario = { id: 's1', requirement: 'Observe result', verifier_ref: 'verifier:1' };
  const plan = { id: 'p1', project_id: 'project:1', title: 'Future plan', priority: 1, readiness: 'draft', prerequisites: [], decision_id: null, revision: 0 };
  const operations = [ ['amend_task', { priority: 2 }], ['add_dependency', { prerequisite_id: 'task-1' }], ['remove_dependency', { prerequisite_id: 'task-1' }],
    ['add_criterion', { criterion_id: 'c1', requirement: 'Check result', applicability: 'required', scenarios: [] }], ['amend_criterion', { criterion_id: 'c1', requirement: 'New result', expected_version: 1 }],
    ['add_scenario', { criterion_id: 'c1', scenario }], ['amend_scenario', { criterion_id: 'c1', scenario }], ['create_queued_plan', { plan }],
    ['amend_queued_plan', { readiness: 'held' }], ['reorder_queued_plan', { plan_ids: ['p1'] }], ['attach_evidence', { criterion_id: 'c1', evidence: { path: 'evidence.txt', sha256: null, provenance: 'submitted' } }],
    ['propose_decision', { decision }], ['supersede_decision', { decision_id: 'd0', replacement: decision }] ];
  // When/Then: every explicitly typed operation crosses the parser successfully.
  for (const [operation, payload] of operations) assert.equal(parseContract('command', { schema_version: 1, command_id: 'command:1', target: { project_id: 'project:1', run_id: 'run-1', id: 'task-1' }, expected_revision: 1, operation, payload }).operation, operation);
});
