'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const PLUGIN = path.resolve(__dirname, '..');
const HOOK = path.join(PLUGIN, 'scripts', 'hooks', 'user-prompt-submit.sh');
const VERIFICATION_MCP = path.join(PLUGIN, 'mcp', 'verification', 'server.sh');

function sha(value) {
  return 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
}

function runtimeContext() {
  const binding = {
    plan_hash: sha('plan'), git_head: 'a'.repeat(40), package_version: '1.2.0',
    task_namespace: 'task-10', capability_fingerprint: sha('capability'),
    context_digest: sha('context'),
  };
  const summary = { next_action: 'continue targeted criterion' };
  const context_state = 'fresh-handoff';
  return {
    current: binding,
    handoff: {
      schema_version: 'lazyseries.handoff-snapshot.v1', binding, context_state, summary,
      snapshot_sha256: sha(JSON.stringify({ binding, context_state, summary })),
    },
    capacity: { available: true },
  };
}

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-runtime-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', root]);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'fixture\n');
  spawnSync('git', ['-C', root, 'add', 'tracked.txt']);
  spawnSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'fixture']);
  return root;
}

function run(root, runtime_freshness) {
  const payload = { event: 'user_prompt_submit', cwd: root, session_id: 'todo10-entry', prompt: 'Fix the bounded task.', runtime_freshness };
  const completed = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CWD: root, CODEBUDDY_PLUGIN_ROOT: PLUGIN },
  });
  assert.equal(completed.status, 0, completed.stderr);
  return JSON.parse(completed.stdout);
}

test('shipped prompt hook resumes fresh handoff without replay', t => {
  const output = run(project(t), runtimeContext());
  assert.equal(output.continuation, 'resumed');
  assert.equal(output.runtimeFreshness.replay_required, false);
});

test('shipped prompt hook blocks every stale binding and compressed context', t => {
  const root = project(t);
  for (const field of ['plan_hash', 'git_head', 'package_version', 'task_namespace', 'capability_fingerprint', 'context_digest']) {
    const context = runtimeContext();
    context.current[field] += '-stale';
    const output = run(root, context);
    assert.equal(output.dispatched, 'blocked:stale-context', field);
    assert.equal(output.runtimeFreshness.requires_handoff_snapshot, true, field);
  }
  const cached = runtimeContext();
  cached.handoff.context_state = 'compressed-session-cache';
  assert.equal(run(root, cached).dispatched, 'blocked:stale-context');
});

test('shipped prompt hook blocks quota before presenting ready work', t => {
  const context = runtimeContext();
  context.capacity = { available: false, reason: 'quota-denied' };
  const output = run(project(t), context);
  assert.equal(output.dispatched, 'blocked:capacity');
  assert.equal(output.runtimeFreshness.completion, 'blocked');
});

test('shipped verification MCP namespaces evidence, blocks collision, escalates repeated flake, and blocks quota', t => {
  const root = project(t);
  const base = { task_namespace: 'task-10', criterion_id: 'criterion-a', worker_id: 'worker-a', evidence_name: 'result.log', status: 'passed', bytes: 'first', capacity: { available: true } };
  const calls = [
    base,
    { ...base, bytes: 'overwrite' },
    { ...base, evidence_name: 'flake.log', status: 'failed', flake_assertion: 'same assertion', bytes: 'failure one' },
    { ...base, evidence_name: 'flake.log', status: 'failed', flake_assertion: 'same assertion', bytes: 'failure two' },
    { ...base, evidence_name: 'quota.log', capacity: { available: false, reason: 'quota-denied' } },
  ].map((arguments_, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'record_criterion_result', arguments: arguments_ } }));
  const completed = spawnSync('bash', [VERIFICATION_MCP], {
    cwd: root, input: calls.join('\n') + '\n', encoding: 'utf8',
    env: { ...process.env, CWD: root, CODEBUDDY_PLUGIN_ROOT: PLUGIN },
  });
  assert.equal(completed.status, 0, completed.stderr);
  const responses = completed.stdout.trim().split('\n').map(JSON.parse);
  assert.match(JSON.stringify(responses[0].result), /task-10.*criterion-a.*worker-a/);
  assert.match(responses[1].error.message, /EVIDENCE_NAME_COLLISION/);
  assert.match(JSON.stringify(responses[2].result), /retryable/);
  assert.match(JSON.stringify(responses[3].result), /comprehensive/);
  assert.match(JSON.stringify(responses[4].result), /quota-denied/);
});
