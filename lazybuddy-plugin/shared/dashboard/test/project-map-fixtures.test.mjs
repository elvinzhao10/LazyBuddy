import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// The spike view modules address `document` at call time; install the shim before import.
const dom = createMiniDom();
globalThis.document = dom.document;

const { attemptFixture, batchFixture, planFixture, projectMapFixture } = await import('../ui/project-fixtures.mjs');
const { CARD, listModel, measureNodeCard, presentationModel, layoutProjectGraph, wrapLabel, SpikePresentationError, NODE_KINDS } = await import('../ui/project-presentation.mjs');
const { createProjectMapSpike } = await import('../ui/project-map-spike.mjs');
const { statusChip } = await import('../ui/components.mjs');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const UI = new URL('../ui/', import.meta.url);

function controlledScheduler() {
  const requests = [];
  return { requests, scheduler: (model, revision) => new Promise(resolve => requests.push({ model, revision, resolve })) };
}

function hungScheduler() {
  return () => new Promise(() => {});
}

function rejectingLaterScheduler(error) {
  let calls = 0;
  return model => {
    calls += 1;
    if (calls === 1) return layoutProjectGraph(model);
    return Promise.reject(error);
  };
}

function hangAfterFirstScheduler() {
  let calls = 0;
  return model => {
    calls += 1;
    if (calls === 1) return layoutProjectGraph(model);
    return new Promise(() => {});
  };
}

async function renderedView(fixture, options = {}) {
  const view = createProjectMapSpike({ fixture, ...options });
  await settle();
  return view;
}

test('spike modules load and export the composition surface', () => {
  assert.equal(typeof createProjectMapSpike, 'function');
  assert.equal(typeof presentationModel, 'function');
  assert.equal(typeof layoutProjectGraph, 'function');
  assert.equal(typeof listModel, 'function');
  assert.deepEqual(NODE_KINDS.slice(0, 3), ['feature-area', 'plan', 'conflict']);
});

test('each level renders to DOM deterministically with the expected shape', async () => {
  const fixtures = { project: projectMapFixture(), plan: planFixture('search'), batch: batchFixture(), attempt: attemptFixture() };
  const expectedCounts = { project: 9, plan: 8, batch: 9, attempt: 7 };
  for (const [level, fixture] of Object.entries(fixtures)) {
    const first = await renderedView(fixture);
    const second = await renderedView(fixture);
    assert.equal(dom.serialize(first.element), dom.serialize(second.element), `${level} render must be deterministic`);
    assert.equal(first.getStats().nodeCount, expectedCounts[level]);
    assert.equal(first.getStats().nodeCount, presentationModel(fixture).nodes.length);
    assert.equal(first.element.dataset.docId, fixture.docId);
    const svg = first.element.querySelector('.spike-graph-viewport svg');
    assert.ok(svg, `${level} graph svg exists`);
    assert.match(svg.getAttribute('viewBox'), /^0 0 \d+ \d+$/);
    assert.equal(first.element.querySelectorAll('.spike-node').length, expectedCounts[level]);
    assert.equal(first.element.querySelectorAll('.spike-list li').length, expectedCounts[level]);
  }
});

test('status chips render the design-system semantic states, not a silent neutral default (T03-R1)', async () => {
  // One representative chip per semantic color across the fixtures (spec: active=executing/verifying,
  // verified, attention, failed, stale, unavailable, neutral; fixture status `unverified` maps to neutral).
  const expectedStates = {
    project: ['active', 'attention', 'neutral', 'stale', 'unavailable', 'verified'],
    plan: ['active', 'attention', 'neutral', 'stale', 'unavailable'],
    'plan-collab': ['attention', 'neutral', 'stale', 'unavailable'],
    batch: ['active', 'attention', 'neutral', 'unavailable', 'verified'],
    attempt: ['active', 'failed', 'neutral', 'stale', 'unavailable', 'verified'],
  };
  const representativeChips = {
    project: { 'feature:offline-sync': { Execution: 'verified' }, 'plan:search': { Execution: 'active', Verification: 'attention' }, 'feature:installer': { Verification: 'stale' }, 'boundary:vendor-sdk': { Execution: 'unavailable' }, 'plan:foundation': { Execution: 'neutral' } },
    plan: { 'batch:index-build': { Execution: 'active', Verification: 'active' }, 'batch:offline-queue': { Verification: 'unavailable' }, 'gate:release': { Verification: 'stale' }, 'wave:1': { Verification: 'attention' } },
    'plan-collab': { 'conflict:offline-vs-cloud': { Execution: 'attention' }, 'boundary:vendor-sdk': { Execution: 'unavailable' }, 'wave:explore-1': { Execution: 'neutral' } },
    batch: { 'task:index-crawl': { Execution: 'active', Verification: 'neutral' }, 'task:index-offline-mirror': { Verification: 'neutral' }, 'join:batch-complete': { Execution: 'attention' }, 'task:index-plan': { Verification: 'verified' } },
    attempt: { 'attempt:1': { Execution: 'failed', Verification: 'failed' }, 'step:crawl': { Execution: 'active', Verification: 'neutral' }, 'evidence:crawl-report-1': { Verification: 'stale' }, 'evidence:crawl-report-2': { Execution: 'unavailable' } },
  };
  const fixtures = { project: projectMapFixture(), plan: planFixture('search'), 'plan-collab': planFixture('collab'), batch: batchFixture(), attempt: attemptFixture() };
  const chipState = (container, rowKind) => {
    const row = [...container.querySelectorAll('.spike-chiprow')].find(candidate => candidate.querySelector('.meta')?.textContent === rowKind);
    return row?.querySelector('.status')?.dataset.state;
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    const view = await renderedView(fixture);
    const graphStates = [...view.element.querySelectorAll('.spike-node .status')].map(chip => chip.dataset.state).sort();
    assert.deepEqual([...new Set(graphStates)], expectedStates[name], `${name}: graph chips must render the fixture's semantic states`);
    assert.ok(graphStates.length > new Set(graphStates).size || new Set(graphStates).size > 1, `${name}: chips must not collapse to a single silent neutral`);
    for (const [nodeId, rows] of Object.entries(representativeChips[name])) {
      const card = view.element.querySelector(`.spike-node[data-node-id="${nodeId}"]`);
      assert.ok(card, `${name}: node ${nodeId} rendered`);
      for (const [rowKind, expected] of Object.entries(rows)) {
        assert.equal(chipState(card, rowKind), expected, `${name} ${nodeId} ${rowKind.toLowerCase()} chip state`);
      }
      const listRow = view.element.querySelector(`.spike-list li[data-node-id="${nodeId}"]`);
      for (const [rowKind, expected] of Object.entries(rows)) {
        const listChips = [...(listRow?.querySelectorAll('.status') ?? [])].map(chip => chip.dataset.state);
        assert.ok(listChips.includes(expected), `${name} ${nodeId} list row renders ${expected} too`);
      }
    }
  }
});

test('unknown chip roles fail closed instead of silently rendering neutral (T03-R1)', async () => {
  assert.throws(() => statusChip({ state: 'unverified', label: 'Unverified' }), TypeError, 'the design system rejects roles outside its set');
  assert.throws(() => statusChip({ state: 'scheduler-happy', label: 'x' }), TypeError, 'arbitrary roles are rejected, not defaulted');
  const accepted = ['neutral', 'active', 'verified', 'attention', 'failed', 'stale', 'unavailable'];
  for (const build of [projectMapFixture, () => planFixture('search'), () => planFixture('collab'), batchFixture, attemptFixture]) {
    const fixture = build();
    const allNodes = [...fixture.nodes, ...fixture.nodes.flatMap(node => node.children ?? [])];
    for (const node of allNodes) {
      for (const [slot, value] of [['execution', node.execution], ['verification', node.verification]]) {
        assert.equal('role' in value, false, `${node.id} ${slot} must not carry the pre-T03-R1 role shape that bypassed the design-system check`);
        assert.ok(accepted.includes(value.state), `${node.id} ${slot} state ${value.state} is inside the design-system role set`);
      }
    }
  }
});

test('layout engine measurements per fixture (node-side record)', async () => {
  const fixtures = [['project', projectMapFixture()], ['plan', planFixture('search')], ['plan-collab', planFixture('collab')], ['batch', batchFixture()], ['attempt', attemptFixture()]];
  const rows = [];
  for (const [name, fixture] of fixtures) {
    const model = presentationModel(fixture);
    const coldStart = performance.now();
    const first = layoutProjectGraph(model);
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    for (let index = 0; index < 50; index += 1) layoutProjectGraph(model);
    const warmMs = (performance.now() - warmStart) / 50;
    assert.deepEqual(layoutProjectGraph(model), first, `${name} layout must be deterministic`);
    const longLabels = fixture.nodes.filter(node => node.title.length >= 60);
    const overflow = longLabels.map(node => ({ id: node.id, lines: measureNodeCard(node).lineCount, truncated: measureNodeCard(node).truncated }));
    rows.push({ fixture: name, nodeCount: first.nodes.length, edgeCount: first.edges.length, canvas: `${first.width}x${first.height}`, coldMs: coldMs.toFixed(3), relayoutMsMean: warmMs.toFixed(4), longLabels: longLabels.length, overflowTruncated: overflow.filter(item => item.truncated).length });
  }
  console.log(`MEASUREMENTS node --test layout ${JSON.stringify(rows)}`);
  assert.ok(rows.every(row => row.nodeCount > 0));
});

test('editing a long title recalculates geometry through the existing engine', async () => {
  const view = await renderedView(planFixture('search'));
  const nodeId = 'batch:offline-queue';
  const longerTitle = 'Offline change queue — record every local mutation while offline, including the very long reconciliation descriptor attached to each queued change';
  const before = view.element.querySelector(`.spike-node[data-node-id="${nodeId}"]`).parentNode;
  const heightBefore = Number(before.getAttribute('height'));
  const canvasBefore = view.element.querySelector('.spike-graph-viewport svg').getAttribute('viewBox');
  view.renameNode(nodeId, longerTitle);
  await settle();
  const after = view.element.querySelector(`.spike-node[data-node-id="${nodeId}"]`).parentNode;
  const heightAfter = Number(after.getAttribute('height'));
  const canvasAfter = view.element.querySelector('.spike-graph-viewport svg').getAttribute('viewBox');
  assert.ok(heightAfter > heightBefore, `card height must grow with the longer title (${heightBefore} -> ${heightAfter})`);
  assert.notEqual(canvasBefore, canvasAfter, 'canvas geometry must be recalculated');
  assert.ok(view.getStats().layoutHeight > 0 && view.getStats().viewRevision >= 2, 'rename produced a new applied layout revision');
  assert.equal(view.getFixture().nodes.find(node => node.id === nodeId).title, longerTitle);
  const oneLine = measureNodeCard({ title: 'Short title' });
  const wrapped = measureNodeCard({ title: longerTitle });
  const overflowing = measureNodeCard({ title: 'x'.repeat(240) });
  assert.ok(wrapped.height > oneLine.height);
  assert.equal(overflowing.truncated, true);
  assert.equal(overflowing.fullTitle.length, 240);
});

test('card geometry accounts for status rows and progressively discloses long summaries', async () => {
  const fixture = projectMapFixture();
  const model = presentationModel(fixture);
  const layout = layoutProjectGraph(model);
  for (const placed of layout.nodes) {
    const node = model.byId.get(placed.id);
    const measure = measureNodeCard(node);
    assert.equal(placed.height, measure.height, `${node.id} uses its complete measured card extent`);
    assert.equal(measure.chipRows.length, 2, `${node.id} measures execution and verification rows`);
    assert.ok(measure.chipRows.every(height => height >= 20), `${node.id} reserves readable status-row height`);
  }
  const conflict = model.byId.get('conflict:offline-vs-cloud');
  const measure = measureNodeCard(conflict);
  assert.equal(measure.summaryTruncated, true, 'long card summary becomes a deliberate teaser');
  const view = await renderedView(fixture);
  const summary = view.element.querySelector('.spike-node[data-node-id="conflict:offline-vs-cloud"] .spike-summary');
  assert.equal(summary.dataset.truncated, 'true');
  assert.equal(summary.title, conflict.summary, 'full summary remains available and renders in the inspector after selection');
  assert.ok(summary.textContent.endsWith('…'));
});

test('pointer selection, viewport controls and polling updates preserve the graph place', async () => {
  const selected = [];
  const viewportEvents = [];
  const fixture = planFixture('search');
  const view = await renderedView(fixture, { callbacks: {
    onSelect: event => selected.push(event),
    onViewportChange: event => viewportEvents.push(event),
  } });
  const card = view.element.querySelector('.spike-node[data-node-id="batch:index-build"]');
  card.click();
  assert.equal(view.getStats().selectedId, 'batch:index-build');
  assert.deepEqual(selected, [{ nodeId: 'batch:index-build' }]);

  const viewport = view.element.querySelector('.spike-graph-viewport');
  viewport.clientWidth = 640;
  viewport.clientHeight = 400;
  view.setViewport({ scale: 1.5, scrollLeft: 120, scrollTop: 80 }, 'test');
  assert.deepEqual(view.getStats().viewport, { scale: 1.5, scrollLeft: 120, scrollTop: 80 });
  assert.equal(view.element.querySelector('.graph-viewport-controls'), null, 'V2-T3: no viewport button cluster renders');
  viewport.focus();
  viewport.dispatchEvent({ type: 'keydown', key: '-' });
  assert.equal(view.getStats().viewport.scale, 1.25, 'keyboard zoom-out replaces the removed cluster control');
  viewport.dispatchEvent({ type: 'keydown', key: '+' });
  assert.equal(view.getStats().viewport.scale, 1.5, 'keyboard zoom-in restores the level');
  viewport.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.ok(view.getStats().viewport.scrollLeft > 120, 'focused viewport supports keyboard panning');
  const beforeDrag = view.getStats().viewport;
  viewport.dispatchEvent({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 300, clientY: 220 });
  viewport.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 240, clientY: 180 });
  viewport.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 240, clientY: 180 });
  assert.equal(view.getStats().viewport.scrollLeft, beforeDrag.scrollLeft + 60, 'background drag pans horizontally one-to-one');
  assert.equal(view.getStats().viewport.scrollTop, beforeDrag.scrollTop + 40, 'background drag pans vertically one-to-one');
  const selectionBeforeNodeDrag = view.getStats().selectedId;
  card.dispatchEvent({ type: 'pointerdown', pointerId: 2, button: 0, clientX: 200, clientY: 200 });
  card.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 100, clientY: 100 });
  card.dispatchEvent({ type: 'pointerup', pointerId: 2, clientX: 100, clientY: 100 });
  assert.equal(view.getStats().selectedId, selectionBeforeNodeDrag, 'node pointer gestures never mutate graph geometry or selection');

  view.toggleGroup('gate:wave-1');
  await settle();
  const before = view.getStats();
  const refreshed = structuredClone(fixture);
  refreshed.nodes.find(node => node.id === 'batch:index-build').execution.state = 'attention';
  refreshed.nodes.find(node => node.id === 'batch:index-build').execution.label = 'Executing';
  const update = view.applyUpdate(refreshed);
  await settle();
  assert.equal(update.selectedPreserved, true);
  assert.equal(view.getStats().selectedId, 'batch:index-build');
  assert.equal(view.getStats().collapsed.includes('gate:wave-1'), false, 'user expansion survives a status refresh');
  assert.deepEqual(view.getStats().viewport, before.viewport, 'nonzero pan and zoom survive the relayout');
  assert.ok(viewportEvents.some(event => event.reason === 'keyboard-pan'));
});

test('switching plans while a layout is pending discards the stale reply and never displays it', async () => {
  const { requests, scheduler } = controlledScheduler();
  const view = createProjectMapSpike({ fixture: planFixture('search'), layoutScheduler: scheduler });
  await settle();
  assert.equal(requests.length, 1, 'initial layout requested');
  view.showFixture(planFixture('collab'));
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(view.getStats().appliedRevision, 0, 'nothing applied yet');
  assert.equal(view.element.dataset.docId, 'plan:search', 'last valid identity retained while pending');
  requests[0].resolve(layoutProjectGraph(requests[0].model));
  await settle();
  const stats = view.getStats();
  assert.equal(stats.appliedRevision, 0, 'stale reply must not be applied');
  assert.deepEqual(stats.discarded, [{ requestedRevision: 1, currentRevision: 2 }]);
  assert.equal(view.element.dataset.docId, 'plan:search', 'obsolete reply must not appear in the DOM');
  requests[1].resolve(layoutProjectGraph(requests[1].model));
  await settle();
  const applied = view.getStats();
  assert.equal(applied.appliedRevision, 2);
  assert.equal(view.element.dataset.docId, 'plan:collab-explore');
  assert.equal(view.element.querySelectorAll('.spike-node').length, presentationModel(planFixture('collab')).nodes.length);
});

test('a hung layout keeps the previous valid view with a visible pending status', async () => {
  const pending = await renderedView(planFixture('search'), { layoutScheduler: hangAfterFirstScheduler() });
  assert.equal(pending.getStats().appliedRevision, 1);
  pending.showFixture(planFixture('collab'));
  const stats = pending.getStats();
  assert.ok(stats.pendingCount >= 1);
  assert.equal(viewStatus(pending).includes('Layout pending'), true);
  assert.equal(pending.element.dataset.docId, 'plan:search', 'previous applied view retained');
  assert.ok(pending.element.querySelector('.spike-graph-viewport svg'), 'previous graph retained');
  const never = createProjectMapSpike({ fixture: projectMapFixture(), layoutScheduler: hungScheduler() });
  await settle();
  assert.equal(never.element.querySelectorAll('.spike-node').length, 0, 'no layout result displayed while hung');
  assert.match(viewStatus(never), /Layout pending/);

  function viewStatus(target) { return target.element.querySelector('[data-testid="spike-status"]').textContent; }
});

test('a layout failure retains the last valid graph and shows the equivalent list', async () => {
  const view = await renderedView(batchFixture(), { layoutScheduler: rejectingLaterScheduler(new SpikePresentationError('LAYOUT_DEPENDENCY_CYCLE', 'cycle')) });
  const graphBefore = view.element.querySelectorAll('.spike-node').length;
  view.showFixture(planFixture('search'));
  await settle();
  assert.equal(view.getStats().layoutError, 'LAYOUT_DEPENDENCY_CYCLE');
  assert.match(view.element.querySelector('[data-testid="spike-status"]').textContent, /Layout failed/);
  assert.equal(view.element.querySelectorAll('.spike-node').length, graphBefore, 'last valid graph retained');
  const list = view.element.querySelector('.spike-list');
  assert.equal(list.hidden, false, 'equivalent list shown after failure');
  assert.ok(list.querySelectorAll('li').length > 0);
});

test('cyclic dependency fixtures fail closed at the presentation boundary', () => {
  const cyclic = { viewId: 'plan:x', level: 'plan', docId: 'plan:x', title: 'Cyclic', subtitle: '',
    nodes: [{ id: 'a', kind: 'task', title: 'A', execution: { state: 'neutral', label: 'x' }, verification: { state: 'neutral', label: 'y' } },
      { id: 'b', kind: 'task', title: 'B', execution: { state: 'neutral', label: 'x' }, verification: { state: 'neutral', label: 'y' } }],
    edges: [{ from: 'a', to: 'b', kind: 'dependency', label: '' }, { from: 'b', to: 'a', kind: 'dependency', label: '' }] };
  assert.throws(() => layoutProjectGraph(presentationModel(cyclic)), error => error instanceof SpikePresentationError && error.code === 'LAYOUT_DEPENDENCY_CYCLE');
});

test('graph keyboard traversal moves focus by layer and row', async () => {
  const view = await renderedView(batchFixture());
  assert.ok(view.focusNode('task:index-plan'));
  const card = () => document.activeElement;
  assert.equal(card().dataset.nodeId, 'task:index-plan');
  card().dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.ok(['task:index-crawl', 'task:index-parse', 'task:index-offline-mirror'].includes(card().dataset.nodeId), 'ArrowRight enters the next layer');
  const firstInLayer = card().dataset.nodeId;
  card().dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.notEqual(card().dataset.nodeId, firstInLayer, 'ArrowDown moves within the column');
  card().dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
  assert.equal(card().dataset.nodeId, firstInLayer);
  card().dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.ok(['verifier:content-check', 'verifier:offline-check'].includes(card().dataset.nodeId), 'second ArrowRight reaches the verifier stage');
  card().dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(card().dataset.nodeId, 'join:batch-complete', 'final ArrowRight reaches the blocked join');
  card().dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(view.getStats().selectedId, 'join:batch-complete');
  assert.match(view.element.querySelector('[data-testid="spike-inspector"]').textContent, /blocked/i);
});

test('list keyboard traversal, expansion and full labels', async () => {
  const view = await renderedView(planFixture('search'));
  view.setMode('list');
  const rows = () => view.element.querySelectorAll('.spike-row-control');
  assert.equal(rows().length, presentationModel(planFixture('search')).nodes.length);
  rows()[0].focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.equal(document.activeElement.dataset.nodeId, rows()[1].dataset.nodeId);
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(view.getStats().selectedId, rows()[1].dataset.nodeId);
  const gateRow = [...rows()].find(row => row.dataset.nodeId === 'gate:wave-1');
  gateRow.focus();
  const collapsedCount = rows().length;
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  await settle();
  assert.ok(view.element.querySelectorAll('.spike-row-control').length > collapsedCount, 'ArrowRight expands the collapsed gate');
  assert.ok(view.element.querySelectorAll('.spike-row-control').some(row => row.dataset.nodeId === 'gate-check:browser-smoke'));
  const expandedGate = [...view.element.querySelectorAll('.spike-row-control')].find(row => row.dataset.nodeId === 'gate:wave-1');
  expandedGate.focus();
  document.activeElement.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await settle();
  assert.ok(view.element.querySelectorAll('.spike-row-control').length === collapsedCount, 'Escape collapses the gate again');
  const longRow = [...view.element.querySelectorAll('.spike-row-control')].find(row => row.dataset.nodeId === 'batch:client-ui');
  assert.equal(longRow.textContent.length, planFixture('search').nodes.find(node => node.id === 'batch:client-ui').title.length, 'list keeps the full long label');
});

test('collapsed gate groups hide children and still reveal pending or stale gate state', async () => {
  const fixture = planFixture('search');
  const collapsedModel = presentationModel(fixture);
  const expandedModel = presentationModel(fixture, { collapsed: new Set() });
  assert.ok(expandedModel.nodes.length > collapsedModel.nodes.length);
  assert.ok(collapsedModel.byId.get('gate:wave-1').summary.includes('collapsed: 3 checks'));
  assert.ok(collapsedModel.byId.get('gate:wave-1').summary.includes('pending'), 'collapsed summary reveals the blocking check');
  const releaseGate = presentationModel(fixture).byId.get('gate:release');
  assert.ok(releaseGate.summary.includes('stale'), 'collapsed summary reveals stale verification');
  const view = await renderedView(fixture);
  assert.ok(view.getStats().collapsed.includes('gate:wave-1'));
  view.toggleGroup('gate:wave-1');
  await settle();
  assert.ok(!view.getStats().collapsed.includes('gate:wave-1'));
  const onlyWave1Expanded = presentationModel(fixture, { collapsed: new Set(['gate:release']) });
  assert.equal(view.getStats().nodeCount, onlyWave1Expanded.nodes.length);
  assert.equal(view.getStats().edgeCount, layoutProjectGraph(onlyWave1Expanded).edges.length);
  assert.ok(view.element.querySelector('.spike-node[data-node-id="gate-check:browser-smoke"]'));
});

test('retry history renders as a new attempt without a plan-DAG cycle', async () => {
  const fixture = attemptFixture();
  const model = presentationModel(fixture);
  const layout = layoutProjectGraph(model);
  const layers = new Map(layout.nodes.map(node => [node.id, node.layer]));
  assert.ok(layers.get('attempt:2') > layers.get('attempt:1'), 'attempt 2 sequences after attempt 1');
  const historyEdge = layout.edges.find(edge => edge.id === 'attempt:1->attempt:2');
  assert.equal(historyEdge.kind, 'history');
  const hint = model.layoutEdges.find(edge => edge.from === 'attempt:1' && edge.to === 'attempt:2');
  assert.equal(hint.kind, 'group', 'retry ordering is a presentation hint, not a dependency');
  assert.ok(model.layoutEdges.every(edge => edge.kind !== 'history'), 'history edges never participate in layering');
  const view = await renderedView(fixture);
  assert.equal(view.element.querySelector('path[data-edge-id="attempt:1->attempt:2"]').dataset.kind, 'history');
});

test('the durable conflict and the status sentence clauses are selectable', async () => {
  const view = await renderedView(projectMapFixture());
  const conflict = view.element.querySelector('.spike-node[data-node-id="conflict:offline-vs-cloud"]');
  assert.ok(conflict);
  assert.match(conflict.textContent, /offline requirement versus mandatory-cloud/);
  const clauses = view.element.querySelectorAll('[data-testid="spike-status-sentence"] .spike-clause');
  assert.equal(clauses.length, 3);
  clauses[0].click();
  assert.equal(view.getStats().selectedId, 'plan:search');
  const boundary = view.element.querySelector('.spike-node[data-node-id="boundary:vendor-sdk"]');
  assert.ok(boundary, 'external dependency terminates at a labeled boundary node');
});

test('disabled actions carry an adjacent explanation', async () => {
  const view = await renderedView(projectMapFixture());
  view.select('conflict:offline-vs-cloud');
  const inspector = view.element.querySelector('[data-testid="spike-inspector"]');
  const disabled = [...inspector.querySelectorAll('button')].filter(control => control.disabled);
  assert.ok(disabled.length >= 2, 'run/accept-resolution style actions are disabled');
  for (const control of disabled) {
    const reasonId = control.getAttribute('aria-describedby');
    assert.ok(reasonId, 'disabled control references its reason');
    const reason = inspector.querySelector(`[id="${reasonId}"]`) ?? view.element.querySelector(`[id="${reasonId}"]`);
    assert.ok(reason && reason.textContent.length > 10, 'reason text is present and specific');
  }
});

test('fixture titles render as text only and never parse as markup', async () => {
  const hostile = projectMapFixture();
  hostile.nodes[0].title = '<img src=x onerror=window.__spikePwned=1><script>alert(1)</script>';
  const view = await renderedView(hostile);
  assert.equal(view.element.querySelectorAll('img').length, 0);
  assert.equal(view.element.querySelectorAll('script').length, 0);
  const card = view.element.querySelector('.spike-node[data-node-id="feature:offline-sync"]');
  assert.equal(card.textContent.includes('<img src=x onerror='), true);
  const rows = listModel(hostile);
  assert.equal(rows.rows[0].fullLabel, hostile.nodes[0].title);
});

test('malformed fixtures fail closed before any DOM rendering', () => {
  const base = () => structuredClone(projectMapFixture());
  const unknownKind = base(); unknownKind.nodes[0].kind = 'scheduler-decision';
  assert.throws(() => presentationModel(unknownKind), error => error.code === 'UNKNOWN_NODE_KIND');
  const badEdge = base(); badEdge.edges[0].to = 'plan:missing';
  assert.throws(() => presentationModel(badEdge), error => error.code === 'UNKNOWN_EDGE_ENDPOINT');
  const selfEdge = base(); selfEdge.edges[0] = { from: 'plan:search', to: 'plan:search', kind: 'dependency', label: '' };
  assert.throws(() => presentationModel(selfEdge), error => error.code === 'SELF_EDGE');
  const duplicate = base(); duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
  assert.throws(() => presentationModel(duplicate), error => error.code === 'DUPLICATE_NODE');
  const badEdgeKind = base(); badEdgeKind.edges[0].kind = 'mermaid';
  assert.throws(() => presentationModel(badEdgeKind), error => error.code === 'UNKNOWN_EDGE_KIND');
  assert.throws(() => presentationModel(null), error => error.code === 'FIXTURE_REQUIRED');
});

test('long labels wrap deterministically and unbroken tokens split', () => {
  assert.deepEqual(wrapLabel('Short title', 200), ['Short title']);
  const words = wrapLabel('Coordinate offline-first synchronization with the mandatory cloud relay rollout required by the collaboration workstream', 200);
  assert.ok(words.length >= 3);
  assert.ok(words.join(' ').length > 100, 'long label keeps every character through wrapping');
  const unbroken = wrapLabel('x'.repeat(120), 200);
  assert.ok(unbroken.every(line => line.length <= 24));
  assert.equal(unbroken.join('').length, 120, 'hard split preserves every character');
});

test('spike styles respect reduced motion and modules add no dependencies', async () => {
  const css = await readFile(new URL('project-map-spike.css', UI), 'utf8');
  const tokens = await readFile(new URL('tokens.css', UI), 'utf8');
  assert.equal(/@keyframes|animation:/.test(css), false, 'no decorative animation');
  assert.match(css, /\.spike-node\s+\.spike-chiprow\s*\{[^}]*display:\s*grid/, 'card-scoped selector keeps status rows on the measured grid after later shared CSS imports');
  assert.match(css, /\.spike-node\s*\{[^}]*padding:\s*var\(--s3\)/s, 'card uses the shared s3 padding token');
  assert.match(tokens, /--s3:\s*\.75rem/, 's3 remains twelve CSS pixels at the root font size');
  assert.equal(CARD.paddingY, 12, 'layout geometry reserves the same vertical padding rendered by the card');
  for (const declaration of css.match(/transition:[^;]+;/g) ?? []) assert.match(declaration, /var\(--fast\)/);
  for (const file of ['project-fixtures.mjs', 'project-presentation.mjs', 'project-map-spike.mjs', 'project-map-page.mjs']) {
    const source = await readFile(new URL(file, UI), 'utf8');
    for (const specifier of source.matchAll(/from\s+'([^']+)'/g)) {
      assert.match(specifier[1], /^\.?\//, `${file} imports only relative modules (no new dependencies)`);
    }
  }
});
