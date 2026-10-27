// T03 spike presentation model — pure functions, no DOM and no scheduler authority.
// Layering and edges come from the EXISTING engine (ui/graph-layout.mjs layeredDAGLayout);
// this module adds label-derived card extents, collapsed summaries, layout hints and the
// hierarchical list equivalent used at narrow widths.
import { layeredDAGLayout, GraphLayoutError } from './graph-layout.mjs';

export const NODE_KINDS = Object.freeze(['feature-area', 'plan', 'conflict', 'boundary', 'wave', 'batch', 'gate', 'gate-check', 'task', 'verifier', 'join', 'attempt', 'step', 'evidence']);
export const EDGE_KINDS = Object.freeze(['dependency', 'gate', 'external', 'conflict', 'group', 'history']);
const LAYERING_EDGE_KINDS = new Set(['dependency', 'gate', 'external']);

export class SpikePresentationError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SpikePresentationError';
    this.code = code;
  }
}

// Deterministic text measurement (documented estimate, no font metrics dependency):
// body text 15px system sans ≈ 8.4px average glyph advance; line height 21px.
const TEXT = Object.freeze({ charWidth: 8.4, captionCharWidth: 7.2, lineHeight: 21, captionLineHeight: 20, titleLinesMax: 5, summaryLinesMax: 3 });

// Card geometry constants (px), kept in one place so tests and evidence agree.
export const CARD = Object.freeze({ width: 256, paddingX: 12, paddingY: 12, border: 2, rowGap: 8, idRow: 20, chipLabelWidth: 76, chipIconWidth: 24, chipPaddingX: 16, chipPaddingY: 8, metaRow: 20, toggleRow: 34, separator: 8, heightMin: 176, gap: { column: 104, row: 32 }, canvasPadding: 32 });

/** Wrap a label to a pixel width using the documented estimate; unbroken tokens hard-split (overflow-wrap: anywhere). */
export function wrapLabel(label, maxWidth = CARD.width - CARD.paddingX * 2) {
  const maxChars = Math.max(8, Math.floor(maxWidth / TEXT.charWidth));
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  const append = (rest) => {
    if (!lines.length || lines[lines.length - 1].length + 1 + rest.length > maxChars) lines.push(rest);
    else lines[lines.length - 1] += ` ${rest}`;
  };
  for (const word of words) {
    let rest = word;
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (rest) append(rest);
  }
  return lines.length ? lines : [''];
}

/** Measured card extent for a node title: wrapped lines, optional ellipsis truncation. */
export function measureNodeCard(node) {
  const lines = wrapLabel(node.title);
  const truncated = lines.length > TEXT.titleLinesMax;
  const shown = truncated ? [...lines.slice(0, TEXT.titleLinesMax - 1), `${lines[TEXT.titleLinesMax - 1].slice(0, -1)}…`] : lines;
  const titleBlock = Math.max(1, shown.length) * TEXT.lineHeight;
  const contentWidth = CARD.width - CARD.paddingX * 2;
  const captionLines = (value, width = contentWidth) => wrapLabel(value ?? '', width * (TEXT.charWidth / TEXT.captionCharWidth));
  const identityLines = Math.max(1, captionLines(node.id).length);
  const chipTextWidth = contentWidth - CARD.chipLabelWidth - CARD.rowGap - CARD.chipIconWidth - CARD.chipPaddingX;
  const chipRows = [node.execution?.label, node.verification?.label].map(label => {
    const lineCount = Math.max(1, captionLines(label, chipTextWidth).length);
    return Math.max(TEXT.captionLineHeight, lineCount * TEXT.captionLineHeight + CARD.chipPaddingY);
  });
  const summary = captionLines(node.summary ?? '');
  const summaryLimit = node.collapsedGroup || node.kind === 'join' ? Number.POSITIVE_INFINITY : TEXT.summaryLinesMax;
  const summaryTruncated = summary.length > summaryLimit;
  const summaryLines = summaryTruncated
    ? [...summary.slice(0, summaryLimit - 1), `${summary[summaryLimit - 1].slice(0, -1)}…`]
    : summary;
  const blocks = [identityLines * TEXT.captionLineHeight, titleBlock, ...chipRows, Math.max(1, summaryLines.length) * TEXT.captionLineHeight];
  if (node.expandable || node.children?.length) blocks.push(CARD.toggleRow);
  const height = Math.max(CARD.heightMin, CARD.border + CARD.paddingY * 2 + blocks.reduce((sum, value) => sum + value, 0)
    + CARD.rowGap * (blocks.length - 1));
  return { width: CARD.width, height, titleLines: shown, lineCount: shown.length, truncated, fullTitle: node.title,
    summaryLines, summaryTruncated, fullSummary: node.summary ?? '', chipRows, identityLines };
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') throw new SpikePresentationError('FIXTURE_REQUIRED');
  if (typeof fixture.viewId !== 'string' || !Array.isArray(fixture.nodes) || !Array.isArray(fixture.edges)) throw new SpikePresentationError('FIXTURE_SHAPE');
  const ids = new Set();
  for (const node of fixture.nodes) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id)) throw new SpikePresentationError('DUPLICATE_NODE', node?.id);
    if (!NODE_KINDS.includes(node.kind)) throw new SpikePresentationError('UNKNOWN_NODE_KIND', `${node?.id}:${node?.kind}`);
    if (typeof node.title !== 'string') throw new SpikePresentationError('NODE_TITLE_REQUIRED', node.id);
    ids.add(node.id);
    if (node.children) for (const child of node.children) {
      if (!child || typeof child.id !== 'string' || !NODE_KINDS.includes(child.kind)) throw new SpikePresentationError('UNKNOWN_NODE_KIND', `${node.id} child ${child?.id}`);
    }
  }
  for (const edge of fixture.edges) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) throw new SpikePresentationError('UNKNOWN_EDGE_ENDPOINT', `${edge?.from} -> ${edge?.to}`);
    if (!EDGE_KINDS.includes(edge.kind)) throw new SpikePresentationError('UNKNOWN_EDGE_KIND', edge?.kind);
    if (edge.from === edge.to) throw new SpikePresentationError('SELF_EDGE', edge.from);
  }
}

function gateSummary(node) {
  if (!node.children?.length) return node.summary;
  const total = node.children.length;
  const pending = node.children.filter(child => ['attention', 'active', 'unavailable'].includes(child.verification?.state)).length;
  const stale = node.children.filter(child => child.verification?.state === 'stale').length;
  const state = pending ? `${pending} pending` : stale ? `${stale} stale` : 'all confirmed';
  return `${node.summary} · collapsed: ${total} checks, ${state}`;
}

function fixtureCollapsed(fixture) {
  return new Set(fixture.nodes.filter(node => node.collapsed).map(node => node.id));
}

/**
 * Presentation model for a fixture. Pure: same fixture in, same model out.
 * Collapsed groups contribute one summary node; expanded groups contribute their children.
 * Without an explicit collapsed set, the fixture's own collapsed flags apply.
 */
export function presentationModel(fixture, { collapsed } = {}) {
  validateFixture(fixture);
  const collapsedSet = collapsed ?? fixtureCollapsed(fixture);
  validateFixture(fixture);
  const nodes = [];
  for (const node of fixture.nodes) {
    if (node.children?.length && !collapsedSet.has(node.id)) {
      for (const child of node.children) nodes.push({ ...child, groupOf: node.id, summary: child.summary ?? '' });
    }
    const isCollapsedGroup = Boolean(node.children?.length) && collapsedSet.has(node.id);
    nodes.push({ ...node, summary: isCollapsedGroup ? gateSummary(node) : node.summary, collapsedGroup: isCollapsedGroup, expandable: Boolean(node.children?.length), children: undefined });
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const layoutEdges = fixture.edges.filter(edge => LAYERING_EDGE_KINDS.has(edge.kind)
    || (fixture.level === 'project' && edge.kind === 'group')).map(edge => ({ ...edge }));
  const edges = fixture.edges.map(edge => ({ ...edge }));
  for (const node of nodes) {
    if (node.layoutAfter && byId.has(node.layoutAfter)) {
      const hint = { from: node.layoutAfter, to: node.id, kind: 'group', label: 'layout hint: sequence after earlier attempt (presentation only)' };
      layoutEdges.push(hint);
    }
  }
  return { viewId: fixture.viewId, level: fixture.level, docId: fixture.docId, title: fixture.title, subtitle: fixture.subtitle, nodes, edges, layoutEdges, byId };
}

/**
 * Layout via the EXISTING engine. The engine assigns layers/columns from dependency edges;
 * this pass adds label-derived per-node extents (row stacking, edge endpoints, canvas size).
 */
export function layoutProjectGraph(model) {
  const tasks = model.nodes.map(node => ({ id: node.id, depends_on: model.layoutEdges.filter(edge => edge.to === node.id).map(edge => edge.from) }));
  let engine;
  try {
    engine = layeredDAGLayout(tasks);
  } catch (error) {
    if (error instanceof GraphLayoutError) throw new SpikePresentationError(`LAYOUT_${error.code}`, error.message);
    throw error;
  }
  const measures = new Map(model.nodes.map(node => [node.id, measureNodeCard(node)]));
  const columns = [];
  for (const node of engine.nodes) {
    if (!columns[node.layer]) columns[node.layer] = [];
    columns[node.layer].push(node.id);
  }
  const organic = model.level === 'project';
  if (organic && columns.length === 1 && columns[0].length > 2) {
    const independent = columns.pop();
    const count = Math.ceil(Math.sqrt(independent.length));
    independent.forEach((id, index) => { (columns[index % count] ??= []).push(id); });
  }
  const extent = column => column.reduce((total, id) => total + measures.get(id).height, 0) + Math.max(0, column.length - 1) * CARD.gap.row;
  const tallest = Math.max(0, ...columns.map(extent));
  const placed = new Map();
  let x = CARD.canvasPadding;
  for (const [index, column] of columns.entries()) {
    if (organic && index > 0) column.sort((a, b) => {
      const center = id => {
        const neighbors = model.layoutEdges.filter(edge => edge.to === id).map(edge => placed.get(edge.from)).filter(Boolean);
        return neighbors.length ? neighbors.reduce((sum, node) => sum + node.y + node.height / 2, 0) / neighbors.length : tallest / 2;
      };
      return center(a) - center(b) || a.localeCompare(b);
    });
    let y = CARD.canvasPadding + (organic ? (tallest - extent(column)) / 2 + (index % 2) * CARD.gap.row : 0);
    for (const id of column) {
      const measure = measures.get(id);
      placed.set(id, { id, x, y, width: measure.width, height: measure.height, layer: engine.nodes.find(node => node.id === id).layer });
      y += measure.height + CARD.gap.row;
    }
    x += CARD.width + CARD.gap.column;
  }
  const edges = model.edges.flatMap(edge => {
    const source = placed.get(edge.from);
    const target = placed.get(edge.to);
    if (!source || !target) return [];
    return [{ ...edge, id: `${edge.from}->${edge.to}`,
      x1: source.x + source.width, y1: source.y + source.height / 2, x2: target.x, y2: target.y + target.height / 2 }];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const width = Math.max(480, ...[...placed.values()].map(node => node.x + node.width + CARD.canvasPadding));
  const height = Math.max(260, ...[...placed.values()].map(node => node.y + node.height + CARD.canvasPadding));
  return { nodes: [...placed.values()].sort((left, right) => left.id.localeCompare(right.id)), edges, width, height, measures: [...measures.entries()].map(([id, measure]) => ({ id, ...measure })) };
}

/**
 * Hierarchical list equivalent (narrow widths, full labels). Rows follow fixture order
 * within kind-hierarchy groups; depth carries aria-level. Pure and deterministic.
 */
export function listModel(fixture, { collapsed } = {}) {
  const model = presentationModel(fixture, { collapsed });
  const collapsedSet = collapsed ?? fixtureCollapsed(fixture);
  const parentOf = new Map(model.nodes.filter(node => node.groupOf).map(node => [node.id, node.groupOf]));
  const roots = model.nodes.filter(node => !node.groupOf);
  const rows = [];
  function walk(node, depth) {
    rows.push({ id: node.id, depth, kind: node.kind, label: node.title, fullLabel: node.title, summary: node.summary, execution: node.execution, verification: node.verification, meta: node.meta, expandable: node.expandable, collapsedGroup: node.collapsedGroup });
    if (node.expandable && !collapsedSet.has(node.id)) {
      for (const child of model.nodes.filter(candidate => parentOf.get(candidate.id) === node.id)) walk(child, depth + 1);
    }
  }
  for (const root of roots) walk(root, 0);
  return { viewId: model.viewId, docId: model.docId, rows };
}
