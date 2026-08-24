'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv = require('ajv');

const contracts = path.join(__dirname, '..', 'contracts');
const fixtures = path.join(contracts, 'fixtures', 'lifecycle-v2');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function declared(file) {
  return fs.readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0];
}

test('validates mirrored v2 active and receipt contracts with checksummed adversarial fixtures', () => {
  // Given: the v2 schemas, their sidecars, and the checksummed fixture manifest.
  const activeSchemaPath = path.join(contracts, 'lazy-harness-active.v2.schema.json');
  const receiptSchemaPath = path.join(contracts, 'lazy-harness-lifecycle.v2.schema.json');
  const active = readJson(path.join(fixtures, 'active-valid.json'));
  const receipt = readJson(path.join(fixtures, 'receipt-valid.json'));
  const adversarial = readJson(path.join(fixtures, 'version-adversarial.json'));
  const checksums = new Map(fs.readFileSync(path.join(fixtures, 'sha256sums.txt'), 'utf8').trim().split('\n')
    .map((line) => line.split('  ')).map(([checksum, name]) => [name, checksum]));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateActive = ajv.compile(readJson(activeSchemaPath));
  const validateReceipt = ajv.compile(readJson(receiptSchemaPath));

  // When: valid and deliberately version-tampered records cross the schema boundary.
  const activeValid = validateActive(active);
  const receiptValid = validateReceipt(receipt);

  // Then: canonical records and checksums pass while every unknown or mismatched version fails.
  assert.equal(activeValid, true, JSON.stringify(validateActive.errors));
  assert.equal(receiptValid, true, JSON.stringify(validateReceipt.errors));
  assert.equal(digest(activeSchemaPath), declared(activeSchemaPath));
  assert.equal(digest(receiptSchemaPath), declared(receiptSchemaPath));
  for (const [name, checksum] of checksums) assert.equal(digest(path.join(fixtures, name)), checksum, name);
  for (const mutation of adversarial.active) {
    const invalid = structuredClone(active);
    invalid[mutation.path[0]] = mutation.value;
    assert.equal(validateActive(invalid), false, mutation.id);
  }
  for (const mutation of adversarial.receipt) {
    const invalid = structuredClone(receipt);
    invalid[mutation.path[0]] = mutation.value;
    assert.equal(validateReceipt(invalid), false, mutation.id);
  }
  assert.equal(receipt.created_files_scope, 'release-only');
  assert.equal(receipt.created_files.some((item) => item.path === 'launcher.js'), false);
});
