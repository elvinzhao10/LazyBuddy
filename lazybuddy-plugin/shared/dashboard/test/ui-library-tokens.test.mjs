import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

/* T12 component library proof, part 2: the CSS contract. The shared
   component styles (style.css + views.css) carry no hardcoded colors or
   sizes beyond tokens.css — color values, type sizes, spacing, radii and
   motion durations all resolve to tokens; each status kind pairs its
   distinct glyph with a DISTINCT border treatment; tables render tabular
   numerals on hairline rows under a sticky header with no zebra striping;
   skeletons stay static (no looping animation); and the showcase remains
   the acceptance gallery the T11 native layer still installs on. */

const dom = createMiniDom();
globalThis.document = dom.document;

const { statusChip, STATUS_STATES } = await import('../ui/components.mjs');

async function css(file) { return readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8'); }
const SHARED_CSS = ['style.css', 'views.css'];

function declarations(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const match of stripped.matchAll(/([-a-z]+)\s*:\s*([^;{}]+);/g)) found.push([match[1], match[2].trim()]);
  return found;
}

test('shared component CSS contains zero color literals', async () => {
  for (const file of SHARED_CSS) {
    const source = (await css(file)).replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = source.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(|\bhsla?\(/g) ?? [];
    assert.deepEqual(literals, [], `${file} must express every color through tokens.css roles`);
  }
});

test('every font-size in shared component CSS is a type token', async () => {
  for (const file of SHARED_CSS) {
    for (const [property, value] of declarations(await css(file))) {
      if (property !== 'font-size') continue;
      assert.match(value, /^var\(--(type-[a-z-]+|caption|body|title|heading)\)$/, `${file} font-size: ${value} must resolve to the type scale`);
    }
  }
});

test('spacing in shared component CSS rides the token grid', async () => {
  // Allowed: token references, zero, calc/max/min/env compositions, and the
  // 1px sr-only clip geometry of the clipped description notes.
  const splitValues = value => {
    const parts = []; let depth = 0; let current = '';
    for (const character of value) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (/\s/.test(character) && depth === 0) { if (current) parts.push(current); current = ''; }
      else current += character;
    }
    if (current) parts.push(current);
    return parts;
  };
  const allowed = /^(?:var\(|calc\(|max\(|min\(|env\(|[\d.]+rem\b)/;
  for (const file of SHARED_CSS) {
    for (const [property, value] of declarations(await css(file))) {
      if (!/^(?:padding|margin|gap|row-gap|column-gap|padding-(?:inline|block)(?:-start|-end)?|margin-(?:inline|block)(?:-start|-end)?)$/.test(property)) continue;
      for (const part of splitValues(value)) {
        const ok = allowed.test(part) || part === '0' || part === '1px' || part === '-1px' || part === 'auto';
        assert.ok(ok, `${file} ${property}: "${part}" must be a --space-*/--density-* token (0 and the sr-only 1px clip are the only bare values)`);
      }
    }
  }
});

test('radii and motion in shared component CSS come from tokens', async () => {
  for (const file of SHARED_CSS) {
    for (const [property, value] of declarations(await css(file))) {
      if (property === 'border-radius') assert.match(value, /^(?:var\(--radius-[a-z-]+\)|var\(--radius-card\)|var\(--radius-control\)|var\(--radius-pill\)|0)(?:\s+var\(--radius-[a-z-]+\))*$/, `${file} border-radius: ${value}`);
      if (/transition|animation/.test(property)) {
        const literals = value.match(/(?<![\w-])(?:\d*\.?\d+m?s)(?![\w])/g) ?? [];
        assert.deepEqual(literals, [], `${file} ${property}: durations must come from motion tokens`);
      }
    }
  }
});

test('each status kind pairs its distinct glyph with a distinct border treatment', async () => {
  const style = (await css('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  // distinct glyphs: serialize each chip's SVG geometry and require uniqueness
  const geometry = new Map();
  for (const state of STATUS_STATES) {
    const chip = statusChip({ state, label: state });
    assert.ok(chip.textContent.length > 0, `${state} keeps a text label (never color-only)`);
    const shapes = [...chip.querySelector('svg').children].map(node => `${node.tagName}|${[...node.attributes.entries()].map(([key, value]) => `${key}=${value}`).sort().join(';')}`).join('||');
    assert.ok(shapes.length > 0, `${state} renders a glyph`);
    geometry.set(state, shapes);
  }
  const uniqueGlyphs = new Set(geometry.values());
  assert.equal(uniqueGlyphs.size, STATUS_STATES.length, 'every kind draws a different glyph');
  // distinct border treatments: collect the border declarations per kind
  const treatments = new Map();
  for (const state of STATUS_STATES) {
    const body = new RegExp(`\\.status\\[data-state='${state}'\\]\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? '';
    const borders = declarations(`x{${body}}`).filter(([property]) => property.startsWith('border') || property === 'background')
      .map(([property, value]) => `${property}:${value}`).sort().join('|');
    assert.ok(borders.includes('border'), `${state} declares a border treatment`);
    treatments.set(state, borders);
  }
  assert.equal(new Set(treatments.values()).size, STATUS_STATES.length, 'every kind carries a different border treatment');
  assert.match(treatments.get('unavailable'), /background:transparent/, 'unavailable stays hollow');
  assert.match(treatments.get('unavailable'), /dashed/, 'unavailable keeps its dashed signature');
  assert.match(treatments.get('stale'), /dashed/, 'stale is the dashed-edge filled chip');
  assert.match(treatments.get('verified'), /double/, 'verified is the sealed double edge');
});

test('tables: tabular numerals, sticky header, hairline rows, no zebra', async () => {
  const style = await css('style.css');
  const numericRule = /\.lb-table \[data-numeric='true'\]\s*\{[^}]*\}/.exec(style)?.[0];
  assert.ok(numericRule, 'numeric cells have a rule');
  assert.match(numericRule, /font-variant-numeric:\s*var\(--numeric\)/, 'counts render with the tabular variant');
  assert.match(numericRule, /text-align:\s*end/, 'counts right-align');
  const sticky = /\.lb-table thead th\s*\{[^}]*\}/.exec(style)?.[0];
  assert.match(sticky, /position:\s*sticky/, 'the header row is sticky');
  assert.match(sticky, /background:\s*var\(--elevated\)/, 'the sticky rail sits on the elevated surface');
  assert.match(style, /\.lb-table th,\.lb-table td\s*\{[^}]*border-block-end:\s*var\(--line\) solid var\(--hairline\)/, 'rows separate by hairline rules');
  for (const file of SHARED_CSS) {
    assert.doesNotMatch(await css(file), /tbody tr:nth-child/, `${file}: no zebra striping`);
  }
  const views = await css('views.css');
  assert.match(views, /\.verification-table th,\.verification-table td\s*\{[^}]*var\(--lb-table-pad-block\)/, 'the verification table shares the density-driven cell padding');
  assert.match(views, /min-inline-size:\s*var\(--table-min-inline\)/, 'the wide-table floor moved to the additive component token');
});

test('skeletons and reduced motion stay static', async () => {
  const style = await css('style.css');
  const skeletonRules = [...style.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.lb-skeleton(-line)?[^{]*\{([^}]*)\}/g)].map(match => match[2]);
  assert.ok(skeletonRules.length >= 2, 'skeleton styles exist');
  for (const body of skeletonRules) assert.doesNotMatch(body, /animation/, 'skeletons never loop or shimmer');
  const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(style)?.[1] ?? '';
  for (const surface of ['.lb-card', '.lb-graph-node', '.lb-inspector']) {
    assert.match(reduced, new RegExp(surface.replace(/\./g, '\\.')), `${surface} collapses under reduced motion`);
  }
});

test('metric tiles and the unavailable treatments render hollow, never zero', async () => {
  const style = await css('style.css');
  assert.match(style, /\.lb-metric-value\s*\{[^}]*font-variant-numeric:\s*var\(--numeric\)/, 'metric values are tabular');
  assert.match(style, /\.lb-metric\[data-unavailable='true'\]\s*\{[^}]*border-style:\s*dashed/, 'the unavailable metric tile is hollow');
  assert.match(style, /\.lb-graph-node\[aria-pressed='true'\]\s*\{[^}]*border-color:\s*var\(--product-accent\)/, 'selection intent is the only accent use on nodes');
});

test('the showcase is the acceptance gallery for every component family', async () => {
  const html = await css('showcase.html');
  const source = await css('showcase.mjs');
  for (const section of ['app-shell', 'statuses', 'library-cards', 'library-table', 'library-forms', 'library-nodes', 'library-timeline', 'library-loading', 'library-overlays', 'tasks', 'editing', 'planning', 'all-states']) {
    assert.ok(html.includes(`id="${section}"`), `showcase presents the ${section} section`);
  }
  assert.match(html, /id="surface-state"/, 'surface states are exposed');
  assert.match(html, /params\.get\('density'\)/, 'compact/regular density is capturable via URL');
  assert.match(html, /params\.get\('theme'\)/, 'light/dark is capturable via URL');
  assert.match(source, /themeSelect\.id = 'theme'/, 'theme switching (light/dark) lives in the shell rail footer');
  assert.match(source, /createTabs\(/, 'the shell demonstrates the tab strip');
  assert.match(source, /sidebarNav\(/, 'the shell demonstrates the sidebar rail');
  assert.match(source, /createDockPanel\(/, 'the shell demonstrates the inspector dock');
});

test('the T11 native layer still installs on the rebuilt showcase', async () => {
  const source = await css('showcase.mjs');
  assert.match(source, /import\s*\{[^}]*installNativeExperience[^}]*}\s*from\s*'\.\/components\.mjs'/, 'the showcase imports the installer');
  const calls = [...source.matchAll(/(?<!function\s)installNativeExperience\(/g)].length;
  assert.equal(calls, 1, 'exactly one bootstrap call');
  assert.ok(source.includes("document.querySelector('#"), 'the showcase still queries its DOM roots');
  const { installNativeExperience } = await import('../ui/components.mjs');
  const installed = installNativeExperience({ storage: undefined, mount: dom.document.body });
  assert.ok(installed, 'the installer runs after the library rebuild');
  assert.ok(dom.document.body.querySelector('[data-native-announcer]'), 'the polite announcer exists');
  assert.ok(dom.document.documentElement.hasAttribute('data-density'), 'density applies to the root');
  installed.detach();
});

/* -- V2-T9 pattern adoptions: daisyUI class discipline + shadcn polish ------- */

test('segmented controls have one canonical class; the legacy alias never carries a second fill', async () => {
  const style = (await css('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(style, /\.lb-segmented,\s*\.view-switcher\s*\{[^}]*background:\s*var\(--inset\)/, 'the canonical .lb-segmented and the .view-switcher alias share ONE track rule');
  assert.match(style, /\.lb-segmented button\[aria-pressed='true'\],\s*\.view-switcher button\[aria-pressed='true'\]/, 'one raised-current rule covers both names');
  const views = (await css('views.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(views, /\.view-switcher[^{]*\{[^}]*background/, 'views.css no longer repaints the current segment (one source of truth)');
});

test('small-caps section labels, the relations rename and the overlay bevel ride tokens', async () => {
  const style = (await css('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const caps = /\.lb-table caption,\s*\.lb-sidebar-group-label\s*\{[^}]*\}/.exec(style)?.[0] ?? '';
  assert.match(caps, /text-transform:\s*uppercase/, 'captions and group labels are small caps');
  assert.match(caps, /letter-spacing:\s*var\(--tracking-caps\)/, 'the caps tracking is a token');
  const tokens = await css('tokens.css');
  assert.match(tokens, /--tracking-caps:\s*\.08em/, 'the tracking token exists');
  assert.match(style, /\.graph,\s*\.lb-relations\s*\{/, 'the three-column relation layout has its canonical one-meaning name with the legacy alias');
  for (const surface of ['.native-overlay', '.lb-inspector', '.lb-dock', 'dialog']) {
    const rule = new RegExp(`${surface.replace('.', '\\.')}\\s*\\{[^}]*\\}`).exec(style)?.[0] ?? '';
    assert.match(rule, /box-shadow:\s*var\(--edge-highlight\),\s*var\(--elevation-\d\)/, `${surface} rides the 1px bevel ahead of its soft shadow (shadcn border/shadow rhythm)`);
  }
});
