// T12b project shell — the sidebar + tab app frame mounted across the real
// pages (the standalone shell page and the served dashboard). The frame
// renders ONLY after the service exposes an initialized project record
// (IO-2: the not-initialized dashboard stays byte-identical to its baseline).
// The T12 library carries the frame: sidebarNav (7 always-selectable
// destinations; a destination without data renders an explicit unavailable
// view, never a disabled control), createTabs (pinned Overview plus closable
// destination and item tabs — plan and evidence items open their own tab),
// and createDockPanel (the contextual inspector and the contributing-records
// region migrate into the right dock; dock opens on selection, Escape closes
// it and focus returns through the T11 overlay stack). The frame is built
// once per init transition; polling refreshes swap the overview view in
// place, so open tabs, the selected tab and the dock survive every update.
import { button, element, statusChip, sidebarNav, createTabs, createDockPanel } from './components.mjs';
import { createOverviewView } from './overview.mjs';

export const PROJECT_DESTINATIONS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'project', label: 'Project' },
  { id: 'plans', label: 'Plans' },
  { id: 'execution', label: 'Execution' },
  { id: 'git', label: 'Git' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'research', label: 'Research' },
]);

// Item tabs name their surface so the sidebar current state and
// getStats().activeDestination stay truthful while an item tab is open.
const ITEM_SURFACE = { plan: 'plans', evidence: 'evidence', research: 'research' };
const TABS_STORAGE_KEY = 'lazybuddy-shell-tabs';
const DESTINATION_OF = id => (PROJECT_DESTINATIONS.some(destination => destination.id === id) ? id : ITEM_SURFACE[String(id).split(':')[0]]);

function readStored(key) {
  try {
    const raw = globalThis.sessionStorage?.getItem?.(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch { return null; } // blocked or unavailable storage degrades to no persistence
}

function writeStored(key, value) {
  try { globalThis.sessionStorage?.setItem?.(key, JSON.stringify(value)); } catch { /* same degradation */ }
}

export function createProjectShell({ projectionProvider, product = { name: 'LazySeries' }, callbacks = {}, views = {} }) {
  if (typeof projectionProvider !== 'function') throw new TypeError('projectionProvider is required');
  const root = element('section', 'project-shell stack');
  root.dataset.testid = 'project-shell';
  root.dataset.live = String(Object.keys(views).length > 0);
  let activeDestination = 'overview';
  let overview = null;
  let bundle = null;
  let frame = null;
  let sidebar = null;
  let tabs = null;
  let dock = null;
  let dockTrigger = null;
  let dockInspectorRegion = null;
  let dockRecordsRegion = null;
  let contextSlot = null;
  let frameRestored = false;
  const tabHosts = new Map();
  const tabEnters = new Map();
  const tabTitles = new Map();

  const viewFor = id => id === 'overview' ? overview : views[id] ?? null;
  const plansOfBundle = () => (Array.isArray(bundle?.snapshot?.plans) ? bundle.snapshot.plans : []);

  function compactLiveOverview(node) {
    if (!Object.keys(views).length || !node || node.dataset.liveCompact === 'true') return;
    node.dataset.liveCompact = 'true';
    const details = element('details', 'panel overview-context stack');
    details.append(element('summary', '', 'Project context, coverage and attention'));
    const head = node.querySelector('.overview-head');
    const title = head?.querySelector('h2'); const subtitle = head?.querySelector('.meta');
    if (title) details.append(element('p', 'meta', title.textContent));
    if (subtitle) details.append(subtitle);
    title?.remove();
    const statement = node.querySelector('.overview-statement'); if (statement) details.append(statement);
    const statusHeading = node.querySelector('.overview-sentence h3');
    if (statusHeading) { node.querySelector('.overview-sentence')?.setAttribute('aria-label', statusHeading.textContent); details.append(statusHeading); }
    const unavailableClauses = [...node.querySelectorAll('.overview-clause-unavailable')];
    for (const clause of unavailableClauses.slice(1)) details.append(clause);
    const sentenceCoverage = node.querySelector('.overview-sentence > .meta'); if (sentenceCoverage) details.append(sentenceCoverage);
    const definitions = element('section', 'stack overview-definitions');
    definitions.append(element('h3', '', 'Metric definitions'));
    const metricsHeading = node.querySelector('.overview-metrics h3');
    if (metricsHeading) { node.querySelector('.overview-metrics')?.setAttribute('aria-label', metricsHeading.textContent); details.append(metricsHeading); }
    for (const metric of node.querySelectorAll('.overview-metric')) {
      const coverage = metric.querySelector('.meta'); const label = metric.querySelector('[data-metric-id]')?.textContent;
      if (coverage) { definitions.append(element('p', 'meta', `${label} · ${coverage.textContent}`)); coverage.remove(); }
    }
    const metricsNote = node.querySelector('.overview-metrics > .meta'); if (metricsNote) definitions.append(metricsNote);
    details.append(definitions);
    const metricCards = [...node.querySelectorAll('.overview-metric')];
    const compactMetric = new Map([
      ['metric:plans', 'Plans · active / future / history'],
      ['metric:active-progress', 'Delivery progress'],
      ['metric:baseline', 'Accepted baseline'],
      ['metric:unassigned', 'Unassigned requirements'],
    ]);
    for (const metric of metricCards.slice(0, 4)) {
      const control = metric.querySelector('[data-metric-id]');
      if (!control) continue;
      control.setAttribute('aria-label', control.textContent);
      const label = compactMetric.get(control.dataset.metricId);
      const original = control.textContent; const separator = original.indexOf(':');
      control.textContent = `${label ?? original.slice(0, separator)} · ${original.slice(separator + 1).trim()}`;
    }
    for (const metric of metricCards.slice(4)) details.append(metric);
    const queue = node.querySelector('.overview-queue'); if (queue) details.append(queue);
    const spikeHead = node.querySelector('.spike-head'); if (spikeHead) details.append(spikeHead);
    const legend = node.querySelector('.spike-legend');
    const toolbar = node.querySelector('.spike-toolbar');
    const layoutStatus = node.querySelector('.spike-status');
    if (layoutStatus && toolbar) toolbar.prepend(layoutStatus);
    if (legend && toolbar) {
      const legendDetails = element('details', 'spike-legend-details');
      legendDetails.append(element('summary', '', 'Edge legend'), legend); toolbar.append(legendDetails);
    }
    node.append(details);
  }

  function renderUninitialized() {
    root.replaceChildren();
    root.dataset.initialized = 'false';
    const notice = element('div', 'panel notice stack');
    notice.dataset.testid = 'shell-uninitialized';
    notice.append(statusChip({ state: 'unavailable', label: 'No initialized project record' }),
      element('p', '', 'This service exposes no initialized project record, so the project destinations do not render. '
        + 'Project initialization stays explicit opt-in (IO-2); nothing here creates or mutates a registry.'));
    root.append(notice);
    callbacks.onStateChange?.({ initialized: false, destinations: [] });
  }

  function renderContextLine(fixture) {
    const context = element('p', 'meta shell-context cluster');
    context.dataset.testid = 'shell-context';
    const parts = [`${fixture.projection.repository_key} · ${fixture.projection.runtime}`];
    if (fixture.context) {
      parts.push(`branch ${fixture.context.branch ?? 'unknown'} @ ${(fixture.context.head ?? '').slice(0, 12) || 'head not reported'}`);
      if (fixture.context.observed_at) parts.push(`observed ${fixture.context.observed_at}`);
    }
    else parts.push('git observation: not projected');
    parts.push(`projection revision ${fixture.projection.revision} · baseline revision ${fixture.projection.baseline_revision}`);
    context.textContent = parts.join(' · ');
    return context;
  }

  function unavailablePanel(id) {
    const destination = PROJECT_DESTINATIONS.find(entry => entry.id === id);
    const detail = Object.keys(views).length
      ? `The ${destination?.label ?? id} destination view is not mounted in this shell instance; no data is projected for it here.`
      : `This shell is composed from a static projection bundle with no connected native project service, so the ${destination?.label ?? id} destination has no live projection to render.`;
    const panel = element('section', 'panel notice stack');
    panel.dataset.testid = 'shell-destination-unavailable';
    panel.dataset.destination = id;
    panel.append(statusChip({ state: 'unavailable', label: `${destination?.label ?? id} unavailable` }),
      element('p', 'meta', detail),
      element('p', 'meta', 'Nothing is inferred or fabricated in place of the missing projection (honesty rule).'));
    return panel;
  }

  function panelFor(tabId) {
    for (const panel of tabs.panels.children) if (panel.dataset.tabId === tabId) return panel;
    return null;
  }

  function ensureTabContent(tabId) {
    const host = tabHosts.get(tabId);
    const panel = panelFor(tabId);
    if (host && panel && host.parentNode !== panel) panel.replaceChildren(host);
  }

  function syncDestinationFromTab(tabId) {
    const destination = DESTINATION_OF(tabId);
    if (destination) activeDestination = destination;
    sidebar?.navigate(activeDestination);
  }

  function persistTabs() {
    // The bootstrap open of the pinned tab must not clobber the saved
    // session: persistence starts only after the frame restored its state.
    if (!tabs || !frameRestored) return;
    writeStored(TABS_STORAGE_KEY, { v: 1, collapsed: sidebar?.isCollapsed() ?? false,
      tabs: tabs.tabs().map(id => ({ id, title: tabTitles.get(id) ?? id })),
      active: tabs.getActive() });
  }

  function handleTabChange(tabId, kind) {
    if (kind === 'select') {
      ensureTabContent(tabId);
      syncDestinationFromTab(tabId);
      tabEnters.get(tabId)?.();
    }
    persistTabs();
  }

  // Cmd/Ctrl+1..7 selects the destination anywhere in the shell (the T11 map
  // extension). Focus inside the tab strip keeps the T12 component behavior
  // (Cmd/Ctrl+digit selects the nth tab) because that handler prevents the
  // default first and this listener refuses pre-consumed events.
  function handleDestinationShortcut(event) {
    if (event.defaultPrevented || !frame || frame.isConnected === false || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const match = /^Digit([1-9])$/.exec(event.code ?? '');
    if (!match) return;
    const destination = PROJECT_DESTINATIONS[Number(match[1]) - 1];
    if (!destination) return;
    event.preventDefault?.();
    selectDestination(destination.id);
    for (const control of sidebar.element.querySelectorAll('[data-destination]')) {
      if (control.dataset.destination === destination.id) control.focus?.();
    }
  }

  function openItem({ tabId, title, content, enter, select = true }) {
    if (!frame || tabId == null) return null;
    tabHosts.set(tabId, content ?? null);
    tabEnters.set(tabId, enter ?? null);
    tabTitles.set(tabId, String(title ?? tabId));
    if (!tabs.tabs().includes(tabId)) tabs.openTab({ id: tabId, title: tabTitles.get(tabId) });
    if (select) tabs.select(tabId);
    else ensureTabContent(tabId);
    return tabId;
  }

  function openDestinationTab(id, { select = true } = {}) {
    const view = viewFor(id);
    const content = view ? (view.element ?? view) : unavailablePanel(id);
    tabHosts.set(id, content);
    tabEnters.set(id, () => view?.activate?.());
    tabTitles.set(id, PROJECT_DESTINATIONS.find(destination => destination.id === id)?.label ?? id);
    if (!tabs.tabs().includes(id)) tabs.openTab({ id, title: tabTitles.get(id) });
    if (select) tabs.select(id);
    else ensureTabContent(id);
    return id;
  }

  function openPlan(planId, { select = true } = {}) {
    const view = views.plans;
    if (!view) return select ? selectDestination('plans') : null; // no live plans surface: explicit unavailable state
    const plan = plansOfBundle().find(entry => entry.id === planId);
    return openItem({ tabId: `plan:${planId}`, title: `Plan · ${plan?.title ?? planId}`,
      content: view.element, enter: () => view.open(planId), select });
  }

  function restoreTabs() {
    const saved = readStored(TABS_STORAGE_KEY);
    frameRestored = true;
    if (!Array.isArray(saved?.tabs)) { selectDestination(activeDestination); persistTabs(); return; }
    if (typeof saved.collapsed === 'boolean') sidebar.setCollapsed(saved.collapsed, { notify: false });
    for (const entry of saved.tabs) {
      if (!entry || typeof entry.id !== 'string' || entry.id === 'overview') continue;
      if (DESTINATION_OF(entry.id) === entry.id) openDestinationTab(entry.id, { select: false });
      else if (entry.id.startsWith('plan:')) openPlan(entry.id.slice('plan:'.length), { select: false });
      else if (entry.id.startsWith('evidence:') && views.evidence) {
        openItem({ tabId: entry.id, title: entry.title ?? entry.id, content: views.evidence.element,
          enter: () => views.evidence.activate?.(), select: false });
      }
    }
    if (typeof saved.active === 'string' && tabs.tabs().includes(saved.active)) tabs.select(saved.active);
    else selectDestination(activeDestination);
    persistTabs();
  }

  function adoptDockRegions(view) {
    const inspectorNode = view.element.querySelector('[data-testid="spike-inspector"]');
    if (inspectorNode) dockInspectorRegion.replaceChildren(inspectorNode);
    const recordsNode = view.element.querySelector('[data-testid="overview-records"]');
    if (recordsNode) dockRecordsRegion.replaceChildren(recordsNode);
  }

  function createOverview(next) {
    const nextOverview = createOverviewView({ bundle: next, callbacks: {
      onNodeSelect: event => {
        callbacks.onNodeSelect?.(event);
        const trigger = overview?.element?.contains?.(globalThis.document?.activeElement)
          ? globalThis.document.activeElement : null;
        dock?.open(trigger);
      },
      onNodeDrill: event => callbacks.onPlanDrill?.(event),
      onMapViewportChange: event => callbacks.onMapViewportChange?.(event),
      onRecordsOpened: event => {
        callbacks.onRecordsOpened?.(event);
        const trigger = overview?.element?.contains?.(globalThis.document?.activeElement)
          ? globalThis.document.activeElement : null;
        dock?.open(trigger);
      },
    } });
    compactLiveOverview(nextOverview.element);
    return nextOverview;
  }

  function renderHeader() {
    const header = element('header', 'shell-head stack');
    const identity = element('div', 'cluster spread');
    const title = element('h1', 'shell-title', bundle.project_name ?? bundle.snapshot.project_id);
    title.dataset.testid = 'shell-title';
    const badge = element('span', 'shell-product-badge');
    badge.dataset.testid = 'shell-product-badge';
    const identityChip = statusChip({ state: 'neutral', label: product.name });
    identityChip.dataset.identity = 'product'; badge.append(identityChip);
    identity.append(title, badge);
    contextSlot = element('div', 'stack');
    dockTrigger = button('Inspector dock', () => {
      dock.toggle(dockTrigger);
      dockTrigger.setAttribute('aria-pressed', String(dock.isOpen()));
    });
    dockTrigger.dataset.testid = 'shell-dock-trigger';
    dockTrigger.setAttribute('aria-pressed', 'false');
    dockTrigger.setAttribute('aria-label', 'Toggle the contextual inspector dock');
    header.append(identity, contextSlot, dockTrigger);
    contextSlot.append(renderContextLine(overview.getFixture()));
    return header;
  }

  function buildFrame() {
    dockInspectorRegion = element('div', 'stack shell-dock-section');
    dockInspectorRegion.dataset.testid = 'dock-inspector-region';
    dockRecordsRegion = element('div', 'stack shell-dock-section');
    dockRecordsRegion.dataset.testid = 'dock-records-region';
    const dockBody = element('div', 'stack');
    dockBody.append(dockInspectorRegion, dockRecordsRegion);
    dock = createDockPanel({ title: 'Contextual inspector', content: dockBody,
      footer: element('p', 'meta', 'Escape collapses the dock; focus returns to the invoking control.'),
      onClose: () => dockTrigger?.setAttribute('aria-pressed', 'false') });

    sidebar = sidebarNav({ product: product.family ?? 'LazySeries', runtime: product.name,
      destinations: PROJECT_DESTINATIONS.map(({ id, label }) => ({ id, label })),
      current: activeDestination,
      footer: element('p', 'meta', 'Destinations project the record; authority stays with the runtime.'),
      onNavigate: id => selectDestination(id),
      onCollapse: () => persistTabs() });

    tabs = createTabs({ onChange: handleTabChange });
    const header = renderHeader();
    const main = element('div', 'lb-shell-main');
    main.append(header, tabs.element);
    frame = element('div', 'lb-shell');
    frame.dataset.testid = 'shell-frame';
    frame.append(sidebar.element, main);
    root.replaceChildren(frame, dock.element);
    root.dataset.initialized = 'true';
    tabs.openTab({ id: 'overview', title: 'Overview', pinned: true, content: overview.element });
    tabHosts.set('overview', overview.element);
    tabTitles.set('overview', 'Overview');
    adoptDockRegions(overview);
    restoreTabs();
    globalThis.document?.addEventListener?.('keydown', handleDestinationShortcut);
    callbacks.onStateChange?.({ initialized: true, destinations: PROJECT_DESTINATIONS.map(destination => destination.id) });
  }

  function teardownFrame() {
    globalThis.document?.removeEventListener?.('keydown', handleDestinationShortcut);
    frame = null; sidebar = null; tabs = null; dock = null; dockTrigger = null;
    contextSlot = null; dockInspectorRegion = null; dockRecordsRegion = null; frameRestored = false;
    tabHosts.clear(); tabEnters.clear(); tabTitles.clear();
  }

  function selectDestination(id) {
    if (!PROJECT_DESTINATIONS.some(destination => destination.id === id)) return false;
    activeDestination = id;
    if (!frame) return true; // remembered; the frame selects it when the record initializes
    openDestinationTab(id);
    sidebar.navigate(id);
    callbacks.onDestinationChange?.({ destination: id });
    return true;
  }

  function refreshOverview() {
    // Polling-style refresh: preserve the focused object and view mode when a
    // new projection arrives; only the data changes, never the user's place —
    // and never the open tabs.
    const previous = overview?.getStats() ?? null;
    const next = createOverview(bundle);
    adoptDockRegions(next);
    const panel = panelFor('overview');
    if (panel) panel.replaceChildren(next.element);
    tabHosts.set('overview', next.element);
    overview = next;
    const title = root.querySelector('[data-testid="shell-title"]');
    if (title) title.textContent = bundle.project_name ?? bundle.snapshot.project_id;
    if (contextSlot) contextSlot.replaceChildren(renderContextLine(overview.getFixture()));
    if (previous?.map?.mode) overview.setMode(previous.map.mode);
    if (previous?.selectedNodeId) overview.select(previous.selectedNodeId);
  }

  function update() {
    const next = projectionProvider();
    if (next == null) {
      bundle = null;
      overview = null;
      teardownFrame();
      renderUninitialized();
      return;
    }
    const changed = bundle !== next;
    bundle = next;
    if (!overview) {
      overview = createOverview(bundle);
      buildFrame();
    } else if (changed) refreshOverview();
    for (const view of Object.values(views)) view?.update?.(bundle.snapshot ?? bundle);
  }

  update();
  return {
    element: root,
    update,
    selectDestination,
    openItem,
    openPlan,
    getStats() {
      const initialized = root.dataset.initialized === 'true';
      return {
        initialized,
        destinations: [...root.querySelectorAll('[data-destination]')].map(control => control.dataset.destination),
        activeDestination: initialized ? DESTINATION_OF(tabs?.getActive() ?? activeDestination) ?? activeDestination : null,
        tabs: initialized && tabs ? tabs.tabs() : [],
        activeTab: initialized && tabs ? tabs.getActive() : null,
        dockOpen: initialized && dock ? dock.isOpen() : false,
        overview: overview?.getStats() ?? null,
      };
    },
  };
}
