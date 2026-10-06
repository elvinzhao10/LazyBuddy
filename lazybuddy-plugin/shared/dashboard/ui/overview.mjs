// T14 Overview view — the project Overview destination. Pure presentation over
// the read-only projection adapter (overview-fixture.mjs): short project
// statement, traceable status sentence whose clauses link to the underlying
// records, a compact metric strip where every total opens its contributing
// records, a small decision/attention queue, and the dominant macro map reused
// from the T03 composition view (project-map-spike.mjs). No commands, no
// scheduling, no file access — authority stays with the runtime and the
// shared command route.
import { button, element, statusChip } from './components.mjs';
import { createProjectMapSpike } from './project-map-spike.mjs';
import { overviewFixture } from './overview-fixture.mjs';

function clauseControl(clause, onOpen) {
  if (clause.unavailable) {
    const note = element('span', 'overview-clause-unavailable', clause.text);
    note.dataset.clauseId = clause.id;
    note.dataset.unavailable = 'true';
    note.append(statusChip({ state: 'unavailable', label: 'not projected' }));
    return note;
  }
  const control = button(clause.text, () => onOpen(clause));
  control.dataset.clauseId = clause.id;
  control.dataset.ref = clause.ref ?? '';
  control.dataset.records = clause.records.join(',');
  control.className = 'overview-clause';
  control.setAttribute('aria-label', `${clause.text} — open contributing records`);
  return control;
}

export function createOverviewView({ bundle, callbacks = {} }) {
  const fixture = overviewFixture(bundle);
  const mapFixture = { ...fixture, statement: undefined, metrics: undefined, attentionQueue: undefined, statusSentence: undefined, context: undefined, projection: undefined };
  const spike = createProjectMapSpike({ fixture: mapFixture });

  const root = element('section', 'overview-view stack');
  root.dataset.testid = 'overview-view';
  root.dataset.docId = fixture.docId;

  const recordsPanel = element('aside', 'panel overview-records stack');
  recordsPanel.dataset.testid = 'overview-records';
  recordsPanel.tabIndex = 0;
  recordsPanel.setAttribute('role', 'region');
  recordsPanel.setAttribute('aria-label', 'Contributing records');
  let openRecordsId = null;

  function openRecords({ id, title, note, records }) {
    openRecordsId = id;
    recordsPanel.replaceChildren();
    recordsPanel.append(element('h3', '', 'Contributing records'), element('p', 'meta', `${title ?? id} · read-only projection; the records below are the sources of this value.`));
    if (note) recordsPanel.append(element('p', 'meta overview-records-note', note));
    const list = element('ul', 'overview-record-list');
    if (!records.length) list.append(element('li', 'meta', 'No contributing records — this total is an exact zero or explicitly unavailable.'));
    for (const record of records) {
      const item = element('li', 'overview-record');
      item.dataset.recordId = record;
      item.append(element('code', '', record));
      list.append(item);
    }
    recordsPanel.append(list);
    callbacks.onRecordsOpened?.({ id, records });
  }

  function openClause(clause) {
    openRecords({ id: clause.id, title: clause.text, note: 'Status sentence clause — traceable summary, not a health score.', records: clause.records });
    if (clause.ref) {
      spike.select(clause.ref);
      spike.focusNode(clause.ref);
    }
    callbacks.onClauseOpened?.(clause);
  }

  (function renderHeader() {
    const head = element('header', 'overview-head stack');
    head.append(element('h2', '', fixture.title), element('p', 'meta', fixture.subtitle));
    const statement = element('section', 'overview-statement stack');
    statement.dataset.testid = 'overview-statement';
    statement.append(element('h3', '', 'Project statement'), element('p', '', fixture.statement.text),
      element('p', 'meta', fixture.statement.coverage));
    head.append(statement);

    const sentence = element('section', 'overview-sentence stack');
    sentence.dataset.testid = 'overview-status-sentence';
    sentence.append(element('h3', '', 'Status'));
    const line = element('p', 'overview-sentence-line');
    for (const clause of fixture.statusSentence.clauses) {
      line.append(clauseControl(clause, openClause), document.createTextNode(' '));
    }
    sentence.append(line, element('p', 'meta', 'Coverage and freshness qualify the summary; absence of a finding does not prove project health.'));
    head.append(sentence);
    root.append(head);
  })();

  (function renderMetrics() {
    const strip = element('section', 'overview-metrics stack');
    strip.dataset.testid = 'overview-metrics';
    strip.append(element('h3', '', 'Metrics'));
    const row = element('div', 'overview-metric-row');
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Compact metrics — every total opens its contributing records');
    for (const metric of fixture.metrics) {
      const wrap = element('div', `overview-metric${metric.unavailable ? ' overview-metric-unavailable' : ''}`);
      const control = button(`${metric.label}: ${metric.value}`, () => openRecords({ id: metric.id, title: metric.label, note: metric.coverage, records: metric.records }));
      control.dataset.metricId = metric.id;
      control.dataset.records = metric.records.join(',');
      if (metric.unavailable) control.dataset.unavailable = 'true';
      wrap.append(control, element('p', 'meta', metric.coverage));
      row.append(wrap);
    }
    row.addEventListener('keydown', event => {
      const controls = [...row.querySelectorAll('[data-metric-id]')];
      const index = controls.indexOf(document.activeElement);
      if (index === -1) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = controls[(index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length];
      next.focus();
    });
    strip.append(row, element('p', 'meta', 'Detailed metrics stay behind the strip; a wall of counters must not displace the map. Unprojected inputs read as unavailable, never as zero.'));
    root.append(strip);
  })();

  (function renderQueue() {
    const queue = element('section', 'overview-queue stack');
    queue.dataset.testid = 'overview-queue';
    queue.append(element('h3', '', 'Decisions and attention'));
    if (!fixture.attentionQueue.length) queue.append(element('p', 'meta', 'No pending proposals, conflicts or blocked readiness in the projected records.'));
    const list = element('ul', 'overview-queue-list');
    for (const item of fixture.attentionQueue) {
      const entry = element('li', 'overview-queue-item stack');
      entry.dataset.queueId = item.id;
      const head = element('span', 'cluster');
      head.append(statusChip({ state: 'attention', label: item.kind }), element('span', '', item.title));
      const control = button('Open contributing records', () => openRecords({ id: item.id, title: item.title, note: item.detail, records: item.records }));
      control.dataset.queueId = item.id;
      control.dataset.records = item.records.join(',');
      entry.append(head, element('p', 'meta', item.detail), control);
      list.append(entry);
    }
    queue.append(list);
    root.append(queue);
  })();

  root.append(spike.element, recordsPanel);
  recordsPanel.append(element('p', 'meta', 'Select a metric, clause or queue item to list the records behind it.'));

  return {
    element: root,
    select: nodeId => spike.select(nodeId),
    focusNode: nodeId => spike.focusNode(nodeId),
    toggleGroup: nodeId => spike.toggleGroup(nodeId),
    setMode: mode => spike.setMode(mode),
    openRecords,
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
