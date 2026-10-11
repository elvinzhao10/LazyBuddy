// T14 project shell — the project destination entry that renders ONLY after
// the service exposes an initialized project record (IO-2: the not-initialized
// dashboard stays byte-identical to its baseline; this shell adds no nav
// destination until a projection exists). The project name leads the shell,
// the selected LazySeries product is a compact identity badge, and the header
// shows repository/worktree, branch and observation freshness. Destination
// views beyond Overview landed as committed page modules (T15/T16/T18/T19)
// but are not yet wired into this shell's navigation; each disabled
// destination explains exactly that.
import { button, element, statusChip } from './components.mjs';
import { createOverviewView } from './overview.mjs';

export const PROJECT_DESTINATIONS = Object.freeze([
  { id: 'overview', label: 'Overview', landsWith: null },
  { id: 'project', label: 'Project', landsWith: 'the service-navigation wiring (the T15 project and plan editors view module has landed; it is not yet selectable here)' },
  { id: 'plans', label: 'Plans', landsWith: 'the service-navigation wiring (the T15 project and plan editors view module has landed; it is not yet selectable here)' },
  { id: 'execution', label: 'Execution', landsWith: 'the service-navigation wiring (the T16 nested execution and timeline view module has landed; it is not yet selectable here)' },
  { id: 'git', label: 'Git', landsWith: 'the service-navigation wiring (the T18 Git and metrics detail view module has landed; it is not yet selectable here)' },
  { id: 'evidence', label: 'Evidence', landsWith: 'the service-navigation wiring (the T19 evidence and research view module has landed; it is not yet selectable here)' },
  { id: 'research', label: 'Research', landsWith: 'the service-navigation wiring (the T19 evidence and research view module has landed; it is not yet selectable here)' },
]);

export function createProjectShell({ projectionProvider, product = { name: 'LazySeries' }, callbacks = {}, views = {} }) {
  if (typeof projectionProvider !== 'function') throw new TypeError('projectionProvider is required');
  const root = element('section', 'project-shell stack');
  root.dataset.testid = 'project-shell';
  root.dataset.live = String(Object.keys(views).length > 0);
  let activeDestination = 'overview';
  let overview = null;
  let bundle = null;
  let content = null;

  const viewFor = id => id === 'overview' ? overview : views[id] ?? null;

  function compactLiveOverview() {
    if (!Object.keys(views).length || !overview?.element || overview.element.dataset.liveCompact === 'true') return;
    const node = overview.element;
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

  function renderDestinationBar() {
    const nav = element('nav', 'cluster shell-destinations');
    nav.setAttribute('aria-label', 'Project destinations');
    for (const destination of PROJECT_DESTINATIONS) {
      const available = destination.id === 'overview' || Boolean(views[destination.id]);
      const control = button(destination.label, available ? () => selectDestination(destination.id) : null);
      control.dataset.destination = destination.id;
      if (!available) {
        control.disabled = true;
        control.dataset.state = 'pending';
        const reason = element('span', 'meta shell-destination-reason', `View lands with ${destination.landsWith}.`);
        reason.id = `destination-reason-${destination.id}`;
        control.setAttribute('aria-describedby', reason.id);
        nav.append(control, reason);
      } else {
        control.dataset.state = 'live';
        control.setAttribute('aria-pressed', String(activeDestination === destination.id));
        nav.append(control);
      }
    }
    nav.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const controls = [...nav.querySelectorAll('[data-destination]')].filter(control => !control.disabled);
      const index = controls.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      controls[(index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length].focus();
    });
    return nav;
  }

  function selectDestination(id) {
    const selected = viewFor(id);
    if (!selected) return false;
    activeDestination = id;
    for (const control of root.querySelectorAll('[data-destination]')) {
      control.setAttribute('aria-pressed', String(control.dataset.destination === id));
    }
    content?.replaceChildren(selected.element ?? selected);
    selected.activate?.();
    callbacks.onDestinationChange?.({ destination: id });
    return true;
  }

  function renderInitialized() {
    root.replaceChildren();
    root.dataset.initialized = 'true';
    const header = element('header', 'shell-head stack');
    const identity = element('div', 'cluster spread');
    const title = element('h1', 'shell-title', bundle.project_name ?? bundle.snapshot.project_id);
    title.dataset.testid = 'shell-title';
    const badge = element('span', 'shell-product-badge');
    badge.dataset.testid = 'shell-product-badge';
    const identityChip = statusChip({ state: 'neutral', label: product.name });
    identityChip.dataset.identity = 'product'; badge.append(identityChip);
    identity.append(title, badge);
    header.append(identity, renderContextLine(overview.getFixture()));
    root.append(header, renderDestinationBar());

    content = element('div', 'shell-content stack');
    content.dataset.testid = 'shell-content';
    const selected = viewFor(activeDestination) ?? overview;
    if (!viewFor(activeDestination)) activeDestination = 'overview';
    content.append(selected.element ?? selected);
    selected.activate?.();
    root.append(content);
    callbacks.onStateChange?.({ initialized: true, destinations: PROJECT_DESTINATIONS.map(destination => destination.id) });
  }

  function update() {
    const next = projectionProvider();
    if (next == null) {
      bundle = null;
      overview = null;
      renderUninitialized();
      return;
    }
    const changed = bundle !== next;
    bundle = next;
    if (!overview || changed) {
      // Polling-style refresh: preserve the focused object and view mode when a
      // new projection arrives; only the data changes, never the user's place.
      const previous = overview?.getStats() ?? null;
      if (overview) overview.element.remove();
      overview = createOverviewView({ bundle, callbacks: {
        onNodeSelect: event => callbacks.onNodeSelect?.(event),
        onNodeDrill: event => callbacks.onPlanDrill?.(event),
        onMapViewportChange: event => callbacks.onMapViewportChange?.(event),
      } });
      compactLiveOverview();
      renderInitialized();
      if (previous?.map?.mode) overview.setMode(previous.map.mode);
      if (previous?.selectedNodeId) overview.select(previous.selectedNodeId);
    }
    for (const view of Object.values(views)) view?.update?.(bundle.snapshot ?? bundle);
  }

  update();
  return {
    element: root,
    update,
    selectDestination,
    getStats() {
      return {
        initialized: root.dataset.initialized === 'true',
        destinations: [...root.querySelectorAll('[data-destination]')].map(control => control.dataset.destination),
        activeDestination: root.dataset.initialized === 'true' ? activeDestination : null,
        overview: overview?.getStats() ?? null,
      };
    },
  };
}
