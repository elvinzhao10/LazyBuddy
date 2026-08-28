'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const runtime = require('../scripts/runtime-freshness');

const digest = (character) => `sha256:${character.repeat(64)}`;
const binding = () => ({
  plan_hash: digest('1'),
  git_head: 'a'.repeat(40),
  package_version: '1.2.0',
  task_namespace: 'task-10',
  capability_fingerprint: digest('2'),
  context_digest: digest('3'),
});

test('fresh direct continuation uses its handoff snapshot without full replay', () => {
  const handoff = runtime.createHandoffSnapshot(binding(), { next_action: 'run targeted test' });
  const result = runtime.resumeContinuation({ current: binding(), handoff, capacity: { available: true } });
  assert.deepEqual(result, {
    status: 'resumed', completion: 'eligible', replay_required: false,
    context_source: 'handoff-snapshot', next_action: 'run targeted test',
  });
});

test('current binding derives repository identity and rejects tracked dirty input', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  require('node:child_process').execFileSync('git', ['init', '-q', root]);
  fs.writeFileSync(path.join(root, 'plan.md'), 'bounded plan\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.0"}\n');
  require('node:child_process').execFileSync('git', ['-C', root, 'add', 'plan.md', 'package.json']);
  require('node:child_process').execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const current = runtime.createCurrentBinding({
    repo_root: root, plan_path: 'plan.md', package_path: 'package.json',
    task_namespace: 'task-10', capability_fingerprint: digest('2'), context: { session: 'fresh' },
  });
  assert.equal(current.git_head, require('node:child_process').execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(current.package_version, '1.2.0');
  assert.match(current.plan_hash, /^sha256:[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(root, 'plan.md'), 'dirty plan\n');
  assert.throws(() => runtime.createCurrentBinding({
    repo_root: root, plan_path: 'plan.md', package_path: 'package.json',
    task_namespace: 'task-10', capability_fingerprint: digest('2'), context: { session: 'fresh' },
  }), /DIRTY_REPOSITORY/);
});

test('every binding and stale compressed context rejects resume and requires a handoff', () => {
  const fields = ['plan_hash', 'git_head', 'package_version', 'task_namespace', 'capability_fingerprint', 'context_digest'];
  for (const field of fields) {
    const current = binding();
    current[field] = field === 'package_version' ? '1.2.1' : `${current[field]}-changed`;
    const result = runtime.resumeContinuation({
      current, handoff: runtime.createHandoffSnapshot(binding(), { next_action: 'continue' }),
      capacity: { available: true },
    });
    assert.equal(result.status, 'stale', field);
    assert.equal(result.reason, `binding-mismatch:${field}`, field);
    assert.equal(result.requires_handoff_snapshot, true, field);
    assert.equal(result.completion, 'blocked', field);
  }
  const compressed = runtime.createHandoffSnapshot(binding(), { next_action: 'continue' });
  compressed.context_state = 'compressed-session-cache';
  const stale = runtime.resumeContinuation({ current: binding(), handoff: compressed, capacity: { available: true } });
  assert.equal(stale.reason, 'stale-context:compressed-session-cache');
  assert.equal(stale.requires_handoff_snapshot, true);
});

test('quota and capacity denial preflight as blocked and never partial ready', () => {
  const handoff = runtime.createHandoffSnapshot(binding(), { next_action: 'continue' });
  for (const capacity of [
    { available: false, reason: 'quota-denied' },
    { available: true, required_bytes: 10, remaining_bytes: 9 },
  ]) {
    const result = runtime.resumeContinuation({ current: binding(), handoff, capacity });
    assert.equal(result.status, 'blocked');
    assert.equal(result.completion, 'blocked');
    assert.notEqual(result.completion, 'ready');
  }
});

test('parallel criteria and duplicate names retain distinct immutable evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-freshness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const records = await Promise.all([
    runtime.recordCriterionEvidence(root, { task_namespace: 'task-10', criterion_id: 'criterion-a', worker_id: 'worker-1', name: 'result.log', bytes: 'alpha' }),
    runtime.recordCriterionEvidence(root, { task_namespace: 'task-10', criterion_id: 'criterion-b', worker_id: 'worker-2', name: 'result.log', bytes: 'beta' }),
  ]);
  assert.notEqual(records[0].path, records[1].path);
  assert.notEqual(records[0].sha256, records[1].sha256);
  assert.equal(fs.readFileSync(records[0].path, 'utf8'), 'alpha');
  assert.equal(fs.readFileSync(records[1].path, 'utf8'), 'beta');
  assert.throws(() => runtime.recordCriterionEvidence(root, {
    task_namespace: 'task-10', criterion_id: 'criterion-a', worker_id: 'worker-1', name: 'result.log', bytes: 'overwrite',
  }), /EVIDENCE_NAME_COLLISION/);
  assert.equal(fs.readFileSync(records[0].path, 'utf8'), 'alpha');
});

test('one identical flake gets one clean retry; the second blocks comprehensive with both artifacts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-flake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = runtime.recordFlakeFailure(root, {
    task_namespace: 'task-10', criterion_id: 'criterion-a', assertion: 'same assertion', bytes: 'failure one',
  });
  assert.equal(first.status, 'retryable');
  assert.equal(first.retry, 1);
  assert.equal(first.clean_namespace, true);
  assert.equal(fs.existsSync(first.retry_namespace), true);
  const second = runtime.recordFlakeFailure(root, {
    task_namespace: 'task-10', criterion_id: 'criterion-a', assertion: 'same assertion', bytes: 'failure two',
  });
  assert.equal(second.status, 'blocked');
  assert.equal(second.route, 'comprehensive');
  assert.equal(second.artifacts.length, 2);
  assert.deepEqual(second.artifacts.map((item) => fs.readFileSync(item.path, 'utf8')), ['failure one', 'failure two']);
});
