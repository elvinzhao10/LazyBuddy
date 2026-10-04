import { button, element } from './components.mjs';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const commandId = () => globalThis.crypto?.randomUUID?.() ?? `dashboard-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const descendants = (snapshot, seed) => {
  const found = new Set([seed]); let changed = true;
  while (changed) { changed = false; for (const task of snapshot.tasks) if (!found.has(task.id) && task.depends_on.some(id => found.has(id))) { found.add(task.id); changed = true; } }
  return [...found];
};

export function dependencyImpact(snapshot, taskId, prerequisiteId, operation = 'add') {
  const task = snapshot.tasks.find(item => item.id === taskId);
  const prerequisite = snapshot.tasks.find(item => item.id === prerequisiteId);
  if (!task || !prerequisite) return { valid: false, reason: 'Unknown task ID.', affected: [] };
  if (taskId === prerequisiteId) return { valid: false, reason: 'A task cannot depend on itself.', affected: [] };
  if (operation === 'remove') return task.depends_on.includes(prerequisiteId)
    ? { valid: true, reason: 'Dependency can be removed.', affected: descendants(snapshot, taskId) }
    : { valid: false, reason: 'Dependency is not present.', affected: [] };
  if (task.depends_on.includes(prerequisiteId)) return { valid: false, reason: 'Dependency is already present.', affected: [] };
  const reaches = start => {
    const pending = [start]; const seen = new Set();
    while (pending.length) { const id = pending.pop(); if (id === taskId) return true; if (!seen.has(id)) { seen.add(id); pending.push(...(snapshot.tasks.find(item => item.id === id)?.depends_on ?? [])); } }
    return false;
  };
  return reaches(prerequisiteId) ? { valid: false, reason: 'Dependency would create a cycle.', affected: [] }
    : { valid: true, reason: 'Dependency is valid.', affected: descendants(snapshot, taskId) };
}

export function planningCommand(snapshot, taskId, operation, payload, id = commandId()) {
  const queued = operation.endsWith('_queued_plan');
  return { schema_version: 1, command_id: id,
    target: { project_id: snapshot.project_id, run_id: queued ? null : snapshot.run_id, id: taskId },
    expected_revision: queued ? snapshot.queue_revision : snapshot.revision, operation, payload };
}

function field(label, control) { const wrapper = element('label'); wrapper.append(element('span', 'meta', label), control); return wrapper; }
function input(type = 'text') { const control = document.createElement('input'); control.type = type; return control; }
function option(value, label = value) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }

export function createPlanningEditor({ snapshot, onCommand, initialDraft = null, onDraftChange = () => {} }) {
  let current = snapshot; let taskId = snapshot.tasks[0]?.id ?? null; let dirty = false; let readOnlyReason = null;
  const root = element('section', 'planning-editor panel stack'); root.dataset.testid = 'criterion-editor';
  const status = element('p', 'edit-status meta', 'Select a task to edit future planning.'); status.dataset.testid = 'edit-status'; status.setAttribute('role', 'status');
  const taskSelect = document.createElement('select'); taskSelect.setAttribute('aria-label', 'Task');
  const priority = input('number'); priority.min = '0'; priority.step = '1';
  const dependency = input(); dependency.placeholder = 'prerequisite task ID';
  const depAction = document.createElement('select'); depAction.append(option('add', 'Add dependency'), option('remove', 'Remove dependency'));
  const impact = element('p', 'meta', 'Enter a dependency to preview impact.');
  const criterionId = input(); criterionId.placeholder = 'criterion:new';
  const requirement = document.createElement('textarea'); requirement.rows = 3;
  const scenarioId = input(); scenarioId.placeholder = 'scenario:new';
  const scenarioRequirement = input(); scenarioRequirement.placeholder = 'Observable requirement';
  const verifierRef = input(); verifierRef.placeholder = 'verifier reference';
  const submit = button('Save planning edit'); submit.classList.add('primary'); submit.dataset.testid = 'edit-submit';
  const undo = button('Undo latest criterion amendment');
  const queueRoot = element('section', 'queue-editor stack'); queueRoot.dataset.testid = 'queue-editor';
  const queueId = input(); queueId.placeholder = 'plan:new'; const queueTitle = input(); queueTitle.placeholder = 'Queued plan title';
  const queuePriority = input('number'); queuePriority.min = '0'; queuePriority.value = '0';
  const queueReadiness = document.createElement('select'); for (const value of ['draft', 'ready', 'held']) queueReadiness.append(option(value));
  const queueSubmit = button('Create queued plan');
  queueSubmit.dataset.action = 'queue-create';
  const dependencyGrid = element('div', 'editor-grid');
  const scenarioGrid = element('div', 'editor-grid');
  const actions = element('div', 'cluster');

  function selectedTask() { return current.tasks.find(item => item.id === taskId); }
  priority.dataset.field = 'priority'; dependency.dataset.field = 'dependency'; criterionId.dataset.field = 'criterion-id'; requirement.dataset.field = 'requirement';
  scenarioId.dataset.field = 'scenario-id'; scenarioRequirement.dataset.field = 'scenario-requirement'; verifierRef.dataset.field = 'verifier-ref';
  queueId.dataset.field = 'queue-id'; queueTitle.dataset.field = 'queue-title'; queuePriority.dataset.field = 'queue-priority'; queueReadiness.dataset.field = 'queue-readiness';
  function draftState() { return { taskId, priority: priority.value, dependency: dependency.value, depAction: depAction.value, criterionId: criterionId.value,
    requirement: requirement.value, scenarioId: scenarioId.value, scenarioRequirement: scenarioRequirement.value, verifierRef: verifierRef.value }; }
  function setDirty() { dirty = true; onDraftChange(draftState()); }
  for (const control of [priority, dependency, depAction, criterionId, requirement, scenarioId, scenarioRequirement, verifierRef]) control.addEventListener('input', setDirty);
  function preview() {
    const result = dependencyImpact(current, taskId, dependency.value.trim(), depAction.value);
    impact.textContent = dependency.value.trim() ? `${result.reason}${result.affected.length ? ` Affects ${result.affected.join(', ')}.` : ''}` : 'Enter a dependency to preview impact.';
    impact.dataset.valid = String(result.valid); return result;
  }
  dependency.addEventListener('input', preview); depAction.addEventListener('change', preview);
  function load(force = false) {
    const task = selectedTask(); if (!task || (dirty && !force)) return;
    priority.value = String(task.priority); dependency.value = ''; criterionId.value = task.criteria[0]?.id ?? '';
    requirement.value = task.criteria[0]?.requirement ?? ''; scenarioId.value = ''; scenarioRequirement.value = ''; verifierRef.value = '';
    dirty = false; preview();
  }
  function tasks() {
    const value = taskId; taskSelect.replaceChildren(...current.tasks.map(task => option(task.id, task.title)));
    if (current.tasks.some(task => task.id === value)) taskSelect.value = value;
  }
  taskSelect.addEventListener('change', () => { taskId = taskSelect.value; dirty = false; load(true); });
  async function send(command, message) {
    if (readOnlyReason) { status.textContent = `Read only: ${readOnlyReason}`; return; }
    submit.disabled = true; status.textContent = 'Saving…';
    try { const result = await onCommand(command); status.textContent = result.status === 'pending_agent' ? 'Pending agent acknowledgement. Draft saved.' : `${message}: ${result.status}.`; if (!command.operation.endsWith('_queued_plan')) dirty = false; }
    catch (error) { status.textContent = `${error.status === 409 ? 'Conflict' : 'Rejected'}: ${error.message}. Draft retained.`; }
    finally { submit.disabled = false; }
  }
  submit.addEventListener('click', async () => {
    const task = selectedTask(); if (!task) return;
    const nextPriority = Number(priority.value);
    if (!Number.isSafeInteger(nextPriority) || nextPriority < 0) { status.textContent = 'Rejected locally: priority must be a non-negative integer.'; return; }
    if (nextPriority !== task.priority) return send(planningCommand(current, task.id, 'amend_task', { priority: nextPriority }), 'Priority saved');
    if (dependency.value.trim()) {
      const result = preview(); if (!result.valid) { status.textContent = `Rejected locally: ${result.reason}`; return; }
      const operation = depAction.value === 'add' ? 'add_dependency' : 'remove_dependency';
      return send(planningCommand(current, task.id, operation, { prerequisite_id: dependency.value.trim() }), 'Dependency saved');
    }
    const id = criterionId.value.trim(); if (!idPattern.test(id) || !requirement.value.trim()) { status.textContent = 'Rejected locally: criterion ID and requirement are required.'; return; }
    const criterion = task.criteria.find(item => item.id === id);
    if (!criterion) {
      const scenarios = scenarioId.value.trim() ? [{ id: scenarioId.value.trim(), requirement: scenarioRequirement.value.trim(), verifier_ref: verifierRef.value.trim() }] : [];
      if (scenarios.some(item => !idPattern.test(item.id) || !item.requirement || !item.verifier_ref)) { status.textContent = 'Rejected locally: complete the scenario fields.'; return; }
      return send(planningCommand(current, task.id, 'add_criterion', { criterion_id: id, requirement: requirement.value.trim(), applicability: 'required', scenarios }), 'Criterion saved');
    }
    if (scenarioId.value.trim()) {
      if (!idPattern.test(scenarioId.value.trim()) || !scenarioRequirement.value.trim() || !verifierRef.value.trim()) { status.textContent = 'Rejected locally: complete the scenario fields.'; return; }
      const scenario = { id: scenarioId.value.trim(), requirement: scenarioRequirement.value.trim(), verifier_ref: verifierRef.value.trim() };
      return send(planningCommand(current, task.id, criterion.scenarios.some(item => item.id === scenario.id) ? 'amend_scenario' : 'add_scenario', { criterion_id: id, scenario }), 'Scenario saved');
    }
    return send(planningCommand(current, task.id, 'amend_criterion', { criterion_id: id, requirement: requirement.value.trim(), expected_version: criterion.version }), 'Criterion saved');
  });
  undo.addEventListener('click', () => {
    const criterion = selectedTask()?.criteria.find(item => item.id === criterionId.value.trim()); const prior = criterion?.history.at(-1);
    if (!criterion || !prior) { status.textContent = 'No criterion amendment is available to undo.'; return; }
    requirement.value = prior.requirement; dirty = true;
    send(planningCommand(current, taskId, 'amend_criterion', { criterion_id: criterion.id, requirement: prior.requirement, expected_version: criterion.version }), 'Undo recorded as a new amendment');
  });
  queueSubmit.addEventListener('click', () => {
    const id = queueId.value.trim(); const title = queueTitle.value.trim(); const p = Number(queuePriority.value);
    if (!idPattern.test(id) || !title || !Number.isSafeInteger(p) || p < 0) { status.textContent = 'Rejected locally: queue ID, title and priority are required.'; return; }
    send(planningCommand(current, id, 'create_queued_plan', { plan: { id, project_id: current.project_id, title, priority: p, readiness: queueReadiness.value, prerequisites: [], decision_id: null, revision: 0 } }), 'Queued plan created');
  });
  function renderQueue() {
    queueRoot.replaceChildren(element('h3', '', 'Project queue'), field('Plan ID', queueId), field('Title', queueTitle), field('Priority', queuePriority), field('Readiness', queueReadiness), queueSubmit);
    const list = element('ol', 'queue-edit-list');
    current.queue.forEach((plan, index) => {
      const row = element('li', 'cluster spread'); row.dataset.planId = plan.id; row.append(element('span', '', `${plan.title} · ${plan.readiness} · priority ${plan.priority}`));
      const controls = element('span', 'cluster');
      const edit = button('Edit', () => send(planningCommand(current, plan.id, 'amend_queued_plan', { title: `${plan.title} (edited)`, readiness: plan.readiness, priority: plan.priority, prerequisites: plan.prerequisites, decision_id: plan.decision_id }), 'Queued plan edited'));
      const up = button('Move up', () => { if (!index) return; const ids = current.queue.map(item => item.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; send(planningCommand(current, 'queue', 'reorder_queued_plan', { plan_ids: ids }), 'Queue reordered'); });
      edit.dataset.action = 'queue-edit'; up.dataset.action = 'queue-up';
      controls.append(edit, up); row.append(controls); list.append(row);
    });
    queueRoot.append(list);
  }
  root.append(element('header', 'stack', ''), field('Task', taskSelect), field('Priority', priority), dependencyGrid, impact,
    field('Criterion ID', criterionId), field('Requirement', requirement), scenarioGrid, actions, status, queueRoot);
  root.firstChild.append(element('h2', '', 'Planning edits'), element('p', 'meta', 'Edits are saved to authority; they do not run or verify work.'));
  dependencyGrid.append(field('Dependency action', depAction), field('Prerequisite ID', dependency));
  scenarioGrid.append(field('Scenario ID', scenarioId), field('Scenario requirement', scenarioRequirement), field('Verifier', verifierRef));
  actions.append(submit, undo);
  tasks(); load(true);
  if (initialDraft && current.tasks.some(task => task.id === initialDraft.taskId)) {
    taskId = initialDraft.taskId; taskSelect.value = taskId;
    for (const [control, key] of [[priority, 'priority'], [dependency, 'dependency'], [depAction, 'depAction'], [criterionId, 'criterionId'], [requirement, 'requirement'],
      [scenarioId, 'scenarioId'], [scenarioRequirement, 'scenarioRequirement'], [verifierRef, 'verifierRef']]) if (typeof initialDraft[key] === 'string') control.value = initialDraft[key];
    dirty = true; preview(); status.textContent = 'Unsaved draft restored.';
  }
  renderQueue();
  return { element: root, select(nextTaskId) { if (current.tasks.some(task => task.id === nextTaskId)) { taskId = nextTaskId; taskSelect.value = taskId; load(!dirty); } },
    update(nextSnapshot, options = {}) { current = nextSnapshot; readOnlyReason = options.readOnlyReason ?? null; tasks(); if (!dirty) load(true); renderQueue(); for (const control of root.querySelectorAll('button,input,textarea,select')) control.disabled = Boolean(readOnlyReason); if (readOnlyReason) status.textContent = `Read only: ${readOnlyReason}`; },
    getState() { return { ...draftState(), dirty, status: status.textContent }; } };
}
