// V2-T5 plugin self-health view — renders the OBSERVED snapshot collected by
// dashboard/adapters/health.mjs (doctor style). Every item row carries a
// status chip whose state comes from the snapshot item itself: `ok` is an
// observed-and-matching fact, `warn` is an observed problem, `unavailable`
// means the fact was NOT observed. Honesty invariants (same family as the
// T18 panes): absent or malformed snapshots render an explicit unavailable
// surface — never zero-as-healthy, never an invented "all good" row; nothing
// in this view collects anything (read-only projection of the snapshot).
import { element, statusChip } from './components.mjs';

const CHIP_STATE = Object.freeze({ ok: 'verified', warn: 'attention', unavailable: 'unavailable' });
const ITEM_STATUSES = Object.freeze(['ok', 'warn', 'unavailable']);
export const HEALTH_VIEW_SCHEMA = 'lazybuddy/plugin-health@1';

const itemStatus = item => (ITEM_STATUSES.includes(item?.status) ? item.status : null);

function itemRow(item) {
  const row = element('li', 'health-item');
  row.dataset.testid = 'health-item';
  row.dataset.itemId = typeof item?.id === 'string' ? item.id : '';
  const status = itemStatus(item);
  if (status === null) {
    // An item the collector shape does not vouch for renders as an explicit
    // malformed row, never as a healthy one.
    row.dataset.status = 'unavailable';
    row.dataset.malformed = 'true';
    row.append(statusChip({ state: 'unavailable', label: 'malformed health item — status unobserved' }));
    return row;
  }
  row.dataset.status = status;
  if (item.code) row.dataset.code = item.code;
  const chip = statusChip({ state: CHIP_STATE[status], label: status });
  chip.dataset.testid = 'health-item-chip';
  const label = element('span', 'health-item-label', typeof item.label === 'string' ? item.label : item.id);
  const observed = element('span', 'health-item-observed');
  observed.dataset.testid = 'health-item-observed';
  if (item.observed === null || item.observed === undefined) observed.append(element('span', 'meta', 'not observed'));
  else {
    observed.dataset.numeric = typeof item.observed === 'number' ? 'true' : 'false';
    observed.append(element('code', '', String(item.observed)));
  }
  row.append(chip, label, observed);
  if (typeof item.detail === 'string' && item.detail) row.append(element('span', 'meta health-item-detail', item.detail));
  return row;
}

function sectionPanel(section) {
  const panel = element('section', 'panel stack health-section');
  panel.dataset.testid = 'health-section';
  panel.dataset.sectionId = typeof section?.id === 'string' ? section.id : '';
  panel.append(element('h3', '', typeof section?.title === 'string' ? section.title : section?.id ?? 'unnamed section'));
  if (!Array.isArray(section?.items) || section.items.length === 0) {
    panel.dataset.itemsObserved = 'false';
    panel.append(element('span', 'meta', 'no items observed for this section — nothing is inferred as healthy'));
    const unavailable = element('span', 'cluster');
    unavailable.dataset.testid = 'health-section-unavailable';
    unavailable.append(statusChip({ state: 'unavailable', label: 'section empty or malformed — unobserved' }));
    panel.append(unavailable);
    return panel;
  }
  panel.dataset.itemsObserved = 'true';
  const counts = { ok: 0, warn: 0, unavailable: 0 };
  const list = element('ul', 'health-item-list');
  list.dataset.testid = 'health-item-list';
  for (const item of section.items) {
    const status = itemStatus(item);
    if (status) counts[status] += 1;
    list.append(itemRow(item));
  }
  panel.dataset.counts = `ok ${counts.ok} · warn ${counts.warn} · unavailable ${counts.unavailable}`;
  const head = element('span', 'cluster health-section-head');
  const chip = statusChip({ state: counts.warn > 0 ? 'attention' : counts.unavailable > 0 ? 'unavailable' : 'verified',
    label: counts.warn > 0 ? `${counts.warn} warn` : counts.unavailable > 0 ? `${counts.unavailable} unobserved` : 'all observed ok' });
  chip.dataset.testid = 'health-section-chip';
  head.append(chip, element('span', 'meta', panel.dataset.counts));
  panel.append(head, list);
  return panel;
}

function leadSentence(snapshot) {
  const counts = snapshot?.summary ?? null;
  if (!counts || typeof counts.ok !== 'number') return 'Plugin self-health snapshot unobserved.';
  const observedAt = typeof snapshot.observed_at === 'string'
    && !Number.isNaN(Date.parse(snapshot.observed_at)) ? snapshot.observed_at : 'unknown time';
  return `Observed ${observedAt} by ${typeof snapshot.collector === 'string' ? snapshot.collector : 'unknown collector'}: `
    + `${counts.ok} item(s) ok · ${counts.warn} warn · ${counts.unavailable} unobserved. `
    + 'Every row is an observed fact; unobserved stays explicit and never reads as healthy.';
}

/** Renders the honest not-yet-observed surface: no ok rows, an explicit
 *  unavailable banner, and no invented per-section facts. */
function renderUnobserved(root, reason, code = null) {
  const head = element('header', 'stack health-head');
  head.append(element('h2', '', 'Plugin self-health'));
  const banner = element('div', 'panel notice');
  banner.dataset.testid = 'health-unavailable';
  const chip = statusChip({ state: 'unavailable', label: `health snapshot unavailable: ${reason}` });
  if (code) chip.dataset.code = code;
  banner.append(chip, element('p', 'meta',
    `Nothing below is inferred: with no observed snapshot, every fact stays unobserved. Zero counts never stand in for missing observations.${code ? ` Typed refusal: ${code}.` : ''}`));
  const meta = element('p', 'meta');
  meta.dataset.testid = 'health-unavailable-reason';
  meta.textContent = code ? `${reason} (${code})` : reason;
  root.replaceChildren(head, banner, meta);
  root.dataset.viewRevision = String(Number(root.dataset.viewRevision ?? 0) + 1);
  root.dataset.snapshotObserved = 'false';
}

// Shape gate: a snapshot renders only when it vouches for itself (schema,
// sections array of {id, items}); a mismatching payload is a typed malformed
// input, rendered as unavailable — never partially rendered as if observed.
function assertSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'MALFORMED_HEALTH_SNAPSHOT';
  if (snapshot.schema !== HEALTH_VIEW_SCHEMA) return 'HEALTH_SCHEMA_MISMATCH';
  if (!Array.isArray(snapshot.sections)) return 'HEALTH_SECTIONS_MISSING';
  for (const section of snapshot.sections) {
    if (section === null || typeof section !== 'object' || typeof section.id !== 'string'
      || !Array.isArray(section.items)) return 'HEALTH_SECTION_MALFORMED';
  }
  return null;
}

/**
 * V2-T5 health view factory. `adapter` (optional) is `{ read(): Promise<snapshot> }`
 * — typically the live project shell's connection to GET /api/project/health.
 * Without an adapter the view still renders standalone with its honest
 * unavailable state; `update(snapshot)` re-renders from a collected snapshot.
 */
export function createHealthView({ adapter } = {}) {
  const root = element('section', 'health-view stack');
  root.dataset.testid = 'health-view';
  let snapshot = null;
  let loadError = null;

  function render() {
    if (loadError) { renderUnobserved(root, 'the health adapter failed to deliver a snapshot', loadError); return; }
    if (!snapshot) {
      renderUnobserved(root, adapter ? 'no snapshot observed yet — the adapter has not answered' : 'no health adapter is connected to this view');
      return;
    }
    const malformed = assertSnapshot(snapshot);
    if (malformed) { renderUnobserved(root, 'the delivered snapshot is malformed and was refused whole', malformed); return; }
    const head = element('header', 'stack health-head');
    head.append(element('h2', '', 'Plugin self-health'),
      element('p', 'health-lead', leadSentence(snapshot)));
    const subject = element('p', 'meta');
    subject.dataset.testid = 'health-subject';
    subject.textContent = `plugin ${snapshot.subject?.plugin ?? 'unknown'}`
      + (snapshot.subject?.root ? ` at ${snapshot.subject.root}` : '');
    const wrap = element('div', 'stack health-sections');
    wrap.dataset.testid = 'health-sections';
    for (const section of snapshot.sections) wrap.append(sectionPanel(section));
    root.replaceChildren(head, subject, wrap);
    root.dataset.viewRevision = String(Number(root.dataset.viewRevision ?? 0) + 1);
    root.dataset.snapshotObserved = 'true';
  }

  function update(next) {
    loadError = null;
    snapshot = next;
    render();
  }

  render();
  if (adapter && typeof adapter.read === 'function') {
    adapter.read().then(update, error => {
      loadError = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
        ? error.code : 'ADAPTER_READ_FAILED';
      render();
    });
  }

  return {
    element: root,
    update,
    getStats() {
      return { snapshotObserved: Boolean(snapshot) && assertSnapshot(snapshot) === null,
        viewRevision: Number(root.dataset.viewRevision ?? 0) };
    },
  };
}
