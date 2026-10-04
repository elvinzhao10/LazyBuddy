import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboardConnection, DashboardRequestError } from '../ui/connection.mjs';
import { dependencyImpact, planningCommand } from '../ui/editing.mjs';

const snapshot = { project_id: 'project:live', run_id: 'run-live', revision: 7, queue_revision: 3, tasks: [
  { id: 'A', depends_on: [] }, { id: 'B', depends_on: ['A'] }, { id: 'C', depends_on: ['B'] }, { id: 'D', depends_on: ['A'] },
] };

test('connection sends bootstrap only as a header and bearer only after session creation', async () => {
  const calls = [];
  const fetchImpl = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/session') return new Response(JSON.stringify({ token: 'b'.repeat(64), expires_at: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/api/evidence/')) return new Response('proof bytes', { status: 200 });
    return new Response(JSON.stringify({ snapshot, cursor: 'cursor', evidence: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const connection = createDashboardConnection({ fetchImpl }); const key = 'a'.repeat(64);
  await connection.connect(key); await connection.snapshot(); const blob = await connection.evidence(`/api/evidence/${'c'.repeat(64)}`); assert.equal(await blob.text(), 'proof bytes');
  assert.equal(calls[0].path, '/api/session'); assert.equal(calls[0].options.headers['x-dashboard-bootstrap'], key);
  assert.equal(calls[0].options.body, '{}'); assert.equal(JSON.stringify(calls).includes(`?${key}`), false);
  assert.equal(calls[1].options.headers.authorization, `Bearer ${'b'.repeat(64)}`);
  assert.equal(calls[1].options.headers['x-dashboard-bootstrap'], undefined);
  assert.equal(calls[2].options.headers.authorization, `Bearer ${'b'.repeat(64)}`);
  connection.disconnect(); await assert.rejects(connection.snapshot(), error => error instanceof DashboardRequestError && error.message === 'NOT_CONNECTED');
});

test('dependency preview rejects unknown IDs and cycles and reports affected descendants', () => {
  assert.deepEqual(dependencyImpact(snapshot, 'B', 'missing'), { valid: false, reason: 'Unknown task ID.', affected: [] });
  assert.deepEqual(dependencyImpact(snapshot, 'A', 'C'), { valid: false, reason: 'Dependency would create a cycle.', affected: [] });
  assert.deepEqual(dependencyImpact(snapshot, 'D', 'B'), { valid: true, reason: 'Dependency is valid.', affected: ['D'] });
  assert.deepEqual(dependencyImpact(snapshot, 'B', 'A', 'remove'), { valid: true, reason: 'Dependency can be removed.', affected: ['B', 'C'] });
});

test('planning commands bind run and queue revisions without execution operations', () => {
  const priority = planningCommand(snapshot, 'B', 'amend_task', { priority: 4 }, 'edit-priority');
  assert.deepEqual(priority.target, { project_id: 'project:live', run_id: 'run-live', id: 'B' }); assert.equal(priority.expected_revision, 7);
  const queue = planningCommand(snapshot, 'queue', 'reorder_queued_plan', { plan_ids: [] }, 'edit-queue');
  assert.deepEqual(queue.target, { project_id: 'project:live', run_id: null, id: 'queue' }); assert.equal(queue.expected_revision, 3);
  assert.ok(!['execute', 'verify', 'dispatch', 'shell'].includes(priority.operation));
});

test('committed asset manifest is the explicit service allowlist', async () => {
  const manifest = JSON.parse(await readFile(new URL('../ui/asset-manifest.json', import.meta.url)));
  const routes = manifest.assets.map(item => item.route);
  assert.equal(new Set(routes).size, routes.length);
  for (const route of ['/', '/index.mjs', '/connection.mjs', '/editing.mjs', '/live.css', '/work-view.mjs']) assert.ok(routes.includes(route));
  for (const item of manifest.assets) {
    assert.match(item.route, /^\/[A-Za-z0-9./-]*$/); assert.match(item.file, /^[A-Za-z0-9.-]+$/);
    assert.ok(['text/html', 'text/css', 'text/javascript'].includes(item.type));
  }
});
