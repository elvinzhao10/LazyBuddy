import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* T20a app-shell proof: the static retractable sidebar + single content
   surface frame mounted on the real pages. Covers the tab-less composition
   (no tablist anywhere; a destination switch replaces the content in
   place), item navigation with the in-place capped back stack, the grouped
   sidebar with aria-current and the persisted icon-rail retraction
   (collapse control + Cmd/Ctrl+B), the dock migration of the inspector and
   contributing-records regions (open on selection, Escape with focus
   return), the explicit unavailable state for destinations without data,
   the unchanged pre-init composition (IO-2), the extended keyboard map
   (Cmd/Ctrl+1..7 destinations, j/k), navigation persistence across a
   reload-shaped remount, and polling refreshes that never reset the user's
   place.
   V2-T1 adds the compact icon top bar proof: one shell-rendered bar (product
   badge + truncating destination/item title, theme icon-toggle cycling
   light->dark->system persisted under 'lazyseries-theme', dock trigger icon,
   relocated rail collapse control), no <select>, no density control —
   density follows the collapsed rail automatically. */

const dom = createMiniDom();
globalThis.document = dom.document;

const { createProjectShell, PROJECT_DESTINATIONS } = await import('../ui/project-shell.mjs');
const { installFocusSystem } = await import('../ui/components.mjs');
const { overviewBundle } = await import('../ui/live-project-adapter.mjs');

// In-memory sessionStorage stand-in: the shell persists its navigation
// state under 'lazybuddy-shell-nav' and must degrade silently when storage
// is absent.
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
const press = (target, key, extra = {}) => target.dispatchEvent({ type: 'keydown', key, bubbles: true, cancelable: true, ...extra });
const stored = () => { const raw = storage.get('lazybuddy-shell-nav'); return raw ? JSON.parse(raw) : null; };

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

// A surface with a shell-level leave guard (the T20 navigation guard): dirty
// state is synchronous, confirmation settles a promise through the FO-3
// dialog pattern. Drafts live outside the guard, exactly like editor drafts.
function stubGuardedView() {
  const element = document.createElement('section');
  element.dataset.testid = 'guarded-surface';
  let dirty = false;
  let asked = 0;
  const view = {
    element,
    update() {},
    draft() { dirty = true; },
    needsLeaveGuard: () => dirty,
    confirmLeave() {
      asked += 1;
      return new Promise(resolve => {
        view.__settle = proceed => { view.__settle = null; if (proceed) dirty = false; resolve(proceed); };
      });
    },
    asked: () => asked,
    settle: proceed => view.__settle?.(proceed),
    isDirty: () => dirty,
  };
  return view;
}

test('pre-init stays the IO-2 baseline: no frame, the same self-explaining notice', async () => {
  storage.clear();
  const { shell } = mountShell({ bundle: null });
  await settle();
  const root = shellRoot(shell);
  assert.equal(root.dataset.initialized, 'false');
  assert.equal(root.querySelectorAll('[data-destination]').length, 0, 'no destinations before init');
  assert.equal(root.querySelector('.lb-sidebar'), null, 'no sidebar rail before init');
  assert.equal(root.querySelector('[role="tablist"], .lb-tabs, .lb-tab'), null, 'no tab strip before init');
  assert.equal(root.querySelector('[data-testid="shell-page-head"]'), null, 'no page header before init');
  assert.equal(root.querySelector('[data-testid="dock-panel"]'), null, 'no dock before init');
  const notice = root.querySelector('[data-testid="shell-uninitialized"]');
  assert.ok(notice, 'the pre-init notice renders');
  assert.equal(notice.querySelectorAll('.status')[0].dataset.state, 'unavailable');
  assert.equal(notice.querySelectorAll('p')[0].textContent,
    'This service exposes no initialized project record, so the project destinations do not render. '
    + 'Project initialization stays explicit opt-in (IO-2); nothing here creates or mutates a registry.',
    'the pre-init explanation stays byte-identical to the baseline');
});

test('the frame mounts after init: grouped static sidebar, one content surface, no tab strip, hidden dock', async () => {
  storage.clear();
  const { shell } = mountShell();
  await settle();
  const root = shellRoot(shell);
  assert.equal(root.dataset.initialized, 'true');
  const destinations = [...root.querySelectorAll('[data-destination]')];
  assert.equal(destinations.length, PROJECT_DESTINATIONS.length, 'all seven sidebar destinations render');
  assert.ok(destinations.every(control => !control.disabled), 'every destination is selectable; missing data never disables a control');
  assert.deepEqual(destinations.map(control => control.dataset.destination), PROJECT_DESTINATIONS.map(entry => entry.id));
  const groups = [...root.querySelectorAll('.lb-sidebar-group-label')];
  assert.deepEqual(groups.map(node => node.textContent), ['Workspace', 'Observation'], 'destinations group under section headers');
  assert.deepEqual([...root.querySelectorAll('.lb-sidebar-group')].map(node => node.querySelectorAll('[data-destination]').length),
    [3, 4], 'Workspace carries overview/project/plans; Observation carries the four observation rows');
  assert.equal(destinationButton(shell, 'overview').getAttribute('aria-current'), 'page', 'the sidebar marks the current destination');
  assert.ok(destinationButton(shell, 'overview').querySelector('svg'), 'rows are icon+label');
  // T20-RF count badges: the projection feeds the plans count; the empty
  // attention queue renders NO badge (never fake, never stale).
  assert.equal(destinationButton(shell, 'plans').querySelector('.lb-sidebar-badge')?.textContent, '1',
    'the projection plan count badges the Plans row');
  assert.equal(destinationButton(shell, 'overview').querySelector('.lb-sidebar-badge'), null,
    'an empty attention queue renders no badge');
  assert.equal(destinationButton(shell, 'plans').getAttribute('aria-label'), 'Plans (1)',
    'the count rides the accessible name too');
  assert.equal(root.querySelector('[role="tablist"], .lb-tabs, .lb-tab'), null, 'the tab strip is gone: no tablist anywhere');
  assert.ok(root.querySelector('[data-testid="shell-page-head"]'), 'the single page header renders');
  assert.equal(root.querySelector('[data-testid="shell-page-title"]').textContent, 'Overview', 'the page header names the destination');
  assert.equal(root.querySelector('[data-testid="shell-back"]'), null, 'no back affordance at the base of the stack');
  assert.equal(root.querySelector('[data-testid="shell-title"]').textContent, 'project:shell', 'the project name leads the context meta');
  assert.match(root.querySelector('[data-testid="shell-context"]').textContent, /branch main @ b{12}/, 'worktree context in the header');
  assert.ok(root.querySelector('[data-testid="shell-content"] [data-testid="overview-view"]'), 'the overview renders inside the single content region');
  assert.equal(root.querySelector('[data-testid="shell-content"]').children.length, 1, 'exactly one mounted surface');
  assert.equal(root.querySelectorAll('h1').length, 1, 'exactly one h1 (the page title)');
  const dock = root.querySelector('[data-testid="dock-panel"]');
  assert.ok(dock, 'the dock renders as part of the frame');
  assert.equal(dock.hidden, true, 'the dock starts closed');
  assert.ok(root.querySelector('[data-testid="dock-inspector-region"]'), 'the inspector region lives in the dock');
  assert.ok(root.querySelector('[data-testid="dock-records-region"]'), 'the contributing-records region lives in the dock');
  const records = root.querySelector('[data-testid="overview-records"]');
  assert.ok(records, 'the overview records panel exists');
  assert.equal(root.querySelector('[data-testid="dock-panel"] [data-testid="overview-records"]'), records,
    'the records region migrated into the dock, not inline');
  assert.equal(root.querySelector('[data-testid="overview-view"] [data-testid="overview-records"]'), null,
    'no inline contributing-records region remains in the overview');
  assert.ok(root.querySelector('.lb-sidebar-footer .lb-sidebar-product'), 'the product badge lives in the identity footer');
});

// V2-T1: the stacked header collapses into ONE compact icon top bar rendered
// by the shell itself — product badge + the current destination/item title
// (single truncating line) on the left, theme icon-toggle / dock trigger /
// rail collapse control on the right. No <select>, no density control.
test('the V2-T1 compact icon top bar replaces the stacked header', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  const root = shellRoot(shell);
  const bar = root.querySelector('[data-testid="shell-topbar"]');
  assert.ok(bar, 'the top bar renders as part of the shell');
  assert.equal(root.querySelectorAll('.lb-topbar').length, 1, 'exactly one bar, rendered by the shell (not the host page)');
  assert.ok(bar.querySelector('.lb-topbar-badge'), 'the product badge leads the bar');
  assert.equal(bar.querySelector('[data-testid="shell-bar-title"]').textContent, 'Overview',
    'the bar title names the current destination');
  assert.match(bar.querySelector('[data-testid="shell-bar-title"]').className, /lb-topbar-title/, 'the title is the single truncating line');
  const toggle = bar.querySelector('[data-testid="shell-theme-toggle"]');
  assert.ok(toggle, 'the theme icon-toggle renders in the bar');
  assert.equal(toggle.tagName, 'BUTTON', 'the toggle is a button, not a select');
  assert.equal(bar.querySelector('select'), null, 'no <select> anywhere in the bar');
  assert.ok(toggle.querySelector('svg'), 'the toggle carries its glyph');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true', 'aria-pressed reflects the resolved dark default');
  const dockTriggerInBar = bar.querySelector('[data-testid="shell-dock-trigger"]');
  assert.ok(dockTriggerInBar, 'the dock trigger icon renders in the bar');
  assert.equal(root.querySelector('.lb-shell [data-testid="shell-dock-trigger"]'), null, 'the page head no longer carries the dock trigger');
  const collapse = bar.querySelector('[data-testid="shell-collapse"]');
  assert.ok(collapse, 'the rail collapse control is relocated into the bar');
  assert.equal(root.querySelector('.lb-sidebar .lb-sidebar-collapse'), null, 'the rail itself carries no collapse control');
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.equal(root.querySelectorAll('[aria-label="Density"]').length, 0, 'no density segmented control mounts anywhere in the shell');

  shell.selectDestination('plans');
  shell.openPlan('plan:shell');
  assert.equal(bar.querySelector('[data-testid="shell-bar-title"]').textContent, 'Plan · Shell frame plan',
    'the bar title follows the open item');
  shell.selectDestination('evidence');
  assert.equal(bar.querySelector('[data-testid="shell-bar-title"]').textContent, 'Evidence',
    'the bar title follows the destination');
});

test('the theme icon-toggle cycles light -> dark -> system and persists under lazyseries-theme (stale_state)', async () => {
  const themeStorage = new Map();
  globalThis.localStorage = {
    getItem: key => (themeStorage.has(key) ? themeStorage.get(key) : null),
    setItem: (key, value) => themeStorage.set(key, String(value)),
  };
  try {
    storage.clear();
    const { shell } = mountShell();
    await settle();
    const toggle = shellRoot(shell).querySelector('[data-testid="shell-theme-toggle"]');
    assert.equal(toggle.dataset.mode, 'dark', 'the stored-preference-free default is dark (dark-first)');
    assert.equal(dom.document.documentElement.dataset.theme, 'dark');
    toggle.click();
    assert.equal(toggle.dataset.mode, 'system', 'dark cycles to system');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true', 'system resolves dark without a matchMedia (dark-first fallback)');
    assert.equal(dom.document.documentElement.dataset.theme, 'dark');
    toggle.click();
    assert.equal(toggle.dataset.mode, 'light', 'system cycles to light');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(dom.document.documentElement.dataset.theme, 'light');
    toggle.click();
    assert.equal(toggle.dataset.mode, 'dark');
    assert.deepEqual([...themeStorage.entries()].at(-1), ['lazyseries-theme', 'dark'], 'every change persists');

    // Reload-shaped remount (stale_state): the stored preference wins at creation.
    const { shell: reloaded } = mountShell();
    await settle();
    const reloadedToggle = shellRoot(reloaded).querySelector('[data-testid="shell-theme-toggle"]');
    assert.equal(reloadedToggle.dataset.mode, 'dark', 'the stored theme is honored on the next mount');
    assert.equal(reloadedToggle.getAttribute('aria-label'), 'Theme: dark');
  } finally {
    delete globalThis.localStorage;
  }
});

test('density follows the collapsed rail automatically; no user density setting persists', async () => {
  storage.clear();
  const { shell } = mountShell();
  await settle();
  const root = dom.document.documentElement;
  assert.equal(root.dataset.density, 'regular', 'the expanded rail keeps regular density');
  dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
  assert.equal(shellRoot(shell).querySelector('.lb-sidebar').dataset.collapsed, 'true');
  assert.equal(root.dataset.density, 'compact', 'the retracted rail switches the internal density token state');
  assert.equal(JSON.parse(storage.get('lazybuddy-shell-nav')).collapsed, true,
    'the collapse persists with the navigation state');
  dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
  assert.equal(root.dataset.density, 'regular', 'expanding restores regular');
});

test('a destination switch replaces the content in place (unmount the previous surface)', async () => {
  storage.clear();
  const { shell } = mountShell();
  await settle();
  assert.ok(shellRoot(shell).querySelector('[data-testid="overview-view"]'), 'the overview mounts first');

  assert.equal(shell.selectDestination('project'), true, 'the destination is selectable without live views');
  const unavailable = shellRoot(shell).querySelector('[data-testid="shell-destination-unavailable"]');
  assert.ok(unavailable, 'the unavailable state renders');
  assert.equal(unavailable.dataset.destination, 'project');
  assert.equal(unavailable.querySelectorAll('.status')[0].dataset.state, 'unavailable');
  assert.match(unavailable.textContent, /static projection bundle/, 'the explanation names the actual reason');
  assert.equal(shellRoot(shell).querySelector('[data-testid="overview-view"]'), null, 'the overview surface unmounted');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-content"]').contains(unavailable), true, 'the replacement renders in the content region');
  assert.equal(shell.getStats().activeDestination, 'project');
  assert.equal(destinationButton(shell, 'project').getAttribute('aria-current'), 'page', 'the sidebar current state follows the selection');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-page-title"]').textContent, 'Project', 'the page header follows the destination');

  shell.selectDestination('overview');
  assert.ok(shellRoot(shell).querySelector('[data-testid="overview-view"]'), 'switching back remounts the overview');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-destination-unavailable"]'), null, 'the unavailable panel unmounted');
  const back = shellRoot(shell).querySelector('[data-testid="shell-back"]');
  assert.ok(back, 'a navigation history exists');
  assert.equal(back.getAttribute('aria-label'), 'Back to Project');
  back.click();
  assert.equal(shell.getStats().activeDestination, 'project', 'back returns to the previous destination');
  assert.ok(shellRoot(shell).querySelector('[data-testid="shell-destination-unavailable"]'), 're-entering re-renders the unavailable state');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-back"]').getAttribute('aria-label'), 'Back to Overview', 'one entry remains on the stack');
  shellRoot(shell).querySelector('[data-testid="shell-back"]').click();
  assert.equal(shell.getStats().activeDestination, 'overview');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-back"]'), null, 'the stack emptied: no back affordance');
});

test('item navigation opens in place with a back affordance over the capped history stack', async () => {
  storage.clear();
  const { opened, views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  shell.selectDestination('plans');
  shell.openPlan('plan:shell');
  assert.deepEqual(opened, ['plan:shell'], 'opening focuses the plan in the plans surface');
  assert.equal(shell.getStats().location.destination, 'plans');
  assert.equal(shell.getStats().location.item, 'plan:plan:shell', 'the location names the open item');
  assert.equal(shell.getStats().activeDestination, 'plans', 'an open item keeps the destination truthful');
  assert.equal(destinationButton(shell, 'plans').getAttribute('aria-current'), 'page');
  assert.ok(views.plans.element.parentNode, 'the plans surface is mounted in the content region');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-page-title"]').textContent, 'Plan · Shell frame plan', 'the page header carries the item title');
  assert.equal(shellRoot(shell).querySelector('.shell-page-kicker').textContent, 'Plans', 'the destination stays visible as the kicker');
  assert.match(shellRoot(shell).querySelector('[data-testid="shell-page-meta"]').textContent, /active · source current · plan revision 1/);
  const back = shellRoot(shell).querySelector('[data-testid="shell-back"]');
  assert.ok(back, 'the item context exposes the back affordance');
  assert.equal(back.getAttribute('aria-label'), 'Back to Plans');

  shell.selectDestination('overview');
  assert.equal(views.plans.element.parentNode, null, 'the plans surface unmounts when another destination replaces the content');
  shell.openPlan('plan:shell');
  assert.deepEqual(opened, ['plan:shell', 'plan:shell'], 're-opening the item re-enters the plan');
  shell.openPlan('plan:shell');
  assert.deepEqual(opened, ['plan:shell', 'plan:shell', 'plan:shell'], 're-navigating to the open location only re-enters it');
  assert.equal(shell.getStats().historyDepth, 4, 'the stack holds overview -> plans -> item -> overview; the repeat added nothing');
  shell.goBack();
  assert.deepEqual(shell.getStats().location, { destination: 'overview', item: null }, 'back returns to the previous location');
  shell.goBack();
  assert.equal(shell.getStats().location.item, 'plan:plan:shell', 'back walks to the plan item');
  shell.goBack();
  assert.equal(shell.getStats().location.item, null, 'back walks to the bare plans destination');
  shell.goBack();
  assert.equal(shell.getStats().activeDestination, 'overview', 'back walks to the overview');
  assert.equal(dom.document.activeElement, destinationButton(shell, 'overview'), 'focus lands on the destination row when no back remains');

  // The stack is small and capped, never a tab set.
  for (let index = 0; index < 40; index += 1) shell.openItem({ id: `plan:p${index}`, title: `P ${index}`, destination: 'plans', content: views.plans.element, enter: () => views.plans.open(`p${index}`) });
  assert.equal(shell.getStats().historyDepth, 24, 'the history depth caps at 24');
  let guard = 100;
  while (shell.getStats().historyDepth > 0 && guard > 0) { shell.goBack(); guard -= 1; }
  assert.equal(shell.getStats().historyDepth, 0);
  assert.ok(views.plans.element.parentNode, 'walking the whole stack lands on a mounted surface');
});

test('evidence items navigate in place and restore their surface on reload', async () => {
  storage.clear();
  const { opened, views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  shell.openItem({ id: 'evidence:research/live.md', title: 'Evidence · research/live.md', destination: 'evidence',
    content: views.evidence.element, enter: () => views.evidence.activate() });
  assert.deepEqual(opened, ['evidence:activate'], 'the item enter activates the evidence surface');
  assert.equal(shell.getStats().location.destination, 'evidence');
  assert.equal(destinationButton(shell, 'evidence').getAttribute('aria-current'), 'page');
  const persisted = stored();
  assert.deepEqual(persisted.location, { destination: 'evidence', item: { id: 'evidence:research/live.md', title: 'Evidence · research/live.md', meta: '' } },
    'the navigation state persists destination + item');
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
    assert.equal(dock.hidden, false, 'the page header trigger opens the dock');
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

test('keyboard map: Cmd/Ctrl+1..7 destinations, Cmd/Ctrl+B retracts the rail, j/k sidebar traversal', async () => {
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

    const rail = shellRoot(shell).querySelector('.lb-sidebar');
    assert.equal(rail.dataset.collapsed, 'false');
    assert.equal(destinationButton(shell, 'git').hasAttribute('title'), false, 'expanded rows show the visible label, no tooltip');
    dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
    assert.equal(rail.dataset.collapsed, 'true', 'Cmd/Ctrl+B retracts the sidebar to the icon rail');
    assert.equal(destinationButton(shell, 'git').getAttribute('title'), 'Git', 'rail rows carry their label as a tooltip while collapsed');
    assert.equal(stored().collapsed, true, 'the retraction persists with the navigation state');
    dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
    assert.equal(rail.dataset.collapsed, 'false', 'Cmd/Ctrl+B expands it again');
    dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', bubbles: true, cancelable: true });
    assert.equal(rail.dataset.collapsed, 'false', 'plain B never toggles the rail');

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

test('navigation state survives a reload-shaped remount through session storage (stale_state)', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell: first, state: firstState } = mountShell({ views });
  await settle();
  first.selectDestination('plans');
  first.openPlan('plan:shell');
  dom.document.dispatchEvent({ type: 'keydown', key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
  const before = first.getStats();
  assert.deepEqual(before.location, { destination: 'plans', item: 'plan:plan:shell' });
  assert.equal(before.historyDepth, 2);

  // A reload keeps the same origin storage; the shell remounts cold. The
  // prior instance tears down first — one shell per document. The reloaded
  // provider reads the mutable state so the NEXT mount's teardown can drop
  // its frame (and its document keydown listener) like every other shell.
  firstState.bundle = null; first.update(); first.element.remove();
  const reloadedState = { bundle: overviewBundle(project) };
  const reloaded = createProjectShell({ projectionProvider: () => reloadedState.bundle, product: { name: 'LazyBuddy' }, views });
  dom.document.body.append(reloaded.element); mounted[0] = { state: reloadedState, shell: reloaded };
  await settle();
  const after = reloaded.getStats();
  assert.deepEqual(after.location, before.location, 'destination and item restore after the reload');
  assert.equal(after.activeDestination, 'plans', 'the sidebar current state restores with it');
  assert.equal(reloaded.element.querySelector('.lb-sidebar').dataset.collapsed, 'true', 'the rail retraction restores');
  assert.ok(views.plans.element.parentNode, 'the plans surface is mounted again');
  assert.equal(reloaded.element.querySelector('[data-testid="shell-page-title"]').textContent, 'Plan · Shell frame plan');
  assert.equal(reloaded.element.querySelector('[data-testid="shell-content"]').children.length, 1, 'one surface, no residue');
});

test('polling refresh swaps the overview in place and never resets the location, the stack or the dock', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell, state } = mountShell({ views });
  await settle();
  const overviewBefore = shellRoot(shell).querySelector('[data-testid="overview-view"]');
  shell.openPlan('plan:shell');

  state.bundle = overviewBundle({ ...project, revision: 9 });
  shell.update();
  await settle();
  assert.equal(shell.getStats().location.item, 'plan:plan:shell', 'the open item survives the refresh');
  assert.equal(shell.getStats().activeDestination, 'plans', 'the destination survives the refresh');
  assert.ok(views.plans.element.parentNode, 'the plans surface remains the mounted content');
  assert.equal(shellRoot(shell).querySelector('[data-testid="overview-view"]'), null, 'the fresh overview stays parked until the destination is visited again');
  assert.match(shellRoot(shell).querySelector('[data-testid="shell-context"]').textContent, /revision 9/, 'the header context reflects the new revision');
  assert.ok(shellRoot(shell).querySelector('[data-testid="dock-panel"] [data-testid="overview-records"]'),
    'the docked records region re-adopts the fresh overview');
  shell.selectDestination('overview');
  const overviewAfter = shellRoot(shell).querySelector('[data-testid="overview-view"]');
  assert.ok(overviewAfter, 'visiting the destination mounts the fresh projection');
  assert.notEqual(overviewAfter, overviewBefore, 'the overview view itself is the fresh projection');
  shell.openPlan('plan:shell'); // the persisted location for the rebuild below

  // Losing the record tears the frame down; regaining it rebuilds with the
  // persisted location (the stale_state adversarial: reload preserves it).
  state.bundle = null;
  shell.update();
  assert.equal(shell.getStats().initialized, false);
  state.bundle = overviewBundle(project);
  shell.update();
  await settle();
  assert.equal(shell.getStats().initialized, true);
  assert.deepEqual(shell.getStats().location, { destination: 'plans', item: 'plan:plan:shell' }, 'the frame rebuild restores the persisted location');
  assert.equal(shell.getStats().historyDepth, 0, 'a cold rebuild starts a fresh back stack');
});

test('rapid navigation loops stay consistent: one surface, bounded stack (cancel_resume)', async () => {
  storage.clear();
  const { views } = stubViews();
  const { shell } = mountShell({ views });
  await settle();
  const content = () => shellRoot(shell).querySelector('[data-testid="shell-content"]');
  for (let index = 0; index < 25; index += 1) {
    shell.openItem({ id: `plan:rapid-${index}`, title: `Rapid ${index}`, destination: 'plans', content: views.plans.element, enter: () => views.plans.open(`rapid-${index}`) });
    assert.equal(content().children.length, 1, 'exactly one mounted surface at every step');
    shell.goBack();
    shell.selectDestination(index % 2 ? 'git' : 'evidence');
    shell.selectDestination('overview');
    assert.ok(shell.getStats().historyDepth <= 24, 'the stack stays capped through the loop');
  }
  assert.deepEqual(shell.getStats().location, { destination: 'overview', item: null }, 'the loop lands on the overview base');
  assert.ok(content().querySelector('[data-testid="overview-view"]'), 'the overview surface is mounted');
  shell.openPlan('plan:shell');
  assert.deepEqual(shell.getStats().location, { destination: 'plans', item: 'plan:plan:shell' }, 'navigation after the loop is exact — no residue, no duplicates');
});

test('a dirty surface guards in-place navigation: keep editing aborts, discard completes (T20)', async () => {
  storage.clear();
  const guarded = stubGuardedView();
  const { shell } = mountShell({ views: { project: guarded } });
  await settle();

  // Clean surface: navigation stays synchronous — no promise, no deferral.
  assert.equal(guarded.needsLeaveGuard(), false);
  shell.selectDestination('project');
  assert.equal(shell.getStats().activeDestination, 'project', 'a clean guarded surface navigates synchronously');
  shell.selectDestination('overview');
  assert.equal(shell.getStats().activeDestination, 'overview');

  // Dirty surface: a real sidebar row click asks first; the row marks itself
  // current on its own click, so the aborted navigation must restore it.
  shell.selectDestination('project');
  const depthBeforeGuard = shell.getStats().historyDepth;
  guarded.draft();
  destinationButton(shell, 'overview').click();
  await settle();
  assert.equal(shell.getStats().activeDestination, 'project', 'keep-editing-pending navigation never moved the surface');
  assert.equal(shell.getStats().historyDepth, depthBeforeGuard, 'no history entry is pushed while the guard is pending');
  assert.equal(guarded.asked(), 1, 'the guard asked exactly once');
  guarded.settle(false); // Keep editing
  await settle();
  assert.equal(shell.getStats().activeDestination, 'project', 'keep editing aborts the navigation in place');
  assert.equal(shell.getStats().historyDepth, depthBeforeGuard, 'keep editing changes nothing');
  assert.equal(guarded.isDirty(), true, 'keep editing preserves the dirty drafts (cancel_resume)');
  assert.equal(destinationButton(shell, 'project').getAttribute('aria-current'), 'page',
    'the sidebar still marks the dirty surface — the row that marked itself current on click is restored');
  assert.ok([null, ''].includes(destinationButton(shell, 'overview').getAttribute('aria-current')),
    'the abandoned destination row loses its premature current state');

  // A second leave attempt while dirty asks again; Discard completes it.
  destinationButton(shell, 'overview').click();
  await settle();
  assert.equal(guarded.asked(), 2, 'each leave attempt asks again — the first dialog never leaks');
  guarded.settle(true); // Discard
  await settle();
  assert.equal(shell.getStats().activeDestination, 'overview', 'discard completes the navigation');
  assert.equal(guarded.isDirty(), false, 'discard clears the surface drafts');
  assert.equal(shell.getStats().historyDepth, depthBeforeGuard + 1, 'the discard path pushes the left location onto the stack');
  assert.equal(shellRoot(shell).querySelector('[data-testid="shell-back"]').getAttribute('aria-label'), 'Back to Project');
});

test('the back affordance and the destination shortcut respect the same leave guard (T20)', async () => {
  storage.clear();
  const guarded = stubGuardedView();
  const { shell } = mountShell({ views: { project: guarded } });
  await settle();
  shell.selectDestination('project');
  assert.equal(shell.getStats().historyDepth, 1, 'overview sits under the project destination');

  // Dirty surface: back asks the same guard; the stack is not popped while
  // the dialog is pending and Keep editing pops nothing (cancel_resume).
  guarded.draft();
  shell.goBack();
  await settle();
  assert.equal(shell.getStats().activeDestination, 'project', 'back from a dirty surface holds while the guard is pending');
  assert.equal(shell.getStats().historyDepth, 1, 'the stack is not popped while the guard is pending');
  guarded.settle(false);
  await settle();
  assert.equal(shell.getStats().historyDepth, 1, 'keep editing pops nothing');
  assert.equal(guarded.isDirty(), true);

  shell.goBack();
  await settle();
  guarded.settle(true);
  await settle();
  assert.equal(shell.getStats().activeDestination, 'overview', 'discard lets the back navigation complete');
  assert.equal(shell.getStats().historyDepth, 0, 'the back pop happened exactly once');
  assert.equal(guarded.isDirty(), false);

  // The dirty leg again, now through the Cmd/Ctrl destination shortcut.
  shell.selectDestination('project');
  guarded.draft();
  dom.document.dispatchEvent({ type: 'keydown', key: '1', code: 'Digit1', metaKey: true, bubbles: true, cancelable: true });
  await settle();
  assert.equal(shell.getStats().activeDestination, 'project', 'the shortcut navigation holds while the guard is pending');
  assert.equal(shell.getStats().historyDepth, 1, 'nothing was pushed while the guard was pending');
  guarded.settle(true);
  await settle();
  assert.equal(shell.getStats().activeDestination, 'overview', 'discard lets the shortcut navigation complete');
  assert.equal(shell.getStats().historyDepth, 2, 'the discard path pushed the left location exactly once');
  assert.equal(guarded.isDirty(), false);
});
