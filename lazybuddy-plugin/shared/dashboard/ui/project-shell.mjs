// T14 project shell — the project destination entry that renders ONLY after
// the service exposes an initialized project record (IO-2: the not-initialized
// dashboard stays byte-identical to its baseline; this shell adds no nav
// destination until a projection exists). The project name leads the shell,
// the selected LazySeries product is a compact identity badge, and the header
// shows repository/worktree, branch and observation freshness. Destination
// views beyond Overview land with their owning tasks (T15/T16/T18/T19); each
// disabled destination explains exactly that.
import { button, element, statusChip } from './components.mjs';
import { createOverviewView } from './overview.mjs';
import { overviewFixture } from './overview-fixture.mjs';

export const PROJECT_DESTINATIONS = Object.freeze([
  { id: 'overview', label: 'Overview', landsWith: null },
  { id: 'project', label: 'Project', landsWith: 'T15 (project and plan editors)' },
  { id: 'plans', label: 'Plans', landsWith: 'T15 (project and plan editors)' },
  { id: 'execution', label: 'Execution', landsWith: 'T16 (nested execution and timeline)' },
  { id: 'git', label: 'Git', landsWith: 'T18 (Git and metrics detail views)' },
  { id: 'evidence', label: 'Evidence', landsWith: 'T19 (evidence and research views)' },
  { id: 'research', label: 'Research', landsWith: 'T19 (evidence and research views)' },
]);

export function createProjectShell({ projectionProvider, product = { name: 'LazySeries' }, callbacks = {} }) {
  if (typeof projectionProvider !== 'function') throw new TypeError('projectionProvider is required');
  const root = element('section', 'project-shell stack');
  root.dataset.testid = 'project-shell';
  let activeDestination = 'overview';
  let overview = null;
  let bundle = null;

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
    if (fixture.context) parts.push(`branch ${fixture.context.branch ?? 'unknown'} @ ${(fixture.context.head ?? '').slice(0, 12)}`,
      `observed ${fixture.context.observed_at}`);
    else parts.push('git observation: not projected');
    parts.push(`projection revision ${fixture.projection.revision} · baseline revision ${fixture.projection.baseline_revision}`);
    context.textContent = parts.join(' · ');
    return context;
  }

  function renderDestinationBar() {
    const nav = element('nav', 'cluster shell-destinations');
    nav.setAttribute('aria-label', 'Project destinations');
    for (const destination of PROJECT_DESTINATIONS) {
      const control = button(destination.label, destination.landsWith ? null : () => selectDestination(destination.id));
      control.dataset.destination = destination.id;
      if (destination.landsWith) {
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
    activeDestination = id;
    for (const control of root.querySelectorAll('[data-destination]')) {
      control.setAttribute('aria-pressed', String(control.dataset.destination === id));
    }
    callbacks.onDestinationChange?.({ destination: id });
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
    badge.append(statusChip({ state: 'verified', label: product.name }));
    identity.append(title, badge);
    header.append(identity, renderContextLine(overview.getFixture()));
    root.append(header, renderDestinationBar());

    const content = element('div', 'shell-content stack');
    content.dataset.testid = 'shell-content';
    content.append(overview.element);
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
      overview = createOverviewView({ bundle });
      renderInitialized();
      if (previous?.map?.mode) overview.setMode(previous.map.mode);
      if (previous?.selectedNodeId) overview.select(previous.selectedNodeId);
    }
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
