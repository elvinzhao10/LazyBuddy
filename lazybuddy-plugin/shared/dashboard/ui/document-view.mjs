import { button, element } from './components.mjs';
import { renderMarkdown, safeMarkdownHref } from './markdown.mjs';

const MODES = Object.freeze(['rendered', 'source']);

/**
 * Read-only long-form document surface for shell, plan, and evidence lanes.
 * Checklists describe source content only; this module exposes no mutation API.
 */
export function createDocumentView({ markdown, title = 'Document', mode = 'rendered',
  mermaidRenderer = null, onModeChange = null } = {}) {
  if (!MODES.includes(mode)) throw new TypeError('Document mode must be rendered or source');
  let source = String(markdown ?? '');
  let currentMode = mode;

  const root = element('section', 'document-view');
  root.dataset.testid = 'document-view';
  const header = element('header', 'document-view-header');
  const identity = element('div', 'document-view-identity');
  identity.append(element('h2', '', title), element('p', 'meta', 'Read-only document · checklist state comes from the source'));
  const switcher = element('div', 'document-view-switcher');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Document presentation');
  for (const candidate of MODES) {
    const control = button(candidate === 'rendered' ? 'Rendered' : 'Source', () => setMode(candidate));
    control.dataset.documentMode = candidate;
    switcher.append(control);
  }
  switcher.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const controls = [...switcher.querySelectorAll('button')];
    const selected = controls.findIndex(control => control.getAttribute('aria-pressed') === 'true');
    event.preventDefault();
    controls[(selected + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length]?.focus();
  });
  header.append(identity, switcher);
  const body = element('div', 'document-view-body');
  root.append(header, body);

  function outlineNode(outline) {
    const listNode = () => {
      const list = element('ol', 'document-outline-list');
      for (const entry of outline) {
        const item = element('li', ''); item.dataset.level = String(entry.level);
        const link = element('a', '', entry.text);
        link.setAttribute('href', safeMarkdownHref(`#${entry.id}`));
        item.append(link); list.append(item);
      }
      if (!outline.length) list.append(element('li', 'meta', 'No headings in this document.'));
      return list;
    };
    const layer = element('div', 'document-outline-layer');
    const desktop = element('nav', 'document-outline-desktop');
    desktop.setAttribute('aria-label', 'On this page');
    desktop.append(element('h3', '', 'On this page'), listNode());
    const disclosure = element('details', 'document-outline-narrow');
    const summary = element('summary', 'document-outline-summary', `On this page · ${outline.length} section${outline.length === 1 ? '' : 's'}`);
    const nav = element('nav', 'document-outline-narrow-nav');
    nav.setAttribute('aria-label', 'On this page');
    nav.append(element('h3', '', 'On this page'));
    nav.append(listNode());
    disclosure.append(summary, nav);
    layer.append(desktop, disclosure);
    return layer;
  }

  function render() {
    body.replaceChildren();
    root.dataset.mode = currentMode;
    for (const control of switcher.querySelectorAll('button')) {
      control.setAttribute('aria-pressed', String(control.dataset.documentMode === currentMode));
    }
    if (currentMode === 'source') {
      const pre = element('pre', 'document-source');
      const code = element('code', '', source);
      pre.append(code); body.append(pre);
      return;
    }
    const rendered = renderMarkdown(source, { mermaidRenderer });
    const layout = element('div', 'document-reading-layout');
    layout.append(outlineNode(rendered.outline), rendered.element);
    body.append(layout);
  }

  function setMode(nextMode) {
    if (!MODES.includes(nextMode)) throw new TypeError('Document mode must be rendered or source');
    if (currentMode === nextMode) return currentMode;
    currentMode = nextMode;
    render();
    onModeChange?.(currentMode);
    return currentMode;
  }

  function setMarkdown(nextMarkdown) {
    source = String(nextMarkdown ?? '');
    render();
    return source;
  }

  render();
  return { element: root, setMarkdown, setMode, getMode: () => currentMode, getMarkdown: () => source };
}
