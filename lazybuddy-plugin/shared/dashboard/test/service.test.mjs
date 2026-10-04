import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, mkdir, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { request, createServer } from 'node:http';
import { serviceFixture, http } from './service-fixture.mjs';
import { amendment, filesBelow, processCall } from './command-fixture.mjs';
import { encodeCursor } from '../service-snapshot.mjs';
import { sign, started } from '../service-identity.mjs';
import './service-adversarial-cases.mjs';

test('authenticated typed HTTP authority: exact binding, actor, CAS, collision, restart and static allowlist', async () => {
  const f = await serviceFixture();
  try {
    const snapshot = await f.request('/api/snapshot'); assert.equal(snapshot.status, 200);
    assert.equal(snapshot.value.queue_authority.supported, false); assert.equal(snapshot.value.editability.supported, true);
    assert.match((await http(f.live.url, '/')).value, /temporary QA asset/);
    const before = await filesBelow(f.run);
    for (const response of [await http(f.live.url, '/api/snapshot'), await http(f.live.url, '/api/updates'),
      await http(f.live.url, '/api/snapshot?token=wrong'), await f.request('/api/snapshot', { headers: { origin: 'null' } }),
      await f.request('/api/snapshot', { headers: { origin: 'https://hostile.example' } }),
      await f.request('/api/snapshot', { headers: { host: 'localhost:1' } }),
      await f.request('/api/snapshot', { headers: { authorization: 'Bearer wrong' } }),
      await f.request('/api/commands', { body: { ...amendment(f.revision), actor: 'forged' } }),
      await f.request('/api/commands', { body: { ...amendment(f.revision), target: { project_id: 'foreign', run_id: 'probe', id: 'T1' } } }),
      await f.request('/api/commands', { body: { ...amendment(f.revision), operation: 'shell' } })]) assert.ok(response.status >= 400, JSON.stringify(response));
    assert.deepEqual(await filesBelow(f.run), before);
    const command = amendment(f.revision); const responses = await Promise.all([f.request('/api/commands', { body: command }), f.request('/api/commands', { body: amendment(f.revision, 'competitor') })]);
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 409]);
    const accepted = responses[0].status === 200 ? command : amendment(f.revision, 'competitor');
    const result = responses.find(item => item.status === 200).value;
    assert.equal(result.status, 'pending_agent');
    const persisted = await filesBelow(f.run);
    const state = JSON.parse(persisted['state.json']); assert.match(state.dashboard_commands[0].actor, /^dashboard:/);
    const collision = await f.request('/api/commands', { body: { ...accepted, payload: { ...accepted.payload, requirement: 'collision' } } });
    assert.equal(collision.status, 422); assert.equal(collision.value.reason, 'COMMAND_ID_COLLISION'); assert.equal(collision.value.revision, result.revision);
    assert.deepEqual(await filesBelow(f.run), persisted);
    assert.deepEqual((await f.request('/api/commands', { body: accepted })).value, result);
    assert.equal((await f.cli('stop')).code, 0); await f.start();
    assert.deepEqual((await f.request('/api/commands', { body: accepted })).value, result);
    assert.deepEqual(await filesBelow(f.run), persisted);
    assert.equal((await f.request('/state.json')).status, 404);
    assert.equal((await f.request('/api/evidence/%2e%2e%2fsecret')).status, 400);
  } finally { await f.cleanup(); }
});

test('poll cursor reconstructs revisions, gaps, foreign binding, changed state, rotation and corrupt tails', async () => {
  const f = await serviceFixture();
  try {
    const first = (await f.request('/api/snapshot')).value;
    assert.equal((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': first.cursor } })).value.snapshot.freshness, 'snapshot');
    const foreign = { ...first.snapshot.cursor, project_id: 'foreign' };
    assert.equal((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': encodeCursor(foreign) } })).value.snapshot.freshness, 'resync_required');
    assert.equal((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': 'x'.repeat(5000) } })).status, 409);
    const path = join(f.run, 'state.json'); const original = await readFile(path, 'utf8'); const state = JSON.parse(original); state.tasks[0].scope = 'dirty caller state';
    await writeFile(path, JSON.stringify(state));
    assert.equal((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': first.cursor } })).value.snapshot.freshness, 'resync_required');
    await writeFile(path, original);
    await f.request('/api/commands', { body: amendment(f.revision) });
    const second = (await f.request('/api/snapshot')).value;
    await f.request('/api/commands', { body: { ...amendment(second.snapshot.revision, 'priority'), operation: 'amend_task', payload: { priority: 2 } } });
    assert.ok((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': first.cursor } })).value.snapshot.issues.some(item => item.code === 'REVISION_GAP'));
    await writeFile(join(f.run, 'canonical-events.jsonl'), '');
    assert.ok((await f.request('/api/updates', { headers: { 'x-dashboard-cursor': second.cursor } })).value.snapshot.issues.some(item => item.code === 'SOURCE_ROTATED'));
    await writeFile(join(f.run, 'canonical-events.jsonl'), '{"unfinished":');
    assert.equal((await f.request('/api/snapshot')).value.snapshot.freshness, 'resync_required');
  } finally { await f.cleanup(); }
});

test('scoped evidence refuses links, FIFO, traversal, replaced bytes; external plan remains read-only', async () => {
  const f = await serviceFixture();
  try {
    const snapshot = (await f.request('/api/snapshot')).value; const id = snapshot.evidence[0].id;
    assert.equal((await f.request(`/api/evidence/${id}`)).value, 'Original artifact\n');
    await unlink(join(f.root, 'proof.txt')); await symlink('/etc/passwd', join(f.root, 'proof.txt'));
    assert.equal((await f.request(`/api/evidence/${id}`)).status, 409); await unlink(join(f.root, 'proof.txt'));
    assert.equal((await processCall(['mkfifo', join(f.root, 'proof.txt')])).code, 0);
    assert.equal((await f.request(`/api/evidence/${id}`)).status, 409); await unlink(join(f.root, 'proof.txt'));
    await mkdir(join(f.root, 'safe')); await writeFile(join(f.root, 'safe/proof'), 'inside');
    const path = join(f.run, 'state.json'); const state = JSON.parse(await readFile(path));
    state.tasks[0].evidence = ['alias/passwd', '../passwd', '/etc/passwd']; await symlink('/etc', join(f.root, 'alias')); await writeFile(path, JSON.stringify(state));
    for (const reference of (await f.request('/api/snapshot')).value.evidence.filter(item => item.task_id === 'T1')) assert.equal((await f.request(`/api/evidence/${reference.id}`)).status, 409);
    state.plan_reference = 'caller-plan.md'; await writeFile(join(f.root, 'caller-plan.md'), 'caller owned'); await writeFile(path, JSON.stringify(state));
    assert.equal((await f.request('/api/snapshot')).value.editability.reason, 'EXTERNAL_PLAN_READ_ONLY');
    const before = await filesBelow(f.run); assert.equal((await f.request('/api/commands', { body: amendment(f.revision) })).status, 422);
    assert.deepEqual(await filesBelow(f.run), before); assert.equal(await readFile(join(f.root, 'caller-plan.md'), 'utf8'), 'caller owned');
  } finally { await f.cleanup(); }
});

test('owned receipt challenge, concurrent start, repeated stop and unrelated listener protection', async () => {
  const f = await serviceFixture(); const sentinel = createServer((_req, response) => response.end('sentinel'));
  await new Promise(resolve => sentinel.listen(0, '127.0.0.1', resolve));
  try {
    const original = await readFile(f.receiptPath(), 'utf8'); const receipt = JSON.parse(original);
    receipt.identity.pid = process.pid; receipt.identity.started = await started(process.pid); receipt.identity.port = sentinel.address().port;
    await writeFile(f.receiptPath(), JSON.stringify(receipt)); assert.equal((await f.cli('stop')).code, 65);
    const credential = await readFile(f.live.credential_file, 'utf8'); receipt.signature = sign(credential, receipt.identity);
    await writeFile(f.receiptPath(), JSON.stringify(receipt)); assert.equal((await f.cli('stop')).code, 65);
    assert.equal((await http(`http://127.0.0.1:${sentinel.address().port}`, '/')).value, 'sentinel');
    await writeFile(f.receiptPath(), original);
    const starts = await Promise.all([f.cli('start'), f.cli('start')]); assert.ok(starts.some(item => item.code === 0));
    for (const item of starts.filter(item => item.code === 0)) assert.equal(JSON.parse(item.stdout).identity.pid, f.live.identity.pid);
    assert.equal((await f.cli('stop')).code, 0); assert.equal((await f.cli('stop')).code, 0); await f.start();
    await chmod(f.live.credential_file, 0o644); assert.equal((await f.cli('status')).code, 65); await chmod(f.live.credential_file, 0o600);
  } finally { await new Promise(resolve => sentinel.close(resolve)); await f.cleanup(); }
});

test('chunked and slow bodies are bounded before authority writes', async () => {
  const f = await serviceFixture();
  function raw(slow) {
    return new Promise((resolve, reject) => {
      const req = request(`${f.live.url}/api/commands`, { method: 'POST', headers: { origin: f.live.url, authorization: f.live.authorization, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); }); });
      req.on('error', reject); req.write(slow ? '{' : 'x'.repeat(70000)); if (!slow) req.end();
    });
  }
  try {
    const before = await filesBelow(f.run); assert.equal(await raw(false), 413); assert.equal(await raw(true), 408);
    assert.deepEqual(await filesBelow(f.run), before); assert.equal((await f.request('/api/snapshot')).status, 200);
  } finally { await f.cleanup(); }
});
