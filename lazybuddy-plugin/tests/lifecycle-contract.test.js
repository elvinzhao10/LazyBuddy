'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv = require('ajv');

const contractsDir = path.join(__dirname, '..', 'contracts');
const fixturesDir = path.join(contractsDir, 'fixtures', 'lifecycle-v1');
const schemaPath = path.join(contractsDir, 'lazy-harness-lifecycle.v1.schema.json');
const examplePath = path.join(contractsDir, 'lazy-harness-lifecycle.v1.example.json');
const lockedAdaptiveDigests = {
  'adaptive-harness-contract.v1.json': 'a7091f3a195b8abd1afd5cbe1c40fa0fab844150b41a39bbd689c76be8358d66',
  'adaptive-harness-contract.v1.json.sha256': '3f9871bc63ff52b0807ce383aa5affbb58ff9cd55eb46452ec27106e0208dbbc',
  'adaptive-harness-contract.v1.schema.json': 'ccbf88b35bcc762234f078505356a7bb879247818dc4cf9c0a7230b11a521b92',
  'adaptive-harness-v103-digest.json': 'e5a95c632c5c07a67c6fc2d11ea75cb8683438d3b3297465341ad1f57b072b5f',
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function declaredDigest(file) {
  return fs.readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0];
}

function fixtureChecksums() {
  const entries = new Map();
  const lines = fs.readFileSync(path.join(fixturesDir, 'sha256sums.txt'), 'utf8').trim().split('\n');
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([a-z0-9-]+\.json)$/.exec(line);
    assert.ok(match, `invalid lifecycle fixture checksum line: ${line}`);
    assert.equal(entries.has(match[2]), false, `duplicate lifecycle fixture: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

function applyMutation(source, mutation) {
  const copy = structuredClone(source);
  const field = mutation.path.at(-1);
  const target = mutation.path.slice(0, -1).reduce((value, part) => value[part], copy);
  switch (mutation.operation) {
    case 'delete':
      delete target[field];
      break;
    case 'replace':
      target[field] = mutation.value;
      break;
    default:
      assert.fail(`unknown fixture operation: ${mutation.operation}`);
  }
  return copy;
}

function relationshipErrors(receipt) {
  const errors = [];
  const expectedReleaseId = `${receipt.manifest.version}-${receipt.commit_sha.slice(0, 12)}`;
  if (receipt.release.id !== expectedReleaseId) errors.push('release id does not match version and commit');
  if (receipt.release.path !== `releases/${receipt.release.id}`) errors.push('release path does not match release id');
  if (receipt.active_release !== receipt.release.id) errors.push('active release does not match receipt release');
  if (receipt.previous_release === receipt.active_release) errors.push('previous release must differ from active release');
  if (receipt.layout.product_root !== path.posix.join(receipt.layout.install_root, receipt.product)) {
    errors.push('product root is not contained by install root');
  }
  if (receipt.receipt_path !== `receipts/${receipt.receipt_id}.json`) {
    errors.push('receipt path does not match receipt id');
  }
  if (!receipt.manifest.path.startsWith(`${receipt.release.path}/`)) {
    errors.push('manifest path is outside the release');
  }
  if (receipt.manifest.digests.some((digest) => !digest.path.startsWith(`${receipt.release.path}/`))) {
    errors.push('manifest digest path is outside the release');
  }
  return errors;
}

test('characterizes the locked adaptive harness contract before lifecycle additions', () => {
  // Given: the existing adaptive v1 contract family.
  const actual = Object.fromEntries(Object.keys(lockedAdaptiveDigests).map((name) => [
    name,
    sha256(fs.readFileSync(path.join(contractsDir, name))),
  ]));

  // When: its current bytes are independently fingerprinted.
  // Then: lifecycle work cannot rewrite the locked adaptive contract.
  assert.deepEqual(actual, lockedAdaptiveDigests);
});

test('validates the canonical durable-root receipt and rejects ownership boundary violations', () => {
  // Given: the lifecycle schema, canonical receipt, and adversarial fixture family.
  const schemaBytes = fs.readFileSync(schemaPath);
  const exampleBytes = fs.readFileSync(examplePath);
  const schema = JSON.parse(schemaBytes);
  const example = JSON.parse(exampleBytes);
  const manifest = readJson(path.join(fixturesDir, 'manifest.json'));
  const checksums = fixtureChecksums();
  const ajv = new Ajv({ allErrors: true, schemaId: 'auto', strict: false });
  const validateReceipt = ajv.compile(schema);

  // When: canonical and deliberately invalid receipts cross the schema boundary.
  const canonicalValid = validateReceipt(example);

  // Then: only the contained, product-isolated receipt is accepted.
  assert.equal(canonicalValid, true, JSON.stringify(validateReceipt.errors));
  assert.equal(sha256(schemaBytes), declaredDigest(schemaPath));
  assert.equal(sha256(exampleBytes), declaredDigest(examplePath));
  assert.equal(example.manifest.digests.find((digest) =>
    digest.path.endsWith('/lazy-harness-lifecycle.v1.schema.json')).sha256, sha256(schemaBytes));
  assert.equal(example.layout.product_root,
    path.posix.join(example.layout.install_root, example.product));
  assert.equal(example.release.path, `releases/${example.release.id}`);
  assert.equal(example.active_release, example.release.id);
  assert.deepEqual(relationshipErrors(example), []);
  assert.equal(example.host_evidence.status, 'pending');
  assert.equal(example.host_evidence.observation_receipt, null);
  assert.deepEqual(new Set(manifest.invalid_fixtures.map((entry) => entry.file)),
    new Set([...checksums.keys()].filter((name) => name !== 'manifest.json')));

  for (const entry of manifest.invalid_fixtures) {
    const file = path.join(fixturesDir, entry.file);
    const bytes = fs.readFileSync(file);
    assert.equal(sha256(bytes), checksums.get(entry.file), entry.file);
    if (entry.reason === 'malformed-json') {
      assert.throws(() => JSON.parse(bytes), SyntaxError, entry.file);
      continue;
    }
    const fixture = JSON.parse(bytes);
    for (const mutation of fixture.cases) {
      const invalidReceipt = applyMutation(example, mutation);
      const schemaValid = validateReceipt(invalidReceipt);
      const relationships = schemaValid ? relationshipErrors(invalidReceipt) : [];
      if (mutation.expected_boundary === 'schema') {
        assert.equal(schemaValid, false, `${mutation.id} unexpectedly passed schema validation`);
      } else {
        assert.equal(schemaValid, true, `${mutation.id}: ${JSON.stringify(validateReceipt.errors)}`);
        assert.notDeepEqual(relationships, [], `${mutation.id} unexpectedly passed relationship validation`);
      }
    }
  }
  const manifestBytes = fs.readFileSync(path.join(fixturesDir, 'manifest.json'));
  assert.equal(sha256(manifestBytes), checksums.get('manifest.json'));
});
