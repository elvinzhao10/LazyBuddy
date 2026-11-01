import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serviceFixture } from './service-fixture.mjs';
import { amendment, filesBelow } from './command-fixture.mjs';
import { queryCheckpointHistory } from '../ui/checkpoint-history.mjs';

test('authenticated history comparison reads retained plan changes without creating verification', async () => {
  // Given: a native run with a committed criterion amendment.
  const f = await serviceFixture();
  try {
    const saved = await f.request('/api/commands', { body: amendment(f.revision) }); assert.equal(saved.status, 200);
    const before = await filesBelow(f.run);
    // When: querying and comparing the immutable checkpoint with current state.
    const index = await f.request('/api/history/query', { body: { operation: 'index', offset: 0, limit: 25 } });
    assert.equal(index.status, 200); assert.equal(index.value.total, 1);
    const compared = await f.request('/api/history/query', { body: { operation: 'compare', before: index.value.entries[0].id, after: null } });
    // Then: exact before/after requirements are observable and the route writes nothing.
    assert.equal(compared.status, 200);
    const change = compared.value.comparison.tasks.find(item => item.id === 'T1');
    assert.equal(change.before.criteria[0].requirement, 'Original requirement');
    assert.equal(change.after.criteria[0].requirement, 'New requirement');
    assert.equal(compared.value.comparison.verification_authority, 'none');
    assert.deepEqual(await filesBelow(f.run), before);
    const noAuth = await f.request('/api/history/query', { body: { operation: 'index', offset: 0, limit: 25 }, headers: { authorization: 'Bearer invalid' } });
    assert.equal(noAuth.status, 401);
    const malformed = await f.request('/api/history/query', { body: { operation: 'compare', before: '../../state.json', after: null } });
    assert.equal(malformed.status, 422);
    const state = JSON.parse(await readFile(join(f.run, 'state.json')));
    assert.equal(state.tasks[0].criteria[0].verification, 'unverified');
  } finally { await f.cleanup(); }
});

test('checkpoint pagination reaches history beyond the first page', async () => {
  // Given: more than two pages of retained command checkpoints.
  const input = { revision: 60, state: { run_id: 'run', plan_revision: 1, tasks: [], dashboard_commands: Array.from({ length: 60 }, (_, index) => ({
    command: { command_id: `command:${index}`, operation: 'amend_task' }, result: { revision: index + 1 } })) } };
  // When: traversing each page.
  const pages = await Promise.all([0, 25, 50].map(offset => queryCheckpointHistory(input, { operation: 'index', offset, limit: 25 })));
  // Then: each retained checkpoint appears once.
  const ids = pages.flatMap(page => page.entries.map(entry => entry.id));
  assert.equal(new Set(ids).size, 60); assert.equal(ids.at(-1), 1);
});
