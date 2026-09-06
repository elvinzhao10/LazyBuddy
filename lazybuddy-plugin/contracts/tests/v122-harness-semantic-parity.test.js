const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixtureRoot = path.join(__dirname, '..', 'fixtures');

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, ...segments), 'utf8'));
}

test('v1.2.1 semantic projection compares decisions without host state bytes', () => {
  const parity = readJson('v122', 'harness-semantic-parity.json');
  const valid = readJson('v103', '01-direct-localized-fix.json');
  const stale = readJson('v103', '10-responsibility-ownership.json');
  const resumed = readJson('v103', '06-long-horizon-migration.json');
  const completionReasons = readJson('v120', 'completion-assessment-reasons.json');

  assert.equal(parity.schema_version, 'lazyseries.harness-semantic-parity.v1');
  assert.equal(parity.native_state_format, 'lazybuddy-run-authority');
  assert.deepEqual(parity.cases.valid.adaptive, {
    mode: valid.expected_decision.mode,
    approval: valid.expected_decision.approval_required ? 'pending' : 'not-required',
    escalation_count: valid.expected_snapshot.adaptive.escalationCount,
  });
  assert.deepEqual(parity.cases.stale.adaptive, {
    continuation: 'reclassified',
    prior_completion: stale.continuation_case.priorCompletionEvidence,
    approval: 're-evaluated',
  });
  assert.deepEqual(parity.cases.resumed.adaptive, {
    mode: resumed.expected_decision.mode,
    continuation: 'resumed',
    preserves_current_stage: true,
  });
  assert.equal(completionReasons.includes(parity.cases.stale.completion.reason_code), true);
  assert.equal(completionReasons.includes(parity.cases.missing_identity.completion.reason_code), true);
  assert.deepEqual(parity.cases.valid.completion, parity.cases.completed.completion);
  assert.equal(parity.semantic_projection.max_auto_escalations, 2);
  assert.equal(parity.semantic_projection.product_review_roles.length, 5);
  assert.equal(new Set(parity.semantic_projection.product_review_roles).size, 5);
  assert.equal(parity.cases.completed.memory, parity.semantic_projection.memory_acceptance);
});
