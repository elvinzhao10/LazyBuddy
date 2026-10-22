import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* V2-T1 density proof — the INTERNAL contract. Compact/regular stopped being
   a user setting: the persisted 'lazyseries-density' key and the segmented
   control are GONE, and data-density on the root now follows the collapsed
   rail automatically (sidebarNav.setCollapsed applies compact when the rail
   retracts, regular when it expands). The --density-gutter token bridge in
   CSS keeps consuming the state. The old persistence/malformed-storage
   adversarial classes retired with the setting; the compact-rail behavior
   tests stay. */

const dom = createMiniDom();
globalThis.document = dom.document;

const { sidebarNav, installNativeExperience } = await import('../ui/components.mjs');

test('density follows the collapsed rail automatically (no user setting)', () => {
  const rail = sidebarNav({
    product: 'LazySeries', runtime: 'LazyBuddy',
    destinations: [{ id: 'overview', label: 'Overview' }, { id: 'git', label: 'Git' }],
  });
  dom.document.body.append(rail.element);
  assert.equal(dom.document.documentElement.dataset.density, 'regular', 'the expanded rail keeps regular');
  rail.toggle();
  assert.equal(rail.element.dataset.collapsed, 'true');
  assert.equal(dom.document.documentElement.dataset.density, 'compact', 'the retracted rail switches the root to compact');
  rail.setCollapsed(false);
  assert.equal(dom.document.documentElement.dataset.density, 'regular', 'expanding restores regular');
  rail.element.remove();
});

test('installNativeExperience mounts no density control and no density key persists', async () => {
  const writes = [];
  const storage = { getItem: () => null, setItem: (key, value) => writes.push([key, String(value)]) };
  const experience = installNativeExperience({ storage, mount: dom.document.body });
  try {
    assert.ok(experience, 'the native layer still installs');
    assert.equal(experience.control, undefined, 'the installer returns no density control');
    assert.equal(experience.density, undefined, 'no density controller rides the layer');
    assert.equal(dom.document.body.querySelector('[aria-label="Density"]'), null, 'no density segmented control mounted');
    assert.deepEqual(writes, [], 'no density value is persisted');
    const source = await readFile(new URL('../ui/components.mjs', import.meta.url), 'utf8');
    assert.equal(source.includes("'lazyseries-density'"), false, 'the retired storage key is gone from the layer');
  } finally {
    experience.detach();
  }
});

test('theme-init derives the pre-paint density from the persisted collapsed rail', async () => {
  const source = await readFile(new URL('../ui/theme-init.js', import.meta.url), 'utf8');
  assert.match(source, /dataset\.density/, 'the pre-paint density bootstrap exists');
  assert.match(source, /sessionStorage\.getItem\('lazybuddy-shell-nav'\)/, 'it reads the persisted shell navigation state');
  assert.equal(source.includes("'lazyseries-density'"), false, 'the retired user-setting key is no longer read');
  assert.match(source, /storedNav\.collapsed === true \? 'compact' : 'regular'/, 'a retracted rail pre-paints compact, everything else regular');
  assert.match(source, /catch/, 'a blocked sessionStorage degrades instead of throwing');
});

test('the compact density switches the --density-gutter token in CSS', async () => {
  const css = await readFile(new URL('../ui/style.css', import.meta.url), 'utf8');
  assert.match(css, /:root\s*\{\s*--density-gutter:\s*var\(--density-regular\)/, 'regular is the default gutter');
  assert.match(css, /:root\[data-density='compact'\]\s*\{\s*--density-gutter:\s*var\(--density-compact\)/, 'compact switches the token');
  const views = await readFile(new URL('../ui/views.css', import.meta.url), 'utf8');
  assert.match(views, /\.task-list\s*\{[^}]*gap:\s*var\(--density-gutter\)/, 'a list consumes the density gutter');
});
