/** Text-only DOM primitives. The caller owns data validation and authority. */
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
      const view = returnIdentity.view ? `[data-view="${CSS.escape(returnIdentity.view)}"]` : '';
      target = document.querySelector(`${view}[data-task-id="${CSS.escape(returnIdentity.taskId)}"]`);
    }
    target?.focus();
  });
  return { element: dialog, open(invoker) { trigger = invoker; returnIdentity = { taskId: invoker?.dataset.taskId, view: invoker?.dataset.view }; dialog.showModal(); close.focus(); } };
}
createInspector.sequence = 0;
