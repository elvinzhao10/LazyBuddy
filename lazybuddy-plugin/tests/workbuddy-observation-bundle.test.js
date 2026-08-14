'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const RELEASE_ROOT = path.dirname(PLUGIN_ROOT);
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-workbuddy-observation.js');
const MANIFEST = path.join(PLUGIN_ROOT, '.workbuddy-plugin', 'plugin.json');
const NOW = '2026-08-14T12:10:00Z';
const OBSERVED_AT = '2026-08-14T12:05:00Z';
const EXPIRES_AT = '2026-08-14T13:05:00Z';
const DIGEST = 'a'.repeat(64);

const SURFACES = [
  ['permission-mode', 'observe-only', { mode: 'default', selection: 'not-performed' }],
  ['tasks', 'observe-only', { entries: [{ item_id: 'task:001', status: 'running', updated_at: OBSERVED_AT, value_digest: DIGEST }] }],
  ['plans', 'observe-only', { entries: [{ item_id: 'plan:001', status: 'active', updated_at: OBSERVED_AT, value_digest: DIGEST }] }],
  ['artifacts', 'observe-only', { entries: [{ item_id: 'artifact:001', status: 'available', value_digest: DIGEST }] }],
  ['files', 'observe-only', { entries: [{ item_id: 'file:001', status: 'changed', value_digest: DIGEST }] }],
  ['changes', 'observe-only', { entries: [{ item_id: 'change:001', status: 'pending', value_digest: DIGEST }] }],
  ['previews', 'observe-only', { entries: [{ item_id: 'preview:001', status: 'available', value_digest: DIGEST }] }],
  ['memory', 'observe-only', { status: 'enabled', revision_digest: DIGEST }],
  ['skills', 'observe-only', { entries: [{ skill_id: 'lazy-programming', status: 'enabled', version_digest: DIGEST }] }],
  ['mcp', 'observe-only', { entries: [{ server_id: 'run-ledger', status: 'connected', oauth_status: 'not-required', tool_toggle_status: 'enabled' }] }],
  ['connectors', 'observe-only', { entries: [{ connector_id: 'connector:001', type_id: 'mcp', name_digest: DIGEST, status: 'connected' }] }],
  ['experts', 'descriptor-only', { availability: 'observed', descriptor_digest: DIGEST }],
  ['automations', 'descriptor-only', { availability: 'observed', descriptor_digest: DIGEST }],
  ['assistant', 'descriptor-only', { availability: 'observed', descriptor_digest: DIGEST }],
];

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(t) {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy-workbuddy-bundle-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const receiptPath = path.join(sandbox, 'marketplace-receipt.json');
  const observationPath = path.join(sandbox, 'observation.json');
  const eventsPath = path.join(sandbox, 'events.jsonl');
  const outputPath = path.join(sandbox, 'bundle.json');
  const receipt = {
    schema_version: 1,
    type: 'workbuddy-marketplace-full-plugin',
    source: {
      route: 'workbuddy-marketplace', release_root: RELEASE_ROOT,
      manifest: 'lazybuddy-plugin/.workbuddy-plugin/plugin.json',
      manifest_sha256: sha(fs.readFileSync(MANIFEST)), plugin: 'lazybuddy', version: '1.0.3',
    },
    host: 'workbuddy', build: 'build:current', session_id: 'session:current', observed_at: OBSERVED_AT,
    capabilities: {
      skill: { id: 'lazy-programming', status: 'loaded' }, command: { id: 'lazy-status', status: 'loaded' },
      agent: { id: 'lazybuddy-verifier', status: 'loaded' }, hook: { id: 'SessionStart', status: 'loaded' },
      mcp: Object.fromEntries(['run-ledger', 'verification', 'status-dashboard', 'context-graph', 'code-intel', 'docs'].map(name => [name, 'connected'])),
    },
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  const receiptDigest = sha(fs.readFileSync(receiptPath));
  const event = { ts: OBSERVED_AT, run_id: 'run-todo18', event: 'host_observation_linked', event_id: 'event:todo18:001', observation_id: 'obs:workbuddy:001', source_receipt_sha256: receiptDigest };
  const eventLine = JSON.stringify(event);
  fs.writeFileSync(eventsPath, `${eventLine}\n`);
  const sourceReceipt = { receipt_id: 'workbuddy:build.current:session.current', sha256: receiptDigest, redacted: true };
  const surfaces = SURFACES.map(([surface_id, native_mode, details]) => ({
    surface_id, native_mode, host_authority: 'host', package_owner: 'LazyBuddy', status: 'observed',
    observed_at: OBSERVED_AT, freshness: { status: 'current', observed_at: OBSERVED_AT, expires_at: EXPIRES_AT },
    source_receipt: sourceReceipt, source_observation_id: 'obs:workbuddy:001', value_digest: DIGEST,
    details: structuredClone(details),
  }));
  const observation = {
    schema_version: 1, record_type: 'workbuddy-sanitized-observation', bundle_id: 'bundle:workbuddy:001',
    observation_id: 'obs:workbuddy:001', host: 'workbuddy', build: 'build:current', session_id: 'session:current',
    observed_at: OBSERVED_AT, expires_at: EXPIRES_AT,
    ledger_link: { owner: 'run-ledger', effect: 'reference-only', run_id: 'run-todo18', event_id: event.event_id, event_sha256: sha(eventLine) },
    surfaces, permission_selection: 'not-performed', invocation: 'not-performed',
    host_readiness: { status: 'pending', scope: 'observation-only' }, promotion: 'prohibited',
  };
  fs.writeFileSync(observationPath, `${JSON.stringify(observation)}\n`);
  return { sandbox, receiptPath, observationPath, eventsPath, outputPath, observation };
}

function run(f) {
  return spawnSync(process.execPath, [CLI, 'observe', '--release-root', RELEASE_ROOT,
    '--marketplace-receipt', f.receiptPath, '--observation', f.observationPath,
    '--run-events', f.eventsPath, '--output', f.outputPath, '--now', NOW, '--json'], { encoding: 'utf8' });
}

function writeObservation(f) {
  fs.writeFileSync(f.observationPath, `${JSON.stringify(f.observation)}\n`);
}

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
