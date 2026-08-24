'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { SAFE_CONNECTOR_REFERENCE, fixture, run, writeObservation } = require('./helpers/workbuddy-observation-fixture');

function connectorEntry(f) {
  return f.observation.surfaces[10].details.entries[0];
}

function markers(value) {
  if (typeof value === 'string') return [value];
  return [JSON.stringify(value), ...Object.values(value).flat().filter(item => typeof item === 'string')];
}

function assertSanitizedRefusal(result, value) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'WORKBUDDY_SENSITIVE_DATA_REJECTED');
  for (const marker of markers(value)) assert.equal(result.stderr.includes(marker), false);
}

test('portable schema permits only the adapter-issued Connector reference grammar', () => {
  // Given: the machine-consumed Connector pattern from the portable bundle schema.
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'workbuddy-observation-bundle.v1.schema.json')));
  const connector = schema.properties.surfaces.items.allOf[0].then.properties.details.properties.entries.items.properties.connector_id;
  const pattern = new RegExp(connector.pattern);

  // When: a safe reference and a raw namespaced identifier are checked against the schema.
  const safe = pattern.test(SAFE_CONNECTOR_REFERENCE);
  const raw = pattern.test('provider:connector:001');

  // Then: schema acceptance matches the production boundary contract.
  assert.equal(safe, true);
  assert.equal(raw, false);
});

test('real CLI rejects every raw connector identity before publication', (t) => {
  // Given: raw identities spanning opaque, credential, encoding, URL, Unicode, and structured forms.
  const rawIds = [
    'ordinary-opaque-connector',
    'salesforce',
    'provider:connector:001',
    '550e8400-e29b-41d4-a716-446655440000',
    'b'.repeat(64),
    ['ghp', 'a'.repeat(36)].join('_'),
    `oauth.${'c'.repeat(32)}`,
    `api-key-${'d'.repeat(32)}`,
    `sessionid:${'e'.repeat(32)}`,
    `JSESSIONID:${'f'.repeat(32)}`,
    `connect.sid:${'g'.repeat(32)}`,
    `__Host-session:${'h'.repeat(32)}`,
    `Authorization: Bearer ${'i'.repeat(32)}`,
    `eyJ${'j'.repeat(24)}.eyJ${'k'.repeat(24)}.${'l'.repeat(32)}`,
    `https://user:${'m'.repeat(24)}@connector.invalid/path`,
    `https://connector.invalid/path?access_token=${'n'.repeat(24)}`,
    Buffer.from('synthetic-opaque-source').toString('base64'),
    '0123456789abcdef'.repeat(4),
    `%2525${'6f'.repeat(24)}`,
    Buffer.from(Buffer.from('nested-source').toString('base64')).toString('base64'),
    `c\u043ennector:${'o'.repeat(24)}`,
    `connector:redacted:v2:${'1'.repeat(64)}`,
    `connector:redacted:v1:${'2'.repeat(63)}`,
    `connector:redacted:v1:${'A'.repeat(64)}`,
    { marker: 'structured-object-source' },
    ['structured-array-source'],
  ];

  for (const rawId of rawIds) {
    const f = fixture(t);
    const eventBytes = fs.readFileSync(f.eventsPath);
    const receiptBytes = fs.readFileSync(f.receiptPath);
    connectorEntry(f).connector_id = rawId;
    writeObservation(f);

    // When: the real CLI receives the raw identity with an absent output target.
    const result = run(f);

    // Then: refusal is typed and sanitized, with no publication or source-state mutation.
    assertSanitizedRefusal(result, rawId);
    assert.equal(fs.existsSync(f.outputPath), false);
    assert.deepEqual(fs.readFileSync(f.eventsPath), eventBytes);
    assert.deepEqual(fs.readFileSync(f.receiptPath), receiptBytes);

    const caller = fixture(t);
    const callerBytes = Buffer.from('caller-owned\n');
    const callerEventBytes = fs.readFileSync(caller.eventsPath);
    connectorEntry(caller).connector_id = rawId;
    writeObservation(caller);
    fs.writeFileSync(caller.outputPath, callerBytes);
    const callerResult = run(caller);
    assertSanitizedRefusal(callerResult, rawId);
    assert.deepEqual(fs.readFileSync(caller.outputPath), callerBytes);
    assert.deepEqual(fs.readFileSync(caller.eventsPath), callerEventBytes);
  }
});

test('real CLI persists only adapter-issued redacted connector references', (t) => {
  // Given: distinct adapter-issued references for representative raw source categories held outside the observation.
  const cases = [
    ['uuid-source-marker', `connector:redacted:v1:${'1'.repeat(64)}`],
    ['hash-source-marker', `connector:redacted:v1:${'2'.repeat(64)}`],
    ['provider-source-marker', `connector:redacted:v1:${'3'.repeat(64)}`],
    ['namespaced-source-marker', `connector:redacted:v1:${'4'.repeat(64)}`],
    ['account-source-marker', `connector:redacted:v1:${'5'.repeat(64)}`],
    ['workspace-source-marker', `connector:redacted:v1:${'6'.repeat(64)}`],
    ['opaque-source-marker', `connector:redacted:v1:${'7'.repeat(64)}`],
  ];

  for (const [rawMarker, reference] of cases) {
    const f = fixture(t);
    connectorEntry(f).connector_id = reference;
    writeObservation(f);

    // When: the real CLI receives an already-redacted adapter reference.
    const result = run(f);

    // Then: only the reference is published and every connector observation field remains intact.
    assert.equal(result.status, 0, result.stderr);
    const bundle = JSON.parse(result.stdout);
    const surface = bundle.surfaces[10];
    assert.equal(surface.details.entries[0].connector_id, reference);
    assert.equal(surface.details.entries[0].type_id, 'mcp');
    assert.equal(surface.details.entries[0].status, 'connected');
    assert.equal(surface.native_mode, 'observe-only');
    assert.equal(surface.host_authority, 'host');
    assert.equal(surface.package_owner, 'LazyBuddy');
    assert.equal(surface.freshness.status, 'current');
    assert.equal(result.stdout.includes(rawMarker), false);
    assert.equal(result.stderr.includes(rawMarker), false);
    assert.equal(fs.readFileSync(f.outputPath, 'utf8').includes(rawMarker), false);
    assert.equal(fs.readFileSync(f.eventsPath, 'utf8').includes(rawMarker), false);
    assert.equal(fs.readFileSync(f.receiptPath, 'utf8').includes(rawMarker), false);
  }
});
