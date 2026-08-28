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

function invoke(fixturePath) {
  return spawnSync(process.execPath, [runner, fixturePath], {
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
  fixture.quality.assertions_passed = 56;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-efficiency-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true }));
  const misleading = path.join(tempDir, 'misleading-success.json');
  fs.writeFileSync(misleading, JSON.stringify(fixture));
  // When
  const result = invoke(misleading);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertions_passed/);
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
