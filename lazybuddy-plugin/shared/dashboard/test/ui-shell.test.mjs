import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* T12b app-shell proof: the sidebar + tab + dock frame mounted on the real
   pages. Covers the tab open/select/close/pin lifecycle, the sidebar current
   state, the dock migration of the inspector and contributing-records regions
   (open on selection, Escape with focus return), the explicit unavailable
   state for destinations without data, the unchanged pre-init composition
   (IO-2), the extended keyboard map (Cmd/Ctrl+1..7 destinations, tab
   arrows/Home/End, Delete, j/k), tab persistence across a reload-shaped
   remount, and polling refreshes that never reset the user's place. */

const dom = createMiniDom();
globalThis.document = dom.document;

const { createProjectShell, PROJECT_DESTINATIONS } = await import('../ui/project-shell.mjs');
const { installFocusSystem } = await import('../ui/components.mjs');
const { overviewBundle } = await import('../ui/live-project-adapter.mjs');

// In-memory sessionStorage stand-in: the shell persists its tab state under
// 'lazybuddy-shell-tabs' and must degrade silently when storage is absent.
const storage = new Map();
globalThis.sessionStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const project = {
  schema_version: 1, project_id: 'project:shell', runtime: 'LazyBuddy', repository_key: 'repo:shell',
  revision: 3, baseline_revision: 1, observation_revision: 0,
  summary: { accepted_features: 1, accepted_principles: 0, accepted_requirements: 0, accepted_decisions: 0,
    plan_count: 1, unassigned_item_ids: [], pending_proposals: 0 },
  sources: [{ id: 'source:plan', path: '.omo/plans/shell.md', role: 'plan', revision: 1, accepted_sha256: 'a'.repeat(64),
    observation: { status: 'current', sha256: 'a'.repeat(64), path: '.omo/plans/shell.md', observed_at: '2026-10-10T12:00:00.000Z' } }],
  items: [{ id: 'feature:shell', kind: 'feature', state: 'accepted', title: 'App shell', revision: 1,
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'document' }, source_freshness: 'current', contributing_plan_ids: ['plan:shell'] }],
  plans: [{ id: 'plan:shell', title: 'Shell frame plan', revision: 1, declared_lifecycle: 'active', baseline_refs: [],
    baseline_reference_status: 'unassessed', stale_item_ids: [], source_freshness: 'current',
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'heading:Work' }, native_runs: [], native_observations: [] }],
  proposals: [], architecture: [], research: [], reconciliations: [], observations: [], invalidations: [],
  artifacts: [], requests: [], issues: [],
  worktrees: { status: 'observed', identity: { basis: 'registry', repository_key: 'repo:shell', shared: true },
    entries: [{ root: '/tmp/shell', branch: 'main', head: 'b'.repeat(40), current: true, kind: 'main' }] },
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const shellRoot = shell => shell.element;
const destinationButton = (shell, id) => shellRoot(shell).querySelector(`.lb-sidebar-destination[data-destination="${id}"]`);
const tabNode = (shell, id) => shellRoot(shell).querySelector(`.lb-tabs .lb-tab[data-tab-id="${id}"]`);
const press = (target, key, extra = {}) => target.dispatchEvent({ type: 'keydown', key, bubbles: true, cancelable: true, ...extra });

// One document per process: every prior shell must tear its frame down
// before the next mounts, exactly like one shell per real page.
const mounted = [];
function mountShell({ views = {}, bundle: initial = overviewBundle(project) } = {}) {
  for (const prev of mounted) { prev.state.bundle = null; prev.shell.update(); prev.shell.element.remove(); }
  mounted.length = 0;
  const state = { bundle: initial };
  const shell = createProjectShell({ projectionProvider: () => state.bundle, product: { name: 'LazyBuddy' }, views });
  dom.document.body.append(shell.element);
  mounted.push({ state, shell });
  return { shell, state };
}

function stubViews() {
  const opened = [];
  const plansView = { element: document.createElement('section'), update() {}, open: id => opened.push(id) };
  const evidenceView = { element: document.createElement('section'), update() {}, activate: () => opened.push('evidence:activate') };
  return { opened, views: { plans: plansView, evidence: evidenceView } };
}

test('pre-init stays the IO-2 baseline: no frame, the same self-explaining notice', async () => {
  storage.clear();
  const { shell } = mountShell({ bundle: null });
  await settle();
  const root = shellRoot(shell);
  assert.equal(root.dataset.initialized, 'false');
  assert.equal(root.querySelectorAll('[data-destination]').length, 0, 'no destinations before init');
  assert.equal(root.querySelector('.lb-sidebar'), null, 'no sidebar rail before init');
  assert.equal(root.querySelector('.lb-tabs'), null, 'no tab strip before init');
  assert.equal(root.querySelector('[data-testid="dock-panel"]'), null, 'no dock before init');
  const notice = root.querySelector('[data-testid="shell-uninitialized"]');
  assert.ok(notice, 'the pre-init notice renders');
  assert.equal(notice.querySelectorAll('.status')[0].dataset.state, 'unavailable');
  assert.equal(notice.querySelectorAll('p')[0].textContent,
    'This service exposes no initialized project record, so the project destinations do not render. '
    + 'Project initialization stays explicit opt-in (IO-2); nothing here creates or mutates a registry.',
    'the pre-init explanation stays byte-identical to the baseline');
});

test('the frame mounts after init: sidebar with every destination selectable, pinned Overview tab, hidden dock', async () => {
  storage.clear();
  const { shell } = mountShell();
  await settle();
  const root = shellRoot(shell);
  assert.equal(root.dataset.initialized, 'true');
  const destinations = [...root.querySelectorAll('[data-destination]')];
  assert.equal(destinations.length, PROJECT_DESTINATIONS.length, 'all seven sidebar destinations render');
  assert.ok(destinations.every(control => !control.disabled), 'every destination is selectable; missing data never disables a control');
  assert.deepEqual(destinations.map(control => control.dataset.destination), PROJECT_DESTINATIONS.map(entry => entry.id));
  assert.equal(destinationButton(shell, 'overview').getAttribute('aria-current'), 'page', 'the sidebar marks the current destination');
  assert.equal(root.querySelector('[data-testid="shell-title"]').textContent, 'project:shell', 'the project name leads the header');
  assert.match(root.querySelector('[data-testid="shell-context"]').textContent, /branch main @ b{12}/, 'worktree context in the header');
  const tabs = [...root.querySelectorAll('.lb-tabs .lb-tab')];
  assert.equal(tabs.length, 1, 'a single pinned tab at init');
  assert.equal(tabs[0].dataset.tabId, 'overview');
  assert.equal(tabs[0].dataset.pinned, 'true');
  assert.equal(tabs[0].querySelector('.lb-tab-close'), null, 'the pinned Overview renders no close control');
  assert.ok(root.querySelector('[data-testid="overview-view"]'), 'the overview destination renders in the active panel');
  const dock = root.querySelector('[data-testid="dock-panel"]');
  assert.ok(dock, 'the dock renders as part of the frame');
  assert.equal(dock.hidden, true, 'the dock starts closed');
  assert.ok(root.querySelector('[data-testid="dock-inspector-region"]'), 'the inspector region lives in the dock');
  assert.ok(root.querySelector('[data-testid="dock-records-region"]'), 'the contributing-records region lives in the dock');
  const records = root.querySelector('[data-testid="overview-records"]');
  assert.ok(records, 'the overview records panel exists');
  assert.ok(records.matches('.lb-dock .overview-records, .lb-dock [data-testid="overview-records"]') || root.querySelector('[data-testid="dock-panel"] [data-testid="overview-records"]') === records,
    'the records region migrated into the dock, not inline');
  assert.equal(root.querySelector('[data-testid="overview-view"] [data-testid="overview-records"]'), null,
    'no inline contributing-records region remains in the overview');
});

test('a destination without data renders an explicit unavailable state and still closes like any tab', async () => {
  storage.clear();
  const { shell } = mountShell();
  await settle();
  assert.equal(shell.selectDestination('plans'), true, 'the destination is selectable without live views');
  const unavailable = shellRoot(shell).querySelector('[data-testid="shell-destination-unavailable"]');
  assert.ok(unavailable, 'the unavailable state renders');
  assert.equal(unavailable.dataset.destination, 'plans');
  assert.equal(unavailable.querySelectorAll('.status')[0].dataset.state, 'unavailable');
  assert.match(unavailable.textContent, /static projection bundle/, 'the explanation names the actual reason');
  assert.ok(tabNode(shell, 'plans'), 'the destination owns a tab');
  assert.equal(shell.getStats().activeTab, 'plans');
  assert.equal(destinationButton(shell, 'plans').getAttribute('aria-current'), 'page', 'the sidebar current state follows the selection');
  const close = tabNode(shell, 'plans').querySelector('.lb-tab-close');
  assert.ok(close, 'destination tabs are closable');
  close.click();
  assert.equal(shell.getStats().tabs.includes('plans'), false, 'closing removes the destination tab');
  assert.equal(shell.getStats().activeDestination, 'overview', 'closing falls back to the pinned neighbor');
  shell.selectDestination('plans');
  assert.ok(shellRoot(shell).querySelector('[data-testid="shell-destination-unavailable"]'), 're-opening re-renders the unavailable state');
});

test('plan items open closable tabs that reuse the plans surface and re-enter on selection', async () => {
  storage.clear();
  const { opened, views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  shell.openPlan('plan:shell');
  assert.deepEqual(opened, ['plan:shell'], 'opening focuses the plan in the plans surface');
  const tab = tabNode(shell, 'plan:plan:shell');
  assert.ok(tab, 'the plan item opens its own tab');
  assert.equal(tab.getAttribute('aria-label'), 'Plan · Shell frame plan', 'the tab title carries the plan title');
  assert.ok(tab.querySelector('.lb-tab-close'), 'item tabs are closable');
  assert.equal(shell.getStats().activeTab, 'plan:plan:shell');
  assert.equal(shell.getStats().activeDestination, 'plans', 'an open plan tab keeps the destination truthful');
  assert.equal(destinationButton(shell, 'plans').getAttribute('aria-current'), 'page');
  assert.ok(views.plans.element.parentNode, 'the plans surface element is mounted in the item panel');
  shell.selectDestination('overview');
  assert.equal(views.plans.element.parentNode.dataset.tabId, 'plan:plan:shell',
    'the surface stays parked in its tab panel, hidden but never destroyed');
  tabNode(shell, 'plan:plan:shell').dispatchEvent({ type: 'click', bubbles: true });
  assert.deepEqual(opened, ['plan:shell', 'plan:shell'], 're-selecting the plan tab re-enters the plan');
  assert.equal(shell.getStats().tabs.filter(id => id === 'plan:plan:shell').length, 1, 're-opening never duplicates a tab');
});

test('the dock opens on selection, Escape closes it, focus returns to the invoking control', async () => {
  storage.clear();
  const detach = installFocusSystem({ root: dom.document });
  try {
    const { shell } = mountShell();
    await settle();
    const dockToggle = shellRoot(shell).querySelector('[data-testid="shell-dock-trigger"]');
    const dock = shellRoot(shell).querySelector('[data-testid="dock-panel"]');
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'false');
    dockToggle.click();
    assert.equal(dock.hidden, false, 'the header trigger opens the dock');
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'true');
    assert.ok(shell.getStats().dockOpen);
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(dock.hidden, true, 'Escape collapses the dock through the T11 overlay stack');
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'false');

    const metric = shellRoot(shell).querySelector('[data-testid="overview-metrics"] [data-metric-id]');
    metric.focus();
    metric.click();
    assert.equal(dock.hidden, false, 'opening contributing records opens the dock on selection');
    assert.ok(shellRoot(shell).querySelector('[data-testid="dock-records-region"] [data-testid="overview-records"] .overview-record-list'),
      'the docked records region lists the contributing records');
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(dom.document.activeElement, metric, 'focus returns to the invoking control');
  } finally {
    detach.detach();
  }
});

test('keyboard map: Cmd/Ctrl+1..7 destinations, tab arrows/Home/End, Delete close, j/k sidebar traversal', async () => {
  storage.clear();
  const detach = installFocusSystem({ root: dom.document });
  try {
    const { views } = stubViews();
    const { shell } = mountShell({ views });
    await settle();
    shell.openPlan('plan:shell');
    dom.document.dispatchEvent({ type: 'keydown', key: '5', code: 'Digit5', metaKey: true, bubbles: true, cancelable: true });
    assert.equal(shell.getStats().activeDestination, 'git', 'Cmd/Ctrl+5 selects the fifth destination (git) from anywhere');
    assert.equal(dom.document.activeElement, destinationButton(shell, 'git'), 'the shortcut focuses the sidebar destination');
    assert.equal(destinationButton(shell, 'git').getAttribute('aria-current'), 'page');
    dom.document.dispatchEvent({ type: 'keydown', key: '8', code: 'Digit8', ctrlKey: true, bubbles: true, cancelable: true });
    assert.equal(shell.getStats().activeDestination, 'git', 'a digit past the destinations is ignored');

    // Focus inside the tab strip keeps the T12 component contract: digits
    // address the nth TAB, and the destination shortcut defers. Strip order
    // here: overview, plan:plan:shell, git (the Cmd+5 destination appended).
    const tablist = shellRoot(shell).querySelector('.lb-tabs');
    const overviewTab = tabNode(shell, 'overview');
    const planTab = tabNode(shell, 'plan:plan:shell');
    const gitTab = tabNode(shell, 'git');
    planTab.dispatchEvent({ type: 'click', bubbles: true });
    assert.equal(shell.getStats().activeTab, 'plan:plan:shell');
    press(tablist, 'ArrowRight');
    assert.equal(shell.getStats().activeTab, 'git', 'ArrowRight activates the next tab');
    press(gitTab, 'ArrowLeft');
    assert.equal(shell.getStats().activeTab, 'plan:plan:shell', 'ArrowLeft activates the previous tab');
    press(overviewTab, 'End');
    assert.equal(shell.getStats().activeTab, 'git', 'End reaches the last tab');
    press(gitTab, 'Home');
    assert.equal(shell.getStats().activeTab, 'overview', 'Home reaches the first tab');
    press(gitTab, '2', { code: 'Digit2', metaKey: true });
    assert.equal(shell.getStats().activeTab, 'plan:plan:shell', 'Cmd/Ctrl+digit inside the strip selects the nth tab');
    assert.equal(shell.getStats().activeDestination, 'plans', 'and the destination shortcut did not also fire');
    press(overviewTab, 'Delete');
    assert.ok(shell.getStats().tabs.includes('overview'), 'the pinned tab survives Delete');
    press(planTab, 'Delete');
    assert.equal(shell.getStats().tabs.includes('plan:plan:shell'), false, 'Delete closes the focused closable tab');

    const first = destinationButton(shell, 'overview');
    first.focus();
    press(first, 'j');
    assert.equal(dom.document.activeElement, destinationButton(shell, 'project'), 'j walks down the sidebar destinations');
    press(dom.document.activeElement, 'k');
    assert.equal(dom.document.activeElement, first, 'k walks back up');
  } finally {
    detach.detach();
  }
});

test('tab state survives a reload-shaped remount through session storage', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell: first, state: firstState } = mountShell({ views });
  await settle();
  first.selectDestination('plans');
  first.openPlan('plan:shell');
  first.update();
  const before = first.getStats();
  assert.deepEqual(before.tabs, ['overview', 'plans', 'plan:plan:shell']);

  // A reload keeps the same origin storage; the shell remounts cold. The
  // prior instance tears down first — one shell per document.
  firstState.bundle = null; first.update(); first.element.remove();
  const reloaded = createProjectShell({ projectionProvider: () => overviewBundle(project), product: { name: 'LazyBuddy' }, views });
  dom.document.body.append(reloaded.element); mounted[0] = { state: { bundle: overviewBundle(project) }, shell: reloaded };
  await settle();
  const after = reloaded.getStats();
  assert.deepEqual(after.tabs, before.tabs, 'open tabs restore after the reload');
  assert.equal(after.activeTab, before.activeTab, 'the selected tab restores after the reload');
  assert.equal(after.activeDestination, 'plans', 'the sidebar current state restores with it');
});

test('polling refresh swaps the overview in place and never resets tabs, selection or the dock', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell, state } = mountShell({ views });
  await settle();
  shell.openPlan('plan:shell');
  const overviewBefore = shellRoot(shell).querySelector('[data-testid="overview-view"]');

  state.bundle = overviewBundle({ ...project, revision: 9 });
  shell.update();
  await settle();
  assert.equal(shell.getStats().tabs.join(), 'overview,plan:plan:shell', 'a new bundle object keeps every open tab');
  assert.equal(shell.getStats().activeTab, 'plan:plan:shell', 'the selected tab survives the refresh');
  assert.equal(destinationButton(shell, 'plans').getAttribute('aria-current'), 'page', 'the sidebar current state survives the refresh');
  const overviewAfter = shellRoot(shell).querySelector('[data-testid="overview-view"]');
  assert.notEqual(overviewAfter, overviewBefore, 'the overview view itself is the fresh projection');
  assert.match(shellRoot(shell).querySelector('[data-testid="shell-context"]').textContent, /revision 9/, 'the header context reflects the new revision');
  assert.ok(shellRoot(shell).querySelector('[data-testid="dock-panel"] [data-testid="overview-records"]'),
    'the docked records region re-adopts the fresh overview');
  assert.notEqual(shellRoot(shell).querySelector('[data-testid="dock-panel"] [data-testid="overview-records"]'), null);

  // Losing the record tears the frame down; regaining it rebuilds with the
  // persisted tabs (the stale_state adversarial: reload preserves tabs).
  state.bundle = null;
  shell.update();
  assert.equal(shell.getStats().initialized, false);
  state.bundle = overviewBundle(project);
  shell.update();
  await settle();
  assert.equal(shell.getStats().initialized, true);
  assert.deepEqual(shell.getStats().tabs, ['overview', 'plan:plan:shell'], 'the frame rebuild restores the persisted tabs');
});

test('rapid tab open/close loops stay consistent (cancel_resume)', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  for (let index = 0; index < 25; index += 1) {
    shell.openItem({ tabId: `plan:rapid-${index}`, title: `Rapid ${index}`, content: views.plans.element, enter: () => views.plans.open(`rapid-${index}`) });
    const close = tabNode(shell, `plan:rapid-${index}`).querySelector('.lb-tab-close');
    close.click();
  }
  assert.deepEqual(shell.getStats().tabs, ['overview'], 'every rapid tab closed back to the pinned base');
  assert.equal(shell.getStats().activeTab, 'overview');
  shell.openPlan('plan:shell');
  assert.deepEqual(shell.getStats().tabs, ['overview', 'plan:plan:shell'], 'open tabs after the loop are exact — no residue, no duplicates');
});
