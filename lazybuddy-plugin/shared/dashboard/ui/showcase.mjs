import { element, statusChip, taskCard, field, button, notice, createInspector } from './components.mjs';

const states = {
  ready: { state: 'neutral', title: 'Ready example', detail: 'Select a task to inspect its separate execution and verification states.' },
  empty: { state: 'neutral', title: 'No plan selected', detail: 'Choose a plan in the host to begin. This example has no execution observations.' },
  loading: { state: 'active', title: 'Loading snapshot', detail: 'Waiting for the first authoritative snapshot. No progress has been inferred.' },
  disconnected: { state: 'attention', title: 'Disconnected · Last observed snapshot', detail: 'Reconnect and reconcile the revision before editing. Last observed activity is not current activity.' },
  pending: { state: 'attention', title: 'Saved · Pending agent', detail: 'Example plan revision 8 is saved. The running attempt still uses revision 7; no consumption acknowledgement is available.' },
  conflict: { state: 'attention', title: 'Conflict · Compare revisions', detail: 'Your draft uses revision 7; the example current plan is revision 8. Keep the draft and compare before saving again.' },
  unavailable: { state: 'unavailable', title: 'Observation unavailable', detail: 'This host has not supplied execution observations. Open the original host surface for more information.' },
  stale: { state: 'stale', title: 'Evidence stale · Criterion changed', detail: 'Evidence for criterion version 1 remains historical. Version 2 needs a new applicable result.' },
};
const statuses = [
  ['neutral', 'Not started'], ['active', 'Executing'], ['active', 'Verifying'],
  ['verified', 'Verified'], ['attention', 'Blocked / needs input'], ['failed', 'Failed'],
  ['stale', 'Stale'], ['unavailable', 'Unavailable'], ['neutral', 'Finished · Unverified'],
];
document.querySelector('#status-inventory').append(...statuses.map(([state, label]) => statusChip({ state, label })));
document.querySelector('#notice-inventory').append(...Object.values(states).slice(1).map(notice));

const inspectorBody = element('div', 'stack');
inspectorBody.append(element('p', 'fixture-label', 'Showcase task · Join'), notice({ state: 'attention', title: 'Waiting for removal evidence', detail: 'Installer recovery can finish only after the removal branch supplies an applicable result.' }), element('h3', '', 'Execution and proof'), element('p', '', 'Execution: Not started. Verification: Unverified. Evidence from earlier criteria remains historical.'), element('h3', '', 'Criterion version 2'), element('p', '', 'Offboarding preserves unrelated files. Scenario: compare the caller-owned files before and after removal. Verifier reference: removal-regression.'), element('p', 'meta', 'Evidence unavailable in this fixture. Supporting evidence links are supplied by C1’s validated adapter.'));
const inspector = createInspector({ title: 'Task details', content: inspectorBody });
document.body.append(inspector.element);
const tasks = [
  { id: 'Setup', title: 'Prepare isolated workspace', execution: { state: 'neutral', label: 'Finished' }, verification: { state: 'verified', label: 'Verified' }, progress: '2 of 2 required checks · criterion v1' },
  { id: 'Install', title: 'Check installation', execution: { state: 'active', label: 'Running · attempt 2' }, verification: { state: 'active', label: 'Verifying' }, progress: '1 of 3 required checks · criterion v2' },
  { id: 'Remove', title: 'Check removal safety', execution: { state: 'failed', label: 'Failed' }, verification: { state: 'failed', label: 'Failed' }, progress: '0 of 2 required checks · criterion v2' },
  { id: 'Recover', title: 'Check recovery', execution: { state: 'active', label: 'Running · attempt 1' }, verification: { state: 'neutral', label: 'Unverified' }, progress: '0 of 2 required checks · criterion v1' },
  { id: 'Join', title: 'Release readiness', execution: { state: 'attention', label: 'Blocked' }, verification: { state: 'neutral', label: 'Unverified' }, progress: 'Waiting for removal evidence · criterion v2' },
  { id: 'Legacy', title: 'Legacy done record', execution: { state: 'neutral', label: 'Finished' }, verification: { state: 'neutral', label: 'Unverified' }, progress: 'No applicable completion receipt' },
  { id: 'Stopped', title: 'Interrupted attempt', execution: { state: 'neutral', label: 'Cancelled' }, verification: { state: 'stale', label: 'Stale' }, progress: 'Historical result is not current proof' },
];
const lanes = [element('div', 'graph-lane'), element('div', 'graph-lane'), element('div', 'graph-lane')];
lanes[1].append(element('p', 'relation', 'After Setup · Three parallel-ready branches'));
lanes[2].append(element('p', 'relation', 'After Install, Remove and Recover'));
for (const task of tasks) {
  const card = taskCard({ ...task, onSelect(event) {
    document.querySelectorAll('[data-testid="task-node"]').forEach(node => {
      const selected = node === event.currentTarget;
      node.setAttribute('aria-pressed', String(selected));
    });
    inspectorBody.firstChild.textContent = `Showcase task · ${task.id}`;
    inspectorBody.children[1].replaceWith(notice({ state: task.verification.state, title: task.title, detail: task.progress }));
    inspectorBody.children[3].textContent = `Execution: ${task.execution.label}. Verification: ${task.verification.label}. ${task.progress}.`;
    inspectorBody.children[4].textContent = 'Applicable requirement';
    inspectorBody.children[5].textContent = task.id === 'Join' || task.id === 'Remove' ? 'Offboarding preserves unrelated files. Scenario: compare caller-owned files before and after removal. Verifier reference: removal-regression.' : 'Select the task’s applicable criterion and scenario in the live integration. This component fixture does not supply an evidence artifact.';
    inspector.open(event.currentTarget);
  } });
  lanes[task.id === 'Setup' || task.id === 'Legacy' || task.id === 'Stopped' ? 0 : task.id === 'Join' ? 2 : 1].append(card);
}
document.querySelector('#task-inventory').append(...lanes);

const criterion = document.querySelector('#criterion-example');
const form = element('form', 'stack');
form.dataset.testid = 'criterion-editor';
const requirement = field({ label: 'Criterion', name: 'criterion', value: 'Offboarding preserves unrelated files', multiline: true });
const scenario = field({ label: 'Verification scenario', name: 'scenario', value: 'Compare caller-owned files before and after removal', multiline: true });
const verifier = field({ label: 'Verifier reference', name: 'verifier', value: 'removal-regression' });
for (const wrapper of [requirement, scenario, verifier]) wrapper.lastChild.required = true;
const editStatus = element('p', 'meta', 'Draft · Example revision 7');
editStatus.dataset.testid = 'edit-status';
editStatus.setAttribute('role', 'status');
const save = button('Save example', null, { primary: true });
save.type = 'submit'; save.dataset.testid = 'edit-submit';
const cancel = button('Discard draft', () => { form.reset(); editStatus.textContent = 'Draft discarded · No command sent'; });
const actions = element('div', 'cluster'); actions.append(save, cancel);
form.append(requirement, scenario, verifier, actions, editStatus);
criterion.append(element('h3', '', 'Criterion & scenario'), form);
form.addEventListener('submit', event => {
  event.preventDefault();
  const mode = document.querySelector('#surface-state').value;
  editStatus.textContent = mode === 'conflict' ? 'Conflict · Draft retained. Compare example revision 7 with revision 8.' : 'Saved example · Pending agent · No command sent';
});

const dependency = document.querySelector('#dependency-example');
const priorityLabel = element('label', '', 'Task priority');
const priority = element('select'); priority.name = 'priority';
for (const value of ['Normal', 'High', 'Low']) { const option = element('option', '', value); priority.append(option); }
priorityLabel.append(priority);
const edgeLabel = element('label', '', 'Proposed dependency');
const edge = element('select'); edge.name = 'dependency';
for (const value of ['Remove → Join', 'Join → Setup (cycle example)']) edge.append(element('option', '', value));
edgeLabel.append(edge);
const impact = element('p', '', 'Preview: Join waits for removal evidence. Two current checks would become stale; historical evidence stays available.');
impact.setAttribute('role', 'status');
dependency.append(element('h3', '', 'Priority & dependency impact'), priorityLabel, edgeLabel, impact, button('Preview dependency', () => {
  impact.textContent = edge.selectedIndex === 1 ? 'Rejected example · Cycle: Setup → Remove → Join → Setup. No dependency changed.' : 'Valid example · Join depends on Remove. Two checks affected; nothing applied.';
}), element('p', 'meta', 'Local preview only. C1 must validate dependencies with the command service.'));

const queue = document.querySelector('#queue-example');
queue.append(element('h3', '', 'Project queue'));
const queueList = element('ol', 'queue'); queueList.dataset.testid = 'queue-list';
for (const [title, state, label] of [['Repair removal check', 'neutral', 'Ready · High priority'], ['Package sibling adapters', 'attention', 'Held · Needs verified core'], ['Explore timeline', 'neutral', 'Draft · Normal priority']]) {
  const row = element('li', ''); row.append(element('p', '', title), statusChip({ state, label })); queueList.append(row);
}
const queueStatus = element('p', 'meta', 'Example queue revision 3'); queueStatus.setAttribute('role', 'status');
queue.append(queueList, button('Move draft earlier', () => { queueList.insertBefore(queueList.lastElementChild, queueList.firstElementChild); queueStatus.textContent = 'Reordered example · No execution scheduled'; }), queueStatus);
const decision = document.querySelector('#decision-example');
decision.append(element('h3', '', 'Decisions'), notice({ state: 'attention', title: 'Unresolved · Removal policy', detail: 'Choose whether generated logs should be retained. Affects removal criterion version 2. Discuss in the existing chat.' }), notice({ state: 'neutral', title: 'Adopted · Browser fallback', detail: 'Use the browser while embedding is unobserved. Alternative: a host panel after explicit capability verification.' }), notice({ state: 'neutral', title: 'Superseded · Delete all logs', detail: 'Amended to preserve caller-owned files. Original decision remains historical.' }));

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
function updateSurface() {
  const mode = document.querySelector('#surface-state').value;
  document.querySelector('#surface-notice').replaceChildren(notice(states[mode]));
  const locked = ['empty', 'loading', 'disconnected', 'unavailable'].includes(mode);
  for (const control of form.elements) control.disabled = locked;
  priority.disabled = locked; edge.disabled = locked;
  document.querySelectorAll('#dependency-example button, #queue-example button').forEach(control => { control.disabled = locked; });
  editStatus.textContent = locked ? 'Editing unavailable in this state · Reconcile a connected snapshot first' : mode === 'pending' ? 'Saved example · Pending agent · Attempt uses revision 7' : mode === 'conflict' ? 'Conflict · Draft retained at revision 7; current example revision 8' : 'Draft · Example revision 7';
}
document.querySelector('#surface-state').addEventListener('change', updateSurface);
document.querySelector('#long-content').addEventListener('click', event => {
  const expanded = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(expanded));
  event.currentTarget.textContent = `Long content: ${expanded ? 'On' : 'Off'}`;
  document.querySelector('[data-task-id="Join"] .task-title').textContent = expanded ? `Release readiness — verify caller-owned files including ${'unbroken-reference-'.repeat(12)}` : 'Release readiness';
  requirement.lastChild.value = expanded ? `Preserve caller-owned content: ${'verylongunbrokenfilename'.repeat(12)}` : 'Offboarding preserves unrelated files';
});
updateSurface();
document.querySelector('#load-status').textContent = 'Component examples ready.';
document.querySelector('#component-content').hidden = false;
for (const control of document.querySelectorAll('#theme, #surface-state, #long-content')) control.disabled = false;
