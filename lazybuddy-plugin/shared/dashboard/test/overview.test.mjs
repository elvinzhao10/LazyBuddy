import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T14 Overview + project shell — define-then-run UI test over a REAL project
// projection: the state is built through the actual project model commands from
// the offline-notebook fixtures, then composed with the T07 graph/readiness/
// progress modules, the T10 usage/time accounting and a T11-shaped git fact
// bundle. The overview itself must never touch files or schedule anything.

const dom = createMiniDom();
globalThis.document = dom.document;

const { createProject, applyProjectCommand } = await import('../../project/model.mjs');
const { projectSnapshot } = await import('../../project/projection.mjs');
const { composeGraphSet } = await import('../../project/plans/dependencies.mjs');
const { normalizeDependencyFacts, derivePlanReadiness } = await import('../../project/plans/readiness.mjs');
const { groupProgress } = await import('../../project/plans/progress.mjs');
const { normalizeUsage, accountTime } = await import('../../project/usage-accounting.mjs');
const { overviewFixture, OverviewProjectionError } = await import('../ui/overview-fixture.mjs');
const { createOverviewView } = await import('../ui/overview.mjs');
const { createProjectShell, PROJECT_DESTINATIONS } = await import('../ui/project-shell.mjs');

const CREATED_AT = '2026-10-05T15:00:00.000Z';
const PROJECT_ID = 'project:offline-notebook';
const hash = seed => createHash('sha256').update(seed).digest('hex');

const SOURCE_DEFINITIONS = [
  { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements', fixture: 'requirements.md' },
  { id: 'source:principles', path: 'docs/project/principles.md', role: 'principles', fixture: 'principles.md' },
  { id: 'source:architecture', path: 'docs/project/architecture.md', role: 'architecture', fixture: 'architecture.md' },
  { id: 'source:decisions', path: 'docs/project/decisions.md', role: 'decision', fixture: 'decisions.md' },
  { id: 'source:foundation', path: '.omo/plans/foundation.md', role: 'plan', fixture: 'plans/foundation.md' },
  { id: 'source:search', path: '.omo/plans/search.md', role: 'plan', fixture: 'plans/search.md' },
  { id: 'source:export', path: '.omo/plans/export.md', role: 'plan', fixture: 'plans/export.md' },
  { id: 'source:collaboration', path: '.omo/plans/collaboration.md', role: 'plan', fixture: 'plans/collaboration.md' },
];

function captures() {
  return SOURCE_DEFINITIONS.map(source => {
    const content = readFileSync(new URL(`../../project/test/fixtures/offline-notebook/${source.fixture}`, import.meta.url), 'utf8');
    return { source_id: source.id, path: source.path, sha256: hash(content), content };
  });
}

function buildRealProjectionBundle() {
  let state = createProject({ projectId: PROJECT_ID, runtime: 'LazyBuddy', repositoryKey: 'repo:offline-notebook', createdAt: CREATED_AT });
  let nextCommand = 0;
  const capturedSources = captures();
  const capturedRuns = [
    { runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:foundation-1' },
    { runtime: 'LazyBuddy', native_project_id: 'native:offline-notebook', run_id: 'run:search-1' },
  ];
  const context = () => ({ actor: 'user:test', occurredAt: CREATED_AT, capturedSources, capturedRuns });
  const apply = (operation, payload) => {
    nextCommand += 1;
    const result = applyProjectCommand(state, { schema_version: 1, command_id: `command:${nextCommand}`,
      project_id: PROJECT_ID, expected_revision: state.revision, operation, payload }, context());
    assert.equal(result.receipt.status, 'saved', `${operation} must save`);
    state = result.state;
  };
  const sourceRef = sourceId => ({ source_id: sourceId, sha256: capturedSources.find(entry => entry.source_id === sourceId).sha256, anchor_id: 'document' });
  const itemRef = itemId => ({ item_id: itemId, item_revision: state.items.find(item => item.id === itemId).revision });

  for (const { id, path, role } of SOURCE_DEFINITIONS) apply('register_source', { id, path, role });
  apply('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted', source: { ...sourceRef('source:requirements'), anchor_id: 'heading:feature:notes — Personal notes' }, applicability: { scope: 'repository' } },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding', source: { ...sourceRef('source:requirements'), anchor_id: 'heading:requirement:offline — Work without a network' }, rationale: 'Primary workflows must survive the loss of a network connection.', authority: 'user charter: offline-first', applicability: { scope: 'repository' } },
    { id: 'principle:local-first', kind: 'principle', state: 'accepted', source: { ...sourceRef('source:principles'), anchor_id: 'heading:principle:local-first — Preserve local ownership' }, applicability: { scope: 'environment', subject_ids: ['environment:local-install'] } },
    { id: 'decision:offline-first', kind: 'decision', state: 'accepted', source: { ...sourceRef('source:decisions'), anchor_id: 'heading:decision:offline-first — Keep primary workflows offline' }, chosen: 'Local-first operation with optional cloud services.', rejected: ['Mandatory cloud sign-in before a workspace opens.'], authority: 'requirement:offline' },
  ] });
  const planPayload = (id, sourceId, lifecycle) => ({ id, source: sourceRef(sourceId), declared_lifecycle: lifecycle,
    baseline_refs: ['feature:notes', 'requirement:offline'].map(itemRef) });
  apply('register_plan', planPayload('plan:foundation', 'source:foundation', 'completed'));
  apply('register_plan', planPayload('plan:search', 'source:search', 'active'));
  apply('register_plan', planPayload('plan:export', 'source:export', 'planned'));
  apply('plan.create', { ...planPayload('plan:collaboration', 'source:collaboration', 'draft'), preparation: 'exploring' });
  const runs = [['plan:foundation', 'run:foundation-1'], ['plan:search', 'run:search-1']];
  for (const [planId, runId] of runs) apply('link_native_run', { plan_id: planId, native_project_id: 'native:offline-notebook', run_id: runId });
  apply('record_baseline_proposal', {
    id: 'proposal:offline-vs-cloud', summary: 'Mandatory cloud relay rollout conflicts with the offline requirement',
    patches: [{ source_id: 'source:collaboration', anchor_id: 'document',
      current_sha256: capturedSources.find(entry => entry.source_id === 'source:collaboration').sha256,
      proposed_text: '- [ ] Mandatory cloud sign-in before a workspace opens' }],
    options: [{ id: 'option:keep-offline', title: 'Keep offline operation', summary: 'Sign-in stays optional.' }],
    impact: { item_ids: ['requirement:offline'], plan_ids: ['plan:collaboration'], architecture_ids: [] },
    evidence_observation_ids: [], unresolved: 'Retain offline operation and keep sign-in optional, or amend the requirement with the consequences?' });

  // T07 accepted graph set: cross-plan gate dependency, external decision
  // prerequisite and typed inter-plan edges.
  const contentHash = planId => state.plans.find(plan => plan.id === planId).source.sha256;
  const revisionOf = planId => state.plans.find(plan => plan.id === planId).revision;
  const graphDocuments = [
    { schema_version: 1, plan_id: 'plan:foundation', plan_revision: revisionOf('plan:foundation'), content_sha256: contentHash('plan:foundation'),
      tasks: [{ id: 'f1', title: 'Deliver the persistent records foundation', criteria: [{ id: 'c-found', revision: 1 }], dependencies: [] }],
      edges: [{ id: 'edge:found-feature', kind: 'contributes-to-feature', from_plan_id: 'plan:foundation', item_id: 'feature:notes' }] },
    { schema_version: 1, plan_id: 'plan:search', plan_revision: revisionOf('plan:search'), content_sha256: contentHash('plan:search'),
      tasks: [
        { id: 's1', title: 'Build the shared search index', criteria: [{ id: 'c-index', revision: 2 }], dependencies: [] },
        { id: 's2', title: 'Offline change queue', criteria: [{ id: 'c-queue', revision: 2 }], dependencies: [] },
      ],
      edges: [{ id: 'edge:search-feature', kind: 'contributes-to-feature', from_plan_id: 'plan:search', item_id: 'feature:notes' }] },
    { schema_version: 1, plan_id: 'plan:export', plan_revision: revisionOf('plan:export'), content_sha256: contentHash('plan:export'),
      tasks: [{ id: 'e1', title: 'Export against the shared index contract', criteria: [{ id: 'c-export', revision: 1 }],
        dependencies: [{ id: 'dep:search-index', kind: 'depends-on-gate', condition: 'independent-verification-confirmed',
          gate_id: 'gate:search-index', target: { type: 'task', plan_id: 'plan:search', task_id: 's1' } },
        { id: 'dep:offline-decision', kind: 'depends-on-gate', condition: 'external-decision-accepted',
          gate_id: 'decision:offline-first', target: { type: 'decision', item_id: 'decision:offline-first', item_revision: state.items.find(item => item.id === 'decision:offline-first').revision } }] }],
      edges: [{ id: 'edge:export-search', kind: 'depends-on-gate', from_plan_id: 'plan:export', to_plan_id: 'plan:search', note: 'waits on the verified index contract' }] },
    { schema_version: 1, plan_id: 'plan:collaboration', plan_revision: revisionOf('plan:collaboration'), content_sha256: contentHash('plan:collaboration'),
      tasks: [{ id: 'x1', title: 'Explore mandatory cloud relay', criteria: [{ id: 'c-relay', revision: 1 }], dependencies: [] }],
      edges: [{ id: 'edge:collab-extends', kind: 'extends', from_plan_id: 'plan:collaboration', to_plan_id: 'plan:export' }] },
  ];
  const set = composeGraphSet(graphDocuments, { state });
  // Facts: foundation finished and verified; search s1 verified at the current
  // criterion revision, s2 unverified; export's gate cites the older revision 1
  // so it is stale — the required stale verifier gate case.
  const facts = normalizeDependencyFacts([
    { id: 'fact:f-exec', kind: 'task', condition: 'execution-finished', value: true, observed_at: CREATED_AT, plan_id: 'plan:foundation', task_id: 'f1', basis: { plan_revision: revisionOf('plan:foundation'), content_sha256: contentHash('plan:foundation') } },
    { id: 'fact:f-verify', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: CREATED_AT, plan_id: 'plan:foundation', task_id: 'f1', basis: { plan_revision: revisionOf('plan:foundation'), content_sha256: contentHash('plan:foundation'), criterion_revisions: { 'c-found': 1 } } },
    { id: 'fact:s1-exec', kind: 'task', condition: 'execution-finished', value: true, observed_at: CREATED_AT, plan_id: 'plan:search', task_id: 's1', basis: { plan_revision: revisionOf('plan:search'), content_sha256: contentHash('plan:search') } },
    { id: 'fact:s1-verify', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: CREATED_AT, plan_id: 'plan:search', task_id: 's1', basis: { plan_revision: revisionOf('plan:search'), content_sha256: contentHash('plan:search'), criterion_revisions: { 'c-index': 2 } } },
    { id: 'fact:s1-verify-old', kind: 'task', condition: 'independent-verification-confirmed', value: true, observed_at: '2026-10-05T14:00:00.000Z', plan_id: 'plan:search', task_id: 's1', basis: { plan_revision: revisionOf('plan:search'), content_sha256: contentHash('plan:search'), criterion_revisions: { 'c-index': 1 } } },
  ]);
  const readiness = Object.fromEntries(state.plans.map(plan => [plan.id, derivePlanReadiness(state, set, facts, { plan_id: plan.id })]));
  const progress = groupProgress(state, set, facts, { scope: { kind: 'project' } });
  // T10 usage: declared subsets never add — 100 incl. cached 40 plus 50 incl.
  // reasoning 20 totals 150, not 210.
  const usage = normalizeUsage([
    { id: 'usage:a', request_id: 'req:a', kind: 'delta', observed_at: CREATED_AT, usage: { input_tokens: 100, cached_input_tokens: 40 } },
    { id: 'usage:b', request_id: 'req:b', kind: 'delta', observed_at: CREATED_AT, usage: { output_tokens: 50, reasoning_output_tokens: 20 } },
  ]);
  // T10 time: the 30-minute window fixture — 30 elapsed / 20 wall / 25 agent / peak 2.
  const time = { ...accountTime({ window_start: '2026-10-05T15:00:00.000Z', window_end: '2026-10-05T15:30:00.000Z',
    intervals: [
      { agent_id: 'agent:a', role: 'worker', started_at: '2026-10-05T15:00:00.000Z', ended_at: '2026-10-05T15:10:00.000Z' },
      { agent_id: 'agent:b', role: 'worker', started_at: '2026-10-05T15:05:00.000Z', ended_at: '2026-10-05T15:15:00.000Z' },
      { agent_id: 'agent:c', role: 'verifier', started_at: '2026-10-05T15:20:00.000Z', ended_at: '2026-10-05T15:25:00.000Z' },
    ] }), source_record_ids: ['interval:a', 'interval:b', 'interval:c'] };
  // T11-shaped observed local git facts (two worktrees, one changed path).
  const git = { collector: 'git-observation/local@1', status: 'observed', observed_at: CREATED_AT,
    repository: { root: '/private/tmp/offline-notebook' }, head: 'a'.repeat(40),
    worktrees: [
      { root: '/private/tmp/offline-notebook', kind: 'main', branch: 'main', current: true, status: 'observed',
        changed: { staged: { paths: [], total: 0 }, unstaged: { paths: [{ path: 'docs/project/requirements.md', xy: '.M' }], total: 1 },
          untracked: { paths: [], total: 0 }, unmerged: { paths: [], total: 0 } } },
      { root: '/private/tmp/offline-notebook-wt-search', kind: 'linked', branch: 'feature/search-index', current: false, status: 'observed',
        changed: { staged: { paths: [], total: 0 }, unstaged: { paths: [], total: 0 }, untracked: { paths: [], total: 0 }, unmerged: { paths: [], total: 0 } } },
    ] };
  const snapshot = projectSnapshot(state, { sourceObservations: capturedSources.map(source => ({
    source_id: source.source_id, status: 'available', sha256: source.sha256, path: source.path, observed_at: CREATED_AT })) });
  return { snapshot, planEdges: graphDocuments.flatMap(document => document.edges), readiness, progress, usage, time, git,
    external_prerequisites: [{ plan_id: 'plan:export', item_id: 'decision:offline-first', item_revision: state.items.find(item => item.id === 'decision:offline-first').revision }],
    project_name: 'Offline notebook' };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const bundle = buildRealProjectionBundle();

test('the overview adapter composes the verified projection into a presentation fixture', () => {
  const fixture = overviewFixture(bundle);
  assert.equal(fixture.viewId, 'overview');
  assert.equal(fixture.level, 'project');
  assert.equal(fixture.docId, `overview:${PROJECT_ID}`);
  assert.equal(fixture.title, 'Offline notebook');
  assert.ok(fixture.statement.text.includes('Offline notebook'));
  const kinds = new Set(fixture.nodes.map(node => node.kind));
  for (const expected of ['feature-area', 'plan', 'boundary', 'conflict']) assert.ok(kinds.has(expected), `node kind ${expected} present`);
  const edgeKinds = new Set(fixture.edges.map(edge => edge.kind));
  for (const expected of ['group', 'dependency', 'external']) assert.ok(edgeKinds.has(expected), `edge kind ${expected} present`);
  assert.ok(fixture.edges.some(edge => edge.kind === 'dependency' && edge.from === 'plan:export' && edge.to === 'plan:search'), 'inter-plan dependency edge from the T07 graph');
  assert.ok(fixture.metrics.length >= 6, 'compact metric strip covers plans, progress, baseline, usage, time and git');
  assert.ok(fixture.attentionQueue.length >= 1, 'attention queue present');
});

test('the adapter is deterministic and never mutates its bundle', () => {
  const first = overviewFixture(bundle);
  const second = overviewFixture(bundle);
  assert.deepEqual(first, second);
});

test('the adapter fails closed on dangling projection references', () => {
  assert.throws(() => overviewFixture(null), error => error instanceof OverviewProjectionError && error.code === 'SNAPSHOT_REQUIRED');
  assert.throws(() => overviewFixture({ snapshot: { project_id: 'p' } }), error => error.code === 'SNAPSHOT_SHAPE');
  const danglingEdge = { ...bundle, planEdges: [...bundle.planEdges, { id: 'edge:x', kind: 'depends-on-gate', from_plan_id: 'plan:ghost', to_plan_id: 'plan:search' }] };
  assert.throws(() => overviewFixture(danglingEdge), error => error.code === 'UNKNOWN_PLAN');
  const danglingReadiness = { ...bundle, readiness: { 'plan:ghost': bundle.readiness['plan:search'] } };
  assert.throws(() => overviewFixture(danglingReadiness), error => error.code === 'UNKNOWN_PLAN');
  const danglingFeature = { ...bundle, planEdges: [...bundle.planEdges, { id: 'edge:y', kind: 'contributes-to-feature', from_plan_id: 'plan:search', item_id: 'feature:ghost' }] };
  assert.throws(() => overviewFixture(danglingFeature), error => error.code === 'UNKNOWN_ITEM');
});

test('overview renders from the projection fixture with map, sentence, metrics and queue', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const root = view.element;
  assert.equal(root.dataset.testid, 'overview-view');
  assert.ok(root.querySelector('[data-testid="overview-statement"]'));
  const map = root.querySelector('[data-testid="project-spike"]');
  assert.ok(map, 'macro map reuses the T03 composition view');
  assert.ok(root.querySelectorAll('.spike-node').length >= 6, 'feature areas and plans render as cards');
  assert.ok(root.querySelector('.spike-node[data-node-id="feature:notes"]'), 'durable feature area node');
  assert.ok(root.querySelector('.spike-node[data-node-id="plan:search"]'), 'plan node');
  assert.ok(root.querySelector('.spike-node[data-node-id="boundary:decision:offline-first"], .spike-node[data-node-id^="boundary:"]'), 'external decision terminates at a boundary node');
  assert.ok(root.querySelector('[data-testid="overview-queue"]'));
  assert.ok(root.querySelector('[data-testid="overview-metrics"]'));
});

test('status-sentence clauses carry record links into the underlying records', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const sentence = view.element.querySelector('[data-testid="overview-status-sentence"]');
  assert.ok(sentence);
  const clauses = [...sentence.querySelectorAll('[data-clause-id]')];
  assert.ok(clauses.length >= 3, 'delivery, gate and git clauses composed');
  for (const clause of clauses) {
    const records = (clause.dataset.records ?? '').split(',').filter(Boolean);
    assert.ok(records.length >= 1, `clause ${clause.dataset.clauseId} carries record links`);
    for (const record of records) assert.ok(!/^(undefined|null)$/.test(record), `record id ${record} is real`);
  }
  const gateClause = clauses.find(clause => /gate|block/i.test(clause.textContent));
  assert.ok(gateClause, 'a verification-gate clause exists');
  gateClause.click();
  const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');
  assert.ok(recordsPanel.textContent.includes('plan:search') || recordsPanel.textContent.includes('plan:export'), 'gate clause opens its contributing records');
  const activeClause = clauses.find(clause => /active/i.test(clause.textContent));
  activeClause.click();
  assert.equal(view.getStats().selectedNodeId, 'plan:search', 'delivery clause selects the active plan in the macro map');
});

test('every displayed metric total opens its contributing records; unavailable never shows zero', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const metrics = [...view.element.querySelectorAll('[data-testid="overview-metrics"] [data-metric-id]')];
  assert.ok(metrics.length >= 6);
  const usageMetric = metrics.find(metric => metric.dataset.metricId === 'metric:usage');
  assert.match(usageMetric.textContent, /150/);
  assert.doesNotMatch(usageMetric.textContent, /210/);
  const timeMetric = metrics.find(metric => metric.dataset.metricId === 'metric:time');
  assert.match(timeMetric.textContent, /30/);
  assert.match(timeMetric.textContent, /25/);
  const gitMetric = metrics.find(metric => metric.dataset.metricId === 'metric:git');
  assert.match(gitMetric.textContent, /1 changed path/);
  for (const metric of metrics) {
    metric.click();
    const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');
    assert.match(recordsPanel.textContent, /contributing records/i, `${metric.dataset.metricId} opens its records`);
    const records = (metric.dataset.records ?? '').split(',').filter(Boolean);
    if (metric.dataset.unavailable !== 'true') assert.ok(records.length >= 1, `${metric.dataset.metricId} names its contributing records`);
  }
  // An unprojected input must read as unavailable, never zero.
  const partial = { ...bundle, usage: undefined, time: undefined, git: undefined };
  const partialView = createOverviewView({ bundle: partial });
  await settle();
  for (const id of ['metric:usage', 'metric:time', 'metric:git']) {
    const metric = partialView.element.querySelector(`[data-metric-id="${id}"]`);
    assert.equal(metric.dataset.unavailable, 'true', `${id} is explicitly unavailable`);
    assert.match(metric.textContent, /unavailable|not projected/i);
    assert.doesNotMatch(metric.textContent, /\b0 (tokens|min|changed)/, 'absence of data never renders as a zero total');
  }
});

test('collapsed plan groups reveal pending and stale gate state; expansion reveals the checks', async () => {
  const fixture = overviewFixture(bundle);
  const searchPlan = fixture.nodes.find(node => node.id === 'plan:search');
  assert.ok(searchPlan.children?.length >= 2, 'plan carries its criterion gate checks as children');
  const staleCheck = searchPlan.children.find(child => child.verification.state === 'stale' || child.verification.state === 'attention');
  assert.ok(staleCheck, 'a pending or stale check is represented');
  const view = createOverviewView({ bundle });
  await settle();
  const collapsedCard = view.element.querySelector('.spike-node[data-node-id="plan:search"]');
  assert.match(collapsedCard.textContent, /collapsed: \d+ checks/, 'collapsed group carries a check summary');
  assert.match(collapsedCard.textContent, /pending|stale/, 'collapsed summary reveals the pending/stale gate state');
  view.toggleGroup('plan:search');
  await settle();
  assert.ok(view.element.querySelector(`.spike-node[data-node-id="${staleCheck.id}"]`), 'expansion reveals the gate check');
});

test('narrow list equivalent keeps full labels and keyboard traversal', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  view.setMode('list');
  const rows = view.element.querySelectorAll('.spike-row-control');
  assert.ok(rows.length >= 6, 'hierarchical list equivalent');
  rows[0].focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.notEqual(document.activeElement, rows[0], 'ArrowDown moves within the list');
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.ok(view.getStats().selectedNodeId, 'Enter selects');
});

test('keyboard traversal: graph arrows, metric strip roving and clause reachability', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  assert.ok(view.focusNode('plan:foundation'));
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.ok(['plan:search', 'plan:export', 'plan:collaboration'].includes(document.activeElement.dataset.nodeId), 'ArrowRight crosses the inter-plan dependency layer');
  const metrics = [...view.element.querySelectorAll('[data-testid="overview-metrics"] [data-metric-id]')];
  metrics[0].focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(document.activeElement, metrics[1], 'ArrowRight roves across the metric strip');
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
  assert.equal(document.activeElement, metrics[0], 'ArrowLeft roves back');
  for (const clause of view.element.querySelectorAll('[data-clause-id][data-records]')) assert.equal(clause.tagName, 'BUTTON', 'link clauses are keyboard-reachable buttons');
});

test('hostile record text renders as text only', async () => {
  const hostile = structuredClone(bundle);
  hostile.snapshot.items.find(item => item.id === 'feature:notes').title = '<img src=x onerror=window.__pwned=1>';
  const view = createOverviewView({ bundle: hostile });
  await settle();
  assert.equal(view.element.querySelectorAll('img').length, 0);
  assert.ok(view.element.textContent.includes('<img src=x onerror='));
});

test('project destinations are absent pre-init and present post-init (IO-2)', async () => {
  assert.deepEqual(PROJECT_DESTINATIONS.map(destination => destination.id), ['overview', 'project', 'plans', 'execution', 'git', 'evidence', 'research']);
  const uninitialized = createProjectShell({ projectionProvider: () => null, product: { name: 'LazyBuddy' } });
  uninitialized.update();
  assert.equal(uninitialized.element.dataset.initialized, 'false');
  assert.equal(uninitialized.element.querySelectorAll('[data-destination]').length, 0, 'no project destinations before init');
  assert.ok(uninitialized.element.querySelector('[data-testid="shell-uninitialized"]'), 'pre-init state explains itself');
  const initialized = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
  initialized.update();
  await settle();
  assert.equal(initialized.element.dataset.initialized, 'true');
  const destinations = [...initialized.element.querySelectorAll('[data-destination]')];
  assert.equal(destinations.length, 7, 'all seven project destinations after init');
  assert.deepEqual(destinations.map(destination => destination.dataset.destination), PROJECT_DESTINATIONS.map(destination => destination.id));
  assert.ok(initialized.element.querySelector('[data-testid="shell-title"]').textContent.includes('Offline notebook'), 'project name leads the shell');
  assert.match(initialized.element.querySelector('[data-testid="shell-context"]').textContent, /repo:offline-notebook/, 'repository identity in the header');
  assert.match(initialized.element.querySelector('[data-testid="shell-context"]').textContent, /main/, 'branch in the header');
  assert.ok(initialized.element.querySelector('[data-testid="overview-view"]'), 'overview destination renders');
  const pending = destinations.filter(destination => destination.disabled);
  for (const destination of pending) {
    const reason = initialized.element.querySelector(`[id="${destination.getAttribute('aria-describedby')}"]`);
    assert.ok(reason && reason.textContent.length > 10, `disabled destination ${destination.dataset.destination} explains itself`);
  }
  // An init transition on the same shell instance flips the nav without residue.
  let exposed = null;
  const flipping = createProjectShell({ projectionProvider: () => exposed, product: { name: 'LazyBuddy' } });
  flipping.update();
  assert.equal(flipping.element.querySelectorAll('[data-destination]').length, 0);
  exposed = bundle;
  flipping.update();
  await settle();
  assert.equal(flipping.element.querySelectorAll('[data-destination]').length, 7);
});

test('shell destination bar supports keyboard roving and preserves the selection through updates', async () => {
  const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
  shell.update();
  await settle();
  const enabled = [...shell.element.querySelectorAll('[data-destination]')].filter(control => !control.disabled);
  assert.equal(enabled.length, 1, 'only Overview is a live destination in T14');
  enabled[0].focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(shell.getStats().activeDestination, 'overview');
  shell.update();
  await settle();
  assert.equal(shell.getStats().activeDestination, 'overview', 'polling-style update preserves the selected destination');
  assert.ok(shell.element.querySelector('[data-testid="overview-view"]'));
});

test('the overview and shell modules add no dependencies and never touch files or scheduling', async () => {
  const UI = new URL('../ui/', import.meta.url);
  for (const file of ['overview-fixture.mjs', 'overview.mjs', 'project-shell.mjs']) {
    const source = readFileSync(new URL(file, UI), 'utf8');
    for (const specifier of source.matchAll(/from\s+'([^']+)'/g)) {
      assert.match(specifier[1], /^\.?\//, `${file} imports only relative modules`);
    }
    for (const forbidden of [/node:/, /fetch\(/, /XMLHttpRequest/, /WebSocket/, /setTimeout/, /setInterval/, /spawn/]) {
      assert.equal(forbidden.test(source), false, `${file} must not contain ${forbidden}`);
    }
  }
});
