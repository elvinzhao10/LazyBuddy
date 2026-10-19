// T16 execution view — DOM view over the T16 execution document and timeline models.
// The planned dependency DAG and the actual run timeline render as SEPARATE panes
// sharing identity (attempt/task ids), never as one picture. Layout comes from the
// existing engine via the T03 presentation model. Polling updates (applyUpdate)
// re-render while preserving breadcrumbs, selection, collapsed groups and viewport.
// T16 redesign: node cards carry a glance state (running/blocked/verified/stale
// read from border and elevation before any text), the timeline is an
// overlap-honest swimlane (same-lane overlaps stack into sublanes, retries link
// inline, blocked fan-in joins get an explicit affordance), attempt and verifier
// drill-down opens in the dock with expandable steps, and the graph/list switch
// is a T11 segmented control over one equivalent node set.
import { assignSublanes, button, createDockPanel, element, emptyState, segmentedControl, statusChip } from './components.mjs';
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

// Glance state: one library status role per node card, derived from the
// execution/verification chips with a fixed precedence — running first, then
// blocked, failure, staleness, verification, absence. The card's border and
// elevation follow it (the T12 graph-node state treatments), so running,
// blocked, verified and stale are distinct before any text is read.
export function nodeGlanceState(node) {
  const execution = node?.execution?.state;
  const verification = node?.verification?.state;
  if (execution === 'active') return 'active';
  if (execution === 'attention') return 'attention';
  if (execution === 'failed') return 'failed';
  if (execution === 'stale' || verification === 'stale') return 'stale';
  if (verification === 'attention') return 'attention';
  if (verification === 'verified') return 'verified';
  if (execution === 'unavailable') return 'unavailable';
  return 'neutral';
}

// A collapsed group keeps its gate truth at a glance: pending and stale checks
// render as badges on the collapsed card instead of disappearing inside it.
export function collapsedGateBadges(children) {
  if (!children?.length) return [];
  const pending = children.filter(child => ['attention', 'active', 'unavailable'].includes(child.verification?.state)).length;
  const stale = children.filter(child => child.verification?.state === 'stale').length;
  const confirmed = children.filter(child => child.verification?.state === 'verified').length;
  const badges = [];
  if (pending) badges.push(statusChip({ state: 'attention', label: `${pending} pending` }));
  if (stale) badges.push(statusChip({ state: 'stale', label: `${stale} stale` }));
  if (!pending && !stale) badges.push(statusChip({ state: confirmed ? 'verified' : 'neutral', label: `${confirmed || children.length} confirmed` }));
  return badges;
}

function appendBadges(host, children) {
  const badges = collapsedGateBadges(children);
  if (!badges.length) return;
  const wrap = element('span', 'execution-badges');
  for (const badge of badges) wrap.append(badge);
  host.append(wrap);
}

function nodeCard(node, state) {
  const measure = state.measures.get(node.id) ?? measureNodeCard(node);
  const card = element('div', `execution-node kind-${node.kind}`);
  card.dataset.nodeId = node.id;
  card.dataset.kind = node.kind;
  card.dataset.state = nodeGlanceState(node);
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-pressed', String(state.selectedId === node.id));
  card.setAttribute('aria-label', `${node.kind} ${node.id}: ${measure.fullTitle}`);
  card.title = measure.fullTitle; // the full label stays reachable when the title truncates
  card.addEventListener('click', event => {
    if (event.target !== card && event.target.tagName === 'BUTTON') return;
    state.onSelect(node.id);
  });
  const identity = element('span', 'execution-identity');
  identity.append(element('code', '', node.id));
  if (node.collapsedGroup) appendBadges(identity, state.childrenOf?.(node.id) ?? []);
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
  item.dataset.state = nodeGlanceState(row);
  item.setAttribute('aria-level', String(row.depth + 1));
  const control = button(row.fullLabel, () => state.onSelect(row.id));
  control.dataset.nodeId = row.id;
  control.dataset.view = 'list';
  control.className = 'execution-row-control';
  control.setAttribute('aria-pressed', String(state.selectedId === row.id));
  const chips = element('span', 'cluster');
  chips.append(statusChip(row.execution), statusChip(row.verification));
  if (row.collapsedGroup) appendBadges(chips, state.childrenOf?.(row.id) ?? []);
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

// Swimlane row geometry: one bar height, one 8-pt pitch between stacked rows,
// one bar-height inset top and bottom so tracks never clip a focus ring.
const TRACK = Object.freeze({ inset: 8, bar: 32, pitch: 40 });
const trackHeight = rows => TRACK.inset + (rows - 1) * TRACK.pitch + TRACK.bar + TRACK.inset;
const trackCenter = row => TRACK.inset + row * TRACK.pitch + TRACK.bar / 2;

// Overlap-honest stacking (the T12 assignSublanes primitive): intervals of one
// agent lane that overlap in real wall-clock time occupy separate sublane rows,
// so no bar ever paints over another — the overlap stays visible as structure.
function sublanesFor(laneIntervals) {
  const laid = assignSublanes(laneIntervals.map(interval => ({
    start: interval.startMs, end: interval.renderedEndMs, label: interval.attemptId, state: interval.state,
  })));
  return { byAttempt: new Map(laid.intervals.map(item => [item.label, item.lane])), rows: laid.lanes };
}

// Explicit blocked-join affordance at fan-in: the join gates of the planned DAG
// that are still blocked render as their own strip under the lanes, naming the
// branches they wait on. Plan truth, clearly separated from recorded time.
function renderJoinStrip(document_, state) {
  const joins = document_.nodes.filter(node => node.kind === 'join' && node.execution?.state === 'attention');
  if (!joins.length) return null;
  const strip = element('div', 'execution-join-strip stack');
  strip.dataset.testid = 'execution-joins';
  strip.append(element('h4', '', 'Fan-in gates'));
  strip.append(element('p', 'meta',
    'Blocked joins from the planned dependency DAG, not from recorded time. A blocked join is still waiting on branch verification.'));
  for (const join of joins) {
    const branches = document_.edges.filter(edge => edge.to === join.id).map(edge => ({
      from: edge.from,
      status: /: confirmed$/.test(edge.label) ? 'confirmed' : /: stale$/.test(edge.label) ? 'stale' : 'pending',
    }));
    const waiting = branches.filter(branch => branch.status !== 'confirmed');
    const row = element('div', 'execution-join-row');
    row.dataset.joinId = join.id;
    row.append(statusChip({ state: 'attention', label: 'Blocked join' }));
    row.append(element('span', 'meta execution-join-text', waiting.length
      ? `${join.id} waits on ${waiting.map(branch => `${branch.from} (${branch.status})`).join(' · ')}`
      : `${join.id} is blocked; no branch is confirmed yet`));
    const show = button('Show join', () => { state.onSelect(join.id); state.focus?.(join.id); });
    show.dataset.action = 'show-join';
    show.setAttribute('aria-label', `Show join ${join.id} in the dependency DAG`);
    row.append(show);
    strip.append(row);
  }
  return strip;
}

function renderTimeline(model, state, presentation, document_) {
  const pane = element('section', 'panel execution-timeline-panel stack');
  pane.dataset.testid = 'execution-timeline';
  const head = element('header', 'stack');
  head.append(element('h3', 'execution-timeline-heading', presentation.timelineLabel));
  head.append(element('p', 'meta', presentation.timelineDescription));
  pane.append(head);
  if (!model.intervals.length) {
    pane.append(emptyState({ icon: 'list', title: 'No recorded attempts',
      detail: 'Attempts appear on this shared time axis once producer activity observations are recorded for this run.' }));
    return pane;
  }
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
  const stackedLanes = [];
  for (const lane of model.lanes) {
    const item = element('li', 'execution-lane');
    item.dataset.agentId = lane.agentId;
    item.dataset.role = lane.role;
    const label = element('span', 'execution-lane-label');
    label.append(element('span', 'meta', `${presentation.laneLabel ?? ROLE_LABELS[lane.role] ?? lane.role} · ${lane.agentId}`));
    const track = document.createElementNS(axisRow.namespaceURI, 'svg');
    track.classList.add('execution-track');
    track.setAttribute('width', '100%');
    const laneIntervals = model.intervals.filter(entry => entry.lane === lane.lane && INTERVAL_STATES.has(entry.state));
    const { byAttempt, rows } = sublanesFor(laneIntervals);
    if (rows > 1) stackedLanes.push({ agentId: lane.agentId, rows });
    track.dataset.sublanes = String(rows);
    track.setAttribute('height', String(trackHeight(rows)));
    for (const interval of laneIntervals) {
      const position = geometry.get(interval.attemptId);
      const row = byAttempt.get(interval.attemptId) ?? 0;
      const bar = document.createElementNS(track.namespaceURI, 'foreignObject');
      bar.classList.add('execution-interval', `state-${interval.state}`);
      bar.dataset.attemptId = interval.attemptId;
      bar.dataset.agentId = interval.agentId;
      bar.dataset.role = interval.role;
      bar.dataset.taskId = interval.taskId ?? '';
      bar.dataset.state = interval.state;
      bar.dataset.lane = String(interval.lane);
      bar.dataset.sublane = String(row);
      bar.dataset.startMs = String(interval.startMs);
      bar.dataset.endMs = interval.open ? '' : String(interval.endMs);
      if (interval.open) bar.dataset.open = 'true';
      if (interval.resumesAttemptId) bar.dataset.resumes = interval.resumesAttemptId;
      bar.setAttribute('x', `${position.leftPercent.toFixed(3)}%`);
      bar.setAttribute('y', String(TRACK.inset + row * TRACK.pitch));
      bar.setAttribute('width', `${position.widthPercent.toFixed(3)}%`);
      bar.setAttribute('height', String(TRACK.bar));
      bar.setAttribute('role', 'button');
      bar.setAttribute('focusable', 'true');
      bar.setAttribute('aria-label', `${interval.attemptId} · ${interval.state}${interval.open ? ' · open interval, no terminal record' : ''}`);
      bar.tabIndex = 0;
      bar.addEventListener('click', () => state.onSelect(interval.attemptId));
      const title = document.createElementNS(track.namespaceURI, 'title');
      title.textContent = `${interval.attemptId} · ${interval.state}${interval.open ? ' · open interval, no terminal record' : ''}`;
      const body = element('div', 'execution-interval-body');
      body.append(element('span', 'execution-interval-label',
        `${interval.resumesAttemptId ? 'retry ↻ ' : ''}${interval.attemptId} · ${interval.state}${interval.resumesAttemptId ? ` · resumes ${interval.resumesAttemptId}` : ''}`));
      bar.append(title, body);
      track.append(bar);
    }
    // Retry history stays inline on the lane: a dotted link from the start of
    // the resuming attempt back to the row of the attempt it resumes, so the
    // previous failure stays visible as part of the same story.
    for (const chain of model.retryChains.filter(entry => entry.lane === lane.lane)) {
      const rowTo = byAttempt.get(chain.to);
      const rowFrom = byAttempt.get(chain.from);
      if (rowTo === undefined || rowFrom === undefined || rowTo === rowFrom) continue;
      const position = geometry.get(chain.to);
      const link = document.createElementNS(track.namespaceURI, 'line');
      link.classList.add('execution-retry-link');
      link.setAttribute('x1', `${position.leftPercent.toFixed(3)}%`);
      link.setAttribute('x2', `${position.leftPercent.toFixed(3)}%`);
      link.setAttribute('y1', String(trackCenter(rowTo)));
      link.setAttribute('y2', String(trackCenter(rowFrom)));
      link.setAttribute('aria-hidden', 'true');
      link.dataset.from = chain.from;
      link.dataset.to = chain.to;
      track.append(link);
    }
    item.append(label, track);
    laneList.append(item);
  }
  viewport.append(laneList);
  pane.append(viewport);
  const joinStrip = renderJoinStrip(document_ ?? { nodes: [], edges: [] }, state);
  if (joinStrip) pane.append(joinStrip);
  const notes = element('ul', 'execution-notes');
  notes.append(element('li', 'meta',
    `${model.lanes.length} ${presentation.laneLabel ?? 'agent'} lane${model.lanes.length === 1 ? '' : 's'} · ${model.peakConcurrency} concurrent attempt${model.peakConcurrency === 1 ? '' : 's'} at peak · durations are ${presentation.durationLabel}`));
  for (const stacked of stackedLanes) {
    notes.append(element('li', 'meta',
      `stacked: ${stacked.agentId} ran ${stacked.rows} attempts at overlapping times — the rows stack instead of painting over each other`));
  }
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
    childrenOf: state.childrenOf,
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

  // The status line is a plain counter, deliberately NOT a second live region:
  // announcements ride the single T11 polite announcer (IK-7).
  const status = element('p', 'meta execution-status', 'Execution view ready.');
  status.dataset.testid = 'execution-status';

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
  let modeControl = null;
  let dockPanel = null;
  let dockNodeId = null;
  const dockExpanded = new Set();

  function nodeById(id) {
    if (currentDocument.nodes.some(node => node.id === id)) return currentDocument.nodes.find(node => node.id === id);
    return currentDocument.nodes.flatMap(node => node.children ?? []).find(child => child.id === id) ?? null;
  }

  function childrenOf(id) {
    return nodeById(id)?.children ?? [];
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
    // Graph/List equivalence rides the T11 segmented control: one node set,
    // two presentations, selection and collapsed state shared between them.
    modeControl = segmentedControl({
      label: 'Presentation mode',
      options: [{ value: 'graph', label: 'Graph' }, { value: 'list', label: 'List' }],
      current: currentMode,
      onChange: next => setMode(next),
    });
    toolbar.append(modeControl.element);
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
    if (dockPanel) root.append(dockPanel.element); // the dock survives re-shells
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
    const state = { selectedId, collapsed, childrenOf, focus: focusNode, onToggle: toggleGroup, onSelect: select };
    const presentation = presentationOf(currentDocument);
    const { wrap, region } = renderGraph(currentDocument, state, graphViewport, presentation);
    wrap.hidden = currentMode === 'list';
    body.append(wrap);
    const list = element('ol', 'execution-list');
    list.dataset.testid = 'execution-list';
    for (const row of listModel(currentDocument, { collapsed }).rows) list.append(listRow(row, state));
    list.hidden = currentMode !== 'list';
    body.append(list);
    body.append(renderTimeline(currentTimeline, state, presentation, currentDocument));
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
    // Timeline bars carry the raw attempt id while task-level nodes prefix it;
    // selecting a bar selects the attempt node when that identity exists.
    if (nodeById(nodeId) == null && nodeById(`attempt:${nodeId}`) != null) nodeId = `attempt:${nodeId}`;
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
    } else if (node.kind === 'attempt' || node.kind === 'verifier') {
      // Attempt/verifier drill-down opens in the dock (T12b frame): the steps
      // expand inline there, with no fabricated deeper level in the DAG.
      const dockOpen = button(node.kind === 'verifier' ? 'Open verifier detail in dock' : 'Open attempt detail in dock',
        event => openDock(node.id, event.currentTarget));
      dockOpen.dataset.testid = 'execution-dock-open';
      inspector.append(dockOpen);
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

  /* -- Attempt drill-down dock ------------------------------------------
     The dock (createDockPanel, T12 addendum) is the elevated right surface:
     Escape closes it and returns focus to the invoker through the T11
     overlay stack. Its content is rebuilt from recorded state only — steps
     expand on demand and unreported steps stay unknown. */

  function dockStepTargets(node) {
    const steps = [];
    const evidence = [];
    if (node.kind === 'verifier') {
      for (const child of childrenOf(node.id)) (child.kind === 'evidence' ? evidence : steps).push(child);
      return { steps, evidence };
    }
    for (const edge of currentDocument.edges.filter(edge => edge.from === node.id)) {
      const target = nodeById(edge.to);
      if (!target) continue;
      (target.kind === 'evidence' ? evidence : steps).push(target);
    }
    return { steps, evidence };
  }

  function dockBody(node) {
    const content = element('div', 'stack execution-dock');
    const chips = element('div', 'cluster');
    chips.append(statusChip(node.execution), statusChip(node.verification));
    content.append(chips, element('code', 'execution-dock-id', node.id), element('p', 'meta', node.title));
    const attemptId = node.id.startsWith('attempt:') ? node.id.slice('attempt:'.length) : null;
    const interval = attemptId ? currentTimeline.intervals.find(entry => entry.attemptId === attemptId) : null;
    const intervalSection = element('section', 'stack');
    intervalSection.append(element('h4', '', 'Recorded interval'));
    intervalSection.append(element('p', 'meta', interval
      ? `${interval.agentId} · role ${interval.role} · lane ${interval.lane} · ${new Date(interval.startMs).toISOString()} → ${interval.endMs == null ? 'open (no terminal record)' : new Date(interval.endMs).toISOString()} · state ${interval.state}`
      : 'No recorded interval matches this identity; nothing is inferred.'));
    content.append(intervalSection);
    const { steps, evidence } = dockStepTargets(node);
    const stepsSection = element('section', 'stack');
    stepsSection.append(element('h4', '', 'Steps'));
    if (!steps.length) stepsSection.append(element('p', 'meta', 'No step records reported; unreported steps stay unknown.'));
    for (const step of steps) {
      const expanded = dockExpanded.has(step.id);
      const row = element('div', 'execution-dock-step stack');
      const toggle = button(step.title, () => {
        if (dockExpanded.has(step.id)) dockExpanded.delete(step.id); else dockExpanded.add(step.id);
        renderDockBody();
      });
      toggle.dataset.testid = 'execution-dock-step';
      toggle.dataset.stepId = step.id;
      toggle.className = 'execution-dock-step-toggle';
      toggle.setAttribute('aria-expanded', String(dockExpanded.has(step.id)));
      const detail = element('div', 'execution-dock-detail stack');
      detail.hidden = !expanded;
      const detailChips = element('div', 'cluster');
      detailChips.append(statusChip(step.execution), statusChip(step.verification));
      detail.append(element('p', 'meta', step.summary ?? 'No step detail recorded.'), detailChips);
      row.append(toggle, detail);
      stepsSection.append(row);
    }
    content.append(stepsSection);
    const evidenceSection = element('section', 'stack');
    evidenceSection.append(element('h4', '', 'Evidence'));
    if (!evidence.length) evidenceSection.append(element('p', 'meta', 'No evidence node is recorded for this identity.'));
    for (const item of evidence) {
      const row = element('div', 'cluster');
      row.append(statusChip(item.verification), element('span', 'meta', item.title));
      evidenceSection.append(row);
    }
    content.append(evidenceSection);
    const retry = currentDocument.edges.find(edge => edge.kind === 'history' && (edge.to === node.id || edge.from === node.id));
    if (retry) {
      const retrySection = element('section', 'stack');
      retrySection.append(element('h4', '', 'Retry history'));
      retrySection.append(element('p', 'meta', `${retry.from} → ${retry.to} · ${retry.label}`));
      content.append(retrySection);
    }
    return content;
  }

  function renderDockBody() {
    if (!dockPanel || !dockNodeId) return;
    const node = nodeById(dockNodeId);
    if (!node) return;
    dockPanel.element.querySelector('.lb-dock-body')?.replaceChildren(dockBody(node));
  }

  function openDock(nodeId, invoker) {
    const node = nodeById(nodeId);
    if (!node || !['attempt', 'verifier'].includes(node.kind)) return false;
    if (dockPanel) {
      if (dockPanel.isOpen()) dockPanel.close('replace');
      dockPanel.element.remove();
    }
    dockNodeId = nodeId;
    dockPanel = createDockPanel({
      title: `${node.kind === 'verifier' ? 'Verifier' : 'Attempt'} — ${node.id.replace(/^(verifier:|attempt:)/, '')}`,
      content: dockBody(node),
      footer: element('p', 'meta', 'Recorded observations only · opening this detail dispatches nothing and verifies nothing.'),
      onClose: reason => { if (reason !== 'replace') callbacks.onDockClose?.({ nodeId: dockNodeId, reason }); },
    });
    root.append(dockPanel.element);
    dockPanel.open(invoker);
    callbacks.onDockOpen?.({ nodeId });
    return true;
  }

  function refreshDockOnUpdate() {
    if (!dockPanel || !dockPanel.isOpen()) return;
    if (!dockNodeId || !nodeById(dockNodeId)) {
      dockPanel.close('update-removed-node');
      dockNodeId = null;
      return;
    }
    renderDockBody();
  }

  function nextLevelDown() {
    return currentDocument.level === 'plan' ? 'batch' : currentDocument.level === 'batch' ? 'task' : null;
  }

  function setMode(nextMode) {
    currentMode = nextMode === 'list' ? 'list' : 'graph';
    renderBody();
    modeControl?.setCurrent(currentMode);
    callbacks.onModeChange?.({ mode: currentMode });
  }

  /** Simulated polling tick: re-render from the next document/timeline while
   *  preserving breadcrumbs, selection, collapsed groups, viewport and an
   *  open dock (its detail rebuilds from the fresh state). */
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
    refreshDockOnUpdate();
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
    openDock,
    setViewport: (viewport, reason) => graphViewport.setViewport(viewport, reason),
    fitViewport: () => graphViewport.fit(),
    getStats() {
      return {
        viewRevision, mode: currentMode, selectedId, collapsed: [...collapsed].sort(),
        level: currentDocument.level, focusId: currentDocument.focusId ?? null,
        docId: currentDocument.docId, viewId: currentDocument.viewId,
        nodeCount: currentDocument.nodes.length, edgeCount: currentDocument.edges.length,
        lastUpdate, viewport: graphViewport.getState(), timelineViewport: root.dataset.timelineViewport ?? null,
        dockOpen: dockPanel?.isOpen() ?? false,
        dockNodeId: dockPanel?.isOpen() ? dockNodeId : null,
      };
    },
    getDocument() { return structuredClone(currentDocument); },
  };
}

export { SpikePresentationError };
