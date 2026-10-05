import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createProject, applyProjectCommand, recordObservations, projectCapability } from '../model.mjs';
import { projectSnapshot } from '../projection.mjs';
import { ProjectContractError, assertProjectState } from '../contract.mjs';

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
  { id: 'source:architecture', path: 'docs/project/architecture.md', role: 'architecture', fixture: 'architecture.md' },
  { id: 'source:decisions', path: 'docs/project/decisions.md', role: 'decision', fixture: 'decisions.md' },
  { id: 'source:foundation', path: '.omo/plans/foundation.md', role: 'plan', fixture: 'plans/foundation.md' },
  { id: 'source:search', path: '.omo/plans/search.md', role: 'plan', fixture: 'plans/search.md' },
  { id: 'source:export', path: '.omo/plans/export.md', role: 'plan', fixture: 'plans/export.md' },
  { id: 'source:collaboration', path: '.omo/plans/collaboration.md', role: 'plan', fixture: 'plans/collaboration.md' },
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
    context(extra = {}) {
      return { actor: 'user:test', occurredAt: CREATED_AT, capturedSources: this.capturedSources, ...extra };
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
    apply(operation, payload, overrides = {}, contextExtra = {}) {
      const command = this.command(operation, payload, overrides);
      const before = clone(this.state);
      const result = applyProjectCommand(this.state, command, this.context(contextExtra));
      assert.deepEqual(this.state, before, 'Applying a command must not mutate its input state');
      assert.equal(result.receipt.status, 'saved', `Expected ${operation} to save`);
      this.state = result.state;
      return { ...result, command };
    },
    observe(records) {
      const before = clone(this.state);
      const result = recordObservations(this.state, records);
      assert.deepEqual(this.state, before, 'Recording observations must not mutate its input state');
      this.state = result.state;
      return result;
    },
    sourceObservations() {
      return this.capturedSources.map(source => ({
        source_id: source.source_id,
        status: 'available',
        sha256: source.sha256,
        path: source.path,
        observed_at: CREATED_AT,
      }));
    },
    snapshot(extraOptions = {}) {
      return projectSnapshot(this.state, { sourceObservations: this.sourceObservations(), ...extraOptions });
    },
    revisionKinds() {
      return {
        schema_version: this.state.schema_version,
        revision: this.state.revision,
        baseline_revision: this.state.baseline_revision,
        observation_revision: this.state.observation_revision ?? 0,
        source_revisions: Object.fromEntries(this.state.sources.map(source => [source.id, source.revision])),
        plan_revisions: Object.fromEntries(this.state.plans.map(plan => [plan.id, plan.revision])),
        item_revisions: Object.fromEntries(this.state.items.map(item => [item.id, item.revision])),
      };
    },
  };
  h.nextId = initialState.receipts.length;
  return h;
}

function sourceReference(h, sourceId, anchorId = 'document') {
  const source = h.capturedSources.find(record => record.source_id === sourceId);
  assert.ok(source, `Expected captured source ${sourceId}`);
  return { source_id: sourceId, sha256: source.sha256, anchor_id: anchorId };
}

function architectureInput(h, overrides = {}) {
  return {
    id: 'application:offline-notebook',
    kind: 'application',
    title: 'Local notebook application',
    role: 'One local application that keeps notes readable, searchable, and exportable without a network dependency.',
    source: sourceReference(h, 'source:architecture', 'heading:application:offline-notebook — Local notebook application'),
    relationships: [],
    ...overrides,
  };
}

function architectureFixture(h) {
  const heading = suffix => `heading:${suffix}`;
  return [
    architectureInput(h),
    architectureInput(h, { id: 'component:notes-ui', kind: 'component', title: 'Note workspace',
      role: 'Users create, read, and find notes in a local workspace.',
      source: sourceReference(h, 'source:architecture', heading('component:notes-ui — Note workspace')),
      parent_id: 'application:offline-notebook',
      relationships: [{ target_id: 'interface:search-api', kind: 'uses' }, { target_id: 'component:note-store', kind: 'uses' }] }),
    architectureInput(h, { id: 'component:note-store', kind: 'component', title: 'Local note storage',
      role: 'Owns the durable note documents on local disk.',
      source: sourceReference(h, 'source:architecture', heading('component:note-store — Local note storage')),
      parent_id: 'application:offline-notebook' }),
    architectureInput(h, { id: 'interface:search-api', kind: 'interface', title: 'Local search',
      role: 'Reads the local index and answers find queries without a network.',
      source: sourceReference(h, 'source:architecture', heading('interface:search-api — Local search')),
      parent_id: 'application:offline-notebook', relationships: [{ target_id: 'component:note-store', kind: 'uses' }] }),
    architectureInput(h, { id: 'boundary:sync-service', kind: 'boundary', title: 'Optional cloud sync',
      role: 'Cloud sync stays optional and must never gate a local workflow.',
      source: sourceReference(h, 'source:architecture', heading('boundary:sync-service — Optional cloud sync')),
      parent_id: 'application:offline-notebook' }),
  ];
}

function baselineItems(h) {
  const requirementSource = sourceReference(h, 'source:requirements', 'heading:requirement:offline — Work without a network');
  const decisionHeading = suffix => `heading:${suffix}`;
  return [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: sourceReference(h, 'source:requirements', 'heading:feature:notes — Personal notes'),
      applicability: { scope: 'component', subject_ids: ['application:offline-notebook'] } },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
      source: requirementSource,
      rationale: 'Primary workflows must survive the loss of a network connection.',
      authority: 'user charter: offline-first',
      applicability: { scope: 'repository' } },
    { id: 'principle:local-first', kind: 'principle', state: 'accepted',
      source: sourceReference(h, 'source:principles', 'heading:principle:local-first — Preserve local ownership'),
      applicability: { scope: 'environment', subject_ids: ['environment:local-install'] } },
    { id: 'decision:offline-first', kind: 'decision', state: 'accepted',
      source: sourceReference(h, 'source:decisions', decisionHeading('decision:offline-first — Keep primary workflows offline')),
      chosen: 'Local-first operation with optional cloud services.',
      rejected: ['Mandatory cloud sign-in before a workspace opens.'],
      authority: 'requirement:offline' },
    { id: 'decision:standard-import-format', kind: 'decision', state: 'accepted',
      source: sourceReference(h, 'source:decisions', decisionHeading('decision:standard-import-format — Adopt the standard import format')),
      chosen: 'Adopt the standard import format once the migration period ends.',
      rejected: ['Extending the legacy import format further.'] },
    { id: 'decision:legacy-import-format', kind: 'decision', state: 'superseded',
      source: sourceReference(h, 'source:decisions', decisionHeading('decision:legacy-import-format — Keep the legacy import format')),
      chosen: 'Keep the legacy import format through the migration period.',
      rejected: ['Removing it before the migration period ends.'],
      superseded_by: 'decision:standard-import-format',
      applicability: { scope: 'migration', subject_ids: ['import-format-migration'], period: 'Until the standard importer ships.' } },
  ];
}

function planPayload(h, id, sourceId, declaredLifecycle) {
  return {
    id,
    source: sourceReference(h, sourceId),
    declared_lifecycle: declaredLifecycle,
    baseline_refs: ['feature:notes', 'requirement:offline'].map(itemId => ({
      item_id: itemId,
      item_revision: byId(h.state.items, itemId).revision,
    })),
  };
}

function linkedRuns(planId, runIds) {
  return runIds.map(runId => ({
    runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: runId,
  }));
}

function observation(subject, extra = {}) {
  return {
    id: extra.id,
    subject,
    classification: extra.classification ?? 'observed',
    observed_by: extra.observed_by ?? 'collector:local-git',
    observed_at: CREATED_AT,
    provenance: extra.provenance ?? { kind: 'collector', reference: 'git --worktree=<name>' },
    text: extra.text ?? 'Collector output retained verbatim.',
    ...Object.fromEntries(['content_revision', 'coverage', 'artifact_ids', 'metric']
      .filter(field => Object.hasOwn(extra, field)).map(field => [field, extra[field]])),
  };
}

function usageObservation(id, label) {
  return observation({ kind: 'usage' }, {
    id,
    observed_by: 'collector:provider-usage',
    provenance: { kind: 'native_event', reference: `usage:${label}` },
    text: `One physical provider invocation record (${label}).`,
  });
}

function expectContractFailure(action, inputState) {
  const before = inputState === undefined ? undefined : clone(inputState);
  assert.throws(action, ProjectContractError);
  if (inputState !== undefined) assert.deepEqual(inputState, before, 'Rejected input changed project state');
}

function repositoryFixture() {
  const h = harness();
  for (const { id, path, role } of SOURCE_DEFINITIONS) h.apply('register_source', { id, path, role });
  h.apply('record_architecture_elements', { elements: architectureFixture(h) });
  h.apply('record_baseline_items', { items: baselineItems(h) });
  h.apply('register_plan', planPayload(h, 'plan:foundation', 'source:foundation', 'completed'));
  h.apply('register_plan', planPayload(h, 'plan:search', 'source:search', 'active'));
  h.apply('register_plan', planPayload(h, 'plan:export', 'source:export', 'planned'));
  h.apply('plan.create', { ...planPayload(h, 'plan:collaboration', 'source:collaboration', 'draft'),
    preparation: 'exploring' });
  const capturedRuns = linkedRuns('plan:foundation', ['run:foundation-1'])
    .concat(linkedRuns('plan:search', ['run:search-1', 'run:search-2']));
  h.apply('link_native_run', { plan_id: 'plan:foundation', native_project_id: 'native:offline-notebook', run_id: 'run:foundation-1' }, {}, { capturedRuns });
  h.apply('link_native_run', { plan_id: 'plan:search', native_project_id: 'native:offline-notebook', run_id: 'run:search-1' }, {}, { capturedRuns });
  h.apply('link_native_run', { plan_id: 'plan:search', native_project_id: 'native:offline-notebook', run_id: 'run:search-2' }, {}, { capturedRuns });
  return { h, capturedRuns };
}

function twoWorktreeObservations(h) {
  const acceptedRequirements = byId(h.state.sources, 'source:requirements').accepted_sha256;
  return [
    observation({ kind: 'git', worktree: 'main' }, {
      id: 'obs:git-main', content_revision: 'commit:1111111111111111111111111111111111111111',
      provenance: { kind: 'collector', reference: 'git status --porcelain=v2 --branch (worktree main)' },
      text: 'Worktree main at the accepted baseline commit; working tree clean.' }),
    observation({ kind: 'git', worktree: 'feature/search-index' }, {
      id: 'obs:git-feature', content_revision: 'commit:2222222222222222222222222222222222222222',
      provenance: { kind: 'collector', reference: 'git status --porcelain=v2 --branch (worktree feature/search-index)' },
      text: 'Linked worktree feature/search-index carries separate working revisions.' }),
    observation({ kind: 'source', id: 'source:requirements', worktree: 'main' }, {
      id: 'obs:req-main', content_revision: acceptedRequirements,
      observed_by: 'collector:source-digest',
      provenance: { kind: 'file', reference: 'docs/project/requirements.md (worktree main)' },
      text: 'The main worktree holds the accepted requirement revision.' }),
    observation({ kind: 'source', id: 'source:requirements', worktree: 'feature/search-index' }, {
      id: 'obs:req-feature', content_revision: hash('working revision of requirements.md on feature/search-index'),
      observed_by: 'collector:source-digest',
      provenance: { kind: 'file', reference: 'docs/project/requirements.md (worktree feature/search-index)' },
      text: 'The linked worktree carries a different working revision of the same document.' }),
  ];
}

test('acceptance fixture: one repository, multiple plans, two worktrees and historical runs', () => {
  const { h } = repositoryFixture();
  const snapshot = h.snapshot();
  assert.equal(snapshot.project_id, PROJECT_ID);
  assert.equal(snapshot.summary.plan_count, 4);
  assert.equal(snapshot.summary.accepted_features, 1);
  assert.equal(snapshot.summary.accepted_requirements, 1);
  assert.equal(snapshot.summary.accepted_decisions, 2, 'accepted decisions exclude the superseded one');

  const foundation = byId(snapshot.plans, 'plan:foundation');
  const search = byId(snapshot.plans, 'plan:search');
  const collaboration = byId(snapshot.plans, 'plan:collaboration');
  assert.equal(foundation.declared_lifecycle, 'completed');
  assert.deepEqual(foundation.native_runs.map(run => run.run_id), ['run:foundation-1']);
  assert.equal(search.declared_lifecycle, 'active');
  assert.deepEqual(search.native_runs.map(run => run.run_id).sort(), ['run:search-1', 'run:search-2']);
  assert.equal(collaboration.declared_lifecycle, 'draft');
  assert.equal(collaboration.preparation, 'exploring');
  assert.ok(snapshot.plans.every(plan => plan.baseline_reference_status === 'current'));

  const requirement = byId(snapshot.items, 'requirement:offline');
  assert.equal(requirement.strength, 'binding');
  assert.equal(requirement.authority, 'user charter: offline-first');
  assert.match(requirement.rationale, /survive the loss of a network/);
  assert.deepEqual(requirement.applicability, { scope: 'repository' });
  assert.deepEqual(byId(snapshot.items, 'feature:notes').applicability, { scope: 'component', subject_ids: ['application:offline-notebook'] });
  const legacyDecision = byId(snapshot.items, 'decision:legacy-import-format');
  assert.equal(legacyDecision.state, 'superseded');
  assert.equal(legacyDecision.superseded_by, 'decision:standard-import-format');
  assert.equal(legacyDecision.applicability.period, 'Until the standard importer ships.');
  const offlineDecision = byId(snapshot.items, 'decision:offline-first');
  assert.match(offlineDecision.chosen, /Local-first/);
  assert.deepEqual(offlineDecision.rejected, ['Mandatory cloud sign-in before a workspace opens.']);

  const application = byId(snapshot.architecture, 'application:offline-notebook');
  assert.equal(application.kind, 'application');
  assert.ok(snapshot.architecture.every(element => element.parent_id === 'application:offline-notebook' || element.id === application.id));
  assert.deepEqual(byId(snapshot.architecture, 'component:notes-ui').relationships.map(edge => `${edge.kind}:${edge.target_id}`).sort(),
    ['uses:component:note-store', 'uses:interface:search-api']);

  // Two worktrees observe the same repository source at different working revisions.
  const beforeObserving = h.revisionKinds();
  h.observe(twoWorktreeObservations(h));
  const afterObserving = h.revisionKinds();
  assert.equal(afterObserving.observation_revision, 4);
  assert.equal(afterObserving.revision, beforeObserving.revision, 'Observations never advance the project revision');
  assert.equal(afterObserving.baseline_revision, beforeObserving.baseline_revision);
  const afterObservations = h.snapshot();
  assert.equal(afterObservations.observation_revision, 4);
  const requirementObservations = afterObservations.observations
    .filter(entry => entry.subject.kind === 'source' && entry.subject.id === 'source:requirements');
  assert.deepEqual(requirementObservations.map(entry => entry.subject.worktree).sort(), ['feature/search-index', 'main']);
  assert.notEqual(requirementObservations[0].content_revision, requirementObservations[1].content_revision);
  assert.equal(byId(afterObservations.items, 'requirement:offline').revision, requirement.revision,
    'A worktree observation never rewrites the accepted baseline item');

  const freshSession = harness(clone(h.state), clone(h.capturedSources));
  assert.deepEqual(freshSession.snapshot(), afterObservations);
  assertProjectState(freshSession.state);
});

test('metric support fields stay typed with support, basis, coverage and freshness distinct', () => {
  const { h } = repositoryFixture();
  const projectionRevision = h.state.revision;
  h.observe([usageObservation('obs:usage-1', 'request-1'), usageObservation('obs:usage-2', 'request-2')]);
  h.observe([observation({ kind: 'usage' }, {
    id: 'obs:metric-requests',
    observed_by: 'collector:usage-accounting',
    provenance: { kind: 'collector', reference: 'usage-accounting: window aggregate' },
    text: 'Usage reported for 7 of 10 recorded requests; token capture is not implied.',
    metric: {
      definition: 'Recorded provider requests in the declared window',
      unit: 'request',
      basis: 'Physical provider invocation grain; duplicates replayed without counting again.',
      support: 'Retained native usage events for this window only.',
      scope: 'repository',
      window: { from: '2026-10-05T14:00:00.000Z', to: '2026-10-05T14:30:00.000Z' },
      source_record_ids: ['obs:usage-1', 'obs:usage-2'],
      coverage: { reported: 7, total: 10 },
      as_of: '2026-10-05T14:30:00.000Z',
      projection_revision: projectionRevision,
    },
  }), observation({ kind: 'usage' }, {
    id: 'obs:metric-tokens-unknown',
    observed_by: 'collector:usage-accounting',
    provenance: { kind: 'collector', reference: 'usage-accounting: unknown denominator' },
    text: 'Token usage outside the reporting window; the denominator is unknown.',
    metric: {
      definition: 'Input and output tokens attributable to the project',
      unit: 'token',
      basis: 'Declared provider detail categories; no synthetic totals.',
      support: 'No provider report retained for this window.',
      scope: 'worktree',
      filters: { plan_id: null, run_id: null, task_id: null, worktree: 'main' },
      window: { from: null, to: '2026-10-05T14:30:00.000Z' },
      source_record_ids: [],
      coverage: { reported: null, total: null },
      as_of: '2026-10-05T14:30:00.000Z',
      projection_revision: projectionRevision,
    },
  })]);
  const snapshot = h.snapshot();
  const requests = byId(snapshot.observations, 'obs:metric-requests');
  assert.equal(requests.metric.coverage.reported, 7);
  assert.equal(requests.metric.coverage.total, 10);
  assert.equal(requests.metric.projection_revision, projectionRevision);
  assert.notEqual(requests.metric.basis, requests.metric.support);
  assert.notEqual(requests.metric.coverage.reported, requests.metric.support);
  const unknown = byId(snapshot.observations, 'obs:metric-tokens-unknown');
  assert.equal(unknown.metric.coverage.reported, null);
  assert.equal(unknown.metric.coverage.total, null, 'Unknown coverage stays null and never becomes a reported zero');
  assert.equal(unknown.observed_at, CREATED_AT, 'Freshness is the observation time, separate from basis and coverage');

  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'usage' }, {
    id: 'obs:metric-bad-scope',
    metric: { definition: 'x', unit: 'request', basis: 'x', support: 'x', scope: 'plan',
      window: { from: null, to: null }, source_record_ids: [], coverage: { reported: null, total: null },
      as_of: CREATED_AT, projection_revision: 0 },
  })]), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'usage' }, {
    id: 'obs:metric-unknown-record',
    metric: { definition: 'x', unit: 'request', basis: 'x', support: 'x', scope: 'repository',
      window: { from: null, to: null }, source_record_ids: ['obs:never-recorded'], coverage: { reported: null, total: null },
      as_of: CREATED_AT, projection_revision: 0 },
  })]), h.state);
});

test('revision kinds stay separate: incrementing one never bumps the others', () => {
  const { h } = repositoryFixture();
  h.observe(twoWorktreeObservations(h));
  const afterObserving = h.revisionKinds();
  assert.equal(afterObserving.observation_revision, 4);
  assert.equal(afterObserving.revision, afterObserving.revision);
  assert.equal(afterObserving.schema_version, 1);

  const beforeSourceRefresh = h.revisionKinds();
  const captured = h.capturedSources.find(source => source.source_id === 'source:requirements');
  captured.content = captured.content.replace('Cloud sign-in is not a prerequisite.',
    'Optional cloud sign-in must never block local reading or search.');
  captured.sha256 = hash(captured.content);
  h.apply('register_source', { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements' });
  const afterSourceRefresh = h.revisionKinds();
  assert.equal(afterSourceRefresh.source_revisions['source:requirements'],
    beforeSourceRefresh.source_revisions['source:requirements'] + 1, 'A source edit bumps only its document revision');
  assert.equal(afterSourceRefresh.baseline_revision, beforeSourceRefresh.baseline_revision);
  assert.equal(afterSourceRefresh.observation_revision, beforeSourceRefresh.observation_revision);
  assert.deepEqual(afterSourceRefresh.item_revisions, beforeSourceRefresh.item_revisions);
  assert.deepEqual(afterSourceRefresh.plan_revisions, beforeSourceRefresh.plan_revisions);
  assert.equal(afterSourceRefresh.schema_version, 1);

  const beforeBaseline = h.revisionKinds();
  h.apply('record_baseline_items', { items: baselineItems(h).filter(item => item.id === 'requirement:offline') });
  const afterBaseline = h.revisionKinds();
  assert.equal(afterBaseline.item_revisions['requirement:offline'], beforeBaseline.item_revisions['requirement:offline'] + 1);
  assert.equal(afterBaseline.baseline_revision, beforeBaseline.baseline_revision + 1);
  assert.equal(afterBaseline.observation_revision, beforeBaseline.observation_revision);
  assert.deepEqual(afterBaseline.source_revisions, beforeBaseline.source_revisions);
  assert.deepEqual(afterBaseline.plan_revisions, beforeBaseline.plan_revisions);

  const beforePlanEdit = h.revisionKinds();
  h.apply('plan.edit', { id: 'plan:collaboration', source: sourceReference(h, 'source:collaboration'),
    preparation: 'in_review',
    baseline_refs: ['feature:notes', 'requirement:offline'].map(itemId => ({
      item_id: itemId, item_revision: byId(h.state.items, itemId).revision,
    })) });
  const afterPlanEdit = h.revisionKinds();
  assert.equal(afterPlanEdit.plan_revisions['plan:collaboration'], beforePlanEdit.plan_revisions['plan:collaboration'] + 1);
  assert.equal(afterPlanEdit.baseline_revision, beforePlanEdit.baseline_revision);
  assert.equal(afterPlanEdit.observation_revision, beforePlanEdit.observation_revision);
  assert.deepEqual(afterPlanEdit.item_revisions, beforePlanEdit.item_revisions);
  assert.equal(byId(h.snapshot().plans, 'plan:collaboration').preparation, 'in_review');

  const metric = byId(h.snapshot().observations, 'obs:req-main');
  assert.equal(metric.version, 3, 'A retained observation keeps its own version unchanged by later commands');
});

test('plan lifecycle transitions validate edges, native-run authority and retirement metadata', () => {
  const { h } = repositoryFixture();
  expectContractFailure(() => h.apply('plan.transition', { plan_id: 'plan:export', to_lifecycle: 'active' }), h.state);
  expectContractFailure(() => h.apply('plan.transition', { plan_id: 'plan:foundation', to_lifecycle: 'active' }), h.state);
  expectContractFailure(() => h.apply('plan.transition', { plan_id: 'plan:unknown', to_lifecycle: 'planned' }), h.state);
  expectContractFailure(() => h.apply('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'superseded' }), h.state);

  h.apply('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'paused', reason: 'Waiting on the offline verification gate.' });
  let search = byId(h.snapshot().plans, 'plan:search');
  assert.equal(search.declared_lifecycle, 'paused');
  assert.equal(search.last_transition.from, 'active');
  assert.equal(search.last_transition.to, 'paused');
  assert.equal(search.last_transition.reason, 'Waiting on the offline verification gate.');
  h.apply('plan.transition', { plan_id: 'plan:search', to_lifecycle: 'active' });
  search = byId(h.snapshot().plans, 'plan:search');
  assert.equal(search.declared_lifecycle, 'active');
  assert.equal(search.last_transition.reason, null);

  h.apply('plan.create', { ...planPayload(h, 'plan:replacement', 'source:export', 'planned') });
  h.apply('plan.transition', { plan_id: 'plan:export', to_lifecycle: 'superseded',
    reason: 'Folded into the replacement plan.', successor_plan_id: 'plan:replacement' });
  const exportPlan = byId(h.snapshot().plans, 'plan:export');
  assert.equal(exportPlan.declared_lifecycle, 'superseded');
  assert.equal(exportPlan.supersession.successor_plan_id, 'plan:replacement');
  assert.equal(exportPlan.supersession.reason, 'Folded into the replacement plan.');
  expectContractFailure(() => h.apply('plan.transition', { plan_id: 'plan:export', to_lifecycle: 'planned' }), h.state);
});

test('capability operations read, preview and apply through one typed path', () => {
  const { h } = repositoryFixture();
  const before = clone(h.state);

  const read = projectCapability(h.state, { schema_version: 1, operation: 'project.read', project_id: PROJECT_ID });
  assert.equal(read.status, 'ok');
  assert.equal(read.snapshot.revision, h.state.revision);
  assert.deepEqual(h.state, before, 'A capability read is inert');

  const change = { operation: 'register_source', payload: {
    id: 'source:followup', path: '.omo/plans/followup.md', role: 'plan' } };
  const followup = readFileSync(new URL('./fixtures/offline-notebook/plans/followup.md', import.meta.url), 'utf8');
  h.capturedSources.push({ source_id: 'source:followup', path: '.omo/plans/followup.md', sha256: hash(followup), content: followup });

  const preview = projectCapability(h.state, { schema_version: 1, operation: 'project.change.preview',
    project_id: PROJECT_ID, expected_revision: h.state.revision, payload: { change } }, h.context());
  assert.equal(preview.status, 'valid');
  assert.deepEqual(preview.changed_ids, ['source:followup']);
  assert.equal(preview.next_revision, h.state.revision + 1);
  assert.deepEqual(h.state, before, 'A preview is inert');

  const stale = projectCapability(h.state, { schema_version: 1, operation: 'project.change.preview',
    project_id: PROJECT_ID, expected_revision: h.state.revision - 1, payload: { change } });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.reason, 'REVISION_CONFLICT');

  const invalid = projectCapability(h.state, { schema_version: 1, operation: 'project.change.preview',
    project_id: PROJECT_ID, expected_revision: h.state.revision,
    payload: { change: { operation: 'register_plan', payload: { ...planPayload(h, 'plan:ghost', 'source:export', 'planned'),
      source: { source_id: 'source:export', sha256: hash('not the registered digest'), anchor_id: 'document' } } } } });
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.reason, 'SOURCE_REVISION_MISMATCH');

  const applied = h.apply('project.change.apply', { change });
  assert.equal(applied.receipt.status, 'saved');
  assert.deepEqual(applied.receipt.changed_ids, ['source:followup']);
  assert.ok(h.state.sources.some(source => source.id === 'source:followup'));

  const beforeCommandRoute = clone(h.state);
  const commandPreview = applyProjectCommand(h.state, h.command('project.change.preview', { change: {
    operation: 'register_source', payload: { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements' } } }), h.context());
  assert.equal(commandPreview.status, 'valid');
  const commandRouted = applyProjectCommand(h.state, h.command('project.read', {}), h.context());
  assert.equal(commandRouted.status, 'ok');
  assert.equal(commandRouted.revision, h.state.revision);
  assert.deepEqual(h.state, beforeCommandRoute, 'Inert capability operations through the command path never mutate state');
  const foreign = projectCapability(h.state, { schema_version: 1, operation: 'project.read', project_id: 'project:someone-else' });
  assert.equal(foreign.status, 'rejected');
  assert.equal(foreign.reason, 'FOREIGN_PROJECT');
});

test('proposals, research, reconciliation and artifacts stay bookkeeping without authority', () => {
  const { h } = repositoryFixture();
  h.observe(twoWorktreeObservations(h));

  const acceptedRequirements = byId(h.state.sources, 'source:requirements').accepted_sha256;
  h.apply('record_baseline_proposal', {
    id: 'proposal:offline-conflict',
    summary: 'The collaboration plan proposes mandatory cloud sign-in against the accepted offline requirement.',
    patches: [{ source_id: 'source:requirements', anchor_id: 'heading:requirement:offline — Work without a network',
      current_sha256: acceptedRequirements,
      proposed_text: 'Optional cloud sign-in must never block local reading or search.' }],
    options: [
      { id: 'option:retain-offline', title: 'Retain offline operation', summary: 'Revise sign-in to be optional.' },
      { id: 'option:amend-requirement', title: 'Amend the requirement', summary: 'Accept mandatory sign-in with its consequences.' },
    ],
    impact: { item_ids: ['requirement:offline'], plan_ids: ['plan:collaboration'], architecture_ids: ['boundary:sync-service'] },
    evidence_observation_ids: ['obs:git-main', 'obs:req-main'],
    unresolved: 'Retain offline operation or amend the accepted requirement?',
    authority: 'user charter: offline-first',
  });
  h.apply('record_research_findings', { findings: [{
    id: 'research:sign-in-alternatives',
    question: 'Can collaboration features work without mandatory cloud sign-in?',
    sources: ['docs/project/requirements.md', 'vendor docs: local share links'],
    captured_at: '2026-10-01T09:00:00.000Z',
    findings: 'Local share links cover the reviewed collaboration scenarios.',
    uncertainty: 'Real-time co-editing was not reviewed.',
    recommendation: 'Keep sign-in optional; promote only through an accepted proposal.',
    promotion_proposal_id: 'proposal:offline-conflict',
  }] });
  h.apply('project.reconcile.request', { id: 'reconcile:collaboration-conflict', trigger: 'new_plan',
    changed: { source_ids: [], item_ids: ['requirement:offline'], plan_ids: ['plan:collaboration'], architecture_ids: [] } });
  h.apply('artifact.register', { id: 'artifact:foundation-verifier-report', type: 'verification_report',
    producer: 'verifier:independent', path: '.lazybuddy/runs/run-foundation-1/receipts/verifier.json',
    sha256: hash('historical verifier report fixture') });
  h.apply('run.request', { id: 'request:search-retry', plan_id: 'plan:search', note: 'Retry the disconnected verification branch.' });
  h.apply('run.cancel.request', { id: 'request:cancel-search-2', plan_id: 'plan:search', run_id: 'run:search-2' });

  const snapshot = h.snapshot();
  const proposal = byId(snapshot.proposals, 'proposal:offline-conflict');
  assert.equal(proposal.state, 'proposed');
  assert.equal(proposal.unresolved, 'Retain offline operation or amend the accepted requirement?');
  assert.equal(snapshot.summary.pending_proposals, 1);
  assert.equal(byId(snapshot.research, 'research:sign-in-alternatives').promotion_proposal_id, 'proposal:offline-conflict');
  const reconciliation = byId(snapshot.reconciliations, 'reconcile:collaboration-conflict');
  assert.equal(reconciliation.native_adoption, 'unobserved');
  assert.deepEqual(reconciliation.checks, []);
  assert.deepEqual(reconciliation.automatic_change_ids, []);
  assert.deepEqual(reconciliation.unresolved_proposal_ids, []);
  assert.equal(byId(snapshot.artifacts, 'artifact:foundation-verifier-report').type, 'verification_report');
  assert.deepEqual(snapshot.requests.map(request => request.kind).sort(), ['run', 'run_cancel']);
  assert.ok(snapshot.requests.every(request => request.delivery === 'unobserved' && request.state === 'recorded'));

  // Recording evidence and requests grants no verification and accepts nothing.
  const requirement = byId(snapshot.items, 'requirement:offline');
  assert.equal(requirement.state, 'accepted');
  assert.equal(requirement.revision, 1);
  assert.equal(byId(snapshot.plans, 'plan:collaboration').declared_lifecycle, 'draft');
  assert.equal(byId(snapshot.plans, 'plan:foundation').alignment, 'unassessed');
  assert.ok(!Object.hasOwn(snapshot.summary, 'verified_features'));
  assert.ok(!Object.hasOwn(snapshot.summary, 'active_agents'));

  const observedRuns = projectSnapshot(h.state, { sourceObservations: h.sourceObservations(), runObservations: [
    { runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:foundation-1',
      execution: 'finished', observed_at: CREATED_AT }] });
  assert.equal(byId(observedRuns.plans, 'plan:foundation').native_observations[0].execution, 'finished');
  assert.ok(!Object.hasOwn(byId(observedRuns.plans, 'plan:foundation'), 'verified'));

  const freshSession = harness(clone(h.state), clone(h.capturedSources));
  assert.deepEqual(freshSession.snapshot(), snapshot);
});

function forbidVerificationKeys(value, path = 'snapshot') {
  if (Array.isArray(value)) { value.forEach((entry, index) => forbidVerificationKeys(entry, `${path}[${index}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(!['verification', 'verified', 'proof', 'trusted'].includes(key), `${path}.${key} smuggles verification authority`);
      forbidVerificationKeys(entry, `${path}.${key}`);
    }
  }
}

test('ambiguous identities fail closed across every new entity and record boundary', () => {
  const { h } = repositoryFixture();
  h.observe(twoWorktreeObservations(h));

  expectContractFailure(() => recordObservations(h.state, twoWorktreeObservations(h)), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'source', id: 'source:unknown' }, { id: 'obs:ghost' })]), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'artifact', id: 'artifact:unknown' }, { id: 'obs:ghost' })]), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'plan' }, { id: 'plan:search' })]), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'source', id: 'source:requirements' }, {
    id: 'obs:ghost', artifact_ids: ['artifact:missing'] })]), h.state);

  expectContractFailure(() => h.apply('record_architecture_elements', { elements: architectureFixture(h) }), h.state);
  expectContractFailure(() => h.apply('record_architecture_elements', { elements: [architectureInput(h, {
    relationships: [{ target_id: 'component:missing', kind: 'uses' }] })] }), h.state);
  expectContractFailure(() => h.apply('record_architecture_elements', { elements: [architectureInput(h, {
    parent_id: 'application:offline-notebook', id: 'application:offline-notebook' })] }), h.state);

  const acceptedRequirements = byId(h.state.sources, 'source:requirements').accepted_sha256;
  expectContractFailure(() => h.apply('record_baseline_proposal', {
    id: 'proposal:bad-source', summary: 'x',
    patches: [{ source_id: 'source:unknown', anchor_id: 'document', current_sha256: acceptedRequirements, proposed_text: 'x' }],
    options: [], impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_proposal', {
    id: 'proposal:bad-impact', summary: 'x', patches: [],
    options: [], impact: { item_ids: [], plan_ids: ['plan:missing'], architecture_ids: [] }, evidence_observation_ids: [] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_proposal', {
    id: 'proposal:bad-evidence', summary: 'x', patches: [],
    options: [], impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: ['obs:missing'] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_proposal', {
    id: 'proposal:bad-options', summary: 'x', patches: [],
    options: [{ id: 'option:a', title: 'a' }, { id: 'option:a', title: 'a again' }],
    impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [] }), h.state);

  expectContractFailure(() => h.apply('record_research_findings', { findings: [{
    id: 'research:bad-promotion', question: 'q', sources: ['s'], captured_at: CREATED_AT, findings: 'f',
    promotion_proposal_id: 'proposal:missing' }] }), h.state);
  expectContractFailure(() => h.apply('project.reconcile.request', { id: 'reconcile:bad', trigger: 'source_change',
    changed: { source_ids: [], item_ids: [], plan_ids: ['plan:missing'], architecture_ids: [] } }), h.state);
  h.apply('project.reconcile.request', { id: 'reconcile:scoped', trigger: 'source_change' });
  expectContractFailure(() => h.apply('project.reconcile.request', { id: 'reconcile:scoped', trigger: 'source_change' }), h.state);

  h.apply('artifact.register', { id: 'artifact:one', type: 'log', producer: 'p', path: 'logs/a.log' });
  expectContractFailure(() => h.apply('artifact.register', { id: 'artifact:two', type: 'log', producer: 'p', path: 'logs/a.log' }), h.state);
  expectContractFailure(() => h.apply('artifact.register', { id: 'feature:notes', type: 'log', producer: 'p', path: 'logs/b.log' }), h.state);
  expectContractFailure(() => recordObservations(h.state, [observation({ kind: 'usage' }, { id: 'plan:search' })]), h.state);

  expectContractFailure(() => h.apply('run.request', { id: 'request:bad', plan_id: 'plan:missing' }), h.state);
  expectContractFailure(() => h.apply('run.cancel.request', { id: 'request:bad', plan_id: 'plan:search', run_id: 'run:unlinked' }), h.state);
  expectContractFailure(() => h.apply('run.request', { id: 'request:bad', plan_id: 'plan:foundation' }), h.state);
  expectContractFailure(() => h.apply('plan.create', planPayload(h, 'plan:search', 'source:export', 'draft')), h.state);
  expectContractFailure(() => h.apply('plan.edit', { id: 'plan:missing', source: sourceReference(h, 'source:export'), baseline_refs: [] }), h.state);

  const items = baselineItems(h);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[0], chosen: 'A feature cannot carry decision fields.' }] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[1], superseded_by: 'decision:missing' }] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[1], superseded_by: 'requirement:offline' }] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[0], applicability: { scope: 'component' } }] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[5], applicability: { scope: 'migration', subject_ids: ['x'], period: 'p' }, id: 'requirement:offline', kind: 'requirement' }] }), h.state);
  expectContractFailure(() => h.apply('record_baseline_items', {
    items: [{ ...items[1], applicability: { scope: 'repository', subject_ids: ['feature:notes'] } }] }), h.state);
});

test('false verification fails closed on every new record kind and stays absent from the projection', () => {
  const { h } = repositoryFixture();
  h.observe(twoWorktreeObservations(h));
  h.observe([observation({ kind: 'usage' }, {
    id: 'obs:metric-window',
    observed_by: 'collector:usage-accounting',
    provenance: { kind: 'collector', reference: 'usage-accounting: window aggregate' },
    text: 'Window aggregate retained for authority-injection probes.',
    metric: { definition: 'Recorded provider requests in the declared window', unit: 'request',
      basis: 'Physical provider invocation grain.', support: 'Retained native usage events.',
      scope: 'repository', window: { from: null, to: null }, source_record_ids: [],
      coverage: { reported: 1, total: 1 }, as_of: CREATED_AT, projection_revision: h.state.revision },
  })]);
  h.apply('record_baseline_proposal', { id: 'proposal:offline-conflict', summary: 'conflict',
    patches: [], options: [], impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [] });
  h.apply('record_research_findings', { findings: [{ id: 'research:sign-in-alternatives', question: 'q',
    sources: ['s'], captured_at: CREATED_AT, findings: 'f' }] });
  h.apply('project.reconcile.request', { id: 'reconcile:one', trigger: 'source_change' });
  h.apply('artifact.register', { id: 'artifact:report', type: 'verification_report', producer: 'verifier:independent',
    path: '.lazybuddy/runs/run-foundation-1/receipts/verifier.json' });
  h.apply('run.request', { id: 'request:one', plan_id: 'plan:search' });

  const state = h.state;
  const inject = mutate => {
    const persisted = clone(state);
    mutate(persisted);
    expectContractFailure(() => assertProjectState(persisted));
    expectContractFailure(() => projectSnapshot(persisted));
  };
  inject(persisted => { persisted.proposals[0].verification = 'verified'; });
  inject(persisted => { persisted.architecture[0].verified = true; });
  inject(persisted => { persisted.research[0].proof = 'report.md'; });
  inject(persisted => { persisted.reconciliations[0].trusted = true; });
  inject(persisted => { persisted.observations[0].verification = 'verified'; });
  inject(persisted => { persisted.observations.find(entry => entry.id === 'obs:metric-window').metric.verified = true; });
  inject(persisted => { persisted.artifacts[0].verification = 'verified'; });
  inject(persisted => { persisted.requests[0].delivery = 'consumed'; });
  inject(persisted => { persisted.items[0].verified = true; });
  inject(persisted => { persisted.plans[0].verification = 'verified'; });

  for (const [operation, payload] of [
    ['record_baseline_proposal', { id: 'p2', summary: 'x', patches: [], options: [],
      impact: { item_ids: [], plan_ids: [], architecture_ids: [] }, evidence_observation_ids: [], verification: 'verified' }],
    ['record_architecture_elements', { elements: [{ ...architectureInput(h, { id: 'component:ghost' }), verified: true }] }],
    ['record_research_findings', { findings: [{ id: 'r2', question: 'q', sources: ['s'], captured_at: CREATED_AT,
      findings: 'f', verified: true }] }],
    ['project.reconcile.request', { id: 'reconcile:two', trigger: 'source_change', resolved: 'accepted' }],
    ['artifact.register', { id: 'artifact:two', type: 'log', producer: 'p', path: 'logs/two.log', verification: 'verified' }],
    ['run.request', { id: 'request:two', plan_id: 'plan:search', delivery: 'queued' }],
    ['run.cancel.request', { id: 'request:three', plan_id: 'plan:search', run_id: 'run:search-1', cancelled: true }],
    ['plan.transition', { plan_id: 'plan:search', to_lifecycle: 'completed', verified: true }],
  ]) expectContractFailure(() => h.apply(operation, payload), h.state);

  expectContractFailure(() => recordObservations(h.state, [{ ...observation({ kind: 'git', worktree: 'main' }, {
    id: 'obs:claimed-verified' }), verification: 'verified' }]), h.state);

  forbidVerificationKeys(h.snapshot());
  const observed = projectSnapshot(h.state, { sourceObservations: h.sourceObservations(), runObservations: [
    { runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:foundation-1',
      execution: 'finished', observed_at: CREATED_AT }] });
  forbidVerificationKeys(observed);
  assert.equal(byId(observed.plans, 'plan:foundation').alignment, 'unassessed');
});

test('states persisted before the extension load unchanged and keep accepting commands', () => {
  // A genuine pre-extension persisted file: no new collections and no new item fields.
  const g = harness();
  for (const index of [0, 1, 4]) {
    const { id, path, role } = SOURCE_DEFINITIONS[index];
    g.apply('register_source', { id, path, role });
  }
  g.apply('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: sourceReference(g, 'source:requirements', 'heading:feature:notes — Personal notes') },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
      source: sourceReference(g, 'source:requirements', 'heading:requirement:offline — Work without a network') },
  ] });
  g.apply('register_plan', { id: 'plan:foundation', source: sourceReference(g, 'source:foundation'),
    declared_lifecycle: 'completed', baseline_refs: [{ item_id: 'feature:notes', item_revision: 1 }] });
  const legacy = clone(g.state);
  for (const key of ['proposals', 'architecture', 'research', 'reconciliations', 'observations',
    'artifacts', 'requests', 'observation_revision']) delete legacy[key];
  assertProjectState(legacy);
  const legacySnapshot = projectSnapshot(legacy, {});
  assert.deepEqual(legacySnapshot.proposals, []);
  assert.deepEqual(legacySnapshot.architecture, []);
  assert.deepEqual(legacySnapshot.observations, []);
  assert.equal(legacySnapshot.observation_revision, 0);
  assert.equal(legacySnapshot.summary.pending_proposals, 0);

  const followup = readFileSync(new URL('./fixtures/offline-notebook/plans/followup.md', import.meta.url), 'utf8');
  const continued = harness(legacy, [...clone(g.capturedSources),
    { source_id: 'source:followup', path: '.omo/plans/followup.md', sha256: hash(followup), content: followup }]);
  continued.apply('register_source', { id: 'source:followup', path: '.omo/plans/followup.md', role: 'plan' });
  assert.ok(continued.state.sources.some(source => source.id === 'source:followup'));
  assert.equal(continued.state.observation_revision, undefined, 'A legacy state does not gain observation history implicitly');
  continued.observe([observation({ kind: 'git', worktree: 'main' }, { id: 'obs:resumed' })]);
  assert.equal(continued.state.observation_revision, 1);
  assertProjectState(continued.state);
});
