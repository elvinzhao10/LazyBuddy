import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createProject, applyProjectCommand } from '../model.mjs';
import { projectSnapshot } from '../projection.mjs';
import { ProjectContractError, assertProjectState, assertProjectCommand } from '../contract.mjs';

const CREATED_AT = '2026-10-05T15:00:00.000Z';
const PROJECT_ID = 'project:offline-notebook';
const INITIAL = Object.freeze({
  projectId: PROJECT_ID,
  runtime: 'LazyBuddy',
  repositoryKey: 'repo:offline-notebook',
  createdAt: CREATED_AT,
});

const SOURCE_DEFINITIONS = Object.freeze([
  { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements', fixture: 'requirements.md' },
  { id: 'source:principles', path: 'docs/project/principles.md', role: 'principles', fixture: 'principles.md' },
  { id: 'source:foundation', path: '.omo/plans/foundation.md', role: 'plan', fixture: 'plans/foundation.md' },
  { id: 'source:search', path: '.omo/plans/search.md', role: 'plan', fixture: 'plans/search.md' },
  { id: 'source:export', path: '.omo/plans/export.md', role: 'plan', fixture: 'plans/export.md' },
]);

const ITEM_DEFINITIONS = Object.freeze([
  { id: 'feature:notes', kind: 'feature', sourceId: 'source:requirements', heading: 'feature:notes — Personal notes' },
  { id: 'requirement:offline', kind: 'requirement', sourceId: 'source:requirements', heading: 'requirement:offline — Work without a network' },
  { id: 'principle:local-first', kind: 'principle', sourceId: 'source:principles', heading: 'principle:local-first — Preserve local ownership' },
]);

const hash = content => createHash('sha256').update(content).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const byId = (records, id) => {
  const result = records.find(record => record.id === id);
  assert.ok(result, `Expected a record for ${id}`);
  return result;
};

function captures() {
  return SOURCE_DEFINITIONS.map(source => {
    const content = readFileSync(new URL(`./fixtures/offline-notebook/${source.fixture}`, import.meta.url), 'utf8');
    return { source_id: source.id, path: source.path, sha256: hash(content), content };
  });
}

function harness(initialState = createProject(INITIAL), capturedSources = captures()) {
  const h = {
    state: initialState,
    capturedSources,
    nextId: 0,
    context() {
      return { actor: 'user:test', occurredAt: CREATED_AT, capturedSources: this.capturedSources };
    },
    command(operation, payload, overrides = {}) {
      return {
        schema_version: 1,
        command_id: `command:${++this.nextId}`,
        project_id: PROJECT_ID,
        expected_revision: this.state.revision,
        operation,
        payload,
        ...overrides,
      };
    },
    apply(operation, payload, overrides = {}) {
      const command = this.command(operation, payload, overrides);
      const before = clone(this.state);
      const result = applyProjectCommand(this.state, command, this.context());
      assert.deepEqual(this.state, before, 'Applying a command must not mutate its input state');
      assert.equal(result.receipt.status, 'saved');
      this.state = result.state;
      return { ...result, command };
    },
    observations() {
      return this.capturedSources.map(source => ({
        source_id: source.source_id,
        status: 'available',
        sha256: source.sha256,
        path: source.path,
        observed_at: CREATED_AT,
      }));
    },
    snapshot() {
      return projectSnapshot(this.state, { sourceObservations: this.observations() });
    },
  };
  // Reloaded state already has command receipts; fresh-session IDs remain unique.
  h.nextId = initialState.receipts.length;
  return h;
}

function sourceReference(h, sourceId, anchorId = 'document') {
  const source = h.capturedSources.find(record => record.source_id === sourceId);
  assert.ok(source, `Expected captured source ${sourceId}`);
  return { source_id: sourceId, sha256: source.sha256, anchor_id: anchorId };
}

function baselineItems(h, definitions = ITEM_DEFINITIONS) {
  return definitions.map(item => ({
    id: item.id,
    kind: item.kind,
    source: sourceReference(h, item.sourceId, `heading:${item.heading}`),
    state: 'accepted',
  }));
}

function registerSources(h) {
  for (const { id, path, role } of SOURCE_DEFINITIONS) h.apply('register_source', { id, path, role });
}

function refreshRegisteredSource(h, sourceId) {
  const { id, path, role } = SOURCE_DEFINITIONS.find(source => source.id === sourceId);
  h.apply('register_source', { id, path, role });
}

function registerFreshPlanSource(h) {
  const content = readFileSync(new URL('./fixtures/offline-notebook/plans/followup.md', import.meta.url), 'utf8');
  const source = { source_id: 'source:followup', path: '.omo/plans/followup.md', sha256: hash(content), content };
  h.capturedSources.push(source);
  h.apply('register_source', { id: source.source_id, path: source.path, role: 'plan' });
  return source.source_id;
}

function planPayload(h, id, sourceId, declaredLifecycle) {
  return {
    id,
    source: sourceReference(h, sourceId),
    declared_lifecycle: declaredLifecycle,
    baseline_refs: ITEM_DEFINITIONS.map(item => ({
      item_id: item.id,
      item_revision: byId(h.state.items, item.id).revision,
    })),
  };
}

function continuityProject() {
  const h = harness();
  registerSources(h);
  h.apply('record_baseline_items', { items: baselineItems(h) });
  h.apply('register_plan', planPayload(h, 'plan:foundation', 'source:foundation', 'completed'));
  h.apply('register_plan', planPayload(h, 'plan:search', 'source:search', 'active'));
  h.apply('register_plan', planPayload(h, 'plan:export', 'source:export', 'planned'));
  return h;
}

function expectContractFailure(action, inputState) {
  const before = inputState === undefined ? undefined : clone(inputState);
  assert.throws(action, ProjectContractError);
  if (inputState !== undefined) assert.deepEqual(inputState, before, 'Rejected input changed project state');
}

test('one feature and principle endure across completed, active and future plans after JSON reload', () => {
  const h = continuityProject();
  const first = h.snapshot();
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.runtime, 'LazyBuddy');
  assert.equal(first.summary.accepted_features, 1);
  assert.equal(first.summary.accepted_principles, 1);
  assert.equal(first.summary.accepted_requirements, 1);
  assert.equal(first.summary.plan_count, 3);
  const planIds = ['plan:export', 'plan:foundation', 'plan:search'];
  for (const id of ['feature:notes', 'requirement:offline', 'principle:local-first']) {
    const item = byId(first.items, id);
    assert.equal(item.revision, 1);
    assert.deepEqual([...item.contributing_plan_ids].sort(), planIds);
    for (const plan of first.plans) {
      assert.deepEqual(plan.baseline_refs.find(ref => ref.item_id === id), { item_id: id, item_revision: 1 });
    }
  }
  assert.equal(byId(first.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.equal(byId(first.plans, 'plan:search').declared_lifecycle, 'active');
  assert.equal(byId(first.plans, 'plan:export').declared_lifecycle, 'planned');
  assert.ok(first.plans.every(plan => plan.baseline_reference_status === 'current'));
  assert.ok(first.plans.every(plan => plan.alignment === 'unassessed'), 'Matching source references do not assess semantic alignment');

  const freshSession = harness(clone(h.state), clone(h.capturedSources));
  assert.deepEqual(freshSession.snapshot(), first);
  assertProjectState(freshSession.state);
  // Fresh planning reuses the enduring identities rather than creating per-plan copies.
  const freshSourceId = registerFreshPlanSource(freshSession);
  freshSession.apply('register_plan', planPayload(freshSession, 'plan:export-review', freshSourceId, 'draft'));
  const after = freshSession.snapshot();
  assert.equal(after.items.length, first.items.length);
  assert.equal(after.summary.accepted_features, 1);
  assert.equal(after.summary.accepted_principles, 1);
  assert.equal(after.summary.plan_count, 4);
  assert.equal(byId(after.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.deepEqual([...byId(after.items, 'feature:notes').contributing_plan_ids].sort(), [...planIds, 'plan:export-review'].sort());
});

test('baseline titles and text come from the captured original heading rather than caller metadata', () => {
  const h = continuityProject();
  const snapshot = h.snapshot();
  const feature = byId(snapshot.items, 'feature:notes');
  const requirement = byId(snapshot.items, 'requirement:offline');
  assert.match(feature.title, /Personal notes/);
  assert.match(feature.text, /create, find, and export their own notes/);
  assert.match(requirement.text, /Cloud sign-in is not a prerequisite/);
  assert.equal(byId(snapshot.items, 'principle:local-first').strength, 'binding');
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...baselineItems(h)[0], title: 'Invented authority', text: 'The UI may fabricate verification.' }],
  }), h.state);
});

test('a competing stale CAS cannot change accepted state or add a receipt to the stored state', () => {
  const h = harness();
  const first = SOURCE_DEFINITIONS[0];
  const second = SOURCE_DEFINITIONS[1];
  const winning = h.command('register_source', { id: first.id, path: first.path, role: first.role });
  const stale = h.command('register_source', { id: second.id, path: second.path, role: second.role });
  h.state = applyProjectCommand(h.state, winning, h.context()).state;
  const before = clone(h.state);
  const result = applyProjectCommand(h.state, stale, h.context());
  assert.equal(result.receipt.status, 'conflict');
  assert.deepEqual(result.state, before);
  assert.deepEqual(h.state, before);
  assert.equal(result.state.sources.length, 1);
});

test('same-command replay after later work returns its original receipt without rolling back state', () => {
  const h = harness();
  const first = SOURCE_DEFINITIONS[0];
  const saved = h.apply('register_source', { id: first.id, path: first.path, role: first.role });
  const second = SOURCE_DEFINITIONS[1];
  h.apply('register_source', { id: second.id, path: second.path, role: second.role });
  const before = clone(h.state);
  const replay = applyProjectCommand(h.state, clone(saved.command), h.context());
  assert.deepEqual(replay.receipt, saved.receipt);
  assert.deepEqual(replay.state, before);
  assert.equal(replay.state.sources.length, 2);
  assert.equal(replay.state.receipts.length, 2);
});

test('command replay is stable after JSON persistence and harmless object-key reordering', () => {
  const h = harness();
  const source = SOURCE_DEFINITIONS[0];
  const saved = h.apply('register_source', { id: source.id, path: source.path, role: source.role });
  const persisted = clone(h.state);
  const reordered = Object.fromEntries(Object.entries(saved.command).reverse());
  reordered.payload = Object.fromEntries(Object.entries(saved.command.payload).reverse());
  const result = applyProjectCommand(persisted, reordered, h.context());
  assert.deepEqual(result.receipt, saved.receipt);
  assert.deepEqual(result.state, persisted);
});

test('a reused command ID with a different supported payload is a collision, not a retry', () => {
  const h = harness();
  const source = SOURCE_DEFINITIONS[0];
  const saved = h.apply('register_source', { id: source.id, path: source.path, role: source.role });
  const before = clone(h.state);
  assert.throws(() => applyProjectCommand(h.state, {
    ...saved.command,
    payload: { ...saved.command.payload, role: 'overview' },
  }, h.context()), error => error instanceof ProjectContractError && error.code === 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(h.state, before);
});

test('an externally changed source remains an observation and cannot rewrite completed history', () => {
  const h = continuityProject();
  const before = clone(h.state);
  const changed = h.observations().map(source => source.source_id === 'source:requirements'
    ? { ...source, sha256: hash('Unaccepted requirement replacement') }
    : source);
  const snapshot = projectSnapshot(h.state, { sourceObservations: changed });
  assert.equal(byId(snapshot.sources, 'source:requirements').observation.status, 'changed');
  assert.equal(byId(snapshot.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.ok(snapshot.plans.every(plan => plan.alignment === 'unassessed'));
  assert.match(byId(snapshot.items, 'requirement:offline').text, /Cloud sign-in is not a prerequisite/);
  assert.deepEqual(h.state, before, 'Observation must not become an accepted baseline mutation');
});

test('an accepted requirement amendment stales its old references without recreating the feature or reopening history', () => {
  const h = continuityProject();
  const oldBaselineRevision = h.state.baseline_revision;
  const oldFeature = clone(byId(h.state.items, 'feature:notes'));
  const captured = h.capturedSources.find(source => source.source_id === 'source:requirements');
  captured.content = captured.content.replace('Cloud sign-in is not a prerequisite.', 'Optional cloud sign-in must never block local reading or search.');
  captured.sha256 = hash(captured.content);
  refreshRegisteredSource(h, 'source:requirements');
  // Without authority the same re-record is the F-05 bypass and refuses typed.
  assert.throws(() => applyProjectCommand(h.state, {
    schema_version: 1, command_id: 'negative:f-05-authority-bypass', project_id: PROJECT_ID,
    expected_revision: h.state.revision, operation: 'record_baseline_items',
    payload: { items: baselineItems(h, ITEM_DEFINITIONS.slice(0, 2)) },
  }, h.context()), error => error.code === 'AMENDMENT_AUTHORITY_REQUIRED');
  const amended = h.apply('record_baseline_items', { items: baselineItems(h, ITEM_DEFINITIONS.slice(0, 2))
    .map(item => item.id === 'requirement:offline'
      ? { ...item, authority: 'user decision 2026-10-06: cloud sign-in stays optional' } : item) });
  // The authority-bearing meaning change carries the same decision receipt as
  // amend_baseline: invalidation facts naming the affected plans (F-05).
  assert.ok(amended.receipt.invalidations.some(fact => fact.item_id === 'requirement:offline'
    && fact.affected.some(entry => entry.plan_id === 'plan:foundation')));
  const snapshot = h.snapshot();
  assert.equal(snapshot.summary.accepted_features, 1);
  assert.equal(byId(snapshot.items, 'feature:notes').revision, oldFeature.revision);
  assert.equal(byId(snapshot.items, 'requirement:offline').revision, 2);
  assert.equal(snapshot.baseline_revision, oldBaselineRevision + 1);
  for (const plan of snapshot.plans) {
    assert.equal(plan.baseline_reference_status, 'stale');
    assert.ok(plan.stale_item_ids.includes('requirement:offline'));
    assert.ok(!plan.stale_item_ids.includes('feature:notes'));
    assert.equal(plan.alignment, 'unassessed');
  }
  assert.equal(byId(snapshot.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.deepEqual(byId(snapshot.plans, 'plan:foundation').baseline_refs.find(ref => ref.item_id === 'requirement:offline'), {
    item_id: 'requirement:offline', item_revision: 1,
  });
  const freshSession = harness(clone(h.state), clone(h.capturedSources));
  const freshSourceId = registerFreshPlanSource(freshSession);
  freshSession.apply('register_plan', planPayload(freshSession, 'plan:next-generation', freshSourceId, 'draft'));
  const next = freshSession.snapshot();
  assert.equal(byId(next.plans, 'plan:next-generation').baseline_reference_status, 'current');
  assert.equal(byId(next.plans, 'plan:foundation').baseline_reference_status, 'stale');
  assert.equal(next.summary.accepted_features, 1);
});

test('digest refresh outside registered baseline headings preserves their semantic revisions', () => {
  const h = continuityProject();
  const beforeBaseline = h.state.baseline_revision;
  const beforeRevisions = h.state.items.map(item => [item.id, item.revision]);
  const captured = h.capturedSources.find(source => source.source_id === 'source:requirements');
  captured.content = `<!-- Formatting-only document note. -->\n${captured.content}`;
  captured.sha256 = hash(captured.content);
  refreshRegisteredSource(h, 'source:requirements');
  h.apply('record_baseline_items', { items: baselineItems(h, ITEM_DEFINITIONS.slice(0, 2)) });
  const snapshot = h.snapshot();
  assert.equal(snapshot.baseline_revision, beforeBaseline);
  assert.deepEqual(snapshot.items.map(item => [item.id, item.revision]), beforeRevisions);
  assert.ok(snapshot.plans.every(plan => plan.baseline_reference_status === 'current'));
});

test('missing and unavailable sources remain distinct from a current observation after reload', () => {
  const h = continuityProject();
  const observations = h.observations().map(source => source.source_id === 'source:requirements'
    ? { source_id: source.source_id, status: 'missing', observed_at: CREATED_AT }
    : source.source_id === 'source:principles'
      ? { source_id: source.source_id, status: 'unavailable', observed_at: CREATED_AT }
      : source);
  const snapshot = projectSnapshot(clone(h.state), { sourceObservations: observations });
  assert.equal(byId(snapshot.sources, 'source:requirements').observation.status, 'missing');
  assert.equal(byId(snapshot.sources, 'source:principles').observation.status, 'unavailable');
  assert.ok(snapshot.plans.every(plan => plan.alignment === 'unassessed'));
  assert.equal(byId(snapshot.plans, 'plan:foundation').declared_lifecycle, 'completed');
});

test('unobserved sources are not presented as freshly observed merely because they were registered', () => {
  const h = continuityProject();
  const snapshot = projectSnapshot(h.state);
  assert.ok(snapshot.sources.every(source => source.observation.status === 'unobserved'));
  assert.ok(snapshot.plans.every(plan => plan.alignment === 'unassessed'));
});

test('accepted requirements without a contributing plan remain visible as unassigned', () => {
  const h = harness();
  registerSources(h);
  h.apply('record_baseline_items', { items: baselineItems(h) });
  const snapshot = h.snapshot();
  assert.ok(snapshot.summary.unassigned_item_ids.includes('requirement:offline'));
  assert.deepEqual(byId(snapshot.items, 'feature:notes').contributing_plan_ids, []);
  assert.equal(snapshot.summary.plan_count, 0);
});

test('native run registration requires the matching captured runtime/project/run identity', () => {
  const h = continuityProject();
  const payload = { plan_id: 'plan:search', native_project_id: 'native:offline-notebook', run_id: 'run:search' };
  const command = h.command('link_native_run', payload);
  expectContractFailure(() => applyProjectCommand(h.state, command, h.context()), h.state);
  expectContractFailure(() => applyProjectCommand(h.state, command, {
    ...h.context(), capturedRuns: [{ runtime: 'LazyTrae', native_project_id: payload.native_project_id, run_id: payload.run_id }],
  }), h.state);
  const result = applyProjectCommand(h.state, command, {
    ...h.context(), capturedRuns: [{ runtime: 'LazyBuddy', native_project_id: payload.native_project_id, run_id: payload.run_id }],
  });
  assert.equal(result.receipt.status, 'saved');
  const snapshot = projectSnapshot(result.state, { runObservations: [{
    runtime: 'LazyBuddy', native_project_id: payload.native_project_id, run_id: payload.run_id,
    execution: 'finished', observed_at: CREATED_AT,
  }] });
  assert.equal(byId(snapshot.plans, 'plan:search').declared_lifecycle, 'active');
  assert.equal(byId(snapshot.plans, 'plan:search').native_observations.length, 1);
  assert.equal(byId(snapshot.plans, 'plan:search').native_observations[0].execution, 'finished');
  assert.equal(byId(snapshot.plans, 'plan:search').alignment, 'unassessed');
});

test('completing an active plan requires the captured completion authority of a linked run (F-03)', () => {
  const h = continuityProject();
  const capture = { runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:search' };
  const linked = applyProjectCommand(h.state,
    h.command('link_native_run', { plan_id: 'plan:search', native_project_id: capture.native_project_id, run_id: capture.run_id }),
    { ...h.context(), capturedRuns: [capture] });
  assert.equal(linked.receipt.status, 'saved');
  h.state = linked.state;
  // A linked run alone — even a real one — is an identity reference, not
  // completion evidence: the transition refuses typed without an authority.
  assert.throws(() => applyProjectCommand(h.state,
    h.command('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'completed' }), h.context()),
  error => error.code === 'COMPLETION_AUTHORITY_REQUIRED');
  // An authority for a run this plan never linked satisfies nothing.
  assert.throws(() => applyProjectCommand(h.state,
    h.command('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'completed' }),
    { ...h.context(), completionAuthorities: [{ runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook',
      run_id: 'run:other', repo_head: 'a'.repeat(40) }] }),
  error => error.code === 'COMPLETION_AUTHORITY_REQUIRED');
  const trusted = applyProjectCommand(h.state,
    h.command('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'completed' }),
    { ...h.context(), completionAuthorities: [{ runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook',
      run_id: 'run:search', repo_head: 'a'.repeat(40) }] });
  assert.equal(trusted.receipt.status, 'saved');
  assert.equal(byId(trusted.state.plans, 'plan:search').declared_lifecycle, 'completed');
});

test('a checked source plan and imported completed lifecycle grant neither proof nor live agent status', () => {
  const h = continuityProject();
  const snapshot = h.snapshot();
  for (const plan of snapshot.plans) {
    assert.ok(!Object.hasOwn(plan, 'verification'));
    assert.ok(!Object.hasOwn(plan, 'verified'));
    assert.deepEqual(plan.native_observations, []);
  }
  assert.ok(!Object.hasOwn(snapshot.summary, 'verified_features'));
  assert.ok(!Object.hasOwn(snapshot.summary, 'active_agents'));
  assert.equal(byId(snapshot.plans, 'plan:foundation').declared_lifecycle, 'completed');
});

test('caller-supplied verification is rejected in commands and imported state', () => {
  const h = continuityProject();
  const plan = planPayload(h, 'plan:forged', 'source:export', 'completed');
  expectContractFailure(() => h.apply('register_plan', { ...plan, verification: 'verified' }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...baselineItems(h)[0], verification: 'verified' }],
  }), h.state);
  for (const target of ['state', 'item', 'plan']) {
    const persisted = clone(h.state);
    const object = target === 'state' ? persisted : target === 'item' ? persisted.items[0] : persisted.plans[0];
    object.verification = 'verified';
    expectContractFailure(() => assertProjectState(persisted));
    expectContractFailure(() => projectSnapshot(persisted));
  }
});

test('source and run observations cannot smuggle verification authority into a snapshot', () => {
  const h = continuityProject();
  expectContractFailure(() => projectSnapshot(h.state, {
    sourceObservations: [{ ...h.observations()[0], verification: 'verified' }],
  }), h.state);
  expectContractFailure(() => projectSnapshot(h.state, { runObservations: [{
    runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:forged',
    execution: 'finished', observed_at: CREATED_AT, verification: 'verified',
  }] }), h.state);
});

test('unsupported project inputs, state versions and state properties fail at the boundary', () => {
  expectContractFailure(() => createProject({ ...INITIAL, runtime: 'ArbitraryDaemon' }));
  expectContractFailure(() => createProject({ ...INITIAL, extra_authority: 'administrator' }));
  const state = createProject(INITIAL);
  expectContractFailure(() => assertProjectState({ ...state, schema_version: 99 }));
  expectContractFailure(() => assertProjectState({ ...state, trusted: true }));
});

for (const [name, mutation] of [
  ['unknown command property', command => ({ ...command, actor: 'administrator' })],
  ['unsupported command schema', command => ({ ...command, schema_version: 99 })],
  ['unsupported command operation', command => ({ ...command, operation: 'set_verified' })],
  ['unknown payload property', command => ({ ...command, payload: { ...command.payload, execute: true } })],
  ['unsupported source role', command => ({ ...command, payload: { ...command.payload, role: 'secret_execution' } })],
]) test(`rejects ${name}`, () => {
  const h = harness();
  const source = SOURCE_DEFINITIONS[0];
  const command = mutation(h.command('register_source', { id: source.id, path: source.path, role: source.role }));
  expectContractFailure(() => assertProjectCommand(command));
  expectContractFailure(() => applyProjectCommand(h.state, command, h.context()), h.state);
});

test('commands cannot target another project or fabricate unknown baseline references', () => {
  const h = continuityProject();
  const plan = planPayload(h, 'plan:next', 'source:export', 'planned');
  expectContractFailure(() => h.apply('register_plan', plan, { project_id: 'project:someone-else' }), h.state);
  expectContractFailure(() => h.apply('register_plan', {
    ...plan, baseline_refs: [{ item_id: 'requirement:invented', item_revision: 1 }],
  }), h.state);
});

test('a forged source digest cannot replace original captured requirement content', () => {
  const h = continuityProject();
  const item = baselineItems(h)[0];
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...item, source: { ...item.source, sha256: hash('Uncaptured replacement') } }],
  }), h.state);
});

test('heading anchors must identify a unique real heading outside fenced code', () => {
  const h = harness();
  registerSources(h);
  const captured = h.capturedSources.find(source => source.source_id === 'source:requirements');
  captured.content += '\n```markdown\n## Forged heading inside an example\nThis is not a project requirement.\n```\n';
  captured.sha256 = hash(captured.content);
  refreshRegisteredSource(h, 'source:requirements');
  h.apply('record_baseline_items', { items: baselineItems(h) });
  expectContractFailure(() => h.apply('record_baseline_items', { items: [{
    id: 'requirement:example', kind: 'requirement', state: 'accepted',
    source: sourceReference(h, 'source:requirements', 'heading:Forged heading inside an example'),
  }] }), h.state);

  captured.content += '\n## Duplicate requirement\nFirst meaning.\n\n## Duplicate requirement\nDifferent meaning.\n';
  captured.sha256 = hash(captured.content);
  refreshRegisteredSource(h, 'source:requirements');
  // The appended real headings truncate the last section, so this refresh is
  // a meaning change on an accepted item and carries its authority reference.
  h.apply('record_baseline_items', { items: baselineItems(h).map(item => item.id === 'requirement:offline'
    ? { ...item, authority: 'test: refreshed requirements document' } : item) });
  expectContractFailure(() => h.apply('record_baseline_items', { items: [{
    id: 'requirement:ambiguous', kind: 'requirement', state: 'accepted',
    source: sourceReference(h, 'source:requirements', 'heading:Duplicate requirement'),
  }] }), h.state);
});
