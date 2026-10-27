// T18 Git and metrics demo page — fixture-only consumer of the redesigned
// createGitMetricsView, mounted INSIDE the T12b app shell (sidebar + tabs +
// dock) so the redesign is proven in the real frame. Loads the recorded
// fixture JSON built by the T18 test through the real data path (T11
// collectors over a real disposable git fixture, T10 accounting functions)
// and renders it with the production view modules, which are browser-safe:
// the collectors and accounting functions run under Node in the test; the
// page consumes their recorded results.
import { createGitMetricsView } from './git-metrics-view.mjs';
import { createProjectShell } from './project-shell.mjs';
import { overviewBundle } from './live-project-adapter.mjs';
import { installNativeExperience, segmentedControl } from './components.mjs';

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
const gitHost = document.createElement('section');
let view = null;
let fixture = null;
let shell = null;

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
  { key: 'git-observed-pr', label: 'Observed PR', git: ['observed', 'before'], metrics: 'usageCoverage' },
  { key: 'git-unavailable-pr', label: 'PR unavailable', git: ['unavailable', 'before'], metrics: 'usageCoverage' },
  { key: 'metrics-subsets', label: 'Subsets', git: ['observed', 'before'], metrics: 'subsets' },
  { key: 'metrics-cumulative', label: 'Cumulative', git: ['observed', 'before'], metrics: 'usageCumulative' },
];

function mountView(key) {
  const destination = DESTINATIONS.find(entry => entry.key === key) ?? DESTINATIONS[0];
  if (view) view.element.remove();
  view = createGitMetricsView({
    git: gitModel(destination.git[0], destination.git[1]),
    metrics: metricsModel(destination.metrics),
  });
  gitHost.replaceChildren(view.element);
}

// The minimal initialized project record the shell needs to compose its
// frame (IO-2): repository/runtime identity, one plan, and the worktree
// entries observed by the real T11 collection. Every other destination than
// git renders its explicit unavailable state — no data is projected for it
// by this fixture page, and none is invented.
function shellProject(git) {
  return {
    schema_version: 1,
    project_id: `fixture:t18-git-metrics`,
    runtime: fixture.meta.scope.runtime ?? 'LazyBuddy',
    repository_key: fixture.meta.scope.repository ?? 'fixture:t18-git',
    revision: fixture.meta.projectionRevision ?? 1,
    baseline_revision: 1,
    observation_revision: 0,
    summary: { accepted_features: 1, accepted_principles: 0, accepted_requirements: 0, accepted_decisions: 0,
      plan_count: 1, unassigned_item_ids: [], pending_proposals: 0 },
    sources: [{ id: 'source:plan', path: '.omo/plans/t18-git-metrics.md', role: 'plan', revision: 1,
      accepted_sha256: 'a'.repeat(64),
      observation: { status: 'current', sha256: 'a'.repeat(64), path: '.omo/plans/t18-git-metrics.md', observed_at: fixture.meta.asOf } }],
    items: [{ id: 'feature:t18-git-metrics', kind: 'feature', state: 'accepted', title: 'Git and metrics detail redesign', revision: 1,
      source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'document' }, source_freshness: 'current', contributing_plan_ids: ['plan:t18'] }],
    plans: [{ id: 'plan:t18', title: 'T18 fixture plan', revision: 1, declared_lifecycle: 'active', baseline_refs: [],
      baseline_reference_status: 'unassessed', stale_item_ids: [], source_freshness: 'current',
      source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'heading:Work' }, native_runs: [], native_observations: [] }],
    proposals: [], architecture: [], research: [], reconciliations: [], observations: [], invalidations: [],
    artifacts: [], requests: [], issues: [],
    worktrees: { status: 'observed', identity: { basis: 'fixture', repository_key: fixture.meta.scope.repository ?? 'fixture:t18-git', shared: true },
      entries: git.worktrees.map(worktree => ({ root: worktree.root, branch: worktree.branch ?? null,
        head: worktree.head ?? null, current: worktree.current, kind: worktree.kind })) },
  };
}

function mountShell() {
  const initialGit = gitModel('observed');
  const bundle = overviewBundle(shellProject(initialGit));
  shell = createProjectShell({
    projectionProvider: () => bundle,
    product: { name: fixture.meta.scope.runtime ?? 'LazyBuddy', family: 'LazySeries' },
    views: {
      // The git destination is the redesigned view; the shell parks this
      // host element in the git tab so fixture switches swap content in place.
      git: { element: gitHost, update() {}, activate() {} },
    },
  });
  root.append(shell.element);
  shell.selectDestination('git');
}

// Simulated polling tick: a later real collection after a branch rename on the
// linked worktree. Git mode, selection, open metric drill-down and the dock
// state must survive.
window.__gitMetricsTick = function tick() {
  return view.applyUpdate(gitModel('observed', 'afterRename'), metricsModel('usageCoverage'));
};

window.__gitMetricsStats = () => view?.getStats() ?? null;
window.__gitMetricsShellStats = () => shell?.getStats() ?? null;

(async function load() {
  const response = await fetch('./git-metrics-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  fixture = await response.json();
  const picker = segmentedControl({
    label: 'Fixture views',
    options: DESTINATIONS.map(destination => ({ value: destination.key, label: destination.label })),
    current: DESTINATIONS[0].key,
    onChange: key => mountView(key),
  });
  picker.element.dataset.testid = 'fixture-picker';
  viewNav.append(picker.element);
  mountView(DESTINATIONS[0].key);
  mountShell();
  loadStatus.textContent = 'Git and metrics fixture ready inside the app shell.';
  document.documentElement.dataset.gitMetricsReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The fixture failed to load: ${error?.message ?? error}. No live collector is connected; reload to retry.`;
  clearTimeout(loadTimeout);
  throw error;
});
