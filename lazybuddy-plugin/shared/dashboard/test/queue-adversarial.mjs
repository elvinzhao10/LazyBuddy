import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { command, accepted, digest, plan } from './queue-fixture.mjs';
import { processCall, plugin } from './command-fixture.mjs';
import { stableJSON } from '../contracts/parse.mjs';

export async function commandFault(f, fault) {
  accepted(await f.create()); await f.capture('before-command-fault');
  const request = command('amend_queued_plan', 1, { title: 'A retained edit' });
  assert.notEqual((await f.call('command', request, { LAZYBUDDY_QUEUE_TX_FAULT: `command/${fault}` })).code, 0);
  await f.capture('interrupted-command');
  const state = await f.read(); const committed = /after-commit|after-install/.test(fault);
  assert.equal(state.queue_revision, committed ? 2 : 1);
  const result = accepted(await f.call('command', request)); assert.equal(result.status, 'saved');
  assert.deepEqual(accepted(await f.call('command', request)), result);
  assert.equal((await f.persisted()).commands.length, 2); await f.capture('recovered-command');
}

export async function corrupt(f, variant) {
  accepted(await f.create());
  assert.notEqual((await f.call('activate', f.activation, { LAZYBUDDY_QUEUE_FAULT: 'after-intent' })).code, 0);
  const run = join(f.root, '.lazybuddy/runs/run-one');
  if (variant === 'tampered-intent') {
    const queue = await f.persisted(); queue.intents[0].content = 'tampered source';
    await writeFile(join(f.queue, 'queue.json'), JSON.stringify(queue));
  } else if (variant === 'orphan') {
    await mkdir(run, { recursive: true }); await writeFile(join(run, 'events.jsonl'), 'Caller owned orphan ledger');
  } else if (variant === 'run-link') {
    await mkdir(join(f.root, '.lazybuddy/runs'), { recursive: true }); await symlink(join(f.root, '.omo'), run);
  }
  const before = await f.capture('corrupt-before-recovery');
  assert.notEqual((await f.call('recover', { activation_id: f.activation.activation_id })).code, 0);
  const after = await f.capture('corrupt-refused');
  for (const [key, value] of Object.entries(before)) assert.equal(after[key], value);
  assert.equal(Object.keys(after).some(key => key.endsWith('/state.json')), false);
}

export async function fifo(f) {
  accepted(await f.create());
  const result = await processCall(['mkfifo', join(f.root, 'source-fifo')]); f.calls.push(result); assert.equal(result.code, 0);
  assert.notEqual((await f.call('activate', { ...f.activation, source_path: 'source-fifo' })).code, 0);
  await symlink(join(f.root, '.omo/plans/one.md'), join(f.queue, 'linked.json'));
  const original = await readFile(join(f.queue, 'queue.json'));
  await unlink(join(f.queue, 'queue.json')); await symlink(join(f.root, '.omo/plans/one.md'), join(f.queue, 'queue.json'));
  assert.notEqual((await f.call('read')).code, 0);
  await unlink(join(f.queue, 'queue.json')); await writeFile(join(f.queue, 'queue.json'), original);
  assert.equal((await f.read()).queue_revision, 1); await f.capture('fifo-and-queue-link-refused');
}

export async function lock(f) {
  accepted(await f.create()); await f.capture('before-contended-lock');
  const code = 'import fcntl,sys\nwith open(sys.argv[1],"w") as f:\n fcntl.flock(f,fcntl.LOCK_EX)\n print("ready",flush=True)\n sys.stdin.read()\n';
  const argv = ['python3', '-c', code, join(f.queue, '.transaction.lock')];
  const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
  f.calls.push({ argv, pid: child.pid, resource: 'owned-lock-process', status: 'active' });
  await f.capture('registered-lock-process');
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    const result = await f.call('command', command('amend_queued_plan', 1, { title: 'blocked' }), { LAZYBUDDY_TX_LOCK_TIMEOUT_SECONDS: '0.1' });
    assert.notEqual(result.code, 0); assert.match(result.stderr, /lock timed out/);
  } finally {
    child.stdin.end(); const outcome = await closed;
    assert.equal(outcome[0], 0); f.calls.push({ pid: child.pid, resource: 'owned-lock-process', status: 'reaped', outcome });
  }
  assert.equal((await f.read()).queue_revision, 1); await f.capture('lock-reaped-unchanged');
}

export async function bounds(f) {
  accepted(await f.create()); const before = await f.capture('before-bounds');
  assert.notEqual((await f.call('command', command('amend_queued_plan', 1, { title: 'x'.repeat(8193) }))).code, 0);
  assert.notEqual((await f.call('activate', { ...f.activation, run_id: '../escape' })).code, 0);
  assert.notEqual((await f.call('activate', { ...f.activation, expected_plan_revision: 99 })).code, 0);
  assert.deepEqual(await f.capture('after-bounded-requests'), before);
  const store = { schema_version: 1, project_id: f.binding.projectId, revision: 512, plans: [plan()], commands: [], intents: [] };
  for (let i = 0; i < 512; i++) {
    const request = command('amend_queued_plan', i, { title: 'x'.repeat(8192) }, 'one', `size:${i}`);
    const result = { schema_version: 1, command_id: request.command_id, target: request.target, status: 'saved', revision: i + 1,
      plan_revision: 0, consumed_plan_revision: null, reason: null };
    store.commands.push({ command: request, content_hash: digest(stableJSON(request)), actor: 'chat:b2', result });
  }
  await writeFile(join(f.queue, 'queue.json'), JSON.stringify(store)); await writeFile(join(f.queue, '.revision'), '512\n');
  const large = await f.call('read'); assert.notEqual(large.code, 0); assert.match(large.stderr, /QUEUE_TOTAL_BYTES/);
  await f.capture('oversized-store-refused');
}

export async function journalTamper(f) {
  accepted(await f.create());
  assert.notEqual((await f.call('activate', f.activation, { LAZYBUDDY_QUEUE_TX_FAULT: 'run/after-journal' })).code, 0);
  const stage = join(f.root, '.lazybuddy/runs/run-one/.transaction-journal-stage-0');
  await writeFile(stage, 'tampered journal stage');
  const before = await f.capture('tampered-journal');
  assert.notEqual((await f.call('recover', { activation_id: f.activation.activation_id })).code, 0);
  assert.deepEqual(await f.capture('tampered-journal-refused'), before);
  assert.equal((await f.read()).queue.length, 1);
}

export async function routes(f) {
  const request = command('create_queued_plan', 0, { plan: plan() });
  accepted(await f.call('command', request, {}, 'commands.mjs'));
  accepted(await f.call('activate', f.activation));
  const projector = await processCall([process.execPath, join(plugin, 'shared/dashboard/projector.mjs'), '--project-root', f.root,
    '--run-dir', join(f.root, '.lazybuddy/runs/run-one'), '--project-id', f.binding.projectId]);
  f.calls.push(projector); const snapshot = accepted(projector);
  assert.equal(snapshot.queue_revision, 3); assert.equal(snapshot.freshness, 'snapshot'); assert.equal(snapshot.tasks.length, 0);
  const edit = { schema_version: 1, command_id: 'decision:1', target: { project_id: f.binding.projectId, run_id: 'run-one', id: 'run-one' },
    expected_revision: 1, operation: 'propose_decision', payload: { decision: { id: 'D1', title: 'Decision', choice: null, rationale: 'Consider',
      scope: [], alternatives: [], reference: null, state: 'proposed', supersedes: null, revision: 0 } } };
  assert.equal(accepted(await f.call('command', edit, {}, 'commands.mjs', 'run-one')).status, 'pending_agent');
  accepted(await f.call('recover', { activation_id: f.activation.activation_id }));
  await f.capture('B1-edit-and-projector');
}

export async function repeated(f) {
  accepted(await f.create());
  assert.notEqual((await f.call('activate', f.activation, { LAZYBUDDY_QUEUE_FAULT: 'after-intent' })).code, 0);
  await unlink(join(f.root, f.activation.source_path));
  const collision = await f.call('activate', { ...f.activation, objective: 'Different objective' });
  assert.notEqual(collision.code, 0); assert.match(collision.stderr, /ACTIVATION_ID_COLLISION/);
  assert.notEqual((await f.call('command', command('amend_queued_plan', 2, { title: 'Cannot change frozen intent' }))).code, 0);
  assert.equal((await f.read()).queue_readiness[0].reason, 'ACTIVATION_RECOVERY_REQUIRED');
  for (const fault of ['run/after-journal', 'run/after-commit', 'confirmation/after-journal']) {
    assert.notEqual((await f.call('recover', { activation_id: f.activation.activation_id }, { LAZYBUDDY_QUEUE_TX_FAULT: fault })).code, 0);
    await f.capture(`repeated-${fault}`);
  }
  accepted(await f.call('recover', { activation_id: f.activation.activation_id }));
  const queue = await f.persisted(); assert.equal(queue.intents.length, 1); assert.equal(queue.revision, 3);
  assert.equal(await readFile(join(f.root, '.lazybuddy/runs/run-one/plan.md'), 'utf8'), f.source);
  await f.capture('repeated-interruptions-recovered');
}

export async function prerequisites(f) {
  accepted(await f.create()); accepted(await f.create('two', 1, { prerequisites: ['one'] }));
  assert.equal((await f.read()).queue_readiness.find(item => item.plan_id === 'two').reason, 'PREREQUISITE_NOT_LINKED');
  accepted(await f.call('activate', { ...f.activation, expected_revision: 2 }));
  assert.equal((await f.read()).queue_readiness[0].eligible, true);
  accepted(await f.call('activate', { ...f.activation, activation_id: 'activation:two', plan_id: 'two', run_id: 'run-two', expected_revision: 4 }));
  const after = await f.capture('prerequisite-handoffs-not-execution');
  for (const id of ['run-one', 'run-two']) assert.equal(JSON.parse(after[`.lazybuddy/runs/${id}/state.json`]).status, 'created');
  assert.equal((await f.persisted()).intents.length, 2);
}
