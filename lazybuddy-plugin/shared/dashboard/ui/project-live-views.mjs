import { button, element, statusChip } from './components.mjs';
import { createDocumentView } from './document-view.mjs';
import { createProjectEditor } from './editor-views.mjs';
import { createArchitectureView } from './architecture-view.mjs';
import { createGitMetricsView } from './git-metrics-view.mjs';
import { createEvidenceView } from './evidence-view.mjs';
import { createExecutionView as createNestedExecutionView } from './execution-view.mjs';
import { liveExecutionProjection } from './live-execution-model.mjs';

const emptyState = (title, detail) => {
  const panel = element('section', 'panel notice stack');
  panel.append(statusChip({ state: 'unavailable', label: title }), element('p', 'meta', detail));
  return panel;
};

const list = (values, render) => {
  const node = element('ul', 'project-record-list stack');
  for (const value of values) { const item = element('li', ''); item.append(render(value)); node.append(item); }
  return node;
};

function scopePage(fixture, nav, page) {
  const key = nav.scope === 'global' ? 'global' : `${nav.scope}:${nav.id}`;
  return fixture.scopePages[key]?.pages[page - 1] ?? fixture.scopePages[key]?.pages.at(-1);
}

function createLazyDetail({ label, load, compose }) {
  const root = element('section', 'panel stack project-detail-loader');
  let view = null; let pending = null; let loadedRevision = null; let projectRevision = null;
  // The shell page header names the destination (T20a); the lazy surface
  // carries only its status and load control.
  const status = element('p', 'meta', `${label} loads from its bounded native collector when opened.`);
  status.setAttribute('role', 'status');
  const action = button(`Load ${label}`, () => activate(true));
  root.append(status, action);
  async function activate(force = false) {
    if (pending) return pending;
    if (view && !force && loadedRevision === projectRevision) return view;
    action.disabled = true; status.textContent = `Loading ${label}…`;
    pending = (async () => {
      const payload = await load();
      const next = compose(payload);
      view?.element?.remove(); view = next; loadedRevision = projectRevision;
      root.append(next.element); status.textContent = `${label} ready from native project revision ${projectRevision}.`;
      action.textContent = `Refresh ${label}`; return next;
    })().catch(error => {
      status.textContent = `${label} unavailable · ${error.message}`;
      return null;
    }).finally(() => { action.disabled = false; pending = null; });
    return pending;
  }
  return { element: root, activate, getView: () => view, update(project) {
    projectRevision = project.revision;
    if (view && loadedRevision !== projectRevision) status.textContent = `${label} is retained from revision ${loadedRevision}; refresh to load revision ${projectRevision}.`;
  } };
}

function createProjectView(project, { adapter }) {
  const root = element('section', 'project-native-editor stack');
  const head = element('header', 'stack');
  // The shell page header carries the destination title (T20a); the view
  // leads with its own scope note instead of a duplicate heading.
  head.append(element('p', 'meta',
    'Features, requirements, principles, decisions, plans and registered originals share the native revision-checked command route.'));
  const editor = createProjectEditor({ snapshot: project,
    sendCommand: command => adapter.command(command),
    captureSource: sourceId => adapter.source(sourceId),
    assessTransition: (snapshot, planId, toLifecycle, payload) => adapter.assessTransition(snapshot, planId, toLifecycle, payload),
  });
  const architecture = createLazyDetail({ label: 'Architecture', load: () => adapter.detail('architecture'),
    compose: fixture => createArchitectureView({ fixture,
      lens: fixture.journeys?.length ? 'product' : 'engineering',
      view: fixture.current?.length ? 'current' : 'planned',
      mode: typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches ? 'list' : 'graph' }) });
  architecture.update(project);
  const summary = element('section', 'grid project-summary');
  for (const [label, value] of [['Features', project.summary.accepted_features], ['Requirements', project.summary.accepted_requirements],
    ['Principles', project.summary.accepted_principles], ['Decisions', project.summary.accepted_decisions], ['Plans', project.summary.plan_count]]) {
    const card = element('article', 'panel stack'); card.append(element('span', 'meta', label), element('strong', '', String(value))); summary.append(card);
  }
  const sourceDetails = element('details', 'panel stack project-source-details');
  sourceDetails.append(element('summary', '', 'Registered sources and structured editor'), editor.element);
  root.append(head, summary, architecture.element, sourceDetails);
  return { element: root, ready: editor.ready, update(next) {
    project = next; editor.update(next); architecture.update(next);
  }, getState: () => editor.getState(),
  // T20 navigation guard: the shell asks this surface before it replaces the
  // Project destination while the structured editor holds unsaved drafts.
  needsLeaveGuard: () => editor.needsLeaveGuard(),
  confirmLeave: options => editor.confirmLeave(options) };
}

function createPlansView(project, { adapter, onOpenRun }) {
  const root = element('section', 'plan-browser');
  const sidebar = element('aside', 'panel stack plan-index');
  const detail = element('section', 'panel stack plan-detail');
  let selectedPlanId = project.plans[0]?.id ?? null;
  let request = 0;
  let documentView = null;
  let loadedSourceId = null;
  let loadedSourceKey = null;

  function sourceKey(plan) {
    const source = project.sources.find(entry => entry.id === plan.source.source_id);
    return `${plan.source.source_id}\n${source?.accepted_sha256 ?? plan.source.sha256}\n${source?.observation?.sha256 ?? ''}`;
  }

  function appendJump(plan, runBar) {
    if (!documentView || !plan.source.anchor_id?.startsWith('heading:')) return;
    const title = plan.source.anchor_id.slice('heading:'.length);
    const outline = [...documentView.element.querySelectorAll('a')]
      .find(link => link.textContent === title);
    if (!outline) return;
    const jump = button('Jump to plan section', () => {
      const target = documentView.element.querySelector(outline.getAttribute('href'));
      if (!target) return;
      target.tabIndex = -1; target.scrollIntoView?.({ block: 'start' }); target.focus?.();
    });
    jump.dataset.action = 'jump-to-plan-section'; runBar.prepend(jump);
  }

  async function open(planId, trigger = null, { refresh = false } = {}) {
    const changedPlan = selectedPlanId !== planId;
    selectedPlanId = planId;
    renderIndex();
    const plan = project.plans.find(entry => entry.id === planId);
    const retainedDocument = documentView?.element ?? null;
    detail.replaceChildren();
    if (!plan) { detail.append(emptyState('Plan unavailable', 'The selected plan is no longer present in the latest project revision.')); return; }
    // The shell page header carries the location (T20a); no in-view breadcrumb.
    const head = element('header', 'stack');
    head.append(element('h2', '', plan.title ?? plan.id), element('p', 'meta',
      `${plan.declared_lifecycle} · source ${plan.source_freshness} · plan revision ${plan.revision}`));
    const runBar = element('div', 'cluster');
    for (const run of plan.native_runs ?? []) {
      const control = button(`Open run ${run.run_id}`, () => onOpenRun({ planId: plan.id, runId: run.run_id }));
      control.dataset.runId = run.run_id; runBar.append(control);
    }
    if (!(plan.native_runs ?? []).length) runBar.append(statusChip({ state: 'unavailable', label: 'No native run linked' }));
    const loading = element('p', 'meta', 'Loading the registered original through the native source authority…');
    const host = element('div', 'plan-document-host');
    if (retainedDocument && loadedSourceId === plan.source.source_id) host.append(retainedDocument);
    detail.append(head, runBar, host);
    const nextKey = sourceKey(plan);
    if (!changedPlan && !refresh && documentView && loadedSourceKey === nextKey) { appendJump(plan, runBar); return; }
    host.prepend(loading);
    const own = ++request;
    try {
      const source = await adapter.source(plan.source.source_id);
      if (own !== request || selectedPlanId !== plan.id) return;
      if (documentView && loadedSourceId === plan.source.source_id) documentView.setMarkdown(source.content);
      else documentView = createDocumentView({ markdown: source.content, title: source.path });
      loadedSourceId = plan.source.source_id; loadedSourceKey = nextKey;
      loading.remove(); host.replaceChildren(documentView.element);
      appendJump(plan, runBar);
      trigger?.focus?.();
    } catch (error) {
      if (own !== request) return;
      loading.remove();
      detail.append(emptyState('Source unavailable', `${error.message}. Refresh the project after restoring the registered source.`));
    }
  }

  function renderIndex() {
    sidebar.replaceChildren(element('h2', '', 'Plans'), element('p', 'meta', `${project.plans.length} native plan record${project.plans.length === 1 ? '' : 's'}`));
    if (!project.plans.length) { sidebar.append(element('p', 'meta', 'No plans are registered. Register an original plan through the native project command route.')); return; }
    sidebar.append(list(project.plans, plan => {
      const control = button(plan.title ?? plan.id, event => open(plan.id, event.currentTarget));
      control.dataset.planId = plan.id;
      control.setAttribute('aria-pressed', String(plan.id === selectedPlanId));
      control.append(element('span', 'meta', `${plan.declared_lifecycle} · ${(plan.native_runs ?? []).length} run${(plan.native_runs ?? []).length === 1 ? '' : 's'}`));
      return control;
    }));
  }

  function update(next) {
    const previousPlan = project.plans.find(plan => plan.id === selectedPlanId);
    const previousKey = previousPlan ? sourceKey(previousPlan) : null;
    project = next;
    if (!project.plans.some(plan => plan.id === selectedPlanId)) selectedPlanId = project.plans[0]?.id ?? null;
    renderIndex();
    const plan = project.plans.find(entry => entry.id === selectedPlanId);
    if (plan) open(selectedPlanId, null, { refresh: previousKey !== sourceKey(plan) });
    else detail.replaceChildren(emptyState('No plans registered', 'Register an original plan through the native project command route.'));
  }
  renderIndex();
  if (selectedPlanId) open(selectedPlanId);
  else detail.append(emptyState('No plans registered', 'Register an original plan through the native project command route.'));
  root.append(sidebar, detail);
  return { element: root, update, open };
}

function createExecutionDestination(project, { runElement, runId, runSnapshot: initialRunSnapshot,
  onRunUnavailable, onBackPlan }) {
  const root = element('section', 'execution-live stack');
  let selection = null;
  let runSnapshot = initialRunSnapshot;
  let selectedTaskId = null;
  let nestedView = null;
  let nestedLevel = null;
  let controlsOpen = false;

  function richExecution() {
    if (!runSnapshot || runSnapshot.run_id !== runId || !runSnapshot.tasks?.length) return null;
    if (selectedTaskId && !runSnapshot.tasks.some(task => task.id === selectedTaskId && task.attempts?.length)) selectedTaskId = null;
    const projection = liveExecutionProjection(runSnapshot, { taskId: selectedTaskId });
    const level = selectedTaskId ? 'task' : 'run';
    if (!nestedView || nestedLevel !== level) {
      nestedView = createNestedExecutionView({ document: projection.document, timeline: projection.timeline,
        mode: typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches ? 'list' : 'graph',
        callbacks: {
          onDrill({ focusId }) { selectedTaskId = focusId; render(); },
          onNavigate({ level: target }) {
            if (target === 'batch') { selectedTaskId = null; render(); }
            else if (target === 'plan' && selection) onBackPlan?.(selection.planId);
          },
        } });
      nestedLevel = level;
    } else nestedView.applyUpdate(projection.document, projection.timeline);
    return nestedView.element;
  }

  function render() {
    root.replaceChildren();
    const head = element('header', 'stack');
    // The shell page header carries the destination title and the back
    // affordance (T20a); the view states only its run binding. The plan
    // return stays available through the nested breadcrumbs below.
    head.append(element('p', 'meta', selection
      ? `Native run ${selection.runId}`
      : `Authenticated run dashboard · ${runId ?? 'no run binding'}`));
    let controls = null;
    if (runElement && runId && (!selection || selection.runId === runId)) {
      controls = element('details', 'panel stack execution-run-controls');
      controls.open = controlsOpen;
      controls.addEventListener('toggle', () => { controlsOpen = controls.open; });
      const summary = element('summary', '', 'Run verification and plan editing controls');
      controls.append(summary, runElement);
      const openControls = button('Open run verification and evidence controls', () => {
        controlsOpen = true; controls.open = true; controls.scrollIntoView?.({ block: 'start' }); summary.focus?.();
      });
      openControls.dataset.action = 'open-run-controls';
      head.append(openControls);
    }
    root.append(head);
    if (selection && selection.runId !== runId) {
      root.append(emptyState('Run not bound to this service', `Open the authenticated dashboard service for run ${selection.runId} to inspect its tasks and verification records.`));
      onRunUnavailable?.(selection); return;
    }
    const rich = richExecution();
    if (rich) root.append(rich);
    else root.append(emptyState('No observed task execution', runId
      ? 'The bound native run has no task snapshot to project. Verification and plan controls remain available below.'
      : 'This service has no run projection. Project plans and documents remain available.'));
    if (controls) root.append(controls);
  }
  const openRun = next => { selection = next; selectedTaskId = null; nestedView = null; nestedLevel = null; render(); };
  render(); return { element: root, update(next) { project = next; render(); },
    updateRun(next) { runSnapshot = next; render(); }, openRun };
}

function createCollectionView(project, kind) {
  const root = element('section', 'panel stack project-collection');
  const update = next => {
    project = next; root.replaceChildren();
    const title = kind[0].toUpperCase() + kind.slice(1);
    root.append(element('h2', '', title));
    let records = [];
    if (kind === 'git') records = project.worktrees?.entries ?? [];
    else if (kind === 'evidence') records = project.artifacts ?? [];
    else records = project.research ?? [];
    if (!records.length) {
      const guidance = kind === 'git' ? 'No native worktree observation is available for this project root.'
        : kind === 'evidence' ? 'No retained artifacts are registered. Runtime evidence remains available in the bound run dashboard.'
          : 'No research findings are registered in the native project record.';
      root.append(emptyState(`${title} unavailable`, guidance)); return;
    }
    root.append(list(records, record => {
      const row = element('article', 'project-record stack');
      if (kind === 'git') row.append(element('strong', '', record.branch ?? '(detached HEAD)'),
        element('p', 'meta', `${record.current ? 'Current worktree' : record.kind ?? 'Worktree'} · ${record.root} · ${(record.head ?? '').slice(0, 12) || 'HEAD unavailable'}`));
      else row.append(element('strong', '', record.title ?? record.question ?? record.id),
        element('p', 'meta', `${record.id}${record.status ? ` · ${record.status}` : ''}${record.path ? ` · ${record.path}` : ''}`));
      return row;
    }));
  };
  update(project); return { element: root, update };
}

function createResearchView(project, { adapter, onOpenEvidence }) {
  const root = element('section', 'plan-browser research-browser');
  const index = element('aside', 'panel stack plan-index');
  const detail = element('section', 'panel stack plan-detail');
  let selectedId = project.research?.[0]?.id ?? null;
  let sourceRequest = 0;
  let selectedSourcePath = null;
  let sourceView = null;
  let loadedSourceKey = null;

  const findingOf = id => project.research?.find(finding => finding.id === id) ?? null;
  function renderIndex() {
    index.replaceChildren(element('h2', '', 'Research'), element('p', 'meta',
      `${project.research?.length ?? 0} native finding${project.research?.length === 1 ? '' : 's'}`));
    if (!project.research?.length) {
      index.append(emptyState('Research unavailable', 'No research findings are registered in the native project record.'));
      return;
    }
    index.append(list(project.research, finding => {
      const control = button(finding.question, () => {
        if (finding.id !== selectedId) { selectedSourcePath = null; sourceView = null; loadedSourceKey = null; }
        open(finding.id);
      });
      control.dataset.researchId = finding.id;
      control.setAttribute('aria-pressed', String(finding.id === selectedId));
      control.append(element('span', 'meta', `${finding.id} · revision ${finding.revision}`));
      return control;
    }));
  }

  async function openSource(sourcePath, host, status) {
    const source = project.sources?.find(candidate => candidate.path === sourcePath);
    if (!source) { status.textContent = 'This research source is not registered with the native source authority.'; return; }
    const own = ++sourceRequest; status.textContent = `Loading ${sourcePath}…`;
    try {
      const capture = await adapter.source(source.id);
      if (own !== sourceRequest) return;
      sourceView = createDocumentView({ markdown: capture.content, title: capture.path });
      selectedSourcePath = sourcePath;
      loadedSourceKey = `${source.id}\n${source.accepted_sha256 ?? source.observation?.sha256 ?? capture.sha256}`;
      host.replaceChildren(sourceView.element);
      status.textContent = `Registered source ${source.id}`;
    } catch (error) {
      if (own === sourceRequest) status.textContent = `Source unavailable · ${error.message}`;
    }
  }

  function open(id) {
    selectedId = id; sourceRequest += 1; renderIndex(); detail.replaceChildren();
    const finding = findingOf(id);
    if (!finding) { detail.append(emptyState('Finding unavailable', 'The selected finding is absent from the current project revision.')); return; }
    detail.append(element('p', 'meta', `Research / ${finding.id}`), element('h2', '', finding.question),
      element('p', 'meta', `captured ${finding.captured_at} · revision ${finding.revision} · recorded by ${finding.recorded_by}`));
    for (const [title, value] of [['Findings', finding.findings], ['Uncertainty', finding.uncertainty],
      ['Recommendation', finding.recommendation]]) {
      const section = element('section', 'stack research-field');
      section.append(element('h3', '', title), element('p', '', value ?? 'Not recorded.')); detail.append(section);
    }
    if (finding.promotion_proposal_id) detail.append(element('p', 'meta', `Linked proposal ${finding.promotion_proposal_id}; research alone grants no acceptance or verification.`));
    const sources = element('section', 'stack research-sources');
    sources.append(element('h3', '', 'Sources'));
    const sourceHost = element('div', 'research-source-host');
    const sourceStatus = element('p', 'meta', 'Select a registered source to read it here, or open a retained artifact in Evidence.');
    sourceStatus.setAttribute('role', 'status');
    sources.append(list(finding.sources, sourcePath => {
      const row = element('div', 'stack research-source'); row.append(element('code', '', sourcePath));
      const actions = element('div', 'cluster');
      if (project.sources?.some(source => source.path === sourcePath)) {
        actions.append(button('Read registered source', () => openSource(sourcePath, sourceHost, sourceStatus)));
      }
      if (project.artifacts?.some(artifact => artifact.path === sourcePath)) {
        const evidence = button('Open in Evidence', () => onOpenEvidence(sourcePath));
        evidence.dataset.evidencePath = sourcePath; actions.append(evidence);
      }
      if (!actions.children.length) actions.append(element('span', 'meta', 'No registered source or retained artifact is available.'));
      row.append(actions); return row;
    }), sourceStatus, sourceHost);
    if (selectedSourcePath && finding.sources.includes(selectedSourcePath) && sourceView) {
      const source = project.sources?.find(candidate => candidate.path === selectedSourcePath);
      const currentKey = source ? `${source.id}\n${source.accepted_sha256 ?? source.observation?.sha256 ?? ''}` : null;
      sourceHost.append(sourceView.element);
      sourceStatus.textContent = `Registered source ${source?.id ?? selectedSourcePath}`;
      if (currentKey !== loadedSourceKey) openSource(selectedSourcePath, sourceHost, sourceStatus);
    }
    detail.append(sources);
  }

  function update(next) {
    project = next;
    if (!findingOf(selectedId)) selectedId = project.research?.[0]?.id ?? null;
    renderIndex();
    if (selectedId) open(selectedId);
    else detail.replaceChildren(emptyState('Research unavailable', 'No research findings are registered in the native project record.'));
  }
  renderIndex();
  if (selectedId) open(selectedId);
  else detail.append(emptyState('Research unavailable', 'No research findings are registered in the native project record.'));
  root.append(index, detail);
  return { element: root, update, open };
}

// V2-T4 Health destination — the workspace-level health view composes from
// the sibling module ui/health-view.mjs (exact contract:
// `import { createHealthView } from './health-view.mjs'`,
// `createHealthView({ adapter })` returning `{ element, update?(snapshot) }`).
// The module lands in parallel, so the import is DYNAMIC and lazy (first
// visit); while it is absent or fails to load, the destination mounts the
// honest unavailable panel behind the same import — never a fabricated
// health state, never a dead empty surface.
// The adapter is narrowed to the contract the health view defines —
// `{ read(): Promise<health snapshot> }`. The live project adapter's own
// read() yields a PROJECT record, which the view's schema gate would (rightly)
// refuse as malformed, so the health read wires only when the base adapter
// actually exposes a health reader (health()/readHealth()); without one the
// view renders its honest 'no health adapter is connected' state.
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
  plans = createPlansView(project, { adapter, onOpenRun(selection) {
    execution.openRun(selection); onDestinationRequest?.('execution');
  } });
  const git = createLazyDetail({ label: 'Git and metrics', load: () => adapter.detail('git'),
    compose: payload => createGitMetricsView(payload) });
  const evidence = createLazyDetail({ label: 'Evidence', load: () => adapter.detail('evidence'), compose: fixture => createEvidenceView({ fixture,
    loadPage: scopePage, loadPreview: entry => adapter.previewArtifact(entry.id) }) });
  git.update(project); evidence.update(project);
  const research = createResearchView(project, { adapter, async onOpenEvidence(path) {
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
  } });
  // V2-T4: the Health workspace destination — lazy dynamic import of the
  // sibling health-view module through the exact contract, with the honest
  // unavailable panel while it is absent.
  const health = createHealthDestination({ adapter });
  const views = { project: projectView, plans, execution, git, evidence, research, health };
  return { views, openPlan(planId) { openPlanLocation(planId); }, updateRun(next) {
    execution.updateRun(next);
  }, update(next) {
    for (const view of Object.values(views)) view?.update?.(next);
  } };
}
