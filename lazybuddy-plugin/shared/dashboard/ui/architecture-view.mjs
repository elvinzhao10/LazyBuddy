// T17 architecture lenses — DOM view over the T17 architecture fixture (built
// by architecture-model.mjs through the real T13 projection). Product and
// Engineering lenses render over ONE identity set; Current/Planned/Change are
// T13's three views; switching lens or view preserves the selected component
// and never changes a status (statuses are fixture data, rendered verbatim).
// No commands, no fetch, no scheduler authority. Keyboard operation and an
// equivalent list mode serve narrow widths.
import { button, element, statusChip } from './components.mjs';

const LENSES = ['product', 'engineering'];
const VIEWS = ['current', 'planned', 'change'];
const KIND_LABELS = { application: 'Application', subsystem: 'Subsystem', component: 'Component',
  interface: 'Interface', data_store: 'Data store', boundary: 'Boundary' };
const RELATIONSHIP_LABELS = { contains: 'contains', depends_on: 'depends on', uses: 'uses', provides: 'provides',
  calls: 'calls', extends: 'extends', replaces: 'replaces' };
const CHANGE_KINDS = ['additions', 'open_migrations', 'replacements'];

function changeIdSet(fixture) {
  return new Set(fixture.change.additions.concat(fixture.change.open_migrations, fixture.change.replacements)
    .map(entry => entry.id));
}

function viewIdsOf(fixture, view) {
  if (view === 'current') return fixture.current.map(entry => entry.id);
  if (view === 'planned') return fixture.planned.map(entry => entry.id);
  return [...changeIdSet(fixture)].sort((left, right) => left.localeCompare(right));
}

// Containment depth for the engineering list (authored parent_id chain).
function depthOf(fixture, id) {
  let depth = 0;
  let current = fixture.components[id]?.authored?.parent_id ?? null;
  while (current && depth < 16) { depth += 1; current = fixture.components[current]?.authored?.parent_id ?? null; }
  return depth;
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

// A selectable identity control. The same control vocabulary renders in every
// lens, view and mode so identity and status cannot drift between them.
function identityControl({ component, label, detail, extra, className }) {
  const control = button('');
  control.className = `architecture-identity ${className}`;
  control.dataset.componentId = component.id;
  control.setAttribute('aria-pressed', 'false');
  const head = element('span', 'cluster architecture-identity-head');
  head.append(element('code', '', component.id));
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

export function createArchitectureView({ fixture: initialFixture, lens = 'product', view = 'current',
  mode = 'cards', collapsed = [], callbacks = {} }) {
  let currentFixture = structuredClone(initialFixture);
  let currentLens = LENSES.includes(lens) ? lens : 'product';
  let currentView = VIEWS.includes(view) ? view : 'current';
  let currentMode = mode === 'list' ? 'list' : 'cards';
  let selectedId = null;
  let collapsedGroups = new Set(collapsed.filter(kind => CHANGE_KINDS.includes(kind)));
  let viewRevision = 0;
  let lastUpdate = null;

  const root = element('section', 'architecture-view stack');
  root.dataset.testid = 'architecture-view';
  root.dataset.docId = currentFixture.docId;

  const status = element('p', 'meta architecture-status', 'Architecture view ready.');
  status.dataset.testid = 'architecture-status';
  status.setAttribute('role', 'status');

  const inspector = element('aside', 'panel architecture-inspector stack');
  inspector.dataset.testid = 'architecture-inspector';
  inspector.tabIndex = 0;
  inspector.setAttribute('role', 'region');
  inspector.setAttribute('aria-label', 'Contextual inspector');

  const viewport = element('div', 'architecture-viewport');
  viewport.dataset.testid = 'architecture-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Architecture content');

  const componentOf = id => currentFixture.components[id] ?? null;

  function renderHeader() {
    const head = element('header', 'architecture-head stack');
    head.append(element('h2', '', currentFixture.title), element('p', 'meta architecture-subtitle', currentFixture.subtitle));
    const coverage = element('p', 'meta architecture-coverage', currentFixture.coverageNote);
    coverage.dataset.testid = 'architecture-coverage';
    head.append(coverage);

    const toolbar = element('div', 'cluster architecture-toolbar');
    const makeSwitcher = (name, values, labels, current, onPick) => {
      const group = element('div', `view-switcher cluster architecture-switcher architecture-switcher-${name}`);
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `${name} switcher`);
      for (const value of values) {
        const control = button(labels[value], () => onPick(value));
        control.dataset[`${name}Value`] = value;
        control.setAttribute('aria-pressed', String(value === current));
        group.append(control);
      }
      group.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const controls = [...group.querySelectorAll('button')];
        const index = controls.indexOf(document.activeElement);
        if (index === -1) return;
        event.preventDefault();
        controls[(index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length].focus();
      });
      return group;
    };
    toolbar.append(makeSwitcher('lens', LENSES, { product: 'Product lens', engineering: 'Engineering lens' }, currentLens, setLens));
    toolbar.append(makeSwitcher('view', VIEWS, { current: 'Current', planned: 'Planned', change: 'Change' }, currentView, setView));
    toolbar.append(makeSwitcher('mode', ['cards', 'list'], { cards: 'Cards', list: 'List' }, currentMode, setMode));
    const legend = element('ul', 'cluster architecture-legend');
    legend.setAttribute('aria-label', 'Treatment legend');
    const ghost = element('li', 'legend-ghost');
    ghost.append(element('span', 'meta', 'ghost · dashed = proposed component'));
    const separate = element('li', 'legend-separation');
    separate.append(element('span', 'meta', 'implementation and verification separate — not verified is never green'));
    legend.append(ghost, separate);
    toolbar.append(legend);
    head.append(toolbar);
    return head;
  }

  function renderFeatures() {
    const panel = element('section', 'panel architecture-features stack');
    panel.dataset.testid = 'architecture-features';
    panel.append(element('h3', '', 'Features'), element('p', 'meta',
      'A feature points at several components and plans. Every control carries the recorded identity, so navigation between lenses never drifts.'));
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
        const control = button(planId, () => callbacks.onOpenPlan?.({ planId, featureId: feature.id }));
        control.dataset.planId = planId;
        control.dataset.surface = 'feature';
        control.className = 'architecture-feature-link';
        const item = element('li', '');
        item.append(control);
        return item;
      });
      const decisionEntries = feature.open_decision_ids.map(decisionId => {
        const control = button(decisionId, () => callbacks.onOpenDecision?.({ proposalId: decisionId, featureId: feature.id }));
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
        const control = button(`${entry.component_id} — ${entry.source}`, () => select(entry.component_id));
        control.dataset.componentId = entry.component_id;
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
    surface.append(element('h3', '', 'Product lens — plain-language journey'),
      element('p', 'meta', 'Agent-authored steps over authored components (user action → UI → API → data store style path); each step carries its source reference and selects the same component identity as the engineering lens.'));
    const activeIds = new Set(viewIdsOf(currentFixture, currentView));
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
        control.setAttribute('aria-pressed', 'false');
        const head = element('span', 'cluster architecture-step-head');
        head.append(element('span', 'architecture-step-index', `${index + 1}.`), element('span', '', step.interaction));
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
    surface.append(element('p', 'meta', `Active view (${currentView}) emphasizes its member steps; every step stays selectable and its status never changes with the view.`));
    return surface;
  }

  function renderEngineeringSurface() {
    const surface = element('section', 'architecture-engineering stack');
    surface.dataset.testid = 'architecture-engineering';
    surface.append(element('h3', '', 'Engineering lens — components, interfaces and observed code'),
      element('p', 'meta', 'Typed relationships, containment and observed paths at their content revisions. Implementation and verification stay separate.'));
    if (currentView === 'change') {
      surface.append(renderChangeGroups());
      return surface;
    }
    const ids = viewIdsOf(currentFixture, currentView);
    const list = currentMode === 'list' ? element('ol', 'architecture-list') : element('div', 'architecture-cards');
    for (const id of ids) {
      const component = componentOf(id);
      if (!component) continue;
      const authored = component.authored;
      const depth = depthOf(currentFixture, id);
      let extra = null;
      if (currentView === 'current') {
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
        extra, className: currentMode === 'list' ? 'architecture-row' : 'architecture-card' });
      control.dataset.surface = 'engineering';
      if (component.status.proposed) control.dataset.proposed = 'true';
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
        `${attention} component${attention === 1 ? '' : 's'} in this view ${attention === 1 ? 'is' : 'are'} implemented but not verified — never green.`));
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
              className: 'architecture-row' });
            control.dataset.surface = 'change';
            if (component.status.proposed) control.dataset.proposed = 'true';
            control.addEventListener('click', () => select(entry.id));
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

  function renderInspector() {
    inspector.replaceChildren();
    inspector.append(element('h3', '', 'Inspector'));
    const component = selectedId ? componentOf(selectedId) : null;
    if (!component) {
      inspector.append(element('p', 'meta', 'Select a journey step, component or feature link to inspect summary, source, changes and evidence.'));
      return;
    }
    const authored = component.authored;
    const head = element('span', 'cluster');
    head.append(element('code', '', component.id));
    if (component.status.proposed) head.append(proposedLabel());
    inspector.append(head);
    if (authored?.title) inspector.append(element('p', '', authored.title));
    inspector.append(chipsRow(component));

    const summary = element('section', 'stack');
    summary.append(element('h4', '', 'Summary'));
    summary.append(element('p', '', authored?.role ?? 'No authored role — this identity is a collector observation without authored intent.'));
    if (authored) {
      summary.append(element('p', 'meta', `Kind: ${KIND_LABELS[authored.kind] ?? authored.kind}${authored.parent_id ? ` · contained by ${authored.parent_id}` : ''}${authored.contains.length ? ` · contains ${authored.contains.join(', ')}` : ''}`));
    }
    if (component.status.pending_decision_ids.length) {
      summary.append(element('p', 'meta', `Pending decision${component.status.pending_decision_ids.length === 1 ? '' : 's'}: ${component.status.pending_decision_ids.join(', ')} — the ghost treatment stays until the decision resolves.`));
    }
    inspector.append(summary);

    const source = element('section', 'stack');
    source.append(element('h4', '', 'Source'));
    if (authored?.source) {
      source.append(element('p', 'meta', `Authored record at ${authored.source.source_id} · ${authored.source.anchor_id} · digest ${authored.source.sha256.slice(0, 12)}…`));
    } else {
      source.append(element('p', 'meta', 'No authored source — observed identity minted by the collector.'));
    }
    const scope = currentFixture.scopeDeclarations.find(entry => entry.component_id === component.id);
    if (scope) source.append(element('p', 'meta', `Declared scope: ${scope.paths.join(', ')} (${scope.coverage}) · declared by ${scope.source}`));
    const journeySources = currentFixture.journeys.flatMap(journey => journey.steps
      .filter(step => step.component_id === component.id).map(step => `${journey.id}: ${step.source ?? 'no source recorded'}`));
    if (journeySources.length) source.append(element('p', 'meta', `Journey sources: ${journeySources.join(' · ')}`));
    inspector.append(source);

    const changes = element('section', 'stack');
    changes.append(element('h4', '', 'Changes'));
    const memberships = [];
    if (component.in_current) memberships.push('observed in the Current view');
    if (component.in_planned) memberships.push(`authored in the Planned view (${component.intent.state})`);
    const changeMembership = currentFixture.change.additions.some(entry => entry.id === component.id) ? 'addition'
      : currentFixture.change.open_migrations.some(entry => entry.id === component.id) ? 'open migration'
        : currentFixture.change.replacements.some(entry => entry.id === component.id) ? 'replacement' : null;
    if (changeMembership) memberships.push(`listed in the Change view as a ${changeMembership}`);
    changes.append(element('p', 'meta', memberships.length ? memberships.join(' · ') : 'not listed in the Change view'));
    for (const link of currentFixture.supersessions.filter(link => link.successor_id === component.id)) {
      changes.append(element('p', 'meta', `Supersession: replaces ${link.superseded_id} · agent-authored from ${link.source}`));
    }
    for (const link of currentFixture.supersessions.filter(link => link.superseded_id === component.id)) {
      changes.append(element('p', 'meta', `Supersession: ${link.successor_id} proposes replacing this component · agent-authored from ${link.source}`));
    }
    inspector.append(changes);

    const evidence = element('section', 'stack');
    evidence.append(element('h4', '', 'Evidence'));
    if (component.observation) {
      evidence.append(element('p', 'meta', `Observed ${component.observation.paths.join(', ')} at revision ${component.observation.content_revision ?? 'none'} · coverage ${component.observation.coverage ?? 'undeclared'} · ${component.observation.observed_at}`));
    } else {
      evidence.append(element('p', 'meta', 'No current code observation — this view never infers implementation from existence.'));
    }
    if (component.verification) {
      evidence.append(element('p', 'meta', `Verification evidence: ${component.verification.source} (declared, agent-cited — verification authority stays with the verifier route)`));
    } else {
      evidence.append(element('p', 'meta', 'No declared verification evidence — implemented code without current proof is not green.'));
    }
    if (component.intent?.contributing_plans.length) {
      evidence.append(element('p', 'meta', `Contributing plans: ${component.intent.contributing_plans.join(', ')}`));
    }
    inspector.append(evidence);
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
    const focused = viewport.contains(document.activeElement)
      ? document.activeElement.dataset.componentId : null;
    const product = renderProductSurface();
    product.hidden = currentLens !== 'product';
    const engineering = renderEngineeringSurface();
    engineering.hidden = currentLens !== 'engineering';
    viewport.replaceChildren(product, engineering);
    const body = element('div', 'architecture-columns');
    body.dataset.testid = 'architecture-body';
    body.append(viewport, inspector);
    root.replaceChildren(renderHeader(), status, body, renderFeatures());
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
    root.dataset.viewport = `${scroll.left},${scroll.top}`;
    root.dataset.lens = currentLens;
    root.dataset.view = currentView;
    root.dataset.mode = currentMode;
    const ids = viewIdsOf(currentFixture, currentView);
    status.textContent = `${currentFixture.identities.length} identities · view ${currentView}: ${ids.length} · lens ${currentLens} · mode ${currentMode}${selectedId ? ` · selected ${selectedId}` : ''} · git observation ${currentFixture.git.status}${currentFixture.git.head ? ` @ ${String(currentFixture.git.head).slice(0, 10)}` : ''} · view revision ${viewRevision}`;
    for (const control of root.querySelectorAll('[data-component-id]')) {
      control.setAttribute('aria-pressed', String(control.dataset.componentId === selectedId));
    }
    if (focused) viewport.querySelector(`[data-component-id="${focused}"]`)?.focus();
  }

  function select(id) {
    if (id != null && !componentOf(id)) return;
    selectedId = id;
    for (const control of root.querySelectorAll('[data-component-id]')) {
      control.setAttribute('aria-pressed', String(control.dataset.componentId === selectedId));
    }
    renderInspector();
    callbacks.onSelect?.({ componentId: id, lens: currentLens, view: currentView });
  }

  function setLens(nextLens) {
    if (!LENSES.includes(nextLens) || nextLens === currentLens) return;
    currentLens = nextLens;
    fullRender();
    callbacks.onLensChange?.({ lens: currentLens, selectedId });
  }

  function setView(nextView) {
    if (!VIEWS.includes(nextView) || nextView === currentView) return;
    currentView = nextView;
    fullRender();
    callbacks.onViewChange?.({ view: currentView, selectedId });
  }

  function setMode(nextMode) {
    const value = nextMode === 'list' ? 'list' : 'cards';
    if (value === currentMode) return;
    currentMode = value;
    fullRender();
    callbacks.onModeChange?.({ mode: currentMode });
  }

  root.addEventListener('keydown', event => {
    const key = event.key;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.target === inspector) {
      if (key === 'Escape' || key === 'Enter') {
        event.preventDefault();
        if (selectedId) viewport.querySelector(`[data-component-id="${selectedId}"]`)?.focus();
      }
      return;
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
   *  lens, view, mode, selection, collapsed groups and viewport. */
  function applyUpdate(nextFixture) {
    const preserved = { lens: currentLens, view: currentView, mode: currentMode, selectedId,
      collapsed: [...collapsedGroups].sort(), viewport: root.dataset.viewport ?? null };
    currentFixture = structuredClone(nextFixture);
    if (selectedId && !componentOf(selectedId)) selectedId = null;
    viewRevision += 1;
    fullRender();
    renderInspector();
    lastUpdate = { ...preserved, selectedPreserved: preserved.selectedId == null || preserved.selectedId === selectedId,
      identities: currentFixture.identities.length, viewRevision };
    callbacks.onUpdate?.(structuredClone(lastUpdate));
    return structuredClone(lastUpdate);
  }

  fullRender();
  renderInspector();

  return {
    element: root,
    select,
    focusComponent(id) {
      const target = viewport.querySelector(`[data-component-id="${id}"]`);
      if (target) target.focus();
      return Boolean(target);
    },
    setLens, setView, setMode,
    applyUpdate,
    getStats() {
      return {
        lens: currentLens, view: currentView, mode: currentMode, selectedId, docId: currentFixture.docId,
        viewRevision, collapsed: [...collapsedGroups].sort(), viewport: root.dataset.viewport ?? null, lastUpdate,
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
