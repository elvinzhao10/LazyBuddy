// T03 project composition spike — DOM view over the existing layout engine.
// Fixture-only presentation: no fetch, no commands, no scheduler authority, no persistence.
// Layout replies are tagged with a view revision; stale replies are discarded, never displayed.
import { button, element, statusChip } from './components.mjs';
import { createGraphViewportController } from './graph-viewport.mjs';
import { CARD, listModel, measureNodeCard, presentationModel, layoutProjectGraph, SpikePresentationError } from './project-presentation.mjs';

const defaultScheduler = model => layoutProjectGraph(model);
const LEVEL_NAMES = { project: 'Project', plan: 'Plan', batch: 'Batch', attempt: 'Attempt' };
const EDGE_LEGEND = [
  ['dependency', 'Dependency · declared prerequisite'],
  ['gate', 'Verification gate · gate consumes batch results'],
  ['external', 'External prerequisite · terminates at a boundary node'],
  ['conflict', 'Conflict · attention relationship, not execution order'],
  ['group', 'Grouping or presentation hint · not a scheduler decision'],
  ['history', 'Retry history · new attempt, never a plan-DAG cycle'],
];

function nodeCard(node, state) {
  const measure = state.measures.get(node.id) ?? measureNodeCard(node);
  const card = element('div', `spike-node kind-${node.kind}`);
  card.dataset.nodeId = node.id;
  card.dataset.kind = node.kind;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-pressed', String(state.selectedId === node.id));
  card.setAttribute('aria-label', `${node.kind.replace('-', ' ')}: ${measure.fullTitle}`);
  card.title = measure.truncated ? measure.fullTitle : '';
  card.addEventListener('click', event => {
    if (event.target !== card && event.target.tagName === 'BUTTON') return;
    state.onSelect(node.id);
  });
  const identity = element('span', 'spike-identity');
  identity.append(element('code', '', node.id));
  card.append(identity);
  const title = element('span', 'spike-title', measure.titleLines.join(' '));
  if (measure.truncated) title.dataset.truncated = 'true';
  card.append(title);
  for (const [kind, value] of [['Execution', node.execution], ['Verification', node.verification]]) {
    const row = element('span', 'cluster spike-chiprow');
    row.append(element('span', 'meta', kind), statusChip(value));
    card.append(row);
  }
  const summary = element('span', 'meta spike-summary', measure.summaryLines.join(' '));
  if (measure.summaryTruncated) {
    summary.dataset.truncated = 'true';
    summary.title = measure.fullSummary;
  }
  card.append(summary);
  if (node.expandable) {
    const toggle = button(node.collapsedGroup ? 'Expand checks' : 'Collapse checks', () => state.onToggle(node.id));
    toggle.className = 'spike-toggle';
    toggle.setAttribute('aria-expanded', String(!node.collapsedGroup));
    card.append(toggle);
  }
  return card;
}

function listRow(row, state) {
  const item = element('li', `spike-row kind-${row.kind}`);
  item.dataset.nodeId = row.id;
  item.setAttribute('aria-level', String(row.depth + 1));
  const control = button(row.fullLabel, () => state.onSelect(row.id));
  control.dataset.nodeId = row.id;
  control.dataset.view = 'list';
  control.className = 'spike-row-control';
  control.setAttribute('aria-pressed', String(state.selectedId === row.id));
  const chips = element('span', 'cluster');
  chips.append(statusChip(row.execution), statusChip(row.verification));
  item.append(control, chips, element('span', 'meta spike-summary', `${row.summary} · ${row.meta ?? ''}`));
  if (row.expandable) {
    const toggle = button(row.collapsedGroup ? 'Expand group' : 'Collapse group', () => state.onToggle(row.id));
    toggle.className = 'spike-toggle';
    toggle.setAttribute('aria-expanded', String(!row.collapsedGroup));
    item.append(toggle);
  }
  return item;
}

function edgePath(edge) {
  const bend = Math.max(32, (edge.x2 - edge.x1) / 2);
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`;
}

function disabledAction(label, reason, action) {
  const wrap = element('div', 'stack');
  const control = button(label, action ?? null, { disabled: !action });
  control.className = 'spike-action';
  wrap.append(control);
  if (!action) {
    const why = element('p', 'meta spike-reason', reason);
    why.id = `reason-${label.replace(/[^a-z0-9]+/gi, '-')}`;
    control.setAttribute('aria-describedby', why.id);
    wrap.append(why);
  }
  return wrap;
}

export function createProjectMapSpike({ fixture, mode = 'graph', layoutScheduler = defaultScheduler, planProvider, callbacks = {}, inspectorContent = null }) {
  let currentFixture = structuredClone(fixture);
  let collapsed = new Set(currentFixture.nodes.filter(node => node.collapsed).map(node => node.id));
  let selectedId = null;
  let currentMode = mode === 'list' ? 'list' : 'graph';
  let viewRevision = 0;
  let appliedRevision = 0;
  let appliedModel = null;
  let appliedLayout = null;
  let layoutError = null;
  let pendingCount = 0;
  let lastApplyMs = 0;
  const discarded = [];

  const root = element('section', 'project-spike stack');
  root.dataset.testid = 'project-spike';
  root.dataset.level = fixture.level;
  let expandedDialog = null; let homeMarker = null; let expandControl = null;

  function closeExpandedMap() {
    if (!expandedDialog) return;
    const dialog = expandedDialog; expandedDialog = null;
    if (homeMarker?.parentNode) homeMarker.parentNode.insertBefore(root, homeMarker);
    homeMarker?.remove(); homeMarker = null;
    root.dataset.expanded = 'false'; dialog.close?.(); dialog.remove();
    if (expandControl) { expandControl.textContent = 'Expand map'; expandControl.focus(); }
  }

  const status = element('p', 'meta spike-status', 'Preparing first layout');
  status.dataset.testid = 'spike-status';
  status.setAttribute('role', 'status');

  const inspector = element('aside', 'panel spike-inspector stack');
  inspector.dataset.testid = 'spike-inspector';
  inspector.tabIndex = 0;
  inspector.setAttribute('role', 'region');
  inspector.setAttribute('aria-label', 'Contextual inspector');
  let graphMounted = false;
  let refreshMapSearch = () => {};
  const graphViewport = createGraphViewportController({
    getRegion: () => root.querySelector('.spike-graph-viewport'),
    getSvg: () => root.querySelector('.spike-graph'),
    onChange: event => {
      const readout = root.querySelector('[data-zoom-readout]');
      if (readout) {
        const label = `${Math.round(event.scale * 100)}%`;
        if (readout.textContent !== label) readout.textContent = label;
        readout.setAttribute('aria-label', `Zoom ${label}; reset to 100%`);
      }
      callbacks.onViewportChange?.(event);
    },
  });

  function nodeById(id) {
    return currentFixture.nodes.find(node => node.id === id) ?? currentFixture.nodes.flatMap(node => node.children ?? []).find(child => child.id === id);
  }

  function updateStatus() {
    refreshMapSearch();
    const parts = [];
    if (layoutError) parts.push(`Layout failed (${layoutError.code ?? 'ERROR'}) · last valid view retained · equivalent list shown`);
    else if (pendingCount > 0) parts.push(`Layout pending for revision ${viewRevision} · previous view retained`);
    else if (appliedLayout) parts.push(`Layout applied · revision ${appliedRevision} · ${appliedLayout.nodes.length} nodes · ${appliedLayout.edges.length} edges`);
    if (discarded.length) parts.push(`${discarded.length} stale layout repl${discarded.length === 1 ? 'y' : 'ies'} discarded`);
    status.textContent = parts.join(' · ');
    root.dataset.layoutRevision = String(appliedRevision);
  }

  function requestLayout() {
    viewRevision += 1;
    const revision = viewRevision;
    layoutError = null;
    pendingCount += 1;
    updateStatus();
    const started = performance.now();
    const model = presentationModel(currentFixture, { collapsed });
    Promise.resolve().then(() => layoutScheduler(model, revision)).then(result => {
      pendingCount -= 1;
      lastApplyMs = performance.now() - started;
      if (revision !== viewRevision) {
        discarded.push({ requestedRevision: revision, currentRevision: viewRevision });
        updateStatus();
        return;
      }
      appliedRevision = revision;
      appliedModel = model;
      appliedLayout = result;
      root.dataset.docId = model.docId;
      root.dataset.level = model.level;
      const crumbTitle = root.querySelector('.spike-crumb-title');
      if (crumbTitle) crumbTitle.textContent = model.title ?? model.docId;
      const crumbLevel = root.querySelector('.spike-crumb-level');
      if (crumbLevel) crumbLevel.textContent = `Project / ${LEVEL_NAMES[model.level] ?? model.level}`;
      for (const control of root.querySelectorAll('[data-plan-id]')) control.setAttribute('aria-pressed', String(control.dataset.planId === model.viewId));
      renderGraph();
      renderList();
      updateStatus();
      callbacks.onLayoutApplied?.({ revision, nodeCount: result.nodes.length, ms: lastApplyMs });
    }).catch(error => {
      pendingCount -= 1;
      if (revision !== viewRevision) {
        discarded.push({ requestedRevision: revision, currentRevision: viewRevision });
        updateStatus();
        return;
      }
      layoutError = error instanceof SpikePresentationError ? error : new SpikePresentationError('LAYOUT_FAILED', String(error?.message ?? error));
      renderList();
      updateStatus();
      callbacks.onLayoutError?.({ code: layoutError.code });
    });
  }

  function renderGraph() {
    if (!appliedLayout) return;
    const previousViewport = root.querySelector('.spike-graph-viewport');
    const focusedId = previousViewport?.contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
    graphViewport.capture();
    const wrap = root.querySelector('.spike-graph-wrap') ?? element('div', 'spike-graph-wrap');
    wrap.replaceChildren();
    const region = element('div', 'spike-graph-viewport');
    region.tabIndex = 0;
    region.setAttribute('aria-label', 'Project composition graph');
    region.dataset.testid = 'spike-graph';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('spike-graph');
    svg.setAttribute('viewBox', `0 0 ${appliedLayout.width} ${appliedLayout.height}`);
    svg.setAttribute('width', appliedLayout.width);
    svg.setAttribute('height', appliedLayout.height);
    const edgeLayer = document.createElementNS(svg.namespaceURI, 'g');
    for (const edge of appliedLayout.edges) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.dataset.edgeId = edge.id;
      path.dataset.kind = edge.kind;
      path.setAttribute('d', edgePath(edge));
      path.setAttribute('aria-label', `${edge.kind} edge: ${edge.label}`);
      edgeLayer.append(path);
    }
    const nodeLayer = document.createElementNS(svg.namespaceURI, 'g');
    const state = {
      selectedId,
      measures: new Map(appliedLayout.measures.map(measure => [measure.id, measure])),
      onToggle: toggleGroup,
      onSelect: select,
    };
    for (const placed of appliedLayout.nodes) {
      const node = appliedModel.byId.get(placed.id);
      const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject');
      foreign.dataset.nodeId = placed.id;
      foreign.setAttribute('x', placed.x); foreign.setAttribute('y', placed.y);
      foreign.setAttribute('width', placed.width); foreign.setAttribute('height', placed.height);
      foreign.append(nodeCard(node, state));
      nodeLayer.append(foreign);
    }
    svg.append(edgeLayer, nodeLayer);
    region.append(svg);
    wrap.append(region);
    const body = root.querySelector('.spike-body');
    body.prepend(wrap);
    graphViewport.bind(region, svg, appliedLayout.width, appliedLayout.height);
    if (!graphMounted) { graphMounted = true; graphViewport.setViewport({ scale: 1, scrollLeft: 0, scrollTop: 0 }, 'readable-mount'); }
    if (focusedId) region.querySelector(`.spike-node[data-node-id="${focusedId}"]`)?.focus();
  }

  function renderList() {
    const rows = listModel(currentFixture, { collapsed }).rows;
    let list = root.querySelector('.spike-list');
    if (!list) {
      list = element('ol', 'spike-list');
      list.dataset.testid = 'spike-list';
    }
    list.replaceChildren();
    const state = { selectedId, onSelect: select, onToggle: toggleGroup };
    for (const row of rows) list.append(listRow(row, state));
    list.hidden = currentMode !== 'list' && !layoutError;
    const body = root.querySelector('.spike-body');
    if (!body.contains(list)) body.append(list);
  }

  function select(nodeId, { inspect = true } = {}) {
    if (inspect) closeExpandedMap();
    selectedId = nodeId;
    for (const node of root.querySelectorAll('.spike-node, .spike-row-control')) {
      node.setAttribute('aria-pressed', String(node.dataset.nodeId === nodeId));
    }
    renderInspector();
    callbacks.onSelect?.({ nodeId });
  }

  function toggleGroup(nodeId) {
    if (collapsed.has(nodeId)) collapsed.delete(nodeId); else collapsed.add(nodeId);
    requestLayout();
    callbacks.onGroupToggle?.({ nodeId, collapsed: collapsed.has(nodeId) });
  }

  function renderInspector() {
    const node = selectedId ? nodeById(selectedId) : null;
    inspector.replaceChildren();
    if (node && inspectorContent) { inspector.append(inspectorContent(node)); return; }
    if (!node) {
      inspector.append(element('h3', '', 'Inspector'), element('p', 'meta', 'Select a node to inspect its summary, source, changes and evidence. States come from the fixture only.'));
      return;
    }
    inspector.append(element('h3', '', 'Inspector'), element('code', '', node.id), element('p', '', node.title));
    const sections = [
      ['Summary', node.summary ?? 'No summary recorded.'],
      ['Source', `Fixture document ${currentFixture.viewId} · presentation spike · no live source attached`],
      ['Changes', 'None · this spike has no editing authority; the rename control below changes presentation geometry only.'],
      ['Evidence', `${node.meta ?? 'No evidence recorded.'} · artifact indices arrive with T12/T19; nothing here is live.`],
    ];
    for (const [heading, text] of sections) {
      const section = element('section', 'stack');
      section.append(element('h4', '', heading), element('p', '', text));
      inspector.append(section);
    }
    const edgesSection = element('section', 'stack');
    edgesSection.append(element('h4', '', 'Edges'));
    const relevant = currentFixture.edges.filter(edge => edge.from === node.id || edge.to === node.id);
    if (!relevant.length) edgesSection.append(element('p', 'meta', 'No declared edges involve this node.'));
    for (const edge of relevant) edgesSection.append(element('p', 'meta', `${edge.from} → ${edge.to} · ${edge.kind} · ${edge.label}`));
    inspector.append(edgesSection);

    const rename = element('label', '', 'Rename (presentation only)');
    const input = element('input');
    input.dataset.testid = 'spike-rename';
    input.value = node.title;
    rename.append(input);
    const apply = button('Apply rename · recalculates geometry', () => renameNode(node.id, input.value));
    apply.dataset.testid = 'spike-rename-apply';
    inspector.append(rename, apply, element('p', 'meta', 'A longer title remeasures the card and relayers the graph through the existing engine.'));

    inspector.append(disabledAction('Run this object', 'Execution authority stays with the selected runtime; this spike is presentation-only and dispatches nothing.'));
    inspector.append(disabledAction('Accept resolution', 'Resolving the durable conflict requires accepted-baseline authority (T06); the spike records the conflict without resolving it.'));
    if (node.drill) inspector.append(disabledAction('Drill into this object', '', () => callbacks.onDrill?.({ nodeId: node.id, drill: node.drill })));
    else inspector.append(disabledAction('Drill into this object', 'No deeper level is defined for this object in this fixture.'));
  }

  function renameNode(nodeId, title) {
    if (typeof title !== 'string' || !title.trim()) return;
    const node = nodeById(nodeId);
    if (!node) return;
    node.title = title.trim();
    // T22 perf budget: a title edit changes only this node's measured card
    // extent — layering (dependency edges) and the node set are untouched —
    // so the rename applies incrementally over the applied layout instead of
    // scheduling a full engine re-layout. Any state without a clean applied
    // layout to build on (pending reply, layout error, collapsed group
    // hiding the node) falls back to the full relayout path.
    if (!applyRenameIncrementally(nodeId)) requestLayout();
    callbacks.onRename?.({ nodeId, title: node.title });
  }

  // Incremental title edit: remeasure ONE card, re-place the columns (heights
  // cascade), rebuild the edge endpoints and the canvas extent. Deterministic
  // twin of layoutProjectGraph's placement pass over the same model — the
  // result must equal a full relayout of the edited fixture byte for byte.
  function applyRenameIncrementally(nodeId) {
    if (appliedModel?.level === 'project') return false;
    if (!appliedLayout || !appliedModel || layoutError || pendingCount > 0) return false;
    const modelNode = appliedModel.byId.get(nodeId);
    if (!modelNode) return false;
    const source = nodeById(nodeId);
    modelNode.title = source.title;
    const started = performance.now();
    const measures = new Map(appliedLayout.measures.map(measure => [measure.id, measure]));
    const remeasured = measureNodeCard(modelNode);
    measures.set(nodeId, { id: nodeId, ...remeasured });
    const columns = [];
    for (const placed of appliedLayout.nodes) {
      if (!columns[placed.layer]) columns[placed.layer] = [];
      columns[placed.layer].push(placed.id);
    }
    const placed = new Map();
    let x = CARD.canvasPadding;
    for (const column of columns) {
      let y = CARD.canvasPadding;
      for (const id of column) {
        const measure = measures.get(id);
        const previous = appliedLayout.nodes.find(node => node.id === id);
        placed.set(id, { id, x, y, width: measure.width, height: measure.height, layer: previous.layer });
        y += measure.height + CARD.gap.row;
      }
      x += CARD.width + CARD.gap.column;
    }
    for (const edge of appliedLayout.edges) {
      const from = placed.get(edge.from);
      const to = placed.get(edge.to);
      edge.x1 = from.x + from.width; edge.y1 = from.y + from.height / 2;
      edge.x2 = to.x; edge.y2 = to.y + to.height / 2;
    }
    appliedLayout.nodes = [...placed.values()].sort((left, right) => left.id.localeCompare(right.id));
    appliedLayout.measures = [...measures.entries()].map(([id, measure]) => ({ ...measure }));
    appliedLayout.width = Math.max(480, ...[...placed.values()].map(node => node.x + node.width + CARD.canvasPadding));
    appliedLayout.height = Math.max(260, ...[...placed.values()].map(node => node.y + node.height + CARD.canvasPadding));
    viewRevision += 1; // any in-flight full reply is now stale and discards
    appliedRevision = viewRevision;
    lastApplyMs = performance.now() - started;
    renderGraph();
    renderList();
    updateStatus();
    callbacks.onLayoutApplied?.({ revision: appliedRevision, nodeCount: appliedLayout.nodes.length, ms: lastApplyMs });
    return true;
  }

  function setMode(nextMode) {
    root.dataset.mode = nextMode;
    currentMode = nextMode === 'list' ? 'list' : 'graph';
    const graphWrap = root.querySelector('.spike-graph-wrap');
    if (graphWrap) graphWrap.hidden = currentMode === 'list';
    renderList();
    for (const control of root.querySelectorAll('[data-mode]')) control.setAttribute('aria-pressed', String(control.dataset.mode === currentMode));
    callbacks.onModeChange?.({ mode: currentMode });
  }

  function showFixture(nextFixture) {
    currentFixture = structuredClone(nextFixture);
    collapsed = new Set(currentFixture.nodes.filter(node => node.collapsed).map(node => node.id));
    if (selectedId && !nodeById(selectedId)) selectedId = null;
    renderInspector();
    requestLayout();
  }

  function applyUpdate(nextFixture) {
    const priorGroups = new Set(currentFixture.nodes.filter(node => node.children?.length).map(node => node.id));
    const preserved = { selectedId, collapsed: [...collapsed], viewport: graphViewport.capture(), mode: currentMode };
    currentFixture = structuredClone(nextFixture);
    const available = new Set([...currentFixture.nodes.map(node => node.id), ...currentFixture.nodes.flatMap(node => (node.children ?? []).map(child => child.id))]);
    collapsed = new Set([...collapsed].filter(id => available.has(id)));
    for (const node of currentFixture.nodes) if (node.collapsed && !priorGroups.has(node.id)) collapsed.add(node.id);
    if (selectedId && !available.has(selectedId)) selectedId = null;
    renderInspector();
    requestLayout();
    return { selectedPreserved: preserved.selectedId == null || preserved.selectedId === selectedId,
      collapsed: [...collapsed].sort(), viewport: graphViewport.getState(), mode: currentMode };
  }

  function focusNode(nodeId) {
    const selector = currentMode === 'list' ? `.spike-row-control[data-node-id="${nodeId}"]` : `.spike-node[data-node-id="${nodeId}"]`;
    const target = root.querySelector(selector);
    if (target) { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); target.focus(); }
    return Boolean(target);
  }

  function moveFocusInList(currentId, delta) {
    const controls = [...root.querySelectorAll('.spike-row-control')];
    const index = controls.findIndex(control => control.dataset.nodeId === currentId);
    const next = controls[index + delta];
    if (next) { next.focus(); return next.dataset.nodeId; }
    return null;
  }

  root.addEventListener('keydown', event => {
    const key = event.key;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.target.classList?.contains('spike-toggle')) return;
    if (event.target === inspector) {
      if (key === 'Escape' || key === 'Enter') {
        event.preventDefault();
        if (selectedId) focusNode(selectedId);
      }
      return;
    }
    const nodeId = event.target.dataset?.nodeId;
    if (!nodeId) return;

    if (event.target.dataset.view === 'list') {
      // List equivalent: full keyboard traversal over the hierarchical rows.
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const moved = moveFocusInList(nodeId, key === 'ArrowDown' ? 1 : -1);
        if (moved) select(moved);
      } else if (key === 'ArrowRight') {
        const node = nodeById(nodeId);
        if (node?.children?.length && collapsed.has(nodeId)) { event.preventDefault(); toggleGroup(nodeId); }
      } else if (key === 'ArrowLeft') {
        const node = nodeById(nodeId);
        if (node?.children?.length && !collapsed.has(nodeId)) { event.preventDefault(); toggleGroup(nodeId); }
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault(); select(nodeId);
      } else if (key === 'Escape') {
        event.preventDefault();
        const node = nodeById(nodeId);
        if (node?.children?.length && !collapsed.has(nodeId)) toggleGroup(nodeId);
      }
      return;
    }

    if (!appliedLayout) return;
    const byId = new Map(appliedLayout.nodes.map(node => [node.id, node]));
    const current = byId.get(nodeId);
    if (!current) return;
    const columns = new Map();
    for (const node of appliedLayout.nodes) {
      if (!columns.has(node.layer)) columns.set(node.layer, []);
      columns.get(node.layer).push(node);
    }
    for (const column of columns.values()) column.sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
    const layers = [...columns.keys()].sort((left, right) => left - right);
    const layerIndex = layers.indexOf(current.layer);
    const nearest = (candidates, from) => candidates.reduce((best, candidate) => (!best || Math.abs(candidate.y - from.y) < Math.abs(best.y - from.y) ? candidate : best), null);
    let target = null;
    if (key === 'ArrowRight') target = layerIndex + 1 < layers.length ? nearest(columns.get(layers[layerIndex + 1]), current) : null;
    else if (key === 'ArrowLeft') target = layerIndex > 0 ? nearest(columns.get(layers[layerIndex - 1]), current) : null;
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      const column = columns.get(current.layer);
      const index = column.findIndex(node => node.id === nodeId);
      target = column[index + (key === 'ArrowDown' ? 1 : -1)] ?? null;
    } else if (key === 'Home') target = appliedLayout.nodes[0];
    else if (key === 'End') target = appliedLayout.nodes[appliedLayout.nodes.length - 1];
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); select(nodeId); return; }
    else if (key === 'Escape') {
      event.preventDefault();
      const node = nodeById(nodeId);
      if (node?.children?.length) toggleGroup(nodeId);
      else if (selectedId) focusNode(selectedId);
      return;
    }
    if (target) {
      event.preventDefault();
      focusNode(target.id);
    }
  });

  (function renderShell() {
    const head = element('header', 'spike-head stack');
    const crumbs = element('nav', 'cluster');
    crumbs.setAttribute('aria-label', 'Breadcrumb');
    const crumbLevel = element('span', 'meta spike-crumb-level', `Project / ${LEVEL_NAMES[currentFixture.level] ?? currentFixture.level}`);
    const crumbTitle = element('strong', 'spike-crumb-title', currentFixture.title);
    crumbs.append(crumbLevel, crumbTitle);
    head.append(crumbs, element('p', 'meta spike-subtitle', currentFixture.subtitle));
    root.dataset.docId = currentFixture.docId;
    if (currentFixture.plans && planProvider) {
      const switcher = element('div', 'cluster spike-plan-switcher');
      switcher.dataset.testid = 'spike-plan-switcher';
      switcher.append(element('span', 'meta', 'Plan'));
      for (const plan of currentFixture.plans) {
        const control = button(plan.label, () => showFixture(planProvider(plan.id)));
        control.dataset.planId = plan.id;
        control.setAttribute('aria-pressed', String(plan.id === currentFixture.viewId));
        switcher.append(control);
      }
      switcher.append(element('span', 'meta', 'Switching plans while a layout is pending discards the stale reply.'));
      head.append(switcher);
    }
    if (currentFixture.statusSentence) {
      const sentence = element('p', 'spike-sentence');
      sentence.dataset.testid = 'spike-status-sentence';
      sentence.append(element('span', 'meta', 'Status · '), document.createTextNode(`${currentFixture.statusSentence.text} `));
      for (const clause of currentFixture.statusSentence.clauses) {
        const link = button(clause.text, () => { select(clause.ref); focusNode(clause.ref); });
        link.className = 'spike-clause';
        link.dataset.ref = clause.ref;
        sentence.append(link, document.createTextNode(' '));
      }
      sentence.append(element('span', 'meta', 'Coverage: fixture data only; absence of a finding is not project health.'));
      head.append(sentence);
    }
    root.append(head, status);

    const toolbar = element('div', 'cluster spike-toolbar');
    const modeSwitcher = element('div', 'view-switcher cluster');
    modeSwitcher.dataset.nativeSegmented = 'true';
    modeSwitcher.setAttribute('role', 'group');
    modeSwitcher.setAttribute('aria-label', 'Presentation mode');
    for (const value of ['graph', 'list']) {
      const control = button(value === 'graph' ? 'Graph' : 'List', () => setMode(value));
      control.dataset.mode = value;
      control.setAttribute('aria-pressed', String(currentMode === value));
      modeSwitcher.append(control);
    }
    toolbar.append(modeSwitcher);
    const viewportControls = element('div', 'cluster spike-viewport-controls');
    viewportControls.setAttribute('role', 'group');
    viewportControls.setAttribute('aria-label', 'Graph zoom');
    for (const [label, action] of [
      ['Zoom out', () => graphViewport.zoomByAnimated(-0.25)],
      ['100%', () => graphViewport.setViewport({ scale: 1 }, 'actual-size')],
      ['Zoom in', () => graphViewport.zoomByAnimated(0.25)],
      ['Fit', () => graphViewport.fitAnimated()],
    ]) {
      const control = button(label, action);
      if (label === '100%') { control.dataset.zoomReadout = 'true'; control.setAttribute('aria-label', 'Reset zoom to 100%'); }
      viewportControls.append(control);
    }
    toolbar.append(viewportControls);
    const expand = button('Expand map', () => {
      if (expandedDialog) { closeExpandedMap(); return; }
      const dialog = element('dialog', 'spike-expanded-dialog');
      if (typeof dialog.showModal !== 'function') { status.textContent = 'Expanded map is unavailable in this browser. Pan and zoom remain available.'; return; }
      dialog.setAttribute('aria-label', 'Expanded macro map');
      const product = root.closest?.('[data-product]')?.dataset.product;
      if (product) dialog.dataset.product = product;
      homeMarker = document.createTextNode(''); root.parentNode.insertBefore(homeMarker, root);
      expandedDialog = dialog;
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeExpandedMap(); });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeExpandedMap(); }
      });
      dialog.addEventListener('close', () => { if (expandedDialog === dialog) closeExpandedMap(); });
      try {
        document.body.append(dialog); dialog.append(root); root.dataset.expanded = 'true';
        dialog.showModal(); expand.textContent = 'Exit expanded map'; expand.focus();
      } catch { closeExpandedMap(); status.textContent = 'The browser could not expand the map. Pan and zoom remain available.'; }
    });
    expandControl = expand;
    expand.dataset.expandMap = 'true';
    toolbar.append(expand);
    const searchLabel = element('label', 'spike-map-search', 'Find a node');
    const search = element('input', ''); search.type = 'search'; search.placeholder = 'Title or ID';
    const searchCount = element('span', 'meta'); searchCount.setAttribute('role', 'status');
    let matchIndex = -1;
    const matches = () => (appliedModel?.nodes ?? []).filter(node => `${node.title} ${node.id}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    const nextMatch = button('Next match', () => {
      const found = matches(); if (!search.value.trim() || !found.length) return;
      matchIndex = (matchIndex + 1) % found.length; select(found[matchIndex].id); focusNode(found[matchIndex].id);
    });
    refreshMapSearch = () => {
      const count = search.value.trim() ? matches().length : 0;
      nextMatch.disabled = !count; searchCount.textContent = search.value.trim() ? `${count} matching node${count === 1 ? '' : 's'}` : '';
    };
    search.addEventListener('input', () => { matchIndex = -1; refreshMapSearch(); });
    search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch.click(); } });
    searchLabel.append(search); toolbar.append(searchLabel, nextMatch, searchCount); refreshMapSearch();
    const gestureHint = element('p', 'meta spike-gesture-hint', 'Drag background to pan · scroll to explore · Shift-scroll sideways · Ctrl/⌘-scroll to zoom · arrows, +/− and 0 on the focused map');
    toolbar.append(gestureHint);
    toolbar.append(element('p', 'meta spike-expanded-hint', 'Select a node to return to its Details panel. Escape leaves the expanded map.'));
    const legend = element('ul', 'cluster spike-legend');
    legend.setAttribute('aria-label', 'Edge kinds');
    for (const [kind, label] of EDGE_LEGEND) {
      const item = element('li', `edge-${kind}`);
      item.append(element('span', 'meta', label));
      legend.append(item);
    }
    toolbar.append(legend);
    root.append(toolbar);

    const body = element('div', 'spike-body stack');
    body.dataset.testid = 'spike-body';
    root.append(body, inspector);
  })();

  renderInspector();
  requestLayout();

  return {
    element: root,
    select,
    focusNode,
    showFixture,
    applyUpdate,
    closeExpandedMap,
    renameNode,
    toggleGroup,
    setMode,
    setViewport: (viewport, reason) => graphViewport.setViewport(viewport, reason),
    fitViewport: () => graphViewport.fit(),
    getStats() {
      return {
        viewRevision, appliedRevision, pendingCount, discardedCount: discarded.length, discarded: structuredClone(discarded),
        nodeCount: appliedLayout?.nodes.length ?? 0, edgeCount: appliedLayout?.edges.length ?? 0,
        layoutWidth: appliedLayout?.width ?? 0, layoutHeight: appliedLayout?.height ?? 0,
        lastApplyMs, mode: currentMode, selectedId, collapsed: [...collapsed].sort(),
        docId: currentFixture.docId, layoutError: layoutError?.code ?? null, viewport: graphViewport.getState(),
      };
    },
    getFixture() { return structuredClone(currentFixture); },
  };
}
