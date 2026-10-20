import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceFixture, http } from './service-fixture.mjs';
import { processCall } from './command-fixture.mjs';
import { observationJournalSelfTest } from '../adapters/observations.mjs';

// T20b residual 1: production observation persistence on the served route.
// The served service must accept observation inputs (the same shapes the
// vendored recordObservations route accepts), persist them durably under the
// project root, and serve identical counts/records across a full service
// restart. Adversarial coverage: replayed batches (stale_state), malformed
// bodies (malformed_input), torn journal tails after a crash mid-append
// (cancel_resume), and typed refusals for identity reuse with new content and
// for unresolvable subject/artifact references.

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const PLAN = '# Observed plan\n\n- [ ] Remain observable\n';

async function projectCall(root, action, value) {
  return processCall([process.execPath, projectCLI, action, '--project-root', root,
    '--project-id', 'project:b1', '--actor', 'test:observations'], value === undefined ? '' : JSON.stringify(value));
}

const parseStdout = result => {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const observation = (id, overrides = {}) => ({
  id, subject: { kind: 'source', id: 'source:dep' }, classification: 'observed',
  observed_by: 'dashboard-producer/activity@1', observed_at: '2026-10-18T12:00:00.000Z',
  provenance: { kind: 'native_event', reference: 'source:dep#observations' },
  content_revision: null, text: JSON.stringify({ schema_version: 'lazybuddy.producer-attempt-activity.v1' }),
  ...overrides,
});

test('served observation route persists across restart, replays idempotently, and refuses typed bad input', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await f.request('/api/project/observations')).status, 404, 'observations need an initialized project');
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/dep.md'), PLAN);
    const registered = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:dep',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:dep', path: '.omo/plans/dep.md', role: 'plan' } });
    assert.equal(registered.code, 0, registered.stderr);

    const batch = [observation('obs:a'), observation('obs:b', { subject: { kind: 'git' } }),
      observation('obs:c', { subject: { kind: 'usage' }, classification: 'inferred',
        provenance: { kind: 'collector', reference: 'usage-accounting' } })];
    const recorded = await f.request('/api/project/observations', { body: { observations: batch } });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.value));
    assert.equal(recorded.value.status, 'recorded');
    assert.deepEqual(recorded.value.recorded, ['obs:a', 'obs:b', 'obs:c']);
    assert.equal(recorded.value.observation_revision, 3);
    assert.equal(recorded.value.store, 'dashboard-service/observation-journal@1');

    const read = await f.request('/api/project/observations');
    assert.equal(read.status, 200);
    assert.equal(read.value.observation_revision, 3);
    assert.deepEqual(read.value.observations.map(entry => [entry.id, entry.version]),
      [['obs:a', 1], ['obs:b', 2], ['obs:c', 3]]);

    // Restart the service (cancel_resume): a fresh process must read the same
    // durable journal — identical records, identical revision.
    assert.equal((await f.cli('stop')).code, 0);
    await f.start();
    const afterRestart = await f.request('/api/project/observations');
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.value.observation_revision, 3);
    assert.deepEqual(afterRestart.value.observations, read.value.observations,
      'records and counts are stable across a full service restart');

    // Replay (stale_state): identical content is idempotent, never duplicated.
    const replay = await f.request('/api/project/observations', { body: { observations: batch } });
    assert.equal(replay.status, 200);
    assert.equal(replay.value.status, 'already-recorded');
    assert.deepEqual(replay.value.versions, [{ id: 'obs:a', version: 1 }, { id: 'obs:b', version: 2 }, { id: 'obs:c', version: 3 }]);
    assert.equal(replay.value.observation_revision, 3);
    // Key order is not content: the same record with reordered keys still replays.
    const reordered = { ...batch[0], provenance: { ...batch[0].provenance }, subject: { ...batch[0].subject } };
    const replayReordered = await f.request('/api/project/observations', { body: { observations: [reordered] } });
    assert.equal(replayReordered.value.status, 'already-recorded');

    // Identity reuse with different content is a typed refusal.
    const conflicting = await f.request('/api/project/observations',
      { body: { observations: [observation('obs:a', { text: 'changed' })] } });
    assert.equal(conflicting.status, 422);
    assert.equal(conflicting.value.code, 'DUPLICATE_OBSERVATION_ID');

    // New observations continue the version sequence after the restart.
    const extended = await f.request('/api/project/observations', { body: { observations: [observation('obs:d')] } });
    assert.equal(extended.value.observation_revision, 4);
    assert.deepEqual(extended.value.versions, [{ id: 'obs:d', version: 4 }]);

    // Malformed input (malformed_input): route-shape and contract-shape refusals stay typed.
    assert.equal((await f.request('/api/project/observations', { body: { observations: [] } })).value.code, 'INVALID_OBSERVATION_BATCH');
    assert.equal((await f.request('/api/project/observations', { body: { observations: 'nope' } })).value.code, 'INVALID_OBSERVATION_BATCH');
    assert.equal((await f.request('/api/project/observations', { body: { observations: [{ id: 'obs:x', unknown: true }] } })).value.code, 'UNKNOWN_FIELD');
    assert.equal((await f.request('/api/project/observations', { body: { observations: [{ id: 'obs:x', subject: { kind: 'worktree' }, classification: 'observed', observed_by: 'x', observed_at: 'nope', provenance: { kind: 'file', reference: 'r' }, text: 't' }] } })).value.code, 'MISSING_FIELD');
    assert.equal((await f.request('/api/project/observations', { body: { other: true } })).value.code, 'INVALID_OBSERVATION_BATCH');
    // Referential integrity matches the canonical route's state-level checks.
    assert.equal((await f.request('/api/project/observations', { body: { observations: [observation('obs:ghost', { subject: { kind: 'source', id: 'source:unknown' } })] } })).value.code, 'UNKNOWN_SUBJECT');
    assert.equal((await f.request('/api/project/observations', { body: { observations: [observation('obs:ghost-artifact', { artifact_ids: ['artifact:unknown'] })] } })).value.code, 'INVALID_REFERENCE');
    const unauthenticated = await http(f.live.url, '/api/project/observations');
    assert.equal(unauthenticated.status, 401, 'observations require the in-memory session');

    // Torn tail (cancel_resume mid-append): a partial last line is dropped on
    // read, never counted, and the next append repairs the journal.
    const journal = join(f.root, '.lazybuddy/project-observations/journal.jsonl');
    await appendFile(journal, '{"id":"obs:torn","subject":{"kind":"git"');
    const tornRead = await f.request('/api/project/observations');
    assert.equal(tornRead.value.observation_revision, 4, 'a torn tail is not a record');
    const afterTorn = await f.request('/api/project/observations', { body: { observations: [observation('obs:e')] } });
    assert.equal(afterTorn.value.observation_revision, 5);
    const repaired = await readFile(journal, 'utf8');
    assert.equal(repaired.includes('obs:torn'), false, 'the torn fragment was repaired away');
    assert.equal(repaired.trim().endsWith('}'), true);
  } finally { await f.cleanup(); }
});

test('the observation journal is a plain append-only file owned by the service, not bridge state', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    const recorded = await f.request('/api/project/observations', { body: { observations: [observation('obs:file', { subject: { kind: 'git' } })] } });
    assert.equal(recorded.status, 200);
    const journal = join(f.root, '.lazybuddy/project-observations/journal.jsonl');
    const bytes = await readFile(journal, 'utf8');
    const lines = bytes.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).id, 'obs:file');
    assert.equal(JSON.parse(lines[0]).version, 1);
    // A corrupt middle line fails closed instead of serving partial history.
    await writeFile(journal, `${lines[0]}\nnot-json\n`);
    const corrupt = await f.request('/api/project/observations');
    assert.equal(corrupt.status, 422);
    assert.equal(corrupt.value.code, 'OBSERVATION_JOURNAL_CORRUPT');
  } finally { await f.cleanup(); }
});

// T23: every journal write is routed through the bridge `observe` action when
// available, so served observations also persist into canonical accepted
// project state. The journal stays the served read store; the canonical record
// is the accepted-state copy an operator can read through the project itself.
test('served observations mirror into canonical accepted state through the bridge observe action', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    const canonical = await f.request('/api/project/observations',
      { body: { observations: [observation('obs:c1', { subject: { kind: 'git' } }), observation('obs:c2', { subject: { kind: 'git' } })] } });
    assert.equal(canonical.status, 200, JSON.stringify(canonical.value));
    assert.equal(canonical.value.canonical.store, 'lazybuddy/project-observe@1');
    assert.deepEqual(canonical.value.canonical.recorded, ['obs:c1', 'obs:c2']);
    assert.equal(canonical.value.canonical.observation_revision, 2);

    // The accepted project record holds the same observations with the same
    // versions, and the command revision/receipts are untouched by them.
    const read = parseStdout(await projectCall(f.root, 'read'));
    assert.deepEqual(read.observations.map(entry => [entry.id, entry.version]),
      [['obs:c1', 1], ['obs:c2', 2]]);
    assert.equal(read.observation_revision, 2);
    assert.equal(read.revision, 0);

    // Canonical replay is idempotent alongside journal replay.
    const replay = await f.request('/api/project/observations',
      { body: { observations: [observation('obs:c1', { subject: { kind: 'git' } })] } });
    assert.equal(replay.value.status, 'already-recorded');
    assert.deepEqual(replay.value.canonical.already_recorded, [{ id: 'obs:c1', version: 1 }]);
    assert.deepEqual(replay.value.canonical.recorded, []);

    // A canonical refusal fails the served route closed: identity reuse with
    // different content is refused by both stores identically.
    const conflict = await f.request('/api/project/observations',
      { body: { observations: [observation('obs:c1', { subject: { kind: 'git' }, text: 'rewritten' })] } });
    assert.equal(conflict.status, 422);
    assert.equal(conflict.value.code, 'DUPLICATE_OBSERVATION_ID');
  } finally { await f.cleanup(); }
});

// T23 fallback discipline: only the exact refusals that mean "no bridge
// observe action here" downgrade to journal-only persistence. Contract
// refusals, duplicate identities, busy and timeout must never be swallowed.
test('the observe fallback predicate accepts only bridge-unavailability refusals', () => {
  const { observeUnavailable } = observationJournalSelfTest;
  assert.equal(observeUnavailable({ code: 'BRIDGE_FAILED' }), true, 'a missing native bridge is unavailable');
  assert.equal(observeUnavailable({ code: 'INVALID_ARGUMENTS' }), true, 'an older bridge without the action is unavailable');
  assert.equal(observeUnavailable({ code: 'USAGE_INIT_READ_SOURCE_COMMAND_PROJECT_ROOT_PROJECT_ID_ACTOR_NODE' }), true,
    'an older vendored cli without the verb is unavailable');
  assert.equal(observeUnavailable({ code: 'DUPLICATE_OBSERVATION_ID' }), false, 'identity reuse is a real refusal');
  assert.equal(observeUnavailable({ code: 'PROJECT_BUSY' }), false, 'a busy bridge is a real refusal');
  assert.equal(observeUnavailable({ code: 'MODEL_TIMEOUT' }), false, 'a timed-out reducer is a real refusal');
  assert.equal(observeUnavailable({ code: 'UNKNOWN_FIELD' }), false, 'contract refusals fail closed');
  assert.equal(observeUnavailable(null), false);
  assert.equal(observeUnavailable(new Error('plain')), false);
});
