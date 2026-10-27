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
  createDockPanel, inspectorPanel, installTooltips, statusChip,
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

test('j/k also traverses the spike/architecture/execution graph viewport scopes', () => {
  const detach = installFocusSystem();
  try {
    for (const scopeClass of ['spike-graph-viewport', 'architecture-graph-viewport', 'execution-graph-viewport']) {
      const viewport = element('div', scopeClass);
      const cardA = button('Boundary', () => {});
      const cardB = button('Feature', () => {});
      viewport.append(cardA, cardB);
      dom.document.body.append(viewport);
      cardA.focus();
      press(cardA, 'j');
      assert.equal(dom.document.activeElement, cardB, `j traverses .${scopeClass}`);
      press(cardB, 'k');
      assert.equal(dom.document.activeElement, cardA, `k traverses .${scopeClass}`);
      viewport.remove();
    }
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

/* -- V2-T9 Radix FocusScope-style Tab loop containment ---------------------- */

test('Tab inside the trapped dock loops through the panel focusables and wraps', () => {
  const detach = installFocusSystem();
  try {
    const body = element('div', 'stack');
    const firstField = element('input');
    firstField.type = 'text';
    const lastAction = button('Apply', null);
    body.append(firstField, element('p', '', 'Body'), lastAction);
    const dock = createDockPanel({ title: 'Inspector dock', content: body, footer: button('Dismiss', null) });
    const invoker = button('Open dock', () => {});
    dom.document.body.append(invoker, dock.element);
    dock.open(invoker);
    // initial focus is the close control (the unchanged first-open contract)
    assert.equal(dom.document.activeElement, dock.element.querySelector('[data-testid="dock-panel-close"]'), 'open focuses the close control');
    // DOM-order focusables: close, the scrollable body region (tabIndex=0,
    // a real tab stop for keyboard scrolling), input, Apply, footer Dismiss
    const order = [
      dock.element.querySelector('[data-testid="dock-panel-close"]'),
      dock.element.querySelector('.lb-dock-body'),
      firstField,
      lastAction,
      dock.element.querySelector('.lb-dock-foot button'),
    ];

    press(order[0], 'Tab');
    assert.equal(dom.document.activeElement, order[1], 'Tab moves to the next focusable inside the dock');
    press(order[1], 'Tab');
    assert.equal(dom.document.activeElement, order[2]);
    press(order[2], 'Tab');
    assert.equal(dom.document.activeElement, order[3]);
    press(order[3], 'Tab');
    assert.equal(dom.document.activeElement, order[4]);
    press(order[4], 'Tab');
    assert.equal(dom.document.activeElement, order[0], 'Tab from the last focusable wraps to the first (loop)');

    press(order[0], 'Tab', { shiftKey: true });
    assert.equal(dom.document.activeElement, order[4], 'Shift+Tab from the first focusable wraps to the last');
    press(order[4], 'Tab', { shiftKey: true });
    assert.equal(dom.document.activeElement, order[3], 'Shift+Tab steps backwards inside the panel');

    dock.close();
    dock.element.remove();
    invoker.remove();
  } finally { detach.detach(); }
});

test('Tab keeps its native flow outside a trapped overlay; trapFocus: false opts out', () => {
  const detach = installFocusSystem();
  try {
    const outside = button('Page control', () => {});
    const other = button('Next page control', () => {});
    dom.document.body.append(outside, other);
    const overlay = createOverlayPanel({ title: 'Activity', content: element('p', '', 'Quiet') });
    const loose = createOverlayPanel({ title: 'Loose', content: element('p', '', 'No trap'), trapFocus: false });
    dom.document.body.append(overlay.element, loose.element);
    overlay.open(outside);
    assert.equal(overlay.element.hasAttribute('data-native-trap'), true, 'panels opt into the loop by default');
    loose.open(outside);
    assert.equal(loose.element.hasAttribute('data-native-trap'), false, 'trapFocus: false removes the loop contract');

    // focus OUTSIDE the topmost (loose) overlay: the layer never interferes
    const event = { type: 'keydown', key: 'Tab', bubbles: true, target: outside, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    outside.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'Tab from the page keeps its native flow (non-modal overlays)');

    loose.close();
    overlay.close();
    overlay.element.remove();
    loose.element.remove();
    outside.remove();
    other.remove();
  } finally { detach.detach(); }
});

test('every overlay panel carries an aria-describedby dismissal note (Radix Dialog.Description)', () => {
  for (const built of [
    createOverlayPanel({ title: 'Overlay', content: element('p', '', 'x') }),
    createDockPanel({ title: 'Dock', content: element('p', '', 'x') }),
    inspectorPanel({ title: 'Panel', content: element('p', '', 'x') }),
    createInspector({ title: 'Dialog', content: element('div', 'stack') }),
  ]) {
    const panel = built.element ?? built; // createInspector returns { element }
    const describedBy = panel.getAttribute('aria-describedby');
    assert.ok(describedBy, `${panel.tagName}.${panel.className} is described`);
    const note = panel.querySelector('.native-note');
    assert.ok(note, 'the description note lives inside the panel (it dies with it)');
    assert.equal(note.id, describedBy, 'aria-describedby points at the note');
    assert.match(note.textContent, /Escape/i, 'the default note states the dismissal contract');
    panel.remove();
  }
  const custom = createOverlayPanel({ title: 'Custom', content: element('p', '', 'x'), description: 'Session summary for this run.' });
  assert.equal(custom.element.querySelector('.native-note').textContent, 'Session summary for this run.');
  assert.equal(createOverlayPanel({ title: 'Bare', content: element('p', '', 'x'), description: '' }).element.hasAttribute('aria-describedby'), false, 'description: "" opts out');
  custom.element.remove();
});

test('opening an overlay re-describes dynamic icon-only buttons inside it', () => {
  const detach = installFocusSystem();
  try {
    const tooltips = installTooltips({ root: dom.document });
    const iconOnly = button('', () => {});
    iconOnly.setAttribute('aria-label', 'Refresh records');
    const body = element('div', 'stack');
    body.append(element('p', '', 'Rendered by a polling refresh after open'), iconOnly);
    const overlay = createOverlayPanel({ title: 'Dynamic', content: body });
    dom.document.body.append(overlay.element);
    assert.equal(iconOnly.hasAttribute('aria-describedby'), false, 'nothing is described before the open');
    overlay.open(button('Opener', () => {}));
    assert.ok(iconOnly.getAttribute('aria-describedby'), 'the icon-only button rendered inside the open panel got its note');
    assert.equal(tooltips.describe(body), 0, 'a second pass is idempotent');
    overlay.close();
    overlay.element.remove();
  } finally { detach.detach(); }
});

test('describe() runs clean on first-paint content: chips and every naming source (misleading-success guard)', () => {
  // Direct call — NOT through the best-effort describeOnOpen() swallow — so a
  // ReferenceError inside the describe pass fails HERE instead of hiding
  // behind the overlay-open try/catch (the class of bug the V2-T9 browser
  // pass caught on the showcase).
  const tooltips = installTooltips({ root: dom.document });
  const host = element('div', 'stack');
  host.append(statusChip({ state: 'verified', label: 'Verified' }));
  const labelled = button('', () => {});
  labelled.setAttribute('aria-label', 'Open records');
  const titled = button('', () => {});
  titled.title = 'Close panel';
  const nameless = button('', () => {});
  host.append(labelled, titled, nameless);
  assert.equal(tooltips.describe(host), 3, 'three nodes described: one chip + two named icon-only buttons');
  for (const node of [host.querySelector('.status'), labelled, titled]) {
    assert.ok(node.getAttribute('aria-describedby'), 'each described node carries aria-describedby');
    assert.ok(node.getAttribute('title'), 'each described node carries a native tooltip');
  }
  assert.equal(nameless.getAttribute('data-native-unlabeled'), 'true', 'a nameless icon-only button is flagged, never invented-for');
  assert.equal(nameless.hasAttribute('aria-describedby'), false);
  assert.equal(tooltips.describe(host), 0, 'the second pass is a no-op');
  host.remove();
});
