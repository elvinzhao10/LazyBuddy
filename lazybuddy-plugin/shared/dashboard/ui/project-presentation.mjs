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
const TEXT = Object.freeze({ charWidth: 8.4, lineHeight: 21, titleLinesMax: 6 });

// Card geometry constants (px), kept in one place so tests and evidence agree.
export const CARD = Object.freeze({ width: 224, paddingX: 12, paddingY: 10, rowGap: 6, idRow: 18, chipRow: 22, metaRow: 18, separator: 8, heightMin: 96, gap: { column: 104, row: 32 }, canvasPadding: 32 });

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
  const height = Math.max(CARD.heightMin, CARD.paddingY * 2 + CARD.idRow + CARD.separator + titleBlock + CARD.rowGap + CARD.chipRow + CARD.rowGap + CARD.chipRow + CARD.separator + CARD.metaRow);
  return { width: CARD.width, height, titleLines: shown, lineCount: shown.length, truncated, fullTitle: node.title };
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
  const pending = node.children.filter(child => ['attention', 'active', 'unavailable'].includes(child.verification?.role)).length;
  const stale = node.children.filter(child => child.verification?.role === 'stale').length;
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
  const layoutEdges = fixture.edges.filter(edge => LAYERING_EDGE_KINDS.has(edge.kind)).map(edge => ({ ...edge }));
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
  const placed = new Map();
  let x = CARD.canvasPadding;
  for (const column of columns) {
    let y = CARD.canvasPadding;
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
