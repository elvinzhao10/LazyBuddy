'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');
const runner = path.join(pluginRoot, 'scripts', 'efficiency-baseline-runner.js');
const fixtures = path.join(__dirname, 'fixtures', 'efficiency');
const { validateResult } = require(runner);

const evalRoot = path.join(fixtures, 'evals');

function invoke(fixturePath, rootPath = evalRoot) {
  return spawnSync(process.execPath, [runner, fixturePath, '--eval-root', rootPath], {
    cwd: pluginRoot,
    encoding: 'utf8',
  });
}

test('emits schema-valid direct baseline when fixture is complete', () => {
  // Given
  const fixture = path.join(fixtures, 'direct.json');
  // When
  const result = invoke(fixture);
  // Then
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(validateResult(output), output);
  assert.equal(output.scenario, 'direct');
  assert.equal(output.outcome.quality_equivalent, true);
  assert.equal(output.outcome.assertions_passed, 13);
  assert.equal(output.cost.tokens.total, null);
  assert.equal(output.route.actor_count, 1);
});

test('emits deterministic six-module baseline for three runs', () => {
  // Given
  const fixture = path.join(fixtures, 'six-module.json');
  // When
  const results = [invoke(fixture), invoke(fixture), invoke(fixture)];
  // Then
  assert.deepEqual(results.map((result) => result.status), [0, 0, 0]);
  assert.equal(results[0].stdout, results[1].stdout);
  assert.equal(results[1].stdout, results[2].stdout);
  const output = JSON.parse(results[0].stdout);
  assert.equal(validateResult(output), output);
  assert.equal(output.outcome.assertions_expected, 57);
  assert.equal(output.outcome.assertions_passed, 57);
  assert.equal(output.outcome.required_evidence_present, true);
});

test('rejects fixture when gate outcomes are omitted', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  delete fixture.gate_outcomes;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'missing-gates.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gate_outcomes/);
});

test('rejects misleading completion when exact assertions failed', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'six-module.json'), 'utf8'));
  fixture.quality.assertions_expected = 56;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const misleading = path.join(tempDir, 'misleading-success.json');
  fs.writeFileSync(misleading, JSON.stringify(fixture));
  // When
  const result = invoke(misleading);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertion_manifest/);
});

test('rejects malformed fixture JSON', (t) => {
  // Given
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'malformed.json');
  fs.writeFileSync(malformed, '{');
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid JSON/);
});

test('rejects direct fixture when actor count is not exactly one', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.route.actor_count = 2;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'two-actor-direct.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one actor/);
});

test('rejects unavailable token telemetry without null and reason', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.cost.tokens.total = 1;
  delete fixture.cost.tokens.reason;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'invalid-tokens.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tokens.total/);
});

test('rejects baseline when an assertion manifest file is absent', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.quality.assertion_manifest[0].file = 'absent-test.py';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'absent-assertion.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertion_manifest/);
});

test('rejects baseline when an assertion manifest digest is stale', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.quality.assertion_manifest[0].sha256 = '0'.repeat(64);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'stale-assertion-digest.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256/);
});

test('rejects baseline when required evidence is absent', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.quality.required_evidence[0].file = 'absent-evidence.txt';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'absent-evidence.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required_evidence/);
});

test('rejects baseline when assertion output is stale', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.quality.assertion_output = fixture.quality.required_evidence[1].file;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'stale-assertion-output.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertion_output/);
});

test('rejects cross-product assertion artifact despite valid digest', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.quality.assertion_manifest[0].file = 'lazytrae-liveeval/runs/direct-20260827T115134/tests/test_parse_duration.py';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'cross-product.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertion_manifest.*product namespace/);
});

test('rejects fixture whose product does not match the runner', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  fixture.product = 'lazytrae';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const malformed = path.join(tempDir, 'mismatched-product.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /product.*runner expects lazybuddy/);
});

test('rejects assertion symlink resolving into sibling product namespace', (t) => {
  // Given
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'direct.json'), 'utf8'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const ownRoot = path.join(tempDir, 'lazybuddy-liveeval');
  const siblingRoot = path.join(tempDir, 'lazytrae-liveeval');
  fs.mkdirSync(ownRoot);
  fs.mkdirSync(siblingRoot);
  const siblingFile = path.join(siblingRoot, 'test_parse_duration.py');
  fs.copyFileSync(path.join(evalRoot, 'lazybuddy-liveeval/runs/direct-20260828T0348/repo/tests/test_parse_duration.py'), siblingFile);
  const linkedFile = path.join(ownRoot, 'linked-test.py');
  fs.symlinkSync(siblingFile, linkedFile);
  fixture.quality.assertion_manifest[0].file = 'lazybuddy-liveeval/linked-test.py';
  const malformed = path.join(tempDir, 'sibling-symlink.json');
  fs.writeFileSync(malformed, JSON.stringify(fixture));
  // When
  const result = invoke(malformed, tempDir);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertion_manifest.*product namespace/);
});
