// T20a project shell — the static retractable sidebar + single content
// surface mounted across the real pages (the standalone shell page and the
// served dashboard). The frame renders ONLY after the service exposes an
// initialized project record (IO-2: the not-initialized dashboard stays
// byte-identical to its baseline).
// The T12/T20a library carries the frame: sidebarNav (7 always-selectable
// destinations grouped under Workspace/Observation headers — a destination
// without data renders an explicit unavailable view, never a disabled
// control — static, never an overlay, retractable to the 56px icon rail,
// persisted, with a Cmd/Ctrl+B shortcut and identity footer) and
// createDockPanel (the contextual inspector and the contributing-records
// region migrate into the right dock; dock opens on selection, Escape
// closes it and focus returns through the T11 overlay stack).
// There is NO tab strip: selecting a destination replaces the content in
// place; item navigation (plans, evidence artifacts) navigates in place
// too, with a back affordance in the page header over a small capped
// in-place history stack. Session persistence stores the navigation state
// (destination + optional item) and restores it on reload. The frame is
// built once per init transition; polling refreshes swap the overview view
// in place, so the location, the back stack and the dock survive updates.
import { button, element, statusChip, sidebarNav, createDockPanel } from './components.mjs';
import { createOverviewView } from './overview.mjs';

export const PROJECT_DESTINATIONS = Object.freeze([
  { id: 'overview', label: 'Overview', group: 'Workspace' },
  { id: 'project', label: 'Project', group: 'Workspace' },
  { id: 'plans', label: 'Plans', group: 'Workspace' },
  { id: 'execution', label: 'Execution', group: 'Observation' },
  { id: 'git', label: 'Git', group: 'Observation' },
  { id: 'evidence', label: 'Evidence', group: 'Observation' },
  { id: 'research', label: 'Research', group: 'Observation' },
]);

// Item locations name their surface so the sidebar current state and
// getStats().activeDestination stay truthful while an item is open.
const ITEM_SURFACE = { plan: 'plans', evidence: 'evidence', research: 'research' };
const NAV_STORAGE_KEY = 'lazybuddy-shell-nav';
const HISTORY_LIMIT = 24; // the in-place back stack is small by design — not tabs
const DESTINATION_OF = id => (PROJECT_DESTINATIONS.some(destination => destination.id === id) ? id : ITEM_SURFACE[String(id).split(':')[0]]);
const DESTINATION_LABEL = id => PROJECT_DESTINATIONS.find(destination => destination.id === id)?.label ?? id;

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
  let activeDestination = 'overview'; // remembered while no frame exists; the frame selects it on init
  let location = null; // { destination, item: { id, title, meta, content, enter } | null }
  const history = []; // capped in-place back stack (previous locations, oldest first)
  let overview = null;
  let bundle = null;
  let frame = null;
  let sidebar = null;
  let dock = null;
  let dockTrigger = null;
  let dockInspectorRegion = null;
  let dockRecordsRegion = null;
  let footerControlsHost = null;
  let pageHead = null;
  let contentRegion = null;
  let frameRestored = false;
  let themeHome = null; // where the adopted #theme control returns when the frame tears down

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
        + 'Project initialization stays explicit opt-in (IO-2); nothing here creates or mutates a registry.'),
      );
    root.append(notice);
    callbacks.onStateChange?.({ initialized: false, destinations: [] });
  }

  function renderContextLine(fixture) {
    const context = element('p', 'meta shell-context cluster');
    context.dataset.testid = 'shell-context';
    const name = element('strong', '', bundle.project_name ?? bundle.snapshot.project_id);
    name.dataset.testid = 'shell-title';
    context.append(name, document.createTextNode(` · ${fixture.projection.repository_key} · ${fixture.projection.runtime}`));
    if (fixture.context) {
      context.append(document.createTextNode(` · branch ${fixture.context.branch ?? 'unknown'} @ ${(fixture.context.head ?? '').slice(0, 12) || 'head not reported'}`));
      if (fixture.context.observed_at) context.append(document.createTextNode(` · observed ${fixture.context.observed_at}`));
    }
    else context.append(document.createTextNode(' · git observation: not projected'));
    context.append(document.createTextNode(` · projection revision ${fixture.projection.revision} · baseline revision ${fixture.projection.baseline_revision}`));
    return context;
  }

  function unavailablePanel(id) {
    const detail = Object.keys(views).length
      ? `The ${DESTINATION_LABEL(id)} destination view is not mounted in this shell instance; no data is projected for it here.`
      : `This shell is composed from a static projection bundle with no connected native project service, so the ${DESTINATION_LABEL(id)} destination has no live projection to render.`;
    const panel = element('section', 'panel notice stack');
    panel.dataset.testid = 'shell-destination-unavailable';
    panel.dataset.destination = id;
    panel.append(statusChip({ state: 'unavailable', label: `${DESTINATION_LABEL(id)} unavailable` }),
      element('p', 'meta', detail),
      element('p', 'meta', 'Nothing is inferred or fabricated in place of the missing projection (honesty rule).'),
      );
    return panel;
  }

  // -- Navigation: one location, replaced in place, with a capped back stack --

  function surfaceFor(current) {
    if (current.item) return current.item.content ?? viewFor(current.destination)?.element ?? unavailablePanel(current.destination);
    return viewFor(current.destination)?.element ?? unavailablePanel(current.destination);
  }

  function renderPageHead() {
    if (!pageHead) return;
    const label = DESTINATION_LABEL(location.destination);
    const inItem = Boolean(location.item);
    pageHead.replaceChildren();
    const lead = element('div', 'cluster shell-page-lead');
    if (history.length > 0) {
      const previous = history[history.length - 1];
      const previousLabel = previous.item ? previous.item.title : DESTINATION_LABEL(previous.destination);
      const back = button('Back', () => goBack());
      back.dataset.testid = 'shell-back';
      back.setAttribute('aria-label', `Back to ${previousLabel}`);
      back.title = `Back to ${previousLabel}`;
      lead.append(back);
    }
    const titles = element('div', 'stack shell-page-titles');
    if (inItem) titles.append(element('p', 'shell-page-kicker meta', label));
    const title = element('h1', 'shell-page-title', inItem ? location.item.title : label);
    title.dataset.testid = 'shell-page-title';
    titles.append(title);
    if (inItem && location.item.meta) {
      const meta = element('p', 'meta shell-page-meta', location.item.meta);
      meta.dataset.testid = 'shell-page-meta';
      titles.append(meta);
    }
    lead.append(titles);
    const bar = element('div', 'cluster spread shell-page-bar');
    bar.append(lead);
    dockTrigger = button('Inspector dock', () => {
      dock.toggle(dockTrigger);
      dockTrigger.setAttribute('aria-pressed', String(dock.isOpen()));
    });
    dockTrigger.dataset.testid = 'shell-dock-trigger';
    dockTrigger.setAttribute('aria-pressed', 'false');
    dockTrigger.setAttribute('aria-label', 'Toggle the contextual inspector dock');
    bar.append(dockTrigger);
    pageHead.append(bar, renderContextLine(overview.getFixture()));
  }

  function renderLocation(next) {
    location = next;
    activeDestination = next.destination;
    renderPageHead();
    contentRegion.replaceChildren(surfaceFor(next));
    sidebar?.navigate(next.destination);
    if (next.item) next.item.enter?.();
    else viewFor(next.destination)?.activate?.();
    callbacks.onDestinationChange?.({ destination: next.destination, item: next.item?.id ?? null });
  }

  function sameLocation(left, right) {
    return left.destination === right.destination && (left.item?.id ?? null) === (right.item?.id ?? null);
  }

  function navigate(next, { push = true } = {}) {
    if (!frame) { activeDestination = next.destination; return; } // remembered; the frame selects it when the record initializes
    if (location && sameLocation(location, next)) {
      next.item?.enter?.(); // re-entering the open location refreshes it without history noise
      return;
    }
    if (push && location) {
      history.push(location);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    renderLocation(next);
    persistNav();
  }

  function selectDestination(id, { push = true } = {}) {
    if (!PROJECT_DESTINATIONS.some(destination => destination.id === id)) return false;
    navigate({ destination: id, item: null }, { push });
    return true;
  }

  function openItem({ id, title, meta = '', destination = null, content = null, enter = null, push = true }) {
    if (!frame || id == null) return null;
    const surface = destination ?? DESTINATION_OF(String(id));
    if (!PROJECT_DESTINATIONS.some(entry => entry.id === surface)) return null;
    navigate({ destination: surface, item: { id: String(id), title: String(title ?? id), meta: String(meta ?? ''), content, enter } }, { push });
    return String(id);
  }

  function openPlan(planId, { push = true } = {}) {
    const view = views.plans;
    if (!view) return push ? selectDestination('plans') : null; // no live plans surface: explicit unavailable state
    const plan = plansOfBundle().find(entry => entry.id === planId);
    openItem({
      id: `plan:${planId}`, title: `Plan · ${plan?.title ?? planId}`,
      meta: plan ? `${plan.declared_lifecycle} · source ${plan.source_freshness} · plan revision ${plan.revision}` : '',
      destination: 'plans', content: view.element, enter: () => view.open(planId), push,
    });
    return `plan:${planId}`;
  }

  function goBack() {
    if (!frame || history.length === 0) return false;
    renderLocation(history.pop());
    persistNav();
    // The affordance itself (or the destination row) keeps the focus after
    // the in-place swap; nothing else moves focus.
    const back = pageHead?.querySelector?.('[data-testid="shell-back"]');
    if (back) back.focus?.();
    else sidebar?.element?.querySelector?.(`[data-destination="${location.destination}"]`)?.focus?.();
    return true;
  }

  function persistNav() {
    // The bootstrap render must not clobber the saved session: persistence
    // starts only after the frame restored its state.
    if (!frame || !frameRestored) return;
    writeStored(NAV_STORAGE_KEY, { v: 1, collapsed: sidebar?.isCollapsed() ?? false,
      location: location ? { destination: location.destination, item: location.item
        ? { id: location.item.id, title: location.item.title, meta: location.item.meta ?? '' }
        : null } : null });
  }

  function restoreNav() {
    const saved = readStored(NAV_STORAGE_KEY);
    frameRestored = true;
    let restored = false;
    if (saved) {
      if (typeof saved.collapsed === 'boolean') sidebar.setCollapsed(saved.collapsed, { notify: false });
      const destination = saved.location?.destination;
      const item = saved.location?.item;
      if (PROJECT_DESTINATIONS.some(entry => entry.id === destination)) {
        if (item && typeof item.id === 'string') {
          if (String(item.id).startsWith('plan:')) restored = openPlan(String(item.id).slice('plan:'.length), { push: false }) != null;
          else if (views[destination]) {
            // A generic item restores its surface and re-activates it; the
            // item's own focus (e.g. the exact artifact row) is not
            // fabricated when it cannot be replayed honestly.
            openItem({ id: item.id, title: String(item.title ?? item.id), meta: item.meta ?? '',
              destination, content: views[destination].element,
              enter: () => views[destination].activate?.(), push: false });
            restored = true;
          }
        }
        if (!restored) { navigate({ destination, item: null }, { push: false }); restored = true; }
      }
    }
    if (!restored) navigate({ destination: 'overview', item: null }, { push: false });
    persistNav();
  }

  // Cmd/Ctrl+1..7 selects the destination anywhere in the shell; Cmd/Ctrl+B
  // retracts the sidebar to its icon rail (the T20a map extension). Both
  // defer to any handler that consumed the event first.
  function handleDestinationShortcut(event) {
    if (event.defaultPrevented || !frame || frame.isConnected === false || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.code === 'KeyB') {
      if (event.target?.isContentEditable) return; // never hijack a text editor's shortcut space
      event.preventDefault?.();
      sidebar.toggle();
      return;
    }
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

  function adoptDockRegions(view) {
    const inspectorNode = view.element.querySelector('[data-testid="spike-inspector"]');
    if (inspectorNode) dockInspectorRegion.replaceChildren(inspectorNode);
    const recordsNode = view.element.querySelector('[data-testid="overview-records"]');
    if (recordsNode) dockRecordsRegion.replaceChildren(recordsNode);
  }

  // T20-RF sidebar count badges: the projection feeds the attention queue
  // length onto Overview and the declared plan count onto Plans. Missing or
  // zero counts render NO badge (setCount removes it) — never fabricated.
  function syncSidebarCounts() {
    if (!sidebar) return;
    const attention = overview?.getFixture?.()?.attentionQueue;
    sidebar.setCount?.('overview', Array.isArray(attention) ? attention.length : 0);
    const plans = Number(bundle?.snapshot?.summary?.plan_count);
    sidebar.setCount?.('plans', Number.isFinite(plans) ? plans : 0);
  }

  // The page's theme control moves into the sidebar's identity footer while
  // the frame exists and returns home when the record is lost, so theme and
  // density always have exactly one home.
  function adoptThemeControl() {
    const select = globalThis.document?.querySelector?.('#theme');
    if (!select || !footerControlsHost || footerControlsHost.contains(select)) return;
    const label = typeof select.closest === 'function' ? select.closest('label') : null;
    const control = label ?? select;
    themeHome = { parent: control.parentNode, next: control.nextSibling ?? null };
    footerControlsHost.append(control);
  }

  function releaseThemeControl() {
    if (!themeHome) return;
    const select = footerControlsHost?.querySelector?.('#theme');
    const label = select && typeof select.closest === 'function' ? select.closest('label') : null;
    const control = label ?? select;
    if (control) {
      control.remove();
      if (themeHome.parent?.isConnected ?? false) themeHome.parent.insertBefore?.(control, themeHome.next?.isConnected ? themeHome.next : null);
    }
    themeHome = null;
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

    const groups = [];
    for (const destination of PROJECT_DESTINATIONS) {
      const group = groups.find(entry => entry.label === destination.group);
      if (group) group.destinations.push({ id: destination.id, label: destination.label });
      else groups.push({ label: destination.group, destinations: [{ id: destination.id, label: destination.label }] });
    }
    footerControlsHost = element('div', 'cluster shell-footer-controls');
    footerControlsHost.dataset.testid = 'shell-footer-controls';
    sidebar = sidebarNav({ product: product.family ?? 'LazySeries', runtime: product.name,
      groups, identityPosition: 'footer',
      current: activeDestination,
      footer: [footerControlsHost, element('p', 'meta shell-footer-note', 'Destinations project the record; authority stays with the runtime.')],
      onNavigate: id => selectDestination(id),
      onCollapse: () => persistNav() });

    pageHead = element('header', 'shell-page-head stack');
    pageHead.dataset.testid = 'shell-page-head';
    contentRegion = element('div', 'shell-content stack');
    contentRegion.dataset.testid = 'shell-content';
    const main = element('div', 'lb-shell-main');
    main.append(pageHead, contentRegion);
    frame = element('div', 'lb-shell');
    frame.dataset.testid = 'shell-frame';
    frame.append(sidebar.element, main);
    root.replaceChildren(frame, dock.element);
    root.dataset.initialized = 'true';
    adoptDockRegions(overview);
    adoptThemeControl();
    syncSidebarCounts();
    restoreNav();
    globalThis.document?.addEventListener?.('keydown', handleDestinationShortcut);
    callbacks.onStateChange?.({ initialized: true, destinations: PROJECT_DESTINATIONS.map(destination => destination.id) });
  }

  function teardownFrame() {
    globalThis.document?.removeEventListener?.('keydown', handleDestinationShortcut);
    releaseThemeControl();
    frame = null; sidebar = null; dock = null; dockTrigger = null;
    pageHead = null; contentRegion = null; footerControlsHost = null; frameRestored = false;
    location = null; history.length = 0;
  }

  function refreshOverview() {
    // Polling-style refresh: preserve the focused object and view mode when a
    // new projection arrives; only the data changes, never the user's place —
    // and never the location, the back stack or the dock.
    const previous = overview?.getStats() ?? null;
    const next = createOverview(bundle);
    adoptDockRegions(next);
    if (location?.destination === 'overview' && !location.item) contentRegion.replaceChildren(next.element);
    overview = next;
    renderPageHead(); // the context line carries the fresh projection identity
    syncSidebarCounts(); // count badges follow the fresh projection, never stale
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
    goBack,
    getStats() {
      const initialized = root.dataset.initialized === 'true';
      return {
        initialized,
        destinations: [...root.querySelectorAll('[data-destination]')].map(control => control.dataset.destination),
        activeDestination: initialized ? location?.destination ?? activeDestination : null,
        location: initialized && location ? { destination: location.destination, item: location.item?.id ?? null } : null,
        historyDepth: initialized ? history.length : 0,
        // Legacy tab-shaped fields kept for the frozen T14 proof
        // (test/overview.test.mjs reads them): the single surface reports
        // its location as the one-entry set.
        tabs: initialized && location ? [location.destination] : [],
        activeTab: initialized && location ? location.destination : null,
        dockOpen: initialized && dock ? dock.isOpen() : false,
        overview: overview?.getStats() ?? null,
      };
    },
  };
}
