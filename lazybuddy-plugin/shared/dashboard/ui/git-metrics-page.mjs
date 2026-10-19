// T18 Git and metrics demo page — fixture-only consumer of
// createGitMetricsView. Loads the recorded fixture JSON built by the T18 test
// through the real data path (T11 collectors over a real disposable git
// fixture, T10 accounting functions) and renders it with the production view
// modules, which are browser-safe: the collectors and accounting functions run
// under Node in the test; the page consumes their recorded results.
import { createGitMetricsView } from './git-metrics-view.mjs';
import { installNativeExperience } from './components.mjs';

installNativeExperience(); // T11: keyboard/focus/density layer, idempotent
import { gitDetailModel, metricsDetailModel } from './git-metrics-model.mjs';

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#git-metrics-root');
const viewNav = document.querySelector('nav[aria-label="Fixture views"]');
const loadStatus = document.querySelector('#load-status');
let view = null;
let fixture = null;
let activeKey = 'git-observed-pr';

function gitModel(remoteKey, collectionKey = 'before') {
  return gitDetailModel({
    local: fixture.collections[collectionKey],
    remote: fixture.remotes[remoteKey],
    observationIds: fixture.observationIds[collectionKey],
  });
}

// `accountKey` selects the §8.1 view fixture: a normalizeUsage result
// (usageCoverage / usageCumulative) or the declared-subset fixture (subsets).
const USAGE_FIXTURES = new Set(['usageCoverage', 'usageCumulative']);

function metricsModel(accountKey) {
  return metricsDetailModel({
    scope: fixture.meta.scope,
    filters: fixture.meta.filters,
    window: fixture.meta.window,
    asOf: fixture.meta.asOf,
    projectionRevision: fixture.meta.projectionRevision,
    accounting: {
      time: fixture.accounting.time,
      usage: USAGE_FIXTURES.has(accountKey) ? fixture.accounting[accountKey] : null,
      subsets: accountKey === 'subsets' ? fixture.accounting.subsets : null,
    },
    git: gitModel('observed'),
  });
}

const DESTINATIONS = [
  { key: 'git-observed-pr', label: 'Git · observed PR', git: ['observed', 'before'], metrics: 'usageCoverage' },
  { key: 'git-unavailable-pr', label: 'Git · PR typed-unavailable', git: ['unavailable', 'before'], metrics: 'usageCoverage' },
  { key: 'metrics-subsets', label: 'Metrics · subset fixture', git: ['observed', 'before'], metrics: 'subsets' },
  { key: 'metrics-cumulative', label: 'Metrics · cumulative fixture', git: ['observed', 'before'], metrics: 'usageCumulative' },
];

function mount(key) {
  activeKey = key;
  const destination = DESTINATIONS.find(entry => entry.key === key) ?? DESTINATIONS[0];
  if (view) view.element.remove();
  view = createGitMetricsView({
    git: gitModel(destination.git[0], destination.git[1]),
    metrics: metricsModel(destination.metrics),
  });
  root.append(view.element);
  for (const control of viewNav.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control.dataset.view === key));
}

// Simulated polling tick: a later real collection after a branch rename on the
// linked worktree. Selection, open metric drill-down and focus must survive.
window.__gitMetricsTick = function tick() {
  return view.applyUpdate(gitModel('observed', 'afterRename'), metricsModel('usageCoverage'));
};

window.__gitMetricsStats = () => view?.getStats() ?? null;

(async function load() {
  const response = await fetch('./git-metrics-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  fixture = await response.json();
  for (const destination of DESTINATIONS) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = destination.label;
    control.dataset.view = destination.key;
    control.addEventListener('click', () => mount(destination.key));
    viewNav.append(control);
  }
  mount('git-observed-pr');
  loadStatus.textContent = 'Git and metrics fixture ready.';
  document.documentElement.dataset.gitMetricsReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The fixture failed to load: ${error?.message ?? error}`;
  clearTimeout(loadTimeout);
  throw error;
});
