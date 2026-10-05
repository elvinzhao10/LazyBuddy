import { createInspector, element, statusChip } from './components.mjs';

const roles = { not_started: 'neutral', running: 'active', finished: 'neutral', cancelled: 'neutral', unverified: 'neutral', verifying: 'active', verified: 'verified', failed: 'failed', stale: 'stale', unavailable: 'unavailable' };

function evidenceList(attempts, context) {
  const list = element('ul', 'evidence-list');
  const evidence = attempts.flatMap(attempt => attempt.evidence.map(item => ({ ...item, attemptId: attempt.id })));
  if (!evidence.length) list.append(element('li', 'meta', 'No evidence is attached to an observed attempt.'));
  for (const item of evidence) {
    const row = element('li');
    const link = element('a', '', item.path);
    link.href = context.evidenceHref(item);
    link.dataset.testid = 'evidence-link';
    link.dataset.evidencePath = item.path;
    if (context.openEvidence) link.addEventListener('click', event => { event.preventDefault(); context.openEvidence(item, link.href); });
    row.append(link, element('span', 'meta', `Attempt ${item.attemptId} · ${item.provenance}`));
    list.append(row);
  }
  return list;
}

function fill(body, snapshot, taskId, context) {
  const scroll = body.scrollTop;
  const focusKey = document.activeElement?.dataset?.evidencePath;
  body.replaceChildren();
  const task = snapshot.tasks.find(item => item.id === taskId);
  if (!task) {
    body.append(element('p', 'meta', 'The selected task is no longer present in this snapshot.'));
    return false;
  }
  body.append(element('p', 'meta', `${task.id} · priority ${task.priority}`), element('h3', '', task.title), element('p', '', task.scope));
  const state = element('div', 'inspector-states');
  const execution = element('div', 'stack');
  execution.append(element('span', 'meta', 'Execution'), statusChip({ state: roles[task.execution], label: task.execution.replace('_', ' ') }));
  const proof = element('div', 'stack');
  proof.append(element('span', 'meta', 'Verification'), statusChip({ state: roles[task.verification], label: task.verification.replace('_', ' ') }));
  state.append(execution, proof); body.append(state);
  if (task.blocker) body.append(element('p', 'inspector-blocker', task.blocker));
  body.append(element('h3', '', 'Criteria'));
  const criteria = element('div', 'stack');
  for (const criterion of task.criteria) {
    const card = element('article', 'criterion-card stack');
    card.append(element('div', 'cluster spread', ''), element('p', '', criterion.requirement));
    card.firstChild.append(element('code', '', `${criterion.id} · version ${criterion.version}`), statusChip({ state: roles[criterion.verification], label: criterion.verification.replace('_', ' ') }));
    for (const scenario of criterion.scenarios) card.append(element('p', 'meta', `Scenario: ${scenario.requirement} · verifier ${scenario.verifier_ref}`));
    for (const historical of criterion.history) card.append(element('p', 'meta', `Historical version ${historical.version}: ${historical.requirement}`));
    criteria.append(card);
  }
  if (!task.criteria.length) criteria.append(element('p', 'meta', 'No criteria are defined.'));
  body.append(criteria, element('h3', '', 'Attempts'));
  const attempts = element('div', 'stack');
  for (const attempt of task.attempts) {
    const card = element('article', 'attempt-card stack');
    card.append(element('code', '', attempt.id), element('p', '', `Execution ${attempt.execution}; proof ${attempt.verification}.`),
      element('p', 'meta', `Plan revision ${attempt.plan_revision}; consumed ${attempt.consumed_plan_revision ?? 'not acknowledged'}; source ${attempt.source_revision ?? 'unavailable'}.`));
    attempts.append(card);
  }
  if (!task.attempts.length) attempts.append(element('p', 'meta', 'No execution attempt has been observed.'));
  body.append(attempts, element('h3', '', 'Evidence'), evidenceList(task.attempts, context));
  body.scrollTop = scroll;
  if (focusKey) body.querySelector(`[data-evidence-path="${CSS.escape(focusKey)}"]`)?.focus();
  return true;
}

export function createTaskInspector({ snapshot, context = {} }) {
  let currentSnapshot = snapshot;
  let taskId = null;
  const body = element('div', 'stack');
  const inspector = createInspector({ title: 'Task details', content: body });
  const safeContext = { evidenceHref: context.evidenceHref ?? (() => '#'), openEvidence: context.openEvidence };
  return { element: inspector.element,
    open(nextTaskId, trigger) { taskId = nextTaskId; fill(body, currentSnapshot, taskId, safeContext); inspector.open(trigger); },
    update(nextSnapshot) { currentSnapshot = nextSnapshot; if (taskId && inspector.element.open && !fill(body, currentSnapshot, taskId, safeContext)) inspector.element.close(); },
    close() { inspector.element.close(); } };
}
