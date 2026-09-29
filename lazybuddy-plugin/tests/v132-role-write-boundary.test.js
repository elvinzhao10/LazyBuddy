'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const hook = path.resolve(__dirname, '../scripts/hooks/pre-tool-use.sh');

function callHook(cwd, event, env = {}) {
  return spawnSync('bash', [hook], { cwd, input: JSON.stringify({ cwd, ...event }), encoding: 'utf8', env: { ...process.env, ...env } });
}

function denied(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
}

test('verifier writes only its active run report and alternate identity fields cannot bypass the gate', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-role-write-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const runs = path.join(cwd, '.lazybuddy/runs');
  for (const [id, status] of [['run-one', 'active'], ['run-two', 'done']]) {
    fs.mkdirSync(path.join(runs, id, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(runs, id, 'state.json'), JSON.stringify({ status }));
  }
  const identity = { agent_type: 'generic', agent_name: 'lazybuddy-verifier', tool_name: 'Write' };
  const valid = callHook(cwd, { ...identity, tool_input: { file_path: '.lazybuddy/runs/run-one/evidence/T1.verification.md' } });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.includes('"permissionDecision":"deny"'), false);
  denied(callHook(cwd, { ...identity, tool_input: { file_path: '.lazybuddy/runs/run-two/evidence/T1.verification.md' } }));
  denied(callHook(cwd, { ...identity, tool_input: { file_path: 'product.ts' } }));
  denied(callHook(cwd, { ...identity, tool_name: 'Edit', tool_input: { file_path: '.lazybuddy/runs/run-one/evidence/T1.verification.md' } }));
  denied(callHook(cwd, { ...identity, run_id: 'run-two', tool_input: { file_path: '.lazybuddy/runs/run-one/evidence/T1.verification.md' } }));
  denied(callHook(cwd, { agent_type: 'lazybuddy-orchestrator', tool_name: 'Write', tool_input: { file_path: '.lazybuddy/runs/run-one/evidence/T1.verification.md' } }));
  denied(callHook(cwd, { ...identity, tool_input: { file_path: '.lazybuddy/runs/run-one/evidence/../../../../product.ts' } }));
});

test('a linked state root cannot redirect an orchestrator write', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-linked-root-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const outside = path.join(cwd, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(cwd, '.lazybuddy'));
  denied(callHook(cwd, {
    agent_type_name: 'lazybuddy-orchestrator', tool_name: 'Write',
    tool_input: { file_path: '.lazybuddy/state.json' },
  }));
});

test('restricted identities and malformed mutating input fail through the hook', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-role-input-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const write = { tool_name: 'Write', tool_input: { file_path: 'product.ts' } };
  denied(callHook(cwd, { ...write, agent_type: ' LazyBuddy-Verifier ' }));
  denied(callHook(cwd, { ...write, agent_type: 'lazybuddy-verifier', agent_name: 'lazybuddy-orchestrator' }));
  denied(callHook(cwd, { tool_name: 'Bash', tool_input: { command: 'touch product.ts' }, agent_name: 'lazybuddy-verifier' }));
  denied(callHook(cwd, { tool_name: 'RunCommand', tool_input: { command: 'touch product.ts' }, agent_name: 'lazybuddy-verifier' }));
  denied(callHook(cwd, write, { LAZYBUDDY_RESTRICTED_RUN: '1' }));
  assert.equal(callHook(cwd, write).status, 0);
  denied(callHook(cwd, { tool_name: 'Write', tool_input: null }));
  const malformed = spawnSync('bash', [hook], { cwd, input: '{broken', encoding: 'utf8' });
  denied(malformed);
  const nulTerminated = spawnSync('bash', [hook], {
    cwd, input: Buffer.concat([Buffer.from(JSON.stringify(write)), Buffer.from([0])]), encoding: 'utf8',
  });
  denied(nulTerminated);
  const optimized = spawnSync('bash', [hook], {
    cwd, input: JSON.stringify({ tool_name: 'Write', tool_input: null }), encoding: 'utf8',
    env: { ...process.env, PYTHONOPTIMIZE: '1' },
  });
  denied(optimized);
  const oversized = spawnSync('bash', [hook], { cwd, input: JSON.stringify({ ...write, padding: 'x'.repeat(1048576) }), encoding: 'utf8' });
  denied(oversized);
});
