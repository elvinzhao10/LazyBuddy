'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const contracts = path.resolve(__dirname, '..');
const evaluation = require(path.join(contracts, 'outcome-evaluation.js'));
const fixtureRoot = path.join(contracts, 'fixtures', 'outcome-evaluation-v1');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function copiedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-evaluation-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

test('reports measured cost only for validated completion evidence', () => {
  // Given
  const record = fixture('manifest.json');
  // When
  const result = evaluation.evaluateManifest(record, fixtureRoot);
  // Then
  assert.equal(result.outcome_evidence_integrity, 'partial');
  assert.deepEqual(result.conditions['host-only'], {
    run_count: 1,
    verified_completions: 1,
    native_input_tokens: null,
    native_output_tokens: null,
    total_native_cost_microusd: null,
    cost_per_verified_completion_microusd: null,
    unknowns: [
      'tokens: runtime did not expose native token counts',
      'cost: host did not expose billed cost',
    ],
  });
  assert.equal(result.conditions.minimal.run_count, 2);
  assert.equal(result.conditions.minimal.native_input_tokens, 150);
  assert.equal(result.conditions.minimal.cost_per_verified_completion_microusd, 2200);
  assert.equal(result.conditions['full-lazy'].cost_per_verified_completion_microusd, 2100);
});

test('refuses an outcome reference whose bytes do not match the supplied digest', () => {
  // Given
  const record = fixture('manifest.json');
  record.runs[0].outcome.evidence.sha256 = '0'.repeat(64);
  // When / Then
  assert.throws(() => evaluation.evaluateManifest(record, fixtureRoot), /outcome\.evidence\.sha256/);
});

test('rejects a replayed run and exposes read-only CLI help', () => {
  // Given
  const record = fixture('manifest.json');
  record.runs.push(structuredClone(record.runs[1]));
  // When
  const help = spawnSync(process.execPath, [path.join(contracts, 'outcome-evaluation.js'), '--help'], { encoding: 'utf8' });
  // Then
  assert.throws(() => evaluation.evaluateManifest(record, fixtureRoot), /must not be replayed/);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--evidence-root/);
});

test('refuses comparisons with mismatched model provenance', () => {
  // Given
  const record = fixture('manifest.json');
  record.runs[3].cohort.model_id = 'gpt-5.7';
  // When / Then
  assert.throws(() => evaluation.evaluateManifest(record, fixtureRoot), /must match host, model, task, budget, and permissions snapshots/);
});

test('refuses forged cohort digests that are not bound to snapshot bytes', () => {
  const record = fixture('manifest.json');
  for (const run of record.runs) {
    run.cohort.task_snapshot.sha256 = 'f'.repeat(64);
    run.cohort.budget_snapshot.sha256 = 'e'.repeat(64);
    run.cohort.permissions_snapshot.sha256 = 'd'.repeat(64);
  }
  assert.throws(() => evaluation.evaluateManifest(record, fixtureRoot), /cohort\.task_snapshot\.sha256/);
});

test('refuses missing, changed, and outside cohort snapshot references', (t) => {
  const missing = fixture('manifest.json');
  delete missing.runs[0].cohort.budget_snapshot;
  assert.throws(() => evaluation.evaluateManifest(missing, fixtureRoot), /cohort: has unexpected or missing fields/);

  const changedRoot = copiedFixture(t);
  fs.appendFileSync(path.join(changedRoot, 'snapshots', 'task.json'), ' ');
  const changed = JSON.parse(fs.readFileSync(path.join(changedRoot, 'manifest.json'), 'utf8'));
  assert.throws(() => evaluation.evaluateManifest(changed, changedRoot), /cohort\.task_snapshot\.sha256/);

  const outside = fixture('manifest.json');
  outside.runs[0].cohort.permissions_snapshot.path = 'snapshots/../../../permissions.json';
  assert.throws(() => evaluation.evaluateManifest(outside, fixtureRoot), /cohort\.permissions_snapshot\.path: must remain below evidence root/);
});

test('reports partial or absent outcome evidence instead of unconditional validation', () => {
  const mixed = fixture('manifest.json');
  const absent = structuredClone(mixed);
  for (const run of absent.runs) {
    run.outcome = { state: 'unverified', unavailable_reason: 'no completion evidence supplied' };
  }
  const mixedResult = evaluation.evaluateManifest(mixed, fixtureRoot);
  const absentResult = evaluation.evaluateManifest(absent, fixtureRoot);
  const validatedResult = evaluation.evaluateManifest({ ...mixed, runs: mixed.runs.filter((run) => run.outcome.state === 'verified') }, fixtureRoot);
  assert.equal(mixedResult.outcome_evidence_integrity, 'partial');
  assert.equal(absentResult.outcome_evidence_integrity, 'absent');
  assert.equal(validatedResult.outcome_evidence_integrity, 'validated');
});

test('requires execution scope for every matched outcome record', () => {
  const fixtureValidation = fixture('manifest.json');
  fixtureValidation.runs[0].cost_outcome.measurement_scope = 'fixture-validation';
  assert.throws(() => evaluation.evaluateManifest(fixtureValidation, fixtureRoot), /measurement_scope: must be execution/);

  const unspecified = fixture('manifest.json');
  delete unspecified.runs[0].cost_outcome.measurement_scope;
  assert.throws(() => evaluation.evaluateManifest(unspecified, fixtureRoot), /measurement_scope: must be execution/);
});

test('refuses an outcome path that escapes through a symlinked parent', (t) => {
  // Given
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-evidence-'));
  t.after(() => fs.rmSync(evidenceRoot, { recursive: true }));
  fs.cpSync(path.join(fixtureRoot, 'snapshots'), path.join(evidenceRoot, 'snapshots'), { recursive: true });
  fs.symlinkSync(fixtureRoot, path.join(evidenceRoot, 'escape'), 'dir');
  const record = fixture('manifest.json');
  record.runs[0].outcome.evidence.path = 'escape/evidence/host-only.json';
  // When / Then
  assert.throws(() => evaluation.evaluateManifest(record, evidenceRoot), /after resolving links/);
});
