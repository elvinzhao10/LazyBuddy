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
// The view-level cases double as the [D] evidence for the T14 design audit
// (docs/design/audit-results/overview.md): heading discipline, chip status,
// tile/token CSS audits, tooltip-borne meta, keyboard reach and the honest
// unavailable states are asserted here against the real view component.

const dom = createMiniDom();
globalThis.document = dom.document;

const { createProject, applyProjectCommand } = await import('../../project/model.mjs');
const { projectSnapshot } = await import('../../project/projection.mjs');
const { composeGraphSet } = await import('../../project/plans/dependencies.mjs');
const { normalizeDependencyFacts, derivePlanReadiness } = await import('../../project/plans/readiness.mjs');
const { groupProgress } = await import('../../project/plans/progress.mjs');
const { normalizeUsage, accountTime } = await import('../../project/usage-accounting.mjs');
const { overviewFixture, OverviewProjectionError } = await import('../ui/overview-fixture.mjs');
const { createOverviewView, createStatusHero, createAttentionList, createPlanLifecycleStrip, createCoverageTiles,
  createMacroMapSection, createFreshnessLine, microBar } = await import('../ui/overview.mjs');
const { createProjectShell, PROJECT_DESTINATIONS } = await import('../ui/project-shell.mjs');
const { installFocusSystem, STATUS_STATES } = await import('../ui/components.mjs');

const CREATED_AT = '2026-10-05T15:00:00.000Z';

test('runtime problems appear in Attention and navigate directly to their relevant control surface', () => {
  const destinations = [];
  const attention = createAttentionList({ fixture: { attentionQueue: [] }, ownNote() {},
    openRecords() { throw new Error('runtime problems have a direct route'); },
    runtimeProblems: [{ id: 'source:missing', title: 'plan.md', detail: 'Registered source missing', destination: 'project' }],
    onNavigate: destination => destinations.push(destination) });
  assert.doesNotMatch(attention.textContent, /Nothing needs attention/);
  assert.match(attention.textContent, /Registered source missing/);
  attention.querySelector('button').click(); assert.deepEqual(destinations, ['project']);
});

test('attention disclosure retains every record route while limiting initial choices', () => {
  const opened = [];
  const fixture = { attentionQueue: Array.from({ length: 5 }, (_, index) => ({
    id: `queue:${index}`, title: `Plan ${index}`, kind: 'blocked-readiness', state: 'attention',
    detail: index === 4 ? 'NEW_REASON_CODE' : 'GATE_BLOCKED, CRITERIA_UNSATISFIED', records: [`plan:${index}`],
  })) };
  const attention = createAttentionList({ fixture, ownNote() {}, openRecords: record => opened.push(record) });
  assert.equal(attention.querySelector('[data-testid="overview-attention-list"]').querySelectorAll('button').length, 3);
  assert.equal(attention.querySelector('summary').textContent, 'Show 2 more attention items');
  assert.equal(attention.querySelector('details').querySelectorAll('button').length, 2);
  for (const control of attention.querySelectorAll('button')) control.click();
  assert.deepEqual(opened.map(record => record.records[0]), fixture.attentionQueue.map(item => item.records[0]));
  assert.match(attention.textContent, /A prerequisite verification gate has not passed/);
  assert.match(attention.textContent, /NEW_REASON_CODE/, 'unknown reasons remain visible');
});

test('historical execution readiness never crowds the actionable attention queue', () => {
  const next = structuredClone(bundle);
  next.readiness['plan:foundation'] = { ...next.readiness['plan:foundation'], blockers: [{ code: 'NATIVE_RUN_NOT_LINKED' }] };
  const fixture = overviewFixture(next);
  assert.ok(!fixture.attentionQueue.some(item => item.id === 'queue:readiness:plan:foundation'));
  assert.ok(fixture.nodes.some(node => node.id === 'plan:foundation'), 'history remains available in the map');
  assert.ok(fixture.statusSentence.clauses.filter(clause => clause.id.startsWith('clause:gate:')).every(clause => clause.ref === 'plan:search'), 'the current status describes active work');
  const draft = next.snapshot.plans.find(plan => plan.id === 'plan:collaboration');
  draft.title = `Collaboration (${draft.preparation})`;
  assert.equal(overviewFixture(next).nodes.find(node => node.id === draft.id).title, draft.title, 'preparation is labeled once');
});
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

test('unchanged telemetry retains controls and changed resource counts retain disclosure focus and open state', () => {
  const telemetry = { observed_at: '2026-10-27T12:00:00Z', monitor: { available: false, trace: [], trace_total: 0 } };
  const view = createOverviewView({ bundle: { ...bundle, telemetry } }); document.body.append(view.element);
  const original = view.element.querySelector('.monitor-trace'); original.open = true; original.querySelector('summary').focus();
  view.applyBundleUpdate({ ...bundle, telemetry: { ...telemetry, observed_at: '2026-10-27T12:00:05Z' } });
  assert.equal(view.element.querySelector('.monitor-trace'), original);
  view.applyBundleUpdate({ ...bundle, telemetry: { ...telemetry, monitor: { ...telemetry.monitor, trace_total: 1 } } });
  const current = view.element.querySelector('.monitor-trace'); assert.notEqual(current, original); assert.equal(current.open, true);
  assert.equal(document.activeElement, current.querySelector('summary'));
});

// The mini-dom selector engine cannot parse digit-bearing tags (h1..h6) or
// ^= attribute operators, so heading audits walk the tree by tagName.
function walk(node, visit) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 1) { visit(child); walk(child, visit); }
  }
}
const headingsIn = root => {
  const found = [];
  walk(root, node => { if (/^H[1-6]$/.test(node.tagName)) found.push(node); });
  return found;
};
// The mini-dom has no closest(): the ancestor check walks parentNode.
const hasAncestor = (node, test) => {
  let current = node?.parentNode;
  while (current) { if (test(current)) return true; current = current.parentNode; }
  return false;
};

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
  assert.ok(fixture.metrics.length >= 6, 'compact metric tiles cover plans, progress, baseline, usage, time and git');
  for (const metric of fixture.metrics) {
    assert.ok(metric.value != null || metric.unavailable === true, `${metric.id} carries a value or is explicitly unavailable`);
    if (!metric.unavailable) assert.ok(metric.records.length >= 1, `${metric.id} names its contributing records`);
  }
  assert.ok(fixture.attentionQueue.length >= 1, 'attention queue present');
  for (const item of fixture.attentionQueue) assert.ok(STATUS_STATES.includes(item.state) && item.chipLabel, 'queue items carry designed chip vocabulary');
  for (const clause of fixture.statusSentence.clauses) assert.ok(STATUS_STATES.includes(clause.state), `clause ${clause.id} carries a chip state`);
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

test('the overview renders as a scannable dashboard: hero card, native attention list, tiles, first-class map', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const root = view.element;
  assert.equal(root.dataset.testid, 'overview-view');
  const hero = root.querySelector('[data-testid="overview-hero"]');
  assert.ok(hero, 'the hero status card leads the view');
  assert.equal(hero.querySelector('.overview-hero-title').textContent, 'Offline notebook');
  const identity = hero.querySelector('[data-testid="overview-identity"]');
  assert.match(identity.textContent, /LazyBuddy/);
  assert.match(identity.textContent, /repo:offline-notebook/);
  assert.match(identity.textContent, /branch main/);
  const map = root.querySelector('[data-testid="project-spike"]');
  assert.ok(map, 'macro map reuses the T03 composition view');
  assert.ok(hasAncestor(map, node => node.dataset?.testid === 'overview-map'), 'the macro map is a first-class section of the dashboard');
  assert.equal(view.getStats().map.viewport.scale, 1, 'graph cards stay readable at the default zoom — no auto-shrink');
  assert.ok(root.querySelectorAll('.spike-node').length >= 6, 'feature areas and plans render as cards');
  assert.ok(root.querySelector('.spike-node[data-node-id="feature:notes"]'), 'durable feature area node');
  assert.ok(root.querySelector('.spike-node[data-node-id="plan:search"]'), 'plan node');
  assert.ok(root.querySelector('[data-testid="overview-queue"]'));
  assert.ok(root.querySelector('[data-testid="overview-metrics"]'));
  assert.ok(root.querySelector('[data-testid="overview-records"]'));
  // S1 hierarchy: the standalone view owns h2 sections (the shell supplies
  // the single h1); heading ranks never skip. V2-T4 adds the plan-lifecycle
  // strip section between Attention and Metrics.
  const headings = headingsIn(root);
  assert.equal(headings.filter(node => node.tagName === 'H1').length, 0, 'the view itself promotes nothing to h1');
  assert.deepEqual(headings.filter(node => node.tagName === 'H2').map(node => node.textContent), ['Offline notebook', 'Attention', 'Run monitor', 'Macro map', 'Harness activity', 'Plan lifecycle', 'Metrics']);
  let rank = 1;
  for (const node of headings) {
    const next = Number(node.tagName[1]);
    assert.ok(next <= rank + 1, `no skipped level before ${node.tagName} ${node.textContent.slice(0, 24)}`);
    rank = next;
  }
});

test('status-sentence clauses render as designed chips that trace into records and the map', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const sentence = view.element.querySelector('[data-testid="overview-status-sentence"]');
  assert.ok(sentence);
  assert.equal(sentence.getAttribute('aria-label'), view.getFixture().statusSentence.text, 'the chip row carries the readable sentence');
  const chips = [...sentence.querySelectorAll('[data-clause-id]')];
  assert.ok(chips.length >= 3, 'delivery, gate and git clauses composed');
  for (const chip of chips) {
    const status = chip.querySelector('.status');
    assert.ok(status, `clause ${chip.dataset.clauseId} renders a designed status chip`);
    assert.ok(STATUS_STATES.includes(status.dataset.state), `clause ${chip.dataset.clauseId} chip state is a design role`);
    assert.ok(status.textContent.length > 0, 'the chip carries a text label, not color alone');
  }
  const routed = chips.filter(chip => chip.tagName === 'BUTTON');
  assert.ok(routed.length >= 3, 'available clauses are keyboard-reachable buttons');
  for (const chip of routed) {
    const records = (chip.dataset.records ?? '').split(',').filter(Boolean);
    assert.ok(records.length >= 1, `clause ${chip.dataset.clauseId} carries record links`);
    for (const record of records) assert.ok(!/^(undefined|null)$/.test(record), `record id ${record} is real`);
  }
  const gateClause = chips.find(chip => String(chip.dataset.clauseId).startsWith('clause:gate:'));
  assert.ok(gateClause, 'a verification-gate clause exists');
  gateClause.click();
  const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');
  assert.ok(recordsPanel.textContent.includes('criterion:'), 'gate clause opens its contributing records incl. the criterion id');
  const activeClause = chips.find(chip => /active/i.test(chip.textContent));
  activeClause.click();
  assert.equal(view.getStats().selectedNodeId, 'plan:search', 'delivery clause selects the active plan in the macro map');
});

test('contributing-record ids are interactive: routed ids open, unroutable ids stay honestly unavailable', async () => {
  const drills = [];
  const view = createOverviewView({ bundle, callbacks: { onNodeDrill: event => drills.push(event) } });
  await settle();
  const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');

  // Request ids carry no source-anchor route in this bundle — dead text is
  // the baseline defect this task fixes: they render the hollow unavailable
  // action with a note, never a silent zero-interactive code span.
  view.element.querySelector('[data-metric-id="metric:usage"]').click();
  let records = [...recordsPanel.querySelectorAll('.overview-record')];
  assert.ok(records.length >= 2, 'usage tile lists its request records');
  for (const record of records) {
    assert.equal(record.querySelector('button'), null, 'an id without a route is not a dead interactive control');
    const unavailable = record.querySelector('.status[data-state="unavailable"]');
    assert.ok(unavailable, 'the honest unavailable action renders');
    assert.ok(unavailable.getAttribute('title'), 'the unavailable action notes why it cannot open');
  }

  // Plan ids open through the drill route the shell maps to its plan tab.
  view.element.querySelector('[data-metric-id="metric:plans"]').click();
  const planRecord = recordsPanel.querySelector('.overview-record button[data-record-id="plan:search"]');
  assert.ok(planRecord, 'plan record ids are buttons');
  assert.match(planRecord.getAttribute('aria-label'), /Open plan tab/);
  planRecord.click();
  assert.deepEqual(drills.map(event => event.nodeId), ['plan:search'], 'the record drill rides onNodeDrill (the onOpenItem/plan-tab route)');
  assert.equal(view.getStats().selectedNodeId, 'plan:search', 'the record click also selects the plan in the map');

  // Baseline item ids resolve to map objects.
  view.element.querySelector('[data-metric-id="metric:baseline"]').click();
  const featureRecord = recordsPanel.querySelector('.overview-record button[data-record-id="feature:notes"]');
  assert.ok(featureRecord, 'feature record ids resolve to their map object');
  featureRecord.click();
  assert.equal(view.getStats().selectedNodeId, 'feature:notes');

  // Criterion gate-check records expand and focus their check in the map —
  // the exact baseline finding (criterion:c-queue@1 rendered as dead text).
  view.element.querySelector('[data-clause-id="clause:gate:plan:search"]').click();
  const criterionRecord = [...recordsPanel.querySelectorAll('.overview-record button')]
    .find(control => (control.dataset.recordId ?? '').startsWith('criterion:'));
  assert.ok(criterionRecord, 'the criterion record id is now an interactive control');
  criterionRecord.click();
  await settle();
  assert.match(view.getStats().selectedNodeId ?? '', /^plan:search#criterion:s2:/, 'the criterion record selects its gate check');
  assert.ok(view.element.querySelector(`.spike-node[data-node-id="${view.getStats().selectedNodeId}"]`), 'expansion revealed the gate-check node');
});

test('metric tiles: every available total opens its records; unavailable renders hollow, never zero', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const tiles = [...view.element.querySelectorAll('[data-testid="overview-metrics"] [data-metric-id]')];
  assert.ok(tiles.length >= 6);
  const usageTile = tiles.find(tile => tile.dataset.metricId === 'metric:usage');
  assert.match(usageTile.textContent, /150/);
  assert.doesNotMatch(usageTile.textContent, /210/);
  const timeTile = tiles.find(tile => tile.dataset.metricId === 'metric:time');
  assert.match(timeTile.textContent, /30/);
  assert.match(timeTile.textContent, /25/);
  const gitTile = tiles.find(tile => tile.dataset.metricId === 'metric:git');
  assert.match(gitTile.textContent, /Changed paths/);
  assert.match(gitTile.textContent, /1 uncommitted/);
  for (const tile of tiles) {
    assert.ok(tile.querySelector('.lb-metric-value[data-numeric="true"]'), `${tile.dataset.metricId} renders a tabular figure`);
    if (tile.dataset.unavailable === 'true') continue;
    assert.equal(tile.tagName, 'BUTTON', `${tile.dataset.metricId} total is a drill-down control`);
    tile.click();
    assert.match(view.element.querySelector('[data-testid="overview-records"]').textContent, /Contributing records/, `${tile.dataset.metricId} opens its records`);
  }
  // An unprojected input must read as unavailable, never zero.
  const partial = { ...bundle, usage: undefined, time: undefined, git: undefined };
  const partialView = createOverviewView({ bundle: partial });
  await settle();
  for (const id of ['metric:usage', 'metric:time', 'metric:git']) {
    const tile = partialView.element.querySelector(`[data-metric-id="${id}"]`);
    assert.equal(tile.dataset.unavailable, 'true', `${id} is explicitly unavailable`);
    assert.equal(tile.tagName, 'DIV', 'an unavailable tile is not an interactive control');
    assert.match(tile.textContent, /not projected/);
    assert.ok(tile.querySelector('.status[data-state="unavailable"]'), 'the hollow dashed unavailable chip renders');
    assert.doesNotMatch(tile.textContent, /\b0 (tokens|min|changed)/, 'absence of data never renders as a zero total');
  }
});

// V2-T4 decomposition — the overview composes from named components (status
// hero, attention list, plan-lifecycle strip, coverage tiles, macro map,
// freshness line), each a pure factory over fixture facts; micro-bars render
// only from real ratios/comparisons and every count is a tabular numeral.
test('the overview decomposes into named components with token-driven micro-treatment (V2-T4)', async () => {
  const fixture = overviewFixture(bundle);
  for (const component of [createStatusHero, createAttentionList, createPlanLifecycleStrip, createCoverageTiles,
    createMacroMapSection, createFreshnessLine, microBar]) assert.equal(typeof component, 'function', 'the named components are exported factories');
  assert.deepEqual({ active: fixture.lifecycle.active.count, future: fixture.lifecycle.future.count, historical: fixture.lifecycle.historical.count },
    { active: 1, future: 2, historical: 1 }, 'the lifecycle groups derive from the declared lifecycles');
  for (const group of ['active', 'future', 'historical']) {
    assert.ok(fixture.lifecycle[group].records.length === fixture.lifecycle[group].count, `lifecycle.${group} records are exactly its plans`);
  }

  const view = createOverviewView({ bundle });
  await settle();
  // Plan-lifecycle strip: three interactive cells, tabular counts, honest fills.
  const strip = view.element.querySelector('[data-testid="overview-lifecycle"]');
  assert.ok(strip, 'the lifecycle strip renders as its own section');
  const cells = [...strip.querySelectorAll('.overview-lifecycle-cell')];
  assert.deepEqual(cells.map(cell => cell.dataset.group), ['active', 'future', 'historical']);
  assert.deepEqual(cells.map(cell => cell.dataset.count), ['1', '2', '1']);
  for (const cell of cells) {
    assert.equal(cell.tagName, 'BUTTON', 'a lifecycle cell opens its group records');
    assert.equal(cell.querySelector('.overview-lifecycle-count').dataset.numeric, 'true', 'counts are tabular numerals');
    assert.match(cell.getAttribute('aria-label'), /open contributing records/);
  }
  const activeFill = cells[0].querySelector('.overview-lifecycle-fill');
  assert.equal(activeFill.getAttribute('style'), 'inline-size: 25%;', 'the fill is the real share (1 of 4 declared plans)');
  cells[0].click();
  const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');
  assert.ok(recordsPanel.textContent.includes('Plans — active'), 'the strip cell opens its group records');
  assert.ok(recordsPanel.querySelectorAll('.overview-record button[data-record-id="plan:search"]').length === 1,
    'the active group records are exactly its plan ids');

  // Coverage tiles: micro-bars only where the projection carries the data.
  const tile = id => view.element.querySelector(`[data-testid="overview-metrics"] [data-metric-id="${id}"]`);
  for (const id of ['metric:active-progress', 'metric:usage', 'metric:time']) {
    const bar = tile(id).querySelector('[data-testid="overview-microbar"]');
    assert.ok(bar, `${id} carries a micro-bar from its projected ratio/comparison`);
    assert.equal(bar.getAttribute('aria-hidden'), 'true', 'bar geometry is decoration; the numbers stay as text');
    assert.ok(bar.querySelectorAll('.overview-microbar-segment').length >= 2, `${id} bar has its real segments`);
  }
  assert.equal(tile('metric:plans').querySelector('[data-testid="overview-microbar"]'), null,
    'no invented bar where no ratio exists');
  // Unprojected inputs never borrow a bar (the unavailable path drops them).
  const partial = createOverviewView({ bundle: { ...bundle, usage: undefined, time: undefined } });
  await settle();
  assert.equal(partial.element.querySelector('[data-metric-id="metric:usage"] [data-testid="overview-microbar"]'), null,
    'an unprojected usage input renders no bar');
  assert.deepEqual(partial.getStats().lifecycleCounts, { active: 1, future: 2, historical: 1 });

  // microBar itself: no data, no bar; real proportions otherwise.
  assert.equal(microBar([{ value: 0 }, { value: 0 }]), null, 'a zero total renders nothing');
  assert.equal(microBar([{ value: Number.NaN }]), null, 'non-finite parts render nothing');
  const two = microBar([{ value: 10 }, { value: 30 }]);
  assert.equal(two.querySelectorAll('.overview-microbar-segment').length, 2);
  assert.match(two.children[0].getAttribute('style'), /inline-size: 25%/);
  assert.match(two.children[1].getAttribute('style'), /inline-size: 75%/);

  // Freshness line: one meta line of observed facts; absence reads honestly.
  const line = view.element.querySelector('[data-testid="overview-freshness"]');
  assert.ok(line, 'the freshness line renders');
  assert.match(line.textContent, /projection revision \d+ · baseline \d+ · observation \d+/);
  assert.match(line.textContent, /git observed /, 'the observed git stamp rides the line');
  assert.match(line.textContent, /plan sources/);
  const noGit = createOverviewView({ bundle: { ...bundle, git: undefined } });
  await settle();
  assert.match(noGit.element.querySelector('[data-testid="overview-freshness"]').textContent, /git observation not projected/,
    'a missing git observation never reads as fresh');
});

test('the attention queue is a native list whose rows open their contributing records in the dock', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  const list = view.element.querySelector('[data-testid="overview-attention-list"]');
  assert.ok(list, 'the attention queue renders as a list');
  assert.equal(list.dataset.nativeList, 'true', 'the list opts into j/k traversal');
  const rows = [...list.querySelectorAll('.overview-attention-control')];
  assert.ok(rows.length >= 1, 'attention items render');
  const readinessRow = rows.find(row => row.dataset.queueId.startsWith('queue:readiness:'));
  assert.ok(readinessRow, 'blocked-readiness items are listed with their state');
  for (const row of rows) {
    const chip = row.querySelector('.status');
    assert.ok(chip, 'every row carries a status chip');
    assert.ok(STATUS_STATES.includes(chip.dataset.state));
    assert.ok((row.dataset.records ?? '').length >= 1, 'every row carries its record links');
  }
  rows[0].click();
  const recordsPanel = view.element.querySelector('[data-testid="overview-records"]');
  assert.match(recordsPanel.textContent, /Contributing records/);
  assert.ok(recordsPanel.querySelectorAll('.overview-record').length >= 1, 'the row click lists the item records');

  // Inside the shell the same click opens the dock and adopts the records.
  const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
  shell.update();
  await settle();
  const dock = shell.element.querySelector('[data-testid="dock-panel"]');
  shell.element.querySelector('.overview-attention-control').click();
  assert.equal(dock.hidden, false, 'the attention row opens the dock');
  assert.ok(shell.element.querySelector('[data-testid="dock-records-region"] .overview-record-list'), 'the docked records region lists the contributing records');
});

test('walls of meta text are gone: caveats ride tooltips and one polite announcer', async () => {
  const view = createOverviewView({ bundle });
  await settle();
  dom.document.body.append(view.element);
  try {
    const visibleText = view.element.textContent;
    for (const caveat of ['absence of a finding', 'never as zero', 'not a health score', 'resolve only through the shared authority']) {
      assert.ok(!visibleText.includes(caveat), `the ${JSON.stringify(caveat.slice(0, 24))}… caveat must not render as body text`);
    }
    const tooltips = [...view.element.querySelectorAll('[title]')].map(node => node.getAttribute('title')).join('\n');
    for (const caveat of ['absence of a finding', 'never as zero']) assert.ok(tooltips.includes(caveat), 'the caveat stays available as a tooltip');
    // The tooltip notes are the T11 clipped pattern, wired by aria-describedby.
    const described = [...view.element.querySelectorAll('[aria-describedby]')];
    assert.ok(described.length >= 4, 'section caveats and record notes are wired through aria-describedby');
    for (const subject of described) {
      const note = [...dom.document.body.children].find(node => node.id === subject.getAttribute('aria-describedby'));
      assert.ok(note?.classList.contains('native-note'), 'every description target is a clipped native-note');
    }
    // Exactly one polite announcer (the T11 layer region), bounded messages.
    view.openRecords({ id: 'x', title: 'Plans', records: ['plan:search'] });
    view.openRecords({ id: 'y', title: 'Usage', records: ['req:a', 'req:b'] });
    const announcers = dom.document.body.querySelectorAll('[data-native-announcer]');
    assert.equal(announcers.length, 1, 'one polite announcer region for the whole layer');
    assert.equal(announcers[0].getAttribute('aria-live'), 'polite');
    assert.ok(announcers[0].textContent.length > 0 && announcers[0].textContent.length < 200, 'announcements are bounded single sentences');
  } finally {
    view.element.remove();
  }
});

test('heading discipline in the shell composition: one h1, ordered h1 to h2 to h3, no skips', async () => {
  const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
  shell.update();
  await settle();
  dom.document.body.append(shell.element);
  try {
    const headings = headingsIn(shell.element);
    assert.equal(headings.filter(node => node.tagName === 'H1').length, 1, 'exactly one page heading (the shell title)');
    let level = 1;
    for (const heading of headings) {
      const rank = Number(heading.tagName[1]);
      assert.ok(rank <= level + 1, `no skipped level before ${heading.textContent.slice(0, 30)}`);
      level = rank;
    }
  } finally {
    shell.element.remove();
  }
});

test('keyboard traversal: graph arrows, tile roving, clause reachability, j/k over the attention list', async () => {
  const detach = installFocusSystem({ root: dom.document });
  try {
    const view = createOverviewView({ bundle });
    await settle();
    dom.document.body.append(view.element);
    try {
      assert.ok(view.focusNode('plan:foundation'));
      document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      assert.ok(['plan:search', 'plan:export', 'plan:collaboration'].includes(document.activeElement.dataset.nodeId), 'ArrowRight crosses the inter-plan dependency layer');
      const tiles = [...view.element.querySelectorAll('[data-testid="overview-metrics"] button[data-metric-id]')];
      tiles[0].focus();
      document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      assert.equal(document.activeElement, tiles[1], 'ArrowRight roves across the metric tiles');
      document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
      assert.equal(document.activeElement, tiles[0], 'ArrowLeft roves back');
      for (const clause of view.element.querySelectorAll('[data-clause-id][data-records]')) assert.equal(clause.tagName, 'BUTTON', 'link clauses are keyboard-reachable buttons');
      const rows = [...view.element.querySelectorAll('.overview-attention-control')];
      rows[0].focus();
      document.activeElement.dispatchEvent({ type: 'keydown', key: 'j' });
      assert.equal(document.activeElement, rows[1], 'j walks down the native attention list');
      document.activeElement.dispatchEvent({ type: 'keydown', key: 'k' });
      assert.equal(document.activeElement, rows[0], 'k walks back up');
    } finally {
      view.element.remove();
    }
  } finally {
    detach.detach();
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

test('hostile record text renders as text only', async () => {
  const hostile = structuredClone(bundle);
  hostile.snapshot.items.find(item => item.id === 'feature:notes').title = '<img src=x onerror=window.__pwned=1>';
  const view = createOverviewView({ bundle: hostile });
  await settle();
  assert.equal(view.element.querySelectorAll('img').length, 0);
  assert.ok(view.element.textContent.includes('<img src=x onerror='));
});

test('project destinations are absent pre-init and present post-init (IO-2)', async () => {
  assert.deepEqual(PROJECT_DESTINATIONS.map(destination => destination.id), ['overview', 'project', 'plans', 'health', 'execution', 'git', 'evidence', 'research']);
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
  assert.equal(destinations.length, 8, 'all eight project destinations after init (V2-T4 adds health)');
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
  assert.equal(flipping.element.querySelectorAll('[data-destination]').length, 8);
});

test('shell destinations stay selectable (T12b) and preserve the selection through updates', async () => {
  const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
  shell.update();
  await settle();
  const enabled = [...shell.element.querySelectorAll('[data-destination]')];
  assert.equal(enabled.length, 8, 'all eight sidebar destinations render');
  assert.equal(enabled.every(control => !control.disabled), true, 'no destination is disabled; missing data renders an unavailable view instead');
  enabled[0].focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(shell.getStats().activeDestination, 'overview');
  assert.ok(shell.element.querySelector('[data-testid="overview-view"]'));
  shell.update();
  await settle();
  assert.equal(shell.getStats().activeDestination, 'overview', 'polling-style update preserves the selected destination');
  assert.ok(shell.element.querySelector('[data-testid="overview-view"]'));
});

test('a polling bundle swap keeps the map selection, the mode, the tabs and the dock (stale_state)', async () => {
  const state = { current: bundle };
  const shell = createProjectShell({ projectionProvider: () => state.current, product: { name: 'LazyBuddy' } });
  shell.update();
  await settle();
  shell.element.querySelector('.spike-node[data-node-id="plan:search"]').click();
  shell.element.querySelector('[data-testid="overview-metrics"] button[data-metric-id="metric:plans"]').click();
  shell.element.querySelector('.lb-tab .lb-tab-close') === null; // only the pinned overview tab exists
  assert.equal(shell.getStats().overview.selectedNodeId, 'plan:search');
  assert.equal(shell.getStats().dockOpen, true, 'the dock is open with contributing records');
  const overviewBefore = shell.element.querySelector('[data-testid="overview-view"]');

  state.current = { ...bundle, project_name: 'Offline notebook (refreshed)' };
  shell.update();
  await settle();
  const stats = shell.getStats();
  assert.deepEqual(stats.tabs, ['overview'], 'the tab set survives the bundle swap');
  assert.equal(stats.activeTab, 'overview', 'the selected tab survives');
  assert.equal(stats.overview.selectedNodeId, 'plan:search', 'the map selection survives');
  assert.equal(stats.dockOpen, true, 'the dock stays open across the refresh');
  assert.equal(shell.element.querySelector('[data-testid="overview-view"]'), overviewBefore, 'polling updates the overview without replacing its interactive map');
  assert.match(shell.element.querySelector('[data-testid="shell-title"]').textContent, /refreshed/, 'the header reflects the new projection');
});

test('the empty attention queue renders an actionable empty state', async () => {
  const quiet = structuredClone(bundle);
  quiet.snapshot.proposals = [];
  quiet.snapshot.plans = quiet.snapshot.plans.map(plan => ({ ...plan, stale_item_ids: [] }));
  quiet.readiness = Object.fromEntries(Object.entries(bundle.readiness).map(([planId, assessment]) => [planId, { ...assessment, blockers: [] }]));
  const view = createOverviewView({ bundle: quiet });
  await settle();
  const empty = view.element.querySelector('[data-testid="overview-queue"] .lb-empty');
  assert.ok(empty, 'the native empty state renders');
  assert.ok(empty.querySelector('.lb-empty-title').textContent.length > 0, 'it says what will fill the view');
  assert.ok(empty.querySelector('.lb-empty-detail').textContent.includes('proposals'), 'and how that happens');
});

test('live bundle refresh retains the map element, search focus, pan and zoom while applying fresh records', async () => {
  const view = createOverviewView({ bundle });
  document.body.append(view.element); await settle();
  const map = view.element.querySelector('.project-spike');
  const viewport = view.element.querySelector('.spike-graph-viewport');
  const search = view.element.querySelector('.spike-map-search input');
  search.value = 'search'; search.dispatchEvent({ type: 'input' }); search.focus();
  view.setViewport({ scale: 1.5, scrollLeft: 180, scrollTop: 120 });
  const refreshed = { ...bundle, snapshot: { ...bundle.snapshot, revision: bundle.snapshot.revision + 1 } };
  view.applyBundleUpdate(refreshed); await settle();
  assert.equal(view.element.querySelector('.project-spike'), map, 'the fullscreen target remains mounted');
  assert.equal(view.element.querySelector('.spike-graph-viewport'), viewport, 'a revision-only poll cannot interrupt an active drag');
  assert.equal(view.element.querySelector('.spike-map-search input'), search);
  assert.equal(document.activeElement, search); assert.equal(search.value, 'search');
  assert.deepEqual(view.getStats().map.viewport, { scale: 1.5, scrollLeft: 180, scrollTop: 120 });
  assert.equal(view.getFixture().projection.revision, refreshed.snapshot.revision);
  view.dispose(); view.element.remove();
});

test('reconciliation adoption states surface in the attention queue — a source save never reads as consumed (§14 step 6, V2-T8)', async () => {
  const withReconciliations = structuredClone(bundle);
  withReconciliations.snapshot.proposals = [];
  withReconciliations.snapshot.plans = withReconciliations.snapshot.plans.map(plan => ({ ...plan, stale_item_ids: [] }));
  withReconciliations.readiness = Object.fromEntries(Object.entries(bundle.readiness).map(([planId, assessment]) => [planId, { ...assessment, blockers: [] }]));
  withReconciliations.snapshot.reconciliations = [
    { id: 'reconciliation:open', unresolved_proposal_ids: ['proposal:p1'], native_adoption: 'requested' },
    { id: 'reconciliation:waiting', unresolved_proposal_ids: [], native_adoption: 'requested' },
    { id: 'reconciliation:observed', unresolved_proposal_ids: [], native_adoption: 'observed' },
  ];
  const view = createOverviewView({ bundle: withReconciliations });
  await settle();
  const rows = [...view.element.querySelectorAll('.overview-attention-control')].map(row => ({ id: row.dataset.queueId, text: row.textContent }));
  const open = rows.find(row => row.id === 'queue:reconciliation:reconciliation:open');
  assert.ok(open, 'an open reconciliation lists with its unresolved proposal');
  assert.match(open.text, /native adoption requested/, 'the open row carries the native adoption state');
  const waiting = rows.find(row => row.id === 'queue:adoption:reconciliation:waiting');
  assert.ok(waiting, 'a resolved-but-unconsumed reconciliation surfaces as adoption pending');
  assert.match(waiting.text, /not yet observed/, 'the pending row states the consumption gap honestly');
  assert.ok(!rows.some(row => row.id.includes('reconciliation:observed')),
    'an observed adoption adds no attention noise — consumption is health, not attention');
});

test('view CSS holds the token discipline: type, spacing, radius, motion, no color literals', async () => {
  const source = readFileSync(new URL('../ui/overview.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...source.matchAll(/([-a-z]+)\s*:\s*([^;{}]+);/g)].map(match => [match[1], match[2].trim()]);
  assert.equal((source.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(|\bhsla?\(/g) ?? []).length, 0, 'zero color literals');
  for (const [property, value] of declarations) {
    if (property === 'font-size') assert.match(value, /^var\(--type-/, 'font sizes come from the type tokens');
    if (property === 'font-family') assert.match(value, /^var\(--(?:mono|sans)\)/, 'identifiers alone render in the system mono stack');
    if (property === 'border-radius') assert.match(value, /^var\(--radius-/, 'radii come from the radius tokens');
    if (property === 'transition') {
      for (const duration of value.match(/(?<![\w-])(?:\d*\.?\d+m?s)(?![\w])/g) ?? []) assert.fail(`raw motion duration ${duration} in ${value}`);
      assert.match(value, /var\(--motion-(?:instant|fast|base|slow)\)/, 'transitions ride the motion tokens');
      assert.match(value, /var\(--motion-ease\)/, 'transitions use the family ease');
    }
    if (['padding', 'margin', 'gap', 'inset-block-start'].includes(property.split('-')[0]) || property.startsWith('padding-') || property.startsWith('margin-') || property.startsWith('gap') || property.startsWith('border-inline-start') || property.startsWith('border-block-start') || property.startsWith('inset-')) {
      if (property.startsWith('border-inline-start') || property.startsWith('border-block-start') || property.startsWith('border')) continue; // widths, not spacing
      for (const part of value.split(/\s+/)) {
        assert.ok(part === '0' || /^var\(/.test(part) || /^calc\(/.test(part), `spacing value ${part} (${property}) resolves through tokens`);
      }
    }
  }
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
