import {
  element, statusChip, taskCard, field, button, notice, createInspector, installNativeExperience,
  card, dataTable, rowList, formField, destructiveAction, graphNode, timelineChart, inspectorPanel,
  skeleton, emptyState, metricTile, sidebarNav, createTabs, createDockPanel,
} from './components.mjs';

/* -- App shell (T12): sidebar rail + tab strip + dock. Built FIRST so the
   theme/density controls live in the rail footer before the T11 native
   layer mounts its density segmented control beside them. ----------------- */
const shellStatus = element('p', 'meta', 'App shell examples · mock destinations only');
shellStatus.dataset.testid = 'shell-status';
shellStatus.setAttribute('role', 'status');
const themeSelect = element('select');
themeSelect.id = 'theme';
themeSelect.disabled = true;
for (const [value, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
  const option = element('option', '', label);
  option.value = value;
  themeSelect.append(option);
}
const themeLabel = element('label', '', 'Theme');
themeLabel.append(themeSelect);
const objectTree = element('ul', 'evidence-list');
for (const id of ['plan:removal · v2', 'criterion:offboard · v2', 'run:8f2 · attempt 2']) {
  const item = element('li', '');
  item.append(element('code', '', id));
  objectTree.append(item);
}
const sidebar = sidebarNav({
  product: 'LazySeries',
  runtime: 'LazyBuddy',
  current: 'overview',
  destinations: [
    { id: 'overview', label: 'Overview' },
    { id: 'project', label: 'Project' },
    { id: 'plans', label: 'Plans' },
    { id: 'execution', label: 'Execution' },
    { id: 'git', label: 'Git' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'research', label: 'Research' },
  ],
  tree: objectTree,
  footer: [themeLabel],
  onNavigate: id => { shellStatus.textContent = `Destination: ${id} (mock — the showcase loads no real view)`; },
  onCollapse: collapsed => { shellStatus.textContent = collapsed ? 'Sidebar collapsed to the icon rail' : 'Sidebar expanded'; },
});
const homeTab = element('div', 'stack');
homeTab.append(
  element('p', '', '3 of 7 criteria verified across 2 runs; 1 attention item. Everything below is the same component library.'),
  element('div', 'cluster', ''),
);
homeTab.querySelector('.cluster').append(
  metricTile({ value: 3, label: 'verified', coverage: { state: 'verified', label: '3 of 7' } }),
  metricTile({ value: 1, label: 'running', coverage: { state: 'active', label: 'attempt 2' } }),
  metricTile({ value: '—', label: 'observed', unavailable: true, coverage: { state: 'unavailable', label: 'not observed' } }),
);
const planTab = element('div', 'stack');
planTab.append(
  formField({ label: 'Retirement reason', name: 'shell-reason', value: 'Superseded by the offboarding flow', help: 'Edit here, switch to another tab, come back — panel state survives the switch.', testid: 'shell-persist-field' }),
  element('p', 'meta', 'Panels are hidden, never destroyed, so drafts and selections survive tab switches and polling ticks.'),
);
const runTab = element('div', 'stack');
runTab.append(rowList({
  items: [
    { title: 'attempt 2 · install', meta: 'running · attempt observed 14:02', trailing: { state: 'active', label: 'Running' } },
    { title: 'attempt 3 · remove', meta: 'failed · exit 1', trailing: { state: 'failed', label: 'Failed' } },
    { title: 'attempt 1 · setup', meta: 'finished · unverified', trailing: { state: 'neutral', label: 'Unverified' } },
  ],
  testid: 'shell-run-rows',
}));
const tabs = createTabs({
  current: 'home',
  tabs: [
    { id: 'home', title: 'Home', pinned: true, content: homeTab },
    { id: 'plan-removal', title: 'Plan · removal', content: planTab },
    { id: 'run-8f2', title: 'Run 8f2', content: runTab },
  ],
  onChange: (id, kind) => { if (kind === 'select') shellStatus.textContent = `Tab: ${id}`; },
});
const dockBody = element('div', 'stack');
dockBody.append(
  element('p', '', 'The dock replaces inline inspector regions: one elevation-2 surface, header/content/footer, Escape closes it and focus returns to the invoking control.'),
  notice({ state: 'verified', title: 'Criterion verified', detail: 'Applicable evidence was observed for criterion version 2.' }),
);
const dock = createDockPanel({ title: 'Inspector dock', content: dockBody, footer: [button('Apply example', null, { primary: true }), button('Dismiss', null)] });
document.body.append(dock.element);
const dockTrigger = button('Toggle inspector dock', event => dock.toggle(event.currentTarget));
dockTrigger.dataset.testid = 'dock-trigger';
const shellHeader = element('div', 'cluster spread');
shellHeader.append(shellStatus, dockTrigger);
const shellMain = element('div', 'lb-shell-main');
shellMain.append(shellHeader, tabs.element);
const shellFrame = element('div', 'lb-shell');
shellFrame.append(sidebar.element, shellMain);
const shellHost = document.querySelector('#shell-inventory');
const shellDemo = element('div', 'lb-shell-demo');
shellDemo.append(shellFrame);
shellHost.append(shellDemo, element('p', 'meta', 'Keyboard: j/k walks destinations; ←/→, Home/End and ⌘/Ctrl+1..9 switch tabs; Delete closes the focused closable tab; Escape collapses the dock.'));

const experience = installNativeExperience(); // T11 native layer: focus system, density control, tooltips (idempotent)

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

/* -- Cards ---------------------------------------------------------------- */
const cardResting = card({
  title: 'Attempt 2 · Install check',
  meta: 'Observed 14:02:11 · revision 7',
  body: [element('p', '', 'Cards carry one density-driven padding, an optional header and footer, and rest on borders.'),
    element('div', 'cluster', '')],
  footer: [button('Open inspector example', null), statusChip({ state: 'active', label: 'Running' })],
  testid: 'card-resting',
});
cardResting.querySelector('.cluster').append(statusChip({ state: 'verified', label: '2 of 3 checks' }));
const cardRaised = card({
  title: 'Raised surface',
  meta: 'data-elevation="raised" · the first ladder step',
  body: element('p', '', 'Transient emphasis only: the raised step is for popovers and one moment of attention, never for whole pages.'),
  elevation: 'raised',
  testid: 'card-raised',
});
const cardBare = card({ body: [element('p', '', 'A card without a header stays quiet — the body leads.'), element('p', 'meta', 'Footer slot omitted here.')], testid: 'card-bare' });
document.querySelector('#card-inventory').append(cardResting, cardRaised, cardBare);

/* -- Data table & rows ---------------------------------------------------- */
const tableColumns = [
  { key: 'task', label: 'Task' },
  { key: 'execution', label: 'Execution' },
  { key: 'checks', label: 'Checks passed', numeric: true },
  { key: 'attempts', label: 'Attempts', numeric: true },
  { key: 'age', label: 'Age (min)', numeric: true },
];
const tableRows = [
  { task: 'Prepare isolated workspace', execution: 'Finished', checks: 2, attempts: 1, age: 128 },
  { task: 'Check installation', execution: 'Running', checks: 1, attempts: 2, age: 64 },
  { task: 'Check removal safety', execution: 'Failed', checks: 0, attempts: 3, age: 47 },
  { task: 'Check recovery', execution: 'Running', checks: 0, attempts: 1, age: 31 },
  { task: 'Release readiness', execution: 'Blocked', checks: 0, attempts: 0, age: 12 },
  { task: 'Legacy done record', execution: 'Finished', checks: 2, attempts: 1, age: 411 },
  { task: 'Interrupted attempt', execution: 'Cancelled', checks: 0, attempts: 2, age: 96 },
  { task: 'Package sibling adapters', execution: 'Not started', checks: 0, attempts: 0, age: 0 },
  { task: 'Explore timeline', execution: 'Not started', checks: 0, attempts: 0, age: 0 },
  { task: 'Retire legacy evidence', execution: 'Stale', checks: 1, attempts: 1, age: 240 },
  { task: 'Verify offboarding scope', execution: 'Verifying', checks: 1, attempts: 1, age: 8 },
  { task: 'Mirror queue admission', execution: 'Not started', checks: 0, attempts: 0, age: 0 },
];
document.querySelector('#table-inventory').append(dataTable({
  columns: tableColumns, rows: tableRows,
  caption: 'Observed attempts · counts are exact observations, never inferred progress',
  testid: 'library-table',
}));
document.querySelector('#table-inventory').append(rowList({
  items: [
    { title: 'Repair removal check', meta: 'Ready · High priority · revision 2', trailing: { state: 'neutral', label: 'Ready' } },
    { title: 'Package sibling adapters', meta: 'Held · Needs verified core · revision 2', trailing: { state: 'attention', label: 'Held' } },
    { title: 'Explore timeline', meta: 'Draft · Normal priority · revision 2', trailing: { state: 'neutral', label: 'Draft' } },
  ],
  testid: 'library-rows',
}));

/* -- Form controls -------------------------------------------------------- */
const formPanel = element('div', 'stack');
formPanel.dataset.testid = 'form-examples';
const formStatus = element('p', 'meta', 'Form examples · nothing is dispatched');
formStatus.dataset.testid = 'form-status';
formStatus.setAttribute('role', 'status');
const liveLabel = { value: 'removal-regression' };
const liveField = formField({ label: 'Verifier reference', name: 'live-verifier', value: liveLabel.value, help: 'Registry key of the verifier this criterion must satisfy.', testid: 'live-field' });
const liveInput = liveField.querySelector('input');
let liveError = null;
function clearLiveError() {
  liveField.removeAttribute('data-invalid');
  liveInput.removeAttribute('aria-invalid');
  if (liveError) { liveError.remove(); liveError = null; liveInput.setAttribute('aria-describedby', liveField.querySelector('.lb-field-help').id); }
}
function showLiveError(message) {
  liveField.dataset.invalid = 'true';
  liveInput.setAttribute('aria-invalid', 'true');
  if (!liveError) {
    liveError = element('span', 'lb-field-error', message);
    liveError.dataset.testid = 'field-error';
    liveError.id = 'live-field-error';
    liveField.append(liveError);
    liveInput.setAttribute('aria-describedby', `${liveField.querySelector('.lb-field-help').id} ${liveError.id}`);
  } else liveError.textContent = message;
}
liveInput.addEventListener('blur', () => { if (liveInput.value.trim() === '') showLiveError('A verifier reference is required before this criterion can be saved.'); else clearLiveError(); });
liveInput.addEventListener('input', () => { if (liveInput.value.trim() !== '') clearLiveError(); });
const invalidField = formField({ label: 'Successor plan', name: 'successor', value: '', help: 'Applies only after the current plan is retired.', error: 'No plan matches “removed-plan” — pick an existing plan id.', required: true, testid: 'invalid-field' });
const requiredField = formField({ label: 'Retirement reason', name: 'reason', value: 'Superseded by the offboarding flow', required: true, multiline: true, help: 'Recorded with the transition; shown in the history inspector.', testid: 'required-field' });
const destructive = destructiveAction({
  label: 'Discard draft example',
  undoLabel: 'Undo discard',
  onCommit: () => { formPanel.dataset.discarded = 'true'; },
  onUndo: () => { delete formPanel.dataset.discarded; },
  onAnnounce: message => { formStatus.textContent = `${message} · no command sent`; },
});
const interactiveRow = element('div', 'cluster');
const pressed = button('Pressed state: Off', event => {
  const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(on));
  event.currentTarget.textContent = `Pressed state: ${on ? 'On' : 'Off'}`;
});
pressed.setAttribute('aria-pressed', 'false');
const disabledPrimary = button('Disabled primary', null, { primary: true });
disabledPrimary.disabled = true;
const disabledPlain = button('Disabled', null);
disabledPlain.disabled = true;
interactiveRow.append(pressed, disabledPrimary, disabledPlain);
formPanel.append(liveField, invalidField, requiredField, destructive, interactiveRow, formStatus);

const criterionPanel = element('div', 'panel stack');
criterionPanel.dataset.testid = 'criterion-editor-panel';
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
criterionPanel.append(element('h3', '', 'Criterion & scenario'), form);
form.addEventListener('submit', event => {
  event.preventDefault();
  const mode = document.querySelector('#surface-state').value;
  editStatus.textContent = mode === 'conflict' ? 'Conflict · Draft retained. Compare example revision 7 with revision 8.' : 'Saved example · Pending agent · No command sent';
});
document.querySelector('#form-inventory').append(formPanel, criterionPanel);

/* -- Graph node cards ------------------------------------------------------ */
const nodeHost = document.querySelector('#node-inventory');
const nodeStates = [
  { id: 'node-selected', title: 'Install check', state: 'neutral', detail: 'Selected · selection intent is the product accent', selected: true },
  { id: 'node-running', title: 'Recovery check', state: 'active', detail: 'Running · attempt 1 · raised one step', badge: { state: 'active', label: 'Running' } },
  { id: 'node-blocked', title: 'Release readiness', state: 'attention', detail: 'Blocked · waiting for removal evidence', badge: { state: 'attention', label: 'Blocked' } },
  { id: 'node-failed', title: 'Removal safety', state: 'failed', detail: 'Failed · attempt 3', badge: { state: 'failed', label: 'Failed' } },
  { id: 'node-stale', title: 'Legacy done record', state: 'stale', detail: 'Stale · historical result is not current proof' },
  { id: 'node-unavailable', title: 'Host observation', state: 'unavailable', detail: 'Hollow · this host supplied no observations' },
  { id: 'node-long', title: 'Verify caller-owned files including very-long-unbroken-reference-name-example', state: 'neutral', detail: 'Long titles ellipsize; the tooltip keeps the full text' },
];
for (const node of nodeStates) {
  nodeHost.append(graphNode({ ...node, onSelect(event) {
    for (const peer of nodeHost.querySelectorAll('[data-testid="graph-node"]')) peer.setAttribute('aria-pressed', String(peer === event.currentTarget));
  } }));
}

/* -- Timeline & swimlanes -------------------------------------------------- */
document.querySelector('#timeline-inventory').append(timelineChart({
  testid: 'library-timeline',
  tracks: [
    { label: 'Agent A', intervals: [
      { start: 0, end: 28, state: 'active', label: 'setup' },
      { start: 28, end: 66, state: 'verified', label: 'install' },
      { start: 66, end: 100, state: 'stale', label: 'awaiting proof' },
    ] },
    { label: 'Agent B', intervals: [ // 35 < 66: honestly overlapping with nothing hidden
      { start: 10, end: 40, state: 'active', label: 'remove' },
      { start: 35, end: 82, state: 'attention', label: 'blocked' },
      { start: 82, end: 100, state: 'neutral', label: 'cancelled' },
    ] },
    { label: 'Agent C', intervals: [] },
  ],
}));

/* -- Loading, empty & metrics ---------------------------------------------- */
const loadingHost = document.querySelector('#loading-inventory');
loadingHost.append(card({ title: 'Loading snapshot', body: skeleton({ lines: 3, testid: 'library-skeleton', label: 'Loading snapshot example' }), testid: 'skeleton-card' }));
loadingHost.append(emptyState({ icon: 'inbox', title: 'No plan selected', detail: 'Choose a plan in the host to begin.', action: { label: 'Open host plan list', onClick: () => {} }, testid: 'empty-inbox' }));
loadingHost.append(emptyState({ icon: 'search', title: 'No records match the filter', detail: 'Clear the filter or widen the observed window.', testid: 'empty-search' }));
loadingHost.append(card({ title: 'Coverage metrics', body: element('div', 'grid', ''), testid: 'metric-card' }));
const metricHost = loadingHost.querySelector('[data-testid="metric-card"] .grid');
metricHost.append(
  metricTile({ value: 3, label: 'criteria verified', coverage: { state: 'verified', label: '3 of 7 verified' }, testid: 'metric-verified' }),
  metricTile({ value: 1, label: 'tasks observed running', coverage: { state: 'active', label: 'attempt 2' }, testid: 'metric-running' }),
  metricTile({ value: 2, label: 'attention items', coverage: { state: 'attention', label: 'needs input' }, testid: 'metric-attention' }),
  metricTile({ value: '—', label: 'host observations', unavailable: true, coverage: { state: 'unavailable', label: 'not observed' }, testid: 'metric-unavailable' }),
);

/* -- Overlays & inspector panel -------------------------------------------- */
const overlayHost = document.querySelector('#overlay-inventory');
const panelBody = element('div', 'stack');
panelBody.append(
  element('p', '', 'The inspector panel is an elevation-2 overlay: header, scrollable content region and footer.'),
  notice({ state: 'attention', title: 'Waiting for removal evidence', detail: 'Installer recovery can finish only after the removal branch supplies an applicable result.' }),
  element('p', 'meta', 'Escape closes the panel and focus returns to the invoking control.'),
);
const panelFooterPrimary = button('Apply example', null, { primary: true });
const panelFooter = [panelFooterPrimary, button('Just looking', null)];
const sidePanel = inspectorPanel({ title: 'Inspector panel', content: panelBody, footer: panelFooter });
document.body.append(sidePanel.element);
const panelTrigger = button('Open inspector panel', event => sidePanel.open(event.currentTarget));
panelTrigger.dataset.testid = 'inspector-panel-trigger';
overlayHost.append(card({ title: 'Side inspector', meta: 'elevation-2 · header / content / footer', body: panelTrigger, testid: 'inspector-trigger-card' }));

/* -- Task cards & dependencies --------------------------------------------- */
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
  const taskNode = taskCard({ ...task, onSelect(event) {
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
  lanes[task.id === 'Setup' || task.id === 'Legacy' || task.id === 'Stopped' ? 0 : task.id === 'Join' ? 2 : 1].append(taskNode);
}
document.querySelector('#task-inventory').append(...lanes);

/* -- Priority & dependency impact ------------------------------------------ */
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

/* -- Queue & decisions ------------------------------------------------------ */
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

/* -- Theme, surface and long-content controls ------------------------------ */
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
try {
  const parameters = new URLSearchParams(location.search);
  const requested = parameters.get('theme');
  if (requested === 'light' || requested === 'dark') themeControl.value = requested;
  const requestedDensity = parameters.get('density');
  if (requestedDensity === 'compact' || requestedDensity === 'regular') experience.density.apply(requestedDensity, { persist: false, notify: false });
} catch (error) { /* capture hooks are best-effort only */ }
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
  for (const control of formPanel.querySelectorAll('input, textarea, button')) control.disabled = locked;
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
  liveInput.value = expanded ? `unbroken-verifier-key-${'example'.repeat(10)}` : liveLabel.value;
});
updateSurface();
document.querySelector('#load-status').textContent = 'Component examples ready.';
document.querySelector('#component-content').hidden = false;
for (const control of document.querySelectorAll('#theme, #surface-state, #long-content')) control.disabled = false;
