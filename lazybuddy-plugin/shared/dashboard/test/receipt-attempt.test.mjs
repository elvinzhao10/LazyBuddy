import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSnapshot } from '../projection.mjs';
import { readBuddyCompletion } from '../adapters/completion.mjs';
import { completionFixture } from './completion-fixture.mjs';
const cases = [
  ['cancelled current attempt', [{ execution: 'cancelled' }], 0],
  ['running current attempt claiming pass', [{ execution: 'running' }], 0],
  ['not started current attempt', [{ execution: 'not_started' }], 0],
  ['finished applicable attempt', [{ execution: 'finished' }], 1],
  ['legacy receipt without attempt', [], 1],
  ['finished retry after cancellation', [{ execution: 'cancelled' }, { execution: 'finished' }], 1],
  ['running retry after finish', [{ execution: 'finished' }, { execution: 'running' }], 0],
  ['cancelled retry after finish', [{ execution: 'finished' }, { execution: 'cancelled' }], 0],
  ['historical cancellation after current finish', [{ execution: 'finished' }, { execution: 'cancelled', plan_revision: 0 }], 1],
  ['historical finish after current cancellation', [{ execution: 'cancelled' }, { execution: 'finished', plan_revision: 0 }], 0],
  ['latest update of earlier running attempt', [{ id: 'earlier', execution: 'running' }, { execution: 'finished' }, { id: 'earlier', execution: 'cancelled' }], 0],
];
for (const [name, changes, expected] of cases) test(`applicable receipt respects ${name}`, () => {
  // Given: valid assessed on-disk authority plus explicit attempt observations.
  const fixture = completionFixture();
  try {
    const criterion = { id: 'c1', task_id: 'task-1', version: 1, requirement: 'Produce artifact', applicability: 'required',
      verification: 'unverified', scenarios: [], result_ids: [], history: [] };
    const records = changes.map((change, index) => ({ schema_version: 1, event_id: `event:${index}`, run_id: 'run-1',
      ts: '2026-10-04T10:00:00Z', event: 'attempt_result', event_payload: {
        id: `attempt:${index}`, task_id: 'task-1', criterion_id: 'c1', criterion_version: 1, plan_revision: 1,
        consumed_plan_revision: null, worker_id: null, parent_task_id: null, source_revision: fixture.head,
        execution: 'finished', verification: 'verified', started_at: null, finished_at: null, evidence: [], ...change } }));
    const input = { project_id: 'project:repair', run_id: 'run-1', revision: 3, plan_revision: 1,
      source_revision: fixture.head, plan_digest: fixture.plan_digest,
      state: { schema_version: 2, run_id: 'run-1', tasks: [{ id: 'task-1', status: 'done', criteria: [criterion] }] },
      sources: [{ kind: 'runtime', id: 'runtime', generation: '1', text: records.map(item => JSON.stringify(item) + '\n').join('') }] };
    const proof = readBuddyCompletion(fixture.root, fixture.options); assert.equal(proof.status, 'ready');
    // When: reducing the actual applicable receipt with the observed attempt history.
    const task = projectSnapshot(input, proof).tasks[0];
    // Then: only finished current applicable work (or legacy no-attempt) can verify.
    assert.equal(task.progress.verified, expected); assert.equal(task.verification === 'verified', expected === 1);
    assert.equal(task.attempts.length, new Set(records.map(item => item.event_payload.id)).size);
    for (const attempt of task.attempts) {
      const latest = records.filter(item => item.event_payload.id === attempt.id).at(-1).event_payload;
      assert.equal(attempt.execution, latest.execution);
    }
  } finally { fixture.cleanup(); }
});
