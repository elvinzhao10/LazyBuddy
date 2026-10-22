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
//
// V2-T4 decomposition: the view composes from named components, each a pure
// factory over fixture facts (no shared mutable state; handlers are passed
// in): createStatusHero, createAttentionList, createPlanLifecycleStrip,
// createCoverageTiles, createMacroMapSection and createFreshnessLine. The
// visual treatment stays token-driven — micro-bars render only where the
// projection carries a real ratio or comparison (no invented data), and every
// count renders as a tabular numeral.
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

// Token-driven micro-bar: proportional segments from REAL projected values
// only. Parts with non-finite or negative values drop out; a total of zero
// renders nothing (absence never draws an invented bar). The geometry is
// aria-hidden — the numbers stay visible as text in the owning surface.
export function microBar(parts) {
  const clean = (Array.isArray(parts) ? parts : []).filter(part => Number.isFinite(part?.value) && part.value >= 0);
  const total = clean.reduce((sum, part) => sum + part.value, 0);
  if (!clean.length || total <= 0) return null;
  const bar = element('span', 'overview-microbar');
  bar.dataset.testid = 'overview-microbar';
  bar.setAttribute('aria-hidden', 'true');
  for (const part of clean) {
    const segment = element('span', 'overview-microbar-segment');
    if (part.state) segment.dataset.state = part.state;
    segment.setAttribute('style', `inline-size: ${Math.max((part.value / total) * 100, 2)}%;`);
    bar.append(segment);
  }
  return bar;
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

/* -- Named components (V2-T4 decomposition) --------------------------- */

// Component 1 — status hero: project identity plus the traceable status
// sentence as designed clause chips. The statement stays a tooltip; the
// sentence owns the second look.
export function createStatusHero({ fixture, ownNote, openClause }) {
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
  for (const clause of fixture.statusSentence.clauses) {
    if (clause.unavailable) {
      const note = element('span', 'overview-clause-note');
      note.dataset.clauseId = clause.id;
      note.dataset.unavailable = 'true';
      note.append(statusChip({ state: 'unavailable', label: clause.text }));
      ownNote(note, 'This input is not projected in the current bundle; the clause stays explicit rather than reading as a healthy zero.');
      line.append(note);
      continue;
    }
    const control = button('', () => openClause(clause));
    control.className = 'overview-clause';
    control.dataset.clauseId = clause.id;
    control.dataset.ref = clause.ref ?? '';
    control.dataset.records = clause.records.join(',');
    control.setAttribute('aria-label', `${clause.text} — open contributing records`);
    control.append(statusChip({ state: clause.state ?? 'neutral', label: clause.text }));
    line.append(control);
  }
  statusSection.append(statusHeading, line);
  hero.append(statusSection);
  return hero;
}

// Component 2 — attention list: the native queue whose rows open their
// contributing records in the dock.
export function createAttentionList({ fixture, ownNote, openRecords }) {
  const attention = element('section', 'overview-attention stack');
  attention.dataset.testid = 'overview-queue';
  const heading = element('h2', '', 'Attention');
  ownNote(heading, 'Pending proposals, open reconciliations, stale baseline references and blocked readiness gate execution; items resolve only through the shared authority, never in this view.');
  attention.append(heading);
  if (!fixture.attentionQueue.length) {
    attention.append(emptyState({ icon: 'inbox', title: 'Nothing needs attention',
      detail: 'No pending proposals, open reconciliations, stale baseline references or blocked readiness in the projected records. New items arrive when baseline or readiness records change.' }));
    return attention;
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
  return attention;
}

// Component 3 — plan-lifecycle strip: the declared plan distribution across
// the three display groups. Each cell is an interactive control opening that
// group's real contributing records (exactly its plan ids); the fill width
// is the group's share of declared plans — zero counts render an honest
// empty track, never a borrowed share.
export function createPlanLifecycleStrip({ fixture, ownNote, openRecords }) {
  const strip = element('section', 'overview-lifecycle stack');
  strip.dataset.testid = 'overview-lifecycle';
  const heading = element('h2', '', 'Plan lifecycle');
  ownNote(heading, 'Declared lifecycles grouped as the projection defines them — active/paused, draft/planned, and retained history. Counts never include inferred states.');
  strip.append(heading);
  const total = ['active', 'future', 'historical'].reduce((sum, group) => sum + fixture.lifecycle[group].count, 0);
  const cells = element('div', 'overview-lifecycle-cells');
  cells.dataset.total = String(total);
  for (const group of ['active', 'future', 'historical']) {
    const entry = fixture.lifecycle[group];
    const cell = button('', () => openRecords({
      id: `lifecycle:${group}`,
      title: `Plans — ${group}`,
      note: 'Lifecycle strip segment — the records are exactly the declared plans in this group.',
      records: entry.records,
    }));
    cell.className = 'overview-lifecycle-cell';
    cell.dataset.group = group;
    cell.dataset.count = String(entry.count);
    cell.setAttribute('aria-label', `${entry.count} ${group} plan${entry.count === 1 ? '' : 's'} — open contributing records`);
    const figure = element('span', 'overview-lifecycle-count', String(entry.count));
    figure.dataset.numeric = 'true';
    cell.append(figure, element('span', 'overview-lifecycle-label', group));
    const track = element('span', 'overview-lifecycle-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('span', 'overview-lifecycle-fill');
    fill.dataset.state = group === 'active' ? 'active' : group === 'future' ? 'neutral' : 'stale';
    fill.setAttribute('style', `inline-size: ${total > 0 ? (entry.count / total) * 100 : 0}%;`);
    track.append(fill);
    cell.append(track);
    cells.append(cell);
  }
  strip.append(cells);
  if (!total) strip.append(element('p', 'meta', 'No plans are declared in this projection; the strip renders exact zeros, never borrowed counts.'));
  return strip;
}

// Component 4 — coverage tiles: the compact metric tiles. Every available
// total opens its contributing records; unavailable renders hollow, never
// zero. Micro-bars ride the tiles only where the fixture carries a real
// ratio (bar) or comparison (compare).
export function createCoverageTiles({ fixture, ownNote, openRecords }) {
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
    if (!metric.unavailable) {
      // Micro-bars from projected facts only: the satisfied/required ratio,
      // the token split, the elapsed/wall/agent minutes.
      const bar = metric.bar && metric.bar.required > 0
        ? microBar([{ label: 'satisfied', value: metric.bar.satisfied, state: 'verified' },
          { label: 'remaining', value: Math.max(metric.bar.required - metric.bar.satisfied, 0), state: 'attention' }])
        : metric.compare ? microBar(metric.compare.map(part => ({ label: part.label, value: part.value }))) : null;
      if (bar) tile.append(bar);
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
  return metrics;
}

// Component 5 — the first-class macro map section (composition view at
// default zoom; the list equivalent stays reachable through the spike).
export function createMacroMapSection({ spike, ownNote }) {
  const mapSection = element('section', 'overview-map stack');
  mapSection.dataset.testid = 'overview-map';
  const heading = element('h2', '', 'Macro map');
  ownNote(heading, 'Durable feature areas, plans, inter-plan dependencies and attention. Graph cards render at their default zoom; the list equivalent carries the same content.');
  mapSection.append(heading, spike.element);
  return mapSection;
}

// Component 6 — freshness line: one compact meta line of observed freshness
// facts (git observation, stale baseline references, plan source freshness,
// projection revisions). Every fact names its source; an unprojected input
// reads as not projected, never as fresh.
export function createFreshnessLine({ fixture, ownNote }) {
  const line = element('p', 'meta cluster overview-freshness');
  line.dataset.testid = 'overview-freshness';
  line.setAttribute('aria-label', 'Projection freshness');
  const freshness = fixture.freshness;
  const parts = [`projection revision ${freshness.revisions.projection} · baseline ${freshness.revisions.baseline} · observation ${freshness.revisions.observation}`];
  if (freshness.gitProjected) parts.push(`git observed ${freshness.observedAt ?? 'at an unstamped time'}`);
  else parts.push('git observation not projected');
  const freshnessCounts = freshness.sourceFreshness;
  parts.push(`${freshnessCounts.current} current · ${freshnessCounts.changed + freshnessCounts.missing} changed/missing plan sources`);
  parts.push(freshness.staleReferenceCount ? `${freshness.staleReferenceCount} stale baseline references` : 'no stale baseline references');
  line.append(document.createTextNode(parts.join(' · ')));
  ownNote(line, 'Freshness facts name their source records; a not-projected input never reads as fresh.');
  return line;
}

export function createOverviewView({ bundle, callbacks = {} }) {
  const fixture = overviewFixture(bundle);
  const mapFixture = { ...fixture, statement: undefined, metrics: undefined, attentionQueue: undefined, statusSentence: undefined, context: undefined, projection: undefined, lifecycle: undefined, freshness: undefined };
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

  // V2-T4 composition: named components in reading order — status hero,
  // attention list, plan-lifecycle strip, coverage tiles, macro map, then
  // the freshness line. The records panel rides last; the shell adopts it
  // into the floating inspector dock.
  root.append(
    createStatusHero({ fixture, ownNote, openClause }),
    createAttentionList({ fixture, ownNote, openRecords }),
    createPlanLifecycleStrip({ fixture, ownNote, openRecords }),
    createCoverageTiles({ fixture, ownNote, openRecords }),
    createMacroMapSection({ spike, ownNote }),
    createFreshnessLine({ fixture, ownNote }),
  );

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
        lifecycleCounts: {
          active: fixture.lifecycle.active.count,
          future: fixture.lifecycle.future.count,
          historical: fixture.lifecycle.historical.count,
        },
        map: spike.getStats(),
      };
    },
    getFixture() { return structuredClone(fixture); },
  };
}
