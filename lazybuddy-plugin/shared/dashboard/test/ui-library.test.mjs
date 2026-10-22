import assert from 'node:assert/strict';
import test from 'node:test';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* T12 component library proof, part 1: the rebuilt shared primitives render
   their DOM contracts over the mini-dom fixture — cards, tables, rows, form
   fields with help/error slots, the destructive undo affordance (injectable
   clock), graph nodes with honest truncation, overlap-honest swimlanes, the
   elevation-2 inspector panel, skeletons, empty states and metric tiles —
   and the T11 native layer exports survive the overhaul untouched. */

const dom = createMiniDom();
globalThis.document = dom.document;

const {
  element, statusChip, button, notice, taskCard, field, formField,
  card, dataTable, rowList, destructiveAction, graphNode,
  assignSublanes, timelineTrack, timelineChart, inspectorPanel,
  skeleton, emptyState, metricTile, sidebarNav, createTabs, createDockPanel,
  installNativeExperience, installFocusSystem, installTooltips, announce,
  segmentedControl, createThemeToggle, sidebarActionIcon, createOverlayPanel, createInspector,
  THEME_STORAGE_KEY, THEME_MODES, STATUS_STATES,
  createStatusChip, createCard, createDataTable,
} = await import('../ui/components.mjs');

test('the T11 native layer exports survive the T12 overhaul', () => {
  assert.equal(typeof installNativeExperience, 'function');
  assert.equal(typeof installFocusSystem, 'function');
  assert.equal(typeof installTooltips, 'function');
  assert.equal(typeof announce, 'function');
  assert.equal(typeof segmentedControl, 'function');
  assert.equal(typeof createThemeToggle, 'function');
  assert.equal(typeof createOverlayPanel, 'function');
  assert.equal(typeof createInspector, 'function');
  assert.deepEqual([...THEME_MODES], ['light', 'dark', 'system']);
  assert.equal(THEME_STORAGE_KEY, 'lazyseries-theme');
  assert.ok(sidebarActionIcon('collapse-left'), 'the shared action glyphs stay available');
  const installed = installNativeExperience({ storage: undefined, mount: dom.document.body });
  assert.ok(installed, 'the native layer still installs');
  assert.equal(installed.control, undefined, 'V2-T1: the installer returns no density control');
  installed.detach();
});

test('statusChip exposes the seven kinds and keeps the original contract', () => {
  assert.deepEqual([...STATUS_STATES].sort(), ['active', 'attention', 'failed', 'neutral', 'stale', 'unavailable', 'verified']);
  const chip = statusChip({ state: 'verified', label: 'Verified' });
  assert.equal(chip.className, 'status');
  assert.equal(chip.dataset.state, 'verified');
  assert.equal(chip.textContent, 'Verified');
  assert.ok(chip.querySelector('svg'), 'every chip carries its glyph');
  assert.throws(() => statusChip({ state: 'cheerful', label: 'Nope' }), TypeError);
});

test('card renders header/body/footer slots and validates its elevation role', () => {
  const footerButton = button('Open', null);
  const built = card({ title: 'Attempt 2', meta: 'observed 14:02', body: element('p', '', 'Body leads'), footer: [footerButton], testid: 'card' });
  assert.equal(built.dataset.elevation, 'resting');
  assert.equal(built.dataset.testid, 'card');
  assert.equal(built.querySelector('.lb-card-title').textContent, 'Attempt 2');
  assert.equal(built.querySelector('.lb-card-meta').textContent, 'observed 14:02');
  assert.equal(built.querySelector('.lb-card-body p').textContent, 'Body leads');
  assert.equal(built.querySelector('.lb-card-foot button').textContent, 'Open');
  assert.equal(card({ body: null, elevation: 'raised' }).dataset.elevation, 'raised');
  assert.ok(card({ body: element('p', '', 'bare') }).querySelector('.lb-card-body'), 'a headerless card still has a body slot');
  assert.throws(() => card({ elevation: 'floating' }), TypeError);
});

test('dataTable renders a sticky-ready table with numeric columns and stringifies cell content', () => {
  const table = dataTable({
    columns: [{ key: 'task', label: 'Task' }, { key: 'checks', label: 'Checks', numeric: true }],
    rows: [{ task: 'Install', checks: 2 }, { task: 'Remove', checks: 0 }],
    caption: 'Observed attempts',
    testid: 'table',
  });
  assert.equal(table.className, 'lb-table-scroll');
  const headings = [...table.querySelectorAll('thead th')];
  assert.deepEqual(headings.map(node => node.textContent), ['Task', 'Checks']);
  assert.equal(headings[1].getAttribute('scope'), 'col');
  assert.equal(headings[1].dataset.numeric, 'true');
  const bodyCells = [...table.querySelectorAll('tbody td')];
  assert.deepEqual(bodyCells.map(node => node.textContent), ['Install', '2', 'Remove', '0']);
  assert.equal(bodyCells[1].dataset.numeric, 'true');
  assert.equal(table.querySelector('caption').textContent, 'Observed attempts');
  assert.throws(() => dataTable({ columns: [] }), TypeError);
  // array rows and Node cells compose without coercion surprises
  const mixed = dataTable({ columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', numeric: true }], rows: [[statusChip({ state: 'neutral', label: 'Ready' }), 7]] });
  assert.ok(mixed.querySelector('tbody td .status'), 'Node cells are appended, never stringified');
  assert.equal(mixed.querySelectorAll('tbody td')[1].textContent, '7');
});

test('rowList renders hairline rows with title, meta and trailing chip slots', () => {
  const list = rowList({
    items: [
      { title: 'Repair removal check', meta: 'Ready · revision 2', trailing: { state: 'neutral', label: 'Ready' } },
      { title: 'Package sibling adapters', meta: 'Held', trailing: statusChip({ state: 'attention', label: 'Held' }) },
      { title: 'Explore timeline' },
    ],
    testid: 'rows',
  });
  assert.equal(list.tagName, 'UL');
  assert.equal(list.className, 'lb-rows');
  assert.equal(list.querySelectorAll('.lb-row').length, 3);
  assert.equal(list.querySelector('.lb-row-title').textContent, 'Repair removal check');
  assert.ok(list.querySelectorAll('.lb-row')[0].querySelector('.status'), 'trailing chip objects become status chips');
  assert.ok(list.querySelectorAll('.lb-row')[1].querySelector('.status'), 'trailing Nodes pass through untouched');
  assert.equal(list.querySelectorAll('.lb-row')[2].querySelector('.status'), null, 'a row without trailing content renders none');
});

test('formField wires label, help and inline error slots through aria', () => {
  const withError = formField({ label: 'Successor plan', name: 'successor', value: '', help: 'Applies after retirement.', error: 'No plan matches “removed-plan”.', required: true, testid: 'field' });
  assert.equal(withError.dataset.invalid, 'true');
  const input = withError.querySelector('input');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  const described = input.getAttribute('aria-describedby').split(' ');
  assert.equal(described.length, 2, 'both the help and the error are described');
  const help = withError.querySelector('.lb-field-help');
  const error = withError.querySelector('.lb-field-error');
  assert.ok(described.includes(help.id) && described.includes(error.id));
  assert.equal(error.dataset.testid, 'field-error');
  assert.equal(input.required, true);
  assert.equal(withError.querySelector('.lb-field-label').dataset.required, 'true');
  const quiet = formField({ label: 'Reason', name: 'reason', help: 'Recorded with the transition.' });
  assert.equal(quiet.hasAttribute('data-invalid'), false);
  assert.equal(quiet.querySelector('input').hasAttribute('aria-invalid'), false);
  assert.equal(quiet.querySelector('.lb-field-error'), null);
  assert.equal(formField({ label: 'L', name: 'l', multiline: true }).querySelector('textarea').rows, 3);
});

test('field keeps the original two-slot signature for existing callers', () => {
  const legacy = field({ label: 'Criterion', name: 'criterion', value: 'Preserves files' });
  assert.equal(legacy.tagName, 'LABEL');
  assert.equal(legacy.firstChild.textContent, 'Criterion');
  const input = legacy.lastChild;
  assert.equal(input.tagName, 'INPUT');
  assert.equal(input.name, 'criterion');
  assert.equal(input.value, 'Preserves files');
  input.required = true; // the legacy caller pattern still works
  assert.equal(input.required, true);
});

test('destructiveAction commits, offers a bounded undo, and expires through the injectable clock', () => {
  const events = [];
  const timers = [];
  const control = destructiveAction({
    label: 'Discard draft',
    undoLabel: 'Undo discard',
    onCommit: () => events.push('commit'),
    onUndo: () => events.push('undo'),
    onAnnounce: () => {},
    windowMs: 5000,
    schedule: (task, ms) => { timers.push({ task, ms }); return timers.length; },
    cancel: handle => { timers[handle - 1] = null; },
  });
  assert.equal(control.dataset.testid, 'destructive-action');
  control.click();
  assert.deepEqual(events, ['commit']);
  assert.equal(control.dataset.undo, 'true', 'the undo affordance is exposed for styling');
  assert.equal(control.textContent, 'Undo discard');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
  control.click();
  assert.deepEqual(events, ['commit', 'undo']);
  assert.equal(control.hasAttribute('data-undo'), false);
  assert.equal(control.textContent, 'Discard draft');
  assert.equal(timers[0], null, 'the undo window is cancelled once used');
  control.click();
  timers[1].task(); // the window elapses without an undo click
  assert.deepEqual(events, ['commit', 'undo', 'commit']);
  assert.equal(control.textContent, 'Discard draft', 'expiry restores the rest state');
  const plain = destructiveAction({ label: 'Delete now', onCommit: () => events.push('plain') });
  plain.click();
  assert.deepEqual(events, ['commit', 'undo', 'commit', 'plain']);
  assert.equal(plain.hasAttribute('data-undo'), false, 'no onUndo means no affordance is invented');
});

test('graphNode keeps the full title available while ellipsizing and validates states', () => {
  const long = 'Verify caller-owned files including unbroken-reference-example-name';
  const node = graphNode({ id: 'join', title: long, state: 'attention', detail: 'Blocked', selected: true, badge: { state: 'attention', label: 'Blocked' } });
  assert.equal(node.dataset.testid, 'graph-node');
  assert.equal(node.dataset.nodeId, 'join');
  assert.equal(node.dataset.state, 'attention');
  assert.equal(node.getAttribute('aria-pressed'), 'true');
  const heading = node.querySelector('.lb-graph-node-title');
  assert.equal(heading.textContent, long);
  assert.equal(heading.title, long, 'the tooltip carries the untruncated label');
  assert.ok(node.querySelector('.lb-graph-node-head .status'), 'the badge chip renders in the head row');
  assert.equal(node.querySelector('.lb-graph-node-detail').textContent, 'Blocked');
  const minimal = graphNode({ id: 'x', title: 'X' });
  assert.equal(minimal.dataset.state, 'neutral');
  assert.equal(minimal.getAttribute('aria-pressed'), 'false');
  assert.equal(minimal.querySelector('.lb-graph-node-detail'), null);
  assert.throws(() => graphNode({ id: 'y', title: 'Y', state: 'cheerful' }), TypeError);
});

test('assignSublanes is overlap-honest: overlaps stack, adjacency shares a lane', () => {
  const overlapped = assignSublanes([{ start: 0, end: 50, label: 'a' }, { start: 25, end: 60, label: 'b' }]);
  assert.equal(overlapped.lanes, 2, 'a true overlap never shares a lane');
  assert.deepEqual(overlapped.intervals.map(item => item.lane), [0, 1]);
  const adjacent = assignSublanes([{ start: 0, end: 30 }, { start: 30, end: 60 }]);
  assert.equal(adjacent.lanes, 1, 'end === start is adjacency, not overlap');
  const shuffled = assignSublanes([{ start: 40, end: 60 }, { start: 0, end: 45 }, { start: 55, end: 70 }]);
  assert.deepEqual(shuffled.intervals.map(item => item.start), [0, 40, 55], 'intervals return in axis order');
  assert.deepEqual(shuffled.intervals.map(item => item.lane), [0, 1, 0]);
  assert.equal(shuffled.lanes, 2);
  assert.equal(assignSublanes([]).lanes, 1, 'an unobserved track still declares one lane');
  for (const bad of [{ start: 10, end: 0 }, { start: Number.NaN, end: 5 }, { start: 'x', end: 5 }]) {
    assert.throws(() => assignSublanes([bad]), TypeError);
  }
});

test('timelineTrack stacks overlaps into sublanes and announces the stacking', () => {
  const track = timelineTrack({
    label: 'Agent B',
    intervals: [{ start: 10, end: 40, state: 'active', label: 'remove' }, { start: 35, end: 82, state: 'attention', label: 'blocked' }],
    testid: 'track',
  });
  assert.equal(track.dataset.testid, 'track');
  assert.equal(track.querySelector('.lb-lane-label').textContent, 'Agent B');
  const surface = track.querySelector('.lb-track');
  assert.equal(surface.dataset.lanes, '2');
  assert.match(surface.getAttribute('aria-label'), /overlapping intervals stacked/);
  const segments = [...surface.querySelectorAll('.lb-interval')];
  assert.deepEqual(segments.map(node => node.dataset.lane), ['0', '1']);
  assert.match(segments[0].getAttribute('style'), /--lb-lane-index: 0; inset-inline-start: 10%; inline-size: 30%;/);
  assert.equal(segments[0].dataset.state, 'active');
  assert.equal(segments[1].title, 'blocked', 'the full label survives truncation');
  const empty = timelineTrack({ label: 'Agent C', intervals: [] });
  assert.equal(empty.querySelector('.lb-track').dataset.lanes, '1');
  assert.doesNotMatch(empty.querySelector('.lb-track').getAttribute('aria-label'), /stacked/);
});

test('timelineChart renders the shared axis with tabular ticks', () => {
  const chart = timelineChart({ tracks: [{ label: 'A', intervals: [{ start: 0, end: 50, state: 'active', label: 'a' }] }], testid: 'chart' });
  assert.equal(chart.dataset.testid, 'chart');
  assert.deepEqual([...chart.querySelectorAll('.lb-axis-tick')].map(node => node.textContent), ['0%', '25%', '50%', '75%', '100%']);
  for (const tick of chart.querySelectorAll('.lb-axis-tick')) assert.equal(tick.dataset.numeric, 'true');
  assert.equal(chart.querySelectorAll('.lb-lane').length, 1);
});

test('inspectorPanel opens as an elevation overlay, closes on Escape, and returns focus', () => {
  const detach = installFocusSystem();
  try {
    const footer = button('Apply', null);
    const panel = inspectorPanel({ title: 'Inspector', content: element('p', '', 'Content'), onClose: () => {} });
    assert.equal(panel.element.hidden, true);
    assert.equal(panel.element.dataset.testid, 'inspector-panel');
    assert.equal(panel.element.querySelector('.lb-inspector-foot'), null, 'no footer slot, no footer row');
    const invoker = button('Open panel', null);
    dom.document.body.append(invoker, panel.element);
    invoker.focus();
    panel.open(invoker);
    assert.equal(panel.element.hidden, false);
    assert.equal(panel.element.dataset.open, 'true');
    assert.equal(dom.document.activeElement, panel.element.querySelector('[data-testid="inspector-panel-close"]'), 'open focuses the close control');
    const withFooter = inspectorPanel({ title: 'With footer', content: element('p', '', 'C'), footer: [footer, button('Cancel', null)] });
    assert.equal(withFooter.element.querySelectorAll('.lb-inspector-foot button').length, 2);
    withFooter.element.remove();
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true }); // Escape through the T11 overlay stack
    assert.equal(panel.isOpen(), false, 'Escape closes the topmost panel');
    assert.equal(panel.element.hidden, true);
    assert.equal(dom.document.activeElement, invoker, 'focus returns to the invoking control');
    assert.equal(panel.close(), false, 'closing a closed panel is a no-op');
  } finally {
    detach.detach();
  }
});

test('skeleton is an aria-busy placeholder with silent bars', () => {
  const loading = skeleton({ lines: 4, testid: 'skel', label: 'Loading snapshot' });
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.equal(loading.getAttribute('aria-label'), 'Loading snapshot');
  const bars = [...loading.querySelectorAll('.lb-skeleton-line')];
  assert.equal(bars.length, 4);
  for (const bar of bars) assert.equal(bar.getAttribute('aria-hidden'), 'true');
  assert.equal(loading.textContent, '', 'a skeleton never fabricates content text');
  assert.equal(skeleton({}).querySelectorAll('.lb-skeleton-line').length, 3);
  assert.equal(skeleton({ lines: 0 }).querySelectorAll('.lb-skeleton-line').length, 1);
});

test('emptyState is designed, not a paragraph: icon + title + one line + action', () => {
  const empty = emptyState({ icon: 'inbox', title: 'No plan selected', detail: 'Choose a plan in the host to begin.', action: { label: 'Open host plan list', primary: true }, testid: 'empty' });
  assert.equal(empty.dataset.testid, 'empty');
  assert.ok(empty.querySelector('svg[aria-hidden="true"]'), 'the icon glyph renders');
  assert.equal(empty.querySelector('.lb-empty-title').textContent, 'No plan selected');
  assert.equal(empty.querySelectorAll('.lb-empty-detail').length, 1);
  const action = empty.querySelector('button');
  assert.equal(action.textContent, 'Open host plan list');
  assert.equal(action.className, 'primary lb-empty-action');
  assert.equal(emptyState({ icon: 'search', title: 'No match' }).querySelector('button'), null);
  assert.throws(() => emptyState({ icon: 'mystery', title: 'X' }), TypeError);
  const ownAction = emptyState({ icon: 'list', title: 'Nothing queued', action: button('Add example', null) });
  assert.equal(ownAction.querySelector('button').textContent, 'Add example');
});

test('metricTile renders tabular values, labels and coverage chips; unavailable is hollow', () => {
  const tile = metricTile({ value: 3, label: 'criteria verified', coverage: { state: 'verified', label: '3 of 7 verified' }, testid: 'metric' });
  assert.equal(tile.dataset.testid, 'metric');
  assert.equal(tile.querySelector('.lb-metric-value').textContent, '3');
  assert.equal(tile.querySelector('.lb-metric-value').dataset.numeric, 'true');
  assert.equal(tile.querySelector('.lb-metric-label').textContent, 'criteria verified');
  assert.ok(tile.querySelector('.status[data-state="verified"]'), 'the coverage chip renders');
  const unavailable = metricTile({ value: '—', label: 'host observations', unavailable: true, coverage: { state: 'unavailable', label: 'not observed' } });
  assert.equal(unavailable.dataset.unavailable, 'true');
  assert.equal(unavailable.querySelector('.lb-metric-value').textContent, '—');
  assert.equal(metricTile({ value: 1, label: 'x' }).querySelector('.status'), null);
});

test('the original primitives (notice, taskCard) keep their DOM contracts', () => {
  const note = notice({ state: 'attention', title: 'Held', detail: 'Needs verified core.' });
  assert.equal(note.className, 'panel notice');
  assert.ok(note.querySelector('.status[data-state="attention"]'));
  const task = taskCard({ id: 'Join', title: 'Release readiness', execution: { state: 'attention', label: 'Blocked' }, verification: { state: 'neutral', label: 'Unverified' }, progress: 'Waiting for evidence', selected: true, onSelect: () => {} });
  assert.equal(task.dataset.testid, 'task-node');
  assert.equal(task.dataset.taskId, 'Join');
  assert.equal(task.getAttribute('aria-pressed'), 'true');
  assert.equal(task.querySelector('.task-title').textContent, 'Release readiness');
  assert.equal(task.querySelectorAll('.status').length, 2);
});

/* -- V2-T9 factory hooks: controlled/uncontrolled parity (Mantine use-*) ----- */

test('createStatusChip updates in place, notifies, and validates states', () => {
  const changes = [];
  const chip = createStatusChip({ defaultState: 'neutral', label: 'idle', onStateChange: (state, label) => changes.push(`${state}:${label}`) });
  assert.equal(chip.get(), 'neutral');
  assert.equal(chip.element.dataset.state, 'neutral');
  assert.equal(chip.element.textContent, 'idle');
  chip.set('verified', '3 of 7 verified');
  assert.equal(chip.get(), 'verified');
  assert.equal(chip.element.dataset.state, 'verified');
  assert.equal(chip.element.textContent, '3 of 7 verified');
  assert.ok(chip.element.querySelector('svg'), 'the updated glyph re-renders');
  assert.deepEqual(changes, ['verified:3 of 7 verified'], 'set notifies the owner');
  chip.set('attention', undefined, { notify: false });
  assert.deepEqual(changes, ['verified:3 of 7 verified'], 'silent set never notifies');
  assert.equal(chip.getLabel(), '3 of 7 verified', 'an omitted label keeps the current one');
  chip.set({ state: 'failed', label: 'attempt 3 failed' });
  assert.equal(chip.element.textContent, 'attempt 3 failed');
  assert.equal(chip.get(), 'failed');
  assert.throws(() => chip.set('cheerful'), TypeError);
  const controlled = createStatusChip({ state: 'stale', label: 'historical' });
  assert.equal(controlled.get(), 'stale', 'the value prop seeds the controlled chip');
});

test('createCard: uncontrolled toggles itself; controlled notifies and re-applies through set', () => {
  const uncontrolledEvents = [];
  const free = createCard({ title: 'Pick a verifier', defaultSelected: false, onSelect: value => uncontrolledEvents.push(value) });
  assert.equal(free.element.dataset.interactive, 'true');
  assert.equal(free.element.getAttribute('aria-pressed'), 'false');
  free.element.click();
  assert.equal(free.get(), true, 'the uncontrolled card toggles itself');
  assert.equal(free.element.dataset.selected, 'true');
  assert.deepEqual(uncontrolledEvents, [true]);
  free.element.dispatchEvent({ type: 'keydown', key: ' ', bubbles: true });
  assert.equal(free.get(), false, 'Space toggles like a native control');
  free.element.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true });
  assert.equal(free.get(), true);
  free.set(false, { notify: false });
  assert.equal(free.get(), false, 'set re-applies without notifying');
  assert.deepEqual(uncontrolledEvents, [true, false, true], 'only the card-applied changes notify');

  const ownerEvents = [];
  const controlled = createCard({ title: 'Owner-managed', selected: false, onSelect: value => ownerEvents.push(value) });
  controlled.element.click();
  assert.equal(controlled.get(), false, 'the controlled card never toggles itself');
  assert.deepEqual(ownerEvents, [true], 'the click only notifies the owner');
  controlled.set(true);
  assert.equal(controlled.get(), true, 'the owner re-applies through set()');
  assert.equal(controlled.element.getAttribute('aria-pressed'), 'true');
  // a display card (no onSelect) is plain markup: no interaction affordances
  const plain = createCard({ title: 'Static' });
  assert.equal(plain.element.hasAttribute('data-interactive'), false);
  assert.equal(plain.element.hasAttribute('aria-pressed'), false);
});

test('createDataTable.setRows rebuilds the body in place; head and caption survive', () => {
  const columns = [{ key: 'task', label: 'Task' }, { key: 'checks', label: 'Checks', numeric: true }];
  const table = createDataTable({ columns, defaultRows: [{ task: 'Setup', checks: 2 }], caption: 'Observed attempts' });
  const notified = [];
  table.onRowsChange = rows => notified.push(rows.length);
  const head = table.element.querySelector('thead');
  const caption = table.element.querySelector('caption');
  table.setRows([{ task: 'Setup', checks: 2 }, { task: 'Remove', checks: 0 }]);
  assert.equal(table.get().length, 2);
  assert.deepEqual([...table.element.querySelectorAll('tbody td')].map(node => node.textContent), ['Setup', '2', 'Remove', '0']);
  assert.equal(table.element.querySelector('thead'), head, 'the sticky header node survives the refresh');
  assert.equal(table.element.querySelector('caption'), caption, 'the caption survives the refresh');
  assert.deepEqual(notified, [2], 'setRows notifies the owner');
  table.setRows([], { notify: false });
  assert.equal(table.element.querySelectorAll('tbody tr').length, 0, 'an empty refresh renders zero rows, honestly');
  assert.deepEqual(notified, [2], 'silent setRows never notifies');
});

test('emptyState actions must say what they do (V2-T9 clarity)', () => {
  assert.throws(() => emptyState({ icon: 'inbox', title: 'Nothing here', action: { primary: true } }), TypeError,
    'a config action without a label is a caller error, never a mystery button');
});

/* -- App shell (T12 addendum): sidebar rail, tab strip, dock --------------- */

test('sidebarNav renders destinations, aria-current and the icon rail collapse', () => {
  const collapsed = [];
  const rail = sidebarNav({
    product: 'LazySeries', runtime: 'LazyKimi', current: 'overview',
    destinations: [{ id: 'overview', label: 'Overview' }, { id: 'git', label: 'Git' }, { id: 'evidence', label: 'Evidence' }],
    tree: element('ul', '', ''), footer: element('span', '', 'footer slot'),
    onCollapse: value => collapsed.push(value),
    testid: 'rail',
  });
  assert.equal(rail.element.dataset.testid, 'rail');
  const destinations = [...rail.element.querySelectorAll('.lb-sidebar-destination')];
  assert.deepEqual(destinations.map(node => node.getAttribute('aria-label')), ['Overview', 'Git', 'Evidence']);
  assert.equal(destinations[0].getAttribute('aria-current'), 'page');
  assert.equal(destinations[1].hasAttribute('aria-current'), false);
  assert.ok(destinations[0].querySelector('svg'), 'destinations draw their rail icons');
  assert.ok(rail.element.querySelector('.lb-sidebar-tree'), 'the object tree slot renders');
  assert.ok(rail.element.querySelector('.lb-sidebar-footer span'), 'the footer slot renders');
  assert.equal(rail.element.querySelector('.lb-sidebar-product').dataset.product, 'LazyKimi', 'the identity badge carries the runtime for the accent wash');
  rail.navigate('git');
  assert.equal(destinations[1].getAttribute('aria-current'), 'page');
  assert.equal(destinations[0].hasAttribute('aria-current'), false, 'navigate moves the single aria-current');
  assert.equal(rail.element.querySelector('[data-native-list]').tagName, 'UL', 'destinations traverse with j/k through the T11 layer');
  assert.equal(rail.isCollapsed(), false);
  rail.toggle();
  assert.equal(rail.isCollapsed(), true);
  assert.equal(rail.element.dataset.collapsed, 'true');
  const collapseControl = rail.element.querySelector('.lb-sidebar-collapse');
  assert.equal(collapseControl.getAttribute('aria-expanded'), 'false');
  assert.equal(collapseControl.getAttribute('aria-label'), 'Expand sidebar');
  assert.deepEqual(collapsed, [true], 'collapse notifies the owner');
  rail.setCollapsed(false);
  assert.equal(collapseControl.getAttribute('aria-expanded'), 'true');
  assert.equal(rail.isCollapsed(), false);
});

test('T20-RF sidebarNav badges render projection counts honestly; the collapse control draws chevrons', () => {
  const rail = sidebarNav({
    product: 'LazySeries', runtime: 'LazyBuddy',
    destinations: [
      { id: 'overview', label: 'Overview', count: 3 },
      { id: 'plans', label: 'Plans', count: 0 },
      { id: 'git', label: 'Git' },
      { id: 'evidence', label: 'Evidence', count: 'not-a-number' },
    ],
  });
  const row = id => rail.element.querySelector(`.lb-sidebar-destination[data-destination="${id}"]`);
  const badge = id => row(id).querySelector('.lb-sidebar-badge');
  assert.equal(badge('overview')?.textContent, '3', 'a positive whole count renders its badge');
  assert.equal(row('overview').getAttribute('aria-label'), 'Overview (3)', 'the count rides the accessible name');
  assert.equal(badge('plans'), null, 'zero renders no badge — never fake');
  assert.equal(row('plans').getAttribute('aria-label'), 'Plans', 'a zero count keeps the plain accessible name');
  assert.equal(badge('git'), null, 'an absent count renders no badge');
  assert.equal(badge('evidence'), null, 'a malformed count renders no badge');
  assert.ok(rail.element.querySelector('.lb-sidebar-collapse svg'), 'the collapse control draws its chevron glyph');
  assert.equal(rail.setCount('plans', 7), '7', 'setCount paints from a projection refresh');
  assert.equal(badge('plans')?.textContent, '7');
  assert.equal(row('plans').getAttribute('aria-label'), 'Plans (7)');
  assert.equal(rail.setCount('plans', 0), null, 'a refreshed zero removes the badge');
  assert.equal(badge('plans'), null);
  assert.equal(rail.setCount('git', 2), '2', 'setCount paints onto an uncalled row too');
  rail.toggle(); // collapsed: the badge hides with the label, the title carries the count
  assert.equal(row('git').getAttribute('title'), 'Git (2)', 'the collapsed rail tooltip stays in step with the count');
});

test('createTabs: add, select, close and pin, with panels wired through aria', () => {
  const events = [];
  const workspace = createTabs({
    current: 'home',
    tabs: [
      { id: 'home', title: 'Home', pinned: true, content: element('p', '', 'home') },
      { id: 'plan', title: 'Plan · removal', content: element('p', '', 'plan') },
      { id: 'run', title: 'Run 8f2', content: element('p', '', 'run') },
    ],
    onChange: (id, kind) => events.push(`${kind}:${id}`),
  });
  const tabs = [...workspace.tablist.querySelectorAll('.lb-tab')];
  assert.equal(tabs.length, 3);
  assert.deepEqual(workspace.tabs(), ['home', 'plan', 'run']);
  assert.equal(workspace.getActive(), 'home');
  assert.equal(tabs[0].getAttribute('role'), 'tab');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'false');
  assert.equal(tabs[1].tabIndex, -1, 'inactive tabs leave the tab ring (roving tabindex)');
  assert.equal(tabs[0].querySelector('.lb-tab-close'), null, 'the pinned Home renders no close control');
  assert.ok(tabs[1].querySelector('.lb-tab-close'), 'open-item tabs are closable');
  const panels = [...workspace.panels.querySelectorAll('.lb-tabpanel')];
  assert.equal(panels[0].getAttribute('role'), 'tabpanel');
  assert.equal(panels[0].getAttribute('aria-labelledby'), tabs[0].id);
  assert.equal(tabs[0].getAttribute('aria-controls'), panels[0].id);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);
  workspace.select('run');
  assert.equal(workspace.getActive(), 'run');
  assert.equal(panels[2].hidden, false);
  assert.equal(panels[0].hidden, true);
  assert.ok(events.includes('select:run'), 'selection notifies the owner');
  const opened = workspace.openTab({ id: 'doc', title: 'Doc', content: element('p', '', 'doc') });
  assert.equal(opened, 'doc');
  assert.equal(workspace.tabs().length, 4);
  assert.equal(workspace.getActive(), 'run', 'opening a background tab does not steal selection');
  assert.equal(workspace.openTab({ id: 'doc', title: 'Doc', content: element('p', '', 'again') }), 'doc');
  assert.equal(workspace.tabs().length, 4, 're-opening an existing tab selects it, never duplicates');
  assert.equal(workspace.getActive(), 'doc');
  assert.equal(workspace.closeTab('home'), false, 'the pinned tab refuses to close');
  workspace.select('plan');
  assert.equal(workspace.closeTab('plan'), true);
  assert.deepEqual(workspace.tabs(), ['home', 'run', 'doc']);
  assert.equal(workspace.getActive(), 'run', 'closing the active tab selects the neighbor');
});

test('createTabs: keyboard arrows, Home/End, digits and Delete; clicks select through children', () => {
  const workspace = createTabs({
    tabs: [
      { id: 'home', title: 'Home', pinned: true, content: element('p', '', 'home') },
      { id: 'plan', title: 'Plan', content: element('p', '', 'plan') },
      { id: 'run', title: 'Run', content: element('p', '', 'run') },
    ],
    current: 'home',
    onChange: () => {},
  });
  dom.document.body.append(workspace.element);
  const [home, plan, run] = [...workspace.tablist.querySelectorAll('.lb-tab')];
  const press = (target, key, extra = {}) => target.dispatchEvent({ type: 'keydown', key, bubbles: true, ...extra });
  press(workspace.tablist, 'ArrowRight');
  assert.equal(workspace.getActive(), 'plan', 'ArrowRight activates the next tab');
  assert.equal(dom.document.activeElement, plan, 'focus follows the selection, like the segmented control');
  press(plan, 'ArrowRight');
  assert.equal(workspace.getActive(), 'run');
  press(run, 'ArrowRight');
  assert.equal(workspace.getActive(), 'home', 'arrow traversal wraps');
  press(home, 'ArrowLeft');
  assert.equal(workspace.getActive(), 'run', 'ArrowLeft wraps backwards');
  press(run, 'Home');
  assert.equal(workspace.getActive(), 'home');
  press(home, 'End');
  assert.equal(workspace.getActive(), 'run');
  press(workspace.tablist, '2', { code: 'Digit2', metaKey: true });
  assert.equal(workspace.getActive(), 'plan', 'Cmd/Ctrl+digit jumps to the nth tab');
  press(workspace.tablist, '9', { code: 'Digit9', ctrlKey: true });
  assert.equal(workspace.getActive(), 'plan', 'a digit past the end is ignored');
  press(plan, 'Delete');
  assert.deepEqual(workspace.tabs(), ['home', 'run'], 'Delete closes the focused closable tab');
  press(home, 'Delete');
  assert.deepEqual(workspace.tabs(), ['home', 'run'], 'the pinned tab survives Delete');
  const label = run.querySelector('.lb-tab-label');
  label.dispatchEvent({ type: 'click', bubbles: true });
  assert.equal(workspace.getActive(), 'run', 'clicking a tab label selects the tab');
  workspace.element.remove();
});

test('tab panels preserve view state across tab switches and polling ticks', () => {
  const planContent = element('div', 'stack');
  const draft = formField({ label: 'Retirement reason', name: 'reason', value: 'draft one', help: 'persists' });
  const marker = element('span', 'tick-marker', 'tick-0');
  planContent.append(draft, marker);
  const workspace = createTabs({
    tabs: [
      { id: 'home', title: 'Home', pinned: true, content: element('p', '', 'home') },
      { id: 'plan', title: 'Plan', content: planContent },
    ],
    current: 'plan',
    onChange: () => {},
  });
  const input = workspace.panels.querySelector('[data-testid="tab-panel"][data-tab-id="plan"] input');
  input.value = 'edited draft';
  marker.textContent = 'tick-1'; // a polling update lands while the panel is live
  workspace.select('home');
  assert.equal(workspace.panels.querySelector('[data-tab-id="plan"]').hidden, true);
  workspace.select('plan');
  const restored = workspace.panels.querySelector('[data-tab-id="plan"] input');
  assert.equal(restored, input, 'the same DOM node returns: switching hides, it never destroys');
  assert.equal(restored.value, 'edited draft', 'the user draft survives the round trip');
  assert.equal(workspace.panels.querySelector('[data-tab-id="plan"] .tick-marker').textContent, 'tick-1', 'the polling update survives too');
});

test('createDockPanel: toggle, Escape through the overlay stack, focus return, footer', () => {
  const detach = installFocusSystem();
  try {
    const dock = createDockPanel({ title: 'Inspector dock', content: element('p', '', 'content'), footer: [button('Apply', null), button('Dismiss', null)] });
    assert.equal(dock.element.dataset.testid, 'dock-panel');
    assert.equal(dock.element.hidden, true);
    assert.equal(dock.element.querySelectorAll('.lb-dock-foot button').length, 2);
    const invoker = button('Open dock', null);
    dom.document.body.append(invoker, dock.element);
    invoker.focus();
    dock.toggle(invoker);
    assert.equal(dock.isOpen(), true);
    assert.equal(dock.element.dataset.open, 'true');
    assert.equal(dom.document.activeElement, dock.element.querySelector('[data-testid="dock-panel-close"]'), 'opening focuses the collapse control');
    dock.toggle(); // toggle closes
    assert.equal(dock.isOpen(), false);
    dock.open(invoker);
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(dock.isOpen(), false, 'Escape closes the dock through the T11 overlay stack');
    assert.equal(dom.document.activeElement, invoker, 'focus returns to the invoking control');
    assert.equal(dock.close(), false, 'closing a closed dock is a no-op');
    assert.equal(createDockPanel({ title: 'Bare', content: element('p', '', 'x') }).element.querySelector('.lb-dock-foot'), null, 'no footer slot, no footer row');
  } finally {
    detach.detach();
  }
});
