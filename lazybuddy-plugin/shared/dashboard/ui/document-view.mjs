import { element, segmentedControl } from './components.mjs';
import { renderMarkdown, safeMarkdownHref } from './markdown.mjs';

const MODES = Object.freeze(['rendered', 'source']);

/**
 * Read-only long-form document surface for shell, plan, and evidence lanes.
 * Checklists describe source content only; this module exposes no mutation API.
 *
 * chrome: false renders the bare reading surface (outline + article or source
 * pre) for embedding inside a host that already owns the mode chrome — the
 * T15 editors embed it as their rendered pane.
 */
export function createDocumentView({ markdown, title = 'Document', mode = 'rendered',
  mermaidRenderer = null, onModeChange = null, chrome = true } = {}) {
  if (!MODES.includes(mode)) throw new TypeError('Document mode must be rendered or source');
  let source = String(markdown ?? '');
  let currentMode = mode;

  const root = element('section', 'document-view');
  root.dataset.testid = 'document-view';
  const body = element('div', 'document-view-body');

  // T11 segmented control (data-native-segmented): ArrowLeft/Right/Home/End
  // activation comes from the native focus layer, not a local handler.
  const switcher = segmentedControl({
    label: 'Document presentation',
    options: [{ value: 'rendered', label: 'Rendered' }, { value: 'source', label: 'Source' }],
    current: currentMode,
    onChange: next => setMode(next),
  });
  for (const control of switcher.element.querySelectorAll('button')) {
    control.dataset.documentMode = control.dataset.segment; // legacy selector continuity
  }

  if (chrome) {
    const header = element('header', 'document-view-header');
    const identity = element('div', 'document-view-identity');
    identity.append(element('h2', '', title), element('p', 'meta', 'Read-only document · checklist state comes from the source'));
    header.append(identity, switcher.element);
    root.append(header, body);
  } else {
    root.setAttribute('aria-label', title);
    root.append(body);
  }

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
    switcher.setCurrent(currentMode);
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
  return { element: root, setMarkdown, setMode, getMode: () => currentMode, getMarkdown: () => source, switcher };
}
