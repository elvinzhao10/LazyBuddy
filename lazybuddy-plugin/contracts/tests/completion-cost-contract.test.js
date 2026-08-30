'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const contracts = path.resolve(__dirname, '..');
const completionFixtures = path.join(contracts, 'fixtures', 'completion-evidence-v1');
const costFixtures = path.join(contracts, 'fixtures', 'cost-outcome-v1');
const validatorPath = path.join(contracts, 'validate-lazyseries-record.js');
const context = {
  projectRoot: completionFixtures,
  repoHead: 'a'.repeat(40),
  packageVersion: '1.2.0',
  criterionId: 'criterion-contracts',
};

function readFixture(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

function validator() {
  return require(validatorPath);
}

test('accepts canonical revision-bound completion evidence', () => {
  // Given: a completion record bound to a real artifact and current identity.
  const record = readFixture(completionFixtures, 'valid.json');
  // When: the record crosses the completion-evidence validator boundary.
  const result = validator().validateCompletionEvidence(record, context);
  // Then: the canonical record is accepted without diagnostics.
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('refuses every hostile completion-evidence fixture with a field-specific error', async (t) => {
  const cases = [
    ['tampered-artifact.json', 'artifact.sha256'],
    ['wrong-head.json', 'repo_head'],
    ['wrong-version.json', 'package_version'],
    ['wrong-criterion.json', 'criterion_id'],
    ['nonzero-exit.json', 'exit_code'],
    ['missing-review.json', 'review'],
    ['same-executor-verifier.json', 'verifier.identity'],
    ['extra-key.json', 'unexpected'],
  ];
  for (const [name, expected] of cases) {
    await t.test(name, () => {
      // Given: one independently hostile completion record.
      const record = readFixture(completionFixtures, name);
      // When: validation binds it to the current task context and artifact bytes.
      const result = validator().validateCompletionEvidence(record, context);
      // Then: validation fails closed and identifies the affected field.
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), new RegExp(expected.replace('.', '\\.')));
    });
  }
});

test('accepts native and explicitly unavailable token cost records', () => {
  // Given: canonical native-token and null-token records.
  const records = ['valid-native-token.json', 'valid-null-token.json']
    .map((name) => readFixture(costFixtures, name));
  // When: each record crosses the cost/outcome validator boundary.
  const results = records.map((record) => validator().validateCostOutcome(record));
  // Then: both supported token provenance variants are accepted.
  assert.deepEqual(results, [{ ok: true, errors: [] }, { ok: true, errors: [] }]);
});

test('refuses estimated tokens, home or secret identity, and extra cost keys', async (t) => {
  const cases = [
    ['estimated-token.json', 'tokens.source'],
    ['secret-home-path.json', 'project_identity'],
    ['secret-value.json', 'project_identity'],
    ['extra-key.json', 'unexpected'],
  ];
  for (const [name, expected] of cases) {
    await t.test(name, () => {
      // Given: one independently hostile cost/outcome record.
      const record = readFixture(costFixtures, name);
      // When: the record crosses the strict validator boundary.
      const result = validator().validateCostOutcome(record);
      // Then: it is rejected with a field-specific diagnostic.
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), new RegExp(expected.replace('.', '\\.')));
    });
  }
});

test('exposes a real CLI that returns nonzero for artifact tampering', () => {
  // Given: canonical and tampered records plus their real artifact tree.
  const args = ['completion', '--project-root', completionFixtures,
    '--repo-head', context.repoHead, '--package-version', context.packageVersion,
    '--criterion-id', context.criterionId];
  // When: the CLI validates each record in a separate process.
  const valid = spawnSync(process.execPath, [validatorPath, ...args, path.join(completionFixtures, 'valid.json')], { encoding: 'utf8' });
  const tampered = spawnSync(process.execPath, [validatorPath, ...args, path.join(completionFixtures, 'tampered-artifact.json')], { encoding: 'utf8' });
  // Then: success and tampering are distinguished by status and field-specific stderr.
  assert.equal(valid.status, 0, valid.stderr);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /artifact\.sha256/);
});
