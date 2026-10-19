import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 focus system proof: destination tab ring CSS, j/k list traversal
// (graph/list/queue scopes), '/' filter focus, and Escape closing the
// inspector dialog or a native overlay with focus returned to the invoking
// control. Drives installFocusSystem over the mini-dom fixture.

const dom = createMiniDom();
globalThis.document = dom.document;

const {
  installFocusSystem, createInspector, createOverlayPanel, button, element,
} = await import('../ui/components.mjs');

function press(target, key, extra = {}) {
  return target.dispatchEvent({ type: 'keydown', key, bubbles: true, ...extra });
}

function dialogApi(dialog) {
  dialog.showModal = () => { dialog.setAttribute('open', ''); };
  dialog.close = () => {
    if (!dialog.hasAttribute('open')) return;
    dialog.removeAttribute('open');
    dialog.dispatchEvent({ type: 'close' });
  };
  return dialog;
}

test('focus ring: the keyboard ring is the v2 --focus-ring token', async () => {
  const css = await readFile(new URL('../ui/style.css', import.meta.url), 'utf8');
  const rule = /:focus-visible\s*\{[^}]*\}/.exec(css)?.[0];
  assert.ok(rule, 'style.css keeps a :focus-visible rule');
  assert.match(rule, /box-shadow:\s*var\(--focus-ring\)/);
  assert.doesNotMatch(rule, /outline:\s*(?!none\b)[a-z]/, 'the ring is not a second outline system');
});

test('j/k traverse the items of the nearest list scope and wrap around', () => {
  const detach = installFocusSystem();
  try {
    const list = element('div', 'task-list');
    const first = button('Setup', () => {});
    const second = button('Install', () => {});
    const third = button('Join', () => {});
    list.append(first, second, third);
    dom.document.body.append(list);

    first.focus();
    press(first, 'j');
    assert.equal(dom.document.activeElement, second, 'j moves focus forward within the list');
    press(second, 'j');
    assert.equal(dom.document.activeElement, third);
    press(third, 'j');
    assert.equal(dom.document.activeElement, first, 'j wraps to the first item');
    press(first, 'k');
    assert.equal(dom.document.activeElement, third, 'k wraps backwards');
    press(third, 'k');
    assert.equal(dom.document.activeElement, second);

    list.remove();
  } finally { detach.detach(); }
});

test('j/k is scoped to the graph viewport and ignored while typing', () => {
  const detach = installFocusSystem();
  try {
    const viewport = element('div', 'graph-viewport');
    viewport.tabIndex = 0;
    const cardA = button('Setup', () => {});
    const cardB = button('Install', () => {});
    viewport.append(cardA, cardB);
    dom.document.body.append(viewport);

    viewport.focus();
    press(viewport, 'j');
    assert.equal(dom.document.activeElement, cardA, 'j from the viewport surface enters the graph list');

    const field = element('input');
    field.type = 'text';
    viewport.append(field);
    field.focus();
    press(field, 'j');
    assert.equal(dom.document.activeElement, field, 'typing in an input never moves focus');

    const outside = button('Stray', () => {});
    dom.document.body.append(outside);
    outside.focus();
    const before = dom.document.activeElement;
    press(outside, 'j');
    assert.equal(dom.document.activeElement, before, 'no list scope means no traversal');

    viewport.remove();
    outside.remove();
  } finally { detach.detach(); }
});

test('/ focuses the first filter input when one exists and stays inert otherwise', () => {
  const detach = installFocusSystem();
  try {
    const heading = button('Work', () => {});
    dom.document.body.append(heading);
    heading.focus();
    press(heading, '/');
    assert.equal(dom.document.activeElement, heading, 'no filter input: focus is untouched');

    const filter = element('input');
    filter.type = 'search';
    filter.setAttribute('aria-label', 'Filter tasks');
    const other = element('input');
    other.type = 'text';
    const form = element('form');
    form.append(other, filter);
    dom.document.body.append(form);
    const event = { type: 'keydown', key: '/', bubbles: true, target: heading, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    heading.dispatchEvent(event);
    assert.equal(dom.document.activeElement, filter, '/ focuses the first filter/search input');
    assert.equal(event.defaultPrevented, true);

    form.remove();
    heading.remove();
  } finally { detach.detach(); }
});

test('Escape closes the open inspector dialog and returns focus to the invoking control', () => {
  const detach = installFocusSystem();
  try {
    const trigger = button('Task: Join', () => {});
    trigger.dataset.taskId = 'join';
    dom.document.body.append(trigger);
    const content = element('div', 'stack');
    const inspector = createInspector({ title: 'Task details', content });
    dialogApi(inspector.element);
    dom.document.body.append(inspector.element);
    inspector.open(trigger);
    assert.equal(inspector.element.hasAttribute('open'), true);

    press(inspector.element, 'Escape');
    assert.equal(inspector.element.hasAttribute('open'), false, 'Escape closes the inspector');
    assert.equal(dom.document.activeElement, trigger, 'focus returns to the invoking control');

    inspector.element.remove();
    trigger.remove();
  } finally { detach.detach(); }
});

test('Escape closes the topmost native overlay and returns focus to its invoker', () => {
  const detach = installFocusSystem();
  try {
    const invoker = button('Open details', () => {});
    dom.document.body.append(invoker);
    const overlay = createOverlayPanel({ title: 'Activity', content: element('p', '', 'Quiet') });
    dom.document.body.append(overlay.element);
    invoker.focus();
    overlay.open(invoker);
    assert.equal(overlay.isOpen(), true);
    assert.equal(overlay.element.hidden, false);

    press(overlay.element, 'Escape');
    assert.equal(overlay.isOpen(), false, 'Escape closes the overlay');
    assert.equal(overlay.element.hidden, true);
    assert.equal(dom.document.activeElement, invoker, 'focus returns to the invoking control');

    overlay.element.remove();
    invoker.remove();
  } finally { detach.detach(); }
});

test('overlay API closes with focus return even when the invoker was re-rendered away', () => {
  const invoker = button('Open', () => {});
  const overlay = createOverlayPanel({ title: 'Panel', content: element('p', '', 'Body') });
  dom.document.body.append(overlay.element);
  overlay.open(invoker);
  invoker.remove(); // polling re-render removed the trigger
  assert.equal(overlay.close('api'), true);
  assert.equal(overlay.isOpen(), false);
  assert.notEqual(dom.document.activeElement, invoker, 'a detached invoker is never refocused; no crash');
  overlay.element.remove();
});
