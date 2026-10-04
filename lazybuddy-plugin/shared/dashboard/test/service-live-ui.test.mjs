import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { serviceFixture, http } from './service-fixture.mjs';
import { capture, collectEvidenceReferences } from '../service-snapshot.mjs';

test('bundled live assets are explicit and unknown static paths stay unavailable', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await http(f.live.url, '/index.mjs')).status, 409, 'allowlisted route still fails closed when the selected root lacks its file');
    assert.equal((await f.request('/state.json')).status, 404);
  } finally { await f.cleanup(); }
});

test('trusted restart retains its observed port and never displaces a foreign listener', async () => {
  const f = await serviceFixture();
  try {
    const port = f.live.identity.port;
    assert.equal((await f.cli('start', ['--port', '0'])).code, 65);
    assert.equal((await f.cli('stop')).code, 0);
    await f.start(port); assert.equal(f.live.identity.port, port);
    assert.equal((await f.cli('start', ['--port', String(port + 1)])).code, 65);
    assert.equal((await f.cli('stop')).code, 0);
    const foreign = createServer((_request, response) => response.end('foreign'));
    await new Promise((resolve, reject) => { foreign.once('error', reject); foreign.listen(port, '127.0.0.1', resolve); });
    try {
      assert.equal((await f.cli('start', ['--port', String(port)])).code, 65);
      const body = await new Promise((resolve, reject) => request(`http://127.0.0.1:${port}`, response => { let value = ''; response.on('data', chunk => { value += chunk; }); response.on('end', () => resolve(value)); }).on('error', reject).end());
      assert.equal(body, 'foreign');
    } finally { await new Promise(resolve => foreign.close(resolve)); }
    await f.start(port);
  } finally { await f.cleanup(); }
});

test('trusted projected attempt evidence receives bounded opaque task-and-hash identities', () => {
  const input = { state: { tasks: [{ id: 'T', evidence: [] }], evidence_submissions: [] } };
  const evidence = { path: '.lazybuddy/runs/probe/artifact.txt', sha256: 'a'.repeat(64), provenance: 'actual process artifact' };
  const snapshot = { tasks: [{ id: 'T', attempts: [{ evidence: [evidence] }, { evidence: [evidence] }] },
    { id: 'other', attempts: [{ evidence: [evidence] }, { evidence: [{ ...evidence, path: '.lazybuddy/dashboard/credential' }] }] }] };
  const references = collectEvidenceReferences(input, snapshot, { projectId: 'project', runId: 'probe' });
  assert.equal(references.length, 3);
  assert.notEqual(references[0].id, references[1].id, 'task binding participates in opaque identity');
  assert.equal(references.find(item => item.path.endsWith('/credential')).unavailable_reason, 'PROTECTED_SERVICE_ARTIFACT');
  const large = { tasks: [{ id: 'T', attempts: [{ evidence: Array.from({ length: 257 }, (_, index) => ({ ...evidence, path: `proof/${index}` })) }] }] };
  assert.throws(() => collectEvidenceReferences(input, large, { projectId: 'project', runId: 'probe' }), /REFERENCE_LIMIT/);
});

test('cursor projection preserves the exact captured authority input identity', async () => {
  const input = { state: { tasks: [], evidence_submissions: [] }, editability: { supported: true, reason: null } };
  const cursor = { schema_version: 1, project_id: 'project', run_id: 'probe', revision: 1, state_sha256: 'state', queue_revision: 0, queue_sha256: 'queue', sources: [] };
  const snapshot = { schema_version: 1, project_id: 'project', run_id: 'probe', revision: 1, plan_revision: 1, queue_revision: 0, cursor,
    freshness: 'snapshot', capabilities: { embedding: 'unobserved', chat_handoff: 'unobserved', wake: 'unobserved', observations: 'available' },
    tasks: [], decisions: [], queue: [], acknowledgements: [], observations: [], issues: [], queue_readiness: [] };
  const authority = { read: async () => input, project: async value => { assert.equal(value, input); assert.equal(value.previous_cursor, cursor); return snapshot; } };
  const result = await capture({ authority, projectId: 'project', runId: 'probe' }, cursor);
  assert.deepEqual(result.snapshot, snapshot); assert.equal(result.cursor.length > 0, true);
});
