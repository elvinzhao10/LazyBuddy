'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateCostOutcome } = require('../contracts/validate-lazyseries-record');

const pluginRoot = path.resolve(__dirname, '..');
const runner = path.join(pluginRoot, 'scripts', 'efficiency-baseline-runner.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'efficiency');

function findEvalRoot(start) {
  let current = start;
  while (path.dirname(current) !== current) {
    const candidate = path.join(current, 'evals');
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  throw new Error('evals directory not found');
}

const evalRoot = findEvalRoot(pluginRoot);

function invoke(projectRoot, scenario, runId, env = {}) {
  return spawnSync(process.execPath, [
    runner,
    path.join(fixtureRoot, `${scenario}.json`),
    '--eval-root', evalRoot,
    '--telemetry-root', projectRoot,
    '--run-id', runId,
  ], { cwd: pluginRoot, encoding: 'utf8', env: { ...process.env, ...env } });
}

function readStore(projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, '.lazybuddy', 'state', 'telemetry', 'cost-outcomes.json'), 'utf8'));
}

function assertSchema(record) {
  assert.deepEqual(validateCostOutcome(record), { ok: true, errors: [] });
  assert.deepEqual(Object.keys(record).sort(), [
    'agent_invocations', 'elapsed_ms', 'evidence_bytes', 'gate_outcomes', 'project_identity',
    'reruns', 'rework_count', 'risk_reason', 'route', 'run_id', 'schema_version', 'tokens',
    'tool_invocations',
  ]);
  assert.equal(record.schema_version, 'lazyseries.cost-outcome.v1');
  assert.ok(Number.isInteger(record.elapsed_ms) && record.elapsed_ms >= 0);
}

test('records schema-shaped direct and parallel telemetry without sensitive input', (t) => {
  // Given
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-telemetry-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true }));
  // When
  const direct = invoke(projectRoot, 'direct', 'direct-1', { SECRET_TOKEN: 'sk-abcdefghijklmnopqrstuvwxyz123456' });
  const parallel = invoke(projectRoot, 'six-module', 'parallel-1', { HOME: '/Users/telemetry-secret-home' });
  // Then
  assert.deepEqual([direct.status, parallel.status], [0, 0]);
  const store = readStore(projectRoot);
  assertSchema(store.current_run);
  assert.equal(store.current_run.route, 'comprehensive');
  assert.equal(store.current_run.agent_invocations, 7);
  assert.equal(store.current_run.tokens.input_tokens, null);
  assert.match(store.current_run.tokens.unavailable_reason, /native token telemetry unavailable/);
  assert.equal(store.completed.length, 2);
  assert.doesNotMatch(JSON.stringify(store), /telemetry-secret-home|abcdefghijklmnopqrstuvwxyz123456/);
});

test('retains only latest twenty completed records', (t) => {
  // Given
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-telemetry-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true }));
  // When
  for (let index = 0; index < 22; index += 1) invoke(projectRoot, 'direct', `retention-${index}`);
  // Then
  const store = readStore(projectRoot);
  assert.equal(store.completed.length, 20);
  assert.deepEqual(store.completed.map(({ run_id: runId }) => runId), Array.from({ length: 20 }, (_, index) => `retention-${index + 2}`));
});

test('recovers an interrupted telemetry transaction on the next write', (t) => {
  // Given
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-telemetry-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true }));
  // When
  const interrupted = invoke(projectRoot, 'direct', 'interrupted-1', { LAZYBUDDY_TX_FAULT: 'after-commit' });
  const recovered = invoke(projectRoot, 'direct', 'recovered-1');
  // Then
  assert.equal(interrupted.status, 86);
  assert.equal(recovered.status, 0);
  const store = readStore(projectRoot);
  assert.deepEqual(store.completed.map(({ run_id: runId }) => runId), ['interrupted-1', 'recovered-1']);
});
