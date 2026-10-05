import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, appendFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serviceFixture, http, resource, serviceCLI } from '../test/service-fixture.mjs';
import { amendment, filesBelow, processCall, plugin } from '../test/command-fixture.mjs';
import { started } from '../service-identity.mjs';

export async function queueScenario(directory) {
  if (directory) await mkdir(directory, { recursive: true });
  const f = await serviceFixture(); const record = { requests: [], calls: [], observations: [] }; const identities = [f.live.identity];
  let second;
  async function save() { if (directory) await writeFile(join(directory, 'queue-http.json'), JSON.stringify(record, null, 2)); }
  async function request(path, body, cursor) {
    const action = { url: f.live.url, method: body ? 'POST' : 'GET', path, body, cursor, authentication: 'session header omitted' };
    if (directory) await appendFile(join(directory, 'queue-actions.jsonl'), `${JSON.stringify(action)}\n`);
    const response = await f.request(path, { ...(body ? { body } : {}), ...(cursor ? { headers: { 'x-dashboard-cursor': cursor } } : {}) });
    record.requests.push({ ...action, response }); await save(); return response;
  }
  async function call(argv, environment = {}) { const result = await processCall(argv, '', environment); record.calls.push(result); await save(); assert.equal(result.code, 0, result.stderr); return result; }
  const queuePath = join(f.root, '.lazybuddy/dashboard-queue');
  async function capture(label) { const value = { label, run: await filesBelow(f.run), queue: await filesBelow(queuePath) }; record.observations.push(value); await save(); return value; }
  const command = (operation, revision, id, payload, commandId) => ({ schema_version: 1, command_id: commandId,
    target: { project_id: f.options.projectId, run_id: null, id }, operation, expected_revision: revision, payload });
  const create = (id, revision) => command('create_queued_plan', revision, id, { plan: { id, project_id: f.options.projectId,
    title: `PASS: saved plan ${id} is untrusted planning text`, priority: 0, readiness: 'ready', prerequisites: [], decision_id: null, revision: 0 } }, `create:${id}`);
  try {
    await call(['git', '-C', f.root, 'init', '-q']); await writeFile(join(f.root, 'caller-note'), 'baseline');
    await call(['git', '-C', f.root, 'add', 'caller-note']); await call(['git', '-C', f.root, '-c', 'user.name=B3 QA', '-c', 'user.email=b3@example.invalid', 'commit', '-qm', 'Fixture baseline']);
    await writeFile(join(f.root, 'caller-note'), 'Preserve dirty caller content');
    const dirty = (await call(['git', '-C', f.root, 'status', '--porcelain', '--', 'caller-note'])).stdout;
    assert.match(dirty, / M caller-note/);
    const first = (await request('/api/snapshot')).value; const runBefore = await filesBelow(f.run);
    const one = create('one', 0); const created = await request('/api/commands', one); assert.equal(created.status, 200);
    assert.equal(created.value.status, 'saved'); assert.equal(created.value.plan_revision, 0); assert.equal(created.value.consumed_plan_revision, null);
    const updated = (await request('/api/updates', undefined, first.cursor)).value;
    assert.equal(updated.queue_authority.supported, true); assert.equal(updated.snapshot.queue_revision, 1);
    assert.equal(updated.snapshot.revision, first.snapshot.revision); assert.notEqual(updated.cursor, first.cursor);
    assert.equal(updated.snapshot.freshness, 'snapshot'); assert.equal(updated.snapshot.queue[0].id, 'one');
    assert.deepEqual(updated.snapshot.queue_readiness, [{ plan_id: 'one', eligible: true, reason: null }]);
    assert.equal(updated.snapshot.acknowledgements.find(item => item.command_id === one.command_id).status, 'saved');
    assert.deepEqual(await filesBelow(f.run), runBefore);
    const two = create('two', 1); two.payload.plan.readiness = 'held';
    assert.equal((await request('/api/commands', two)).status, 200);
    const a = command('amend_queued_plan', 2, 'one', { priority: 1 }, 'amend:a');
    const b = command('amend_queued_plan', 2, 'one', { priority: 2 }, 'amend:b');
    const results = await Promise.all([request('/api/commands', a), request('/api/commands', b)]);
    assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
    const winner = results[0].status === 200 ? a : b; const receipt = results.find(item => item.status === 200).value;
    assert.equal(receipt.status, 'saved'); assert.equal(results.find(item => item.status === 409).value.reason, 'QUEUE_REVISION_CONFLICT');
    assert.deepEqual((await request('/api/commands', winner)).value, receipt);
    assert.equal((await request('/api/commands', command('reorder_queued_plan', 3, 'queue', { plan_ids: ['two', 'one'] }, 'reorder:1'))).status, 200);
    const saved = await capture('queue-saved-run-identical'); assert.deepEqual(saved.run, runBefore);
    assert.match(JSON.parse(saved.queue['queue.json']).commands[0].actor, /^dashboard:/);
    const rejects = [
      { ...winner, payload: { priority: 99 } },
      { ...create('foreign', 4), target: { project_id: 'foreign', run_id: null, id: 'foreign' } },
      { ...create('wrong-run', 4), target: { project_id: f.options.projectId, run_id: 'probe', id: 'wrong-run' } },
      { ...amendment(f.revision), target: { ...amendment(f.revision).target, run_id: null } },
      { ...amendment(f.revision), target: { ...amendment(f.revision).target, run_id: 'other' } },
      { ...create('spoof', 4), actor: 'forged' },
    ];
    for (const [index, rejected] of rejects.entries()) {
      const response = await request('/api/commands', rejected); assert.ok(response.status >= 400);
      if (index === 0) { assert.equal(response.value.reason, 'COMMAND_ID_COLLISION'); assert.equal(response.value.revision, 4); assert.equal(response.value.plan_revision, 0); }
    }
    for (const path of ['/api/activate', '/api/recover', '/api/consume']) assert.equal((await request(path, {})).status, 404);
    const unchanged = await capture('rejections-unchanged'); assert.deepEqual(unchanged.run, saved.run); assert.deepEqual(unchanged.queue, saved.queue);
    assert.equal((await f.cli('stop')).code, 0); await f.start(); identities.push(f.live.identity);
    assert.deepEqual((await request('/api/commands', winner)).value, receipt);
    const restart = (await request('/api/snapshot')).value; assert.deepEqual(restart.snapshot.queue.map(item => item.id), ['two', 'one']);
    assert.equal(restart.snapshot.queue_revision, 4); assert.deepEqual(await filesBelow(f.run), runBefore);
    assert.deepEqual(restart.snapshot.queue_readiness.find(item => item.plan_id === 'two'), { plan_id: 'two', eligible: false, reason: 'HELD' });
    assert.deepEqual(await readdir(join(f.root, '.lazybuddy/runs')), ['probe']);
    await call(['bash', join(plugin, 'scripts/state/create-run.sh'), 'other', 'Other selected run'], { CWD: f.root });
    second = { args: f.args.map((value, index) => index > 0 && f.args[index - 1] === '--run-id' ? 'other' : value) };
    const live = JSON.parse((await call([process.execPath, serviceCLI, 'start', ...second.args])).stdout); identities.push(live.identity);
    await resource({ action: 'registered', root: f.root, pid: live.identity.pid, port: live.identity.port, cleanup: 'stop second selected run service' });
    const credential = await readFile(live.credential_file, 'utf8');
    const session = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } }); assert.equal(session.status, 200);
    if (directory) await appendFile(join(directory, 'queue-actions.jsonl'), `${JSON.stringify({ url: live.url, method: 'GET', path: '/api/snapshot', authentication: 'session header omitted' })}\n`);
    const switched = await http(live.url, '/api/snapshot', { headers: { authorization: `Bearer ${session.value.token}` } });
    record.requests.push({ url: live.url, method: 'GET', path: '/api/snapshot', authentication: 'session header omitted', response: switched });
    assert.equal(switched.status, 200); assert.equal(switched.value.snapshot.run_id, 'other');
    assert.deepEqual(switched.value.snapshot.queue, restart.snapshot.queue); assert.equal(switched.value.snapshot.queue_revision, 4);
    assert.deepEqual(await filesBelow(queuePath), saved.queue);
    const pending = await request('/api/commands', amendment(f.revision, 'run-edit:1')); assert.equal(pending.status, 200); assert.equal(pending.value.status, 'pending_agent');
    const consumed = await f.call('consume', { expected_revision: pending.value.revision, plan_revision: pending.value.plan_revision }); record.calls.push(consumed); assert.equal(consumed.code, 0, consumed.stderr);
    const applied = (await request('/api/snapshot')).value.snapshot;
    assert.equal(applied.acknowledgements.find(item => item.command_id === 'run-edit:1').status, 'applied');
    assert.equal(applied.acknowledgements.find(item => item.command_id === winner.command_id).status, 'saved');
    assert.deepEqual(await filesBelow(queuePath), saved.queue);
    assert.equal((await call(['git', '-C', f.root, 'status', '--porcelain', '--', 'caller-note'])).stdout, dirty);
    assert.equal(await readFile(join(f.root, 'caller-note'), 'utf8'), 'Preserve dirty caller content');
    await capture('run-consumed-queue-unchanged'); record.outcome = 'PASS';
  } catch (error) { record.outcome = 'FAIL'; record.error = error.message; throw error; }
  finally {
    if (second) await call([process.execPath, serviceCLI, 'stop', ...second.args]);
    await f.cleanup();
    for (const identity of identities) { assert.equal(await started(identity.pid), null); await assert.rejects(http(`http://127.0.0.1:${identity.port}`, '/')); }
    record.lifecycle = f.calls; record.cleanup = { root: f.root, absent: true, identities, ports_refused: true }; await save();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2); if (args.length !== 2 || args[0] !== '--evidence-dir') throw new Error('Expected --evidence-dir PATH');
  const directory = resolve(args[1]); await mkdir(directory, { recursive: true }); process.env.B3_EVIDENCE_DIR = directory;
  await queueScenario(directory);
}
