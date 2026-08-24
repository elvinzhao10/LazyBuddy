const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractRoot = __dirname;
const fixtureRoot = path.join(contractRoot, 'fixtures', 'host-evidence-v1');
const {
  RAW_EVENTS,
  RAW_EVENT_MAPPING,
  canonicalizeEvent,
  createPendingOnboardingReceipts,
  validateHostObservation,
  validateMirrorRecord,
  validateOnboardingReceipt,
} = require('./lazyseries-host-evidence.v1');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

test('publishes four parseable schemas and the exact canonical vocabulary', () => {
  // Given: the shared schema set and machine-readable event vocabulary.
  const schemaNames = ['canonical-event', 'host-observation', 'generated-mirror', 'onboarding-receipt'];
  const schemas = schemaNames.map(name => JSON.parse(fs.readFileSync(path.join(contractRoot, `lazyseries-${name}.v1.schema.json`), 'utf8')));
  const vocabulary = JSON.parse(fs.readFileSync(path.join(contractRoot, 'lazyseries-host-event-vocabulary.v1.json'), 'utf8'));

  // When: consumers enumerate the contract artifacts.
  const canonicalValues = schemas[0].properties.canonical_event.enum;

  // Then: all 25 raw events map exactly once plus explicit unsupported.
  assert.equal(schemas.length, 4);
  assert.deepEqual(vocabulary.raw_events, RAW_EVENTS);
  assert.equal(new Set(vocabulary.raw_events).size, 25);
  assert.deepEqual(new Set(canonicalValues), new Set([...Object.values(RAW_EVENT_MAPPING), 'unsupported']));
});

test('round trips sanitized host evidence while retaining host authority', () => {
  // Given: sanitized current host evidence and generated package mirrors.
  const observation = fixture('valid-host-observation.json');
  const mirror = fixture('valid-generated-mirror.json');
  const receipt = fixture('valid-onboarding-receipt.json');

  // When: each record crosses the shared validator boundary.
  const parsedObservation = validateHostObservation(observation, { now: '2026-08-03T10:00:00Z' });
  const parsedMirror = validateMirrorRecord(mirror, { now: '2026-08-03T10:00:00Z' });
  const parsedReceipt = validateOnboardingReceipt(receipt, { now: '2026-08-03T10:00:00Z' });
  const roundTrippedObservation = validateHostObservation(JSON.parse(JSON.stringify(parsedObservation)), { now: '2026-08-03T10:00:00Z' });

  // Then: parsed observable state remains host-authoritative and current.
  assert.equal(parsedObservation.surface.host_authority, 'host');
  assert.equal(parsedObservation.status, 'observed');
  assert.deepEqual(roundTrippedObservation, parsedObservation);
  assert.equal(parsedMirror.surface.host_authority, 'host');
  assert.equal(parsedReceipt.status, 'observed');
});

test('canonical event replay is idempotent and unknown raw events are unsupported', () => {
  // Given: one supported event and an already-seen event-id set.
  const input = fixture('valid-canonical-event.json');
  const seen = new Set();

  // When: the event is delivered twice and an unknown raw event is parsed.
  const first = canonicalizeEvent(input, { seen, now: '2026-08-03T10:00:00Z' });
  const duplicate = canonicalizeEvent(input, { seen, now: '2026-08-03T10:00:00Z' });
  const unsupported = canonicalizeEvent(fixture('unsupported-event.json'), { seen, now: '2026-08-03T10:00:00Z' });
  const rawUnsupported = fixture('unsupported-event.json');
  delete rawUnsupported.canonical_event;
  const mappedUnsupported = canonicalizeEvent(rawUnsupported, { seen: new Set(), now: '2026-08-03T10:00:00Z' });

  // Then: replay is explicit and unknown input maps to unsupported.
  assert.equal(first.outcome, 'accepted');
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(unsupported.event.canonical_event, 'unsupported');
  assert.equal(mappedUnsupported.event.canonical_event, 'unsupported');
  assert.equal(seen.size, 2);
});

test('rejects secrets stale receipts forged authority malformed data and raw prompts', () => {
  // Given: adversarial fixtures at each trust boundary.
  const cases = [
    ['secret-payload.json', value => canonicalizeEvent(value, { seen: new Set(), now: '2026-08-03T10:00:00Z' }), /secret/i],
    ['raw-prompt.json', value => canonicalizeEvent(value, { seen: new Set(), now: '2026-08-03T10:00:00Z' }), /forbidden/i],
    ['stale-onboarding-receipt.json', value => validateOnboardingReceipt(value, { now: '2026-08-03T10:00:00Z' }), /stale/i],
    ['forged-authority.json', value => validateMirrorRecord(value, { now: '2026-08-03T10:00:00Z' }), /authority/i],
    ['malformed-event.json', value => canonicalizeEvent(value, { seen: new Set(), now: '2026-08-03T10:00:00Z' }), /event_id/i],
  ];

  // When/Then: every hostile record fails closed at the parser boundary.
  for (const [name, action, expected] of cases) assert.throws(() => action(fixture(name)), expected);
});

test('six package-generated onboarding templates remain pending', () => {
  // Given: no current live-host evidence.
  // When: the package creates onboarding templates.
  const receipts = createPendingOnboardingReceipts({ generatedAt: '2026-08-03T10:00:00Z' });

  // Then: exactly six hosts remain pending with no evidence claim.
  assert.equal(receipts.length, 6);
  assert.equal(new Set(receipts.map(receipt => receipt.host)).size, 6);
  assert.ok(receipts.every(receipt => validateOnboardingReceipt(receipt, { now: '2026-08-03T10:00:00Z' }).status === 'pending'));
  assert.ok(receipts.every(receipt => receipt.current_host_evidence === null));
});

test('receipt promotion requires current freshness and unsupported remains evidence-free', () => {
  // Given: a forged observed promotion and an explicit unsupported receipt.
  const forged = fixture('forged-observed-pending-freshness.json');
  const unsupported = fixture('unsupported-onboarding-receipt.json');
  const schema = JSON.parse(fs.readFileSync(path.join(contractRoot, 'lazyseries-onboarding-receipt.v1.schema.json'), 'utf8'));

  // When/Then: promotion fails while unsupported remains a coherent evidence-free state.
  assert.throws(() => validateOnboardingReceipt(forged, { now: '2026-08-03T10:00:00Z' }), /current freshness/i);
  const parsed = validateOnboardingReceipt(unsupported, { now: '2026-08-03T10:00:00Z' });
  assert.equal(parsed.status, 'unsupported');
  assert.equal(parsed.current_host_evidence, null);
  assert.equal(parsed.surface.freshness.status, 'pending');
  assert.deepEqual(schema.allOf[0].if.properties.status, { const: 'observed' });
  assert.equal(schema.allOf[0].then.properties.surface.properties.freshness.properties.status.const, 'current');
  assert.equal(schema.allOf[0].then.properties.current_host_evidence.type, 'object');
  assert.deepEqual(schema.allOf[1].if.properties.status.enum, ['pending', 'unsupported']);
  assert.equal(schema.allOf[1].then.properties.surface.properties.freshness.properties.status.const, 'pending');
  assert.equal(schema.allOf[1].then.properties.current_host_evidence.type, 'null');
});
