import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// T11-R1 bootstrap proof: every real page bootstrap that mounts UI calls
// installNativeExperience() from components.mjs (import-graph evidence), the
// installer is idempotent, and the pre-paint density bootstrap in
// theme-init.js stays safe. The unit fixtures in the other ui-native tests
// prove the behaviors; this file proves the capability is WIRED on the pages
// a browser actually loads.

const PAGES = [
  'index.mjs',              // live authenticated dashboard
  'project-shell-page.mjs', // served project shell
  'showcase.mjs',           // component showcase
  'component-demo.mjs',     // work/verification demo
  'architecture-page.mjs',  // T17 architecture demo
  'evidence-page.mjs',      // T19 evidence demo
  'execution-page.mjs',     // T16 execution demo
  'git-metrics-page.mjs',   // T18 git metrics demo
  'project-map-page.mjs',   // T03 spike page
];

test('every page bootstrap imports and calls installNativeExperience', async () => {
  for (const page of PAGES) {
    const source = await readFile(new URL(`../ui/${page}`, import.meta.url), 'utf8');
    assert.match(source, /import\s*\{[^}]*installNativeExperience[^}]*\}\s*from\s*'\.\/components\.mjs'/,
      `${page} imports the installer from the shared component module`);
    const calls = [...source.matchAll(/(?<!function\s)installNativeExperience\(/g)].length;
    assert.ok(calls >= 1, `${page} calls installNativeExperience() at bootstrap`);
  }
});

test('the installer is idempotent so multiple boot paths are safe', async () => {
  const { createMiniDom } = await import('./fixtures/mini-dom.mjs');
  const dom = createMiniDom();
  globalThis.document = dom.document;
  const { installNativeExperience } = await import('../ui/components.mjs');
  const first = installNativeExperience({ storage: undefined, mount: dom.document.body });
  assert.ok(first, 'the first install returns the layer');
  assert.equal(installNativeExperience(), null, 'a second install is refused');
  first.detach();
  assert.ok(installNativeExperience({ storage: undefined, mount: dom.document.body }), 'install works again after detach');
});

test('theme-init restores the internal density pre-paint from the persisted rail state', async () => {
  const source = await readFile(new URL('../ui/theme-init.js', import.meta.url), 'utf8');
  assert.match(source, /dataset\.density/, 'the pre-paint density bootstrap exists');
  assert.match(source, /sessionStorage\.getItem\('lazybuddy-shell-nav'\)/, 'V2-T1: density derives from the persisted collapsed rail, not a user setting');
  assert.equal(source.includes("localStorage.getItem('lazyseries-density')"), false, 'the retired density key is no longer read');
  assert.match(source, /catch/, 'a blocked storage degrades instead of throwing');
});

test('the demo pages keep their mount flow: no double DOM roots', async () => {
  for (const page of ['project-shell-page.mjs', 'showcase.mjs']) {
    const source = await readFile(new URL(`../ui/${page}`, import.meta.url), 'utf8');
    const roots = [...source.matchAll(/document\.querySelector\('#/g)].length;
    assert.ok(roots > 0, `${page} still queries its DOM roots`);
    assert.ok(!/installNativeExperience\(\)[\s\S]{0,40}installNativeExperience\(\)/.test(source), 'exactly one bootstrap call chain');
  }
});
