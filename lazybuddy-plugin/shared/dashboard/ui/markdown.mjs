// Dependency-free Markdown presentation for authored plans and evidence.
// Parsing is intentionally bounded: supported syntax becomes DOM through
// textContent/createElement only; HTML in a document is displayed as text.

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function linesOf(markdown) {
  return String(markdown).replace(/\r\n?/g, '\n').split('\n');
}

function tableCells(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of body) {
    if (escaped) { cell += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += character;
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(line) {
  return tableCells(line).map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
}

function startsBlock(lines, index) {
  const line = lines[index] ?? '';
  return !line.trim() || HEADING.test(line) || FENCE.test(line) || LIST_ITEM.test(line) || QUOTE.test(line)
    || (/\|/.test(line) && TABLE_DIVIDER.test(lines[index + 1] ?? ''));
}

function slugBase(text) {
  const value = String(text).normalize?.('NFKD') ?? String(text);
  return value.toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/[\s-]+/g, '-') || 'section';
}

/** Parse the supported Markdown block grammar without interpreting HTML. */
export function parseMarkdown(markdown) {
  const lines = linesOf(markdown);
  const blocks = [];
  const outline = [];
  const slugs = new Map();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(FENCE);
    if (fence && (fence[1][0] !== '`' || !fence[2].includes('`'))) {
      const startLine = index;
      const marker = fence[1];
      const language = fence[2].trim().split(/\s+/, 1)[0].toLowerCase();
      const content = [];
      index += 1;
      while (index < lines.length) {
        const close = lines[index].match(FENCE);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length && !close[2].trim()) {
          index += 1;
          break;
        }
        content.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', language, text: content.join('\n'), line: startLine });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const text = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      if (text) {
        const base = slugBase(text);
        const occurrence = (slugs.get(base) ?? 0) + 1;
        slugs.set(base, occurrence);
        const id = occurrence === 1 ? base : `${base}-${occurrence}`;
        const block = { kind: 'heading', level: heading[1].length, text, id, line: index };
        blocks.push(block);
        outline.push({ level: block.level, text, id });
      }
      index += 1;
      continue;
    }

    if (/\|/.test(line) && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const headers = tableCells(line);
      const alignments = tableAlignments(lines[index + 1]);
      const rows = [];
      const startLine = index;
      index += 2;
      while (index < lines.length && lines[index].trim() && /\|/.test(lines[index])) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, alignments, rows, line: startLine });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items = [];
      const startLine = index;
      while (index < lines.length) {
        const item = lines[index].match(LIST_ITEM);
        if (!item) break;
        items.push({
          depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2),
          ordered: /^\d/.test(item[2]),
          task: item[3] === undefined ? null : item[3].toLowerCase() === 'x',
          text: item[4],
          line: index,
        });
        index += 1;
      }
      blocks.push({ kind: 'list', items, line: startLine });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      const content = [];
      const startLine = index;
      while (index < lines.length) {
        const next = lines[index].match(QUOTE);
        if (!next) break;
        content.push(next[1]);
        index += 1;
      }
      blocks.push({ kind: 'quote', text: content.join('\n'), line: startLine });
      continue;
    }

    const prose = [];
    const startLine = index;
    while (index < lines.length && (index === startLine || !startsBlock(lines, index))) {
      prose.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: prose.join(' '), line: startLine });
  }
  return { blocks, outline };
}

/** Allow navigational/document links while rejecting active and local schemes. */
export function safeMarkdownHref(value) {
  const href = String(value ?? '').trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || /\s/.test(href)) return null;
  if (href.startsWith('//') || href.startsWith('\\')) return null;
  if (/^(?:#|\?|\/[^/]|\.\.?\/)/.test(href)) return href;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme) return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase()) ? href : null;
  return href;
}

function appendInline(parent, text) {
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^\n)]*\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('`')) {
      parent.append(Object.assign(document.createElement('code'), { textContent: token.slice(1, -1) }));
    } else if (token.startsWith('[')) {
      const parsed = /^\[([^\]]+)\]\((.*)\)$/.exec(token);
      const href = safeMarkdownHref(parsed?.[2]);
      if (href) {
        const link = document.createElement('a');
        link.textContent = parsed[1];
        link.setAttribute('href', href);
        if (/^https?:/i.test(href)) { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
        parent.append(link);
      } else {
        const rejected = document.createElement('span');
        rejected.className = 'markdown-unsafe-link';
        rejected.dataset.rejectedUrl = parsed?.[2] ?? '';
        rejected.textContent = `${parsed?.[1] ?? token} (unsafe link omitted)`;
        parent.append(rejected);
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong'); strong.textContent = token.slice(2, -2); parent.append(strong);
    } else {
      const emphasis = document.createElement('em'); emphasis.textContent = token.slice(1, -1); parent.append(emphasis);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

const SVG_TAGS = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'title', 'desc', 'defs', 'marker']);
const SVG_ATTRIBUTES = new Set(['viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'transform', 'text-anchor', 'dominant-baseline', 'marker-end', 'marker-start', 'id', 'role', 'aria-label']);

function attributesOf(node) {
  if (!node?.attributes) return [];
  if (node.attributes instanceof Map) return [...node.attributes.entries()].map(([name, value]) => ({ name, value }));
  return [...node.attributes].map(attribute => ({ name: attribute.name, value: attribute.value }));
}

function safeSvgAttribute(name, value) {
  if (!SVG_ATTRIBUTES.has(String(name).toLowerCase())) return false;
  const text = String(value);
  if (/javascript:|data:|<|>/i.test(text)) return false;
  if (/url\(/i.test(text) && !/^url\(#[A-Za-z0-9_-]+\)$/.test(text)) return false;
  return true;
}

function copySafeSvg(node) {
  if (node?.nodeType === 3) return document.createTextNode(node.textContent);
  const tag = String(node?.tagName ?? '').toLowerCase();
  if (!SVG_TAGS.has(tag)) return null;
  const copy = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const { name, value } of attributesOf(node)) if (safeSvgAttribute(name, value)) copy.setAttribute(name, value);
  for (const child of node.childNodes ?? []) {
    const safe = copySafeSvg(child);
    if (safe) copy.append(safe);
  }
  return copy;
}

function codeBlock(block, mermaidRenderer) {
  const figure = document.createElement('figure');
  figure.className = block.language === 'mermaid' ? 'markdown-diagram' : 'markdown-code';
  if (block.language === 'mermaid' && typeof mermaidRenderer === 'function') {
    try {
      const rendered = mermaidRenderer(block.text);
      const safe = rendered?.then ? null : copySafeSvg(rendered);
      if (safe && String(safe.tagName).toLowerCase() === 'svg') {
        safe.setAttribute('role', 'img');
        if (!safe.getAttribute('aria-label')) safe.setAttribute('aria-label', 'Mermaid diagram');
        figure.append(safe);
        return figure;
      }
    } catch { /* The visible source fallback below is the safe failure path. */ }
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = block.text;
  if (block.language) code.dataset.language = block.language;
  pre.append(code); figure.append(pre);
  if (block.language === 'mermaid') {
    const caption = document.createElement('figcaption');
    caption.textContent = 'Diagram preview unavailable — Mermaid renderer is not packaged; source shown safely.';
    figure.append(caption);
  }
  return figure;
}

function renderList(block) {
  const root = document.createElement(block.items[0]?.ordered ? 'ol' : 'ul');
  root.className = 'markdown-list';
  const stack = [{ depth: 0, list: root, lastItem: null }];
  for (const source of block.items) {
    const depth = Math.min(source.depth, stack.length);
    while (stack.length - 1 > depth) stack.pop();
    while (stack.length - 1 < depth) {
      const parent = stack[stack.length - 1];
      if (!parent.lastItem) break;
      const nested = document.createElement(source.ordered ? 'ol' : 'ul');
      nested.className = 'markdown-list';
      parent.lastItem.append(nested);
      stack.push({ depth: stack.length, list: nested, lastItem: null });
    }
    let target = stack[stack.length - 1];
    const wanted = source.ordered ? 'OL' : 'UL';
    if (target.list.tagName !== wanted) {
      const sibling = document.createElement(source.ordered ? 'ol' : 'ul');
      sibling.className = 'markdown-list';
      const parent = target.list.parentNode;
      if (parent?.tagName === 'LI') parent.append(sibling);
      else root.append(sibling);
      target = { depth: target.depth, list: sibling, lastItem: null };
      stack[stack.length - 1] = target;
    }
    const item = document.createElement('li');
    item.dataset.line = String(source.line);
    if (source.task !== null) {
      item.className = 'markdown-task';
      item.dataset.checked = String(source.task);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = true;
      checkbox.setAttribute('aria-label', source.task ? 'Completed checklist item (read only)' : 'Open checklist item (read only)');
      checkbox.dataset.authority = 'read-only';
      if (source.task) checkbox.setAttribute('checked', '');
      item.append(checkbox);
    }
    const content = document.createElement('span'); appendInline(content, source.text); item.append(content);
    target.list.append(item); target.lastItem = item;
  }
  return root;
}

/** Render parsed Markdown as a safe DOM article and return its outline. */
export function renderMarkdown(markdown, { mermaidRenderer = null } = {}) {
  const parsed = parseMarkdown(markdown);
  const article = document.createElement('article');
  article.className = 'markdown-document';
  for (const block of parsed.blocks) {
    let node;
    if (block.kind === 'heading') {
      node = document.createElement(`h${block.level}`); node.id = block.id; appendInline(node, block.text);
    } else if (block.kind === 'paragraph') {
      node = document.createElement('p'); appendInline(node, block.text);
    } else if (block.kind === 'quote') {
      node = document.createElement('blockquote'); appendInline(node, block.text);
    } else if (block.kind === 'list') {
      node = renderList(block);
    } else if (block.kind === 'table') {
      node = document.createElement('div'); node.className = 'markdown-table-scroll'; node.tabIndex = 0;
      node.setAttribute('role', 'region'); node.setAttribute('aria-label', 'Scrollable table');
      const table = document.createElement('table');
      const head = document.createElement('thead'); const headRow = document.createElement('tr');
      block.headers.forEach((text, cellIndex) => { const cell = document.createElement('th'); cell.setAttribute('scope', 'col'); if (block.alignments[cellIndex]) cell.dataset.align = block.alignments[cellIndex]; appendInline(cell, text); headRow.append(cell); });
      head.append(headRow); table.append(head);
      const body = document.createElement('tbody');
      for (const row of block.rows) {
        const tableRow = document.createElement('tr');
        block.headers.forEach((_, cellIndex) => { const cell = document.createElement('td'); if (block.alignments[cellIndex]) cell.dataset.align = block.alignments[cellIndex]; appendInline(cell, row[cellIndex] ?? ''); tableRow.append(cell); });
        body.append(tableRow);
      }
      table.append(body); node.append(table);
    } else if (block.kind === 'code') {
      node = codeBlock(block, mermaidRenderer);
    }
    if (node) { node.dataset.sourceLine = String(block.line + 1); article.append(node); }
  }
  return { element: article, outline: parsed.outline };
}
