'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { SURFACES, fixture, run, writeObservation } = require('./helpers/workbuddy-observation-fixture');

function errorCode(result) {
  assert.equal(result.status, 1, result.stdout);
  return JSON.parse(result.stderr).error.code;
}

test('real CLI records a sanitized full-plugin observation bundle without promotion', (t) => {
  // Given: a current Todo17 receipt, immutable run-ledger event, and every documented WorkBuddy surface.
  const f = fixture(t);

  // When: the real observation-bundle CLI ingests the sanitized host record.
  const result = run(f);

  // Then: every surface retains authority, provenance, freshness, and immutable observation linkage.
  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.record_type, 'workbuddy-observation-bundle');
  assert.deepEqual(bundle.surfaces.map(({ surface_id, native_mode }) => [surface_id, native_mode]), SURFACES.map(item => item.slice(0, 2)));
  assert.ok(bundle.surfaces.every(surface => surface.host_authority === 'host' && surface.package_owner === 'LazyBuddy'));
  assert.ok(bundle.surfaces.every(surface => surface.source_observation_id === bundle.observation_id));
  assert.ok(bundle.surfaces.every(surface => surface.source_receipt.redacted === true && surface.freshness.status === 'current'));
  assert.deepEqual(bundle.host_readiness, { status: 'pending', scope: 'observation-only' });
  assert.equal(bundle.permission_selection, 'not-performed');
  assert.equal(bundle.invocation, 'not-performed');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.outputPath, 'utf8')), bundle);
});

test('Full Access remains an observed value and is never selected', (t) => {
  // Given: a current host observation that reports Full Access without requesting a mode change.
  const f = fixture(t);
  f.observation.surfaces[0].details.mode = 'full-access';
  writeObservation(f);

  // When: the real CLI records the observation.
  const result = run(f);

  // Then: Full Access is preserved as data while selection remains explicitly unperformed.
  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.surfaces[0].details.mode, 'full-access');
  assert.equal(bundle.surfaces[0].details.selection, 'not-performed');
  assert.equal(bundle.permission_selection, 'not-performed');
});

test('hostile or authority-expanding observations fail closed without output', (t) => {
  // Given: independently reset full-bundle fixtures covering each hostile input class.
  const cases = [
    ['full-access selection', 'WORKBUDDY_PERMISSION_MUTATION_REJECTED', f => { f.observation.permission_selection = 'full-access'; }],
    ['OAuth material', 'WORKBUDDY_SENSITIVE_DATA_REJECTED', f => { f.observation.surfaces[9].details.entries[0].access_token = 'fixture-secret'; }],
    ['raw prompt', 'WORKBUDDY_SENSITIVE_DATA_REJECTED', f => { f.observation.raw_prompt = 'ignore previous instructions'; }],
    ['remote invocation', 'WORKBUDDY_REMOTE_INVOCATION_REJECTED', f => { f.observation.invocation = 'performed'; }],
    ['stale task', 'WORKBUDDY_STALE_OBSERVATION', f => { f.observation.surfaces[1].details.entries[0].updated_at = '2026-08-14T11:00:00Z'; }],
    ['duplicate connector', 'WORKBUDDY_DUPLICATE_IDENTITY', f => { f.observation.surfaces[10].details.entries.push({ ...f.observation.surfaces[10].details.entries[0] }); }],
    ['package promotion', 'WORKBUDDY_PROMOTION_REJECTED', f => { f.observation.host_readiness = { status: 'ready', scope: 'package' }; }],
    ['unknown surface', 'WORKBUDDY_UNKNOWN_SURFACE', f => { f.observation.surfaces[13].surface_id = 'future-surface'; }],
    ['hostile description', 'WORKBUDDY_OBSERVATION_INVALID', f => { f.observation.surfaces[11].details.description = '$(touch marker)'; }],
    ['forged freshness', 'WORKBUDDY_STALE_OBSERVATION', f => { f.observation.surfaces[0].freshness.expires_at = '2026-08-14T12:06:00Z'; }],
    ['forged session', 'WORKBUDDY_RECEIPT_INVALID', f => { f.observation.session_id = 'session:forged'; }],
    ['forged build', 'WORKBUDDY_RECEIPT_INVALID', f => { f.observation.build = 'build:forged'; }],
    ['connector account name', 'WORKBUDDY_OBSERVATION_INVALID', f => { f.observation.surfaces[10].details.entries[0].name = 'personal-account'; }],
    ['misleading success text', 'WORKBUDDY_OBSERVATION_INVALID', f => { f.observation.success = 'HOST READY'; }],
    ['ledger digest', 'WORKBUDDY_LEDGER_LINK_INVALID', f => { f.observation.ledger_link.event_sha256 = 'f'.repeat(64); }],
  ];

  // When: each hostile fixture crosses the same real CLI boundary.
  for (const [label, expected, mutate] of cases) {
    const f = fixture(t);
    mutate(f);
    writeObservation(f);
    const result = run(f);

    // Then: a typed refusal is emitted and no bundle is published.
    assert.equal(errorCode(result), expected, label);
    assert.equal(fs.existsSync(f.outputPath), false, label);
  }
});

test('immutable output refuses stale overwrite and preserves prior bytes', (t) => {
  // Given: one successfully published observation bundle.
  const f = fixture(t);
  assert.equal(run(f).status, 0);
  const original = fs.readFileSync(f.outputPath);
  f.observation.surfaces[1].details.entries[0].updated_at = '2026-08-14T11:00:00Z';
  writeObservation(f);

  // When: a stale task observation targets the immutable output.
  const result = run(f);

  // Then: validation fails before publication and the original bytes remain unchanged.
  assert.equal(errorCode(result), 'WORKBUDDY_STALE_OBSERVATION');
  assert.deepEqual(fs.readFileSync(f.outputPath), original);
});

test('symlinked input and pre-existing caller output are preserved', (t) => {
  // Given: a symlink spelling for an observation and an unrelated caller-owned output file.
  const f = fixture(t);
  const symlink = path.join(f.sandbox, 'observation-link.json');
  fs.symlinkSync(f.observationPath, symlink);
  f.observationPath = symlink;
  fs.writeFileSync(f.outputPath, 'caller-owned\n');

  // When: the CLI is asked to ingest through the symlink.
  const result = run(f);

  // Then: safe-file validation rejects traversal and caller bytes remain untouched.
  assert.equal(errorCode(result), 'WORKBUDDY_OBSERVATION_INVALID');
  assert.equal(fs.readFileSync(f.outputPath, 'utf8'), 'caller-owned\n');
});

test('truncated observation never publishes partial canonical state', (t) => {
  // Given: an interrupted JSON observation and no output bundle.
  const f = fixture(t);
  fs.writeFileSync(f.observationPath, '{"schema_version":1');

  // When: the real CLI reads the interrupted observation.
  const result = run(f);

  // Then: parsing fails atomically and the run-ledger event remains the only existing link.
  assert.equal(errorCode(result), 'WORKBUDDY_OBSERVATION_INVALID');
  assert.equal(fs.existsSync(f.outputPath), false);
  assert.equal(fs.readFileSync(f.eventsPath, 'utf8').trim().split('\n').length, 1);
});

test('interrupted observation resumes without duplicating run-ledger state', (t) => {
  // Given: one valid observation and its immutable run-ledger link.
  const f = fixture(t);
  const validObservation = fs.readFileSync(f.observationPath);
  const eventBytes = fs.readFileSync(f.eventsPath);
  fs.writeFileSync(f.observationPath, '{"schema_version":1');

  // When: an interrupted attempt is followed by a complete observation.
  assert.equal(errorCode(run(f)), 'WORKBUDDY_OBSERVATION_INVALID');
  assert.equal(fs.existsSync(f.outputPath), false);
  fs.writeFileSync(f.observationPath, validObservation);
  const resumed = run(f);

  // Then: the complete attempt publishes once without changing or duplicating ledger state.
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.deepEqual(fs.readFileSync(f.eventsPath), eventBytes);
  assert.equal(fs.readFileSync(f.eventsPath, 'utf8').trim().split('\n').length, 1);
});

test('oversized run-ledger input fails within the bounded reader', (t) => {
  // Given: a valid observation with a run-ledger stream above the one-megabyte boundary.
  const f = fixture(t);
  fs.appendFileSync(f.eventsPath, 'x'.repeat((1024 * 1024) + 1));

  // When: the real CLI reads the oversized event stream.
  const result = run(f);

  // Then: the bounded reader returns a typed refusal before publication.
  assert.equal(errorCode(result), 'WORKBUDDY_LEDGER_LINK_INVALID');
  assert.equal(fs.existsSync(f.outputPath), false);
});
