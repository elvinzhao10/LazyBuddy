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

export function statusChip({ state = 'neutral', label }) {
  if (!Object.hasOwn(glyphs, state)) throw new TypeError('Unknown status role');
  const chip = element('span', 'status');
  chip.dataset.state = state;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const [tag, attributes] = glyphs[state];
  const shape = document.createElementNS(icon.namespaceURI, tag);
  for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
  icon.append(shape);
  chip.append(icon, document.createTextNode(label));
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

export function field({ label, name, value = '', multiline = false }) {
  const wrapper = element('label', '', label);
  const input = element(multiline ? 'textarea' : 'input');
  input.name = name;
  input.value = value;
  input.defaultValue = value;
  if (multiline) input.rows = 3;
  wrapper.append(input);
  return wrapper;
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
