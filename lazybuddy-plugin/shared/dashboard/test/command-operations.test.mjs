import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, amendment } from './command-fixture.mjs';

test('all ten run operations use authority; priority preserves verification and evidence is submission only', async () => {
  const f = await fixture();
  try {
    let revision = f.revision; let serial = 0;
    const call = async (operation, payload, target = 'T1') => {
      const command = { ...amendment(revision, `operation:${++serial}`), operation, payload,
        target: { project_id: 'project:b1', run_id: 'probe', id: target } };
      const result = await f.call('command', command); assert.equal(result.code, 0, result.stderr);
      const value = JSON.parse(result.stdout); assert.equal(value.status, 'pending_agent'); revision = value.revision;
    };
    await call('amend_task', { priority: 7 });
    let state = JSON.parse(await readFile(join(f.run, 'state.json')));
    assert.equal(state.tasks[0].criteria[0].verification, 'verified');
    await call('add_dependency', { prerequisite_id: 'T3' }, 'T2');
    await call('remove_dependency', { prerequisite_id: 'T3' }, 'T2');
    await call('add_criterion', { criterion_id: 'C4', requirement: 'Fourth check', applicability: 'required', scenarios: [] });
    await call('amend_criterion', { criterion_id: 'C4', expected_version: 1, requirement: 'Fourth refined' });
    await call('add_scenario', { criterion_id: 'C4', scenario: { id: 'scenario:4', requirement: 'Exercise CLI', verifier_ref: 'test:4' } });
    await call('amend_scenario', { criterion_id: 'C4', scenario: { id: 'scenario:4', requirement: 'Exercise both clients', verifier_ref: 'test:4' } });
    await call('attach_evidence', { criterion_id: 'C4', evidence: { path: 'proof.txt', sha256: null, provenance: 'submitted by operator' } });
    const decision = { id: 'decision:1', title: 'A proposal', choice: null, rationale: 'Discuss in chat', scope: ['T1'], alternatives: [], reference: null,
      state: 'proposed', supersedes: null, revision: 0 };
    await call('propose_decision', { decision }, 'probe');
    await call('supersede_decision', { decision_id: 'decision:1', replacement: { ...decision, id: 'decision:2', supersedes: 'decision:1' } }, 'probe');
    state = JSON.parse(await readFile(join(f.run, 'state.json')));
    assert.equal(state.dashboard_commands.length, 10);
    assert.equal(state.tasks[0].criteria[1].version, 4);
    assert.equal(state.tasks[0].criteria[1].verification, 'unverified');
    assert.equal(state.decisions[0].state, 'superseded');
    assert.equal(state.decisions[1].state, 'proposed');
    assert.equal(state.evidence_submissions.length, 1);
  } finally { await f.cleanup(); }
});

test('three queue operations explicitly require independent queue authority', async () => {
  const f = await fixture();
  try {
    const plan = { id: 'plan:1', project_id: 'project:b1', title: 'Queued', priority: 1, readiness: 'draft', prerequisites: [], decision_id: null, revision: 0 };
    for (const [operation, payload] of [['create_queued_plan', { plan }], ['amend_queued_plan', { title: 'Changed' }], ['reorder_queued_plan', { plan_ids: ['plan:1'] }]]) {
      const result = await f.call('command', { ...amendment(f.revision), operation, payload, target: { project_id: 'project:b1', run_id: null, id: 'plan:1' } });
      assert.notEqual(result.code, 0); assert.match(result.stderr, /QUEUE_AUTHORITY_REQUIRED/);
    }
    assert.equal(JSON.parse((await f.call('read')).stdout).revision, f.revision);
  } finally { await f.cleanup(); }
});

test('consumption applies only exact revision while running attempt and older pending edit remain unchanged', async () => {
  const f = await fixture();
  try {
    const path = join(f.run, 'state.json'); const state = JSON.parse(await readFile(path));
    state.tasks[0].status = 'running'; state.tasks[0].attempt = { id: 'running:1', plan_revision: 1 };
    await writeFile(path, JSON.stringify(state));
    assert.equal((await f.call('command', amendment(f.revision))).code, 0);
    const later = { ...amendment(f.revision + 1, 'later:edit'), operation: 'amend_task', payload: { scope: 'Changed scope' } };
    assert.equal((await f.call('command', later)).code, 0);
    assert.notEqual((await f.call('consume', { expected_revision: f.revision + 2, plan_revision: 2 })).code, 0);
    assert.equal((await f.call('consume', { expected_revision: f.revision + 2, plan_revision: 3 })).code, 0);
    const after = JSON.parse(await readFile(path));
    assert.deepEqual(after.acknowledgements.map(item => item.status), ['pending_agent', 'applied']);
    assert.deepEqual(after.tasks[0].attempt, state.tasks[0].attempt);
    assert.equal(after.tasks[0].status, 'running');
  } finally { await f.cleanup(); }
});

test('symlinked revision file is rejected without reading or changing target', async () => {
  const f = await fixture();
  try {
    const revision = join(f.run, '.revision'); await unlink(revision); await symlink(join(f.root, 'proof.txt'), revision);
    assert.notEqual((await f.call('read')).code, 0);
    assert.equal(await readFile(join(f.root, 'proof.txt'), 'utf8'), 'Original artifact\n');
  } finally { await f.cleanup(); }
});

test('existing external plan is explicitly read-only and survives command rejection', async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, '.omo/plans'); await mkdir(directory, { recursive: true });
    const plan = join(directory, 'approved.md'); await writeFile(plan, '## TODOs\n- [ ] T1: Existing external approved plan\n');
    const path = join(f.run, 'state.json'); const state = JSON.parse(await readFile(path));
    state.plan_reference = '.omo/plans/approved.md'; await writeFile(path, JSON.stringify(state));
    const before = await readFile(plan, 'utf8');
    const input = JSON.parse((await f.call('read')).stdout);
    assert.deepEqual(input.editability, { supported: false, reason: 'EXTERNAL_PLAN_READ_ONLY' });
    const rejected = await f.call('command', amendment(f.revision));
    assert.notEqual(rejected.code, 0); assert.match(rejected.stderr, /EXTERNAL_PLAN_READ_ONLY/);
    assert.equal(await readFile(plan, 'utf8'), before);
    assert.deepEqual(JSON.parse(await readFile(path)), state);
  } finally { await f.cleanup(); }
});
