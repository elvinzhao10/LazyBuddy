// T16 execution view — DOM view over the T16 execution document and timeline models.
// The planned dependency DAG and the actual run timeline render as SEPARATE panes
// sharing identity (attempt/task ids), never as one picture. Layout comes from the
// existing engine via the T03 presentation model. Polling updates (applyUpdate)
// re-render while preserving breadcrumbs, selection, collapsed groups and viewport.
import { button, element, statusChip } from './components.mjs';
import { createGraphViewportController } from './graph-viewport.mjs';
import { listModel, measureNodeCard, presentationModel, layoutProjectGraph, SpikePresentationError } from './project-presentation.mjs';
import { intervalGeometry, timelineAxis } from './timeline-model.mjs';

const LEVEL_NAMES = { plan: 'Plan', batch: 'Batch', task: 'Task' };
const EDGE_LEGEND = [
  ['dependency', 'Dependency · declared prerequisite condition'],
  ['gate', 'Verification gate · independent verification consumes results'],
  ['history', 'Retry history · new attempt, never a plan-DAG cycle'],
];
const ROLE_LABELS = { worker: 'Worker', verifier: 'Verifier', mixed: 'Mixed roles', unreported: 'Role unreported' };
const INTERVAL_STATES = new Set(['finished', 'failed', 'cancelled', 'stale', 'waiting', 'executing', 'blocked']);
const DEFAULT_PRESENTATION = Object.freeze({
  graphLabel: 'Planned dependency DAG',
  graphDescription: 'Planned dependencies from the accepted plan graph.',
  timelineLabel: 'Actual run timeline',
  timelineDescription: 'Real concurrent intervals on one shared time axis, from recorded attempt observations. Drawn separately from the planned DAG above.',
  laneLabel: null,
  durationLabel: 'recorded-session-duration',
});

function presentationOf(document_) {
  const value = (name, fallback) => typeof document_?.[name] === 'string' && document_[name].trim()
    ? document_[name].trim() : fallback;
  return {
    graphLabel: value('graphLabel', DEFAULT_PRESENTATION.graphLabel),
    graphDescription: value('graphDescription', DEFAULT_PRESENTATION.graphDescription),
    timelineLabel: value('timelineLabel', DEFAULT_PRESENTATION.timelineLabel),
    timelineDescription: value('timelineDescription', DEFAULT_PRESENTATION.timelineDescription),
    laneLabel: value('laneLabel', DEFAULT_PRESENTATION.laneLabel),
    durationLabel: value('durationLabel', DEFAULT_PRESENTATION.durationLabel),
  };
}

function levelName(document_, level) {
  const custom = document_?.levelLabels?.[level];
  return typeof custom === 'string' && custom.trim() ? custom.trim() : LEVEL_NAMES[level] ?? level;
}

function intervalChipState(state) {
  if (state === 'finished') return 'neutral';
  if (state === 'failed' || state === 'cancelled') return 'failed';
  if (state === 'stale') return 'stale';
  if (state === 'blocked') return 'attention';
  return 'active';
}

function nodeCard(node, state) {
  const measure = state.measures.get(node.id) ?? measureNodeCard(node);
  const card = element('div', `execution-node kind-${node.kind}`);
  card.dataset.nodeId = node.id;
  card.dataset.kind = node.kind;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-pressed', String(state.selectedId === node.id));
  card.setAttribute('aria-label', `${node.kind} ${node.id}: ${measure.fullTitle}`);
  card.title = measure.truncated ? measure.fullTitle : '';
  card.addEventListener('click', event => {
    if (event.target !== card && event.target.tagName === 'BUTTON') return;
    state.onSelect(node.id);
  });
  const identity = element('span', 'execution-identity');
  identity.append(element('code', '', node.id));
  card.append(identity);
  const title = element('span', 'execution-title', measure.titleLines.join(' '));
  if (measure.truncated) title.dataset.truncated = 'true';
  card.append(title);
  for (const [kind, value] of [['Execution', node.execution], ['Verification', node.verification]]) {
    const row = element('span', 'cluster execution-chiprow');
    row.append(element('span', 'meta', kind), statusChip(value));
    card.append(row);
  }
  const summary = element('span', 'meta execution-summary', measure.summaryLines.join(' '));
  if (measure.summaryTruncated) {
    summary.dataset.truncated = 'true';
    summary.title = measure.fullSummary;
  }
  card.append(summary);
  if (node.expandable) {
    const toggle = button(node.collapsedGroup ? 'Expand checks' : 'Collapse checks', () => state.onToggle(node.id));
    toggle.className = 'execution-toggle';
    toggle.setAttribute('aria-expanded', String(!node.collapsedGroup));
    card.append(toggle);
  }
  return card;
}

function listRow(row, state) {
  const item = element('li', `execution-row kind-${row.kind}`);
  item.dataset.nodeId = row.id;
  item.setAttribute('aria-level', String(row.depth + 1));
  const control = button(row.fullLabel, () => state.onSelect(row.id));
  control.dataset.nodeId = row.id;
  control.dataset.view = 'list';
  control.className = 'execution-row-control';
  control.setAttribute('aria-pressed', String(state.selectedId === row.id));
  const chips = element('span', 'cluster');
  chips.append(statusChip(row.execution), statusChip(row.verification));
  item.append(control, chips, element('span', 'meta execution-summary', `${row.summary} · ${row.meta ?? ''}`));
  if (row.expandable) {
    const toggle = button(row.collapsedGroup ? 'Expand group' : 'Collapse group', () => state.onToggle(row.id));
    toggle.className = 'execution-toggle';
    toggle.setAttribute('aria-expanded', String(!row.collapsedGroup));
    item.append(toggle);
  }
  return item;
}

function edgePath(edge) {
  const bend = Math.max(32, (edge.x2 - edge.x1) / 2);
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`;
}

function renderTimeline(model, state, presentation) {
  const pane = element('section', 'panel execution-timeline-panel stack');
  pane.dataset.testid = 'execution-timeline';
  const head = element('header', 'stack');
  head.append(element('h3', 'execution-timeline-heading', presentation.timelineLabel));
  head.append(element('p', 'meta', presentation.timelineDescription));
  pane.append(head);
  const viewport = element('div', 'execution-timeline-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', `${presentation.timelineLabel} by ${presentation.laneLabel ?? 'agent'}`);
  const geometry = intervalGeometry(model);
  const axisRow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  axisRow.classList.add('execution-axis');
  axisRow.setAttribute('width', '100%');
  axisRow.setAttribute('height', '24');
  axisRow.setAttribute('role', 'none');
  const ticks = timelineAxis(model);
  ticks.forEach((tick, index) => {
    const mark = document.createElementNS(axisRow.namespaceURI, 'text');
    mark.classList.add('execution-axis-tick');
    mark.setAttribute('x', `${tick.percent.toFixed(3)}%`);
    mark.setAttribute('y', '15');
    mark.setAttribute('text-anchor', index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle');
    mark.textContent = tick.label;
    axisRow.append(mark);
  });
  viewport.append(axisRow);
  const laneList = element('ol', 'execution-lanes');
  for (const lane of model.lanes) {
    const item = element('li', 'execution-lane');
    item.dataset.agentId = lane.agentId;
    item.dataset.role = lane.role;
    const label = element('span', 'execution-lane-label');
    label.append(element('span', 'meta', `${presentation.laneLabel ?? ROLE_LABELS[lane.role] ?? lane.role} · ${lane.agentId}`));
    const track = document.createElementNS(axisRow.namespaceURI, 'svg');
    track.classList.add('execution-track');
    track.setAttribute('width', '100%');
    track.setAttribute('height', '48');
    for (const interval of model.intervals.filter(entry => entry.lane === lane.lane)) {
      if (!INTERVAL_STATES.has(interval.state)) continue;
      const position = geometry.get(interval.attemptId);
      const bar = document.createElementNS(track.namespaceURI, 'foreignObject');
      bar.classList.add('execution-interval', `state-${interval.state}`);
      bar.dataset.attemptId = interval.attemptId;
      bar.dataset.agentId = interval.agentId;
      bar.dataset.role = interval.role;
      bar.dataset.taskId = interval.taskId ?? '';
      bar.dataset.state = interval.state;
      bar.dataset.lane = String(interval.lane);
      bar.dataset.startMs = String(interval.startMs);
      bar.dataset.endMs = interval.open ? '' : String(interval.endMs);
      if (interval.open) bar.dataset.open = 'true';
      if (interval.resumesAttemptId) bar.dataset.resumes = interval.resumesAttemptId;
      bar.setAttribute('x', `${position.leftPercent.toFixed(3)}%`);
      bar.setAttribute('y', '8');
      bar.setAttribute('width', `${position.widthPercent.toFixed(3)}%`);
      bar.setAttribute('height', '32');
      bar.setAttribute('role', 'button');
      bar.setAttribute('focusable', 'true');
      bar.setAttribute('aria-label', `${interval.attemptId} · ${interval.state}${interval.open ? ' · open interval, no terminal record' : ''}`);
      bar.tabIndex = 0;
      bar.addEventListener('click', () => state.onSelect(interval.attemptId));
      const title = document.createElementNS(track.namespaceURI, 'title');
      title.textContent = `${interval.attemptId} · ${interval.state}${interval.open ? ' · open interval, no terminal record' : ''}`;
      const body = element('div', 'execution-interval-body');
      body.append(element('span', 'execution-interval-label',
        `${interval.attemptId} · ${interval.state}${interval.resumesAttemptId ? ` · resumes ${interval.resumesAttemptId}` : ''}`));
      bar.append(title, body);
      track.append(bar);
    }
    item.append(label, track);
    laneList.append(item);
  }
  viewport.append(laneList);
  pane.append(viewport);
  const notes = element('ul', 'execution-notes');
  notes.append(element('li', 'meta',
    `${model.lanes.length} ${presentation.laneLabel ?? 'agent'} lane${model.lanes.length === 1 ? '' : 's'} · ${model.peakConcurrency} concurrent attempt${model.peakConcurrency === 1 ? '' : 's'} at peak · durations are ${presentation.durationLabel}`));
  for (const overlap of model.overlaps) {
    notes.append(element('li', 'meta',
      `concurrent: ${overlap.a} and ${overlap.b} overlapped ${Math.round(overlap.ms)}ms ${overlap.laneA === overlap.laneB ? 'on the same reported worker lane' : 'on different reported worker lanes'}`));
  }
  for (const chain of model.retryChains) {
    notes.append(element('li', 'meta',
      `retry: ${chain.from} interrupted, ${chain.to} is a new attempt on the same lane — ${presentation.graphLabel === DEFAULT_PRESENTATION.graphLabel ? 'the plan DAG' : presentation.graphLabel} gains no cycle`));
  }
  const stale = model.intervals.filter(interval => interval.state === 'stale');
  for (const interval of stale) {
    notes.append(element('li', 'meta',
      `stale: ${interval.attemptId} has no terminal record; it renders stale up to the observation time, never running`));
  }
  pane.append(notes);
  return pane;
}

function renderGraph(document_, state, viewport, presentation) {
  const model = presentationModel(document_, { collapsed: state.collapsed });
  const layout = layoutProjectGraph(model);
  const wrap = element('div', 'execution-graph-wrap');
  const head = element('header', 'stack');
  head.append(element('h3', 'execution-graph-heading', presentation.graphLabel), element('p', 'meta', presentation.graphDescription));
  const region = element('div', 'execution-graph-viewport');
  region.tabIndex = 0;
  region.setAttribute('aria-label', presentation.graphLabel);
  region.dataset.testid = 'execution-dag';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('execution-graph');
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  const edgeLayer = document.createElementNS(svg.namespaceURI, 'g');
  for (const edge of layout.edges) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.dataset.edgeId = edge.id;
    path.dataset.kind = edge.kind;
    path.setAttribute('d', edgePath(edge));
    path.setAttribute('aria-label', `${edge.kind} edge: ${edge.label}`);
    edgeLayer.append(path);
  }
  const nodeLayer = document.createElementNS(svg.namespaceURI, 'g');
  const cardState = {
    selectedId: state.selectedId,
    measures: new Map(layout.measures.map(measure => [measure.id, measure])),
    onToggle: state.onToggle, onSelect: state.onSelect,
  };
  for (const placed of layout.nodes) {
    const node = model.byId.get(placed.id);
    const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject');
    foreign.dataset.nodeId = placed.id;
    foreign.setAttribute('x', placed.x); foreign.setAttribute('y', placed.y);
    foreign.setAttribute('width', placed.width); foreign.setAttribute('height', placed.height);
    foreign.append(nodeCard(node, cardState));
    nodeLayer.append(foreign);
  }
  svg.append(edgeLayer, nodeLayer);
  region.append(svg);
  wrap.append(head, viewport.controls(), region);
  viewport.bind(region, svg, layout.width, layout.height);
  return { wrap, region, layout, model };
}

export function createExecutionView({ document: initialDocument, timeline: initialTimeline, mode = 'graph', callbacks = {} }) {
  let currentDocument = structuredClone(initialDocument);
  let currentTimeline = structuredClone(initialTimeline);
  let collapsed = new Set(currentDocument.nodes.filter(node => node.collapsed).map(node => node.id));
  let selectedId = null;
  let currentMode = mode === 'list' ? 'list' : 'graph';
  let viewRevision = 0;
  let lastUpdate = null;

  const root = element('section', 'execution-view stack');
  root.dataset.testid = 'execution-view';
  root.dataset.level = currentDocument.level;
  root.dataset.docId = currentDocument.docId;

  const status = element('p', 'meta execution-status', 'Execution view ready.');
  status.dataset.testid = 'execution-status';
  status.setAttribute('role', 'status');

  const inspector = element('aside', 'panel execution-inspector stack');
  inspector.dataset.testid = 'execution-inspector';
  inspector.tabIndex = 0;
  inspector.setAttribute('role', 'region');
  inspector.setAttribute('aria-label', 'Contextual inspector');
  const graphViewport = createGraphViewportController({
    label: 'Execution graph',
    getRegion: () => root.querySelector('.execution-graph-viewport'),
    getSvg: () => root.querySelector('.execution-graph'),
    onChange: event => callbacks.onViewportChange?.(event),
  });
  let timelineScroll = { scrollLeft: 0, scrollTop: 0 };

  function nodeById(id) {
    if (currentDocument.nodes.some(node => node.id === id)) return currentDocument.nodes.find(node => node.id === id);
    return currentDocument.nodes.flatMap(node => node.children ?? []).find(child => child.id === id) ?? null;
  }

  function renderShell() {
    const head = element('header', 'execution-head stack');
    const crumbs = element('nav', 'cluster');
    crumbs.dataset.testid = 'execution-breadcrumbs';
    crumbs.setAttribute('aria-label', 'Breadcrumb');
    crumbs.append(element('span', 'meta', 'Execution'));
    currentDocument.breadcrumbs?.forEach((crumb, index) => {
      crumbs.append(element('span', 'meta', '/'));
      const control = button(`${levelName(currentDocument, crumb.level)}: ${crumb.label}`, () => {
        callbacks.onNavigate?.({ level: crumb.level, focusId: crumb.label });
      });
      control.dataset.crumbLevel = crumb.level;
      control.dataset.crumbLabel = crumb.label;
      control.setAttribute('aria-current', index === currentDocument.breadcrumbs.length - 1 ? 'page' : 'false');
      crumbs.append(control);
    });
    head.append(crumbs, element('h2', '', currentDocument.title), element('p', 'meta execution-subtitle', currentDocument.subtitle));
    if (currentDocument.statusSentence) {
      const sentence = element('p', 'execution-sentence');
      sentence.dataset.testid = 'execution-status-sentence';
      sentence.append(element('span', 'meta', 'Status · '), document.createTextNode(`${currentDocument.statusSentence.text} `));
      for (const clause of currentDocument.statusSentence.clauses) {
        const link = button(clause.text, () => { select(clause.ref); focusNode(clause.ref); });
        link.className = 'execution-clause';
        link.dataset.ref = clause.ref;
        sentence.append(link, document.createTextNode(' '));
      }
      sentence.append(element('span', 'meta', 'Coverage: recorded observations only; absence of a finding is not project health.'));
      head.append(sentence);
    }
    const toolbar = element('div', 'cluster execution-toolbar');
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
    const legend = element('ul', 'cluster execution-legend');
    legend.setAttribute('aria-label', 'Edge kinds');
    for (const [kind, label] of EDGE_LEGEND) {
      const item = element('li', `edge-${kind}`);
      item.append(element('span', 'meta', label));
      legend.append(item);
    }
    toolbar.append(legend);
    const presentation = presentationOf(currentDocument);
    const dagLegend = element('p', 'meta execution-pane-legend',
      `Pane 1 — ${presentation.graphLabel}: ${presentation.graphDescription} Pane 2 — ${presentation.timelineLabel}: ${presentation.timelineDescription}`);
    head.append(toolbar, dagLegend);
    const body = element('div', 'execution-body stack');
    body.dataset.testid = 'execution-body';
    root.replaceChildren(head, status, body, inspector);
  }

  function renderBody() {
    const body = root.querySelector('.execution-body');
    const previousGraph = body.querySelector('.execution-graph-viewport');
    const previousTimeline = body.querySelector('.execution-timeline-viewport');
    const focusedId = previousGraph?.contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
    graphViewport.capture();
    if (previousTimeline) timelineScroll = { scrollLeft: previousTimeline.scrollLeft ?? timelineScroll.scrollLeft,
      scrollTop: previousTimeline.scrollTop ?? timelineScroll.scrollTop };
    body.replaceChildren();
    const state = { selectedId, collapsed, onToggle: toggleGroup, onSelect: select };
    const presentation = presentationOf(currentDocument);
    const { wrap, region } = renderGraph(currentDocument, state, graphViewport, presentation);
    wrap.hidden = currentMode === 'list';
    body.append(wrap);
    const list = element('ol', 'execution-list');
    list.dataset.testid = 'execution-list';
    for (const row of listModel(currentDocument, { collapsed }).rows) list.append(listRow(row, state));
    list.hidden = currentMode !== 'list';
    body.append(list);
    body.append(renderTimeline(currentTimeline, state, presentation));
    const currentViewport = graphViewport.getState();
    root.dataset.viewport = `${currentViewport.scrollLeft},${currentViewport.scrollTop},${currentViewport.scale}`;
    const nextTimelineViewport = body.querySelector('.execution-timeline-viewport');
    if (nextTimelineViewport) {
      nextTimelineViewport.scrollLeft = timelineScroll.scrollLeft;
      nextTimelineViewport.scrollTop = timelineScroll.scrollTop;
      root.dataset.timelineViewport = `${timelineScroll.scrollLeft},${timelineScroll.scrollTop}`;
    }
    if (focusedId) region.querySelector(`.execution-node[data-node-id="${focusedId}"]`)?.focus();
    root.dataset.level = currentDocument.level;
    root.dataset.docId = currentDocument.docId;
    root.dataset.viewId = currentDocument.viewId;
    const visibleLevel = currentDocument.levelLabels ? levelName(currentDocument, currentDocument.level) : currentDocument.level;
    status.textContent = `${currentDocument.nodes.length} nodes · level ${visibleLevel}${currentDocument.focusId ? ` · focus ${currentDocument.focusId}` : ''} · view revision ${viewRevision}${currentDocument.ignoredObservations?.length ? ` · ${currentDocument.ignoredObservations.length} unsupported observations unrendered` : ''}`;
  }

  function select(nodeId) {
    selectedId = nodeId;
    for (const node of root.querySelectorAll('.execution-node, .execution-row-control')) {
      node.setAttribute('aria-pressed', String(node.dataset.nodeId === nodeId));
    }
    renderInspector();
    callbacks.onSelect?.({ nodeId });
  }

  function toggleGroup(nodeId) {
    if (collapsed.has(nodeId)) collapsed.delete(nodeId); else collapsed.add(nodeId);
    viewRevision += 1;
    renderBody();
    callbacks.onGroupToggle?.({ nodeId, collapsed: collapsed.has(nodeId) });
  }

  function renderInspector() {
    const node = selectedId ? nodeById(selectedId) : null;
    inspector.replaceChildren();
    inspector.append(element('h3', '', 'Inspector'));
    if (!node) {
      inspector.append(element('p', 'meta', 'Select a node or timeline interval to inspect its summary, source, changes and evidence.'));
      return;
    }
    inspector.append(element('code', '', node.id), element('p', '', node.title));
    const inspectorSource = typeof currentDocument.inspectorSource === 'string' && currentDocument.inspectorSource.trim()
      ? currentDocument.inspectorSource.trim() : `Accepted plan ${currentDocument.docId} · recorded observations only`;
    const sections = [
      ['Summary', node.summary ?? 'No summary recorded.'],
      ['Source', inspectorSource],
      ['Changes', 'None · this view has no editing authority; the shared command route owns changes.'],
      ['Evidence', `${node.meta ?? 'No evidence recorded.'} · worker artifacts and verifier receipts keep separate identities.`],
    ];
    for (const [heading, text] of sections) {
      const section = element('section', 'stack');
      section.append(element('h4', '', heading), element('p', '', text));
      inspector.append(section);
    }
    const edgesSection = element('section', 'stack');
    edgesSection.append(element('h4', '', 'Edges'));
    const relevant = currentDocument.edges.filter(edge => edge.from === node.id || edge.to === node.id);
    if (!relevant.length) edgesSection.append(element('p', 'meta', 'No declared edges involve this node.'));
    for (const edge of relevant) edgesSection.append(element('p', 'meta', `${edge.from} → ${edge.to} · ${edge.kind} · ${edge.label}`));
    inspector.append(edgesSection);
    const attempt = currentTimeline.intervals.find(interval => interval.attemptId === selectedId) ?? null;
    if (attempt) {
      const timelineSection = element('section', 'stack');
      timelineSection.append(element('h4', '', 'Timeline interval'));
      timelineSection.append(element('p', 'meta',
        `${attempt.agentId} · lane ${attempt.lane} · ${new Date(attempt.startMs).toISOString()} → ${attempt.endMs == null ? 'open (no terminal record)' : new Date(attempt.endMs).toISOString()} · state ${attempt.state}`));
      inspector.append(timelineSection);
    }
    if (node.drill) {
      const drill = button(`Drill into ${node.drill}`, () => callbacks.onDrill?.({ nodeId: node.id, level: nextLevelDown(), focusId: node.drill }));
      drill.dataset.testid = 'execution-drill';
      inspector.append(drill);
    } else {
      const wrap = element('div', 'stack');
      const control = button('Drill into this object', null, { disabled: true });
      control.className = 'execution-action';
      const why = element('p', 'meta execution-reason', 'No deeper level is defined for this object.');
      why.id = 'reason-drill';
      control.setAttribute('aria-describedby', why.id);
      wrap.append(control, why);
      inspector.append(wrap);
    }
  }

  function nextLevelDown() {
    return currentDocument.level === 'plan' ? 'batch' : currentDocument.level === 'batch' ? 'task' : null;
  }

  function setMode(nextMode) {
    currentMode = nextMode === 'list' ? 'list' : 'graph';
    renderBody();
    for (const control of root.querySelectorAll('[data-mode]')) control.setAttribute('aria-pressed', String(control.dataset.mode === currentMode));
    callbacks.onModeChange?.({ mode: currentMode });
  }

  /** Simulated polling tick: re-render from the next document/timeline while
   *  preserving breadcrumbs, selection, collapsed groups and viewport. */
  function applyUpdate(nextDocument, nextTimeline) {
    graphViewport.capture();
    const liveTimeline = root.querySelector('.execution-timeline-viewport');
    if (liveTimeline) timelineScroll = { scrollLeft: liveTimeline.scrollLeft ?? timelineScroll.scrollLeft,
      scrollTop: liveTimeline.scrollTop ?? timelineScroll.scrollTop };
    const preserved = {
      level: currentDocument.level, focusId: currentDocument.focusId ?? null,
      selectedId, collapsed: [...collapsed].sort(), mode: currentMode,
      viewport: graphViewport.getState(), timelineViewport: { ...timelineScroll },
    };
    currentDocument = structuredClone(nextDocument);
    currentTimeline = structuredClone(nextTimeline);
    collapsed = new Set([...collapsed].filter(id => currentDocument.nodes.some(node => node.id === id)
      || currentDocument.nodes.some(node => node.children?.some(child => child.id === id))));
    if (selectedId && !nodeById(selectedId)) selectedId = null;
    viewRevision += 1;
    renderShell();
    renderBody();
    renderInspector();
    lastUpdate = { ...preserved, selectedPreserved: preserved.selectedId == null || preserved.selectedId === selectedId,
      viewRevision, nodeCount: currentDocument.nodes.length };
    callbacks.onUpdate?.(structuredClone(lastUpdate));
    return structuredClone(lastUpdate);
  }

  function focusNode(nodeId) {
    const selector = currentMode === 'list' ? `.execution-row-control[data-node-id="${nodeId}"]` : `.execution-node[data-node-id="${nodeId}"]`;
    const target = root.querySelector(selector) ?? root.querySelector(`.execution-interval[data-attempt-id="${nodeId}"]`);
    if (target) target.focus();
    return Boolean(target);
  }

  function moveFocusInList(currentId, delta) {
    const controls = [...root.querySelectorAll('.execution-row-control')];
    const index = controls.findIndex(control => control.dataset.nodeId === currentId);
    const next = controls[index + delta];
    if (next) { next.focus(); return next.dataset.nodeId; }
    return null;
  }

  root.addEventListener('keydown', event => {
    const key = event.key;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.target.classList?.contains('execution-toggle')) return;
    if (event.target === inspector) {
      if (key === 'Escape' || key === 'Enter') {
        event.preventDefault();
        if (selectedId) focusNode(selectedId);
      }
      return;
    }
    const attemptId = event.target.dataset?.attemptId;
    if (attemptId) {
      if (key === 'Enter' || key === ' ') { event.preventDefault(); select(attemptId); }
      return;
    }
    const nodeId = event.target.dataset?.nodeId;
    if (!nodeId) return;
    if (event.target.dataset.view === 'list') {
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
      }
      return;
    }
    if (event.target.classList?.contains('execution-node')) {
      if (key === 'Enter' || key === ' ') { event.preventDefault(); select(nodeId); return; }
      if (key === 'Escape') {
        event.preventDefault();
        const node = nodeById(nodeId);
        if (node?.children?.length) toggleGroup(nodeId);
        else if (selectedId) focusNode(selectedId);
        return;
      }
      const layout = root.querySelector('.execution-graph');
      if (!layout) return;
      const cards = [...root.querySelectorAll('.execution-node')];
      const index = cards.findIndex(card => card.dataset.nodeId === nodeId);
      const columns = new Map();
      for (const card of cards) {
        const foreign = card.parentNode;
        const layer = Number(foreign.getAttribute('x'));
        if (!columns.has(layer)) columns.set(layer, []);
        columns.get(layer).push(card);
      }
      const layers = [...columns.keys()].sort((left, right) => left - right);
      const currentLayer = Number(event.target.parentNode.getAttribute('x'));
      const layerIndex = layers.indexOf(currentLayer);
      const column = columns.get(currentLayer) ?? [];
      const columnIndex = column.indexOf(event.target);
      let target = null;
      if (key === 'ArrowRight' && layerIndex + 1 < layers.length) target = columns.get(layers[layerIndex + 1])[0];
      else if (key === 'ArrowLeft' && layerIndex > 0) target = columns.get(layers[layerIndex - 1])[0];
      else if (key === 'ArrowDown') target = column[columnIndex + 1] ?? null;
      else if (key === 'ArrowUp') target = column[columnIndex - 1] ?? null;
      else if (key === 'Home') target = cards[0];
      else if (key === 'End') target = cards[cards.length - 1];
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  });

  renderShell();
  renderBody();
  renderInspector();

  return {
    element: root,
    select,
    focusNode,
    toggleGroup,
    setMode,
    applyUpdate,
    setViewport: (viewport, reason) => graphViewport.setViewport(viewport, reason),
    fitViewport: () => graphViewport.fit(),
    getStats() {
      return {
        viewRevision, mode: currentMode, selectedId, collapsed: [...collapsed].sort(),
        level: currentDocument.level, focusId: currentDocument.focusId ?? null,
        docId: currentDocument.docId, viewId: currentDocument.viewId,
        nodeCount: currentDocument.nodes.length, edgeCount: currentDocument.edges.length,
        lastUpdate, viewport: graphViewport.getState(), timelineViewport: root.dataset.timelineViewport ?? null,
      };
    },
    getDocument() { return structuredClone(currentDocument); },
  };
}

export { SpikePresentationError };
