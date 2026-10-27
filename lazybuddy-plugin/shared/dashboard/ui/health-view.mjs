// V2-T5 plugin self-health view — renders the OBSERVED snapshot collected by
// dashboard/adapters/health.mjs (doctor style). Every item row carries a
// status chip whose state comes from the snapshot item itself: `ok` is an
// observed-and-matching fact, `warn` is an observed problem, `unavailable`
// means the fact was NOT observed. Honesty invariants (same family as the
// T18 panes): absent or malformed snapshots render an explicit unavailable
// surface — never zero-as-healthy, never an invented "all good" row; nothing
// in this view collects anything (read-only projection of the snapshot).
import { button, element, statusChip } from './components.mjs';

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
  return `${counts.ok} package checks passed · ${counts.warn} warning${counts.warn === 1 ? '' : 's'} · ${counts.unavailable} checks need observation. `
    + `Updated ${observedAt === 'unknown time' ? observedAt : new Date(observedAt).toLocaleString()}.`;
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
  if (snapshot.inventory != null) {
    const inventory = snapshot.inventory;
    const kinds = ['skill', 'mcp', 'hook', 'subagent'];
    if (!Array.isArray(inventory.entries) || !Array.isArray(inventory.coverage)
      || !inventory.entries.every(entry => entry && kinds.includes(entry.kind)
        && ['id', 'name', 'path', 'detail'].every(key => typeof entry[key] === 'string')
        && ['present', 'declared', 'missing'].includes(entry.package_state))
      || !inventory.coverage.every(entry => entry && kinds.includes(entry.kind)
        && ['observed', 'unavailable'].includes(entry.state)
        && (entry.state !== 'observed' || Number.isSafeInteger(entry.total) && entry.total >= 0))) return 'HEALTH_INVENTORY_MALFORMED';
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
  let pending = null;
  let inventoryQuery = ''; let inventoryKind = 'all'; let inventoryState = 'all';
  const inventoryFeedback = element('p', 'meta'); inventoryFeedback.setAttribute('role', 'status');

  function inventoryPanel(inventory) {
    const panel = element('section', 'stack health-inventory');
    panel.dataset.testid = 'health-inventory';
    panel.append(element('h3', '', 'Harness components'));
    if (!inventory || !Array.isArray(inventory.entries)) {
      panel.append(element('p', 'meta', 'Component inventory is not reported by this adapter.')); return panel;
    }
    panel.append(element('p', 'meta', 'Definitions in the serving package. Host-installed extras, enablement, connections and running agents need a matching host-session observation.'));
    const counts = element('div', 'cluster health-inventory-counts');
    for (const [kind, label] of [['skill', 'Skills'], ['mcp', 'MCP servers'], ['hook', 'Hooks'], ['subagent', 'Subagents']]) {
      const coverage = inventory.coverage?.find(entry => entry.kind === kind);
      counts.append(statusChip({ state: coverage?.state === 'observed' ? 'neutral' : 'unavailable',
        label: `${label}: ${coverage?.state === 'observed' ? coverage.total : 'not observed'}` }));
    }
    const filters = element('div', 'cluster health-inventory-filters');
    const searchLabel = element('label', '', 'Find a component');
    const search = element('input', ''); search.type = 'search'; search.value = inventoryQuery;
    search.dataset.healthFilter = 'query';
    search.placeholder = 'Name or source path'; searchLabel.append(search);
    const kindLabel = element('label', '', 'Component kind'); const kind = element('select', '');
    kind.dataset.healthFilter = 'kind';
    for (const [value, label] of [['all', 'All components'], ['skill', 'Skills'], ['mcp', 'MCP servers'], ['hook', 'Hooks'], ['subagent', 'Subagents']]) {
      const option = element('option', '', label); option.value = value; kind.append(option);
    }
    kind.value = inventoryKind; kindLabel.append(kind);
    const stateLabel = element('label', '', 'Package state'); const state = element('select', '');
    state.dataset.healthFilter = 'state';
    for (const value of ['all', 'present', 'declared', 'missing']) {
      const option = element('option', '', value === 'all' ? 'All package states' : value); option.value = value; state.append(option);
    }
    state.value = inventoryState; stateLabel.append(state);
    filters.append(searchLabel, kindLabel, stateLabel);
    const results = element('div', 'stack');
    const resultCount = element('p', 'meta'); resultCount.setAttribute('role', 'status');
    const renderResults = () => {
      const entries = inventory.entries.filter(entry => (inventoryKind === 'all' || entry.kind === inventoryKind)
        && (inventoryState === 'all' || entry.package_state === inventoryState)
        && `${entry.name} ${entry.path}`.toLocaleLowerCase().includes(inventoryQuery.trim().toLocaleLowerCase()));
      resultCount.textContent = `${entries.length} of ${inventory.entries.length} package components`;
      results.replaceChildren();
      if (!entries.length) results.append(element('p', 'meta', 'No components match these filters.'));
      for (const entry of entries) {
        const row = element('details', 'health-component'); row.dataset.componentId = entry.id;
        const summary = element('summary', '');
        summary.append(element('strong', '', entry.name), element('span', 'meta', entry.kind),
          statusChip({ state: entry.package_state === 'missing' ? 'attention' : 'neutral', label: `Package ${entry.package_state}` }));
        const body = element('div', 'stack health-component-body');
        body.append(element('code', '', entry.path), statusChip({ state: 'unavailable', label: 'Host activity unobserved' }),
          element('p', 'meta', entry.detail));
        const copy = button('Copy maintenance context', async () => {
          const context = `Inspect ${entry.kind} ${entry.name} in ${inventory.runtime}.\nPackage source: ${entry.path}\nPackage state: ${entry.package_state}\nHost activity: unobserved. Verify in the current host session before changing configuration.\nRequested change: `;
          try { await navigator.clipboard.writeText(context); inventoryFeedback.textContent = 'Copied. Paste into your agent chat and describe the change; nothing was sent.'; }
          catch { const text = element('textarea', ''); text.value = context; text.readOnly = true; text.setAttribute('aria-label', 'Maintenance context'); body.append(text); text.focus(); text.select?.(); inventoryFeedback.textContent = 'Select and copy the context manually.'; }
        });
        body.append(copy); row.append(summary, body); results.append(row);
      }
    };
    search.addEventListener('input', () => { inventoryQuery = search.value; renderResults(); });
    kind.addEventListener('change', () => { inventoryKind = kind.value; renderResults(); });
    state.addEventListener('change', () => { inventoryState = state.value; renderResults(); });
    const clear = button('Clear filters', () => { inventoryQuery = ''; inventoryKind = 'all'; inventoryState = 'all';
      search.value = ''; kind.value = 'all'; state.value = 'all'; renderResults(); search.focus(); });
    filters.append(clear); renderResults();
    const limited = inventory.coverage?.filter(entry => entry.shown != null && entry.shown < entry.total) ?? [];
    panel.append(counts, filters, resultCount, inventoryFeedback, results);
    if (limited.length) panel.append(element('p', 'meta', `Inventory limit: ${limited.map(entry => `${entry.kind} ${entry.shown} of ${entry.total}`).join(', ')}. Narrow the serving package to inspect more.`));
    return panel;
  }
  const refreshControl = button('Refresh health', () => refresh());
  const refreshStatus = element('p', 'meta'); refreshStatus.setAttribute('role', 'status');

  function renderContent() {
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
    subject.textContent = `Serving package: ${snapshot.subject?.plugin ?? 'unknown'}. Package checks do not establish native host readiness.`;
    const wrap = element('div', 'stack health-sections');
    wrap.dataset.testid = 'health-sections';
    for (const section of snapshot.sections) wrap.append(sectionPanel(section));
    const checks = element('details', 'health-checks');
    checks.append(element('summary', '', 'Package diagnostics and runtime checks'), wrap);
    if (snapshot.subject?.root) checks.append(element('p', 'meta', `Package location: ${snapshot.subject.root}`));
    root.replaceChildren(head, subject, inventoryPanel(snapshot.inventory), checks);
    root.dataset.viewRevision = String(Number(root.dataset.viewRevision ?? 0) + 1);
    root.dataset.snapshotObserved = 'true';
  }

  function render() {
    renderContent();
    if (adapter && typeof adapter.read === 'function') {
      const actions = element('div', 'cluster health-refresh'); actions.append(refreshControl, refreshStatus); root.prepend(actions);
    }
  }

  function update(next) {
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const filter = focused?.dataset?.healthFilter;
    const selection = filter === 'query' ? [focused.selectionStart, focused.selectionEnd] : null;
    loadError = null;
    snapshot = next;
    render();
    if (filter) {
      const current = [...root.querySelectorAll('[data-health-filter]')].find(control => control.dataset.healthFilter === filter);
      current?.focus();
      if (selection && Number.isInteger(selection[0])) current?.setSelectionRange?.(...selection);
    }
  }

  function refresh() {
    if (pending) return pending;
    if (!adapter || typeof adapter.read !== 'function') return Promise.resolve();
    let restoreFocus = document.activeElement === refreshControl;
    refreshControl.disabled = true; refreshStatus.textContent = 'Checking current package health…';
    pending = Promise.resolve().then(() => adapter.read()).then(next => {
      restoreFocus = restoreFocus && (document.activeElement === refreshControl || document.activeElement === document.body);
      update(next); refreshStatus.textContent = 'Health observations refreshed.';
    }, error => {
      loadError = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
        ? error.code : 'ADAPTER_READ_FAILED';
      render(); refreshStatus.textContent = 'Health could not refresh. Retry when the service is available.';
    }).finally(() => { pending = null; refreshControl.disabled = false; if (restoreFocus) refreshControl.focus(); });
    return pending;
  }

  render();
  if (adapter && typeof adapter.read === 'function') refresh();

  return {
    element: root,
    update,
    refresh,
    getStats() {
      return { snapshotObserved: Boolean(snapshot) && assertSnapshot(snapshot) === null,
        viewRevision: Number(root.dataset.viewRevision ?? 0) };
    },
  };
}
