import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, applyProjectCommand, extractSourceAnchor } from '../model.mjs';
import { projectSnapshot } from '../projection.mjs';
import { ProjectContractError, assertProjectCommand, assertProjectState } from '../contract.mjs';

const at = '2026-10-05T18:30:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const problem = code => error => error instanceof ProjectContractError && (!code || error.code === code);
function harness() {
  const h = {
    state: createProject({ projectId: 'project:review', runtime: 'LazyBuddy', repositoryKey: 'repo:review', createdAt: at }),
    sources: [
      { source_id: 'source:baseline', path: 'docs/baseline.md', content: '# Baseline\n\n## Offline\nReading works offline.\n\n## Other\nNotes.\n' },
      { source_id: 'source:plan', path: '.omo/plans/review.md', content: '# Build reader\n\n- [x] Build a reader.\n' },
    ].map(source => ({ ...source, sha256: hash(source.content) })),
    counter: 0,
    context() { return { actor: 'reviewer:local', occurredAt: at, capturedSources: this.sources }; },
    command(operation, payload) { return { schema_version: 1, command_id: `review:${++this.counter}`, project_id: this.state.project_id, expected_revision: this.state.revision, operation, payload }; },
    apply(operation, payload) {
      const command = this.command(operation, payload), before = clone(this.state);
      const result = applyProjectCommand(this.state, command, this.context());
      assert.deepEqual(this.state, before, 'Input state was mutated');
      this.state = result.state;
      return { ...result, command };
    },
    source(id, anchor = 'document') { const source = this.sources.find(source => source.source_id === id); return { source_id: id, sha256: source.sha256, anchor_id: anchor }; },
    observations() { return this.sources.map(source => ({ source_id: source.source_id, path: source.path, sha256: source.sha256, status: 'available', observed_at: at })); },
    bootstrap() {
      this.apply('register_source', { id: 'source:baseline', path: 'docs/baseline.md', role: 'requirements' });
      this.apply('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
      this.apply('record_baseline_items', { items: [{ id: 'requirement:offline', kind: 'requirement', state: 'accepted', source: this.source('source:baseline', 'heading:Offline') }] });
      this.apply('register_plan', { id: 'plan:reader', declared_lifecycle: 'completed', source: this.source('source:plan'), baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
      return this;
    },
  };
  return h;
}

test('object-prototype-like stable IDs remain data, including plan and related references', () => {
  const h = harness();
  h.apply('register_source', { id: 'source:baseline', path: 'docs/baseline.md', role: 'requirements' });
  h.apply('record_baseline_items', { items: [
    { id: 'constructor', kind: 'feature', source: h.source('source:baseline'), state: 'accepted', related_item_ids: ['toString'] },
    { id: 'toString', kind: 'requirement', source: h.source('source:baseline', 'heading:Offline'), state: 'accepted', related_item_ids: ['constructor'] },
  ] });
  h.apply('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
  h.apply('register_plan', { id: 'hasOwnProperty', declared_lifecycle: 'planned', source: h.source('source:plan'), baseline_refs: [{ item_id: 'constructor', item_revision: 1 }] });
  const snapshot = projectSnapshot(h.state);
  assert.deepEqual(snapshot.items.map(item => item.id), ['constructor', 'toString']);
  assert.deepEqual(snapshot.items[0].contributing_plan_ids, ['hasOwnProperty']);
  assert.equal(Object.prototype.polluted, undefined);
});

test('JSON prototype pollution properties and unknown proof authority reject before state changes', () => {
  const h = harness().bootstrap();
  for (const property of ['__proto__', 'constructor', 'prototype', 'verification', 'trusted']) {
    const command = h.command('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
    const malicious = JSON.parse(JSON.stringify(command).slice(0, -1) + `,${JSON.stringify(property)}:{"polluted":true}}`);
    assert.throws(() => applyProjectCommand(h.state, malicious, h.context()), problem());
    const state = JSON.parse(JSON.stringify(h.state).slice(0, -1) + `,${JSON.stringify(property)}:{"polluted":true}}`);
    assert.throws(() => projectSnapshot(state), problem());
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('accessor fields are rejected without calling their getters', () => {
  const h = harness(); let invoked = 0;
  const command = h.command('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
  Object.defineProperty(command.payload, 'path', { enumerable: true, get() { invoked++; return '.omo/plans/review.md'; } });
  assert.throws(() => assertProjectCommand(command), problem());
  assert.equal(invoked, 0);
});

test('sparse arrays, array accessors and named array properties are not JSON data', () => {
  const h = harness();
  const sparse = new Array(1);
  const named = []; named.extra = true;
  const accessor = []; let invoked = 0;
  Object.defineProperty(accessor, '0', { enumerable: true, get() { invoked++; return {}; } });
  for (const items of [sparse, named, accessor]) assert.throws(() => assertProjectCommand(h.command('record_baseline_items', { items })), problem());
  assert.equal(invoked, 0);
});

test('one bad item makes a whole source-backed baseline batch reject atomically', () => {
  const h = harness().bootstrap(); const before = clone(h.state);
  const command = h.command('record_baseline_items', { items: [
    { id: 'feature:first', kind: 'feature', source: h.source('source:baseline'), state: 'accepted' },
    { id: 'feature:second', kind: 'feature', source: h.source('source:baseline', 'heading:Absent heading'), state: 'accepted' },
  ] });
  assert.throws(() => applyProjectCommand(h.state, command, h.context()), problem());
  assert.deepEqual(h.state, before);
});

test('dangling, duplicate, self, and future-version references reject atomically', () => {
  const h = harness().bootstrap(); const before = clone(h.state);
  for (const related_item_ids of [['feature:missing'], ['requirement:offline'], ['plan:reader'], ['feature:new', 'feature:new']]) {
    const id = related_item_ids[0] === 'requirement:offline' ? 'requirement:offline' : 'feature:new';
    const command = h.command('record_baseline_items', { items: [{ id, kind: id.startsWith('requirement:') ? 'requirement' : 'feature', source: h.source('source:baseline'), state: 'accepted', related_item_ids }] });
    assert.throws(() => applyProjectCommand(h.state, command, h.context()), problem());
  }
  const future = h.command('register_plan', { id: 'plan:future', source: h.source('source:plan'), declared_lifecycle: 'draft', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] });
  assert.throws(() => applyProjectCommand(h.state, future, h.context()), problem('INVALID_REFERENCE'));
  assert.deepEqual(h.state, before);
});

test('source digest and path must match the exact supplied content at the capture boundary', () => {
  const h = harness().bootstrap(); const before = clone(h.state);
  const command = h.command('record_baseline_items', { items: [{ id: 'feature:new', kind: 'feature', source: h.source('source:baseline'), state: 'accepted' }] });
  for (const mutation of [source => ({ ...source, content: 'Fabricated content' }), source => ({ ...source, path: 'other.md' }), source => ({ ...source, sha256: hash('Other digest') })]) {
    const captures = h.sources.map(source => source.source_id === 'source:baseline' ? mutation(source) : source);
    assert.throws(() => applyProjectCommand(h.state, command, { ...h.context(), capturedSources: captures }), problem());
  }
  assert.deepEqual(h.state, before);
});

test('an exact persisted retry needs no new source capture and retains original actor/time', () => {
  const h = harness(); const first = h.apply('register_source', { id: 'source:baseline', path: 'docs/baseline.md', role: 'requirements' });
  h.apply('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
  const before = clone(h.state);
  const replay = applyProjectCommand(clone(h.state), clone(first.command), { actor: 'different:retry', occurredAt: '2026-10-05T19:00:00.000Z', capturedSources: [] });
  assert.deepEqual(replay.state, before);
  assert.deepEqual(replay.receipt, first.receipt);
});

test('a competing stale command does not consume command ID or append a conflict to persisted history', () => {
  const h = harness();
  const waiting = h.command('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' });
  h.apply('register_source', { id: 'source:baseline', path: 'docs/baseline.md', role: 'requirements' });
  const before = clone(h.state);
  const conflict = applyProjectCommand(h.state, waiting, { ...h.context(), capturedSources: [] });
  assert.equal(conflict.receipt.status, 'conflict');
  assert.deepEqual(conflict.state, before);
  const applied = applyProjectCommand(conflict.state, { ...waiting, expected_revision: before.revision }, h.context());
  assert.equal(applied.receipt.status, 'saved');
  assert.equal(applied.state.receipts.length, before.receipts.length + 1);
});

test('registered source refresh alone preserves baseline references but exposes old accepted item source freshness', () => {
  const h = harness().bootstrap(); const oldBaseline = h.state.baseline_revision;
  const source = h.sources.find(source => source.source_id === 'source:baseline');
  source.content = source.content.replace('Reading works offline.', 'A cloud login is now required.'); source.sha256 = hash(source.content);
  h.apply('register_source', { id: source.source_id, path: source.path, role: 'requirements' });
  const snapshot = projectSnapshot(h.state, { sourceObservations: h.observations() });
  assert.equal(snapshot.baseline_revision, oldBaseline);
  assert.equal(snapshot.sources.find(source => source.id === 'source:baseline').observation.status, 'current');
  assert.equal(snapshot.items[0].source_freshness, 'changed');
  assert.match(snapshot.items[0].text, /Reading works offline/);
  assert.equal(snapshot.plans[0].baseline_reference_status, 'current');
  assert.equal(snapshot.plans[0].alignment, 'unassessed');
});

test('source observations are optional and bounded; extra same-runtime run observations grant nothing', () => {
  const h = harness().bootstrap();
  const snapshot = projectSnapshot(h.state, { runObservations: [{ runtime: 'LazyBuddy', native_project_id: 'native:unknown', run_id: 'run:unknown', execution: 'finished', observed_at: at }] });
  assert.deepEqual(snapshot.plans[0].native_observations, []);
  assert.equal(snapshot.plans[0].alignment, 'unassessed');
  assert.ok(snapshot.sources.every(source => source.observation.status === 'unobserved'));
  assert.throws(() => projectSnapshot(h.state, { sourceObservations: [{ source_id: 'source:unknown', status: 'missing' }] }), problem());
  assert.throws(() => projectSnapshot(h.state, { sourceObservations: [{ source_id: 'source:baseline', status: 'missing', sha256: hash('fake') }] }), problem());
});

test('a captured native run link remains a reference and cannot rewrite imported completed history', () => {
  const h = harness().bootstrap();
  const command = h.command('link_native_run', { plan_id: 'plan:reader', native_project_id: 'native:keep-this-id', run_id: 'run:keep-this-id' });
  const capture = { runtime: 'LazyBuddy', native_project_id: command.payload.native_project_id, run_id: command.payload.run_id };
  const linked = applyProjectCommand(h.state, command, { ...h.context(), capturedRuns: [capture] });
  const snapshot = projectSnapshot(linked.state, { runObservations: [{ ...capture, execution: 'failed', observed_at: at }] });
  assert.equal(snapshot.plans[0].declared_lifecycle, 'completed');
  assert.equal(snapshot.plans[0].native_runs[0].run_id, capture.run_id);
  assert.equal(snapshot.plans[0].native_observations[0].execution, 'failed');
  assert.equal(snapshot.plans[0].alignment, 'unassessed');
  assert.equal(Object.hasOwn(snapshot.plans[0], 'verified'), false);
});

test('anchor parser excludes fenced fake headings and stops at the next peer heading', () => {
  const document = '# Root\r\n\r\n~~~md\r\n## Fake\r\n~~~\r\n\r\n## Real ###\r\nValue.\r\n### Child\r\nMore.\r\n## Peer\r\nOutside.\r\n';
  assert.throws(() => extractSourceAnchor(document, 'heading:Fake'), problem());
  const result = extractSourceAnchor(document, 'heading:Real');
  assert.equal(result.title, 'Real');
  assert.match(result.text, /### Child/);
  assert.doesNotMatch(result.text, /## Peer/);
});

test('persisted receipt digest corruption is rejected consistently by projection and the command path', () => {
  const h = harness().bootstrap(); const state = clone(h.state);
  state.receipts[0].sha256 = '0'.repeat(64);
  assert.throws(() => applyProjectCommand(state, h.command('register_source', { id: 'source:plan', path: '.omo/plans/review.md', role: 'plan' }), h.context()), problem('INVALID_HISTORY'));
  assert.throws(() => projectSnapshot(state), problem('INVALID_HISTORY'));
});

test('receipt revision, operation, command, baseline and project inconsistencies reject on read', () => {
  const h = harness().bootstrap();
  for (const mutate of [
    state => { state.receipts[0].receipt.revision = 2; },
    state => { state.receipts[0].receipt.operation = 'link_native_run'; },
    state => { state.receipts[0].receipt.command_id = 'forged:id'; },
    state => { state.receipts[0].receipt.project_id = 'project:foreign'; },
    state => { state.receipts[0].receipt.baseline_revision = 4; },
    state => { state.receipts.splice(0, 1); },
  ]) {
    const corrupted = clone(h.state); mutate(corrupted);
    assert.throws(() => assertProjectState(corrupted), problem('INVALID_HISTORY'));
    assert.throws(() => projectSnapshot(corrupted), problem('INVALID_HISTORY'));
  }
});
