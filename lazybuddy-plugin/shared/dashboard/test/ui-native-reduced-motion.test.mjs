import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 reduced-motion proof: the layer's motion consumes the token ladder, so
// the prefers-reduced-motion collapse in tokens.css switches every layered
// transition off; the explicit media block in style.css additionally disables
// the non-essential transitions; and the experience layer's overlay/segmented
// surfaces expose no literal durations of their own.

const dom = createMiniDom();
globalThis.document = dom.document;

async function css(file) { return readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8'); }

function declarations(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const match of stripped.matchAll(/([-a-z]+)\s*:\s*([^;{}]+);/g)) found.push([match[1], match[2].trim()]);
  return found;
}

test('tokens collapse every motion duration under prefers-reduced-motion', async () => {
  const tokens = await css('tokens.css');
  const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
  assert.ok(reduced, 'the reduced-motion media block exists');
  for (const token of ['--motion-instant', '--motion-fast', '--motion-base', '--motion-slow', '--fast']) {
    assert.match(reduced, new RegExp(`${token}:\\s*0ms`), `${token} collapses to 0ms`);
  }
});

test('the experience layer declares no literal motion durations', async () => {
  const style = await css('style.css');
  const styleDurations = declarations(style).filter(([property]) => /transition|animation/.test(property));
  assert.ok(styleDurations.length > 0, 'style.css declares the layered transitions');
  for (const file of ['style.css', 'views.css', 'live.css']) {
    const source = await css(file);
    const durationDecls = declarations(source).filter(([property]) => /transition|animation/.test(property));
    for (const [property, value] of durationDecls) {
      const literals = value.match(/(?<![\w-])(?:\d*\.?\d+m?s)(?![\w])/g) ?? [];
      assert.deepEqual(literals, [], `${file} ${property}: durations must come from motion tokens, found ${literals}`);
    }
  }
});

test('style.css disables the non-essential transitions under reduced motion', async () => {
  const style = await css('style.css');
  const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(style)?.[1] ?? '';
  assert.ok(reduced, 'the layer keeps its own reduced-motion block');
  assert.match(reduced, /transition:\s*none/, 'non-essential transitions switch off');
  for (const surface of ['button', '.view-switcher button', '.native-overlay']) {
    assert.ok(reduced.includes(surface), `${surface} is covered`);
  }
});

test('layered transitions reference the motion tokens so the collapse reaches them', async () => {
  const style = await css('style.css');
  assert.match(style, /transition:\s*opacity var\(--motion-base\) var\(--motion-ease\),\s*transform var\(--motion-base\) var\(--motion-ease\)/,
    'the overlay enters through --motion-base/--motion-ease');
  assert.match(style, /transition:\s*background-color var\(--motion-instant\)/, 'segment hover feedback uses --motion-instant');
});

test('createNativeExperience wiring: the reduced-motion query degrades safely', async () => {
  const { createOverlayPanel, segmentedControl, installNativeExperience, element } = await import('../ui/components.mjs');
  // No matchMedia in this environment: prefersReducedMotion-style guards must
  // not throw, and the experience layer installs with storage unavailable.
  const experience = installNativeExperience({ storage: undefined, mount: dom.document.body });
  assert.ok(experience, 'the layer installs without localStorage');
  assert.equal(dom.document.documentElement.dataset.nativeExperience, 'true');
  assert.ok(dom.document.body.querySelector('[data-native-announcer]'), 'the polite announcer exists');
  assert.equal(experience.control, undefined, 'V2-T1: no density control mounts with the layer');
  experience.announce('Quiet');
  assert.equal(dom.document.body.querySelector('[data-native-announcer]').textContent, 'Quiet');

  const overlay = createOverlayPanel({ title: 'Notes', content: element('p', '', 'Quiet surface') });
  dom.document.body.append(overlay.element);
  overlay.open();
  assert.equal(overlay.isOpen(), true);
  overlay.close();
  assert.equal(overlay.isOpen(), false);

  const control = segmentedControl({
    label: 'Lens',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    current: 'a',
    onChange: () => {},
  });
  assert.equal(control.element.dataset.nativeSegmented, 'true');
  assert.equal(installNativeExperience(), null, 'a second install is a no-op');
  experience.detach();
  assert.equal(dom.document.documentElement.hasAttribute('data-native-experience'), false);
  overlay.element.remove();
  control.element.remove();
});
