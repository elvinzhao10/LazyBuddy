import { element, statusChip } from './components.mjs';
import { createGitMetricsView } from './git-metrics-view.mjs';
import { createEvidenceView } from './evidence-view.mjs';
import { createLazyDetail, scopePage } from './project-view-primitives.mjs';
import { createProjectView } from './project-destination.mjs';
import { createPlansView } from './plans-destination.mjs';
import { createExecutionDestination } from './execution-destination.mjs';
import { createResearchView } from './research-destination.mjs';

// Health loads on first visit. Only a health reader is passed to its schema gate;
// project polling snapshots are not health observations.
function healthAdapterOf(adapter) {
  if (!adapter || typeof adapter !== 'object') return null;
  const reader = typeof adapter.health === 'function' ? () => adapter.health()
    : typeof adapter.readHealth === 'function' ? () => adapter.readHealth() : null;
  return reader ? { read: reader } : null;
}

function createHealthDestination({ adapter }) {
  const root = element('section', 'stack health-destination');
  root.dataset.testid = 'health-destination';
  let view = null;
  let settled = false;
  let pending = null;

  const unavailable = detail => {
    const panel = element('section', 'panel notice stack');
    panel.dataset.testid = 'health-unavailable';
    panel.append(statusChip({ state: 'unavailable', label: 'Health view unavailable' }),
      element('p', 'meta', detail));
    return panel;
  };

  const mount = () => {
    if (settled || pending) return pending;
    const status = element('p', 'meta', 'Composing the health view from its module…');
    status.setAttribute('role', 'status');
    root.replaceChildren(status);
    pending = (async () => {
      try {
        const { createHealthView } = await import('./health-view.mjs');
        const next = createHealthView({ adapter: healthAdapterOf(adapter) });
        if (!next?.element) throw new Error('createHealthView returned no element');
        view = next;
        root.replaceChildren(next.element);
      } catch (error) {
        root.replaceChildren(unavailable(
          `The health view module is not available in this build (${error instanceof Error ? error.message : String(error)}). `
          + 'No health data is projected here; nothing is inferred in its place.'));
      } finally {
        settled = true;
        pending = null;
      }
      return view;
    })();
    return pending;
  };

  return {
    element: root,
    activate: mount,
    getView: () => view,
    update(snapshot) {
      // The view is schema-gated: only health-shaped payloads ({ schema,
      // sections }) re-render it. The shell's project polling snapshots are
      // not health snapshots — forwarding them would trip the view's own
      // malformed-input refusal — so they never reach it.
      if (view && snapshot && typeof snapshot === 'object'
        && typeof snapshot.schema === 'string' && Array.isArray(snapshot.sections)) view.update(snapshot);
    },
  };
}

export function createLiveProjectViews({ project, adapter, runElement = null, runId = null, runSnapshot = null,
  onDestinationRequest = null, onOpenItem = null, onOpenPlan = null }) {
  const projectView = createProjectView(project, { adapter });
  let plans;
  // A plan opens as an in-place item location when the shell provides the
  // item route; without one (unit composition) the plans destination selects.
  const openPlanLocation = planId => {
    if (onOpenPlan) { onOpenPlan(planId); return; }
    plans?.open(planId); onDestinationRequest?.('plans');
  };
  const execution = createExecutionDestination(project, { runElement, runId, runSnapshot, onBackPlan(planId) {
    openPlanLocation(planId);
  } });
  plans = createPlansView(project, { adapter,
    onEditProject() { onDestinationRequest?.('project'); projectView.openEditor(); },
    onOpenEvidence: openEvidencePath,
    onOpenRun(selection) {
    execution.openRun(selection); onDestinationRequest?.('execution');
  } });
  const git = createLazyDetail({ label: 'Git and metrics', load: () => adapter.detail('git'),
    compose: payload => createGitMetricsView(payload) });
  const evidence = createLazyDetail({ label: 'Evidence', load: () => adapter.detail('evidence'), compose: fixture => createEvidenceView({ fixture,
    loadPage: scopePage, loadPreview: entry => adapter.previewArtifact(entry.id) }) });
  git.update(project); evidence.update(project);
  async function openEvidencePath(path) {
    // Opening a retained artifact from research navigates in place to an
    // evidence item location focused on that artifact when the shell routes
    // items; the destination-level fallback keeps the pre-location behavior.
    if (onOpenItem) {
      onOpenItem({ id: `evidence:${path}`, title: `Evidence · ${path}`, destination: 'evidence', content: evidence.element,
        enter: async () => {
          const view = await evidence.activate();
          const entry = view?.getFixture().entries.find(candidate => candidate.path === path);
          if (entry) { await view.select(entry.id); view.focusRow(entry.id); }
        } });
      return;
    }
    onDestinationRequest?.('evidence');
    const view = await evidence.activate();
    const entry = view?.getFixture().entries.find(candidate => candidate.path === path);
    if (entry) { await view.select(entry.id); view.focusRow(entry.id); }
  }
  const research = createResearchView(project, { adapter, onOpenEvidence: openEvidencePath });
  const health = createHealthDestination({ adapter });
  const views = { project: projectView, plans, execution, git, evidence, research, health };
  return { views, openPlan(planId) { openPlanLocation(planId); }, updateRun(next) {
    execution.updateRun(next);
  }, update(next) {
    for (const view of Object.values(views)) view?.update?.(next);
  } };
}
