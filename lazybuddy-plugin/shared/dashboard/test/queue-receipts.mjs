import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, accepted, digest } from './queue-fixture.mjs';
import { plugin, processCall } from './command-fixture.mjs';
import { parseContract, stableJSON } from '../contracts/parse.mjs';

export const corruptions = [
  ['pending', receipt => { receipt.result.status = 'pending_agent'; }],
  ['applied', receipt => { receipt.result.status = 'applied'; receipt.result.consumed_plan_revision = 0; }],
  ['conflict', receipt => { receipt.result.status = 'conflict'; }],
  ['rejected', receipt => { receipt.result.status = 'rejected'; }],
  ['plan-revision', receipt => { receipt.result.plan_revision = 1; }],
  ['consumed-revision', receipt => { receipt.result.consumed_plan_revision = 0; }],
  ['reason', receipt => { receipt.result.reason = 'PASS: accepted'; }],
  ['zero-revision', receipt => { receipt.result.revision = 0; }],
  ['wrong-revision', receipt => { receipt.result.revision = 2; }],
  ['expected-revision', receipt => { receipt.command.expected_revision = 1; receipt.content_hash = digest(stableJSON(receipt.command)); }],
  ['command-id', receipt => { receipt.result.command_id = 'other'; }],
  ['target-id', receipt => { receipt.result.target.id = 'other'; }],
  ['target-project', receipt => { receipt.result.target.project_id = 'other'; }],
  ['target-run', receipt => { receipt.result.target.run_id = 'selected'; }],
  ['actor-bound', receipt => { receipt.actor = 'a'.repeat(257); }],
  ['receipt-order', (_receipt, store) => { store.commands.reverse(); }],
];

async function setup(f) {
  const original = await f.create(); accepted(original);
  accepted(await f.call('command', command('amend_queued_plan', 1, { title: 'Current title' })));
  const run = await processCall(['bash', join(plugin, 'scripts/state/create-run.sh'), 'selected', 'Receipt projection'], '', { CWD: f.root });
  f.calls.push(run); acceptedRun(run);
  const projector = [process.execPath, join(plugin, 'shared/dashboard/projector.mjs'), '--project-root', f.root,
    '--run-dir', join(f.root, '.lazybuddy/runs/selected'), '--project-id', f.binding.projectId];
  return { original, projector };
}
function acceptedRun(result) { assert.equal(result.code, 0, result.stderr); }

export async function receiptCorruption(f, probe) {
  const { original, projector } = await setup(f);
  await f.capture('original-saved');
  const store = await f.persisted();
  probe.mutate(store.commands[0], store);
  parseContract('queue_store', store);
  await writeFile(join(f.queue, 'queue.json'), JSON.stringify(store));
  const before = await f.capture('schema-valid-corruption');
  const read = await f.call('read');
  const retry = await f.call('command', JSON.parse(original.input));
  const projection = await processCall(projector); f.calls.push(projection);
  assert.deepEqual(await f.capture('after-real-interfaces'), before);
  if (probe.baseline) {
    for (const result of [read, retry, projection]) acceptedRun(result);
    assert.notEqual(retry.stdout, original.stdout);
    assert.equal(JSON.parse(projection.stdout).freshness, 'snapshot');
  } else {
    for (const result of [read, retry, projection]) { assert.notEqual(result.code, 0); assert.match(result.stderr, /QUEUE_RECEIPT_CORRUPT/); }
  }
}

export async function savedReceipt(f) {
  const { original, projector } = await setup(f);
  const before = await f.capture('saved-before-retry');
  f.binding.actor = 'chat:another-trusted-reader';
  assert.equal((await f.call('command', JSON.parse(original.input))).stdout, original.stdout);
  assert.equal((await f.read()).queue_revision, 2);
  const projection = await processCall(projector); f.calls.push(projection);
  const snapshot = accepted(projection);
  assert.equal(snapshot.freshness, 'snapshot');
  assert.equal(snapshot.acknowledgements[0].status, 'saved');
  assert.deepEqual(await f.capture('saved-after-retry'), before);
}
