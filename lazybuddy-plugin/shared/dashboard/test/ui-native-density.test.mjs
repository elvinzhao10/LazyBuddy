import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 density proof: compact/regular persistence per browser (localStorage via
// a safe try/catch shim), the data-density -> --density-gutter token bridge,
// the mounted segmented control, and the malformed-input / unavailable-storage
// adversarial classes (stored garbage must fall back to regular and never
// throw; a blocked localStorage degrades to in-memory).

const dom = createMiniDom();
globalThis.document = dom.document;

const { createDensityController, announce, NATIVE_DENSITY_STORAGE_KEY } = await import('../ui/components.mjs');

function memoryStorage(initial = new Map()) {
  const map = initial instanceof Map ? initial : new Map(Object.entries(initial));
  return {
    reads: 0, writes: [], failures: { getItem: false, setItem: false },
    getItem(key) { this.reads += 1; if (this.failures.getItem) throw new Error('blocked'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (this.failures.setItem) throw new Error('blocked'); this.writes.push([key, String(value)]); map.set(key, String(value)); },
    dump: () => Object.fromEntries(map),
  };
}

test('density applies to the root element and persists through the storage', () => {
  const storage = memoryStorage();
  const density = createDensityController({ storage });
  assert.equal(density.get(), 'regular', 'first visit starts at regular density');
  assert.equal(dom.document.documentElement.dataset.density, 'regular');

  density.apply('compact');
  assert.equal(density.get(), 'compact');
  assert.equal(dom.document.documentElement.dataset.density, 'compact');
  assert.deepEqual(storage.writes.at(-1), [NATIVE_DENSITY_STORAGE_KEY, 'compact']);

  density.toggle();
  assert.equal(density.get(), 'regular');
  density.toggle();
  assert.equal(density.get(), 'compact', 'toggle flips both ways');
});

test('stale_state: a stored density survives a controller rebuild (reload)', () => {
  const storage = memoryStorage({ [NATIVE_DENSITY_STORAGE_KEY]: 'compact' });
  const first = createDensityController({ storage });
  assert.equal(first.get(), 'compact', 'the persisted value is read back before first paint');
  first.toggle(); // user switches to regular and reloads immediately
  const reloaded = createDensityController({ storage });
  assert.equal(reloaded.get(), 'regular', 'the rebuilt controller sees the last stored density');
  assert.equal(dom.document.documentElement.dataset.density, 'regular');
});

test('malformed_input: garbage storage values fall back to regular without throwing', () => {
  for (const garbage of ['dense', '', 'COMPACT', '"compact"', 'null', 'compact ', '2']) {
    const storage = memoryStorage({ [NATIVE_DENSITY_STORAGE_KEY]: garbage });
    let density;
    assert.doesNotThrow(() => { density = createDensityController({ storage }); }, `stored ${JSON.stringify(garbage)}`);
    assert.equal(density.get(), 'regular', `stored ${JSON.stringify(garbage)} must not resolve to a density`);
  }
  const density = createDensityController({ storage: memoryStorage({ [NATIVE_DENSITY_STORAGE_KEY]: 'nope' }) });
  assert.equal(density.apply('spacious'), 'regular', 'unknown programmatic values are rejected');
  assert.equal(density.apply(undefined), 'regular');
});

test('blocked storage degrades to in-memory density and never throws', () => {
  const storage = memoryStorage({ [NATIVE_DENSITY_STORAGE_KEY]: 'compact' });
  storage.failures.getItem = true;
  const readBlocked = createDensityController({ storage });
  assert.equal(readBlocked.get(), 'regular', 'unreadable storage falls back to the default');

  storage.failures.getItem = false;
  storage.failures.setItem = true;
  const writeBlocked = createDensityController({ storage });
  assert.doesNotThrow(() => writeBlocked.apply('compact'));
  assert.equal(writeBlocked.get(), 'compact', 'the density still applies in memory');
  assert.deepEqual(writeBlocked.apply('regular'), 'regular');

  assert.doesNotThrow(() => createDensityController({ storage: undefined }), 'missing storage object is safe');
});

test('the density segmented control reflects and changes the persisted state', () => {
  const storage = memoryStorage();
  const density = createDensityController({ storage, onAnnounce: () => {} });
  const control = density.control();
  dom.document.body.append(control.element);
  const segments = [...control.element.querySelectorAll('button')];
  assert.deepEqual(segments.map(node => node.dataset.segment), ['compact', 'regular']);
  assert.equal(segments[1].getAttribute('aria-pressed'), 'true', 'regular is current initially');

  segments[0].click();
  assert.equal(density.get(), 'compact');
  assert.deepEqual(storage.writes.at(-1), [NATIVE_DENSITY_STORAGE_KEY, 'compact']);
  assert.equal(segments[0].getAttribute('aria-pressed'), 'true');
  assert.equal(segments[0].getAttribute('data-current'), 'true', 'the current segment carries the styling hook');
  assert.equal(segments[1].getAttribute('aria-pressed'), 'false');
  assert.equal(segments[1].hasAttribute('data-current'), false);

  density.apply('regular'); // e.g. keyboard shortcut path
  assert.equal(segments[1].getAttribute('aria-pressed'), 'true', 'programmatic apply syncs the control');
  control.element.remove();
});

test('density announcements use a dedicated polite region, never the app status line', () => {
  const appStatus = dom.document.createElement('p');
  appStatus.setAttribute('role', 'status');
  appStatus.textContent = 'Connected · revision 7';
  dom.document.body.append(appStatus);

  const region = announce('Density set to compact');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.textContent, 'Density set to compact');
  assert.equal(appStatus.textContent, 'Connected · revision 7', 'the application status line is untouched');
  assert.equal(announce('Density set to regular'), region, 'one region is reused');
  region.remove();
  appStatus.remove();
});

test('the compact density switches the --density-gutter token in CSS', async () => {
  const css = await readFile(new URL('../ui/style.css', import.meta.url), 'utf8');
  assert.match(css, /:root\s*\{\s*--density-gutter:\s*var\(--density-regular\)/, 'regular is the default gutter');
  assert.match(css, /:root\[data-density='compact'\]\s*\{\s*--density-gutter:\s*var\(--density-compact\)/, 'compact switches the token');
  const views = await readFile(new URL('../ui/views.css', import.meta.url), 'utf8');
  assert.match(views, /\.task-list\s*\{[^}]*gap:\s*var\(--density-gutter\)/, 'a list consumes the density gutter');
});
