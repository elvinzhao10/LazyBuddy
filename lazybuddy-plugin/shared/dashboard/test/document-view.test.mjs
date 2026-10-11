import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMiniDom } from './fixtures/mini-dom.mjs';

const dom = createMiniDom();
globalThis.document = dom.document;

const { createDocumentView } = await import('../ui/document-view.mjs');
const { parseMarkdown, renderMarkdown, safeMarkdownHref } = await import('../ui/markdown.mjs');

const LONG_PLAN = `# LazySeries 1.4 delivery plan

This original paragraph contains **strong context**, an [external reference](https://example.com/spec), and a path with an unbroken value abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz.

## Outcomes

- Preserve the original plan
- [x] Record the accepted baseline
- [ ] Verify the final surface
  - Nested evidence stays attached

## Delivery waves

| Wave | Owner | Gate |
| :--- | :---: | ---: |
| Foundation | Platform | G0 |
| Interface | Dashboard | G1 |

### Commands

\`\`\`bash
node --test shared/dashboard/test/document-view.test.mjs
\`\`\`

### Planned diagram

\`\`\`mermaid
flowchart LR
  Plan --> Verify
\`\`\`

## Outcomes

Duplicate headings need stable unique anchors.
`;

test('a realistic long plan renders semantic navigation, lists, tables, code, and an honest Mermaid fallback', () => {
  const parsed = parseMarkdown(LONG_PLAN);
  assert.equal(parsed.outline.length, 6);
  assert.deepEqual(parsed.outline.filter(item => item.text === 'Outcomes').map(item => item.id), ['outcomes', 'outcomes-2']);

  const view = createDocumentView({ markdown: LONG_PLAN, title: 'Delivery plan' });
  assert.equal(view.getMode(), 'rendered');
  assert.equal(view.getMarkdown(), LONG_PLAN, 'the source stays byte-for-byte intact');
  assert.equal(view.element.querySelectorAll('.document-outline-desktop a').length, 6);
  assert.equal(view.element.querySelectorAll('.document-outline-narrow a').length, 6);
  assert.match(view.element.querySelector('.document-outline-summary').textContent, /6 sections/);
  assert.equal(view.element.querySelectorAll('.markdown-task input').length, 2);
  assert.equal(view.element.querySelectorAll('.markdown-task input[disabled]').length, 2);
  assert.equal(view.element.querySelectorAll('table').length, 1);
  assert.equal(view.element.querySelectorAll('thead th').length, 3);
  assert.equal(view.element.querySelectorAll('.markdown-code').length, 1);
  const diagram = view.element.querySelector('.markdown-diagram');
  assert.match(diagram.textContent, /Mermaid renderer is not packaged/);
  assert.match(diagram.textContent, /Plan --> Verify/);

  const changed = [];
  const toggled = createDocumentView({ markdown: LONG_PLAN, onModeChange: value => changed.push(value) });
  toggled.element.querySelector('[data-document-mode="source"]').click();
  assert.equal(toggled.getMode(), 'source');
  assert.equal(toggled.element.querySelector('.document-source code').textContent, LONG_PLAN);
  assert.deepEqual(changed, ['source']);
  toggled.element.querySelector('[data-document-mode="rendered"]').click();
  assert.equal(toggled.getMode(), 'rendered');
});

test('unsafe HTML and active URLs stay inert while allowed links remain usable', () => {
  const malicious = `# Safety

<script>globalThis.pwned = true</script>

<img src=x onerror=globalThis.pwned=true>

[script](javascript:alert(1)) [data](data:text/html,boom) [local](file:///etc/passwd) [safe](https://example.com/a) [section](#safety) [relative](../plan.md)
`;
  const rendered = renderMarkdown(malicious);
  assert.equal(rendered.element.querySelectorAll('script').length, 0);
  assert.equal(rendered.element.querySelectorAll('img').length, 0);
  assert.match(rendered.element.textContent, /<script>globalThis\.pwned/);
  assert.equal(rendered.element.querySelectorAll('.markdown-unsafe-link').length, 3);
  const links = [...rendered.element.querySelectorAll('a')];
  assert.deepEqual(links.map(link => link.getAttribute('href')), ['https://example.com/a', '#safety', '../plan.md']);
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(safeMarkdownHref('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeMarkdownHref('//example.com/implicit'), null);
});

test('document checkboxes are presentation only and cannot mutate source authority', () => {
  const markdown = '- [ ] Pending authority\n- [x] Recorded fact\n';
  const view = createDocumentView({ markdown });
  const boxes = [...view.element.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 2);
  for (const box of boxes) {
    assert.equal(box.disabled, true);
    assert.equal(box.dataset.authority, 'read-only');
    box.click();
  }
  assert.equal(view.getMarkdown(), markdown);
  assert.equal(view.element.querySelectorAll('[data-authority="read-only"]').length, 2);
});

test('an optional Mermaid renderer is copied through an SVG allowlist', () => {
  const renderer = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.setAttribute('onload', 'globalThis.pwned=true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M0 0L10 10');
    const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject');
    foreign.append(document.createElement('script'));
    svg.append(path, foreign);
    return svg;
  };
  const rendered = renderMarkdown('```mermaid\na --> b\n```', { mermaidRenderer: renderer });
  const svg = rendered.element.querySelector('svg');
  assert.ok(svg);
  assert.equal(svg.hasAttribute('onload'), false);
  assert.equal(svg.querySelectorAll('path').length, 1);
  assert.equal(svg.querySelectorAll('foreignObject').length, 0);
  assert.equal(svg.querySelectorAll('script').length, 0);
});

test('document CSS declares readable measure, intrinsic reflow, and bounded local overflow', async () => {
  const css = await readFile(new URL('../ui/document-view.css', import.meta.url), 'utf8');
  assert.match(css, /max-inline-size:\s*var\(--measure\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(min\(15rem, 100%\), 18rem\)/);
  assert.match(css, /@container \(max-width: 52rem\)/);
  assert.match(css, /\.document-outline-desktop[^}]*display:\s*none/s);
  assert.match(css, /\.markdown-document[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.markdown-task > \.markdown-list[^}]*grid-column:\s*2 \/ -1/s);
  assert.match(css, /\.markdown-table-scroll[^}]*overflow-x:\s*auto/s);
});
