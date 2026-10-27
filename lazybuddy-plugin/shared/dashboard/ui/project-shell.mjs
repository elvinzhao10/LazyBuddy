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
import { button, element, statusChip, sidebarNav, createDockPanel, createThemeToggle, sidebarActionIcon } from './components.mjs';
import { createOverviewView } from './overview.mjs';

export const PROJECT_DESTINATIONS = Object.freeze([
  { id: 'overview', label: 'Overview', group: 'Workspace' },
  { id: 'project', label: 'Project', group: 'Workspace' },
  { id: 'plans', label: 'Plans', group: 'Workspace' },
  { id: 'health', label: 'Health', group: 'Workspace' },
  { id: 'execution', label: 'Execution', group: 'Observation' },
  { id: 'git', label: 'Git', group: 'Observation' },
  { id: 'evidence', label: 'Evidence', group: 'Observation' },
  { id: 'research', label: 'Research', group: 'Observation' },
]);

// Item locations name their surface so the sidebar current state and
// getStats().activeDestination stay truthful while an item is open.
const ITEM_SURFACE = { plan: 'plans', evidence: 'evidence', research: 'research' };
const NAV_STORAGE_KEY = 'lazybuddy-shell-nav';
const DOCK_STORAGE_KEY = 'lazybuddy-shell-dock-open'; // V2-T4: dock open state, persisted per session
const HISTORY_LIMIT = 24; // the in-place back stack is small by design — not tabs
const DESTINATION_OF = id => (PROJECT_DESTINATIONS.some(destination => destination.id === id) ? id : ITEM_SURFACE[String(id).split(':')[0]]);
const DESTINATION_LABEL = id => PROJECT_DESTINATIONS.find(destination => destination.id === id)?.label ?? id;

// V2-T4 health destination glyph (Lucide activity/pulse geometry, ISC). The
// sidebar library's destination vocabulary lives in components.mjs (outside
// this task's owned changes), so the shell swaps the health row's fallback
// grid glyph for the pulse AFTER the rail mounts — the row keeps its label,
// tooltip and hit area exactly as the library builds them.
function pulseGlyph() {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const trace = document.createElementNS(icon.namespaceURI, 'path');
  trace.setAttribute('d', 'M22 12h-4l-3 9L9 3l-3 9H2');
  icon.append(trace);
  return icon;
}

// V2-T4 dock content refinement: the adopted inspector sections (Summary /
// Source / Changes / Evidence / Edges) become compact stacked blocks with
// icon headers. Pure re-markup of the adopted nodes at adopt time — the
// spike module keeps building its own structure; the dock chrome only
// decorates it.
const DOCK_BLOCK_ICONS = {
  summary: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  source: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  changes: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  evidence: ['m9 12 2 2 4-4', 'M21 12a9 9 0 1 1-9-9'],
  edges: ['M6 3v12', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
};
function dockBlockIcon(name) {
  const geometry = DOCK_BLOCK_ICONS[name];
  if (!geometry) return null;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  for (const spec of geometry) {
    const shape = document.createElementNS(icon.namespaceURI, 'path');
    shape.setAttribute('d', spec);
    icon.append(shape);
  }
  return icon;
}

function refineDockInspector(node) {
  if (!node || node.dataset.dockRefined === 'true') return;
  node.dataset.dockRefined = 'true';
  for (const section of [...node.querySelectorAll('section')]) {
    section.classList.add('shell-dock-block');
    const heading = section.querySelector('h4') ?? section.querySelector('h3') ?? section.querySelector('h2');
    const key = String(heading?.textContent ?? '').trim().toLowerCase();
    const icon = dockBlockIcon(key);
    if (heading && icon) heading.prepend(icon);
  }
}

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

export function createProjectShell({ projectionProvider, product = { name: 'LazySeries' }, callbacks = {}, views = {}, viewport = null, statusElement = null }) {
  if (typeof projectionProvider !== 'function') throw new TypeError('projectionProvider is required');
  // V2-T2 collapse state model. The reported regression: the <=48rem rail
  // retraction was CSS-only, invisible to the state model — at narrow widths
  // the control and Cmd/Ctrl+B flipped hidden state with no visual change
  // and persistence recorded the effective flip, desyncing reloads. The fix
  // separates the two inputs: `userCollapsed` is the explicit, persisted
  // choice; `narrowRetract` mirrors the <=48rem query. The rail shows the
  // OR of both, every state change re-syncs the top-bar control, and only
  // the user choice ever persists.
  const narrowQuery = viewport ?? (() => { try { return globalThis.matchMedia?.('(max-width: 48rem)') ?? null; } catch { return null; } })();
  const detailQuery = (() => { try { return globalThis.matchMedia?.('(max-width: 74.99rem)') ?? narrowQuery; } catch { return narrowQuery; } })();
  let userCollapsed = false;
  let narrowRetract = Boolean(narrowQuery?.matches);
  let narrowExpanded = false;
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
  let collapseControl = null; // the V2-T1 top-bar home of the rail collapse control
  let dockInspectorRegion = null;
  let dockRecordsRegion = null;
  let dockHelpRegion = null;
  let agentContext = null;
  let detailContext = null;
  let restoringOverview = false;
  let topBar = null;
  let barTitle = null;
  let pageHead = null;
  let contentRegion = null;
  let frameRestored = false;
  let suppressedThemeControl = null; // the host page #theme select hidden while the bar toggle owns theme

  const viewFor = id => id === 'overview' ? overview : views[id] ?? null;
  const plansOfBundle = () => (Array.isArray(bundle?.snapshot?.plans) ? bundle.snapshot.plans : []);

  // The effective rail state (user choice OR narrow auto-retract), applied
  // without a notify so it never masquerades as a user action; sidebarNav
  // re-syncs the top-bar control, the row tooltips and the root density.
  function applyRailState() {
    if (!sidebar) return;
    sidebar.setCollapsed(userCollapsed || (narrowRetract && !narrowExpanded), { notify: false });
  }

  // Live-shell overview compaction (T20, rebuilt for the T14 structure): with
  // destination views mounted, the overview's secondary context collapses into
  // one disclosure so the status sentence, the attention queue, the leading
  // metric tiles and the macro map lead the destination. Compaction only
  // re-parents nodes — every clause, tile and record control keeps its route.
  function compactLiveOverview(node) {
    if (!node) return;
    node.dataset.liveCompact = 'true';
    const details = node.querySelector('.overview-context') ?? element('details', 'panel overview-context stack');
    details.replaceChildren(element('summary', '', 'Project context, coverage and attention'));
    // The hero identity chips duplicate the shell header's context line
    // (project, repository, runtime, branch); they ride the disclosure.
    node.querySelector('.overview-hero-identity')?.remove();
    // The status sentence stays the primary visible read; its heading rides
    // the disclosure and the section keeps its accessible name.
    const statusSection = node.querySelector('.overview-hero-status');
    const statusHeading = statusSection?.querySelector('h3');
    if (statusHeading) {
      statusSection.setAttribute('aria-label', statusHeading.textContent);
      details.append(statusHeading);
    }
    // Beyond the first, unavailable clause chips ride the disclosure: the
    // first stays visible so the honest unprojected signal never disappears.
    const unavailableClauses = [...node.querySelectorAll('.overview-clause-note[data-unavailable="true"]')];
    const hasMonitor = Boolean(node.querySelector('.monitor-progress'));
    for (const clause of unavailableClauses.slice(hasMonitor ? 0 : 1)) details.append(clause);
    const hero = node.querySelector('.overview-hero');
    if (hero) hero.hidden = hasMonitor && !node.querySelector('.overview-sentence-line .overview-clause');
    // Metric tiles beyond the first four ride the disclosure in a tile grid
    // of their own; the buttons keep their contributing-records routes.
    const tiles = [...node.querySelectorAll('.overview-tile')];
    if (tiles.length > 4) {
      const contextTiles = element('div', 'overview-tiles');
      contextTiles.setAttribute('role', 'toolbar');
      contextTiles.setAttribute('aria-label', 'Further metrics — every total opens its contributing records');
      for (const tile of tiles.slice(4)) contextTiles.append(tile);
      details.append(contextTiles);
    }
    // Spike chrome: the layout status joins the toolbar; the legend folds
    // into its own disclosure inside the toolbar row.
    const toolbar = node.querySelector('.spike-toolbar');
    const layoutStatus = node.querySelector('.spike-status');
    if (layoutStatus && toolbar) toolbar.prepend(layoutStatus);
    const legend = node.querySelector('.spike-legend');
    if (legend && toolbar && !legend.parentNode?.classList.contains('spike-legend-details')) {
      const legendDetails = element('details', 'spike-legend-details');
      legendDetails.append(element('summary', '', 'Edge legend'), legend);
      toolbar.append(legendDetails);
    }
    node.append(details);
  }

  function renderUninitialized() {
    root.replaceChildren(buildTopBar(false));
    root.dataset.initialized = 'false';
    // V2-T8: the chrome-less pre-init bar carries the theme icon-toggle too,
    // so the legacy #theme select is suppressed from the moment the shell
    // mounts — exactly one visible theme home in every shell state. The
    // select stays the home only before the shell mounts (the pre-connect
    // login header), and releaseThemeControl on teardown restores it there.
    suppressThemeControl();
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
    const context = element('details', 'meta shell-context');
    context.dataset.testid = 'shell-context';
    const summary = element('summary', 'shell-context-summary');
    const name = element('strong', '', bundle.project_name ?? bundle.snapshot.project_id);
    name.dataset.testid = 'shell-title';
    summary.append(element('span', '', `${bundle.project_name ?? bundle.snapshot.project_id} · ${fixture.context?.branch ?? 'branch unavailable'} · revision ${fixture.projection.revision}`));
    context.append(summary);
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
    if (barTitle) barTitle.textContent = inItem ? location.item.title : label;
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
    pageHead.append(bar, renderContextLine(overview.getFixture()));
  }

  function renderLocation(next) {
    dock?.close('navigation');
    detailContext = null;
    syncDetailContent();
    location = next;
    activeDestination = next.destination;
    renderPageHead();
    contentRegion.replaceChildren(surfaceFor(next));
    const main = frame?.querySelector('.lb-shell-main');
    if (main) main.scrollTop = 0;
    sidebar?.navigate(next.destination);
    if (next.item) next.item.enter?.();
    else viewFor(next.destination)?.activate?.();
    callbacks.onDestinationChange?.({ destination: next.destination, item: next.item?.id ?? null });
  }

  function sameLocation(left, right) {
    return left.destination === right.destination && (left.item?.id ?? null) === (right.item?.id ?? null);
  }

  // T20 navigation guard: a mounted surface that reports unsaved work (the
  // project editor through needsLeaveGuard/confirmLeave) must confirm before
  // the single surface replaces it. Clean surfaces keep the synchronous fast
  // path, so navigation stays immediate unless a guard actually intervenes;
  // only one guarded navigation is ever pending (the dialog is modal).
  let pendingLeave = null;

  function leaveGuardOf() {
    if (!frame || !location || pendingLeave) return null;
    const view = viewFor(location.destination);
    if (view && typeof view.needsLeaveGuard === 'function' && view.needsLeaveGuard()
      && typeof view.confirmLeave === 'function') return view;
    return null;
  }

  function navigate(next, { push = true } = {}) {
    if (!frame) { activeDestination = next.destination; return; } // remembered; the frame selects it when the record initializes
    if (location && sameLocation(location, next)) {
      next.item?.enter?.(); // re-entering the open location refreshes it without history noise
      return;
    }
    const perform = () => {
      if (push && location) {
        history.push(location);
        if (history.length > HISTORY_LIMIT) history.shift();
      }
      renderLocation(next);
      persistNav();
    };
    const guard = leaveGuardOf();
    if (!guard) { perform(); return; }
    // The dirty surface asks first (Keep editing preserves every draft); the
    // navigation completes only on the explicit Discard.
    pendingLeave = next;
    void guard.confirmLeave({ trigger: globalThis.document?.activeElement ?? null })
      .then(proceed => {
        pendingLeave = null;
        if (proceed && frame) perform();
        // The sidebar row already marked itself current on its own click; an
        // aborted navigation restores the still-displayed destination.
        else if (frame) sidebar?.navigate(location?.destination ?? activeDestination);
      });
  }

  function selectDestination(id, { push = true } = {}) {
    if (!PROJECT_DESTINATIONS.some(destination => destination.id === id)) return false;
    if (id !== 'overview') overview?.closeExpandedMap?.();
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
    const perform = () => {
      renderLocation(history.pop());
      persistNav();
      // The affordance itself (or the destination row) keeps the focus after
      // the in-place swap; nothing else moves focus.
      const back = pageHead?.querySelector?.('[data-testid="shell-back"]');
      if (back) back.focus?.();
      else sidebar?.element?.querySelector?.(`[data-destination="${location.destination}"]`)?.focus?.();
    };
    const guard = leaveGuardOf();
    if (!guard) { perform(); return true; }
    // Back away from a dirty surface asks the same guard; the pop happens
    // only on the explicit Discard.
    pendingLeave = true;
    void guard.confirmLeave({ trigger: globalThis.document?.activeElement ?? null })
      .then(proceed => {
        pendingLeave = null;
        if (proceed && frame && history.length > 0) perform();
      });
    return true;
  }

  function persistNav() {
    // The bootstrap render must not clobber the saved session: persistence
    // starts only after the frame restored its state. V2-T2: only the USER's
    // explicit choice persists — the narrow auto-retract is a viewport fact,
    // never a stored preference (the restore/auto-retract desync).
    if (!frame || !frameRestored) return;
    writeStored(NAV_STORAGE_KEY, { v: 1, collapsed: userCollapsed,
      location: location ? { destination: location.destination, item: location.item
        ? { id: location.item.id, title: location.item.title, meta: location.item.meta ?? '' }
        : null } : null });
  }

  function restoreNav() {
    const saved = readStored(NAV_STORAGE_KEY);
    frameRestored = true;
    let restored = false;
    if (saved) {
      if (typeof saved.collapsed === 'boolean') userCollapsed = saved.collapsed;
      applyRailState();
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
    if (inspectorNode) { refineDockInspector(inspectorNode); dockInspectorRegion.replaceChildren(inspectorNode); }
    const recordsNode = view.element.querySelector('[data-testid="overview-records"]');
    if (recordsNode) dockRecordsRegion.replaceChildren(recordsNode);
  }

  // V2-T4: every dock open/close path (trigger click, Escape, selection
  // callbacks, session restore) lands here — the root data-dock-open drives
  // the narrow-only scrim and the trigger keeps its honest aria-pressed.
  function syncDockChrome() {
    const open = Boolean(dock?.isOpen?.());
    if (open) root.setAttribute('data-dock-open', 'true');
    else root.removeAttribute('data-dock-open');
    dockTrigger?.setAttribute('aria-pressed', String(open));
    dockTrigger?.setAttribute('aria-expanded', String(open));
    const modal = open && Boolean(detailQuery?.matches);
    dock?.setModal(modal);
    if (sidebar) sidebar.element.inert = modal;
    const main = frame?.querySelector('.lb-shell-main');
    if (main) main.inert = modal;
    if (topBar) topBar.inert = modal;
  }

  function syncDetailContent() {
    if (!dock) return;
    dockInspectorRegion.hidden = detailContext?.kind !== 'node';
    dockRecordsRegion.hidden = detailContext?.kind !== 'records';
    dockHelpRegion.hidden = Boolean(detailContext);
    dock.setTitle(detailContext?.title ? `Details · ${detailContext.title}` : 'Details');
    if (agentContext) agentContext.value = detailContext
      ? `Project: ${bundle.snapshot.project_id}\nRuntime: ${bundle.snapshot.runtime}\nProject revision: ${bundle.snapshot.revision}\nSelected: ${detailContext.id}\nTitle: ${detailContext.title}\nPlease inspect this item, its blockers and applicable evidence before proposing a change.` : '';
    const contextSection = agentContext?.parentNode?.parentNode;
    if (contextSection) contextSection.hidden = !detailContext;
    const copyFeedback = contextSection?.querySelector('[role="status"]');
    if (copyFeedback) copyFeedback.textContent = '';
  }

  function showDetails(context) {
    detailContext = context;
    syncDetailContent();
    if (restoringOverview) return;
    const trigger = overview?.element?.contains?.(globalThis.document?.activeElement) ? globalThis.document.activeElement : null;
    dock.open(trigger, { focus: Boolean(detailQuery?.matches) });
    if (context.kind === 'node' && !detailQuery?.matches) overview.focusNode(context.id);
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

  // V2-T1: while the frame exists, the top-bar theme icon-toggle is the one
  // appearance control. A host page that still carries a legacy #theme
  // select (the served dashboard header) has it hidden for the frame's
  // lifetime and restored when the record is lost — one home, either way.
  function suppressThemeControl() {
    // The attribute form (not '#theme') keeps the lookup testable under the
    // mini-dom harness; in a browser it selects the same node.
    const select = globalThis.document?.querySelector?.('[id="theme"]');
    if (!select) return;
    const control = typeof select.closest === 'function' ? select.closest('label') : null;
    const target = control ?? select;
    if (!target || target.hidden) return;
    target.hidden = true;
    suppressedThemeControl = target;
  }

  function releaseThemeControl() {
    if (suppressedThemeControl) suppressedThemeControl.hidden = false;
    suppressedThemeControl = null;
  }

  // The V2-T1 compact icon top bar (<= 48px): product badge + the current
  // destination/item title on one truncating line; theme icon-toggle, dock
  // trigger and the rail collapse control on the right. The chrome-less
  // pre-init variant keeps badge/title/theme only — no rail, no dock.
  function buildTopBar(withChrome) {
    const bar = element('header', 'lb-topbar');
    bar.dataset.testid = 'shell-topbar';
    const lead = element('div', 'cluster lb-topbar-lead');
    const badge = element('span', 'lb-topbar-badge', product.family ?? 'LazySeries');
    badge.dataset.product = product.name; // the per-product accent wash
    barTitle = element('span', 'lb-topbar-title');
    barTitle.dataset.testid = 'shell-bar-title';
    barTitle.textContent = withChrome ? DESTINATION_LABEL(activeDestination) : 'No initialized project';
    lead.append(badge, barTitle);
    if (statusElement) { statusElement.classList.add('shell-connection-status'); lead.append(statusElement); }
    const actions = element('div', 'cluster lb-topbar-actions');
    actions.append(createThemeToggle().element);
    if (withChrome) {
      dockTrigger = button('Details', () => { syncDetailContent(); dock.toggle(dockTrigger); });
      dockTrigger.className = 'lb-topbar-details';
      dockTrigger.dataset.testid = 'shell-dock-trigger';
      dockTrigger.setAttribute('aria-pressed', String(dock?.isOpen?.() ?? false));
      dockTrigger.setAttribute('aria-label', 'Details');
      dockTrigger.title = 'Show or hide details for the selected item';
      dockTrigger.prepend(sidebarActionIcon('dock'));
      collapseControl = button('', null); // sidebarNav wires the click to its toggle
      collapseControl.className = 'lb-topbar-icon lb-topbar-collapse';
      collapseControl.dataset.testid = 'shell-collapse';
      collapseControl.setAttribute('aria-label', 'Collapse sidebar');
      collapseControl.setAttribute('aria-expanded', 'true');
      collapseControl.append(sidebarActionIcon('collapse-left'));
      actions.append(dockTrigger);
    }
    bar.append(lead, actions);
    topBar = bar;
    return bar;
  }

  function createOverview(next) {
    const nextOverview = createOverviewView({ bundle: next, callbacks: {
      onNavigateDestination: destination => {
        selectDestination(destination);
        if (activeDestination === 'project') views.project?.openEditor?.();
      },
      onNodeSelect: event => {
        callbacks.onNodeSelect?.(event);
        if (restoringOverview && detailContext?.kind !== 'node') return;
        const fixture = nextOverview.getFixture();
        const node = fixture.nodes.flatMap(node => [node, ...(node.children ?? [])]).find(node => node.id === event.nodeId);
        showDetails({ kind: 'node', id: event.nodeId, title: node?.title ?? event.nodeId });
      },
      onNodeDrill: event => callbacks.onPlanDrill?.(event),
      onMapViewportChange: event => callbacks.onMapViewportChange?.(event),
      onRecordsOpened: event => {
        callbacks.onRecordsOpened?.(event);
        showDetails({ kind: 'records', id: event.id, title: event.title ?? event.id });
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
    dockHelpRegion = element('section', 'stack');
    dockHelpRegion.append(element('h3', '', 'Inspect without losing your place'),
      element('p', '', 'Select a graph item to see its status, source and dependencies. Select a metric or blocker to see the records behind it.'),
      element('p', 'meta', 'Use Open plan for requirements and linked runs. Copy agent context to discuss the selection in your existing chat. Changes and execution stay with your connected runtime.'));
    const contextSection = element('details', 'stack shell-agent-context');
    contextSection.append(element('summary', '', 'Discuss with your agent'));
    const label = element('label', 'stack', 'Context for your agent');
    agentContext = element('textarea'); agentContext.readOnly = true; agentContext.rows = 6;
    label.append(agentContext);
    const copyStatus = element('p', 'meta'); copyStatus.setAttribute('role', 'status');
    const copy = button('Copy agent context', async () => {
      try {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error('unavailable');
        await globalThis.navigator.clipboard.writeText(agentContext.value);
        copyStatus.textContent = 'Copied. Paste into your existing agent chat; nothing was sent.';
      } catch { copyStatus.textContent = 'Select and copy the context above, then paste it into your agent chat.'; agentContext.focus(); agentContext.select?.(); }
    });
    contextSection.append(label, copy, copyStatus);
    dockBody.append(dockHelpRegion, dockInspectorRegion, dockRecordsRegion, contextSection);
    dock = createDockPanel({ title: 'Details', content: dockBody, closeLabel: 'Close details', trapFocus: false,
      fallbackFocus: () => dockTrigger,
      description: 'Details for the selected item. Escape closes the panel and returns focus to its opener.',
      footer: element('p', 'meta', 'Select another item to compare. Esc closes details.'),
      persistKey: DOCK_STORAGE_KEY,
      onOpen: () => syncDockChrome(),
      onClose: () => syncDockChrome() });

    const groups = [];
    for (const destination of PROJECT_DESTINATIONS) {
      const group = groups.find(entry => entry.label === destination.group);
      if (group) group.destinations.push({ id: destination.id, label: destination.label });
      else groups.push({ label: destination.group, destinations: [{ id: destination.id, label: destination.label }] });
    }
    const bar = buildTopBar(true); // creates the collapse control the rail adopts
    sidebar = sidebarNav({ product: product.family ?? 'LazySeries', runtime: product.name,
      groups, identityPosition: 'footer',
      current: activeDestination,
      collapseControl,
      onNavigate: id => selectDestination(id),
      // A notify is a user-driven toggle (control click or Cmd/Ctrl+B): it
      // records the explicit choice and persists it; restore and auto-retract
      // go through applyRailState (notify: false) and persist nothing extra.
      onCollapse: value => { userCollapsed = value; narrowExpanded = narrowRetract && !value; applyRailState(); persistNav(); } });
    // V2-T4: the health row carries the pulse glyph (the library's fallback
    // icon vocabulary is out of scope for this task; the swap is presentational).
    sidebar.element.querySelector('.lb-sidebar-destination[data-destination="health"] svg')?.replaceChildren(pulseGlyph());
    sidebar.element.querySelector('.lb-sidebar-footer')?.remove();
    const sidebarHead = element('header', 'cluster spread shell-sidebar-head');
    sidebarHead.append(element('span', 'meta shell-sidebar-label', 'Navigation'), collapseControl);
    sidebar.element.prepend(sidebarHead);

    pageHead = element('header', 'shell-page-head stack');
    pageHead.dataset.testid = 'shell-page-head';
    contentRegion = element('div', 'shell-content stack');
    contentRegion.dataset.testid = 'shell-content';
    const main = element('div', 'lb-shell-main');
    main.append(pageHead, contentRegion);
    frame = element('div', 'lb-shell');
    frame.dataset.testid = 'shell-frame';
    frame.append(sidebar.element, main, dock.element);
    root.replaceChildren(bar, frame);
    root.dataset.initialized = 'true';
    dock.close();
    syncDetailContent();
    syncDockChrome(); // a session-restored open dock announces itself to the chrome
    adoptDockRegions(overview);
    suppressThemeControl();
    syncSidebarCounts();
    applyRailState(); // the narrow fact applies even before any saved state exists
    restoreNav();
    globalThis.document?.addEventListener?.('keydown', handleDestinationShortcut);
    callbacks.onStateChange?.({ initialized: true, destinations: PROJECT_DESTINATIONS.map(destination => destination.id) });
  }

  function teardownFrame() {
    dock?.close('teardown');
    detailContext = null;
    globalThis.document?.removeEventListener?.('keydown', handleDestinationShortcut);
    releaseThemeControl();
    frame = null; sidebar = null; dock = null; dockTrigger = null; collapseControl = null;
    topBar = null; barTitle = null;
    pageHead = null; contentRegion = null; frameRestored = false;
    location = null; history.length = 0; pendingLeave = null;
  }

  function refreshOverview() {
    // Polling-style refresh: preserve the focused object and view mode when a
    // new projection arrives; only the data changes, never the user's place —
    // and never the location, the back stack or the dock.
    const previous = overview?.getStats() ?? null;
    const previousRecords = overview?.getOpenRecords?.();
    overview.applyBundleUpdate(bundle);
    compactLiveOverview(overview.element);
    overview.pruneNotes();
    renderPageHead(); // the context line carries the fresh projection identity
    syncSidebarCounts(); // count badges follow the fresh projection, never stale
    restoringOverview = true;
    try {
      const nodes = overview.getFixture().nodes.flatMap(node => [node, ...(node.children ?? [])]);
      if (previous?.selectedNodeId && nodes.some(node => node.id === previous.selectedNodeId)) overview.select(previous.selectedNodeId, { inspect: false });
      else if (detailContext?.kind === 'node') { detailContext = null; dock.close('selection-removed'); }
      if (previousRecords && detailContext?.kind === 'records') {
        const current = overview.restoreRecords(previousRecords);
        if (current) detailContext.title = current.title;
        else { detailContext = null; dock.close('record-removed'); }
      }
      syncDetailContent();
    } finally { restoringOverview = false; }
  }

  function update() {
    const next = projectionProvider();
    if (next == null) {
      bundle = null;
      overview?.dispose?.(); // T22: the dropped overview retires its clipped notes
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
  // The <=48rem auto-retract tracks the live query for the shell's lifetime;
  // applyRailState no-ops while no frame exists, so teardown/rebuild cycles
  // never lose the narrow fact.
  narrowQuery?.addEventListener?.('change', () => {
    narrowRetract = Boolean(narrowQuery.matches);
    narrowExpanded = false;
    applyRailState();
  });
  // V2-T4: the narrow-only scrim dismisses the floating dock. The scrim is
  // the root's ::after, so its pointer events land on the root itself; clicks
  // on the dock or any real content bubble past this guard. Registered once
  // per shell (not per frame), so teardown/rebuild cycles never stack it.
  root.addEventListener('click', event => {
    if (event.target !== root || !dock?.isOpen?.() || !detailQuery?.matches) return;
    dock.close('scrim');
  });
  detailQuery?.addEventListener?.('change', syncDockChrome);
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
