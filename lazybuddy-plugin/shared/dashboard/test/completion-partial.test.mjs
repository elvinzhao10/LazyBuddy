import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { completionFixture } from './completion-fixture.mjs';
import { readBuddyCompletion } from '../adapters/completion.mjs';
import { projectSnapshot } from '../projection.mjs';

function partialFixture() {
  const f = completionFixture();
  const authority = JSON.parse(fs.readFileSync(path.join(f.root, '.lazybuddy/authority.json')));
  authority.criteria.push({ ...authority.criteria[0], criterion_id: 'c2', status: 'pending' });
  f.write('.lazybuddy/authority.json', authority);
  const input = { project_id: 'partial', run_id: 'run-1', revision: 1, plan_revision: 1,
    source_revision: f.head, plan_digest: f.plan_digest, sources: [],
    state: { schema_version: 2, run_id: 'run-1', tasks: [{ id: 'task-1', status: 'done', criteria: ['c1', 'c2'].map(id => ({
      id, task_id: 'task-1', version: 1, requirement: id, applicability: 'required', verification: 'unverified',
      scenarios: [], result_ids: [], history: [],
    })) }] } };
  return { ...f, authority, input };
}
const project = (f, input) => projectSnapshot(input, readBuddyCompletion(input, f.options)).tasks[0];
test('an independently validated criterion remains verified while another required criterion is pending', async () => {
  // Given: one valid receipt and a pending sibling in the same private capture.
  const f = partialFixture();
  try {
    const input = await f.capture(f.input);
    // When: projecting the partially complete run.
    const task = project(f, input);
    // Then: criterion progress is independent of whole-run readiness.
    assert.equal(readBuddyCompletion(input, f.options).status, 'blocked');
    assert.deepEqual(task.criteria.map(item => item.verification), ['verified', 'unverified']);
    assert.equal(task.progress.verified, 1); assert.equal(task.progress.total, 2); assert.equal(task.verification, 'unverified');
  } finally { f.cleanup(); }
});
for (const [name, mutate] of [
  ['missing receipt', f => fs.unlinkSync(path.join(f.root, '.lazybuddy/receipt.json'))],
  ['malformed receipt', f => f.write('.lazybuddy/receipt.json', '{')],
  ['failed receipt', f => f.write('.lazybuddy/receipt.json', { ...f.receipt, exit_code: 9 })],
  ['stale receipt', f => f.write('.lazybuddy/receipt.json', { ...f.receipt, repo_head: '0'.repeat(40) })],
  ['wrong task receipt', f => f.write('.lazybuddy/receipt.json', { ...f.receipt, task_id: 'other' })],
  ['tampered artifact', f => f.write('.lazybuddy/artifact.txt', 'replacement')],
  ['missing review', f => fs.unlinkSync(path.join(f.root, '.lazybuddy/review.json'))],
  ['tampered review', f => f.write('.lazybuddy/review.json', { verdict: 'approved', verifier: { identity: 'other' } })],
  ['self review', f => f.write('.lazybuddy/receipt.json', { ...f.receipt, executor: f.receipt.verifier })],
  ['dirty worktree', f => f.write('dirty.txt', 'modified')],
  ['changed plan', f => f.write('.lazybuddy/plan.md', 'new plan')],
  ['changed source', f => f.write('.lazybuddy/authority.json', { ...f.authority, repo_head: '0'.repeat(40) })],
  ['changed package', f => f.write('.lazybuddy/authority.json', { ...f.authority, package_version: '0.0.0' })],
  ['changed criterion version', f => { f.input.state.tasks[0].criteria[0].version = 2; }],
  ['wrong authority run', f => f.write('.lazybuddy/authority.json', { ...f.authority, run_id: 'other' })],
]) test(`partial completion with ${name} withholds verification`, async () => {
  // Given: a pending sibling and one invalid candidate proof.
  const f = partialFixture();
  try {
    mutate(f); const input = await f.capture(f.input);
    // When/Then: the captured projection cannot promote that candidate.
    assert.equal(project(f, input).progress.verified, 0);
  } finally { f.cleanup(); }
});
for (const execution of ['running', 'cancelled', 'failed']) test(`partial proof cannot promote a current ${execution} attempt`, async () => {
  // Given: valid historical receipt plus an explicit nonfinished current attempt.
  const f = partialFixture();
  try {
    f.input.sources = [{ kind: 'runtime', text: JSON.stringify({ schema_version: 1, event_id: 'attempt', run_id: 'run-1',
      ts: '2026-10-04T10:00:00Z', event: 'attempt_result', event_payload: {
        id: 'attempt', task_id: 'task-1', criterion_id: 'c1', criterion_version: 1, plan_revision: 1,
        consumed_plan_revision: null, worker_id: null, parent_task_id: null, source_revision: f.head,
        execution, verification: 'unverified', started_at: null, finished_at: null, evidence: [],
      } }) + '\n' }];
    // When/Then: current execution still excludes verification.
    assert.equal(project(f, await f.capture(f.input)).progress.verified, 0);
  } finally { f.cleanup(); }
});
test('partial captured proof remains private and bound after cloning or mutation', async () => {
  // Given: a proof issued for the exact captured partial input.
  const f = partialFixture();
  try {
    const input = await f.capture(f.input); const proof = readBuddyCompletion(input, f.options);
    // When/Then: cloned inputs and a mutated source cannot reuse or obtain proof.
    for (const copy of [structuredClone(input), { ...input }]) {
      assert.equal(projectSnapshot(copy, proof).tasks[0].progress.verified, 0);
      assert.equal(project(f, copy).progress.verified, 0);
    }
    input.state.tasks[0].criteria[0].version += 1;
    assert.equal(projectSnapshot(input, proof).tasks[0].progress.verified, 0);
    assert.equal(project(f, input).progress.verified, 0);
  } finally { f.cleanup(); }
});
test('duplicate authority IDs cannot borrow a different task criterion version', async () => {
  // Given: another authority task uses the same ID at a different version.
  const f = partialFixture();
  try {
    const other = { ...f.authority.criteria[0], task_id: 'task-2', criterion_version: 2, evidence_path: '.lazybuddy/other-receipt.json' };
    f.authority.criteria.unshift(other); f.write('.lazybuddy/authority.json', f.authority);
    f.write(other.evidence_path, { ...f.receipt, task_id: 'task-2' });
    // When: projecting the task with the matching validated receipt.
    const task = project(f, await f.capture(f.input));
    // Then: lookup uses that task's version even when another authority entry is first.
    assert.equal(task.progress.verified, 1);
  } finally { f.cleanup(); }
});
