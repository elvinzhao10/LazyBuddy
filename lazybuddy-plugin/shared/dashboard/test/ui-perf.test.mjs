import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* T22 performance harness — measures the plan budgets that can be asserted
   deterministically in-process and records the wall-clock medians as
   MEASUREMENTS rows (absolute ms gates live in the run evidence, not CI):

   budget A  cached shell mount median over 10 mounts from an already-loaded
             bundle (the page's window.__shellMeasure is the served-page
             equivalent; here the same shell factory is timed headlessly).
   budget B  tab-free navigation must not leak: 100 rapid in-place navigation
             cycles leave the element count and the listener count of the
             document tree unchanged (no view re-creation, no listener growth).
   budget C  poll ticks stay bounded: 30 polling refreshes with a changed
             bundle grow the document by a bounded amount (view swap only —
             no orphaned nodes left on the body).
   budget D  graph layout recalcs bounded: a node title edit (the inspector
             rename control) remeasures geometry WITHOUT scheduling a full
             engine re-layout — the counting scheduler must not be called and
             the applied geometry must equal a full relayout of the same
             edited fixture (incremental, not approximate). */

const dom = createMiniDom();
globalThis.document = dom.document;

const { createProjectShell } = await import('../ui/project-shell.mjs');
const { createProjectMapSpike } = await import('../ui/project-map-spike.mjs');
const { layoutProjectGraph, presentationModel } = await import('../ui/project-presentation.mjs');
const { planFixture } = await import('../ui/project-fixtures.mjs');
const { overviewBundle } = await import('../ui/live-project-adapter.mjs');

const storage = new Map();
globalThis.sessionStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

// The hermetic project record (same shape as the shell proof's); the evidence
// run points LAZYBUDDY_PERF_BUNDLE at the real generated overview bundle so
// the recorded medians measure the served fixture sizes.
const project = {
  schema_version: 1, project_id: 'project:perf', runtime: 'LazyBuddy', repository_key: 'repo:perf',
  revision: 3, baseline_revision: 1, observation_revision: 0,
  summary: { accepted_features: 1, accepted_principles: 0, accepted_requirements: 0, accepted_decisions: 0,
    plan_count: 1, unassigned_item_ids: [], pending_proposals: 0 },
  sources: [{ id: 'source:plan', path: '.omo/plans/perf.md', role: 'plan', revision: 1, accepted_sha256: 'a'.repeat(64),
    observation: { status: 'current', sha256: 'a'.repeat(64), path: '.omo/plans/perf.md', observed_at: '2026-10-10T12:00:00.000Z' } }],
  items: [{ id: 'feature:perf', kind: 'feature', state: 'accepted', title: 'Perf harness', revision: 1,
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'document' }, source_freshness: 'current', contributing_plan_ids: ['plan:perf'] }],
  plans: [{ id: 'plan:perf', title: 'Perf plan', revision: 1, declared_lifecycle: 'active', baseline_refs: [],
    baseline_reference_status: 'unassessed', stale_item_ids: [], source_freshness: 'current',
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'heading:Work' }, native_runs: [], native_observations: [] }],
  proposals: [], architecture: [], research: [], reconciliations: [], observations: [], invalidations: [],
  artifacts: [], requests: [], issues: [],
  worktrees: { status: 'observed', identity: { basis: 'registry', repository_key: 'repo:perf', shared: true },
    entries: [{ root: '/tmp/perf', branch: 'main', head: 'b'.repeat(40), current: true, kind: 'main' }] },
};

function loadBundle() {
  const path = process.env.LAZYBUDDY_PERF_BUNDLE;
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  return overviewBundle(project);
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

function countTree(root) {
  let elements = 0; let listeners = 0;
  const visit = node => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeType === 1) {
        elements += 1;
        listeners += [...(child.listeners?.values() ?? [])].reduce((sum, list) => sum + list.length, 0);
        visit(child);
      }
    }
  };
  visit(root);
  return { elements, listeners };
}

function stubViews() {
  return {
    plans: { element: document.createElement('section'), update() {}, open() {} },
    evidence: { element: document.createElement('section'), update() {}, activate() {} },
    research: { element: document.createElement('section'), update() {}, activate() {} },
  };
}

function mountShell({ views = {} } = {}) {
  const state = { bundle: loadBundle() };
  const shell = createProjectShell({ projectionProvider: () => state.bundle, product: { name: 'LazyBuddy' }, views });
  dom.document.body.append(shell.element);
  return { shell, state };
}

const MOUNT_RUNS = 10;

test('budget A: cached shell mount median over 10 mounts from a loaded bundle', async () => {
  const bundle = loadBundle();
  const mounts = [];
  for (let index = 0; index < MOUNT_RUNS; index += 1) {
    const started = performance.now();
    const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
    dom.document.body.append(shell.element);
    await settle(); // the overview map layout reply applies on the microtask
    mounts.push(performance.now() - started);
    shell.element.remove();
  }
  const mountMedianMs = Number(median(mounts).toFixed(1));
  console.log(`MEASUREMENTS node --test perf ${JSON.stringify([{ budget: 'cached-shell-mount', runs: MOUNT_RUNS, medianMs: mountMedianMs,
    minMs: Number(Math.min(...mounts).toFixed(1)), maxMs: Number(Math.max(...mounts).toFixed(1)),
    bundleBytes: JSON.stringify(bundle).length, bundle: process.env.LAZYBUDDY_PERF_BUNDLE ? 'served-overview-bundle' : 'hermetic-adapter-bundle' }])}`);
  assert.ok(mounts.every(ms => Number.isFinite(ms) && ms > 0), 'every mount reports a finite duration');
  assert.ok(mountMedianMs < 2000, `sanity ceiling only (median ${mountMedianMs}ms); the real gate is the recorded no-worse-than comparison in the run evidence`);
});

test('budget B: 100 rapid navigation cycles leave the DOM and listener counts unchanged', async () => {
  const { shell } = mountShell({ views: stubViews() });
  const destinations = ['overview', 'project', 'plans', 'execution', 'git', 'evidence', 'research'];
  // Warm-up cycle first: first navigation may lazily finish restore paths.
  for (const id of destinations) shell.selectDestination(id);
  shell.selectDestination('overview');
  await settle();
  const before = countTree(dom.document);
  for (let cycle = 0; cycle < 100; cycle += 1) {
    shell.selectDestination(destinations[cycle % destinations.length]);
    if (cycle % 7 === 3) { shell.openPlan('plan:perf'); shell.goBack(); } // item navigation through the in-place stack
  }
  shell.selectDestination('overview');
  await settle();
  const after = countTree(dom.document);
  console.log(`MEASUREMENTS node --test perf ${JSON.stringify([{ budget: 'nav-cycle-stability', cycles: 100,
    elementsBefore: before.elements, elementsAfter: after.elements,
    listenersBefore: before.listeners, listenersAfter: after.listeners }])}`);
  assert.equal(after.elements, before.elements, `100 in-place navigations must not grow the element tree (${before.elements} -> ${after.elements})`);
  assert.equal(after.listeners, before.listeners, `100 in-place navigations must not grow the listener count (${before.listeners} -> ${after.listeners})`);
  shell.element.remove();
});

test('budget C: 30 polling refreshes with a changed bundle stay bounded (no orphaned nodes on the body)', async () => {
  const { shell, state } = mountShell({ views: stubViews() });
  shell.selectDestination('overview');
  await settle();
  const before = countTree(dom.document);
  for (let tick = 0; tick < 30; tick += 1) {
    state.bundle = loadBundle(); // a fresh object each poll, like a re-fetched projection
    shell.update();
    await settle();
  }
  const after = countTree(dom.document);
  const growth = after.elements - before.elements;
  console.log(`MEASUREMENTS node --test perf ${JSON.stringify([{ budget: 'poll-tick-bounded', ticks: 30,
    elementsBefore: before.elements, elementsAfter: after.elements, growthPerTick: Number((growth / 30).toFixed(2)) }])}`);
  assert.ok(growth <= 0, `30 polling refreshes must not accumulate document nodes (grew by ${growth}; unbounded view-swap orphans)`);
  shell.element.remove();
});

test('budget D: a node title edit remeasures geometry without a full engine re-layout', async () => {
  const calls = [];
  const countingScheduler = model => { calls.push(model); return layoutProjectGraph(model); };
  const fixture = planFixture('search');
  const view = createProjectMapSpike({ fixture, layoutScheduler: countingScheduler });
  await settle();
  const nodeId = 'batch:offline-queue';
  view.select(nodeId);
  const callsAfterSelect = calls.length;
  assert.ok(callsAfterSelect >= 1, 'the initial mount schedules the engine layout');

  const longerTitle = 'Offline change queue — record every local mutation while offline, including the very long reconciliation descriptor attached to each queued change';
  const heightBefore = Number(view.element.querySelector(`.spike-node[data-node-id="${nodeId}"]`).parentNode.getAttribute('height'));
  view.renameNode(nodeId, longerTitle);
  await settle();
  await settle(); // the incremental apply is synchronous; settle keeps parity with the async path

  assert.equal(calls.length, callsAfterSelect, `a title edit must not schedule a full engine re-layout (scheduler called ${calls.length - callsAfterSelect} extra times)`);
  const heightAfter = Number(view.element.querySelector(`.spike-node[data-node-id="${nodeId}"]`).parentNode.getAttribute('height'));
  assert.ok(heightAfter > heightBefore, `the renamed card remeasures (${heightBefore} -> ${heightAfter})`);

  // Incremental, not approximate: the applied geometry must equal a full
  // relayout of the same edited fixture through the real engine.
  const edited = view.getFixture();
  const control = layoutProjectGraph(presentationModel(edited));
  const stats = view.getStats();
  assert.equal(stats.nodeCount, control.nodes.length, 'same node set as a full relayout');
  assert.equal(stats.edgeCount, control.edges.length, 'same edge set as a full relayout');
  assert.equal(stats.layoutWidth, control.width, 'same canvas width as a full relayout');
  assert.equal(stats.layoutHeight, control.height, 'same canvas height as a full relayout');
  const appliedHeights = [...view.element.querySelectorAll('foreignObject[data-node-id]')]
    .map(node => Number(node.getAttribute('height')));
  const controlHeights = Object.fromEntries(control.nodes.map(node => [node.id, node.height]));
  for (const node of view.element.querySelectorAll('foreignObject[data-node-id]')) {
    assert.equal(Number(node.getAttribute('height')), controlHeights[node.dataset.nodeId], `${node.dataset.nodeId} height matches the full relayout`);
  }
  assert.ok(stats.viewRevision >= 2 && stats.appliedRevision >= 2, 'the incremental apply records a new applied revision');
  assert.ok(appliedHeights.every(height => Number.isFinite(height)));
  view.element.remove();
});
