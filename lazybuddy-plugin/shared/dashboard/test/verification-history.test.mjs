import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAttempts, compareCriterionVersions, verificationRows } from '../ui/verification-history.mjs';
import { reduceCommand } from '../command-reducer.mjs';
import { projectSnapshot } from '../projection.mjs';

const criterion = () => ({ id: 'C1', task_id: 'T1', version: 1, requirement: 'Preserve notes offline',
  applicability: 'required', verification: 'unverified', scenarios: [{ id: 'S1', requirement: 'Read a local note', verifier_ref: 'test:offline' }], result_ids: [], history: [] });
const input = () => ({ project_id: 'project:test', run_id: 'run', revision: 1, plan_revision: 1,
  source_revision: 'source:one', plan_digest: 'a'.repeat(64), review_content_sha256: 'c'.repeat(64), actor: 'reviewer:local', sources: [],
  state: { run_id: 'run', plan_revision: 1, tasks: [{ id: 'T1', title: 'Offline', status: 'done', criteria: [criterion()] }] } });
const command = (value, operation, payload, id = 'cmd:one') => ({ schema_version: 1, command_id: id,
  target: { project_id: value.project_id, run_id: value.run_id, id: 'T1' }, expected_revision: value.revision, operation, payload });
const attempt = (fields = {}) => ({ id: 'attempt:failure', task_id: 'T1', criterion_id: 'C1', criterion_version: 1,
  plan_revision: 1, consumed_plan_revision: 1, source_revision: 'source:one', worker_id: 'worker:one', parent_task_id: null,
  execution: 'failed', verification: 'failed', started_at: null, finished_at: null, evidence: [], ...fields });
const observed = (value, result = attempt()) => { value.sources = [{ id: 'runtime', generation: '1', kind: 'runtime', text: `${JSON.stringify({
  schema_version: 1, run_id: 'run', event_id: 'event:one', event: 'attempt_result', ts: '2026-10-29T12:00:00Z', event_payload: result })}\n` }]; return value; };

test('scenario amendments retain the original executable reference and definition', () => {
  // Given: a current scenario with an independently known definition.
  const value = input();
  // When: the scenario changes through the authoritative reducer.
  const reduced = reduceCommand({ ...value, command: command(value, 'amend_scenario', { criterion_id: 'C1',
    scenario: { id: 'S1', requirement: 'Read notes after restarting', verifier_ref: 'test:restart' } }) });
  // Then: old and new definitions remain distinguishable.
  const changed = reduced.state.tasks[0].criteria[0];
  assert.equal(changed.history[0].scenarios[0].verifier_ref, 'test:offline');
  assert.equal(changed.scenarios[0].verifier_ref, 'test:restart');
  assert.deepEqual(compareCriterionVersions(changed, 1, 2).changed, ['S1']);
});

test('an observed failure becomes an unverified regression with immutable observed provenance', () => {
  // Given: an actual failed runtime observation.
  const value = observed(input());
  // When: promoting it to a regression.
  const reduced = reduceCommand({ ...value, command: command(value, 'promote_failure', { criterion_id: 'C1', expected_version: 1,
    attempt_id: 'attempt:failure', scenario: { id: 'regression:one', requirement: 'Retain the failed offline case', verifier_ref: 'test:offline-regression' } }) });
  // Then: provenance comes from the ledger and no pass is granted.
  const changed = reduced.state.tasks[0].criteria[0];
  assert.equal(changed.version, 2); assert.equal(changed.verification, 'unverified');
  assert.deepEqual(changed.scenarios[1].origin, { attempt_id: 'attempt:failure', criterion_version: 1, plan_revision: 1, source_revision: 'source:one' });
  assert.equal(projectSnapshot({ ...value, state: reduced.state, plan_revision: 2 }).tasks[0].attempts[0].execution, 'failed');
});

test('a fabricated or successful attempt cannot become a failure regression', () => {
  // Given: no failed observation.
  const value = observed(input(), attempt({ execution: 'finished', verification: 'unverified' }));
  // When/Then: the command refuses the claimed failure.
  assert.throws(() => reduceCommand({ ...value, command: command(value, 'promote_failure', { criterion_id: 'C1', expected_version: 1,
    attempt_id: 'attempt:failure', scenario: { id: 'regression:one', requirement: 'A case', verifier_ref: 'test:case' } }) }), /FAILED_ATTEMPT_REQUIRED/);
});

test('attempt comparison rejects changed subjects and missing native consumption', () => {
  // Given: a failure and repaired result on the same source/criterion/plan.
  const left = attempt(); const right = attempt({ id: 'attempt:repair', execution: 'finished', verification: 'unverified' });
  // When/Then: only matching, consumed subjects are comparable.
  assert.equal(compareAttempts(left, right).comparable, true);
  for (const change of [{ criterion_version: 2 }, { plan_revision: 2 }, { source_revision: 'source:two' }, { consumed_plan_revision: null }, { source_revision: null }]) {
    assert.equal(compareAttempts(left, { ...right, ...change }).comparable, false);
  }
});

test('review approval is bound to the captured source and consumed once', () => {
  // Given: a queued review at the current subject.
  const value = input(); const subject = { criterion_version: 1, plan_revision: 1, source_revision: 'source:one', plan_sha256: 'a'.repeat(64), content_sha256: 'c'.repeat(64) };
  const apply = (operation, payload, id) => {
    const reduced = reduceCommand({ ...value, command: command(value, operation, payload, id) });
    value.state = reduced.state; value.revision = reduced.result.revision; return reduced;
  };
  apply('request_review', { review_id: 'review:one', criterion_id: 'C1', action: 'rerun_criterion', subject }, 'cmd:request');
  apply('resolve_review', { review_id: 'review:one', decision: 'approved', rationale: 'Reviewed this offline rerun', subject }, 'cmd:decision');
  // When: consuming the approved exact action.
  const consumed = apply('consume_review', { review_id: 'review:one', action: 'rerun_criterion', subject }, 'cmd:consume');
  // Then: it cannot authorize a second consumption and grants no verification.
  assert.equal(consumed.state.reviews[0].state, 'consumed');
  assert.equal(consumed.state.tasks[0].criteria[0].verification, 'unverified');
  assert.throws(() => apply('consume_review', { review_id: 'review:one', action: 'rerun_criterion', subject }, 'cmd:consume-again'), /REVIEW_NOT_APPROVED/);
});

for (const changed of ['source_revision', 'plan_digest', 'plan_revision', 'criterion']) test(`approval refuses changed ${changed}`, () => {
  // Given: a pending review bound to an earlier subject.
  const value = input(); const subject = { criterion_version: 1, plan_revision: 1, source_revision: 'source:one', plan_sha256: 'a'.repeat(64), content_sha256: 'c'.repeat(64) };
  const queued = reduceCommand({ ...value, command: command(value, 'request_review', { review_id: 'review:one', criterion_id: 'C1', action: 'rerun_criterion', subject }) });
  value.state = queued.state; value.revision = queued.result.revision;
  if (changed === 'criterion') value.state.tasks[0].criteria[0].version = 2;
  else value[changed] = changed === 'plan_revision' ? 2 : changed === 'plan_digest' ? 'b'.repeat(64) : 'source:two';
  // When/Then: a decision on the old subject fails closed.
  assert.throws(() => reduceCommand({ ...value, command: command(value, 'resolve_review', { review_id: 'review:one', decision: 'approved', rationale: 'Stale decision', subject }, 'cmd:stale') }), /STALE_REVIEW_SUBJECT/);
  assert.equal(projectSnapshot(value).reviews[0].current, false);
});

test('large verification lists keep every matching row reachable by bounded pages', () => {
  // Given: more criteria than fit in one page.
  const snapshot = { tasks: Array.from({ length: 71 }, (_, index) => ({ id: `T${index}`, title: `Task ${index}`, criteria: [{ ...criterion(), id: `C${index}` }] })) };
  // When: traversing pages and searching beyond the first page.
  const ids = [0, 25, 50].flatMap(offset => verificationRows(snapshot, { offset }).rows.map(row => row.criterion.id));
  // Then: no duplicates, omissions or truncation.
  assert.equal(new Set(ids).size, 71);
  assert.equal(verificationRows(snapshot, { query: 'C70' }).rows[0].criterion.id, 'C70');
});

test('cached replay stays isolated from returned snapshots and invalidates changed sources', () => {
  // Given: a repeated projection over a retained ledger.
  const value = observed(input()); const first = projectSnapshot(value);
  first.tasks[0].attempts[0].execution = 'finished'; first.tasks[0].criteria[0].requirement = 'External mutation';
  // When: replaying again, then changing the same source generation's content.
  const repeated = projectSnapshot(value);
  observed(value, attempt({ execution: 'finished', verification: 'unverified' })); const changed = projectSnapshot(value);
  // Then: the cache is private and a content change cannot reuse an old result.
  assert.equal(repeated.tasks[0].attempts[0].execution, 'failed');
  assert.equal(repeated.tasks[0].criteria[0].requirement, 'Preserve notes offline');
  assert.equal(changed.tasks[0].attempts[0].execution, 'finished');
});
