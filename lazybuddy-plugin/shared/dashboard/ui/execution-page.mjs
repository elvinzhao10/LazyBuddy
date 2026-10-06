// T16 execution demo page — fixture-only consumer of createExecutionView.
// Loads the recorded fixture JSON built by the T16 test through the real data path
// (T09 observation recording -> T02 CLI project fixture -> T07 graph composition ->
// executionDocument/timelineModel) and renders it with the production view modules,
// which are browser-safe (the project model modules stay Node-only by design).
// Serves both required spec fixtures, drill-down, theme switching and a simulated
// polling tick used by the browser evidence harness.
import { createExecutionView } from './execution-view.mjs';

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#execution-root');
const levelNav = document.querySelector('nav[aria-label="Fixture levels"]');
const loadStatus = document.querySelector('#load-status');
let view = null;
let activeKey = 'fixture-a-plan';
let fixture = null;

const DESTINATIONS = [
  { key: 'fixture-a-plan', label: 'Fixture A · plan', level: 'plan' },
  { key: 'fixture-a-batch', label: 'Fixture A · batch', level: 'batch' },
  { key: 'fixture-a-task', label: 'Fixture A · task', level: 'task' },
  { key: 'fixture-b-plan', label: 'Fixture B · plan', level: 'plan' },
  { key: 'fixture-b-batch', label: 'Fixture B · batch', level: 'batch' },
];

function mount(key) {
  activeKey = key;
  const destination = DESTINATIONS.find(entry => entry.key === key) ?? DESTINATIONS[0];
  if (view) view.element.remove();
  view = createExecutionView({
    document: fixture.initial.documents[destination.key],
    timeline: fixture.initial.timeline,
    callbacks: {
      onDrill({ focusId }) {
        const next = { plan: 'batch', batch: 'task' }[view.getStats().level];
        if (!next) return;
        const target = DESTINATIONS.find(entry => entry.key === `${destination.key.split('-').slice(0, 2).join('-')}-${next}`);
        if (target && target.key !== activeKey) mount(target.key);
      },
      onNavigate({ level }) {
        const prefix = activeKey.split('-').slice(0, 2).join('-');
        const target = DESTINATIONS.find(entry => entry.key === `${prefix}-${level}`);
        if (target && target.key !== activeKey) mount(target.key);
      },
    },
  });
  root.append(view.element);
  for (const control of levelNav.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control.dataset.level === key));
}

// Simulated polling tick: a later real observation pass over the same run. The view
// must preserve breadcrumbs, selection, collapsed groups and viewport.
window.__executionTick = function tick() {
  return view.applyUpdate(fixture.initial.documents[activeKey], fixture.update.timeline);
};

window.__executionStats = () => view?.getStats() ?? null;

(async function load() {
  const response = await fetch('./execution-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  fixture = await response.json();
  for (const destination of DESTINATIONS) {
    if (!fixture.initial.documents[destination.key]) throw new Error(`fixture missing document ${destination.key}`);
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = destination.label;
    control.dataset.level = destination.key;
    control.addEventListener('click', () => mount(destination.key));
    levelNav.append(control);
  }
  mount('fixture-a-plan');
  loadStatus.textContent = 'Execution fixture ready.';
  document.documentElement.dataset.executionReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The execution fixture failed to load: ${error?.message ?? error}`;
  clearTimeout(loadTimeout);
  throw error;
});
