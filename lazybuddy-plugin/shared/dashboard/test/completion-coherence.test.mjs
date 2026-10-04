import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { completionFixture } from './completion-fixture.mjs';
import { readInput } from '../commands.mjs';
import { readBuddyCompletion } from '../adapters/completion.mjs';
import { projectSnapshot } from '../projection.mjs';

export function completionInput(fixture) {
  return { project_id: 'coherent', run_id: 'run-1', revision: 1, plan_revision: 1,
    source_revision: fixture.head, plan_digest: fixture.plan_digest, sources: [],
    state: { schema_version: 2, run_id: 'run-1', tasks: [{ id: 'task-1', status: 'done', criteria: [{
      id: 'c1', task_id: 'task-1', version: 1, requirement: 'Produce artifact', applicability: 'required',
      verification: 'unverified', scenarios: [], result_ids: [], history: [] }] }] } };
}
const verified = (input, proof) => projectSnapshot(input, proof).tasks[0].progress.verified;
test('later receipt cannot supplement an earlier capture; completed capture replays deterministically', async () => {
  const f = completionFixture();
  try {
    f.write('.lazybuddy/receipt.json', { ...f.receipt, exit_code: 9 });
    const old = await f.capture(completionInput(f));
    f.write('.lazybuddy/receipt.json', f.receipt);
    const fresh = await f.capture({ ...completionInput(f), revision: 2 });
    const proof = readBuddyCompletion(fresh, f.options);
    assert.equal(verified(old, readBuddyCompletion(old, f.options)), 0);
    assert.equal(verified(old, proof), 0);
    assert.equal(verified(fresh, proof), 1);
    f.write('.lazybuddy/receipt.json', { ...f.receipt, exit_code: 17 });
    assert.equal(verified(fresh, readBuddyCompletion(fresh, f.options)), 1);
    assert.equal(verified(fresh, proof), 1);
  } finally { f.cleanup(); }
});
test('replaced authority cannot add an unassessed criterion to captured proof', async () => {
  const f = completionFixture();
  try {
    const input = await f.capture(completionInput(f));
    const authority = JSON.parse(fs.readFileSync(path.join(f.root, '.lazybuddy/authority.json')));
    authority.criteria[0].criterion_id = 'unassessed';
    f.write('.lazybuddy/runs/run-1/completion-authority.json', authority);
    const proof = readBuddyCompletion(input, f.options);
    assert.equal(verified(input, proof), 1);
    input.state.tasks[0].criteria[0].id = 'unassessed';
    assert.equal(verified(input, proof), 0);
    const fresh = await readInput({ projectRoot: fs.realpathSync(f.root), projectId: 'coherent', runId: 'run-1' });
    assert.equal(verified(fresh, readBuddyCompletion(fresh, f.options)), 0);
  } finally { f.cleanup(); }
});
for (const [name, mutate] of [
  ['state', input => { input.state.tasks[0].title = 'changed'; }],
  ['revision', input => { input.revision += 1; }],
  ['plan revision', input => { input.plan_revision += 1; }],
  ['source', input => { input.source_revision = '0'.repeat(40); }],
  ['plan', input => { input.plan_digest = '0'.repeat(64); }],
  ['ledger', input => { input.sources[0].generation = 'replacement'; }],
]) test(`changed ${name} cannot reuse or issue a captured proof`, async () => {
  const f = completionFixture();
  try {
    const input = await f.capture(completionInput(f)); const proof = readBuddyCompletion(input, f.options);
    mutate(input);
    assert.equal(verified(input, proof), 0);
    assert.equal(verified(input, readBuddyCompletion(input, f.options)), 0);
  } finally { f.cleanup(); }
});
test('JSON or shallow copies cannot register proofs and resync gaps withhold promotion', async () => {
  const f = completionFixture();
  try {
    const input = await f.capture(completionInput(f)); const proof = readBuddyCompletion(input, f.options);
    for (const copy of [structuredClone(input), { ...input }]) {
      assert.equal(verified(copy, proof), 0);
      assert.equal(verified(copy, readBuddyCompletion(copy, f.options)), 0);
    }
    assert.equal(verified(input, { status: 'ready', authority: {} }), 0);
    assert.equal(verified(input), 0);
    const cursor = projectSnapshot(input).cursor;
    input.previous_cursor = { ...cursor, revision: input.revision + 1 };
    assert.equal(projectSnapshot(input, proof).freshness, 'resync_required');
    assert.equal(verified(input, proof), 0);
    assert.equal('_completion_capture' in input, false);
  } finally { f.cleanup(); }
});
for (const name of ['protected', 'symlink', 'hardlink', 'oversized']) test(`${name} artifact cannot grant completion`, async () => {
  const f = completionFixture();
  try {
    const artifact = path.join(f.root, '.lazybuddy/artifact.txt');
    if (name === 'protected') {
      const target = '.lazybuddy/DASHBOARD/receipt.json'; f.write(target, 'observable\n');
      f.write('.lazybuddy/receipt.json', { ...f.receipt, artifact: { ...f.receipt.artifact, path: target } });
    } else if (name === 'symlink') { fs.renameSync(artifact, artifact + '.actual'); fs.symlinkSync(artifact + '.actual', artifact); }
    else if (name === 'hardlink') fs.linkSync(artifact, artifact + '.link');
    else f.write('.lazybuddy/artifact.txt', 'x'.repeat(8 * 1024 * 1024 + 1));
    const input = await f.capture(completionInput(f));
    assert.equal(verified(input, readBuddyCompletion(input, f.options)), 0);
  } finally { f.cleanup(); }
});
