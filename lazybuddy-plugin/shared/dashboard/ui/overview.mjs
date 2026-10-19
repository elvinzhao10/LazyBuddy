// T14 Overview view — a scannable dashboard tab, not a document. Pure
// presentation over the read-only projection adapter (overview-fixture.mjs):
// a hero status card (project identity plus the traceable status sentence as
// designed chips, never inline prose), the attention queue as a native list
// whose rows open their contributing records in the dock, compact metric tiles
// where every total opens its contributing records, and the macro map
// first-class (graph cards render at default zoom; the list equivalent is
// preserved by the embedded spike). Contributing-record ids are interactive:
// an id that resolves to a route — a plan through the onNodeDrill route the
// shell maps to its plan tab, or a criterion gate check in the map — opens it;
// an id with no route in this bundle renders the honest unavailable action
// with a note instead of dead text. Long explanations never render as walls
// of text: they ride the T11 tooltip-note pattern (aria-describedby + title)
// and the single polite announcer. No commands, no scheduling, no file
// access — authority stays with the runtime and the shared command route.
import { announce, button, element, emptyState, statusChip } from './components.mjs';
import { createProjectMapSpike } from './project-map-spike.mjs';
import { overviewFixture } from './overview-fixture.mjs';

let noteSequence = 0;

// T11 tooltip vocabulary: a clipped .native-note target wired through
// aria-describedby plus a title. installTooltips skips nodes that already
// carry a description, so the layer never double-notes these.
function explain(subject, text) {
  if (!subject || !text) return null;
  const host = subject.ownerDocument?.body ?? globalThis.document?.body ?? subject.parentNode;
  if (!host) return null;
  const note = element('span', 'native-note');
  note.id = `overview-note-${++noteSequence}`;
  note.textContent = text;
  host.append(note);
  subject.setAttribute('aria-describedby', note.id);
  if (!subject.getAttribute('title')) subject.setAttribute('title', text);
  return note;
}

// Contributing-record routing. The view never invents a destination: a record
// id is openable only when the projected data itself carries the route — a
// plan node (drilled through onNodeDrill, which the shell maps to its plan
// tab via the onOpenItem family), or a criterion gate check the macro map can
// select and focus. Anything else (request ids, worktree facts, interval
// records, blocker codes) has no source anchor or report route in this
// bundle and renders the explicit unavailable action with a note.
function recordRoute(record, { nodes, drill, selectAndFocus, expandGroup }) {
  const node = nodes.find(entry => entry.id === record);
  if (node?.kind === 'plan') {
    return {
      label: 'Open plan tab',
      note: 'Opens this plan through the shell plan-tab route.',
      open() { drill({ nodeId: record }); selectAndFocus(record); },
    };
  }
  if (node) {
    return {
      label: 'Show in map',
      note: 'Selects and focuses this object in the macro map below.',
      open() { selectAndFocus(record); },
    };
  }
  const criterion = /^criterion:([^@]+)@/.exec(record);
  if (criterion) {
    const check = nodes.flatMap(node => node.children ?? [])
      .find(candidate => candidate.id.includes('#criterion:') && candidate.id.endsWith(`:${criterion[1]}`));
    if (check) {
      const parentId = check.id.slice(0, check.id.indexOf('#'));
      return {
        label: 'Show gate check',
        note: 'Expands the owning plan group and focuses this gate check in the macro map.',
        open() {
          expandGroup(parentId);
          selectAndFocus(check.id, { afterRender: true });
        },
      };
    }
  }
  return null;
}

export function createOverviewView({ bundle, callbacks = {} }) {
  const fixture = overviewFixture(bundle);
  const mapFixture = { ...fixture, statement: undefined, metrics: undefined, attentionQueue: undefined, statusSentence: undefined, context: undefined, projection: undefined };
  const spike = createProjectMapSpike({ fixture: mapFixture, callbacks: {
    onSelect: event => callbacks.onNodeSelect?.(event),
    onDrill: event => callbacks.onNodeDrill?.(event),
    onViewportChange: event => callbacks.onMapViewportChange?.(event),
  } });

  // T22 perf budget: the clipped notes this view appends to the body are
  // tracked so the view can take them with it — a polling refresh that swaps
  // the overview must not leave the previous render's notes behind (they
  // would otherwise accumulate on every tick for the life of the page).
  const ownedNotes = [];
  let recordsNote = null;
  const ownNote = (subject, text) => { const created = explain(subject, text); if (created) ownedNotes.push(created); return created; };

  const root = element('section', 'overview-view stack');
  root.dataset.testid = 'overview-view';
  root.dataset.docId = fixture.docId;

  const recordsPanel = element('aside', 'panel overview-records stack');
  recordsPanel.dataset.testid = 'overview-records';
  recordsPanel.tabIndex = 0;
  recordsPanel.setAttribute('role', 'region');
  recordsPanel.setAttribute('aria-label', 'Contributing records');
  let openRecordsId = null;

  const spikeApi = {
    selectAndFocus(nodeId, { afterRender = false } = {}) {
      spike.select(nodeId);
      if (afterRender) {
        // The spike relayers expanded groups over two microtask ticks; the
        // focus attempt rides after the re-render, never before it.
        Promise.resolve().then(() => Promise.resolve()).then(() => spike.focusNode(nodeId));
      } else spike.focusNode(nodeId);
    },
    expandGroup(nodeId) {
      if (spike.getStats().collapsed.includes(nodeId)) spike.toggleGroup(nodeId);
    },
  };

  const routeFor = record => recordRoute(record, {
    nodes: fixture.nodes,
    drill: event => callbacks.onNodeDrill?.(event),
    selectAndFocus: spikeApi.selectAndFocus,
    expandGroup: spikeApi.expandGroup,
  });

  function openRecords({ id, title, note, records }) {
    openRecordsId = id;
    recordsPanel.replaceChildren();
    recordsPanel.append(element('h3', '', 'Contributing records'));
    const heading = element('p', 'meta overview-records-title', title ?? id);
    recordsPanel.append(heading);
    // The read-only caveat and the caller note are methodology meta — they
    // supplement through a tooltip, never as a wall of text under the list.
    // Repeated opens reuse ONE note (the previous one is retired), so a long
    // session of record browsing cannot accumulate body nodes either.
    recordsNote?.remove();
    recordsNote = ownNote(heading, `${title ?? id} · read-only projection; the records below are the sources of this value.${note ? ` ${note}` : ''}`);
    const list = element('ul', 'overview-record-list');
    if (!records.length) {
      const empty = element('li', 'overview-record overview-record-empty');
      empty.append(element('span', 'meta', 'No contributing records — this total is an exact zero or explicitly unavailable.'));
      list.append(empty);
    }
    for (const record of records) {
      const item = element('li', 'overview-record');
      item.dataset.recordId = record;
      const route = typeof callbacks.onOpenRecord === 'function'
        ? { label: 'Open record', note: 'Opens through the host-provided record route.', open: () => callbacks.onOpenRecord({ record }) }
        : routeFor(record);
      if (route) {
        const control = button('', () => route.open());
        control.className = 'overview-record-open';
        control.dataset.recordId = record;
        control.dataset.route = route.label;
        control.setAttribute('aria-label', `${route.label} — ${record}`);
        control.append(element('code', 'overview-record-id', record), element('span', 'meta overview-record-route', route.label));
        ownNote(control, route.note);
        item.append(control);
      } else {
        const code = element('code', 'overview-record-id', record);
        const unavailable = statusChip({ state: 'unavailable', label: 'No open route' });
        ownNote(unavailable, 'No source anchor or report tab is projected for this record id in this bundle; it stays listed for traceability only.');
        item.append(code, unavailable);
      }
      list.append(item);
    }
    recordsPanel.append(list);
    callbacks.onRecordsOpened?.({ id, records });
    announce(`${title ?? id}: ${records.length} contributing record${records.length === 1 ? '' : 's'} listed.`);
  }

  function openClause(clause) {
    openRecords({ id: clause.id, title: clause.text, note: 'Status sentence clause — traceable summary, not a health score.', records: clause.records });
    if (clause.ref) spikeApi.selectAndFocus(clause.ref);
    callbacks.onClauseOpened?.(clause);
  }

  function clauseChip(clause) {
    if (clause.unavailable) {
      const note = element('span', 'overview-clause-note');
      note.dataset.clauseId = clause.id;
      note.dataset.unavailable = 'true';
      note.append(statusChip({ state: 'unavailable', label: clause.text }));
      ownNote(note, 'This input is not projected in the current bundle; the clause stays explicit rather than reading as a healthy zero.');
      return note;
    }
    const control = button('', () => openClause(clause));
    control.className = 'overview-clause';
    control.dataset.clauseId = clause.id;
    control.dataset.ref = clause.ref ?? '';
    control.dataset.records = clause.records.join(',');
    control.setAttribute('aria-label', `${clause.text} — open contributing records`);
    control.append(statusChip({ state: clause.state ?? 'neutral', label: clause.text }));
    return control;
  }

  (function renderHero() {
    const hero = element('article', 'lb-card overview-hero');
    hero.dataset.testid = 'overview-hero';
    const head = element('header', 'lb-card-head overview-hero-head');
    const title = element('h2', 'lb-card-title overview-hero-title', fixture.title);
    // The project statement is a summary, not a primary statement — the
    // status sentence owns the second look, the statement rides its tooltip.
    ownNote(title, [fixture.statement.text, fixture.statement.coverage].filter(Boolean).join(' '));
    head.append(title);
    const identity = element('p', 'meta cluster overview-hero-identity');
    identity.dataset.testid = 'overview-identity';
    identity.append(statusChip({ state: 'neutral', label: fixture.projection.runtime }),
      statusChip({ state: 'neutral', label: fixture.projection.repository_key }));
    if (fixture.context?.branch) identity.append(statusChip({ state: 'neutral', label: `branch ${fixture.context.branch}` }));
    else identity.append(statusChip({ state: 'unavailable', label: 'git observation not projected' }));
    head.append(identity);
    hero.append(head);

    const statusSection = element('section', 'overview-hero-status stack');
    const statusHeading = element('h3', '', 'Status');
    ownNote(statusHeading, 'Coverage and freshness qualify the summary; absence of a finding does not prove project health.');
    const line = element('p', 'overview-sentence-line');
    line.dataset.testid = 'overview-status-sentence';
    line.setAttribute('aria-label', fixture.statusSentence.text);
    if (!fixture.statusSentence.clauses.length) line.append(element('span', 'meta', 'No status clauses projected for this bundle.'));
    for (const clause of fixture.statusSentence.clauses) line.append(clauseChip(clause), document.createTextNode(' '));
    statusSection.append(statusHeading, line);
    hero.append(statusSection);
    root.append(hero);
  })();

  (function renderAttention() {
    const attention = element('section', 'overview-attention stack');
    attention.dataset.testid = 'overview-queue';
    const heading = element('h2', '', 'Attention');
    ownNote(heading, 'Pending proposals, open reconciliations, stale baseline references and blocked readiness gate execution; items resolve only through the shared authority, never in this view.');
    attention.append(heading);
    if (!fixture.attentionQueue.length) {
      attention.append(emptyState({ icon: 'inbox', title: 'Nothing needs attention',
        detail: 'No pending proposals, open reconciliations, stale baseline references or blocked readiness in the projected records. New items arrive when baseline or readiness records change.' }));
      root.append(attention);
      return;
    }
    const list = element('ul', 'overview-attention-list');
    list.dataset.testid = 'overview-attention-list';
    list.dataset.nativeList = 'true'; // j/k traversal through the T11 focus layer
    list.setAttribute('aria-label', 'Attention queue');
    for (const item of fixture.attentionQueue) {
      const entry = element('li', 'overview-attention-row');
      entry.dataset.queueId = item.id;
      const control = button('', () => openRecords({ id: item.id, title: item.title, note: item.detail, records: item.records }));
      control.className = 'overview-attention-control';
      control.dataset.queueId = item.id;
      control.dataset.records = item.records.join(',');
      control.dataset.state = item.state;
      control.setAttribute('aria-label', `${item.title} — open contributing records`);
      control.append(statusChip({ state: item.state, label: item.chipLabel ?? item.kind }),
        element('span', 'overview-attention-title', item.title),
        element('span', 'meta overview-attention-detail', item.detail));
      entry.append(control);
      list.append(entry);
    }
    attention.append(list);
    root.append(attention);
  })();

  (function renderMetrics() {
    const metrics = element('section', 'overview-metrics stack');
    metrics.dataset.testid = 'overview-metrics';
    const heading = element('h2', '', 'Metrics');
    ownNote(heading, 'Every total opens its contributing records in the dock; unprojected inputs read as unavailable, never as zero.');
    metrics.append(heading);
    const row = element('div', 'overview-tiles');
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Compact metrics — every total opens its contributing records');
    for (const metric of fixture.metrics) {
      // The value is always the tabular figure; unavailable renders the em
      // dash plus the hollow chip, never a zero that reads as a measurement.
      const figure = element('span', 'lb-metric-value', metric.unavailable ? '—' : metric.value);
      figure.dataset.numeric = 'true';
      let tile;
      if (metric.unavailable) {
        tile = element('div', 'lb-metric overview-tile');
        tile.dataset.unavailable = 'true';
        const unavailableChip = statusChip({ state: 'unavailable', label: 'not projected' });
        ownNote(unavailableChip, metric.coverage ?? 'This input is not projected in the current bundle; it never reads as zero.');
        tile.append(figure, unavailableChip);
      } else {
        tile = button('', () => openRecords({ id: metric.id, title: metric.label, note: metric.coverage, records: metric.records }));
        tile.className = 'lb-metric overview-tile';
        tile.setAttribute('aria-label', `${metric.label}: ${metric.value} — open contributing records`);
        tile.append(figure);
        if (metric.chip) tile.append(statusChip(metric.chip));
      }
      tile.dataset.metricId = metric.id;
      tile.dataset.testid = 'overview-tile';
      tile.append(element('span', 'lb-metric-label meta', metric.label));
      if (metric.detail) tile.append(element('span', 'meta overview-tile-detail', metric.detail));
      row.append(tile);
    }
    row.addEventListener('keydown', event => {
      const controls = [...row.querySelectorAll('button[data-metric-id]')];
      const index = controls.indexOf(document.activeElement);
      if (index === -1) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = controls[(index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length];
      next.focus();
    });
    metrics.append(row);
    root.append(metrics);
  })();

  (function renderMap() {
    const mapSection = element('section', 'overview-map stack');
    mapSection.dataset.testid = 'overview-map';
    const heading = element('h2', '', 'Macro map');
    ownNote(heading, 'Durable feature areas, plans, inter-plan dependencies and attention. Graph cards render at their default zoom; the list equivalent carries the same content.');
    mapSection.append(heading, spike.element);
    root.append(mapSection);
  })();

  recordsPanel.append(element('h3', '', 'Contributing records'));
  const hint = element('p', 'meta overview-records-hint', 'Select a metric, clause or attention item to list the records behind it.');
  ownNote(hint, 'Record ids that resolve to a plan or a gate check open it; ids without a route in this bundle list the honest unavailable action.');
  recordsPanel.append(hint);
  root.append(recordsPanel);

  return {
    element: root,
    select: nodeId => spike.select(nodeId),
    focusNode: nodeId => spike.focusNode(nodeId),
    toggleGroup: nodeId => spike.toggleGroup(nodeId),
    setMode: mode => spike.setMode(mode),
    setViewport: (viewport, reason) => spike.setViewport(viewport, reason),
    fitViewport: () => spike.fitViewport(),
    applyMapUpdate: nextMapFixture => spike.applyUpdate(nextMapFixture),
    openRecords,
    // T22: retires this render's clipped notes when the view is dropped (the
    // shell calls it on every polling swap); additive — callers that ignore
    // it keep the previous behavior minus the leak.
    dispose() { for (const note of ownedNotes) note.remove?.(); ownedNotes.length = 0; recordsNote = null; },
    getStats() {
      return {
        docId: fixture.docId,
        selectedNodeId: spike.getStats().selectedId,
        clauseIds: fixture.statusSentence.clauses.map(clause => clause.id),
        metricIds: fixture.metrics.map(metric => metric.id),
        queueIds: fixture.attentionQueue.map(item => item.id),
        openRecordsId,
        map: spike.getStats(),
      };
    },
    getFixture() { return structuredClone(fixture); },
  };
}
