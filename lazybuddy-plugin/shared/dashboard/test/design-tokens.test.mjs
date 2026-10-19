import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/* T10 design-tokens contract proof. Parses ui/tokens.css without a CSS
   engine, rebuilds the cascade for each theme/product context, and holds
   the file to the family design-language invariants: the frozen v1 alias
   set, the 8-pt spacing grid, the monotonic five-step type scale, WCAG AA
   on every readable role pair, AA for all six per-product accent pairs on
   their intended surfaces, and the reduced-motion collapse. */

const css = await readFile(new URL('../ui/tokens.css', import.meta.url), 'utf8');

/* ---------- tiny CSS parser: selector blocks -> declarations ---------- */

function parseBlocks(source, media = '') {
  const rules = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const selectorText = source.slice(index, open).trim();
    let depth = 1;
    let scan = open + 1;
    while (scan < source.length && depth > 0) {
      if (source[scan] === '{') depth += 1;
      else if (source[scan] === '}') depth -= 1;
      scan += 1;
    }
    const body = source.slice(open + 1, scan - 1);
    if (selectorText.startsWith('@media')) {
      rules.push(...parseBlocks(body, selectorText));
    } else if (!selectorText.startsWith('@')) {
      for (const selector of selectorText.split(',')) {
        const full = `${media} ${selector}`.trim();
        rules.push({ selector: full, decls: parseDecls(body, full) });
      }
    }
    index = scan;
  }
  return rules;
}

function parseDecls(body, selector) {
  const decls = new Map();
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const name = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    if (!name.startsWith('--')) continue;
    assert.match(name, /^--[a-z0-9-]+$/, `malformed custom property in ${selector}`);
    decls.set(name, value);
  }
  return decls;
}

function classify(selector) {
  const reduced = selector.includes('prefers-reduced-motion');
  const dark = selector.includes("data-theme='dark'");
  const product = /^.*\[data-product='(Lazy[A-Za-z]+)'\]/.exec(selector)?.[1] ?? null;
  return { reduced, dark, product };
}

const rules = parseBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));
const byContext = { lightRoot: new Map(), darkRoot: new Map(), productLight: new Map(), productDark: new Map(), reduced: new Map() };
for (const rule of rules) {
  const { reduced, dark, product } = classify(rule.selector);
  if (reduced) { mergeInto(byContext.reduced, rule.decls); continue; }
  if (dark && product) mergeInto(byContext.productDark, rule.decls, product);
  else if (dark) mergeInto(byContext.darkRoot, rule.decls);
  else if (product) mergeInto(byContext.productLight, rule.decls, product);
  else if (rule.selector === ':root') mergeInto(byContext.lightRoot, rule.decls);
  else assert.fail(`unexpected top-level selector in tokens.css: ${rule.selector}`);
}
function mergeInto(target, decls, key = null) {
  if (key !== null) {
    if (!target.has(key)) target.set(key, new Map());
    mergeInto(target.get(key), decls);
    return;
  }
  for (const [name, value] of decls) target.set(name, value);
}

function resolved(theme, product = null) {
  const layers = [byContext.lightRoot];
  if (product) layers.push(byContext.productLight.get(product) ?? new Map());
  if (theme === 'dark') {
    layers.push(byContext.darkRoot);
    if (product) layers.push(byContext.productDark.get(product) ?? new Map());
  }
  return resolveVars(layers);
}
function resolveVars(layers) {
  const merged = new Map();
  for (const layer of layers) for (const [name, value] of layer) merged.set(name, value);
  for (const [name, value] of merged) {
    if (!value.includes('var(')) continue;
    let current = value;
    for (let hop = 0; hop < 8 && current.includes('var('); hop += 1) {
      current = current.replace(/var\((--[a-z0-9-]+)\)/g, (_, ref) => {
        assert.ok(merged.has(ref), `${name} references missing ${ref}`);
        return merged.get(ref);
      });
    }
    assert.equal(current.includes('var('), false, `circular var() chain at ${name}`);
    merged.set(name, current);
  }
  return merged;
}

/* ---------- WCAG relative luminance / contrast (in-test implementation) ---------- */

function hexToRgb(hex) {
  assert.match(hex, /^#[0-9a-fA-F]{6}$/, `contrast needs a 6-digit hex, got: ${hex}`);
  return [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
}
function channel(component) {
  return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  return Math.round(ratio * 100) / 100;
}
function assertAA(foreground, background, label, minimum = 4.5) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${foreground} on ${background} is ${ratio}:1, needs ${minimum}:1`);
  return ratio;
}

/* ---------- 1. frozen v1 aliases: current views render unchanged ---------- */

const frozenLight = {
  '--canvas': '#f5f6f8', '--surface': '#ffffff', '--raised': '#ffffff', '--hover': '#f0f1f4',
  '--selected': '#e5e7ec', '--text': '#20242b', '--muted': '#59616e', '--border': '#c7cbd3',
  '--focus': '#225bb5', '--control-edge': '#59616e', '--primary-hover': '#424852', '--pressed-opacity': '.75',
  '--neutral-ink': '#424852', '--neutral-fill': '#eef0f3', '--active-ink': '#184a96', '--active-fill': '#e9f0ff',
  '--verified-ink': '#16613b', '--verified-fill': '#e4f4e9', '--attention-ink': '#795000', '--attention-fill': '#fff2cf',
  '--failed-ink': '#a02a35', '--failed-fill': '#ffecef', '--stale-ink': '#68409b', '--stale-fill': '#f3eaff',
  '--shadow': '0 12px 40px #10131a33', '--backdrop': '#10131a66',
  '--sans': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  '--mono': "ui-monospace, 'SFMono-Regular', monospace",
  '--caption': '.8125rem', '--body': '.9375rem', '--title': '1.25rem', '--heading': '1.75rem',
  '--leading': '1.5', '--leading-tight': '1.25', '--regular': '400', '--strong': '600',
  '--s1': '.25rem', '--s2': '.5rem', '--s3': '.75rem', '--s4': '1rem',
  '--s5': '1.5rem', '--s6': '2rem', '--s7': '3rem', '--s8': '4rem',
  '--control': '2.75rem', '--icon': '1rem', '--line': '1px',
  '--focus-width': '3px', '--focus-offset': '2px',
  '--radius-control': '6px', '--radius-card': '8px', '--radius-pill': '999px',
  '--content': '76rem', '--measure': '65ch', '--card-min': '17rem', '--inspector': '30rem',
  '--fast': '120ms', '--ease': 'ease-out',
};
const frozenDark = {
  '--canvas': '#14161a', '--surface': '#1c1f25', '--raised': '#242831', '--hover': '#2c3039',
  '--selected': '#353b46', '--text': '#f1f3f7', '--muted': '#b0b7c4', '--border': '#515966',
  '--focus': '#adcaff', '--control-edge': '#919baa', '--primary-hover': '#d4d8df',
  '--neutral-ink': '#d4d8df', '--neutral-fill': '#282c34', '--active-ink': '#adcaff', '--active-fill': '#202f49',
  '--verified-ink': '#a4e2bd', '--verified-fill': '#203a2b', '--attention-ink': '#f5d58b', '--attention-fill': '#3d321e',
  '--failed-ink': '#ffb9c0', '--failed-fill': '#45272e', '--stale-ink': '#d7bbff', '--stale-fill': '#352943',
  '--shadow': '0 12px 40px #00000066',
};

test('frozen v1 aliases keep every shipped view rendering unchanged in both themes', () => {
  const light = resolved('light');
  const dark = resolved('dark');
  for (const [table, context, label] of [[frozenLight, light, 'light'], [frozenDark, dark, 'dark']]) {
    for (const [name, expected] of Object.entries(table)) {
      assert.ok(context.has(name), `${label}: v1 alias ${name} disappeared from tokens.css`);
      assert.equal(context.get(name), expected, `${label}: v1 alias ${name} drifted`);
    }
  }
});

/* ---------- 2. spacing: 8-pt grid ---------- */

test('the --space-* scale is an 8-pt grid with a single 4px half-step', () => {
  const light = resolved('light');
  const steps = [...light.keys()].filter(name => /^--space-\d+$/.test(name)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)));
  assert.ok(steps.length >= 5, 'expected at least five numbered spacing steps');
  let previousPx = 0;
  for (const name of steps) {
    const px = remToPx(light.get(name));
    assert.equal(px % 8, 0, `${name} = ${px}px is not on the 8-pt grid`);
    assert.ok(px > previousPx, `${name} must strictly increase`);
    previousPx = px;
  }
  assert.equal(remToPx(light.get('--space-half')), 4, '--space-half is the single 4px half-step');
});

function remToPx(value) {
  assert.match(value, /^(\.\d+|\d+(\.\d+)?)rem$/, `spacing expects rem, got ${value}`);
  return Math.round(Number.parseFloat(value) * 16 * 1000) / 1000;
}

/* ---------- 3. type scale ---------- */

test('five-step type scale is monotonic, carries line-heights and tabular metrics', () => {
  const light = resolved('light');
  const steps = ['xs', 'sm', 'md', 'lg', 'xl'];
  let previous = 0;
  for (const step of steps) {
    const size = light.get(`--type-${step}-size`);
    const lineHeight = light.get(`--type-${step}-lh`);
    assert.ok(size && lineHeight, `--type-${step}-size/-lh must both exist`);
    const px = remToPx(size);
    assert.ok(px > previous, `--type-${step}-size must strictly increase`);
    previous = px;
  }
  assert.match(light.get('--numeric'), /tabular-nums/, 'metrics must opt into tabular-nums');
  assert.equal(light.get('--caption'), light.get('--type-sm-size'), 'caption alias equals the sm step');
  assert.equal(light.get('--body'), light.get('--type-md-size'), 'body alias equals the md step');
  assert.equal(light.get('--title'), light.get('--type-lg-size'), 'title alias equals the lg step');
  assert.equal(light.get('--heading'), light.get('--type-xl-size'), 'heading alias equals the xl step');
});

/* ---------- 4. semantic roles exist and meet WCAG AA ---------- */

const roles = ['--bg', '--surface', '--elevated', '--inset', '--border', '--text', '--subtle',
  '--accent', '--accent-contrast', '--success', '--warn', '--danger', '--info'];

test('every semantic role resolves in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const context = resolved(theme);
    for (const role of roles) {
      assert.ok(context.has(role), `${theme}: role ${role} missing`);
      assert.match(context.get(role), /^#[0-9a-fA-F]{6}$/, `${theme}: role ${role} must resolve to a hex color`);
    }
    assert.equal(context.get('--success-bg'), context.get('--verified-fill'), 'success fill alias matches the verified fill');
    assert.equal(context.get('--info-bg'), context.get('--active-fill'), 'info fill alias matches the active fill');
  }
});

test('readable role pairs meet WCAG AA in light and dark', () => {
  const cases = {
    light: [
      ['--text', '--bg'], ['--text', '--surface'], ['--text', '--inset'],
      ['--subtle', '--bg'], ['--subtle', '--surface'],
      ['--accent', '--surface'], ['--accent', '--bg'], ['--accent', '--accent-soft'],
      ['--accent-contrast', '--accent'],
      ['--success', '--surface'], ['--success', '--bg'],
      ['--warn', '--surface'], ['--warn', '--bg'],
      ['--danger', '--surface'], ['--danger', '--bg'],
      ['--info', '--surface'], ['--info', '--bg'],
    ],
    dark: [
      ['--text', '--bg'], ['--text', '--surface'], ['--text', '--inset'],
      ['--subtle', '--bg'], ['--subtle', '--surface'], ['--subtle', '--elevated'],
      ['--accent', '--surface'], ['--accent', '--bg'], ['--accent', '--elevated'], ['--accent', '--accent-soft'],
      ['--accent-contrast', '--accent'],
      ['--success', '--surface'], ['--success', '--bg'], ['--success', '--elevated'],
      ['--warn', '--surface'], ['--warn', '--bg'], ['--warn', '--elevated'],
      ['--danger', '--surface'], ['--danger', '--bg'], ['--danger', '--elevated'],
      ['--info', '--surface'], ['--info', '--bg'], ['--info', '--elevated'],
    ],
  };
  for (const [theme, pairs] of Object.entries(cases)) {
    const context = resolved(theme);
    for (const [ink, fill] of pairs) assertAA(context.get(ink), context.get(fill), `${theme} ${ink} on ${fill}`);
  }
});

test('interactive control edges keep 3:1 against every resting background', () => {
  for (const [theme, backgrounds] of [['light', ['--surface', '--bg', '--raised', '--selected']], ['dark', ['--surface', '--bg', '--raised', '--selected']]]) {
    const context = resolved(theme);
    for (const fill of backgrounds) assertAA(context.get('--control-edge'), context.get(fill), `${theme} control edge on ${fill}`, 3);
  }
});

/* ---------- 5. per-product accents ---------- */

const products = ['LazyBuddy', 'LazyTrae', 'LazyQoder', 'LazyZCode', 'LazyKimi', 'LazyDeepSeek'];

test('all six per-product accent pairs pass AA on their intended surfaces', () => {
  for (const product of products) {
    const light = resolved('light', product);
    const dark = resolved('dark', product);
    for (const [theme, context, surfaces] of [
      ['light', light, ['--surface', '--bg', '--accent-soft']],
      ['dark', dark, ['--surface', '--bg', '--elevated', '--accent-soft']],
    ]) {
      const accent = context.get('--product-accent');
      if (product === 'LazyBuddy') assert.equal(accent, resolved(theme).get('--accent'), 'LazyBuddy keeps the family cobalt');
      else assert.notEqual(accent, resolved(theme).get('--accent'), `${product} ${theme} must override the family accent`);
      for (const surface of surfaces) assertAA(accent, context.get(surface), `${product} ${theme} accent on ${surface}`);
      assertAA(accent, context.get('--product-accent-soft'), `${product} ${theme} accent on its soft wash`);
      assertAA(context.get('--product-accent-contrast'), accent, `${product} ${theme} contrast ink on accent fill`);
    }
  }
});

test('the default product accent is the family accent', () => {
  const light = resolved('light');
  assert.equal(light.get('--product-accent'), light.get('--accent'));
  assert.equal(resolved('light', 'LazyBuddy').get('--product-accent'), light.get('--accent'), 'LazyBuddy keeps the family cobalt');
});

/* ---------- 6. elevation, radii, density, focus ---------- */

test('elevation ladder has four steps and the legacy shadow is step three', () => {
  for (const theme of ['light', 'dark']) {
    const context = resolved(theme);
    assert.equal(context.get('--elevation-0'), 'none', 'step zero is flat');
    for (const step of ['--elevation-1', '--elevation-2', '--elevation-3']) {
      assert.match(context.get(step), /^0 \d+px \d+px /, `${theme} ${step} is a layered shadow`);
    }
    assert.equal(context.get('--shadow'), context.get('--elevation-3'), `${theme} legacy --shadow equals elevation step three`);
    assert.notEqual(context.get('--elevation-1'), context.get('--elevation-3'));
    assert.notEqual(context.get('--elevation-2'), context.get('--elevation-3'));
    assert.match(context.get('--focus-ring'), /^0 0 0 3px /, `${theme} focus ring token exists`);
  }
});

test('radius scale is monotonic and legacy radii are unchanged members', () => {
  const light = resolved('light');
  const ladder = ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg'].map(name => Number.parseInt(light.get(name), 10));
  for (let index = 1; index < ladder.length; index += 1) assert.ok(ladder[index] > ladder[index - 1], 'radius steps must increase');
  assert.equal(light.get('--radius-full'), '999px');
  assert.equal(light.get('--radius-control'), light.get('--radius-sm'));
  assert.equal(light.get('--radius-card'), light.get('--radius-md'));
  assert.equal(light.get('--radius-pill'), light.get('--radius-full'));
});

test('density tokens offer compact and regular paddings with reachable targets', () => {
  const light = resolved('light');
  assert.ok(remToPx(light.get('--density-compact')) < remToPx(light.get('--density-regular')));
  assert.equal(remToPx(light.get('--density-control')), 44, 'regular control target is the 44px minimum');
  assert.equal(remToPx(light.get('--density-control-compact')), 32, 'compact control target is 32px');
  assert.equal(remToPx(light.get('--density-compact')) % 8, 0);
  assert.equal(remToPx(light.get('--density-regular')) % 8, 0);
});

/* ---------- 7. reduced motion ---------- */

test('prefers-reduced-motion collapses every duration to zero', () => {
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion override block must exist');
  for (const name of ['--motion-instant', '--motion-fast', '--motion-base', '--motion-slow', '--fast']) {
    assert.equal(byContext.reduced.get(name), '0ms', `${name} must collapse to 0ms under reduced motion`);
  }
});
