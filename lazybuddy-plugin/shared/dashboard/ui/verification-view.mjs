import { button, element, statusChip } from './components.mjs';
import { planningCommand } from './editing.mjs';
import { compareAttempts, compareCriterionVersions, criterionVersions, reviewSubject, verificationRows } from './verification-history.mjs';
import { createCheckpointView } from './checkpoint-view.mjs';

const roles = { unverified: 'neutral', verifying: 'active', verified: 'verified', failed: 'failed', stale: 'stale', unavailable: 'unavailable' };
function field(name, control) {
  const label = element('label', 'stack'); label.append(element('span', 'meta', name), control);
  control.setAttribute('aria-label', name); return label;
}
function select(name, entries, value) {
  const control = document.createElement('select'); control.setAttribute('aria-label', name);
  for (const [id, label] of entries) { const option = element('option', '', label); option.value = id; control.append(option); }
  if (value !== undefined) control.value = value;
  return control;
}
function evidenceCell(attempt, context) {
  const cell = element('td');
  if (!attempt?.evidence.length) { cell.append(element('span', 'meta', 'No evidence')); return cell; }
  const list = element('ul', 'evidence-list');
  for (const evidence of attempt.evidence) {
    const item = element('li'); const link = element('a', '', evidence.path);
    link.dataset.testid = 'evidence-link'; link.dataset.evidencePath = evidence.path;
    link.href = context.evidenceHref?.(evidence) ?? '#';
    if (context.openEvidence) link.addEventListener('click', event => { event.preventDefault(); context.openEvidence(evidence, link.href); });
    item.append(link); list.append(item);
  }
  cell.append(list); return cell;
}

export function createVerificationView({ snapshot, callbacks = {}, context = {}, onCommand, onHistoryQuery }) {
  let current = snapshot; let offset = 0; let selection = null; let detailsSignature = null; let readOnlyReason = null;
  const root = element('section', 'verification-view'); root.dataset.testid = 'verification-view';
  const header = element('header', 'stack');
  header.append(element('h2', '', 'Verification'), element('p', 'meta', 'Inspect current proof, compare history and retain failures as regression scenarios.'));
  const toolbar = element('div', 'verification-toolbar');
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Task or criterion';
  const status = select('Verification status', [['all', 'All states'], ...Object.keys(roles).map(value => [value, value.replaceAll('_', ' ')])]);
  toolbar.append(field('Search verification', search), field('Verification status', status));
  const page = element('div', 'cluster');
  const count = element('span', 'meta'); count.setAttribute('role', 'status');
  const previous = button('Previous criteria', () => { offset = Math.max(0, offset - 25); renderRows(); });
  const next = button('Next criteria', () => { offset += 25; renderRows(); }); page.append(previous, count, next);
  const rows = element('div'); const details = element('section', 'panel stack verification-history'); details.hidden = true;
  const message = element('p', 'meta'); message.setAttribute('role', 'status');
  const refresh = button('Refresh selected history', () => { renderDetails(); }); refresh.hidden = true;
  root.append(header, createCheckpointView(onHistoryQuery), toolbar, page, rows, refresh, details, message);

  function selected() {
    const task = current.tasks.find(item => item.id === selection?.taskId);
    const criterion = task?.criteria.find(item => item.id === selection?.criterionId);
    return { task, criterion };
  }
  function signature() {
    const { task, criterion } = selected();
    return JSON.stringify({ criterion, attempts: task?.attempts.filter(item => item.criterion_id === criterion?.id),
      reviews: current.reviews?.filter(item => item.criterion_id === criterion?.id), context: current.review_context,
      plan_revision: current.plan_revision });
  }
  async function send(command, control) {
    if (!onCommand || readOnlyReason) { message.textContent = readOnlyReason ?? 'Editing is unavailable'; return; }
    control.disabled = true;
    try { const result = await onCommand(command); message.textContent = `${result.status} · revision ${result.revision}`; }
    catch (error) { message.textContent = `Change rejected · ${error.message}`; }
    finally { control.disabled = Boolean(readOnlyReason); }
  }
  function action(label, captured, taskId, operation, payload) {
    const control = button(label, () => send(planningCommand(captured, taskId, operation, typeof payload === 'function' ? payload() : payload), control));
    control.dataset.verificationMutation = 'true'; control.disabled = !onCommand || Boolean(readOnlyReason); return control;
  }
  function renderDetails() {
    const { task, criterion } = selected(); details.hidden = !criterion; refresh.hidden = true;
    if (!criterion) return;
    detailsSignature = signature(); const captured = current;
    details.replaceChildren(element('h3', '', `${task.title} · ${criterion.id}`));
    if (callbacks.onSelect) details.append(button('Inspect task and evidence', event => callbacks.onSelect({ taskId: task.id, criterionId: criterion.id, trigger: event.currentTarget })));
    const versions = criterionVersions(criterion);
    const versionEntries = versions.map(item => [String(item.version), `Version ${item.version}`]);
    const before = select('Earlier criterion version', versionEntries, String(versions.at(-2)?.version ?? criterion.version));
    const after = select('Later criterion version', versionEntries, String(criterion.version));
    const versionControls = element('div', 'verification-toolbar'); versionControls.append(field('Earlier criterion version', before), field('Later criterion version', after));
    const versionText = element('div', 'stack');
    const compareVersions = () => {
      const comparison = compareCriterionVersions(criterion, Number(before.value), Number(after.value));
      versionText.replaceChildren(); if (!comparison) return;
      versionText.append(element('p', '', `Before: ${comparison.before.requirement}`), element('p', '', `After: ${comparison.after.requirement}`),
        element('p', 'meta', comparison.scenarios_observed
          ? `Scenarios: ${comparison.added.length} added · ${comparison.removed.length} removed · ${comparison.changed.length} changed`
          : 'Earlier scenario definitions were not retained by this older record.'));
      for (const [label, version] of [['Before', comparison.before], ['After', comparison.after]]) {
        const list = element('ul');
        for (const scenario of version.scenarios ?? []) list.append(element('li', '', `${scenario.id}: ${scenario.requirement} · ${scenario.verifier_ref}${scenario.origin ? ` · failure ${scenario.origin.attempt_id}` : ''}`));
        const disclosure = element('details'); disclosure.append(element('summary', '', `${label} scenario definitions (${version.scenarios?.length ?? 'unreported'})`), list); versionText.append(disclosure);
      }
    };
    before.addEventListener('change', compareVersions); after.addEventListener('change', compareVersions); compareVersions();
    details.append(element('h4', '', 'Criterion and scenario history'), versionControls, versionText);
    const attempts = task.attempts.filter(item => item.criterion_id === criterion.id);
    const attemptEntries = attempts.map(item => [item.id, `${item.id} · ${item.execution} · criterion v${item.criterion_version ?? '?'}`]);
    const left = select('Earlier attempt', attemptEntries, attempts.at(-2)?.id ?? attempts[0]?.id);
    const right = select('Later attempt', attemptEntries, attempts.at(-1)?.id);
    const attemptControls = element('div', 'verification-toolbar'); attemptControls.append(field('Earlier attempt', left), field('Later attempt', right));
    const attemptText = element('div', 'stack');
    const compareResults = () => {
      const first = attempts.find(item => item.id === left.value); const second = attempts.find(item => item.id === right.value);
      const result = compareAttempts(first, second); attemptText.replaceChildren();
      attemptText.append(element('p', '', result.comparable ? 'Matching source, criterion and consumed plan subject' : `Incomparable: ${result.reasons.join('; ')}`));
      if (first && second) attemptText.append(element('p', 'meta', `${first.execution} → ${second.execution} · evidence ${first.evidence.length} → ${second.evidence.length}`), element('p', 'mono', `Sources: ${first.source_revision ?? 'unreported'} / ${second.source_revision ?? 'unreported'}`));
    };
    left.addEventListener('change', compareResults); right.addEventListener('change', compareResults); compareResults();
    details.append(element('h4', '', `Attempt comparison (${attempts.length} retained)`), attemptControls, attemptText);
    const failed = attempts.filter(item => item.execution === 'failed');
    if (failed.length) {
      const disclosure = element('details', 'stack'); disclosure.append(element('summary', '', 'Create regression scenario from a failure'));
      const failure = select('Failed attempt', failed.map(item => [item.id, item.id]));
      const scenarioId = document.createElement('input'); scenarioId.value = `regression:${criterion.id}:${criterion.version}`;
      const requirement = document.createElement('textarea'); requirement.value = criterion.requirement;
      const verifier = document.createElement('input'); verifier.value = criterion.scenarios[0]?.verifier_ref ?? '';
      disclosure.append(field('Failed attempt', failure), field('Regression scenario ID', scenarioId), field('Regression requirement', requirement), field('Verifier reference', verifier),
        action('Save regression scenario', captured, task.id, 'promote_failure', () => ({ criterion_id: criterion.id, expected_version: criterion.version,
          attempt_id: failure.value || failed[0].id, scenario: { id: scenarioId.value, requirement: requirement.value, verifier_ref: verifier.value } })));
      details.append(disclosure);
    }
    const subject = reviewSubject(captured, criterion);
    const reviews = (current.reviews ?? []).filter(item => item.task_id === task.id && item.criterion_id === criterion.id);
    const reviewList = element('div', 'stack');
    details.append(element('h4', '', 'Local rerun review'), element('p', 'meta', 'Review records a decision on this revision. Native host permissions and independent verification still apply.'), reviewList);
    if (subject.plan_sha256 && subject.content_sha256) reviewList.append(action('Request rerun review', captured, task.id, 'request_review', () => ({ review_id: `review:${globalThis.crypto.randomUUID()}`, criterion_id: criterion.id, action: 'rerun_criterion', subject })));
    else reviewList.append(element('p', 'meta', 'Review unavailable: a stable source and plan capture is required.'));
    for (const review of reviews) {
      const entry = element('details', 'stack'); entry.append(element('summary', '', `${review.id} · ${review.state}${review.current ? '' : ' · stale subject'}`), element('p', 'meta', `Requested by ${review.requested_by} · decision by ${review.decided_by ?? 'unreported'} · ${review.rationale ?? 'No decision yet'}`));
      if (review.current && review.state === 'pending') {
        const rationale = document.createElement('textarea'); entry.append(field('Review rationale', rationale));
        for (const decision of ['approved', 'rejected']) entry.append(action(decision === 'approved' ? 'Approve this rerun' : 'Reject this rerun', captured, task.id, 'resolve_review', () => ({ review_id: review.id, subject: review.subject, decision, rationale: rationale.value })));
      }
      if (review.current && review.state === 'approved') entry.append(element('p', 'meta', 'Approved for this revision; awaiting native dispatch.'));
      if (review.consumed_attempt_id) entry.append(element('p', 'mono', `Admitted ${review.consumed_role} attempt ${review.consumed_attempt_id}`));
      reviewList.append(entry);
    }
    const decisions = (current.decisions ?? []).filter(item => item.scope.includes(task.id));
    if (decisions.length) {
      const list = element('ul');
      for (const decision of decisions) list.append(element('li', '', `${decision.title} · ${decision.state} · ${decision.choice ?? 'No choice recorded'} · alternatives: ${decision.alternatives.join('; ') || 'none recorded'} · supersedes ${decision.supersedes ?? 'none'}`));
      details.append(element('h4', '', 'Decision history'), list);
    }
  }
  function renderRows() {
    const previousScroller = rows.querySelector('.table-scroll');
    const viewport = { left: previousScroller?.scrollLeft ?? 0, top: previousScroller?.scrollTop ?? 0 };
    const focus = rows.contains(document.activeElement) ? { criterion: document.activeElement.dataset.criterionId,
      evidence: document.activeElement.dataset.evidencePath, region: document.activeElement === previousScroller } : null;
    const pageData = verificationRows(current, { query: search.value, status: status.value || 'all', offset }); offset = pageData.offset;
    count.textContent = `${pageData.total ? offset + 1 : 0}–${Math.min(offset + 25, pageData.total)} of ${pageData.total} criteria`;
    previous.disabled = offset === 0; next.disabled = offset + 25 >= pageData.total;
    const scroller = element('div', 'table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Verification requirements table');
    const table = element('table', 'verification-table'); const head = element('thead'); const headings = element('tr');
    for (const title of ['Criterion', 'Applicable result', 'Source revision', 'Evidence', 'Review']) headings.append(element('th', '', title));
    head.append(headings); const body = element('tbody');
    for (const { task, criterion } of pageData.rows) {
      const attempt = task.attempts.find(item => item.id === criterion.current_attempt_id);
      const row = element('tr'); const title = element('th');
      const control = button(`${task.title} · ${criterion.requirement}`, () => { selection = { taskId: task.id, criterionId: criterion.id }; renderDetails(); });
      control.className = 'table-select'; control.dataset.taskId = task.id; control.dataset.criterionId = criterion.id;
      title.append(control, element('span', 'meta', `Version ${criterion.version} · ${criterion.applicability.replaceAll('_', ' ')}`));
      const review = element('td'); review.append(statusChip({ state: roles[criterion.verification], label: criterion.verification.replaceAll('_', ' ') }));
      row.append(title, element('td', '', attempt ? `${attempt.id} · ${attempt.execution}` : 'No applicable attempt'), element('td', 'mono', attempt?.source_revision ?? 'Unavailable'), evidenceCell(attempt, context), review); body.append(row);
    }
    if (!pageData.total) { const row = element('tr'); const cell = element('td', 'meta', 'No matching criteria.'); cell.colSpan = 5; row.append(cell); body.append(row); }
    table.append(head, body); scroller.append(table); rows.replaceChildren(scroller);
    scroller.scrollLeft = viewport.left; scroller.scrollTop = viewport.top;
    if (focus?.criterion) rows.querySelector(`[data-criterion-id="${CSS.escape(focus.criterion)}"]`)?.focus();
    else if (focus?.evidence) rows.querySelector(`[data-evidence-path="${CSS.escape(focus.evidence)}"]`)?.focus();
    else if (focus?.region) scroller.focus();
  }
  search.addEventListener('input', () => { offset = 0; renderRows(); }); status.addEventListener('change', () => { offset = 0; renderRows(); });
  renderRows();
  return { element: root, update(nextSnapshot, options = {}) {
    const unchanged = JSON.stringify(current) === JSON.stringify(nextSnapshot); current = nextSnapshot;
    readOnlyReason = options.readOnlyReason ?? null;
    for (const control of details.querySelectorAll('[data-verification-mutation]')) control.disabled = !onCommand || Boolean(readOnlyReason);
    if (!unchanged) renderRows();
    if (selection && detailsSignature !== signature()) refresh.hidden = false;
  } };
}
