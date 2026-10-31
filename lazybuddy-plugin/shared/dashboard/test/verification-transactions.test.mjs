import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, amendment } from './command-fixture.mjs';
import { captureReviewSource } from '../../project/review-source.mjs';
import { projectSnapshot } from '../projection.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const decoded = result => { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); };
const cmd = (revision, operation, payload, commandId, target = 'T1') => ({ ...amendment(revision, commandId), operation, payload,
  target: { project_id: 'project:b1', run_id: 'probe', id: target } });

test('native review rejects same-HEAD content changes and survives process restart', async () => {
  // Given: a real repository and a captured run-owned plan.
  const f = await fixture();
  try {
    execFileSync('git', ['init', '-q', f.root]);
    execFileSync('git', ['-C', f.root, 'add', 'proof.txt']);
    execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline']);
    const seeded = decoded(await f.call('command', cmd(f.revision, 'amend_task', { priority: 1 }, 'seed')));
    const before = decoded(await f.call('read'));
    const subject = { criterion_version: 1, plan_revision: 1, source_revision: before.source_revision,
      plan_sha256: before.plan_digest, content_sha256: before.review_content_sha256 };
    const request = cmd(seeded.revision, 'request_review', { review_id: 'review:live', criterion_id: 'C1', action: 'rerun_criterion', subject }, 'request');
    const accepted = decoded(await f.call('command', request));
    assert.equal(decoded(await f.call('read')).state.reviews[0].state, 'pending');
    // When: changing the same source with HEAD unchanged, then attempting approval.
    await writeFile(join(f.root, 'proof.txt'), 'Changed artifact\n');
    const changed = decoded(await f.call('read'));
    assert.equal(changed.source_revision, before.source_revision);
    assert.notEqual(changed.review_content_sha256, before.review_content_sha256);
    const refused = await f.call('command', cmd(accepted.revision, 'resolve_review', { review_id: 'review:live', decision: 'approved', rationale: 'Old source', subject }, 'stale'));
    // Then: native authority refuses it, retains the decision history and replays the request.
    assert.notEqual(refused.code, 0); assert.match(refused.stderr, /STALE_REVIEW_SUBJECT/);
    assert.equal(decoded(await f.call('read')).state.reviews[0].state, 'pending');
    assert.deepEqual(decoded(await f.call('command', request)), accepted);
  } finally { await f.cleanup(); }
});

test('source captures change for same-size edits and reject linked source files', async () => {
  // Given: a real Git source tree.
  const f = await fixture();
  try {
    execFileSync('git', ['init', '-q', f.root]);
    execFileSync('git', ['-C', f.root, 'add', 'proof.txt']);
    execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline']);
    const before = captureReviewSource(f.root);
    // When: an equal-size source edit occurs.
    await writeFile(join(f.root, 'proof.txt'), 'Different record!\n');
    // Then: line-count/size equality cannot preserve approval applicability.
    assert.ok(before); assert.notEqual(captureReviewSource(f.root), before);
    await symlink(join(f.root, 'proof.txt'), join(f.root, 'linked.txt'));
    assert.equal(captureReviewSource(f.root), null);
  } finally { await f.cleanup(); }
});

test('competing review decisions commit only one result and retain the pending checkpoint', async () => {
  // Given: a review queued against a real captured source and plan.
  const f = await fixture();
  try {
    execFileSync('git', ['init', '-q', f.root]); execFileSync('git', ['-C', f.root, 'add', 'proof.txt']);
    execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline']);
    decoded(await f.call('command', cmd(f.revision, 'amend_task', { priority: 1 }, 'seed')));
    const before = decoded(await f.call('read'));
    const subject = { criterion_version: 1, plan_revision: 1, source_revision: before.source_revision,
      plan_sha256: before.plan_digest, content_sha256: before.review_content_sha256 };
    const requested = decoded(await f.call('command', cmd(before.revision, 'request_review', { review_id: 'review:race', criterion_id: 'C1', action: 'rerun_criterion', subject }, 'request')));
    // When: two clients resolve the same revision concurrently.
    const results = await Promise.all(['approved', 'rejected'].map(decision => f.call('command', cmd(requested.revision, 'resolve_review', {
      review_id: 'review:race', subject, decision, rationale: 'Competing local review' }, `decision:${decision}`))));
    const receipts = results.map(decoded);
    // Then: one decision wins; history retains the pending state and no pass appears.
    assert.deepEqual(receipts.map(receipt => receipt.status).sort(), ['conflict', 'pending_agent']);
    const saved = receipts.find(receipt => receipt.status === 'pending_agent');
    const archived = JSON.parse(await readFile(join(f.run, `history/dashboard-${saved.revision}/state.json`)));
    assert.equal(archived.reviews[0].state, 'pending');
    const current = decoded(await f.call('read')); const state = current.state;
    assert.ok(['approved', 'rejected'].includes(state.reviews[0].state));
    assert.notEqual(projectSnapshot(current).tasks[0].criteria[0].verification, 'verified');
  } finally { await f.cleanup(); }
});

test('an external run-plan edit makes an existing review visibly stale', async () => {
  // Given: a locally reviewed, captured native plan.
  const f = await fixture();
  try {
    execFileSync('git', ['init', '-q', f.root]); execFileSync('git', ['-C', f.root, 'add', 'proof.txt']);
    execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline']);
    decoded(await f.call('command', cmd(f.revision, 'amend_task', { priority: 1 }, 'seed')));
    const before = decoded(await f.call('read'));
    const subject = { criterion_version: 1, plan_revision: 1, source_revision: before.source_revision,
      plan_sha256: before.plan_digest, content_sha256: before.review_content_sha256 };
    decoded(await f.call('command', cmd(before.revision, 'request_review', { review_id: 'review:plan', criterion_id: 'C1', action: 'rerun_criterion', subject }, 'request')));
    // When: original plan bytes change without a reconciled revision.
    await appendFile(join(f.run, 'plan.md'), '\nExternal acceptance change\n');
    const current = decoded(await f.call('read'));
    // Then: the read surface cannot keep claiming the old review is current.
    assert.equal(projectSnapshot(current).reviews[0].current, false);
    assert.equal(projectSnapshot(current).review_context.plan_sha256, null);
  } finally { await f.cleanup(); }
});

for (const fault of [null, 'after-stage', 'after-commit', 'after-install:1']) test(`native history compaction retains originals and recovers: ${fault ?? 'normal'}`, async () => {
  // Given: two identical records, with a complete original retained for inspection.
  const f = await fixture();
  try {
    const path = join(f.run, 'canonical-events.jsonl');
    const event = `${JSON.stringify({ schema_version: 1, event_id: 'duplicate:one', run_id: 'probe', event: 'observation', ts: '2026-10-29T12:00:00Z', event_payload: { note: 'Retained observation' } })}\n`;
    await appendFile(path, event + event);
    const original = await readFile(path);
    const command = cmd(f.revision, 'compact_history', { source_sha256: hash(original) }, 'compact:one', 'probe');
    // When: compacting through the real transactional CLI, including interrupted publication.
    const first = await f.call('command', command, fault ? { LAZYBUDDY_TX_FAULT: fault } : {});
    if (fault) assert.notEqual(first.code, 0); else assert.equal(first.code, 0, first.stderr);
    decoded(await f.call('read'));
    const retried = decoded(await f.call('command', command));
    // Then: exactly one accepted command, a complete immutable archive and one current event.
    assert.equal(retried.revision, f.revision + 1);
    assert.deepEqual(await readFile(join(f.run, `history/dashboard-${retried.revision}/canonical-events.jsonl`)), original);
    const compacted = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(compacted.filter(item => item.event_id === 'duplicate:one').length, 1);
    assert.equal(decoded(await f.call('read')).state.dashboard_ledger_generation, 1);
    assert.deepEqual(decoded(await f.call('command', command)), retried);
  } finally { await f.cleanup(); }
});

test('the first review command preserves the approved plan bytes and its own subject', async () => {
  const f = await fixture();
  try {
    execFileSync('git', ['init', '-q', f.root]);
    execFileSync('git', ['-C', f.root, 'add', 'proof.txt']);
    execFileSync('git', ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline']);
    const planPath = join(f.run, 'plan.md'); const plan = await readFile(planPath);
    const statePath = join(f.run, 'state.json'); const state = JSON.parse(await readFile(statePath));
    state._approved_plan_sha256 = hash(plan); await writeFile(statePath, JSON.stringify(state));
    await writeFile(join(f.run, 'checkpoints/plan-revision.md'), plan);
    const before = decoded(await f.call('read'));
    const subject = { criterion_version: 1, plan_revision: before.plan_revision, source_revision: before.source_revision,
      plan_sha256: before.plan_digest, content_sha256: before.review_content_sha256 };
    const requested = decoded(await f.call('command', cmd(before.revision, 'request_review', {
      review_id: 'review:first', criterion_id: 'C1', action: 'rerun_criterion', subject }, 'request:first')));
    assert.deepEqual(await readFile(planPath), plan);
    decoded(await f.call('command', cmd(requested.revision, 'resolve_review', {
      review_id: 'review:first', subject, decision: 'approved', rationale: 'Approve this captured subject' }, 'approve:first')));
    const current = decoded(await f.call('read'));
    assert.equal(current.state.reviews[0].state, 'approved');
    assert.equal(projectSnapshot(current).reviews[0].current, true);
    assert.deepEqual(await readFile(planPath), plan);
  } finally { await f.cleanup(); }
});
