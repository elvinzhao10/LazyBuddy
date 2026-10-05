import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { fixture, write, inventory, seedNative, checkNative, sha256, suiteRoot } from './helpers.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const statePath = root => path.join(root, '.lazybuddy/project/state.json');
const state = root => JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
const argv = (root, action, projectId = 'project:test') => [cli, action, '--project-root', root, '--project-id', projectId, '--actor', 'local:review'];
function invoke(root, action, payload, options = {}) {
  const result = spawnSync(process.execPath, argv(root, action, options.projectId), {
    encoding: 'utf8', input: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
    timeout: 15000, maxBuffer: 12 * 1024 * 1024, env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}
function success(result) { assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`); return result.json; }
function reject(result) { assert.ok(result.status !== 0 || result.json?.receipt?.status === 'conflict', `Unexpected acceptance: ${result.stdout}`); }
function initialize(name) {
  const root = fixture(name);
  const native = seedNative(root);
  success(invoke(root, 'init'));
  return { root, native };
}
const command = (root, id, payload, expectedRevision = state(root).revision, operation = 'register_source') => ({
  schema_version: 1, command_id: id, project_id: 'project:test', expected_revision: expectedRevision, operation, payload,
});
const register = (root, id, relative, expectedRevision) => command(root, `cmd:${id}`, { id: `source:${id}`, path: relative, role: 'requirements' }, expectedRevision);
const sourceText = '# Requirements\n\n## feature:test — A feature\n\nOriginal source content.\n';

test('init and repeated read/init preserve pre-existing native authorities', () => {
  const { root, native } = initialize('native-preservation');
  write(root, 'docs/requirements.md', sourceText);
  success(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md')));
  const before = inventory(root);
  success(invoke(root, 'read'));
  success(invoke(root, 'init'));
  assert.deepEqual(inventory(root), before);
  assert.deepEqual(checkNative(root, native), []);
});

test('different project identity cannot adopt or replace an existing registry', () => {
  const { root, native } = initialize('identity');
  const before = inventory(root);
  reject(invoke(root, 'init', undefined, { projectId: 'project:other' }));
  reject(invoke(root, 'read', undefined, { projectId: 'project:other' }));
  assert.deepEqual(inventory(root), before);
  assert.deepEqual(checkNative(root, native), []);
});

test('init refuses corrupt pre-existing registry bytes and preserves caller files', () => {
  const root = fixture('corrupt-init');
  const native = seedNative(root);
  write(root, '.lazybuddy/project/state.json', '{invalid caller-owned data\n');
  write(root, '.lazybuddy/project/notes.txt', 'unowned notes\n');
  const bytes = fs.readFileSync(statePath(root));
  reject(invoke(root, 'init'));
  assert.deepEqual(fs.readFileSync(statePath(root)), bytes);
  assert.equal(fs.readFileSync(path.join(root, '.lazybuddy/project/notes.txt'), 'utf8'), 'unowned notes\n');
  assert.deepEqual(checkNative(root, native), []);
});

test('canonical-root requirement rejects symlink root and symlink ancestor', () => {
  for (const kind of ['root', 'ancestor']) {
    const outside = fixture(`symlink-${kind}-actual`);
    const links = fixture(`symlink-${kind}-links`);
    const actual = kind === 'root' ? outside : path.join(outside, 'nested');
    fs.mkdirSync(actual, { recursive: true });
    const link = path.join(links, 'alias');
    fs.symlinkSync(outside, link, 'dir');
    const supplied = kind === 'root' ? link : path.join(link, 'nested');
    const before = inventory(outside);
    reject(invoke(supplied, 'init'));
    assert.deepEqual(inventory(outside), before);
  }
});

test('symlink namespace or registry file cannot redirect writes', () => {
  for (const relative of ['.lazybuddy', '.lazybuddy/project', '.lazybuddy/project/state.json']) {
    const root = fixture(`namespace-${relative.replaceAll('/', '-')}`);
    const outside = fixture(`outside-${relative.replaceAll('/', '-')}`);
    const target = relative.endsWith('.json') ? write(outside, 'state.json', 'external-sentinel\n') : outside;
    const link = path.join(root, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, relative.endsWith('.json') ? 'file' : 'dir');
    const before = inventory(outside);
    reject(invoke(root, 'init'));
    assert.deepEqual(inventory(outside), before);
    assert.equal(fs.readlinkSync(link), target);
  }
  const { root, native } = initialize('owned-state-symlink');
  const outside = fixture('owned-state-symlink-outside');
  const target = write(outside, 'state.json', 'external state sentinel\n');
  fs.unlinkSync(statePath(root));
  fs.symlinkSync(target, statePath(root));
  const before = inventory(outside);
  reject(invoke(root, 'read'));
  reject(invoke(root, 'init'));
  assert.deepEqual(inventory(outside), before);
  assert.deepEqual(checkNative(root, native), []);
});

test('unsafe and protected source paths are refused without registry changes', () => {
  const { root, native } = initialize('source-paths');
  const outside = fixture('source-paths-outside');
  const absolute = write(outside, 'secret.md', 'outside secret fixture\n');
  const paths = [
    '../outside.md', absolute, 'C:/outside.md', 'C:\\outside.md', '\\\\server\\share\\file.md',
    'docs\\ok.md', './docs/ok.md', 'docs//ok.md', 'docs/../ok.md', 'docs/./ok.md', 'docs/ok.md/', '',
    '.lazybuddy/dashboard/secret.md', '.lazybuddy/DASHBOARD/secret.md', '.LAZYBUDDY/dashboard/secret.md',
  ];
  for (const relative of ['C:/outside.md', 'docs/ok.md', '.lazybuddy/dashboard/secret.md', '.lazybuddy/DASHBOARD/secret.md', '.LAZYBUDDY/dashboard/secret.md']) write(root, relative, sourceText);
  for (const [index, relative] of paths.entries()) {
    const before = fs.readFileSync(statePath(root));
    reject(invoke(root, 'command', register(root, `bad${index}`, relative)));
    assert.deepEqual(fs.readFileSync(statePath(root)), before, relative);
  }
  assert.deepEqual(checkNative(root, native), []);
});

test('source target, ancestor, and broken symlinks fail closed', () => {
  const { root, native } = initialize('source-symlinks');
  const outside = fixture('source-symlinks-outside');
  const secret = write(outside, 'secret.md', 'outside secret fixture\n');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.symlinkSync(secret, path.join(root, 'docs/linked.md'));
  fs.symlinkSync(outside, path.join(root, 'alias'), 'dir');
  fs.symlinkSync(path.join(outside, 'absent.md'), path.join(root, 'docs/broken.md'));
  for (const [index, relative] of ['docs/linked.md', 'alias/secret.md', 'docs/broken.md'].entries()) {
    const before = fs.readFileSync(statePath(root));
    reject(invoke(root, 'command', register(root, `link${index}`, relative)));
    assert.deepEqual(fs.readFileSync(statePath(root)), before);
  }
  assert.deepEqual(checkNative(root, native), []);
});

test('hardlinked source cannot expose protected service material', () => {
  const { root } = initialize('source-hardlinks');
  const protectedFile = write(root, '.lazybuddy/dashboard/credential.md', 'private credential fixture\n');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.linkSync(protectedFile, path.join(root, 'docs/innocent.md'));
  const before = fs.readFileSync(statePath(root));
  reject(invoke(root, 'command', register(root, 'hardlink', 'docs/innocent.md')));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
});

test('source edits are observations; reads/replay preserve accepted captures and source bytes', () => {
  const { root, native } = initialize('source-edit');
  const file = write(root, 'docs/requirements.md', sourceText);
  const savedCommand = register(root, 'baseline', 'docs/requirements.md');
  success(invoke(root, 'command', savedCommand));
  const before = fs.readFileSync(statePath(root));
  fs.writeFileSync(file, '# Changed externally\n');
  const external = fs.readFileSync(file);
  const read = success(invoke(root, 'read'));
  assert.match(JSON.stringify(read), /changed/);
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  success(invoke(root, 'command', savedCommand));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  assert.deepEqual(fs.readFileSync(file), external);
  fs.unlinkSync(file);
  success(invoke(root, 'command', savedCommand));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  assert.deepEqual(checkNative(root, native), []);
});

test('baseline creation with a stale source digest cannot accept newer text under old provenance', () => {
  const { root } = initialize('source-cas');
  const file = write(root, 'docs/requirements.md', sourceText);
  success(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md')));
  const before = fs.readFileSync(statePath(root));
  fs.writeFileSync(file, '# Changed externally\n\n## feature:test — Replaced\nNew material\n');
  const change = command(root, 'cmd:item', { items: [{ id: 'feature:test', kind: 'feature', state: 'accepted', source: { source_id: 'source:baseline', sha256: sha256(sourceText), anchor_id: 'document' } }] }, undefined, 'record_baseline_items');
  reject(invoke(root, 'command', change));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
});

function invokeAsync(root, payload) {
  return new Promise((resolve, rejectPromise) => {
    const child = spawn(process.execPath, argv(root, 'command'), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', rejectPromise);
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('parallel stale CAS saves exactly one command and no lost update', async () => {
  const { root, native } = initialize('parallel-cas');
  write(root, 'one.md', sourceText);
  write(root, 'two.md', sourceText);
  const first = register(root, 'one', 'one.md');
  const second = register(root, 'two', 'two.md');
  const results = await Promise.all([invokeAsync(root, first), invokeAsync(root, second)]);
  const final = state(root);
  assert.equal(final.revision, 1, JSON.stringify(results));
  assert.equal(final.sources.length, 1);
  assert.equal(final.receipts.length, 1);
  assert.deepEqual(checkNative(root, native), []);
});

test('parallel replay produces one durable command receipt', async () => {
  const { root } = initialize('parallel-replay');
  write(root, 'one.md', sourceText);
  const same = register(root, 'same', 'one.md');
  const results = await Promise.all([invokeAsync(root, same), invokeAsync(root, same)]);
  assert.ok(results.every(result => result.status === 0), JSON.stringify(results));
  const final = state(root);
  assert.equal(final.revision, 1);
  assert.equal(final.sources.length, 1);
  assert.equal(final.receipts.length, 1);
});

const faultEnvironment = (root, fault) => ({
  PYTHONPATH: fileURLToPath(new URL('./fault-hooks/', import.meta.url)),
  PROJECT_REVIEW_SUITE_ROOT: suiteRoot,
  PROJECT_REVIEW_ROOT: root,
  PROJECT_REVIEW_FAULT: fault,
});

test('fault hook refuses a noncanonical fixture-root alias', () => {
  const { root, native } = initialize('fault-guard');
  write(root, 'docs/requirements.md', sourceText);
  const aliasedRoot = `${suiteRoot}/../${path.basename(suiteRoot)}/${path.basename(root)}`;
  success(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md'), {
    env: { ...faultEnvironment(root, 'before_state_publish'), PROJECT_REVIEW_ROOT: aliasedRoot },
  }));
  assert.equal(state(root).revision, 1);
  assert.deepEqual(checkNative(root, native), []);
});

test('crash before or after atomic state publication leaves one recoverable revision and receipt', () => {
  for (const phase of ['before_state_publish', 'after_state_publish']) {
    const { root, native } = initialize(`crash-command-${phase}`);
    write(root, 'docs/requirements.md', sourceText);
    const pending = register(root, 'baseline', 'docs/requirements.md');
    reject(invoke(root, 'command', pending, { env: faultEnvironment(root, phase) }));
    const interrupted = state(root);
    assert.equal(interrupted.revision, phase === 'before_state_publish' ? 0 : 1);
    assert.equal(interrupted.receipts.length, interrupted.revision);
    success(invoke(root, 'read'));
    success(invoke(root, 'command', pending));
    const recovered = state(root);
    assert.equal(recovered.revision, 1);
    assert.equal(recovered.sources.length, 1);
    assert.equal(recovered.receipts.length, 1);
    assert.deepEqual(checkNative(root, native), []);
  }
});

test('init crash before or after atomic state publication retries without adopting unrelated files', () => {
  for (const phase of ['before_state_publish', 'after_state_publish']) {
    const root = fixture(`crash-init-${phase}`);
    const native = seedNative(root);
    reject(invoke(root, 'init', undefined, { env: faultEnvironment(root, phase) }));
    success(invoke(root, 'init'));
    assert.equal(state(root).revision, 0);
    assert.equal(state(root).receipts.length, 0);
    assert.deepEqual(checkNative(root, native), []);
  }
});

test('external source edit after reduction is detected before state publication', () => {
  const { root, native } = initialize('external-source-during-command');
  write(root, 'docs/requirements.md', sourceText);
  const before = fs.readFileSync(statePath(root));
  reject(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md'), { env: faultEnvironment(root, 'edit_source') }));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  assert.equal(fs.readFileSync(path.join(root, 'docs/requirements.md'), 'utf8'), '# External concurrent change\n');
  assert.deepEqual(checkNative(root, native), []);
});

test('external state edit after reduction is preserved rather than overwritten', () => {
  const { root, native } = initialize('external-state-during-command');
  write(root, 'docs/requirements.md', sourceText);
  reject(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md'), { env: faultEnvironment(root, 'edit_state') }));
  assert.equal(fs.readFileSync(statePath(root), 'utf8'), 'external editor state sentinel\n');
  assert.deepEqual(checkNative(root, native), []);
});

test('external store-directory replacement aborts without writing into either replaced store', () => {
  const { root, native } = initialize('external-directory-during-command');
  write(root, 'docs/requirements.md', sourceText);
  const before = fs.readFileSync(statePath(root));
  reject(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md'), { env: faultEnvironment(root, 'replace_store') }));
  assert.deepEqual(fs.readFileSync(path.join(root, '.lazybuddy/project-before/state.json')), before);
  assert.deepEqual(fs.readdirSync(path.join(root, '.lazybuddy/project')), ['unowned.txt']);
  assert.equal(fs.readFileSync(path.join(root, '.lazybuddy/project/unowned.txt'), 'utf8'), 'external directory sentinel\n');
  assert.deepEqual(checkNative(root, native), []);
});

test('external source replacement by a protected symlink is rejected before publication', () => {
  const { root, native } = initialize('external-symlink-during-command');
  write(root, 'docs/requirements.md', sourceText);
  write(root, '.lazybuddy/dashboard/secret.md', 'protected secret fixture\n');
  const before = fs.readFileSync(statePath(root));
  reject(invoke(root, 'command', register(root, 'baseline', 'docs/requirements.md'), { env: faultEnvironment(root, 'replace_source_with_symlink') }));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  assert.ok(fs.lstatSync(path.join(root, 'docs/requirements.md')).isSymbolicLink());
  assert.deepEqual(checkNative(root, native), []);
});

test('state fsync failure preserves old authority and permits a clean retry', () => {
  const { root, native } = initialize('fsync-failure');
  write(root, 'docs/requirements.md', sourceText);
  const before = fs.readFileSync(statePath(root));
  const pending = register(root, 'baseline', 'docs/requirements.md');
  reject(invoke(root, 'command', pending, { env: faultEnvironment(root, 'state_fsync_error') }));
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
  success(invoke(root, 'command', pending));
  assert.equal(state(root).revision, 1);
  assert.deepEqual(checkNative(root, native), []);
});

test('initialized registry corruption is preserved and rejected by both init and read', () => {
  const { root, native } = initialize('corrupt-owned-state');
  fs.writeFileSync(statePath(root), 'corrupt accepted-store sentinel\n');
  const before = inventory(root);
  reject(invoke(root, 'init'));
  reject(invoke(root, 'read'));
  assert.deepEqual(inventory(root), before);
  assert.deepEqual(checkNative(root, native), []);
});

test('interrupted owner bootstrap is fail-closed and does not alter native state', () => {
  for (const phase of ['after_project_mkdir', 'owner_open']) {
    const root = fixture(`bootstrap-${phase}`);
    const native = seedNative(root);
    reject(invoke(root, 'init', undefined, { env: faultEnvironment(root, phase) }));
    const retry = invoke(root, 'init');
    assert.notEqual(retry.status, 0, 'Bootstrap recovery behavior changed; inspect new implementation');
    assert.match(retry.stderr, /PROJECT_DIRECTORY_COLLISION|INVALID_JSON/);
    assert.deepEqual(checkNative(root, native), []);
    assert.equal(fs.existsSync(statePath(root)), false);
    process.stdout.write(`BOOTSTRAP_RESIDUAL ${JSON.stringify({ phase, retry_error: retry.stderr.trim() })}\n`);
  }
});

function addPlan(root) {
  const content = '# Test plan\n\nA plan used only by the isolated review.\n';
  write(root, '.omo/plans/test.md', content);
  const source = command(root, 'cmd:plan-source', { id: 'source:plan', path: '.omo/plans/test.md', role: 'plan' });
  success(invoke(root, 'command', source));
  success(invoke(root, 'command', command(root, 'cmd:plan', {
    id: 'plan:test', source: { source_id: 'source:plan', sha256: sha256(content), anchor_id: 'document' },
    declared_lifecycle: 'planned', baseline_refs: [],
  }, undefined, 'register_plan')));
}

test('native run links remain identity references and never mutate native authorities', () => {
  const { root, native } = initialize('native-link');
  addPlan(root);
  const pending = command(root, 'cmd:link', { plan_id: 'plan:test', native_project_id: 'native-old', run_id: 'run-old' }, undefined, 'link_native_run');
  const result = success(invoke(root, 'command', pending));
  assert.equal(result.receipt.status, 'saved');
  const linkedPlan = result.snapshot.plans.find(plan => plan.id === 'plan:test');
  assert.equal(linkedPlan.native_runs.length, 1);
  assert.equal(linkedPlan.native_runs[0].native_project_id, 'native-old');
  assert.equal(linkedPlan.native_runs[0].run_id, 'run-old');
  assert.deepEqual(linkedPlan.native_observations, []);
  assert.equal(linkedPlan.alignment, 'unassessed');
  assert.deepEqual(checkNative(root, native), []);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /"(?:execution|verification|consumption)"\s*:\s*"(?:confirmed|verified|succeeded|consumed|running)"/);
  const before = fs.readFileSync(statePath(root));
  fs.unlinkSync(path.join(root, '.lazybuddy/runs/run-old/state.json'));
  const replay = success(invoke(root, 'command', pending));
  assert.equal(replay.receipt.status, 'saved');
  assert.deepEqual(fs.readFileSync(statePath(root)), before);
});

test('unknown, corrupted, unbound and unsafe native runs cannot become linked identities', () => {
  const { root } = initialize('native-link-invalid');
  addPlan(root);
  write(root, '.lazybuddy/runs/corrupt/state.json', '{broken');
  write(root, '.lazybuddy/runs/unbound/state.json', '{"run_id":"unbound"}\n');
  write(root, '.lazybuddy/runs/mismatch/state.json', '{"run_id":"different","dashboard_project_id":"native-old"}\n');
  write(root, '.lazybuddy/runs/wrong-project/state.json', '{"run_id":"wrong-project","dashboard_project_id":"native-other"}\n');
  const outside = fixture('native-run-outside');
  write(outside, 'state.json', '{"run_id":"linked","dashboard_project_id":"native-old"}\n');
  fs.symlinkSync(outside, path.join(root, '.lazybuddy/runs/linked'), 'dir');
  const before = fs.readFileSync(statePath(root));
  for (const [index, runId] of ['unknown', 'corrupt', 'unbound', 'mismatch', 'wrong-project', 'linked', '../run-old', '/run-old', 'C:/run-old'].entries()) {
    const pending = command(root, `cmd:invalid-link${index}`, { plan_id: 'plan:test', native_project_id: 'native-old', run_id: runId }, undefined, 'link_native_run');
    reject(invoke(root, 'command', pending));
    assert.deepEqual(fs.readFileSync(statePath(root)), before);
  }
});
