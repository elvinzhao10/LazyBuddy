import assert from 'node:assert/strict';
import test from 'node:test';
import { layeredDAGLayout, GraphLayoutError } from '../ui/graph-layout.mjs';
import { deriveWorkSummary } from '../ui/work-view.mjs';
import { projectSnapshot } from '../projection.mjs';

const tasks = [
  { id: 'setup', depends_on: [] },
  { id: 'install', depends_on: ['setup'] },
  { id: 'remove', depends_on: ['setup'] },
  { id: 'join', depends_on: ['install', 'remove'] },
];

test('layered DAG positions are deterministic and joins follow every prerequisite', () => {
  const first = layeredDAGLayout(tasks);
  const second = layeredDAGLayout([...tasks].reverse());
  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.edges.map(edge => edge.id), ['install->join', 'remove->join', 'setup->install', 'setup->remove']);
  const byId = new Map(first.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('setup').layer, 0);
  assert.equal(byId.get('install').layer, 1);
  assert.equal(byId.get('remove').layer, 1);
  assert.equal(byId.get('join').layer, 2);
});

test('layout honors local drag positions without changing dependency data', () => {
  const original = structuredClone(tasks);
  const actual = layeredDAGLayout(tasks, { remove: { x: 420, y: 360 } });
  assert.deepEqual(tasks, original);
  assert.deepEqual(actual.nodes.find(node => node.id === 'remove'), { id: 'remove', layer: 1, x: 420, y: 360, width: 224, height: 232 });
});

for (const [name, fixture, code] of [
  ['unknown dependency', [{ id: 'task', depends_on: ['missing'] }], 'UNKNOWN_DEPENDENCY'],
  ['cycle', [{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }], 'DEPENDENCY_CYCLE'],
]) test(`layout rejects ${name}`, () => {
  assert.throws(() => layeredDAGLayout(fixture), error => error instanceof GraphLayoutError && error.code === code);
});

function projectedSnapshot() {
  const criterion = { id: 'criterion:remove', task_id: 'remove', version: 2, requirement: 'Preserve caller files', applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [] };
  const staleCriterion = { ...criterion, id: 'criterion:proof', task_id: 'proof', requirement: 'Retain applicable proof', verification: 'stale' };
  const state = { schema_version: 2, run_id: 'run:ui', decisions: [{ id: 'decision:1', title: 'Choose policy', choice: null, rationale: 'A decision is required.', scope: ['remove'], alternatives: [], reference: null, state: 'proposed', supersedes: null, revision: 1 }], tasks: [
    { id: 'setup', title: 'Setup', status: 'done', depends_on: [] },
    { id: 'install', title: 'Install', status: 'running', depends_on: ['setup'] },
    { id: 'remove', title: 'Remove', status: 'failed', depends_on: ['setup'], priority: 3, criteria: [criterion] },
    { id: 'proof', title: 'Proof', status: 'done', depends_on: ['setup'], criteria: [staleCriterion] },
    { id: 'join', title: 'Join', status: 'blocked', blocker: 'Waiting for removal evidence.', depends_on: ['install', 'remove'] },
  ] };
  return projectSnapshot({ project_id: 'project:ui', run_id: 'run:ui', revision: 4, plan_revision: 2, state, sources: [], queue_revision: 2,
    queue: [
      { id: 'plan:1', project_id: 'project:ui', title: 'First', priority: 3, readiness: 'ready', prerequisites: [], decision_id: null, revision: 2 },
      { id: 'plan:2', project_id: 'project:ui', title: 'Second', priority: 2, readiness: 'held', prerequisites: [], decision_id: null, revision: 2 },
      { id: 'plan:3', project_id: 'project:ui', title: 'Third', priority: 1, readiness: 'draft', prerequisites: [], decision_id: null, revision: 2 },
      { id: 'plan:4', project_id: 'project:ui', title: 'Fourth', priority: 0, readiness: 'draft', prerequisites: [], decision_id: null, revision: 2 },
    ] });
}

test('work summary uses projected observations and bounds attention and queue', () => {
  const summary = deriveWorkSummary(projectedSnapshot());
  assert.equal(summary.now, 'Install');
  assert.equal(summary.runningCount, 1);
  assert.equal(summary.attention.length, 3);
  assert.equal(summary.attentionRemaining, 1);
  assert.deepEqual(summary.queue.map(plan => plan.id), ['plan:1', 'plan:2', 'plan:3']);
  assert.equal(deriveWorkSummary(projectedSnapshot(), 'disconnected').now, 'Last observed: Install');
});
