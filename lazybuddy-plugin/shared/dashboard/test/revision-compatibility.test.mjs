import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture, amendment, processCall, plugin } from './command-fixture.mjs';
import { readInput } from '../commands.mjs';
import { projectSnapshot } from '../trusted-projection.mjs';

async function observed() {
  const f = await fixture();
  const attempt = { id: 'attempt:3', task_id: 'T3', criterion_id: 'C3', criterion_version: 1,
    plan_revision: 1, consumed_plan_revision: 1, worker_id: 'worker:3', parent_task_id: 'T3', source_revision: 'head:1',
    execution: 'finished', verification: 'failed', started_at: null, finished_at: null, evidence: [] };
  const produced = await processCall(['bash', join(plugin, 'scripts/state/append-event.sh'), 'probe', 'attempt_result', JSON.stringify(attempt)], '', { CWD: f.root });
  assert.equal(produced.code, 0, produced.stderr);
  const before = await readInput(f.options);
  assert.equal((await f.call('command', amendment(before.revision))).code, 0);
  return f;
}
const status = input => projectSnapshot(input).tasks[2].criteria[0].verification;

test('locked input preserves unrelated attempt; clones and mutated binding cannot grant compatibility', async () => {
  const f = await observed();
  try {
    const input = await readInput(f.options);
    assert.equal(status(input), 'failed');
    assert.equal(status(JSON.parse(JSON.stringify(input))), 'stale');
    assert.equal(status({ ...input }), 'failed');
    assert.equal(status({ ...input, revision: input.revision + 1 }), 'stale');
    assert.equal(status({ ...input, source_revision: 'head:2' }), 'stale');
    input.state.tasks[0].title = 'tampered';
    assert.equal(status(input), 'stale');
  } finally { await f.cleanup(); }
});

test('criterion change then revert never restores old attempt; transition gaps remain stale', async () => {
  const f = await observed();
  try {
    let input = await readInput(f.options);
    const command = { ...amendment(input.revision, 'edit:3'), target: { project_id: 'project:b1', run_id: 'probe', id: 'T3' },
      payload: { criterion_id: 'C3', expected_version: 1, requirement: 'Changed temporarily' } };
    assert.equal((await f.call('command', command)).code, 0);
    input = await readInput(f.options);
    assert.equal(status(input), 'stale');
    assert.equal((await f.call('command', { ...command, command_id: 'edit:4', expected_revision: input.revision,
      payload: { ...command.payload, expected_version: 2, requirement: 'Original requirement' } })).code, 0);
    assert.equal(status(await readInput(f.options)), 'stale');
    const path = join(f.run, 'state.json'); const state = JSON.parse(await readFile(path));
    state.dashboard_plan_transitions.splice(0, 1);
    await writeFile(path, JSON.stringify(state));
    assert.equal(status(await readInput(f.options)), 'stale');
  } finally { await f.cleanup(); }
});

test('malformed committed compatibility fails locked reader validation', async () => {
  const f = await observed();
  try {
    const path = join(f.run, 'state.json'); const state = JSON.parse(await readFile(path));
    state.dashboard_plan_transitions[0].to_revision = 99;
    await writeFile(path, JSON.stringify(state));
    await assert.rejects(readInput(f.options), /INVALID_REVISION_COMPATIBILITY/);
  } finally { await f.cleanup(); }
});
