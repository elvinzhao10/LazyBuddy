'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_ROOT = path.dirname(PLUGIN_ROOT);
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-workbuddy-observation.js');
const MANIFEST = path.join(PLUGIN_ROOT, '.workbuddy-plugin', 'plugin.json');
const NOW = '2026-08-14T12:10:00Z';
const OBSERVED_AT = '2026-08-14T12:05:00Z';
const EXPIRES_AT = '2026-08-14T13:05:00Z';
const DIGEST = 'a'.repeat(64);
const SAFE_CONNECTOR_REFERENCE = `connector:redacted:v1:${'1'.repeat(64)}`;

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
  ['connectors', 'observe-only', { entries: [{ connector_id: SAFE_CONNECTOR_REFERENCE, type_id: 'mcp', name_digest: DIGEST, status: 'connected' }] }],
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

module.exports = { SAFE_CONNECTOR_REFERENCE, SURFACES, fixture, run, writeObservation };
