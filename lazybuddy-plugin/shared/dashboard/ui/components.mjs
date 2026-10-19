/** Text-only DOM primitives. The caller owns data validation and authority. */
function escapeSelector(value) {
  try { return CSS.escape(String(value)); } catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`); }
}

export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

// Lucide icon geometry (ISC): circle, loader, check, lock, x, history, circle-dashed.
const glyphs = {
  neutral: ['circle', { cx: 12, cy: 12, r: 8 }],
  active: ['path', { d: 'M12 3a9 9 0 1 0 9 9' }],
  verified: ['path', { d: 'm9 12 2 2 4-4 M21 12a9 9 0 1 1-9-9' }],
  attention: ['path', { d: 'M6 10h12v10H6z M8 10V6a4 4 0 0 1 8 0v4' }],
  failed: ['path', { d: 'm8 8 8 8 m0-8-8 8 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' }],
  stale: ['path', { d: 'M3 12a9 9 0 1 0 3-6 M3 3v6h6 M12 7v5l3 2' }],
  unavailable: ['circle', { cx: 12, cy: 12, r: 8, 'stroke-dasharray': '3 3' }],
};

// Draws one stroke-based 24x24 icon from [[tag, attrs], ...] shape lists.
function svgIcon(shapes) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(icon.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    icon.append(shape);
  }
  return icon;
}

export function statusChip({ state = 'neutral', label }) {
  if (!Object.hasOwn(glyphs, state)) throw new TypeError('Unknown status role');
  const chip = element('span', 'status');
  chip.dataset.state = state;
  chip.append(svgIcon([glyphs[state]]), document.createTextNode(label));
  return chip;
}

export function button(label, onClick, options = {}) {
  const control = element('button', options.primary ? 'primary' : '', label);
  control.type = 'button';
  control.disabled = options.disabled ?? false;
  if (onClick) control.addEventListener('click', onClick);
  return control;
}

export function notice({ state, title, detail }) {
  const node = element('div', 'panel notice');
  node.append(statusChip({ state, label: title }), element('p', '', detail));
  return node;
}

export function taskCard({ id, title, execution, verification, progress, selected = false, onSelect }) {
  const control = button('', onSelect);
  control.className = 'task';
  control.dataset.testid = 'task-node';
  control.dataset.taskId = id;
  control.setAttribute('aria-pressed', String(selected));
  const identity = element('span', 'meta cluster', id);
  const selection = element('span', 'selection', 'Selected');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(icon.namespaceURI, 'path');
  shape.setAttribute('d', 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4 M9 11l3 3L22 4');
  icon.append(shape); selection.prepend(icon); identity.append(selection);
  control.append(identity, element('span', 'task-title', title));
  for (const [kind, value] of [['Execution', execution], ['Checks', verification]]) {
    const row = element('span', 'cluster');
    row.append(element('span', 'meta', kind), statusChip(value));
    control.append(row);
  }
  control.append(element('span', 'meta', progress));
  return control;
}

/* ======================================================================
   T11 native platform experience layer
   ======================================================================

   Keyboard-first, macOS-native interaction plumbing shared by every view.
   Views opt in with data attributes only; the layer installs once per
   document (installNativeExperience, booted from theme-init.js) and never
   owns data or authority.

   Focus system (installFocusSystem) — one document-level keydown listener:
     - Tab ring: every interactive control keeps native tab order; the
       visible ring is :focus-visible { box-shadow: var(--focus-ring) }
       (style.css). Keyboard focus is always visible; pointer focus is not.
     - j / k  move focus forward/backward through the focusable items of
       the nearest list scope ([data-native-list], ol, ul, .task-list,
       .graph-viewport, .queue, .attention-list, dialog) with wrap-around.
       Ignored while typing in inputs.
     - /      focuses the first filter/search input
       (input[type='search'] or [data-native-filter]) when one exists.
     - Escape closes the topmost native overlay (focus returns to the
       invoking control) or the open inspector dialog (focus returns via
       the dialog close handler). Never moves focus without input.
   Segmented controls ([data-native-segmented], built by segmentedControl):
     ArrowLeft/ArrowRight/Home/End activate the previous/next/first/last
     enabled segment and focus it; the current segment carries
     aria-pressed='true' and data-current for styling.
   Density (createDensityController): compact/regular is persisted per
   browser under 'lazyseries-density' (every storage access is wrapped in
   try/catch — private-mode/blocked storage degrades to in-memory only)
   and applied as data-density on the root, which switches the
   --density-gutter token between --density-compact and --density-regular.
   Malformed stored values fall back to regular and never throw.
   Overlays (createOverlayPanel): elevated non-modal panels; Escape or the
   Close button hides the panel and returns focus to the invoker.
   Tooltips (installTooltips): status chips and icon-only buttons get a
   title plus an aria-describedby note in a clipped .native-note node.
   Announcements (announce): one polite [role='status'] region dedicated
   to the layer (never the application status line). */

const DENSITY_KEY = 'lazyseries-density';
export const NATIVE_DENSITY_STORAGE_KEY = DENSITY_KEY;
export const NATIVE_DENSITIES = Object.freeze(['compact', 'regular']);
const FOCUSABLE_TAGS = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
const LIST_SCOPES = '[data-native-list], ol, ul, .task-list, .graph-viewport, .spike-graph-viewport, .architecture-graph-viewport, .execution-graph-viewport, .execution-timeline-viewport, .queue, .attention-list, dialog, .native-overlay';
const FILTER_INPUT = 'input[type=search], input[data-native-filter]';

function closestMatch(node, selector) {
  let current = node;
  while (current) {
    if (current.matches?.(selector)) return current;
    current = current.parentNode;
  }
  return null;
}

// Same walk starting AT the node (component-local; the native layer keeps
// its own closestMatch with the exclusive-starts-at-parent semantics).
function closestAncestor(node, selector) {
  let current = node;
  while (current) {
    if (current.nodeType === 1 && current.matches?.(selector)) return current;
    current = current.parentNode;
  }
  return null;
}

function hasHiddenAncestor(node, boundary) {
  let current = node?.parentNode;
  while (current && current !== boundary) {
    if (current.hidden) return true;
    current = current.parentNode;
  }
  return false;
}

function isFocusable(node, boundary) {
  if (!node || node.nodeType !== 1 || node.disabled || node.hidden) return false;
  if (hasHiddenAncestor(node, boundary)) return false;
  if (node.tagName === 'A' && !node.hasAttribute('href')) return false;
  if (FOCUSABLE_TAGS.includes(node.tagName)) return true;
  const index = Number(node.tabIndex);
  return Number.isFinite(index) && index >= 0;
}

function collectFocusables(scope) {
  const found = [];
  const visit = node => {
    for (const child of node.children) {
      if (isFocusable(child, scope)) found.push(child);
      visit(child);
    }
  };
  visit(scope);
  return found;
}

function isEditable(target) {
  return Boolean(target) && (FOCUSABLE_TAGS.slice(1, 5).includes(target.tagName) || target.isContentEditable);
}

const overlayStack = [];
let overlaySequence = 0;

export function createOverlayPanel({ title, content, invoker = null, onClose } = {}) {
  const panel = element('aside', 'native-overlay');
  const heading = element('h2', '', title);
  const headingId = `native-overlay-${++overlaySequence}`;
  heading.id = headingId;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', headingId);
  panel.dataset.testid = 'native-overlay';
  const closeControl = button('Close overlay', () => api.close('button'));
  closeControl.dataset.testid = 'native-overlay-close';
  const header = element('header', 'cluster spread');
  header.append(heading, closeControl);
  panel.append(header, content);
  panel.hidden = true;
  let trigger = invoker;
  let open = false;
  const api = {
    element: panel,
    open(nextInvoker = null) {
      trigger = nextInvoker ?? trigger;
      open = true;
      panel.hidden = false;
      panel.dataset.nativeOverlay = 'open';
      overlayStack.push(api);
      const focusables = collectFocusables(panel);
      (focusables.find(node => node !== closeControl) ?? closeControl).focus();
      return panel;
    },
    close(reason = 'api') {
      if (!open) return false;
      open = false;
      panel.hidden = true;
      panel.removeAttribute('data-native-overlay');
      const index = overlayStack.indexOf(api);
      if (index !== -1) overlayStack.splice(index, 1);
      const connected = trigger ? (trigger.isConnected ?? globalThis.document?.body?.contains?.(trigger) ?? false) : false;
      const target = connected ? trigger : null;
      trigger = null;
      onClose?.(reason);
      target?.focus();
      return true;
    },
    isOpen: () => open,
  };
  return api;
}

export function installFocusSystem({ root = globalThis.document } = {}) {
  if (!root?.addEventListener) return { detach() {} };
  function handler(event) {
    if (event.defaultPrevented || typeof event.key !== 'string') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (event.key === 'Escape') {
      const overlay = overlayStack.at(-1);
      if (overlay) { event.preventDefault(); overlay.close('escape'); return; }
      const dialog = root.querySelector?.("dialog[open]");
      if (dialog && typeof dialog.close === 'function') { event.preventDefault(); dialog.close(); }
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const group = closestMatch(target, '[data-native-segmented]');
      if (!group || isEditable(target)) return;
      const controls = [...group.querySelectorAll('button')].filter(control => !control.disabled);
      if (controls.length < 2 || target.tagName !== 'BUTTON') return;
      event.preventDefault();
      const index = controls.indexOf(target);
      let next;
      if (event.key === 'Home') next = controls[0];
      else if (event.key === 'End') next = controls[controls.length - 1];
      else {
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const base = index === -1 ? (delta === 1 ? -1 : 0) : index;
        next = controls[(base + delta + controls.length) % controls.length];
      }
      next.focus();
      next.click();
      const live = (root.contains?.(group) ? group : null) ?? root.querySelector?.('[data-native-segmented]');
      const current = live?.querySelector?.("button[aria-pressed='true']");
      if (current && current !== root.activeElement && !current.disabled) current.focus();
      return;
    }
    if (event.key === 'j' || event.key === 'k') {
      if (isEditable(target)) return;
      let scope = null;
      let items = [];
      let ancestor = target;
      while (ancestor && ancestor !== root) {
        if (ancestor.matches?.(LIST_SCOPES)) {
          const candidates = collectFocusables(ancestor);
          if (candidates.length >= 2) { scope = ancestor; items = candidates; break; }
        }
        ancestor = ancestor.parentNode;
      }
      if (!scope || !items.includes(target)) {
        // the focused element may be the list surface itself (e.g. the graph
        // viewport): traversal starts from the surface, before its items
        if (scope === target && isFocusable(target, root)) items = [target, ...items];
        else return;
      }
      event.preventDefault();
      const index = items.indexOf(target);
      const delta = event.key === 'j' ? 1 : -1;
      items[(index + delta + items.length) % items.length].focus();
      return;
    }
    if (event.key === '/' && !isEditable(target)) {
      const filter = root.querySelector?.(FILTER_INPUT);
      if (filter && !filter.disabled) {
        event.preventDefault();
        filter.focus();
        filter.select?.();
      }
    }
  }
  root.addEventListener('keydown', handler);
  return { detach() { root.removeEventListener('keydown', handler); } };
}

export function segmentedControl({ label, options, current, onChange, tooltip = false }) {
  if (!Array.isArray(options) || options.length === 0) throw new TypeError('Segmented control requires options');
  const group = element('div', 'view-switcher native-segmented');
  group.dataset.nativeSegmented = 'true';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  if (tooltip) group.title = label;
  const known = option => options.some(entry => entry.value === option.value);
  let active = known({ value: current }) ? current : options[0].value;
  for (const option of options) {
    const control = button(option.label, () => set(option.value));
    control.dataset.segment = option.value;
    if (option.disabled) control.disabled = true;
    group.append(control);
  }
  function sync() {
    for (const control of group.querySelectorAll('button')) {
      const isCurrent = control.dataset.segment === active;
      control.setAttribute('aria-pressed', String(isCurrent));
      if (isCurrent) control.setAttribute('data-current', 'true');
      else control.removeAttribute('data-current');
    }
  }
  function set(value, { notify = true } = {}) {
    if (!options.some(option => option.value === value)) return active;
    if (value !== active) active = value;
    sync();
    if (notify) onChange?.(active);
    return active;
  }
  sync();
  return { element: group, setCurrent: value => set(value, { notify: false }), get: () => active };
}

export function createDensityController({ root = globalThis.document?.documentElement, storage = globalThis.localStorage, onAnnounce } = {}) {
  let current = 'regular';
  try {
    const stored = storage?.getItem?.(DENSITY_KEY);
    if (NATIVE_DENSITIES.includes(stored)) current = stored;
  } catch { /* storage unavailable (blocked/private mode): keep the default */ }
  const listeners = new Set();
  function apply(next, { persist = true, notify = true } = {}) {
    if (!NATIVE_DENSITIES.includes(next)) return current;
    current = next;
    try { root?.setAttribute?.('data-density', current); } catch { /* detached root: stay in memory */ }
    if (persist) { try { storage?.setItem?.(DENSITY_KEY, current); } catch { /* persistence unavailable: in-memory only */ } }
    if (notify) for (const listener of listeners) listener(current);
    return current;
  }
  apply(current, { persist: false, notify: false });
  return {
    apply,
    get: () => current,
    toggle() { return apply(current === 'compact' ? 'regular' : 'compact'); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    control() {
      const control = segmentedControl({
        label: 'Density',
        tooltip: true,
        options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }],
        current,
        onChange: next => { apply(next); onAnnounce?.(next); },
      });
      const sync = value => control.setCurrent(value);
      listeners.add(sync);
      return control;
    },
  };
}

export function announce(message, { root = globalThis.document } = {}) {
  if (!root?.body) return null;
  let region = root.body.querySelector('[data-native-announcer]');
  if (!region) {
    region = element('div', 'native-announcer');
    region.dataset.nativeAnnouncer = 'true';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    root.body.append(region);
  }
  region.textContent = '';
  region.textContent = String(message);
  return region;
}

let tooltipNoteSequence = 0;

export function installTooltips({ root = globalThis.document } = {}) {
  function describe(scope) {
    if (!scope?.querySelectorAll) return 0;
    const chips = [...scope.querySelectorAll('.status')];
    const iconButtons = [...scope.querySelectorAll('button')].filter(control => {
      // icon-only: no word characters in the label (empty or pure glyphs)
      const text = String(control.textContent).trim();
      return !/[\w]/.test(text) && control.getAttribute('aria-label');
    });
    let added = 0;
    for (const node of [...chips, ...iconButtons]) {
      if (node.hasAttribute('aria-describedby') || node.hasAttribute('data-native-noted')) continue;
      const label = String(node.textContent).trim();
      if (!label && !iconButtons.includes(node)) continue;
      const text = chips.includes(node) ? `Status ${node.dataset.state || 'neutral'}: ${label}` : node.getAttribute('aria-label');
      const note = element('span', 'native-note');
      note.id = `native-note-${++tooltipNoteSequence}`;
      note.textContent = text;
      root.body?.append(note);
      node.setAttribute('aria-describedby', note.id);
      if (!node.getAttribute('title')) node.setAttribute('title', text);
      node.setAttribute('data-native-noted', 'true');
      added += 1;
    }
    return added;
  }
  return { describe };
}

export function installNativeExperience({ root = globalThis.document, storage = globalThis.localStorage, mount = null } = {}) {
  if (!root?.documentElement || root.documentElement.dataset.nativeExperience === 'true') return null;
  root.documentElement.dataset.nativeExperience = 'true';
  const report = message => announce(message, { root });
  report(''); // the polite region exists from first paint, before any message
  const density = createDensityController({ root: root.documentElement, storage, onAnnounce: value => report(`Density set to ${value}`) });
  const control = density.control();
  const theme = root.querySelector?.('#theme');
  const target = mount ?? (theme ? closestMatch(theme, 'label')?.parentNode ?? null : null);
  target?.append?.(control.element);
  const focus = installFocusSystem({ root });
  const tooltips = installTooltips({ root });
  tooltips.describe(root.body);
  return {
    density, control, focus, tooltips,
    announce: report,
    overlay: createOverlayPanel,
    setDensity: density.apply,
    detach() { focus.detach(); root.documentElement.removeAttribute('data-native-experience'); },
  };
}

export function createInspector({ title, content }) {
  const dialog = element('dialog', 'stack');
  dialog.dataset.testid = 'task-inspector';
  const heading = element('h2', '', title);
  const titleId = `inspector-${++createInspector.sequence}`;
  heading.id = titleId;
  dialog.setAttribute('aria-labelledby', titleId);
  const header = element('header', 'cluster spread');
  const close = button('Close inspector', () => dialog.close());
  header.append(heading, close);
  content.classList.add('inspector-body');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', `${title} content`);
  dialog.append(header, content);
  let trigger; let returnIdentity;
  dialog.addEventListener('close', () => {
    let target = trigger;
    if (!target?.isConnected && returnIdentity?.taskId) {
      const view = returnIdentity.view ? `[data-view="${escapeSelector(returnIdentity.view)}"]` : '';
      target = document.querySelector(`${view}[data-task-id="${escapeSelector(returnIdentity.taskId)}"]`);
    }
    target?.focus();
  });
  return { element: dialog, open(invoker) { trigger = invoker; returnIdentity = { taskId: invoker?.dataset.taskId, view: invoker?.dataset.view }; dialog.showModal(); close.focus(); } };
}
createInspector.sequence = 0;

/* ======================================================================
   T12 shared component library on tokens v2

   The primitives every later view redesign (T14–T19) composes from.
   Same contract as the originals: text-only DOM, no fetch, no authority;
   dynamic strings go through textContent; the caller owns data. Every
   visual decision lives in style.css/views.css on the v2 token names —
   components.mjs never carries a color, size or duration.

     card            header/body/footer slots, density-driven padding,
                     data-elevation resting|raised
     dataTable       sticky header, hairline zebra-free rows, tabular
                     numerals on data-numeric columns
     rowList         hairline list rows (title + meta + trailing slot)
     formField       label + control + help + inline error slots with
                     aria-invalid / aria-describedby wiring (field keeps
                     the original two-slot signature on top of it)
     destructiveAction  danger styling plus a bounded undo affordance
                     (injectable clock; commits immediately, undo window
                     reverts via onUndo, expiry restores the rest state)
     graphNode       state-driven size/border node card, ellipsized title
                     that keeps the full text in the title attribute,
                     selected/blocked/stale treatments
     timelineTrack / timelineChart / assignSublanes
                     swimlane track that is overlap-honest: overlapping
                     intervals stack into sublanes instead of painting
                     over each other (adjacent intervals share a lane)
     inspectorPanel  header/content/footer side panel, elevation-2
                     overlay, Escape + focus-return through the T11
                     overlay stack
     skeleton        static loading placeholder (aria-busy container,
                     aria-hidden bars; no shimmer loop by design rule)
     emptyState      icon + title + optional detail line + action
     metricTile      tabular value + label + coverage chip, hollow
                     unavailable variant
   ====================================================================== */

export const STATUS_STATES = Object.freeze(Object.keys(glyphs));

function appendSlot(parent, slot, className) {
  if (slot == null) return;
  const holder = element('div', className);
  if (Array.isArray(slot)) holder.append(...slot.filter(Boolean));
  else holder.append(slot);
  parent.append(holder);
}

export function card({ title = null, meta = null, body = null, footer = null, elevation = 'resting', testid } = {}) {
  if (!['resting', 'raised'].includes(elevation)) throw new TypeError('Card elevation must be resting or raised');
  const node = element('article', 'lb-card');
  node.dataset.elevation = elevation;
  if (testid) node.dataset.testid = testid;
  if (title != null || meta != null) {
    const header = element('header', 'lb-card-head');
    if (title != null) header.append(element('h3', 'lb-card-title', title));
    if (meta != null) header.append(element('p', 'lb-card-meta meta', meta));
    node.append(header);
  }
  appendSlot(node, body, 'lb-card-body');
  appendSlot(node, footer, 'lb-card-foot');
  return node;
}

export function dataTable({ columns, rows = [], caption = '', testid } = {}) {
  if (!Array.isArray(columns) || columns.length === 0) throw new TypeError('Data table requires columns');
  const scroll = element('div', 'lb-table-scroll');
  const table = element('table', 'lb-table');
  if (testid) table.dataset.testid = testid;
  if (caption) table.append(element('caption', 'lb-table-caption meta', caption));
  const headRow = element('tr');
  const head = element('thead');
  for (const column of columns) {
    const label = column.label ?? String(column.key ?? '');
    const cell = element('th', column.numeric ? 'lb-num' : '', label);
    cell.setAttribute('scope', 'col');
    if (column.numeric) cell.dataset.numeric = 'true';
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element('tbody');
  for (const row of rows) {
    const rowNode = element('tr');
    const cells = Array.isArray(row) ? row : columns.map(column => row?.[column.key]);
    cells.forEach((cell, index) => {
      const column = columns[index];
      const cellNode = element('td', column.numeric ? 'lb-num' : '');
      if (column.numeric) cellNode.dataset.numeric = 'true';
      cellNode.append(cell?.nodeType ? cell : document.createTextNode(String(cell ?? '')));
      rowNode.append(cellNode);
    });
    body.append(rowNode);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

export function rowList({ items = [], testid } = {}) {
  const list = element('ul', 'lb-rows');
  if (testid) list.dataset.testid = testid;
  for (const item of items) {
    const row = element('li', 'lb-row');
    const main = element('span', 'lb-row-main');
    main.append(element('span', 'lb-row-title', item?.title ?? ''));
    if (item?.meta) main.append(element('span', 'lb-row-meta meta', item.meta));
    row.append(main);
    if (item?.trailing) row.append(item.trailing.nodeType ? item.trailing : statusChip({ state: item.trailing.state ?? 'neutral', label: item.trailing.label ?? '' }));
    list.append(row);
  }
  return list;
}

let fieldSequence = 0;

export function formField({ label, name, value = '', multiline = false, help = '', error = '', required = false, testid, control = null } = {}) {
  const wrapper = element('label', 'lb-field');
  const labelText = element('span', 'lb-field-label', label);
  if (required) labelText.dataset.required = 'true';
  wrapper.append(labelText);
  const input = control ?? element(multiline ? 'textarea' : 'input');
  input.name = name;
  input.value = value;
  input.defaultValue = value;
  if (multiline) input.rows = 3;
  if (required) input.required = true;
  wrapper.append(input);
  const described = [];
  if (help) {
    const id = `lb-field-help-${++fieldSequence}`;
    const node = element('span', 'lb-field-help meta', help);
    node.id = id;
    wrapper.append(node);
    described.push(id);
  }
  if (error) {
    const id = `lb-field-error-${++fieldSequence}`;
    const node = element('span', 'lb-field-error', error);
    node.id = id;
    node.dataset.testid = 'field-error';
    wrapper.append(node);
    described.push(id);
    wrapper.dataset.invalid = 'true';
    input.setAttribute('aria-invalid', 'true');
  }
  if (described.length) input.setAttribute('aria-describedby', described.join(' '));
  if (testid) wrapper.dataset.testid = testid;
  return wrapper;
}

export function field({ label, name, value = '', multiline = false }) {
  return formField({ label, name, value, multiline });
}

export function destructiveAction({ label, onCommit = null, onUndo = null, undoLabel = 'Undo', windowMs = 8000, schedule = null, cancel = null, onAnnounce = null } = {}) {
  const scheduleFn = schedule ?? ((task, ms) => setTimeout(task, ms));
  const cancelFn = cancel ?? (handle => clearTimeout(handle));
  const control = button(label, null, {});
  control.classList.add('lb-destructive');
  control.dataset.testid = 'destructive-action';
  let mode = 'rest';
  let expiry = null;
  function rest() {
    if (expiry != null) cancelFn(expiry);
    expiry = null;
    mode = 'rest';
    control.removeAttribute('data-undo');
    control.textContent = label;
  }
  control.addEventListener('click', () => {
    if (mode === 'undo') {
      rest();
      onUndo?.();
      onAnnounce?.(`${label} undone`);
      return;
    }
    onCommit?.();
    if (typeof onUndo !== 'function') return;
    mode = 'undo';
    control.dataset.undo = 'true';
    control.textContent = undoLabel;
    expiry = scheduleFn(rest, windowMs);
    onAnnounce?.(`${label} applied — ${undoLabel} available`);
  });
  return control;
}

export function graphNode({ id, title, state = 'neutral', detail = '', selected = false, badge = null, onSelect } = {}) {
  if (!Object.hasOwn(glyphs, state)) throw new TypeError('Unknown status role');
  const control = button('', onSelect);
  control.className = 'lb-graph-node';
  control.dataset.testid = 'graph-node';
  control.dataset.nodeId = id;
  control.dataset.state = state;
  control.setAttribute('aria-pressed', String(selected));
  const heading = element('span', 'lb-graph-node-title', title);
  heading.title = title; // the full label stays available when the node ellipsizes
  const head = element('span', 'lb-graph-node-head');
  head.append(heading);
  if (badge) head.append(badge.nodeType ? badge : statusChip({ state: badge.state ?? state, label: badge.label ?? '' }));
  control.append(head);
  if (detail) control.append(element('span', 'lb-graph-node-detail meta', detail));
  return control;
}

export function assignSublanes(intervals) {
  const items = (Array.isArray(intervals) ? intervals : []).map(interval => ({
    start: Number(interval?.start), end: Number(interval?.end),
    label: interval?.label ?? '', state: interval?.state ?? 'neutral', lane: 0,
  }));
  for (const item of items) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end < item.start) throw new TypeError('Timeline intervals need numeric start <= end');
  }
  const sorted = [...items].sort((left, right) => left.start - right.start || left.end - right.end);
  const laneEnds = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.end); }
    else laneEnds[lane] = item.end;
    item.lane = lane;
  }
  return { intervals: sorted, lanes: Math.max(1, laneEnds.length) };
}

export function timelineTrack({ label, intervals = [], testid } = {}) {
  const laid = assignSublanes(intervals);
  const row = element('div', 'lb-lane');
  if (testid) row.dataset.testid = testid;
  row.append(element('span', 'lb-lane-label meta', label));
  const track = element('div', 'lb-track');
  track.dataset.lanes = String(laid.lanes);
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${label}: ${laid.intervals.length} observed interval${laid.intervals.length === 1 ? '' : 's'}${laid.lanes > 1 ? ', overlapping intervals stacked' : ''}`);
  for (const item of laid.intervals) {
    const segment = element('span', 'lb-interval', item.label);
    segment.dataset.state = item.state;
    segment.dataset.lane = String(item.lane);
    if (item.label) segment.title = item.label;
    // Percent positions on the shared axis; the lane index stacks overlaps
    // into separate rows instead of letting bars paint over each other.
    segment.setAttribute('style', `--lb-lane-index: ${item.lane}; inset-inline-start: ${item.start}%; inline-size: ${Math.max(item.end - item.start, 2)}%;`);
    track.append(segment);
  }
  row.append(track);
  return row;
}

export function timelineChart({ tracks = [], testid } = {}) {
  const chart = element('div', 'lb-timeline');
  if (testid) chart.dataset.testid = testid;
  const axis = element('div', 'lb-axis');
  axis.append(element('span', 'lb-axis-label meta', ''));
  const ticks = element('span', 'lb-axis-ticks');
  for (const tick of [0, 25, 50, 75, 100]) {
    const mark = element('span', 'lb-axis-tick meta', `${tick}%`);
    mark.dataset.numeric = 'true';
    ticks.append(mark);
  }
  axis.append(ticks);
  chart.append(axis);
  for (const track of tracks) chart.append(timelineTrack(track));
  return chart;
}

let inspectorPanelSequence = 0;

export function inspectorPanel({ title, content, footer = null, onClose } = {}) {
  const panel = element('aside', 'lb-inspector');
  panel.dataset.testid = 'inspector-panel';
  panel.hidden = true;
  const heading = element('h2', '', title);
  const headingId = `lb-inspector-${++inspectorPanelSequence}`;
  heading.id = headingId;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', headingId);
  const closeControl = button('Close panel', () => api.close('button'));
  closeControl.dataset.testid = 'inspector-panel-close';
  const header = element('header', 'cluster spread');
  header.append(heading, closeControl);
  const body = element('div', 'lb-inspector-body');
  if (content) body.append(content);
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', `${title} content`);
  panel.append(header, body);
  if (footer != null) {
    const foot = element('footer', 'lb-inspector-foot');
    if (Array.isArray(footer)) foot.append(...footer.filter(Boolean));
    else foot.append(footer);
    panel.append(foot);
  }
  let trigger = null;
  let open = false;
  const api = {
    element: panel,
    open(invoker = null) {
      if (invoker) trigger = invoker;
      open = true;
      panel.hidden = false;
      panel.dataset.open = 'true';
      overlayStack.push(api);
      closeControl.focus();
      return panel;
    },
    close(reason = 'api') {
      if (!open) return false;
      open = false;
      panel.hidden = true;
      panel.removeAttribute('data-open');
      const index = overlayStack.indexOf(api);
      if (index !== -1) overlayStack.splice(index, 1);
      const connected = trigger ? (trigger.isConnected ?? globalThis.document?.body?.contains?.(trigger) ?? false) : false;
      const target = connected ? trigger : null;
      trigger = null;
      onClose?.(reason);
      target?.focus();
      return true;
    },
    isOpen: () => open,
  };
  return api;
}

export function skeleton({ lines = 3, testid, label = 'Loading' } = {}) {
  const count = Math.max(1, Number.isFinite(lines) ? lines : 3);
  const node = element('div', 'lb-skeleton');
  node.setAttribute('aria-busy', 'true');
  node.setAttribute('aria-label', label);
  if (testid) node.dataset.testid = testid;
  for (let index = 0; index < count; index += 1) {
    const bar = element('span', 'lb-skeleton-line');
    bar.setAttribute('aria-hidden', 'true');
    bar.dataset.line = String(index);
    node.append(bar);
  }
  return node;
}

const emptyGlyphs = {
  inbox: [
    ['path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }],
    ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  list: [
    ['path', { d: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01' }],
  ],
};

export function emptyState({ icon = 'inbox', title, detail = '', action = null, testid } = {}) {
  if (!Object.hasOwn(emptyGlyphs, icon)) throw new TypeError('Unknown empty-state icon');
  const node = element('div', 'lb-empty');
  if (testid) node.dataset.testid = testid;
  node.append(svgIcon(emptyGlyphs[icon]));
  node.append(element('h3', 'lb-empty-title', title));
  if (detail) node.append(element('p', 'lb-empty-detail meta', detail));
  if (action != null) {
    const control = action.nodeType ? action : button(action.label ?? 'Act', action.onClick ?? null, { primary: action.primary ?? false });
    control.classList.add('lb-empty-action');
    node.append(control);
  }
  return node;
}

export function metricTile({ value, label, coverage = null, unavailable = false, testid } = {}) {
  const node = element('div', 'lb-metric');
  if (testid) node.dataset.testid = testid;
  if (unavailable) node.dataset.unavailable = 'true';
  const figure = element('span', 'lb-metric-value', unavailable ? '—' : String(value));
  figure.dataset.numeric = 'true';
  node.append(figure, element('span', 'lb-metric-label meta', label));
  if (coverage != null) node.append(coverage.nodeType ? coverage : statusChip({ state: coverage.state ?? 'neutral', label: coverage.label ?? '' }));
  return node;
}

/* -- App shell (T12 addendum): sidebar rail, tabbed workspace, dock ------- */

// Destination glyphs (Lucide geometry, ISC) for the icon rail.
const destinationGlyphs = {
  overview: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }]],
  project: [['path', { d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z' }]],
  plans: [['path', { d: 'M3 5h12 M3 12h12 M3 19h9 M17 15l2 2 4-4' }]],
  execution: [['path', { d: 'm6 4 14 8-14 8z' }]],
  git: [['circle', { cx: 6, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['circle', { cx: 18, cy: 12, r: 3 }], ['path', { d: 'M6 9v6 M9 18h3a3 3 0 0 0 3-3V9' }]],
  evidence: [['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 2v6h6 M9 15l2 2 4-4' }]],
  research: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
};

export const SIDEBAR_DESTINATION_ICONS = Object.freeze(Object.keys(destinationGlyphs));

// T20a additive extensions (the flat `destinations` contract is unchanged):
//   groups            [{ label, destinations: [...] }] renders small section
//                     headers (uppercase via CSS) over the same destination
//                     rows, inside the single j/k-traversable list
//   identityPosition  'footer' moves the product identity block into the
//                     footer region (the shell's identity footer)
// Collapsing to the icon rail also gives every destination a native title
// tooltip, following the T11 clipped-note contract (visible label when
// expanded, title + aria-label when the label is hidden).
export function sidebarNav({ product = 'LazySeries', runtime = 'LazyBuddy', destinations = [], groups = null, identityPosition = 'header', tree = null, footer = null, current = null, collapsed = false, onNavigate = null, onCollapse = null, testid } = {}) {
  const rail = element('aside', 'lb-sidebar');
  rail.dataset.testid = testid ?? 'sidebar-nav';
  const collapseControl = button('', null);
  collapseControl.className = 'lb-sidebar-collapse';
  collapseControl.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  collapseControl.setAttribute('aria-expanded', String(!collapsed));
  collapseControl.textContent = collapsed ? '»' : '«';
  const identity = element(identityPosition === 'footer' ? 'div' : 'header', 'lb-sidebar-identity');
  const badge = element('span', 'lb-sidebar-product', product);
  badge.dataset.product = runtime; // the per-product accent wash, identity only
  identity.append(badge, element('span', 'lb-sidebar-runtime meta', runtime));
  const list = element('ul', 'lb-sidebar-destinations');
  list.dataset.nativeList = 'true'; // j/k traversal through the T11 focus layer
  const destinationItem = destination => {
    const item = element('li', '');
    const control = button('', () => { api.navigate(destination.id); onNavigate?.(destination.id); });
    control.className = 'lb-sidebar-destination';
    control.dataset.destination = destination.id;
    control.setAttribute('aria-label', destination.label ?? destination.id);
    const icon = destinationGlyphs[destination.icon ?? destination.id] ?? destinationGlyphs.overview;
    control.append(svgIcon(icon));
    control.append(element('span', 'lb-sidebar-destination-label', destination.label ?? destination.id));
    if (destination.id === current) control.setAttribute('aria-current', 'page');
    item.append(control);
    return item;
  };
  if (Array.isArray(groups) && groups.length > 0) {
    for (const group of groups) {
      const section = element('li', 'lb-sidebar-group');
      section.append(element('span', 'lb-sidebar-group-label', group.label ?? ''));
      const members = element('ul', 'lb-sidebar-group-items');
      members.setAttribute('role', 'group');
      if (group.label) members.setAttribute('aria-label', group.label);
      for (const destination of group.destinations ?? []) members.append(destinationItem(destination));
      section.append(members);
      list.append(section);
    }
  } else {
    for (const destination of destinations) list.append(destinationItem(destination));
  }
  if (identityPosition === 'footer') rail.append(collapseControl, list);
  else rail.append(collapseControl, identity, list);
  if (tree != null) {
    const treeRegion = element('nav', 'lb-sidebar-tree');
    treeRegion.setAttribute('aria-label', 'Context objects');
    treeRegion.append(tree);
    rail.append(treeRegion);
  }
  const footerRegion = element('footer', 'lb-sidebar-footer cluster');
  if (identityPosition === 'footer') footerRegion.append(identity);
  if (footer != null) (Array.isArray(footer) ? footer : [footer]).forEach(node => footerRegion.append(node));
  rail.append(footerRegion);
  const api = {
    element: rail,
    navigate(id) {
      for (const control of list.querySelectorAll('.lb-sidebar-destination')) {
        if (control.dataset.destination === id) control.setAttribute('aria-current', 'page');
        else control.removeAttribute('aria-current');
      }
    },
    setCollapsed(next, { notify = true } = {}) {
      const value = Boolean(next);
      rail.dataset.collapsed = String(value);
      collapseControl.setAttribute('aria-expanded', String(!value));
      collapseControl.setAttribute('aria-label', value ? 'Expand sidebar' : 'Collapse sidebar');
      collapseControl.textContent = value ? '»' : '«';
      for (const control of list.querySelectorAll('.lb-sidebar-destination')) {
        // T20a rail tooltips: the visible label disappears with the rail, so
        // the collapsed rows carry their label as a native title (the T11
        // describe pass never strips an existing title).
        if (value) { if (!control.getAttribute('title')) control.setAttribute('title', control.getAttribute('aria-label')); }
        else control.removeAttribute('title');
      }
      if (notify) onCollapse?.(value);
      return value;
    },
    toggle() { return api.setCollapsed(rail.dataset.collapsed !== 'true'); },
    isCollapsed: () => rail.dataset.collapsed === 'true',
  };
  collapseControl.addEventListener('click', () => api.toggle());
  api.setCollapsed(collapsed, { notify: false }); // the initial state is not a user action
  return api;
}

export function createTabs({ tabs = [], current = null, onChange = null } = {}) {
  const tablist = element('div', 'lb-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.dataset.testid = 'tab-strip';
  const panels = element('div', 'lb-tabpanels');
  panels.dataset.testid = 'tab-panels';
  const workspace = element('div', 'lb-tabbed');
  workspace.append(tablist, panels);
  const registry = new Map();
  let sequence = 0;
  function paint() {
    const order = [...tablist.children];
    for (const tab of order) {
      const active = tab.dataset.tabId === activeId;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) tab.setAttribute('data-active', 'true'); else tab.removeAttribute('data-active');
      const panel = registry.get(tab.dataset.tabId)?.panel;
      if (panel) panel.hidden = !active; // hide, never destroy: view state survives switches and polling
    }
  }
  let activeId = null;
  function select(id, { notify = true, focus = false } = {}) {
    if (!registry.has(id)) return activeId;
    activeId = id;
    paint();
    if (focus) registry.get(id)?.tab.focus();
    if (notify) onChange?.(id, 'select');
    return activeId;
  }
  function openTab({ id, title, content, pinned = false, closable = !pinned }) {
    if (id == null) id = `tab-${++sequence}`;
    if (registry.has(id)) return select(id);
    const tabId = `lb-tab-${id}-${++sequence}`;
    const panelId = `lb-tabpanel-${id}-${sequence}`;
    const tab = element('div', 'lb-tab');
    tab.dataset.testid = 'tab';
    tab.dataset.tabId = id;
    tab.dataset.pinned = String(pinned);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-label', String(title));
    tab.append(element('span', 'lb-tab-label', String(title)));
    if (closable) {
      const closeControl = button('', event => { event.stopPropagation?.(); closeTab(id); });
      closeControl.className = 'lb-tab-close';
      closeControl.setAttribute('aria-label', `Close ${title}`);
      closeControl.textContent = '×';
      tab.append(closeControl);
    } else tab.classList.add('lb-tab-pinned');
    const panel = element('section', 'lb-tabpanel');
    panel.dataset.testid = 'tab-panel';
    panel.dataset.tabId = id;
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.hidden = true;
    if (content) panel.append(content);
    tab.id = tabId;
    registry.set(id, { tab, panel, pinned, closable });
    tablist.append(tab);
    panels.append(panel);
    if (activeId == null) select(id, { notify: false });
    else paint();
    onChange?.(id, 'open');
    return id;
  }
  function closeTab(id) {
    const entry = registry.get(id);
    if (!entry || entry.pinned || !entry.closable) return false;
    const order = [...tablist.children].map(node => node.dataset.tabId);
    const index = order.indexOf(id);
    entry.tab.remove();
    entry.panel.remove(); // callers that need persistence keep content themselves via openTab re-adding
    registry.delete(id);
    if (activeId === id) {
      const next = order[index + 1] ?? order[index - 1];
      if (next != null && registry.has(next)) select(next, { focus: true });
      else { activeId = null; paint(); }
    }
    onChange?.(id, 'close');
    return true;
  }
  tablist.addEventListener('click', event => {
    const tab = closestAncestor(event.target, '.lb-tab');
    if (tab?.dataset?.tabId) select(tab.dataset.tabId, { focus: false });
  });
  tablist.addEventListener('keydown', event => {
    if (event.defaultPrevented || typeof event.key !== 'string') return;
    const order = [...tablist.querySelectorAll('.lb-tab')];
    if (order.length === 0) return;
    const digits = /^Digit([1-9])$/.exec(event.code ?? '');
    if ((event.metaKey || event.ctrlKey) && digits) {
      const target = order[Number(digits[1]) - 1];
      if (!target) return;
      event.preventDefault?.();
      select(target.dataset.tabId, { focus: true });
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = order.findIndex(node => node.dataset.tabId === activeId);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault?.();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = order[(index + delta + order.length) % order.length];
      select(next.dataset.tabId, { focus: true }); // activate-on-focus, like the segmented control
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault?.();
      const next = event.key === 'Home' ? order[0] : order[order.length - 1];
      select(next.dataset.tabId, { focus: true });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      const tab = closestAncestor(event.target, '.lb-tab');
      if (tab && registry.get(tab.dataset.tabId)?.closable) { event.preventDefault?.(); closeTab(tab.dataset.tabId); }
    }
  });
  for (const tab of tabs) openTab(tab);
  if (current != null && registry.has(current)) select(current, { notify: false });
  return {
    element: workspace, tablist, panels,
    openTab, closeTab, select,
    getActive: () => activeId,
    tabs: () => [...tablist.querySelectorAll('.lb-tab')].map(node => node.dataset.tabId),
  };
}

export function createDockPanel({ title, content, footer = null, open: initiallyOpen = false, onClose } = {}) {
  const dock = element('aside', 'lb-dock');
  dock.dataset.testid = 'dock-panel';
  dock.hidden = true;
  const heading = element('h2', '', title);
  const headingId = `lb-dock-${++inspectorPanelSequence}`;
  heading.id = headingId;
  dock.setAttribute('role', 'region');
  dock.setAttribute('aria-labelledby', headingId);
  const closeControl = button('Collapse dock', () => api.close('button'));
  closeControl.dataset.testid = 'dock-panel-close';
  const header = element('header', 'cluster spread');
  header.append(heading, closeControl);
  const body = element('div', 'lb-dock-body');
  if (content) body.append(content);
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', `${title} content`);
  dock.append(header, body);
  if (footer != null) {
    const foot = element('footer', 'lb-dock-foot');
    if (Array.isArray(footer)) foot.append(...footer.filter(Boolean));
    else foot.append(footer);
    dock.append(foot);
  }
  let trigger = null;
  let openState = false;
  const api = {
    element: dock,
    open(invoker = null) {
      if (invoker) trigger = invoker;
      openState = true;
      dock.hidden = false;
      dock.dataset.open = 'true';
      overlayStack.push(api);
      closeControl.focus();
      return dock;
    },
    close(reason = 'api') {
      if (!openState) return false;
      openState = false;
      dock.hidden = true;
      dock.removeAttribute('data-open');
      const index = overlayStack.indexOf(api);
      if (index !== -1) overlayStack.splice(index, 1);
      const connected = trigger ? (trigger.isConnected ?? globalThis.document?.body?.contains?.(trigger) ?? false) : false;
      const target = connected ? trigger : null;
      trigger = null;
      onClose?.(reason);
      target?.focus();
      return true;
    },
    toggle(invoker = null) { return openState ? api.close('toggle') : (api.open(invoker), true); },
    isOpen: () => openState,
  };
  if (initiallyOpen) api.open();
  return api;
}
