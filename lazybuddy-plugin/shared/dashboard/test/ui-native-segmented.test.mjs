import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 segmented control proof: the shared component (used by the density
// toggle) and the layer's arrow-key activation for every group marked
// data-native-segmented — including the Graph/List switchers wired in
// work-view, execution-view and the project-map spike. ArrowLeft/Right wrap
// and activate; Home/End jump; disabled segments are skipped.

const dom = createMiniDom();
globalThis.document = dom.document;

const { segmentedControl, installFocusSystem, button, element } = await import('../ui/components.mjs');

function segmented() {
  return segmentedControl({
    label: 'Presentation',
    options: [{ value: 'graph', label: 'Graph' }, { value: 'list', label: 'List' }, { value: 'table', label: 'Table', disabled: true }],
    current: 'graph',
    onChange: () => {},
  });
}

test('segmented control renders one current segment with group semantics', () => {
  const control = segmented();
  assert.equal(control.element.dataset.nativeSegmented, 'true');
  assert.equal(control.element.getAttribute('role'), 'group');
  assert.equal(control.element.getAttribute('aria-label'), 'Presentation');
  const segments = [...control.element.querySelectorAll('button')];
  assert.deepEqual(segments.map(node => node.dataset.segment), ['graph', 'list', 'table']);
  assert.deepEqual(segments.map(node => node.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.equal(segments[0].getAttribute('data-current'), 'true');
  assert.equal(segments[2].disabled, true);
  assert.equal(control.get(), 'graph');
});

test('clicking and setCurrent move the current segment; unknown values are rejected', () => {
  const applied = [];
  const control = segmentedControl({
    label: 'Lens',
    options: [{ value: 'product', label: 'Product' }, { value: 'engineering', label: 'Engineering' }],
    current: 'product',
    onChange: value => applied.push(value),
  });
  const [product, engineering] = [...control.element.querySelectorAll('button')];
  engineering.click();
  assert.equal(control.get(), 'engineering');
  assert.deepEqual(applied, ['engineering'], 'clicks notify the owner');
  assert.equal(product.getAttribute('aria-pressed'), 'false');

  control.setCurrent('product');
  assert.equal(control.get(), 'product');
  assert.deepEqual(applied, ['engineering'], 'programmatic setCurrent never notifies');
  assert.equal(product.getAttribute('data-current'), 'true');

  control.setCurrent('nonexistent');
  assert.equal(control.get(), 'product', 'unknown values are a no-op');
  assert.throws(() => segmentedControl({ label: 'Empty', options: [] }), TypeError);
});

test('arrow keys activate and wrap segments; Home and End jump; disabled segments keep focus', () => {
  const detach = installFocusSystem();
  try {
    const applied = [];
    const control = segmentedControl({
      label: 'Presentation',
      options: [{ value: 'graph', label: 'Graph' }, { value: 'list', label: 'List' }, { value: 'cards', label: 'Cards' }],
      current: 'graph',
      onChange: value => applied.push(value),
    });
    dom.document.body.append(control.element);
    const [graph, list, cards] = [...control.element.querySelectorAll('button')];

    graph.focus();
    graph.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(control.get(), 'list', 'ArrowRight activates the next segment');
    assert.equal(dom.document.activeElement, list, 'focus follows the selection');

    list.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(control.get(), 'cards');
    cards.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(control.get(), 'graph', 'ArrowRight wraps to the first segment');

    graph.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', bubbles: true });
    assert.equal(control.get(), 'cards', 'ArrowLeft wraps backwards to the last segment');
    cards.dispatchEvent({ type: 'keydown', key: 'Home', bubbles: true });
    assert.equal(control.get(), 'graph');
    graph.dispatchEvent({ type: 'keydown', key: 'End', bubbles: true });
    assert.equal(control.get(), 'cards');
    assert.deepEqual(applied, ['list', 'cards', 'graph', 'cards', 'graph', 'cards'], 'each activation notifies exactly once');

    // Modifier chords never drive the control (system shortcuts stay free).
    graph.focus();
    control.setCurrent('graph');
    graph.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true, ctrlKey: true });
    assert.equal(control.get(), 'graph', 'modified arrows are ignored');
    control.element.remove();
  } finally { detach.detach(); }
});

test('disabled segments are skipped by arrow traversal but stay reachable for clarity', () => {
  const detach = installFocusSystem();
  try {
    const control = segmented();
    dom.document.body.append(control.element);
    const [graph, list, table] = [...control.element.querySelectorAll('button')];
    graph.focus();
    graph.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(control.get(), 'list');
    assert.equal(dom.document.activeElement, list);
    list.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(control.get(), 'graph', 'the disabled table segment is never activated');
    control.element.remove();
  } finally { detach.detach(); }
});

test('Graph/List switchers are wired to the segmented keyboard layer', async () => {
  for (const file of ['work-view.mjs', 'execution-view.mjs', 'project-map-spike.mjs']) {
    const source = await readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8');
    assert.match(source, /nativeSegmented\s*=\s*'true'/, `${file} marks its Graph/List switcher`);
  }
  const style = await readFile(new URL('../ui/style.css', import.meta.url), 'utf8');
  assert.match(style, /\.view-switcher\s*\{[^}]*background:\s*var\(--inset\)/, 'switchers render on the segmented track');
  assert.match(style, /\.view-switcher button\[aria-pressed='true'\]/, 'the current segment has a raised current state');
});

test('a work-view-shaped switcher activates through the document layer while re-rendering', () => {
  const detach = installFocusSystem();
  try {
    let mode = 'graph';
    const root = element('section', 'work-view');
    const switcher = element('div', 'view-switcher cluster');
    switcher.dataset.nativeSegmented = 'true';
    for (const value of ['graph', 'list']) {
      const control = button(value === 'graph' ? 'Graph' : 'List', () => { mode = value; render(); });
      control.dataset.mode = value;
      switcher.append(control);
    }
    function render() {
      for (const control of switcher.querySelectorAll('button')) {
        control.setAttribute('aria-pressed', String(control.dataset.mode === mode));
      }
    }
    render();
    root.append(switcher);
    dom.document.body.append(root);
    const [graphButton, listButton] = [...switcher.querySelectorAll('button')];

    graphButton.focus();
    graphButton.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
    assert.equal(mode, 'list', 'the layer activates the adjacent Graph/List segment');
    assert.equal(dom.document.activeElement.dataset.mode, 'list', 'focus lands on the re-rendered current segment');

    listButton.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', bubbles: true });
    assert.equal(mode, 'graph');
    assert.equal(dom.document.activeElement.dataset.mode, 'graph');
    root.remove();
  } finally { detach.detach(); }
});
