// T03 spike page wiring — fixture-only consumer of createProjectMapSpike.
// Serves the four §7.2 levels, theme switching, plan switching (stale-reply guard),
// drill-down, and an in-page measurement hook used by the browser evidence harness.
import { spikeFixtures, planFixture } from './project-fixtures.mjs';
import { createProjectMapSpike } from './project-map-spike.mjs';
import { layoutProjectGraph, measureNodeCard, presentationModel } from './project-presentation.mjs';
import { installNativeExperience } from './components.mjs';

installNativeExperience(); // T11: keyboard/focus/density layer, idempotent

const WORKER_LATENCY_MS = 60; // simulated layout-worker latency so the revision guard is observable
const latencyScheduler = (model, revision) => new Promise(resolve => setTimeout(() => resolve(layoutProjectGraph(model)), WORKER_LATENCY_MS));

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#spike-root');
const levelNav = document.querySelector('nav[aria-label="Spike levels"]');
const loadStatus = document.querySelector('#load-status');
let view = null;
let activeKey = 'project';

function buildFixture(key) {
  const entry = spikeFixtures.find(item => item.key === key) ?? spikeFixtures[0];
  return entry.build();
}

function mount(key) {
  activeKey = key;
  if (view) view.element.remove();
  view = createProjectMapSpike({
    fixture: buildFixture(key),
    layoutScheduler: latencyScheduler,
    planProvider: planId => planFixture(planId === 'plan:collab-explore' ? 'collab' : 'search'),
    callbacks: {
      onDrill({ drill }) {
        const keyFor = { 'batch:index-build': 'batch', 'task:index-crawl': 'attempt', 'plan:search': 'plan' };
        const next = keyFor[drill];
        if (next && next !== activeKey) mount(next);
      },
    },
  });
  root.append(view.element);
  for (const control of levelNav.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control.dataset.level === key));
}

for (const entry of spikeFixtures) {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = entry.label;
  control.dataset.level = entry.key;
  control.addEventListener('click', () => mount(entry.key));
  levelNav.append(control);
}
mount('project');
loadStatus.textContent = 'Spike ready.';
document.documentElement.dataset.spikeReady = 'true';

// Measurement hook (fixture-only). Real timings via performance.now; medians of N runs.
window.__spikeMeasure = async function measure() {
  const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  const settle = () => new Promise(resolve => setTimeout(resolve, WORKER_LATENCY_MS + 40));
  const results = [];
  for (const entry of spikeFixtures) {
    const fixture = buildFixture(entry.key);
    const runs = 5;
    const initial = [];
    let stats = null;
    for (let index = 0; index < runs; index += 1) {
      if (view) view.element.remove();
      const started = performance.now();
      view = createProjectMapSpike({ fixture: buildFixture(entry.key), layoutScheduler: latencyScheduler,
        planProvider: planId => planFixture(planId === 'plan:collab-explore' ? 'collab' : 'search') });
      root.append(view.element);
      await settle();
      initial.push(performance.now() - started);
      stats = view.getStats();
    }
    // Pure engine compute inside the browser (no worker latency, no DOM): median of 50 runs.
    const model = presentationModel(fixture);
    const computeStart = performance.now();
    for (let index = 0; index < 50; index += 1) layoutProjectGraph(model);
    const pureComputeMs = (performance.now() - computeStart) / 50;
    // Relayout round trip: gate toggle where a collapsed group exists, otherwise a title rename.
    let relayoutMs = null; let relayoutVia = null;
    const collapsedGate = stats.collapsed[0];
    if (collapsedGate) {
      const before = performance.now();
      view.toggleGroup(collapsedGate);
      await settle();
      relayoutMs = performance.now() - before;
      view.toggleGroup(collapsedGate);
      await settle();
      relayoutVia = `toggle:${collapsedGate}`;
    } else {
      const target = fixture.nodes.find(node => node.title.length >= 60) ?? fixture.nodes[0];
      const before = performance.now();
      view.renameNode(target.id, `${target.title} — relayout measurement suffix`);
      await settle();
      relayoutMs = performance.now() - before;
      view.renameNode(target.id, target.title);
      await settle();
      relayoutVia = `rename:${target.id}`;
    }
    const longLabels = fixture.nodes.filter(node => node.title.length >= 60)
      .map(node => ({ id: node.id, titleLength: node.title.length, truncated: measureNodeCard(node).truncated }));
    results.push({ level: entry.key, docId: stats.docId, nodeCount: stats.nodeCount, edgeCount: stats.edgeCount,
      layoutWidth: stats.layoutWidth, layoutHeight: stats.layoutHeight,
      initialRenderMs: Number(median(initial).toFixed(1)), pureComputeMs: Number(pureComputeMs.toFixed(4)),
      relayoutMs: Number(relayoutMs.toFixed(1)), relayoutVia,
      workerLatencyMs: WORKER_LATENCY_MS, staleDiscarded: view.getStats().discardedCount, longLabels });
  }
  mount('project');
  await settle();
  return { userAgent: navigator.userAgent, results };
};
