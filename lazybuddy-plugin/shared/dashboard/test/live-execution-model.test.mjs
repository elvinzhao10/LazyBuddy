import test from 'node:test';
import assert from 'node:assert/strict';
import { liveExecutionProjection } from '../ui/live-execution-model.mjs';

const attempt = (id, execution, verification, started, finished, worker = 'worker:one') => ({
  id, task_id: 'T1', criterion_id: 'C1', criterion_version: 1, plan_revision: 2,
  consumed_plan_revision: 2, worker_id: worker, parent_task_id: null, source_revision: 'source:2',
  execution, verification, started_at: started, finished_at: finished, evidence: [],
  provenance: { source_id: 'native', generation: 'g1', source_event_id: `event:${id}`, line: 1,
    kind: 'runtime', timestamp: finished ?? started },
});

const snapshot = {
  schema_version: 1, project_id: 'project:live', run_id: 'run:bound', revision: 8, plan_revision: 2,
  tasks: [
    { id: 'T0', title: 'Prepare', scope: 'Prepare the native fixture', priority: 0, depends_on: [],
      execution: 'finished', verification: 'verified', blocker: null, criteria: [], attempts: [], progress: {} },
    { id: 'T1', title: 'Execute', scope: 'Run and verify the bounded task', priority: 1, depends_on: ['T0'],
      execution: 'running', verification: 'verifying', blocker: null, criteria: [{ id: 'C1' }], attempts: [
        attempt('attempt:failed', 'failed', 'failed', '2026-10-10T12:00:00.000Z', '2026-10-10T12:00:02.000Z'),
        attempt('attempt:retry', 'running', 'verifying', '2026-10-10T12:00:03.000Z', null),
        attempt('attempt:no-worker', 'finished', 'unverified', '2026-10-10T12:00:04.000Z', '2026-10-10T12:00:05.000Z', null),
      ], progress: {} },
  ],
};

test('bound native snapshot projects task dependencies and timestamped attempts without invented layers', () => {
  const run = liveExecutionProjection(snapshot, { asOf: '2026-10-10T12:00:06.000Z' });
  assert.equal(run.document.level, 'batch');
  assert.deepEqual(run.document.nodes.map(node => node.id), ['T0', 'T1']);
  assert.deepEqual(run.document.edges, [{ from: 'T0', to: 'T1', kind: 'dependency', label: 'Recorded native task dependency' }]);
  assert.equal(run.document.nodes[0].drill, null, 'a task without attempts offers no fabricated deeper layer');
  assert.equal(run.document.nodes[1].drill, 'T1');
  assert.equal(run.timeline.intervals.length, 2, 'the attempt without a worker identity is omitted only from the timeline');
  assert.equal(run.timeline.omitted, 1);
  assert.deepEqual(run.timeline.retryChains, [], 'attempt ordering never fabricates a retry relationship');
  assert.equal(run.timeline.intervals.find(entry => entry.attemptId === 'attempt:retry').state, 'executing');

  const task = liveExecutionProjection(snapshot, { taskId: 'T1', asOf: '2026-10-10T12:00:06.000Z' });
  assert.equal(task.document.level, 'task');
  assert.deepEqual(task.document.nodes.map(node => node.id), ['attempt:failed', 'attempt:retry', 'attempt:no-worker']);
  assert.match(task.document.statusSentence.text, /Retry relationships remain unavailable/);
  assert.equal(task.document.nodes.find(node => node.id === 'attempt:failed').execution.state, 'failed');
  assert.equal(task.document.nodes.find(node => node.id === 'attempt:retry').verification.state, 'active');
  assert.match(task.document.nodes.find(node => node.id === 'attempt:no-worker').summary, /not reported/);
});
