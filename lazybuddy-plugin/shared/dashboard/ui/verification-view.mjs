import { element, statusChip } from './components.mjs';

const roles = { unverified: 'neutral', verifying: 'active', verified: 'verified', failed: 'failed', stale: 'stale', unavailable: 'unavailable' };

function latestAttempt(task, criterion) {
  return task.attempts.filter(attempt => attempt.criterion_id === criterion.id).at(-1) ?? null;
}

function evidenceCell(attempt, context) {
  const cell = element('td');
  if (!attempt?.evidence.length) {
    cell.append(element('span', 'meta', 'No evidence'));
    return cell;
  }
  const list = element('ul', 'evidence-list');
  for (const evidence of attempt.evidence) {
    const item = element('li');
    const link = element('a', '', evidence.path);
    link.dataset.testid = 'evidence-link';
    link.dataset.evidencePath = evidence.path;
    link.href = context.evidenceHref(evidence);
    if (context.openEvidence) link.addEventListener('click', event => { event.preventDefault(); context.openEvidence(evidence, link.href); });
    item.append(link);
    list.append(item);
  }
  cell.append(list);
  return cell;
}

function render(root, snapshot, callbacks, context) {
  const previousScroller = root.querySelector('.table-scroll');
  const viewport = { left: previousScroller?.scrollLeft ?? 0, top: previousScroller?.scrollTop ?? 0 };
  const focused = root.contains(document.activeElement) ? { criterionId: document.activeElement.dataset.criterionId, evidencePath: document.activeElement.dataset.evidencePath } : null;
  root.replaceChildren();
  const header = element('header', 'stack');
  header.append(element('h2', '', 'Verification'), element('p', 'meta', 'Requirement, applicable result, source revision, evidence and review remain separate.'));
  const scroller = element('div', 'table-scroll');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', 'Verification requirements table');
  const table = element('table', 'verification-table');
  const head = element('thead');
  const headingRow = element('tr');
  for (const title of ['Criterion', 'Applicable result', 'Source revision', 'Evidence', 'Review']) headingRow.append(element('th', '', title));
  head.append(headingRow);
  const body = element('tbody');
  for (const task of snapshot.tasks) {
    for (const criterion of task.criteria) {
      const attempt = latestAttempt(task, criterion);
      const row = element('tr');
      const criterionCell = element('th');
      const select = element('button', 'table-select', `${task.title} · ${criterion.requirement}`);
      select.type = 'button';
      select.dataset.taskId = task.id;
      select.dataset.criterionId = criterion.id;
      select.addEventListener('click', event => callbacks.onSelect?.({ taskId: task.id, criterionId: criterion.id, trigger: event.currentTarget }));
      criterionCell.append(select, element('span', 'meta', `Version ${criterion.version} · ${criterion.applicability.replace('_', ' ')}`));
      row.append(criterionCell, element('td', '', attempt ? `${attempt.id} · ${attempt.execution}` : 'No applicable result'),
        element('td', 'mono', attempt?.source_revision ?? 'Unavailable'), evidenceCell(attempt, context));
      const review = element('td');
      review.append(statusChip({ state: roles[criterion.verification], label: criterion.verification.replace('_', ' ') }));
      row.append(review);
      body.append(row);
    }
  }
  if (!body.children.length) {
    const row = element('tr');
    const cell = element('td', 'meta', 'No criteria are present in this snapshot.');
    cell.colSpan = 5; row.append(cell); body.append(row);
  }
  table.append(head, body); scroller.append(table); root.append(header, scroller);
  scroller.scrollLeft = viewport.left; scroller.scrollTop = viewport.top;
  if (focused?.criterionId) root.querySelector(`[data-criterion-id="${CSS.escape(focused.criterionId)}"]`)?.focus();
  else if (focused?.evidencePath) root.querySelector(`[data-evidence-path="${CSS.escape(focused.evidencePath)}"]`)?.focus();
}

export function createVerificationView({ snapshot, callbacks = {}, context = {} }) {
  const safeContext = { evidenceHref: context.evidenceHref ?? (() => '#'), openEvidence: context.openEvidence };
  const root = element('section', 'verification-view');
  root.dataset.testid = 'verification-view';
  render(root, snapshot, callbacks, safeContext);
  return { element: root, update(nextSnapshot) { render(root, nextSnapshot, callbacks, safeContext); } };
}
