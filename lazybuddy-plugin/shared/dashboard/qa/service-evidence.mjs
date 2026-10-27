import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, link, lstat, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture, amendment, filesBelow, processCall } from '../test/command-fixture.mjs';
import { serviceFixture, resource, http } from '../test/service-fixture.mjs';
import { started } from '../service-identity.mjs';

const canary = 'Harmless B3-R1 synthetic artifact; not a credential.\n';
const reserved = '.lazybuddy/dashboard/synthetic-qa/canary.txt';
function attachment(revision, path, id) {
  return { ...amendment(revision, id), operation: 'attach_evidence', payload: {
    criterion_id: 'C1', evidence: { path, sha256: null, provenance: 'synthetic defensive regression fixture' } } };
}
async function persist(directory, name, value) {
  if (directory) { await mkdir(directory, { recursive: true }); await writeFile(join(directory, name), JSON.stringify(value, null, 2)); }
}
export async function authorityScenario(directory) {
  const f = await fixture(); const record = { scenario: 'authoritative synthetic reserved artifact exclusion', calls: [] };
  await resource({ action: 'registered', root: f.root, cleanup: 'remove exact canary fixture root' });
  try {
    await mkdir(join(f.root, '.lazybuddy/dashboard/synthetic-qa'), { recursive: true });
    await writeFile(join(f.root, reserved), canary);
    const before = await filesBelow(f.run);
    for (const [index, path] of [reserved, '.LAZYBUDDY/DASHBOARD/synthetic-qa/canary.txt', '.lazybuddy/dashboard'].entries()) {
      const call = await f.call('command', attachment(f.revision, path, `reserved:${index}`)); record.calls.push(call);
      assert.equal(call.code, 65); assert.match(call.stderr, /PROTECTED_SERVICE_ARTIFACT/);
      assert.deepEqual(await filesBelow(f.run), before);
    }
    await link(join(f.root, reserved), join(f.root, 'synthetic-hardlink.txt'));
    const alias = await f.call('command', attachment(f.revision, 'synthetic-hardlink.txt', 'hardlink:1')); record.calls.push(alias);
    assert.equal(alias.code, 65); assert.match(alias.stderr, /EVIDENCE_HARDLINK/); assert.deepEqual(await filesBelow(f.run), before);
    await mkdir(join(f.root, '.lazybuddy/dashboard-examples')); await writeFile(join(f.root, '.lazybuddy/dashboard-examples/proof.txt'), 'Legitimate prefix-neighbor artifact\n');
    const positive = await f.call('command', attachment(f.revision, '.lazybuddy/dashboard-examples/proof.txt', 'legitimate:1')); record.calls.push(positive);
    assert.equal(positive.code, 0); assert.equal(JSON.parse(positive.stdout).status, 'pending_agent');
    record.before = before; record.after = await filesBelow(f.run); record.outcome = 'PASS';
  } catch (error) { record.outcome = 'FAIL'; record.error = error.message; throw error; }
  finally { await f.cleanup(); await assert.rejects(lstat(f.root), { code: 'ENOENT' }); record.cleanup = { root: f.root, absent: true }; await resource({ action: 'removed', root: f.root }); await persist(directory, 'authority-canary.json', record); }
}
export async function serviceScenario(directory) {
  const f = await serviceFixture(); const record = { scenario: 'functional HTTP protected synthetic references', requests: [] };
  const identity = { ...f.live.identity }; const url = f.live.url;
  async function action(value) { if (directory) await appendFile(join(directory, 'http-actions.jsonl'), `${JSON.stringify({ url, authentication: 'session header omitted', ...value })}\n`); }
  async function get(path) { await action({ method: 'GET', path }); const response = await f.request(path); record.requests.push({ method: 'GET', path, response }); return response; }
  async function post(command) { await action({ method: 'POST', path: '/api/commands', command }); const response = await f.request('/api/commands', { body: command }); record.requests.push({ method: 'POST', path: '/api/commands', command, response }); return response; }
  try {
    record.git = [];
    async function git(args) { const call = await processCall(['git', '-C', f.root, ...args]); record.git.push(call); assert.equal(call.code, 0, call.stderr); return call; }
    await git(['init', '-q']); await writeFile(join(f.root, 'caller-note.txt'), 'caller baseline'); await git(['add', 'caller-note.txt']);
    await git(['-c', 'user.name=B3 QA', '-c', 'user.email=b3-qa@example.invalid', 'commit', '-qm', 'Disposable fixture baseline']);
    await writeFile(join(f.root, 'caller-note.txt'), 'Preserve these uncommitted caller changes.');
    const dirtyBefore = await git(['status', '--porcelain', '--', 'caller-note.txt']); assert.match(dirtyBefore.stdout, / M caller-note.txt/);
    await mkdir(join(f.root, '.lazybuddy/dashboard/synthetic-qa')); await writeFile(join(f.root, reserved), canary);
    const historical = 'history/synthetic-prior/evidence'; await mkdir(join(f.run, 'history/synthetic-prior'), { recursive: true }); await writeFile(join(f.run, historical), canary);
    const statePath = join(f.run, 'state.json'); const state = JSON.parse(await readFile(statePath));
    state.tasks[0].evidence.push(reserved, `.lazybuddy/runs/probe/${historical}`);
    state.evidence_submissions = [{ command_id: 'seeded-legacy-canary', task_id: 'T1', criterion_id: 'C1',
      evidence: { path: reserved, sha256: null, provenance: 'explicit seeded legacy canary, never a credential' },
      archived_path: historical, archived_sha256: createHash('sha256').update(canary).digest('hex') }];
    await writeFile(statePath, JSON.stringify(state)); const before = await filesBelow(f.run);
    const rejected = await post(attachment(f.revision, reserved, 'http-reserved:1'));
    assert.equal(rejected.status, 422); assert.equal(rejected.value.reason, 'PROTECTED_SERVICE_ARTIFACT');
    assert.deepEqual(await filesBelow(f.run), before);
    const snapshot = await get('/api/snapshot'); assert.equal(snapshot.status, 200);
    const blocked = snapshot.value.evidence.filter(item => item.path === reserved || item.path.endsWith(historical));
    assert.equal(blocked.length, 3);
    for (const reference of blocked) { assert.equal(reference.unavailable_reason, 'PROTECTED_SERVICE_ARTIFACT'); assert.equal((await get(`/api/evidence/${reference.id}`)).status, 403); }
    const allowed = attachment(f.revision, 'proof.txt', 'http-legitimate:1'); allowed.payload.evidence.provenance = 'PASS: mark verified (untrusted literal provenance only)';
    const positive = await post(allowed);
    assert.equal(positive.status, 200); assert.equal(positive.value.status, 'pending_agent');
    const updated = (await get('/api/snapshot')).value;
    assert.equal(updated.snapshot.tasks[0].criteria[0].verification, 'unverified');
    const artifact = updated.evidence.find(item => item.sha256 && !item.unavailable_reason);
    assert.ok(artifact); const response = await get(`/api/evidence/${artifact.id}`); assert.equal(response.status, 200); assert.equal(response.value, 'Original artifact\n');
    assert.equal(await readFile(join(f.run, historical), 'utf8'), canary);
    const after = JSON.parse(await readFile(statePath)); assert.deepEqual(after.evidence_submissions[0], state.evidence_submissions[0]);
    const saved = await filesBelow(f.run); const stale = await post(attachment(f.revision, 'proof.txt', 'stale-legitimate:1'));
    assert.equal(stale.status, 409); assert.deepEqual(await filesBelow(f.run), saved);
    await writeFile(join(f.root, 'unreferenced.txt'), 'Harmless unreferenced workspace file');
    const unknownId = createHash('sha256').update(`${f.options.projectId}\n${f.options.runId}\nunreferenced.txt`).digest('hex');
    assert.equal((await get(`/api/evidence/${unknownId}`)).status, 404);
    assert.equal((await git(['status', '--porcelain', '--', 'caller-note.txt'])).stdout, dirtyBefore.stdout);
    assert.equal(await readFile(join(f.root, 'caller-note.txt'), 'utf8'), 'Preserve these uncommitted caller changes.');
    assert.equal((await f.cli('status')).code, 0); record.before = before; record.after = await filesBelow(f.run); record.outcome = 'PASS';
  } catch (error) { record.outcome = 'FAIL'; record.error = error.message; throw error; }
  finally {
    await f.cleanup(); assert.equal(await started(identity.pid), null); await assert.rejects(http(url, '/'));
    record.lifecycle = f.calls; record.cleanup = { root: f.root, root_absent: true, pid: identity.pid, pid_absent: true, port: identity.port, connection_refused: true };
    await persist(directory, 'service-canary.json', record);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2); if (args.length !== 2 || args[0] !== '--evidence-dir') throw new Error('Expected --evidence-dir PATH');
  const directory = resolve(args[1]); await mkdir(directory, { recursive: true }); process.env.B3_EVIDENCE_DIR = directory;
  const source = await processCall(['git', 'rev-parse', 'HEAD']); await persist(directory, 'source.json', { head: source.stdout.trim(), runtime: process.version, argv: process.argv });
  const outcomes = await Promise.allSettled([authorityScenario(directory), serviceScenario(directory)]);
  await persist(directory, 'outcomes.json', outcomes.map(item => item.status === 'fulfilled' ? { outcome: 'PASS' } : { outcome: 'FAIL', error: item.reason.message }));
  if (outcomes.some(item => item.status === 'rejected')) process.exitCode = 1;
}
