'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const hook = path.resolve(__dirname, '../scripts/hooks/pre-tool-use.sh');

function callHook(cwd, event) {
  return spawnSync('bash', [hook], { cwd, input: JSON.stringify({ cwd, ...event }), encoding: 'utf8' });
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
