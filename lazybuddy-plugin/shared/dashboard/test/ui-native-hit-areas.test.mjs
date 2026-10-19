import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 hit-area and tooltip proof. Hit areas: every interactive control keeps
// a 44px minimum target expressed through the density control tokens
// (--density-control / --density-control-compact / the frozen --control
// alias), never magic numbers. Tooltips: status chips and icon-only buttons
// get a title plus an aria-describedby note in a clipped node.

const dom = createMiniDom();
globalThis.document = dom.document;

const { installTooltips, statusChip, button, element } = await import('../ui/components.mjs');

async function css(file) { return readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8'); }

const px = value => {
  const match = /^([\d.]+)rem$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) * 16 : null;
};

test('the density control tokens carry the 44px HIG minimum', async () => {
  const tokens = await css('tokens.css');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
  const decl = name => new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1] ?? '';
  assert.equal(px(decl('--density-control')), 44, '--density-control is the 44px minimum target');
  assert.equal(px(decl('--density-control-compact')), 32, 'compact in-table controls target 32px');
  assert.equal(decl('--control'), '2.75rem', 'the frozen v1 --control alias stays 44px');
});

test('interactive controls declare hit areas only through tokens', async () => {
  const sources = await Promise.all([css('style.css'), css('views.css'), css('live.css')]);
  const controlRules = [];
  for (const source of sources) {
    for (const rule of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/button|graph-viewport-action|segmented/.test(rule[1])) controlRules.push([rule[1].trim(), rule[2]]);
    }
  }
  const sizes = controlRules.flatMap(([, body]) => [...body.matchAll(/min-(?:block|inline)-size:\s*([^;]+);/g)].map(match => match[1].trim()));
  assert.ok(sizes.length >= 4, 'hit-area rules exist');
  for (const size of sizes) {
    assert.match(size, /^(?:var\(|auto$|min\(|calc\()/, `control hit areas must be token- or layout-driven, found ${size}`);
  }
  assert.match(sources[0], /button,select,input,textarea\s*\{[^}]*min-block-size:\s*var\(--control\)/, 'native controls keep the 44px baseline');
  assert.match(sources[0], /\.view-switcher button\s*\{[^}]*min-block-size:\s*var\(--density-control\)[^}]*min-inline-size:\s*var\(--density-control\)/, 'segments meet 44px in both axes');
  assert.match(sources[1], /\.graph-viewport-action\s*\{[^}]*min-block-size:\s*var\(--density-control\)[^}]*min-inline-size:\s*var\(--density-control\)/, 'icon-only graph actions meet 44px in both axes');
});

test('graph viewport actions are icon-only buttons that carry names and titles', async () => {
  const { createGraphViewportController } = await import('../ui/graph-viewport.mjs');
  const getRegion = () => null;
  const viewport = createGraphViewportController({ label: 'Tasks', getRegion });
  const toolbar = viewport.controls();
  dom.document.body.append(toolbar);
  const actions = [...toolbar.querySelectorAll('button')];
  assert.ok(actions.length >= 7, 'pan/zoom/fit controls remain');
  for (const action of actions) {
    assert.equal(Boolean(action.getAttribute('aria-label')), true, 'every icon-only action is named');
    assert.equal(action.title, action.getAttribute('aria-label'), 'the label is also the native tooltip');
  }
  const tooltips = installTooltips();
  tooltips.describe(toolbar);
  const glyphs = actions.filter(action => !/[a-zA-Z0-9]/.test(action.textContent));
  assert.equal(glyphs.length, 6, 'six glyph actions are icon-only');
  for (const action of glyphs) {
    assert.match(action.getAttribute('aria-describedby') ?? '', /^native-note-\d+$/, 'icon-only buttons gain described notes');
  }
  const fit = actions.find(action => action.textContent === 'Fit');
  assert.equal(fit.hasAttribute('aria-describedby'), false, 'text buttons keep their visible label as the name');
  toolbar.remove();
  for (const note of dom.document.body.querySelectorAll('.native-note')) note.remove();
});

test('status chips gain a title and a described state note exactly once', () => {
  const chip = statusChip({ state: 'verified', label: 'Verified' });
  const labeled = element('span');
  labeled.append(chip);
  dom.document.body.append(labeled);
  const tooltips = installTooltips();
  assert.equal(tooltips.describe(labeled), 1);
  assert.equal(chip.getAttribute('title'), 'Status verified: Verified');
  const noteId = chip.getAttribute('aria-describedby');
  assert.match(noteId, /^native-note-\d+$/);
  const note = dom.document.body.querySelector(`[id="${noteId}"]`);
  assert.equal(note.textContent, 'Status verified: Verified');
  assert.match(note.className, /native-note/, 'the note is the clipped description node');

  assert.equal(tooltips.describe(labeled), 0, 'a second pass never duplicates notes');
  labeled.remove();
  note.remove();
  for (const leftover of dom.document.body.querySelectorAll('.native-note')) leftover.remove();
});

test('text buttons are left alone: only chips and icon-only buttons are described', () => {
  const plain = button('Save plan', () => {});
  const region = element('div');
  region.append(plain);
  dom.document.body.append(region);
  const tooltips = installTooltips();
  assert.equal(tooltips.describe(region), 0);
  assert.equal(plain.hasAttribute('aria-describedby'), false);
  assert.equal(plain.hasAttribute('title'), false);
  region.remove();
});
