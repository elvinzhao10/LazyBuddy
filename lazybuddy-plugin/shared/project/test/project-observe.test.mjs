import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:observe';
const ACTOR = 'local:observe';

// T23 canonical observe bridge: observations persist into accepted project
// state through the same discipline as commands — record validation is the
// vendored reducer's (`recordObservations` via --reduce), replay is idempotent
// by observation identity, publication is atomic, and observations never
// append command receipts or advance the command revision. Adversarial
// coverage: stale_state (identical replay must not grow state), malformed_input
// (invalid batches fail closed with typed codes, state bytes untouched), and
// version authority (a caller-supplied version is refused; versions are
// assigned by the accepted state, never accepted from input).

function invoke(root, action, input, options = {}) {
  const args = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID,
    '--actor', options.actor ?? ACTOR];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 25000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => resolve({ code, signal,
      stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8') }));
    child.stdin.end(input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input));
  });
}

function parseSuccess(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '', 'Successful CLI operations should not emit hidden warnings');
  return JSON.parse(result.stdout);
}

function assertFailure(result, code) {
  assert.equal(result.signal, null);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '', 'Rejected input must not yield an accepted snapshot');
  assert.equal(result.stderr, `${code}\n`);
}

const observation = (id, overrides = {}) => ({
  id, subject: { kind: 'git' }, classification: 'observed',
  observed_by: 'local:observe', observed_at: '2026-10-19T00:00:00.000Z',
  provenance: { kind: 'collector', reference: 'project-observe.test' },
  text: '{}', ...overrides,
});

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazybuddy-project-observe-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, statePath: join(root, '.lazybuddy/project/state.json'),
    persisted: () => JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8')),
    bytes: () => readFileSync(join(root, '.lazybuddy/project/state.json')) };
}

test('observe records validated observations into accepted state without command effects', async t => {
  const f = fixture(t);
  const initial = parseSuccess(await invoke(f.root, 'init'));
  assert.equal(initial.observation_revision, 0);

  const first = parseSuccess(await invoke(f.root, 'observe',
    { observations: [observation('obs:a'), observation('obs:b', { subject: { kind: 'usage' }, classification: 'inferred' })] }));
  assert.deepEqual(first.receipt, { status: 'recorded', recorded: ['obs:a', 'obs:b'], already_recorded: [],
    versions: [{ id: 'obs:a', version: 1 }, { id: 'obs:b', version: 2 }], observation_revision: 2 });
  assert.deepEqual(first.snapshot.observations.map(entry => [entry.id, entry.version]),
    [['obs:a', 1], ['obs:b', 2]], 'the accepted snapshot serves the canonical records');

  // Observations are records, not commands: no receipts, no revision advance.
  const persisted = f.persisted();
  assert.equal(persisted.revision, 0);
  assert.equal(persisted.observation_revision, 2);
  assert.deepEqual(persisted.receipts, []);
  assert.equal(persisted.observations.length, 2);
  // The reducer assigns everything the contract requires; nothing is fabricated.
  assert.equal(persisted.observations[0].observed_by, 'local:observe');

  const second = parseSuccess(await invoke(f.root, 'observe',
    { observations: [observation('obs:c', { subject: { kind: 'worktree', worktree: '/tmp/x' } })] }));
  assert.equal(second.receipt.observation_revision, 3);
  assert.deepEqual(second.receipt.versions, [{ id: 'obs:c', version: 3 }]);

  // Commands keep working and the command revision is unaffected by observes.
  mkdirSync(dirname(join(f.root, 'docs/plan.md')), { recursive: true });
  writeFileSync(join(f.root, 'docs/plan.md'), '# Plan\n');
  const registered = parseSuccess(await invoke(f.root, 'command', { schema_version: 1, command_id: 'cmd:source',
    project_id: PROJECT_ID, expected_revision: 0, operation: 'register_source',
    payload: { id: 'source:plan', path: 'docs/plan.md', role: 'plan' } }));
  assert.equal(registered.receipt.status, 'saved');
  assert.equal(registered.snapshot.revision, 1);
  assert.equal(registered.snapshot.observation_revision, 3, 'a command preserves the observation revision');
  // A source-backed observation now resolves against the registered source.
  const sourced = parseSuccess(await invoke(f.root, 'observe',
    { observations: [observation('obs:d', { subject: { kind: 'source', id: 'source:plan' } })] }));
  assert.deepEqual(sourced.receipt.versions, [{ id: 'obs:d', version: 4 }]);
});

test('identical replay is idempotent and leaves the accepted state byte-stable (stale_state)', async t => {
  const f = fixture(t);
  parseSuccess(await invoke(f.root, 'init'));
  const batch = [observation('obs:a'), observation('obs:b')];
  parseSuccess(await invoke(f.root, 'observe', { observations: batch }));
  const before = f.bytes();

  const replay = parseSuccess(await invoke(f.root, 'observe', { observations: batch }));
  assert.equal(replay.receipt.status, 'already-recorded');
  assert.deepEqual(replay.receipt.recorded, []);
  assert.deepEqual(replay.receipt.already_recorded,
    [{ id: 'obs:a', version: 1 }, { id: 'obs:b', version: 2 }]);
  assert.equal(replay.receipt.observation_revision, 2);
  assert.deepEqual(f.bytes(), before, 'a pure replay republishes nothing');

  // Key order is not content: reordered records still replay.
  const reordered = batch.map(record => Object.fromEntries(Object.keys(record).sort().reverse()
    .map(key => [key, record[key]])));
  const replayReordered = parseSuccess(await invoke(f.root, 'observe', { observations: reordered }));
  assert.equal(replayReordered.receipt.status, 'already-recorded');

  // A mixed batch appends only the fresh record and replays the known one.
  const mixed = parseSuccess(await invoke(f.root, 'observe',
    { observations: [observation('obs:c'), batch[0]] }));
  assert.equal(mixed.receipt.status, 'recorded');
  assert.deepEqual(mixed.receipt.recorded, ['obs:c']);
  assert.deepEqual(mixed.receipt.already_recorded, [{ id: 'obs:a', version: 1 }]);
  assert.deepEqual(mixed.receipt.versions, [{ id: 'obs:a', version: 1 }, { id: 'obs:c', version: 3 }]);
});

test('identity reuse with different content fails closed without touching state (stale_state)', async t => {
  const f = fixture(t);
  parseSuccess(await invoke(f.root, 'init'));
  parseSuccess(await invoke(f.root, 'observe', { observations: [observation('obs:a')] }));
  const before = f.bytes();
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:a', { text: 'changed' })] }), 'DUPLICATE_OBSERVATION_ID');
  assert.deepEqual(f.bytes(), before, 'a refused observe leaves the accepted state untouched');
});

test('malformed batches and records fail typed (malformed_input)', async t => {
  const f = fixture(t);
  parseSuccess(await invoke(f.root, 'init'));
  const before = f.bytes();
  // Request shape.
  assertFailure(await invoke(f.root, 'observe', { records: [] }), 'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe', { observations: [] }), 'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe', { observations: 'nope' }), 'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe', { observations: [42] }), 'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe', { observations: [observation('bad id')] }), 'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:x'), observation('obs:x')] }), 'DUPLICATE_ID');
  // Reducer contract: unknown fields, missing fields, unresolvable references.
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:x', { unknown: true })] }), 'UNKNOWN_FIELD');
  assertFailure(await invoke(f.root, 'observe',
    { observations: [{ id: 'obs:x', subject: { kind: 'git' }, classification: 'observed',
      observed_by: 'x', observed_at: 'nope', provenance: { kind: 'file', reference: 'r' }, text: 't' }] }), 'INVALID_VALUE');
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:x', { subject: { kind: 'source', id: 'source:ghost' } })] }), 'UNKNOWN_SUBJECT');
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:x', { artifact_ids: ['artifact:ghost'] })] }), 'INVALID_REFERENCE');
  // Versions are assigned by the accepted state, never accepted from input.
  assertFailure(await invoke(f.root, 'observe',
    { observations: [observation('obs:x', { version: 7 })] }), 'UNKNOWN_FIELD');
  // The reducer's batch bound is enforced before any state is touched.
  assertFailure(await invoke(f.root, 'observe',
    { observations: Array.from({ length: 1001 }, (_, index) => observation(`obs:fill:${index}`)) }),
  'INVALID_OBSERVATION_REQUEST');
  assertFailure(await invoke(f.root, 'observe'), 'INVALID_JSON');
  assert.deepEqual(f.bytes(), before, 'every refused batch leaves the accepted state untouched');
});

test('the pure reducer entry maps observe and still refuses unknown actions', async t => {
  const f = fixture(t);
  parseSuccess(await invoke(f.root, 'init'));
  const state = f.persisted();
  const reduce = payload => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, '--reduce'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 25000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => resolve({ code, stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8') }));
    child.stdin.end(JSON.stringify(payload));
  });
  const observed = await reduce({ action: 'observe', state, records: [observation('obs:r')] });
  assert.equal(observed.code, 0, observed.stderr);
  const result = JSON.parse(observed.stdout);
  assert.deepEqual(result.recorded, ['obs:r']);
  assert.equal(result.state.observation_revision, 1);
  assert.equal(result.state.revision, 0, 'the reducer never advances the command revision for observations');
  assert.deepEqual(result.state.receipts, []);
  const refused = await reduce({ action: 'nope' });
  assert.notEqual(refused.code, 0);
  assert.equal(refused.stderr, 'INVALID_REDUCER_ACTION\n');
  const invalid = await reduce({ action: 'observe', state, records: [observation('obs:r', { unknown: 1 })] });
  assert.notEqual(invalid.code, 0);
  assert.equal(invalid.stderr.trim(), 'UNKNOWN_FIELD');
});
