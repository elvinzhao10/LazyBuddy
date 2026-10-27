import { button, element, statusChip } from './components.mjs';
import { createDocumentView } from './document-view.mjs';
import { emptyState, list } from './project-view-primitives.mjs';
export function createPlansView(project, { adapter, onOpenRun, onEditProject, onOpenEvidence }) {
  const root = element('section', 'plan-browser');
  const sidebar = element('aside', 'panel stack plan-index');
  const detail = element('section', 'panel stack plan-detail');
  let selectedPlanId = project.plans[0]?.id ?? null;
  let request = 0;
  let documentView = null;
  let loadedSourceId = null;
  let loadedSourceKey = null;
  const filters = element('div', 'stack plan-filters');
  const searchLabel = element('label', 'stack', 'Find a plan');
  const search = element('input', '');
  search.type = 'search'; search.placeholder = 'Title, ID or source path';
  search.dataset.nativeSearch = 'true';
  searchLabel.append(search);
  const lifecycleLabel = element('label', 'stack', 'Lifecycle');
  const lifecycle = element('select', '');
  for (const state of ['all', 'draft', 'planned', 'active', 'paused', 'completed', 'superseded', 'abandoned']) {
    const option = element('option', '', state === 'all' ? 'All lifecycles' : state[0].toUpperCase() + state.slice(1));
    option.value = state; lifecycle.append(option);
  }
  lifecycle.value = 'all'; lifecycleLabel.append(lifecycle);
  const orderLabel = element('label', 'stack', 'Order'); const order = element('select');
  for (const [value, label] of [['registered', 'Registered order'], ['attention', 'Needs attention first'], ['title', 'Title A–Z']]) {
    const option = element('option', '', label); option.value = value; order.append(option);
  }
  order.value = 'registered'; orderLabel.append(order); order.addEventListener('change', renderIndex);
  const clear = button('Clear filters', () => {
    search.value = ''; lifecycle.value = 'all'; order.value = 'registered'; renderIndex(); search.focus();
  });
  const count = element('p', 'meta'); count.setAttribute('role', 'status');
  const results = element('div', 'plan-results');
  filters.append(searchLabel, lifecycleLabel, orderLabel, clear);
  sidebar.append(element('h2', '', 'Plans'), filters, count, results);
  search.addEventListener('input', renderIndex);
  lifecycle.addEventListener('change', renderIndex);

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
    const own = ++request;
    const changedPlan = selectedPlanId !== planId;
    selectedPlanId = planId;
    renderIndex();
    if (trigger) [...results.querySelectorAll('[data-plan-id]')].find(control => control.dataset.planId === planId)?.focus();
    const plan = project.plans.find(entry => entry.id === planId);
    const retainedDocument = documentView?.element ?? null;
    detail.replaceChildren();
    if (!plan) { detail.append(emptyState('Plan unavailable', 'The selected plan is no longer present in the latest project revision.')); return; }
    // The shell page header carries the location (T20a); no in-view breadcrumb.
    const head = element('header', 'stack');
    head.append(element('h2', '', plan.title ?? plan.id), element('p', 'meta',
      `${plan.declared_lifecycle} · source ${plan.source_freshness} · plan revision ${plan.revision}`));
    const runBar = element('div', 'cluster');
    if (onEditProject) runBar.append(button('Edit plan and lifecycle', onEditProject));
    for (const run of plan.native_runs ?? []) {
      const control = button(`Open run ${run.run_id}`, () => onOpenRun({ planId: plan.id, runId: run.run_id }));
      control.dataset.runId = run.run_id; runBar.append(control);
    }
    if (!(plan.native_runs ?? []).length) runBar.append(statusChip({ state: 'unavailable', label: 'No native run linked' }));
    const loading = element('p', 'meta', 'Loading the registered original through the native source authority…');
    loading.setAttribute('role', 'status');
    const host = element('div', 'plan-document-host');
    if (retainedDocument && loadedSourceId === plan.source.source_id) host.append(retainedDocument);
    const context = element('details', 'stack plan-checkpoints');
    const observations = (project.observations ?? []).filter(entry => entry.subject?.kind === 'plan' && entry.subject.id === plan.id
      || entry.subject?.kind === 'run' && (plan.native_runs ?? []).some(run => run.run_id === entry.subject.id));
    context.append(element('summary', '', `Evidence trail · ${observations.length} observations · ${plan.baseline_refs.length} baseline references`));
    for (const reference of plan.baseline_refs) {
      const item = project.items.find(item => item.id === reference.item_id);
      context.append(element('p', 'meta', `${item?.title ?? reference.item_id} · considered revision ${reference.item_revision} · current ${item?.revision ?? 'unavailable'}`));
    }
    for (const observation of observations.slice(-100).reverse()) {
      const checkpoint = element('details', 'plan-checkpoint');
      checkpoint.append(element('summary', '', `${observation.observed_at} · ${observation.classification} · ${observation.id}`),
        element('p', '', observation.text.slice(0, 4000)), element('p', 'meta', `Source ${observation.provenance?.reference ?? 'unreported'}${observation.text.length > 4000 ? ' · preview limited to 4,000 characters; full text remains in the observation record' : ''}`));
      for (const artifactId of observation.artifact_ids ?? []) {
        const artifact = project.artifacts?.find(entry => entry.id === artifactId);
        if (artifact && onOpenEvidence) checkpoint.append(button(`Inspect ${artifact.path}`, () => onOpenEvidence(artifact.path)));
      }
      context.append(checkpoint);
    }
    if (observations.length > 100) context.append(element('p', 'meta', `Showing the latest 100 of ${observations.length} observations. Earlier evidence remains in the native project record.`));
    if (!observations.length) context.append(element('p', 'meta', 'No observations explicitly linked to this plan or its runs. Record checkpoints with plan/run subjects and artifact IDs to preserve the evidence trail.'));
    detail.append(head, runBar, context, host);
    const nextKey = sourceKey(plan);
    if (!changedPlan && !refresh && documentView && loadedSourceKey === nextKey) { appendJump(plan, runBar); return; }
    host.prepend(loading);
    host.setAttribute('aria-busy', 'true');
    try {
      const source = await adapter.source(plan.source.source_id);
      if (own !== request || selectedPlanId !== plan.id) return;
      if (documentView && loadedSourceId === plan.source.source_id) documentView.setMarkdown(source.content);
      else documentView = createDocumentView({ markdown: source.content, title: source.path, headingOffset: 2 });
      loadedSourceId = plan.source.source_id; loadedSourceKey = nextKey;
      loading.remove(); host.replaceChildren(documentView.element);
      host.setAttribute('aria-busy', 'false');
      appendJump(plan, runBar);
    } catch (error) {
      if (own !== request) return;
      loading.remove();
      host.setAttribute('aria-busy', 'false');
      const failure = emptyState('Source unavailable', `${error.message}. ${host.contains(retainedDocument) ? 'The previously loaded original is retained below; it could not be refreshed.' : 'Restore the registered source and retry.'}`);
      const retry = button('Retry source', () => {
        open(planId, null, { refresh: true });
        const heading = detail.querySelector('h2'); heading.tabIndex = -1; heading.focus();
      });
      retry.dataset.action = 'retry-plan-source';
      failure.append(retry); host.prepend(failure);
    }
  }

  function renderIndex() {
    const focusedId = results.contains(document.activeElement) ? document.activeElement?.dataset?.planId : null;
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = project.plans.filter(plan => {
      const path = project.sources.find(source => source.id === plan.source.source_id)?.path ?? '';
      return (lifecycle.value === 'all' || plan.declared_lifecycle === lifecycle.value)
        && `${plan.title ?? ''}\n${plan.id}\n${path}`.toLocaleLowerCase().includes(query);
    });
    if (order.value === 'title') filtered.sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));
    if (order.value === 'attention') {
      const score = plan => Number(plan.source_freshness !== 'current') + Number(plan.baseline_reference_status === 'stale')
        + Number((plan.native_observations ?? []).some(run => run.execution === 'failed'));
      filtered.sort((a, b) => score(b) - score(a));
    }
    clear.hidden = !query && lifecycle.value === 'all' && order.value === 'registered';
    count.textContent = `${filtered.length} of ${project.plans.length} plan${project.plans.length === 1 ? '' : 's'}`;
    results.replaceChildren();
    if (!project.plans.length) { results.append(element('p', 'meta', 'No plans are registered. Register an original plan through the native project command route.')); return; }
    if (!filtered.length) { results.append(element('p', 'meta', 'No plans match these filters. Clear filters to see all plans.')); return; }
    results.append(list(filtered, plan => {
      const control = button(plan.title ?? plan.id, event => open(plan.id, event.currentTarget));
      control.dataset.planId = plan.id;
      control.setAttribute('aria-pressed', String(plan.id === selectedPlanId));
      control.append(element('span', 'meta', `${plan.declared_lifecycle} · ${(plan.native_runs ?? []).length} run${(plan.native_runs ?? []).length === 1 ? '' : 's'}`));
      if (plan.source_freshness !== 'current' || plan.baseline_reference_status === 'stale') control.append(statusChip({ state: 'stale', label: 'Source or baseline needs review' }));
      return control;
    }));
    if (focusedId) ([...results.querySelectorAll('[data-plan-id]')].find(control => control.dataset.planId === focusedId) ?? search).focus();
  }

  function update(next) {
    const key = value => JSON.stringify([value.plans.map(plan => ({ ...plan, native_observations: plan.native_observations?.map(({ observed_at, ...rest }) => rest) })),
      value.items, value.observations, value.artifacts, value.sources.map(source => [source.id, source.accepted_sha256, source.observation?.sha256, source.observation?.status])]);
    if (key(project) === key(next)) { project = next; return; }
    const previousPlan = project.plans.find(plan => plan.id === selectedPlanId);
    const previousKey = previousPlan ? sourceKey(previousPlan) : null;
    project = next;
    if (!project.plans.some(plan => plan.id === selectedPlanId)) selectedPlanId = project.plans[0]?.id ?? null;
    renderIndex();
    const plan = project.plans.find(entry => entry.id === selectedPlanId);
    if (plan) open(selectedPlanId, null, { refresh: previousKey !== sourceKey(plan) });
    else { request += 1; detail.replaceChildren(emptyState('No plans registered', 'Register an original plan through the native project command route.')); }
  }
  renderIndex();
  if (selectedPlanId) open(selectedPlanId);
  else detail.append(emptyState('No plans registered', 'Register an original plan through the native project command route.'));
  root.append(sidebar, detail);
  return { element: root, update, open };
}
