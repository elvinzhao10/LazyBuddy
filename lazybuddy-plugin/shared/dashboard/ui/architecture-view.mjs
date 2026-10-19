// T17 architecture lenses — DOM view over the T17 architecture fixture (built
// by architecture-model.mjs through the real T13 projection). Current,
// Planned and Change are the LENS TABS: one T12 segmented control over ONE
// identity set — switching tabs (or the Product/Engineering perspective, or
// the graph/cards/list mode) preserves the selected component identity and
// never changes a status (statuses are fixture data, computed once by the
// model and rendered verbatim). The container (graph) view draws implemented
// components solid and planned ones dashed from the library treatments;
// added/changed/removed markers carry the change story with the legend in a
// T11 overlay, not a static block. Component detail lives in the T12 dock:
// the journey from feature → affected plans → code → open decisions →
// verification, each link opening its item tab through onOpenItem. Authored
// relationships draw solid and carry their basis; agent-inferred
// supersessions draw dashed and are labeled 'inferred' (honesty rule). No
// commands, no fetch, no scheduler authority. Keyboard operation and an
// equivalent list mode serve narrow widths.
import { button, element, segmentedControl, statusChip, createDockPanel, createOverlayPanel, emptyState } from './components.mjs';
import { createGraphViewportController } from './graph-viewport.mjs';

const LENS_TABS = ['current', 'planned', 'change'];
const PERSPECTIVES = ['product', 'engineering'];
const MODES = ['graph', 'cards', 'list'];
const KIND_LABELS = { application: 'Application', subsystem: 'Subsystem', component: 'Component',
  interface: 'Interface', data_store: 'Data store', boundary: 'Boundary' };
const RELATIONSHIP_LABELS = { contains: 'contains', depends_on: 'depends on', uses: 'uses', provides: 'provides',
  calls: 'calls', extends: 'extends', replaces: 'replaces' };
const CHANGE_KINDS = ['additions', 'open_migrations', 'replacements'];
// Marker precedence: a supersession link removing an observed component wins
// over its change-group membership; an addition wins over a migration.
const MARKER_GLYPHS = { added: '+', changed: '±', removed: '×' };
const GRAPH = Object.freeze({ nodeWidth: 264, nodeHeight: 196, columnGap: 168, rowGap: 56, padding: 32 });

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function changeIdSet(fixture) {
  return new Set(fixture.change.additions.concat(fixture.change.open_migrations, fixture.change.replacements)
    .map(entry => entry.id));
}

function viewIdsOf(fixture, lensTab) {
  if (lensTab === 'current') return fixture.current.map(entry => entry.id);
  if (lensTab === 'planned') return fixture.planned.map(entry => entry.id);
  return [...changeIdSet(fixture)].sort((left, right) => left.localeCompare(right));
}

// The added/changed/removed marker per identity, derived once per fixture.
// 'removed' names the superseded side of an agent-authored supersession —
// nothing is deleted, the marker reports the recorded intent only.
function changeMarkers(fixture) {
  const markers = new Map();
  for (const entry of fixture.change.open_migrations) markers.set(entry.id, 'changed');
  for (const entry of fixture.change.replacements) markers.set(entry.id, 'changed');
  for (const entry of fixture.change.additions) markers.set(entry.id, 'added');
  for (const link of fixture.supersessions) markers.set(link.superseded_id, 'removed');
  return markers;
}

// Containment depth for the engineering list (authored parent_id chain).
function depthOf(fixture, id) {
  let depth = 0;
  let current = fixture.components[id]?.authored?.parent_id ?? null;
  while (current && depth < 16) { depth += 1; current = fixture.components[current]?.authored?.parent_id ?? null; }
  return depth;
}

// Container treatment: implemented (observed) renders solid, planned renders
// dashed, proposed keeps the ghost (dashed + hollow + labeled chip).
function treatmentOf(component) {
  if (!component) return 'observed';
  if (component.status.proposed) return 'proposed';
  return component.observation ? 'implemented' : 'planned';
}

/** Deterministic authored-only graph. Observations and execution dependencies
 *  never create edges; every edge carries its basis ('authored',
 *  'authored containment' or 'agent-authored' supersession) so the DOM layer
 *  can draw verified-record and inferred edges differently. */
export function architectureGraphModel(fixture, lensTab) {
  const active = new Set(viewIdsOf(fixture, lensTab));
  const columns = [];
  for (const id of [...active].sort((left, right) => left.localeCompare(right))) {
    const component = fixture.components[id];
    if (!component) continue;
    const depth = component.authored ? depthOf(fixture, id) : 0;
    if (!columns[depth]) columns[depth] = [];
    columns[depth].push(id);
  }
  const nodes = [];
  for (let column = 0; column < columns.length; column += 1) {
    for (const [row, id] of (columns[column] ?? []).entries()) {
      nodes.push({ id, column, x: GRAPH.padding + column * (GRAPH.nodeWidth + GRAPH.columnGap),
        y: GRAPH.padding + row * (GRAPH.nodeHeight + GRAPH.rowGap), width: GRAPH.nodeWidth, height: GRAPH.nodeHeight });
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = [];
  const seen = new Set();
  const addEdge = (from, to, kind, basis) => {
    if (!byId.has(from) || !byId.has(to)) return;
    const key = `${from}|${kind}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    const inferred = basis === 'agent-authored';
    edges.push({ id: key, from, to, kind, basis, inferred,
      label: inferred ? `${RELATIONSHIP_LABELS[kind] ?? kind} · inferred` : RELATIONSHIP_LABELS[kind] ?? kind });
  };
  for (const id of [...active].sort((left, right) => left.localeCompare(right))) {
    const authored = fixture.components[id]?.authored;
    if (!authored) continue;
    if (authored.parent_id) addEdge(authored.parent_id, id, 'contains', 'authored containment');
    for (const relationship of authored.relationships ?? []) {
      addEdge(id, relationship.to, relationship.kind, relationship.basis);
    }
  }
  // Same-column relationships route around the side of the column
  // (graphEdgeGeometry: +48px plus up to two 18px spread steps), so the
  // canvas reserves that allowance and their labels never clip.
  const maxRight = Math.max(...nodes.map(node => node.x + node.width), 0);
  const sameColumnEdges = edges.some(edge => byId.get(edge.from)?.x === byId.get(edge.to)?.x);
  const sideAllowance = sameColumnEdges ? 48 + 2 * 18 + GRAPH.padding : 0;
  const width = Math.max(480, ...nodes.map(node => node.x + node.width + GRAPH.padding), maxRight + sideAllowance);
  const height = Math.max(320, ...nodes.map(node => node.y + node.height + GRAPH.padding));
  return { nodes, edges: edges.sort((left, right) => left.id.localeCompare(right.id)), byId, width, height };
}

function chipsRow(component) {
  const wrap = element('span', 'cluster architecture-chiprow');
  wrap.append(element('span', 'meta', 'Implementation'), statusChip(component.status.implementation),
    element('span', 'meta', 'Verification'), statusChip(component.status.verification));
  return wrap;
}

function proposedLabel() {
  const chipNode = statusChip({ state: 'unavailable', label: 'proposed' });
  chipNode.dataset.proposedLabel = 'true';
  return chipNode;
}

function markerChip(marker) {
  const chipNode = element('span', 'architecture-marker', `${MARKER_GLYPHS[marker]} ${marker}`);
  chipNode.dataset.marker = marker;
  return chipNode;
}

// A selectable identity control. The same control vocabulary renders in every
// lens tab, perspective and mode so identity and status cannot drift between
// them; the treatment and change marker travel with the identity.
function identityControl({ component, label, detail, extra, className, marker = null }) {
  const control = button('');
  control.className = `architecture-identity ${className}`;
  control.dataset.componentId = component.id;
  control.dataset.treatment = treatmentOf(component);
  control.setAttribute('aria-pressed', 'false');
  if (component.status.proposed) control.dataset.proposed = 'true';
  const head = element('span', 'cluster architecture-identity-head');
  head.append(element('code', '', component.id));
  if (marker) head.append(markerChip(marker));
  if (component.status.proposed) head.append(proposedLabel());
  if (label) head.append(element('span', 'meta architecture-identity-label', label));
  control.append(head);
  control.append(chipsRow(component));
  if (detail) control.append(element('span', 'meta architecture-detail', detail));
  if (extra) control.append(extra);
  return control;
}

function linkList(entries) {
  const list = element('ul', 'stack');
  for (const entry of entries) list.append(entry);
  return list;
}

/** The T17 architecture view. Constructor options keep the historical names
 *  working: `lens`/`view` accepted product-engineering/current-planned-change
 *  in either position (the live project views pass them legacy-style), and
 *  the new preferred names are `perspective` + `lens`. */
export function createArchitectureView({ fixture: initialFixture, lens = null, perspective = null, view = null,
  mode = 'graph', collapsed = [], callbacks = {} }) {
  let currentFixture = structuredClone(initialFixture);
  let currentPerspective = PERSPECTIVES.includes(perspective) ? perspective
    : PERSPECTIVES.includes(lens) ? lens : 'product';
  let currentLensTab = LENS_TABS.includes(lens) ? lens : LENS_TABS.includes(view) ? view : 'current';
  let currentMode = MODES.includes(mode) ? mode : 'graph';
  let selectedId = null;
  let collapsedGroups = new Set(collapsed.filter(kind => CHANGE_KINDS.includes(kind)));
  let viewRevision = 0;
  let lastUpdate = null;
  let lensTabsControl = null;
  let perspectiveControl = null;
  let modeControl = null;
  let legendTrigger = null;
  let minimapPaint = null;
  let graphLayout = null;

  const root = element('section', 'architecture-view stack');
  root.dataset.testid = 'architecture-view';
  root.dataset.docId = currentFixture.docId;

  const status = element('p', 'meta architecture-status', 'Architecture view ready.');
  status.dataset.testid = 'architecture-status';
  status.setAttribute('role', 'status');

  const viewport = element('div', 'architecture-viewport');
  viewport.dataset.testid = 'architecture-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Architecture content');
  const graphViewport = createGraphViewportController({
    label: 'Architecture graph',
    getRegion: () => viewport.querySelector('.architecture-graph-viewport'),
    getSvg: () => viewport.querySelector('.architecture-graph'),
    onChange: event => { minimapPaint?.(event); callbacks.onViewportChange?.(event); },
  });

  const dockBody = element('div', 'stack architecture-dock-body');
  dockBody.dataset.testid = 'architecture-inspector';
  const dock = createDockPanel({ title: 'Component detail', content: dockBody,
    footer: element('p', 'meta', 'Escape collapses the dock; focus returns to the invoking control. Links open their item tab.'),
    onClose: () => callbacks.onDockClose?.({ lensTab: currentLensTab, selectedId }) });

  // One legend overlay for every treatment the canvas can draw; the entries
  // reuse the real swatch classes so the legend cannot drift from reality.
  const legend = createOverlayPanel({ title: 'Treatment legend', content: legendContent(),
    onClose: () => legendTrigger?.setAttribute('aria-pressed', 'false') });

  const componentOf = id => currentFixture.components[id] ?? null;
  const markerOf = id => changeMarkers(currentFixture).get(id) ?? null;

  function legendContent() {
    const wrap = element('div', 'stack architecture-legend-body');
    const swatch = treatment => {
      const node = element('span', 'architecture-swatch');
      node.dataset.treatment = treatment;
      return node;
    };
    const containers = element('section', 'stack architecture-legend-group');
    containers.append(element('h3', '', 'Containers'));
    for (const [treatment, text] of [
      ['implemented', 'solid — code observed in the current worktree'],
      ['planned', 'dashed — authored, no current observation'],
      ['proposed', 'ghost — dashed, hollow, pending decision'],
    ]) {
      const row = element('p', 'cluster');
      row.append(swatch(treatment), element('span', 'meta', text));
      containers.append(row);
    }
    const markers = element('section', 'stack architecture-legend-group');
    markers.append(element('h3', '', 'Change markers'));
    for (const marker of ['added', 'changed', 'removed']) {
      const row = element('p', 'cluster');
      row.append(markerChip(marker), element('span', 'meta', {
        added: 'observed path without authored intent',
        changed: 'authored without current observation, or a supersession successor',
        removed: 'named superseded by an agent-authored replacement — intent, not deletion',
      }[marker]));
      markers.append(row);
    }
    const edges = element('section', 'stack architecture-legend-group');
    edges.append(element('h3', '', 'Relationships'));
    const authoredRow = element('p', 'cluster');
    const authoredSample = element('span', 'architecture-edge-sample');
    authoredSample.dataset.basis = 'authored';
    authoredRow.append(authoredSample, element('span', 'meta', 'solid — authored record with a source reference'));
    const inferredRow = element('p', 'cluster');
    const inferredSample = element('span', 'architecture-edge-sample');
    inferredSample.dataset.basis = 'agent-authored';
    inferredRow.append(inferredSample, element('span', 'meta', 'dashed — agent-inferred supersession, labeled “inferred” on the canvas'));
    edges.append(authoredRow, inferredRow,
      element('p', 'meta', 'Implementation and verification stay separate — implemented-without-evidence is never green, and observations never create edges.'));
    wrap.append(containers, markers, edges);
    return wrap;
  }

  function renderHeader() {
    const head = element('header', 'architecture-head stack');
    head.append(element('h2', '', currentFixture.title), element('p', 'meta architecture-subtitle', currentFixture.subtitle));
    const coverage = element('p', 'meta architecture-coverage', currentFixture.coverageNote);
    coverage.dataset.testid = 'architecture-coverage';
    head.append(coverage);

    const toolbar = element('div', 'cluster architecture-toolbar');
    lensTabsControl = segmentedControl({ label: 'Lens', current: currentLensTab, onChange: setLensTab,
      options: [{ value: 'current', label: 'Current' }, { value: 'planned', label: 'Planned' }, { value: 'change', label: 'Change' }] });
    lensTabsControl.element.dataset.testid = 'architecture-lens-tabs';
    perspectiveControl = segmentedControl({ label: 'Perspective', current: currentPerspective, onChange: setPerspective,
      options: [{ value: 'product', label: 'Product' }, { value: 'engineering', label: 'Engineering' }] });
    perspectiveControl.element.dataset.testid = 'architecture-perspective';
    modeControl = segmentedControl({ label: 'Mode', current: currentMode, onChange: setMode,
      options: [{ value: 'graph', label: 'Graph' }, { value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }] });
    modeControl.element.dataset.testid = 'architecture-mode';
    legendTrigger = button('Legend', () => {
      legend.open(legendTrigger);
      legendTrigger.setAttribute('aria-pressed', 'true');
    });
    legendTrigger.dataset.testid = 'architecture-legend-trigger';
    legendTrigger.setAttribute('aria-haspopup', 'dialog');
    toolbar.append(lensTabsControl.element, perspectiveControl.element, modeControl.element, legendTrigger);
    head.append(toolbar);
    return head;
  }

  function renderFeatures() {
    const panel = element('section', 'panel architecture-features stack');
    panel.dataset.testid = 'architecture-features';
    panel.append(element('h3', '', 'Features'), element('p', 'meta',
      'A feature points at several components and plans. Component links select the shared identity; plan, decision and verification links open their item tab.'));
    if (!currentFixture.features.length) panel.append(element('p', 'meta', 'No accepted feature carries component applicability in this projection.'));
    for (const feature of currentFixture.features) {
      const article = element('article', 'architecture-feature stack');
      article.dataset.featureId = feature.id;
      const head = element('h4', 'cluster');
      head.append(element('span', '', feature.title), element('code', '', feature.id));
      article.append(head);

      const componentEntries = feature.component_ids.map(componentId => {
        const control = button(componentId, () => select(componentId));
        control.dataset.componentId = componentId;
        control.dataset.surface = 'feature';
        control.className = 'architecture-feature-link';
        const item = element('li', '');
        item.append(control);
        return item;
      });
      const planEntries = feature.affected_plan_ids.map(planId => {
        const control = button(planId, () => openItem('plan', planId, { featureId: feature.id }));
        control.dataset.planId = planId;
        control.dataset.surface = 'feature';
        control.className = 'architecture-feature-link';
        const item = element('li', '');
        item.append(control);
        return item;
      });
      const decisionEntries = feature.open_decision_ids.map(decisionId => {
        const control = button(decisionId, () => openItem('decision', decisionId, { featureId: feature.id }));
        control.dataset.decisionId = decisionId;
        control.dataset.surface = 'feature';
        control.className = 'architecture-feature-link';
        const item = element('li', '');
        item.append(control);
        return item;
      });
      const codeEntries = feature.code_paths.map(path => {
        const code = element('code', '', path);
        code.dataset.path = path;
        const item = element('li', '');
        item.append(code);
        return item;
      });
      const verificationEntries = feature.verification.map(entry => {
        const control = button(`${entry.component_id} — ${entry.source}`,
          () => openItem('evidence', entry.source, { componentId: entry.component_id, featureId: feature.id }));
        control.dataset.evidenceId = entry.source;
        control.dataset.surface = 'feature';
        control.className = 'architecture-feature-link';
        const item = element('li', '');
        item.append(control);
        return item;
      });

      const groups = [
        ['Components', componentEntries.length ? linkList(componentEntries) : element('p', 'meta', 'No component scoped.')],
        ['Affected plans', planEntries.length ? linkList(planEntries) : element('p', 'meta', 'No contributing plan recorded.')],
        ['Open decisions', decisionEntries.length ? linkList(decisionEntries) : element('p', 'meta', 'No open decision (exact zero).')],
        ['Code', codeEntries.length ? linkList(codeEntries) : element('p', 'meta', 'No observed code path for this feature yet.')],
        ['Verification', verificationEntries.length ? linkList(verificationEntries)
          : element('p', 'meta', 'No declared verification evidence for this feature components.')],
      ];
      for (const [heading, body] of groups) {
        const group = element('section', 'stack architecture-feature-group');
        group.append(element('h5', '', heading), body);
        article.append(group);
      }
      panel.append(article);
    }
    return panel;
  }

  function renderProductSurface() {
    const surface = element('section', 'architecture-product stack');
    surface.dataset.testid = 'architecture-product';
    surface.append(element('h3', '', 'Product perspective — plain-language journey'),
      element('p', 'meta', 'Agent-authored steps over authored components (user action → UI → API → data store style path); each step carries its source reference and selects the same component identity as the engineering perspective.'));
    const activeIds = new Set(viewIdsOf(currentFixture, currentLensTab));
    for (const journey of currentFixture.journeys) {
      const wrap = element('section', 'architecture-journey stack');
      wrap.dataset.journeyId = journey.id;
      wrap.append(element('h4', '', journey.title), element('p', 'meta', journey.basis));
      const list = element('ol', 'architecture-journey-steps');
      journey.steps.forEach((step, index) => {
        const component = componentOf(step.component_id);
        const item = element('li', 'architecture-step');
        item.dataset.stepIndex = String(index);
        item.dataset.componentId = step.component_id;
        const control = button('');
        control.className = 'architecture-step-control';
        control.dataset.componentId = step.component_id;
        control.dataset.surface = 'journey';
        control.dataset.treatment = treatmentOf(component);
        control.setAttribute('aria-pressed', 'false');
        const head = element('span', 'cluster architecture-step-head');
        head.append(element('span', 'architecture-step-index', `${index + 1}.`), element('span', '', step.interaction));
        const marker = markerOf(step.component_id);
        if (marker) head.append(markerChip(marker));
        control.append(head);
        const identityRow = element('span', 'cluster architecture-step-identity');
        identityRow.append(element('code', '', step.component_id));
        control.append(identityRow, chipsRow(component));
        control.append(element('span', 'meta architecture-step-source',
          step.source ? `source: ${step.source}` : 'source: none recorded · agent-authored step'));
        control.addEventListener('click', () => select(step.component_id));
        item.append(control);
        const inView = activeIds.has(step.component_id);
        item.dataset.inActiveView = String(inView);
        item.dataset.dimmed = String(!inView);
        list.append(item);
      });
      wrap.append(list);
      surface.append(wrap);
    }
    if (!currentFixture.journeys.length) {
      surface.append(element('p', 'meta', 'No journey authored yet — journeys are agent-authored content, never inferred from code.'));
    }
    surface.append(element('p', 'meta', `The ${currentLensTab} lens emphasizes its member steps; every step stays selectable and its status never changes with the lens.`));
    return surface;
  }

  function graphEdgeGeometry(edge, layout, index) {
    const source = layout.byId.get(edge.from);
    const target = layout.byId.get(edge.to);
    const y1 = source.y + source.height / 2;
    const y2 = target.y + target.height / 2;
    if (source.x === target.x) {
      const side = source.x + source.width + 48 + (index % 3) * 18;
      return { path: `M ${source.x + source.width} ${y1} C ${side} ${y1}, ${side} ${y2}, ${target.x + target.width} ${y2}`,
        labelX: side + 4, labelY: (y1 + y2) / 2 };
    }
    const forward = target.x > source.x;
    const x1 = forward ? source.x + source.width : source.x;
    const x2 = forward ? target.x : target.x + target.width;
    const bend = (x1 + x2) / 2;
    return { path: `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`,
      labelX: bend + 4, labelY: (y1 + y2) / 2 - 6 };
  }

  // Bounded overview strip: static node thumbnails plus the live viewport
  // rectangle; a click centers the graph viewport. Rendered only when the
  // laid-out graph exceeds the viewport region.
  function buildMinimap(layout, region) {
    const minimap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    minimap.classList.add('architecture-minimap');
    minimap.dataset.testid = 'architecture-minimap';
    minimap.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    minimap.setAttribute('preserveAspectRatio', 'none');
    minimap.setAttribute('role', 'img');
    minimap.setAttribute('aria-label', `Graph overview — ${layout.nodes.length} components; click to center the viewport`);
    for (const placed of layout.nodes) {
      const component = componentOf(placed.id);
      const thumb = document.createElementNS(minimap.namespaceURI, 'rect');
      thumb.classList.add('architecture-minimap-node');
      thumb.dataset.treatment = treatmentOf(component);
      thumb.setAttribute('x', placed.x);
      thumb.setAttribute('y', placed.y);
      thumb.setAttribute('width', placed.width);
      thumb.setAttribute('height', placed.height);
      minimap.append(thumb);
    }
    const frame = document.createElementNS(minimap.namespaceURI, 'rect');
    frame.classList.add('architecture-minimap-viewport');
    minimap.append(frame);
    minimap.addEventListener('click', event => {
      const box = minimap.getBoundingClientRect?.();
      const width = finite(minimap.clientWidth, 0) || finite(box?.width, 0);
      const height = finite(minimap.clientHeight, 0) || finite(box?.height, 0);
      if (width <= 0 || height <= 0) return;
      const x = (finite(event.offsetX, 0) / width) * layout.width;
      const y = (finite(event.offsetY, 0) / height) * layout.height;
      const scale = graphViewport.getState().scale || 1;
      graphViewport.setViewport({
        scrollLeft: Math.max(0, x * scale - finite(region.clientWidth, 0) / 2),
        scrollTop: Math.max(0, y * scale - finite(region.clientHeight, 0) / 2),
      }, 'minimap');
    });
    minimapPaint = () => {
      const state = graphViewport.getState();
      const scale = state.scale || 1;
      const width = finite(region.clientWidth, 0) / scale;
      const height = finite(region.clientHeight, 0) / scale;
      frame.setAttribute('x', String(state.scrollLeft / scale));
      frame.setAttribute('y', String(state.scrollTop / scale));
      frame.setAttribute('width', String(Math.max(8, Math.min(width, layout.width))));
      frame.setAttribute('height', String(Math.max(8, Math.min(height, layout.height))));
    };
    minimapPaint();
    return minimap;
  };

  function clearGraphOverview() {
    graphLayout = null;
    minimapPaint = null;
  }

  // The overview strip hides again when the region grows to fit the whole
  // graph (live client size, re-checked on every viewport change). The state
  // goes through the ATTRIBUTE: the minimap is an SVG root, and SVGElement
  // does not reflect a `hidden` property in browsers (mini-dom does — the
  // attribute is the one contract both honor).
  function updateMinimapVisibility() {
    const minimap = viewport.querySelector('.architecture-minimap');
    if (!minimap || !graphLayout) return false;
    const region = viewport.querySelector('.architecture-graph-viewport');
    const fits = graphLayout.width <= finite(region?.clientWidth, 0)
      && graphLayout.height <= finite(region?.clientHeight, 0);
    if (fits) minimap.setAttribute('hidden', '');
    else minimap.removeAttribute('hidden');
    return !fits;
  }

  function renderArchitectureGraph() {
    const layout = architectureGraphModel(currentFixture, currentLensTab);
    graphLayout = { width: layout.width, height: layout.height };
    const wrap = element('div', 'architecture-graph-wrap');
    wrap.append(graphViewport.controls());
    const region = element('div', 'architecture-graph-viewport');
    region.dataset.testid = 'architecture-graph';
    region.tabIndex = 0;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', `Authored architecture graph for the ${currentLensTab} lens`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('architecture-graph');
    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);

    const edgeLayer = document.createElementNS(svg.namespaceURI, 'g');
    edgeLayer.classList.add('architecture-graph-edges');
    layout.edges.forEach((edge, index) => {
      const geometry = graphEdgeGeometry(edge, layout, index);
      const group = document.createElementNS(svg.namespaceURI, 'g');
      group.dataset.edgeId = edge.id;
      group.dataset.kind = edge.kind;
      group.dataset.basis = edge.basis;
      group.dataset.inferred = String(edge.inferred);
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', geometry.path);
      path.setAttribute('aria-label', `${edge.label}: ${edge.from} to ${edge.to} · ${edge.basis}`);
      const label = document.createElementNS(svg.namespaceURI, 'text');
      label.setAttribute('x', geometry.labelX);
      label.setAttribute('y', geometry.labelY);
      label.textContent = edge.label;
      group.append(path, label);
      edgeLayer.append(group);
    });

    const nodeLayer = document.createElementNS(svg.namespaceURI, 'g');
    nodeLayer.classList.add('architecture-graph-nodes');
    for (const placed of layout.nodes) {
      const component = componentOf(placed.id);
      const authored = component?.authored;
      const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject');
      foreign.dataset.componentId = placed.id;
      foreign.setAttribute('x', placed.x);
      foreign.setAttribute('y', placed.y);
      foreign.setAttribute('width', placed.width);
      foreign.setAttribute('height', placed.height);
      const control = button('');
      control.className = 'architecture-identity architecture-graph-node';
      control.dataset.componentId = placed.id;
      control.dataset.surface = 'engineering-graph';
      control.dataset.containmentDepth = String(placed.column);
      control.dataset.treatment = treatmentOf(component);
      control.setAttribute('aria-pressed', String(placed.id === selectedId));
      control.setAttribute('aria-label', `${KIND_LABELS[authored?.kind] ?? authored?.kind ?? 'Observed identity'}: ${authored?.title ?? placed.id}`);
      if (component?.status.proposed) control.dataset.proposed = 'true';
      const head = element('span', 'cluster architecture-identity-head');
      head.append(element('code', '', placed.id));
      const marker = markerOf(placed.id);
      if (marker) head.append(markerChip(marker));
      if (component?.status.proposed) head.append(proposedLabel());
      control.append(head, element('strong', 'architecture-graph-title', authored?.title ?? placed.id),
        element('span', 'meta architecture-graph-kind', KIND_LABELS[authored?.kind] ?? authored?.kind ?? 'Observed identity'),
        element('span', 'meta architecture-graph-role', `${authored?.contains.length ?? 0} contained · ${authored?.relationships.length ?? 0} typed relationship${authored?.relationships.length === 1 ? '' : 's'}`));
      control.addEventListener('click', () => select(placed.id));
      foreign.append(control);
      nodeLayer.append(foreign);
    }
    svg.append(edgeLayer, nodeLayer);
    region.append(svg);
    wrap.append(region);
    graphViewport.bind(region, svg, layout.width, layout.height);
    const regionWidth = finite(region.clientWidth, 0);
    const regionHeight = finite(region.clientHeight, 0);
    if (layout.width > regionWidth || layout.height > regionHeight) {
      wrap.append(buildMinimap(layout, region));
    } else {
      minimapPaint = null;
    }
    updateMinimapVisibility();
    return wrap;
  }

  function renderEngineeringSurface() {
    const surface = element('section', 'architecture-engineering stack');
    surface.dataset.testid = 'architecture-engineering';
    surface.append(element('h3', '', 'Engineering perspective — components, interfaces and observed code'),
      element('p', 'meta', 'Typed relationships, containment and observed paths at their content revisions. Implemented containers render solid, planned ones dashed; every edge states whether it is authored or inferred.'));
    if (currentLensTab === 'change') {
      clearGraphOverview();
      surface.append(renderChangeGroups());
      return surface;
    }
    const ids = viewIdsOf(currentFixture, currentLensTab);
    if (currentMode === 'graph') {
      surface.append(renderArchitectureGraph());
      const attention = ids.filter(id => componentOf(id)?.status.verification.state === 'attention').length;
      if (attention) surface.append(element('p', 'meta',
        `${attention} component${attention === 1 ? '' : 's'} in this lens ${attention === 1 ? 'is' : 'are'} implemented but not verified — select a node for status and evidence.`));
      return surface;
    }
    clearGraphOverview();
    const list = currentMode === 'list' ? element('ol', 'architecture-list') : element('div', 'architecture-cards');
    for (const id of ids) {
      const component = componentOf(id);
      if (!component) continue;
      const authored = component.authored;
      const depth = depthOf(currentFixture, id);
      let extra = null;
      if (currentLensTab === 'current') {
        extra = element('span', 'meta architecture-detail',
          `${component.observation.paths.join(', ')} · revision ${component.observation.content_revision ?? 'none'} · coverage ${component.observation.coverage ?? 'undeclared'}`);
      } else {
        extra = element('span', 'stack architecture-detail');
        if (authored?.relationships.length) {
          extra.append(element('span', 'meta', authored.relationships
            .map(relationship => `${RELATIONSHIP_LABELS[relationship.kind] ?? relationship.kind} ${relationship.to} (${relationship.basis})`)
            .join(' · ')));
        }
        if (component.intent?.contributing_plans.length) {
          extra.append(element('span', 'meta', `contributing plans: ${component.intent.contributing_plans.join(', ')}`));
        }
      }
      const control = identityControl({ component,
        label: authored ? KIND_LABELS[authored.kind] ?? authored.kind : 'no authored intent',
        detail: authored ? authored.role ?? authored.title : 'Observed path without authored intent',
        extra, marker: markerOf(id), className: currentMode === 'list' ? 'architecture-row' : 'architecture-card' });
      control.dataset.surface = 'engineering';
      control.dataset.containmentDepth = String(depth);
      control.addEventListener('click', () => select(id));
      const wrap = currentMode === 'list' ? element('li', `architecture-rowitem`) : element('div', '');
      wrap.setAttribute('aria-level', String(depth + 1));
      wrap.append(control);
      list.append(wrap);
    }
    surface.append(list);
    const attention = ids.filter(id => componentOf(id)?.status.verification.state === 'attention').length;
    if (attention) {
      surface.append(element('p', 'meta',
        `${attention} component${attention === 1 ? '' : 's'} in this lens ${attention === 1 ? 'is' : 'are'} implemented but not verified — never green.`));
    }
    return surface;
  }

  function renderChangeGroups() {
    const wrap = element('div', 'stack');
    const groups = [
      ['additions', 'Additions — observed without authored intent', currentFixture.change.additions],
      ['open_migrations', 'Open migrations — authored without current observation', currentFixture.change.open_migrations],
      ['replacements', 'Replacements — authored supersession links', currentFixture.change.replacements],
    ];
    for (const [kind, heading, entries] of groups) {
      const notVerified = entries.filter(entry => currentFixture.components[entry.id]?.status.verification.state === 'attention').length;
      const noun = kind === 'additions' ? 'addition' : kind === 'open_migrations' ? 'migration' : 'replacement';
      const summary = `${entries.length} ${noun}${entries.length === 1 ? '' : 's'}${notVerified ? ` · ${notVerified} not verified` : ''}`;
      const group = element('section', 'architecture-change-group stack');
      group.dataset.changeKind = kind;
      const isCollapsed = collapsedGroups.has(kind);
      group.dataset.collapsed = String(isCollapsed);
      const toggle = button(`${heading} — ${summary}${isCollapsed ? ' (expand)' : ''}`, () => {
        if (collapsedGroups.has(kind)) collapsedGroups.delete(kind); else collapsedGroups.add(kind);
        viewRevision += 1;
        fullRender();
        callbacks.onGroupToggle?.({ kind, collapsed: collapsedGroups.has(kind) });
      });
      toggle.className = 'architecture-change-toggle';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      group.append(toggle);
      if (!isCollapsed) {
        const list = element('ul', 'architecture-change-list');
        if (!entries.length) list.append(element('li', 'meta', 'None (exact zero).'));
        for (const entry of entries) {
          const component = componentOf(entry.id);
          const item = element('li', 'architecture-change-item');
          if (component) {
            const control = identityControl({ component, label: entry.state ?? entry.basis ?? '', detail: entry.detail,
              marker: markerOf(entry.id), className: 'architecture-row' });
            control.dataset.surface = 'change';
            item.append(control);
          } else {
            item.append(element('span', 'meta', `${entry.id} · ${entry.detail}`));
          }
          list.append(item);
        }
        group.append(list);
      }
      wrap.append(group);
    }
    return wrap;
  }

  // The dock journey: feature → affected plans → code → open decisions →
  // verification, every link opening its item tab through onOpenItem.
  function renderDockDetail() {
    dockBody.replaceChildren();
    const component = selectedId ? componentOf(selectedId) : null;
    if (!component) {
      dockBody.append(emptyState({ icon: 'search', title: 'No component selected',
        detail: 'Select a component in any lens tab — its journey from feature to verification opens here.' }));
      return;
    }
    const authored = component.authored;
    const head = element('span', 'cluster architecture-identity-head');
    head.append(element('code', '', component.id));
    const marker = markerOf(component.id);
    if (marker) head.append(markerChip(marker));
    if (component.status.proposed) head.append(proposedLabel());
    dockBody.append(head);
    if (authored?.title) dockBody.append(element('p', '', authored.title));
    dockBody.append(chipsRow(component));

    const scopingFeatures = currentFixture.features.filter(feature => feature.component_ids.includes(component.id));
    const planIds = [...new Set([...(component.intent?.contributing_plans ?? []),
      ...scopingFeatures.flatMap(feature => feature.affected_plan_ids)])].sort((left, right) => left.localeCompare(right));
    const decisionIds = [...new Set([...(component.status.pending_decision_ids ?? []),
      ...scopingFeatures.flatMap(feature => feature.open_decision_ids)])].sort((left, right) => left.localeCompare(right));

    const openControl = (kind, id, label, extra = {}) => {
      const control = button(label, () => openItem(kind, id, { componentId: component.id, ...extra }));
      control.className = 'architecture-feature-link';
      control.dataset.kind = kind;
      control.dataset[`${kind}Id`] = id;
      return control;
    };

    const journey = element('ol', 'architecture-detail-journey');
    const step = (title, body, hint) => {
      const item = element('li', 'architecture-detail-step');
      item.append(element('h3', 'architecture-detail-step-heading', title));
      item.append(body);
      if (hint) item.append(element('p', 'meta', hint));
      journey.append(item);
      return item;
    };
    const featureList = element('ul', 'stack');
    if (scopingFeatures.length) {
      for (const feature of scopingFeatures) {
        const item = element('li', '');
        item.append(openControl('feature', feature.id, `${feature.title} — ${feature.id}`));
        featureList.append(item);
      }
    } else featureList.append(element('li', 'meta', 'No accepted feature scopes this component.'));
    step('Features', featureList, 'The accepted features this component serves.');
    const planList = element('ul', 'stack');
    if (planIds.length) {
      for (const planId of planIds) {
        const item = element('li', '');
        item.append(openControl('plan', planId, planId));
        planList.append(item);
      }
    } else planList.append(element('li', 'meta', 'No contributing plan recorded.'));
    step('Affected plans', planList, 'Plans that contribute to this component or its features.');
    const codeList = element('ul', 'stack');
    if (component.observation) {
      for (const path of component.observation.paths) {
        const item = element('li', '');
        const code = element('code', '', path);
        code.dataset.path = path;
        item.append(code);
        codeList.append(item);
      }
    } else codeList.append(element('li', 'meta', 'No current code observation — implementation is never inferred from existence.'));
    step('Code', codeList, `Observed ${component.observation ? `at revision ${String(component.observation.content_revision ?? 'none').slice(0, 10)}` : '—'} · coverage ${component.observation?.coverage ?? 'undeclared'}.`);
    const decisionList = element('ul', 'stack');
    if (decisionIds.length) {
      for (const decisionId of decisionIds) {
        const item = element('li', '');
        item.append(openControl('decision', decisionId, decisionId));
        decisionList.append(item);
      }
    } else decisionList.append(element('li', 'meta', 'No open decision (exact zero).'));
    step('Open decisions', decisionList, 'Pending proposals whose impact names this component or its features.');
    const verificationList = element('ul', 'stack');
    if (component.verification) {
      const item = element('li', '');
      item.append(openControl('evidence', component.verification.source, component.verification.source));
      verificationList.append(item);
    } else verificationList.append(element('li', 'meta', 'No declared verification evidence — implemented code without current proof is not green.'));
    step('Verification', verificationList, 'Declared, agent-cited evidence; verification authority stays with the verifier route.');
    dockBody.append(journey);

    const source = element('section', 'stack');
    source.append(element('h3', '', 'Source'));
    if (authored?.source) {
      source.append(element('p', 'meta', `Authored record at ${authored.source.source_id} · ${authored.source.anchor_id} · digest ${authored.source.sha256.slice(0, 12)}…`));
    } else {
      source.append(element('p', 'meta', 'No authored source — observed identity minted by the collector.'));
    }
    const scope = currentFixture.scopeDeclarations.find(entry => entry.component_id === component.id);
    if (scope) source.append(element('p', 'meta', `Declared scope: ${scope.paths.join(', ')} (${scope.coverage}) · declared by ${scope.source}`));
    const journeySources = currentFixture.journeys.flatMap(journey => journey.steps
      .filter(stepEntry => stepEntry.component_id === component.id).map(stepEntry => `${journey.id}: ${stepEntry.source ?? 'no source recorded'}`));
    if (journeySources.length) source.append(element('p', 'meta', `Journey sources: ${journeySources.join(' · ')}`));
    dockBody.append(source);

    const changes = element('section', 'stack');
    changes.append(element('h3', '', 'Changes'));
    const memberships = [];
    if (component.in_current) memberships.push('observed in the Current lens');
    if (component.in_planned) memberships.push(`authored in the Planned lens (${component.intent.state})`);
    const changeMembership = currentFixture.change.additions.some(entry => entry.id === component.id) ? 'addition'
      : currentFixture.change.open_migrations.some(entry => entry.id === component.id) ? 'open migration'
        : currentFixture.change.replacements.some(entry => entry.id === component.id) ? 'replacement' : null;
    if (changeMembership) memberships.push(`listed in the Change lens as a ${changeMembership}`);
    changes.append(element('p', 'meta', memberships.length ? memberships.join(' · ') : 'not listed in the Change lens'));
    for (const link of currentFixture.supersessions.filter(link => link.successor_id === component.id)) {
      changes.append(element('p', 'meta', `Supersession: replaces ${link.superseded_id} · agent-authored from ${link.source}`));
    }
    for (const link of currentFixture.supersessions.filter(link => link.superseded_id === component.id)) {
      changes.append(element('p', 'meta', `Supersession: ${link.successor_id} proposes replacing this component · agent-authored from ${link.source}`));
    }
    dockBody.append(changes);
  }

  function visibleComponentControls() {
    const controls = [...viewport.querySelectorAll('[data-component-id]')];
    return controls.filter(control => {
      let node = control;
      while (node && node !== viewport) {
        if (node.hasAttribute('hidden')) return false;
        if (node.classList.contains('architecture-change-group') && node.dataset.collapsed === 'true') return false;
        node = node.parentNode;
      }
      return true;
    });
  }

  function fullRender() {
    const scroll = { left: viewport.scrollLeft ?? 0, top: viewport.scrollTop ?? 0 };
    graphViewport.capture();
    const focused = viewport.contains(document.activeElement)
      ? document.activeElement.dataset.componentId : null;
    const product = renderProductSurface();
    product.hidden = currentPerspective !== 'product';
    const engineering = renderEngineeringSurface();
    engineering.hidden = currentPerspective !== 'engineering';
    viewport.replaceChildren(product, engineering);
    // The header (segmented controls), the overlays and the dock are mounted
    // ONCE outside the replaced region, so a lens switch or polling refresh
    // never rebuilds an open dock or steals segment focus.
    content.replaceChildren(header, status, viewport, renderFeatures());
    // Post-attachment pass: the overview strip's fit check needs the LIVE
    // region size, which only exists once the graph surface is in the tree.
    updateMinimapVisibility();
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
    root.dataset.viewport = `${scroll.left},${scroll.top}`;
    root.dataset.lens = currentPerspective;      // legacy key: product | engineering
    root.dataset.view = currentLensTab;          // legacy key: current | planned | change
    root.dataset.perspective = currentPerspective;
    root.dataset.lensTab = currentLensTab;
    root.dataset.mode = currentMode;
    const ids = viewIdsOf(currentFixture, currentLensTab);
    status.textContent = `${currentFixture.identities.length} identities · lens ${currentLensTab}: ${ids.length} · perspective ${currentPerspective} · mode ${currentMode}${selectedId ? ` · selected ${selectedId}` : ''} · git observation ${currentFixture.git.status}${currentFixture.git.head ? ` @ ${String(currentFixture.git.head).slice(0, 10)}` : ''} · view revision ${viewRevision}`;
    for (const control of root.querySelectorAll('[data-component-id]')) {
      control.setAttribute('aria-pressed', String(control.dataset.componentId === selectedId));
    }
    if (focused) viewport.querySelector(`[data-component-id="${focused}"]`)?.focus();
  }

  function openItem(kind, id, extra = {}) {
    if (kind === 'plan') callbacks.onOpenPlan?.({ planId: id, ...extra });
    if (kind === 'decision') callbacks.onOpenDecision?.({ proposalId: id, ...extra });
    callbacks.onOpenItem?.({ kind, id, ...extra });
  }

  function select(id, { openDock = true, invoker = null } = {}) {
    if (id != null && !componentOf(id)) return;
    selectedId = id;
    for (const control of root.querySelectorAll('[data-component-id]')) {
      control.setAttribute('aria-pressed', String(control.dataset.componentId === selectedId));
    }
    renderDockDetail();
    if (openDock && id != null && !dock.isOpen()) {
      const trigger = invoker ?? (root.contains(document.activeElement) ? document.activeElement : null);
      dock.open(trigger);
    }
    callbacks.onSelect?.({ componentId: id, lensTab: currentLensTab, perspective: currentPerspective });
  }

  function setLensTab(nextLensTab) {
    if (!LENS_TABS.includes(nextLensTab) || nextLensTab === currentLensTab) return;
    currentLensTab = nextLensTab;
    lensTabsControl?.setCurrent(currentLensTab);
    fullRender();
    callbacks.onLensChange?.({ lensTab: currentLensTab, selectedId });
  }

  function setPerspective(nextPerspective) {
    if (!PERSPECTIVES.includes(nextPerspective) || nextPerspective === currentPerspective) return;
    currentPerspective = nextPerspective;
    perspectiveControl?.setCurrent(currentPerspective);
    fullRender();
    callbacks.onPerspectiveChange?.({ perspective: currentPerspective, selectedId });
  }

  function setMode(nextMode) {
    const value = MODES.includes(nextMode) ? nextMode : 'graph';
    if (value === currentMode) return;
    currentMode = value;
    modeControl?.setCurrent(currentMode);
    fullRender();
    callbacks.onModeChange?.({ mode: currentMode });
  }

  root.addEventListener('keydown', event => {
    const key = event.key;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (key === 'Escape' && !event.defaultPrevented) {
      // Fallback close when the T11 focus system is not installed; the
      // overlay stack handles Escape first where it is.
      if (legend.isOpen()) { legend.close('escape'); return; }
      if (dock.isOpen()) { dock.close('escape'); return; }
    }
    const componentId = event.target.dataset?.componentId;
    if (!componentId) return;
    if (key === 'Enter' || key === ' ') { event.preventDefault(); select(componentId); return; }
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    const controls = visibleComponentControls();
    const index = controls.indexOf(event.target);
    if (index === -1) return;
    event.preventDefault();
    controls[index + (key === 'ArrowDown' ? 1 : -1)]?.focus();
  });

  /** Simulated polling tick: re-render from the next fixture while preserving
   *  lens tab, perspective, mode, selection, collapsed groups, the dock and
   *  the viewport. */
  function applyUpdate(nextFixture) {
    const preserved = { lensTab: currentLensTab, perspective: currentPerspective, mode: currentMode, selectedId,
      collapsed: [...collapsedGroups].sort(), viewport: root.dataset.viewport ?? null, dockOpen: dock.isOpen() };
    currentFixture = structuredClone(nextFixture);
    if (selectedId && !componentOf(selectedId)) selectedId = null;
    viewRevision += 1;
    fullRender();
    renderDockDetail();
    lastUpdate = { ...preserved, selectedPreserved: preserved.selectedId == null || preserved.selectedId === selectedId,
      identities: currentFixture.identities.length, viewRevision };
    callbacks.onUpdate?.(structuredClone(lastUpdate));
    return structuredClone(lastUpdate);
  }

  const header = renderHeader();
  const content = element('div', 'stack');
  content.dataset.testid = 'architecture-body';
  root.append(content, legend.element, dock.element);
  fullRender();
  renderDockDetail();

  return {
    element: root,
    select,
    focusComponent(id) {
      const target = viewport.querySelector(`[data-component-id="${id}"]`);
      if (target) target.focus();
      return Boolean(target);
    },
    setLensTab, setPerspective, setMode,
    // Legacy aliases: setLens/setView accept either axis by value.
    setLens: value => (PERSPECTIVES.includes(value) ? setPerspective(value) : setLensTab(value)),
    setView: value => setLensTab(value),
    openLegend: invoker => legend.open(invoker ?? legendTrigger),
    openDock: invoker => { if (!dock.isOpen()) dock.open(invoker ?? null); return dock.isOpen(); },
    closeDock: () => dock.close('api'),
    setViewport: (next, reason) => graphViewport.setViewport(next, reason),
    fitViewport: () => graphViewport.fit(),
    refreshGraphOverview: updateMinimapVisibility,
    applyUpdate,
    getStats() {
      return {
        lensTab: currentLensTab, perspective: currentPerspective, mode: currentMode, selectedId, docId: currentFixture.docId,
        lens: currentPerspective, view: currentLensTab, // legacy keys
        viewRevision, collapsed: [...collapsedGroups].sort(), viewport: root.dataset.viewport ?? null,
        graphViewport: graphViewport.getState(), lastUpdate, dockOpen: dock.isOpen(),
        identities: [...currentFixture.identities],
        viewIds: { current: viewIdsOf(currentFixture, 'current'), planned: viewIdsOf(currentFixture, 'planned'),
          change: viewIdsOf(currentFixture, 'change') },
        featureIds: currentFixture.features.map(feature => feature.id),
        journeyIds: currentFixture.journeys.map(journey => journey.id),
      };
    },
    getFixture() { return structuredClone(currentFixture); },
  };
}
