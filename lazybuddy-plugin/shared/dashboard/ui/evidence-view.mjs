// T19 evidence and research view — the library redesign on the T12 component
// library. One reading surface composed from T12 primitives: a filterable,
// paginated index (dataTable with tabular bytes/digest columns and
// applicable-version chips) beside a reading pane that carries the selected
// artifact's digest provenance and the safe preview with reading typography.
// The view receives honest pages from an injected loadPage (T12's paginate
// output) and safe preview data from an injected loadPreview (T12's
// renderArtifactPreview output); it owns no pagination math and never touches
// the filesystem. The filter is a declared presentation lens: it narrows the
// scope's own recorded pages (fetched through loadPage, never recomputed) and
// every count it shows names both sides ("filter matches M of N indexed") —
// the index totals stay T12's alone. Missing, moved and inaccessible
// artifacts render explicit states everywhere, never silent drops; a failing
// page loader keeps the last honest page with a typed note. Every rendered
// byte of artifact or research content lands through textContent — markup in
// artifact bytes is inert text data here even before T12's own sanitization.
// Cross-links run both ways: scope buttons filter the rows, and a row's
// task/gate/plan/feature version chip navigates to that scope. The
// research-to-proposal affordance opens the proposal flow through onOpenItem
// only; the view itself grants nothing.
import {
  button, dataTable, element, emptyState, formField, segmentedControl, skeleton, statusChip,
} from './components.mjs';

const NAVIGATION_SCOPES = ['global', 'task', 'gate', 'plan', 'feature'];
const STATUSES = ['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible'];
const CHIP_STATES = { available: 'active', missing: 'failed', moved: 'stale', redacted: 'attention',
  unsupported: 'unavailable', inaccessible: 'unavailable' };
const MODES = ['table', 'list'];
const FILTER_LIMIT = 256;

function viewError(code, detail = '') {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}

function validateFixture(fixture) {
  if (fixture === null || typeof fixture !== 'object' || !Array.isArray(fixture.entries) ||
    typeof fixture.total !== 'number' || !Array.isArray(fixture.scopes)) {
    throw new Error('INVALID_EVIDENCE_FIXTURE: the evidence view composes a T19 evidence fixture');
  }
  const known = new Set(fixture.statuses ?? STATUSES);
  for (const entry of fixture.entries) {
    if (!known.has(entry.status)) throw new Error(`UNKNOWN_ARTIFACT_STATUS: ${entry.status}`);
  }
  return fixture;
}

const navLabelOf = nav => (nav.scope === 'global' ? 'global index' : `${nav.scope} ${nav.id}`);
const navKeyOf = nav => (nav.scope === 'global' ? 'global' : `${nav.scope}:${nav.id}`);
const isThenable = value => value !== null && typeof value === 'object' && typeof value.then === 'function';
const digestShort = value => (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? `${value.slice(0, 12)}…` : null);

// Filter tokens: plain terms match artifact id/path/type (case-insensitive
// substring); a `status:<word>` term matches the exact status name. All terms
// must match. The vocabulary is deliberately tiny and total — no fuzzy, no
// ranking, nothing that could imply an unrecorded ordering.
function tokenizeFilter(query) {
  return String(query ?? '').slice(0, FILTER_LIMIT).toLowerCase().split(/\s+/)
    .filter(token => token.length > 0).slice(0, 8);
}

function entryMatchesFilter(entry, tokens) {
  const haystack = `${entry.id}\n${entry.path ?? ''}\n${entry.type ?? ''}`.toLowerCase();
  for (const token of tokens) {
    if (token.startsWith('status:')) {
      if (entry.status !== token.slice('status:'.length)) return false;
      continue;
    }
    if (!haystack.includes(token)) return false;
  }
  return true;
}

export function createEvidenceView({ fixture: initialFixture, nav = { scope: 'global' }, page = 1,
  mode = 'table', loadPage, loadPreview, callbacks = {} }) {
  let currentFixture = structuredClone(validateFixture(initialFixture));
  let currentNav = null;
  let requestedPage = Math.max(1, Number.isSafeInteger(page) ? page : 1);
  let currentMode = MODES.includes(mode) ? mode : 'table';
  let selectedArtifactId = null;
  let previewRequestedFor = null;
  let lastPage = null;
  let viewRevision = 0;
  let lastUpdate = null;
  let statusNote = 'Evidence view ready.';
  let pageLoadError = null;
  let filterQuery = '';
  let filterTokens = [];
  let filterMatches = null; // null = lens off; array = matching entries of the current scope
  let filterPage = 1;
  let previewRevision = 0;
  let scopeIndexPending = null;
  const previewCache = new Map();
  const scopeIndexCache = new Map(); // scope key -> every recorded page entry, concatenated

  const root = element('section', 'evidence-view stack');
  root.dataset.testid = 'evidence-view';
  root.dataset.docId = currentFixture.docId;

  // The frame is built once and only its dynamic containers re-render, so the
  // filter input never loses focus and the segmented control keeps its own
  // state across data refreshes.
  const headerTitle = element('h2', '', currentFixture.title);
  const headerSubtitle = element('p', 'meta evidence-subtitle', currentFixture.subtitle);
  const projectLine = element('p', 'meta evidence-project');
  projectLine.dataset.testid = 'evidence-project';
  const toolbar = element('div', 'cluster evidence-toolbar');
  const head = element('header', 'evidence-head stack');
  head.append(headerTitle, headerSubtitle, projectLine, toolbar);

  const status = element('p', 'meta evidence-status', statusNote);
  status.dataset.testid = 'evidence-status';
  status.setAttribute('role', 'status');

  const scopesHost = element('section', 'panel evidence-scopes stack');
  scopesHost.dataset.testid = 'evidence-scopes';
  scopesHost.append(element('h3', '', 'Collection scope'),
    element('p', 'meta', 'Navigate the indexed collection from a task, gate, plan, feature or globally. Scope switching is a read-only query; the exact filtered set comes from the artifact index.'));

  const collectionHost = element('section', 'panel evidence-collection stack');
  collectionHost.dataset.testid = 'evidence-collection';

  const inspector = element('aside', 'panel evidence-inspector stack');
  inspector.dataset.testid = 'evidence-inspector';
  inspector.tabIndex = 0;
  inspector.setAttribute('role', 'region');
  inspector.setAttribute('aria-label', 'Artifact reading pane and safe preview');

  const main = element('div', 'evidence-main stack');
  main.append(scopesHost, collectionHost);
  const columns = element('div', 'evidence-columns');
  columns.dataset.testid = 'evidence-body';
  columns.append(main, inspector);

  const researchHost = element('section', 'panel evidence-research stack');
  researchHost.dataset.testid = 'evidence-research';
  const refusalsHost = element('section', 'panel evidence-refusals stack');
  refusalsHost.dataset.testid = 'evidence-refusals';
  root.append(head, status, columns, researchHost, refusalsHost);

  const entryOf = id => currentFixture.entries.find(entry => entry.id === id) ?? null;

  // -- toolbar (built once) ------------------------------------------------

  const modeSegmented = segmentedControl({
    label: 'Index layout',
    options: [{ value: 'table', label: 'Table' }, { value: 'list', label: 'List' }],
    current: currentMode,
    onChange: value => setMode(value),
  });
  modeSegmented.element.dataset.testid = 'evidence-mode-switcher';
  toolbar.append(modeSegmented.element);

  const filterInput = element('input', 'evidence-filter-input');
  filterInput.setAttribute('type', 'search');
  filterInput.setAttribute('maxlength', String(FILTER_LIMIT));
  filterInput.dataset.nativeFilter = 'true';
  filterInput.dataset.testid = 'evidence-filter';
  filterInput.addEventListener('input', () => { setFilter(filterInput.value); });
  const filterField = formField({ label: 'Filter this scope', name: 'evidence-index-filter', control: filterInput,
    help: 'Terms match artifact id, path and type; status:<state> matches one state. Index totals stay the artifact package\'s.' });
  filterField.classList.add('evidence-filter-field');
  toolbar.append(filterField);
  toolbar.append(element('span', 'meta evidence-legend',
    'states: available · missing · moved · redacted · unsupported · inaccessible — totals and truncation always shown'));

  // -- data plumbing -------------------------------------------------------

  function scopePageCount(targetNav) {
    const scope = currentFixture.scopes.find(candidate => candidate.key === navKeyOf(targetNav));
    return scope ? scope.page_count : 1;
  }

  // A page is honest only when it carries the T12 paginate shape; anything
  // else (missing entries array, non-numeric total) is a typed load failure
  // that keeps the last honest page instead of rendering junk.
  function assertPageShape(composed, targetNav, targetPage) {
    if (composed === null || typeof composed !== 'object' || !Array.isArray(composed.entries) ||
      !Number.isSafeInteger(composed.total) || !Number.isSafeInteger(composed.page_count)) {
      throw viewError('INVALID_PAGE', `the loader returned a malformed page for ${navKeyOf(targetNav)} page ${targetPage}`);
    }
    return composed;
  }

  function noteLoadFailure(error) {
    pageLoadError = error?.code ?? error?.message ?? 'unknown error';
    statusNote = `page load failed (${pageLoadError}) — ${lastPage ? `showing the last honest page ${lastPage.page}` : 'no page has loaded yet'}.`;
    viewRevision += 1;
    fullRender();
    callbacks.onLoadError?.({ code: pageLoadError, nav: structuredClone(currentNav) });
  }

  // Applies the honest page from the injected loader (T12 paginate output).
  // The loader always receives the CURRENT fixture, so a polling update pages
  // the new data, never the fixture the caller originally bound. Clamping uses
  // the fixture's recorded page counts, so a request beyond the last page is
  // clamped BEFORE loading and the visible page always reflects what is shown.
  function fetchPageSync(targetNav, targetPage) {
    const requested = Math.max(1, Number.isSafeInteger(targetPage) ? targetPage : 1);
    const pageCount = scopePageCount(targetNav);
    const clamped = Math.min(requested, pageCount);
    if (clamped !== requested) {
      statusNote = `requested page ${requested} is beyond the last page ${pageCount} — clamped to ${clamped}; totals stay honest.`;
    }
    const apply = composed => {
      lastPage = assertPageShape(composed, targetNav, clamped);
      pageLoadError = null;
      return lastPage.page;
    };
    const fail = error => { noteLoadFailure(error); return lastPage ? lastPage.page : null; };
    let outcome;
    try {
      outcome = loadPage(currentFixture, targetNav, clamped);
      if (!isThenable(outcome)) return apply(outcome);
    } catch (error) {
      return fail(error);
    }
    return outcome.then(apply, fail);
  }

  // Every recorded page of one scope, concatenated — the filter narrows THIS
  // list, fetched through the same injected loader, so a filtered view can
  // never see an entry T12's pagination never produced.
  function ensureScopeIndex(targetNav) {
    const key = navKeyOf(targetNav);
    if (scopeIndexCache.has(key)) return Promise.resolve(scopeIndexCache.get(key));
    if (scopeIndexPending && scopeIndexPending.key === key) return scopeIndexPending.promise;
    const pageCount = scopePageCount(targetNav);
    const fixtureAtStart = currentFixture;
    const collected = [];
    let meta = null;
    const grab = async () => {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const outcome = loadPage(currentFixture, targetNav, pageNumber);
        const composed = isThenable(outcome) ? await outcome : outcome;
        assertPageShape(composed, targetNav, pageNumber);
        collected.push(...composed.entries);
        meta = composed;
      }
      if (fixtureAtStart !== currentFixture) {
        // a polling update swapped the fixture mid-collection: the stale set
        // must never land in the cache of the new fixture
        throw viewError('STALE_SCOPE_INDEX', 'the fixture changed while collecting this scope');
      }
      const record = { entries: collected, total: meta.total, page_size: meta.page_size,
        page_count: Math.max(1, meta.page_count ?? pageCount), coverage: meta.coverage ?? null };
      scopeIndexCache.set(key, record);
      return record;
    };
    const promise = grab();
    scopeIndexPending = { key, promise };
    const settled = () => { if (scopeIndexPending?.promise === promise) scopeIndexPending = null; };
    promise.then(settled, settled);
    return promise;
  }

  function computeFilterMatches(targetNav) {
    const record = scopeIndexCache.get(navKeyOf(targetNav));
    if (!record) return null;
    return record.entries.filter(entry => entryMatchesFilter(entry, filterTokens));
  }

  function filterPageCountValue(matches = filterMatches) {
    if (!filterTokens.length || !matches) return null;
    const pageSize = lastPage?.page_size ?? currentFixture.page_defaults?.page_size ?? 50;
    return Math.max(1, Math.ceil(matches.length / pageSize));
  }

  function displayedEntries() {
    if (!filterTokens.length || !filterMatches) return lastPage?.entries ?? [];
    const pageSize = lastPage?.page_size ?? currentFixture.page_defaults?.page_size ?? 50;
    const pageCount = Math.max(1, Math.ceil(filterMatches.length / pageSize));
    const clamped = Math.min(Math.max(1, filterPage), pageCount);
    filterPage = clamped;
    return filterMatches.slice((clamped - 1) * pageSize, clamped * pageSize);
  }

  // -- rendering -----------------------------------------------------------

  function renderProjectLine() {
    const scan = currentFixture.scan ?? {};
    const skipped = scan.skipped ?? [];
    const skippedCount = Number.isSafeInteger(scan.skipped_count) ? scan.skipped_count : skipped.length;
    projectLine.textContent = `project revision ${currentFixture.projectRevision ?? 'none'} · scan ${scan.runs_indexed ?? '?'} runs indexed of ${scan.runs_discovered ?? '?'} discovered · ${scan.files_seen ?? '?'} files seen · indexed ${currentFixture.total} artifacts`
      + (skippedCount
        ? ` · skipped ${skippedCount} file${skippedCount === 1 ? '' : 's'}${skipped.length ? ` (first: ${skipped[0].path ?? 'unknown path'} — ${skipped[0].reason ?? 'unknown reason'})` : ''}`
        : '')
      + (scan.history_status === 'unavailable' ? ` · native history unavailable: ${scan.history_reason}` : '');
  }

  function renderScopes() {
    const existing = scopesHost.querySelector('.evidence-scope-list');
    if (existing) existing.remove();
    const list = element('div', 'cluster evidence-scope-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Collection scopes');
    for (const scope of currentFixture.scopes) {
      const control = button(`${scope.label} (${scope.total})`, () => navigate(structuredClone(scope.nav)));
      control.dataset.scopeKey = scope.key;
      control.dataset.scopeTotal = String(scope.total);
      control.setAttribute('aria-pressed', String(Boolean(currentNav) && navKeyOf(currentNav) === scope.key));
      list.append(control);
    }
    scopesHost.append(list);
  }

  function versionChip(version) {
    const label = `${version.kind} ${version.label}`;
    if (version.nav && NAVIGATION_SCOPES.includes(version.nav.scope)) {
      const control = button(label, () => navigate(structuredClone(version.nav)));
      control.className = 'evidence-version-chip';
      control.dataset.versionKind = version.kind;
      control.dataset.navKey = navKeyOf(version.nav);
      control.setAttribute('aria-label', `Show the ${version.nav.scope} scope ${version.nav.id}`);
      return control;
    }
    const chip = element('span', 'evidence-version-chip', label);
    chip.dataset.versionKind = version.kind;
    return chip;
  }

  function versionChips(entry) {
    const holder = element('span', 'cluster evidence-versions');
    for (const version of entry.versions ?? []) holder.append(versionChip(version));
    if (!holder.childNodes.length) holder.append(element('span', 'meta', '—'));
    return holder;
  }

  function artifactRowButton(entry, { withPath = false } = {}) {
    const control = button('');
    const listMode = currentMode === 'list';
    control.className = `evidence-row${listMode ? ' evidence-row-list' : ''}`;
    control.dataset.artifactId = entry.id;
    control.dataset.status = entry.status;
    control.setAttribute('aria-pressed', 'false');
    const headSpan = element('span', 'cluster evidence-row-head');
    headSpan.append(element('code', 'evidence-row-id', entry.id));
    if (entry.type) headSpan.append(element('span', 'meta evidence-row-type', entry.type));
    // The state chip lives in the table's own State column; list rows carry it
    // inline because they have no columns.
    if (listMode) headSpan.append(statusChip({ state: CHIP_STATES[entry.status] ?? 'unavailable', label: entry.stateSentence }));
    control.append(headSpan);
    if (withPath) control.append(element('code', 'evidence-row-path', entry.path));
    control.title = entry.provenance ?? ''; // supplementary; the reading pane carries the full sentences
    control.addEventListener('click', () => select(entry.id));
    return control;
  }

  // The library index: T12's dataTable with tabular bytes/digest columns and
  // the applicable-version chips (cross-linking row -> scope).
  function renderIndexTable(entries) {
    const columns = [
      { key: 'artifact', label: 'Artifact' },
      { key: 'state', label: 'State' },
      { key: 'versions', label: 'Applies to' },
      { key: 'bytes', label: 'Bytes', numeric: true },
      { key: 'digest', label: 'Digest', numeric: true },
    ];
    const rows = entries.map(entry => {
      const digest = digestShort(entry.sha256);
      const digestCell = element('code', 'evidence-digest', digest ?? 'none');
      if (digest) digestCell.title = entry.sha256;
      return [
        artifactRowButton(entry),
        statusChip({ state: CHIP_STATES[entry.status] ?? 'unavailable', label: entry.stateSentence }),
        versionChips(entry),
        Number.isSafeInteger(entry.bytes) ? String(entry.bytes) : '—',
        digestCell,
      ];
    });
    const filtered = Boolean(filterTokens.length && filterMatches);
    const caption = filtered
      ? `${navLabelOf(currentNav)} · filter "${filterQuery}" · ${filterMatches.length} match${filterMatches.length === 1 ? '' : 'es'} of ${lastPage?.total ?? '?'} indexed — the lens narrows recorded pages only`
      : `${navLabelOf(currentNav)} · ${lastPage?.total ?? 0} indexed artifact${(lastPage?.total ?? 0) === 1 ? '' : 's'} · every page reports its own total`;
    const table = dataTable({ columns, rows, caption, testid: 'evidence-index-table' });
    table.dataset.testid = 'evidence-index'; // the scroll wrapper carries the view-level state
    table.dataset.nativeList = 'true'; // j/k traversal through the T11 focus layer
    table.dataset.scopeKey = currentNav ? navKeyOf(currentNav) : 'global';
    table.dataset.filterActive = String(filtered);
    return table;
  }

  function renderIndexList(entries) {
    const list = element('ol', 'evidence-list');
    list.dataset.nativeList = 'true';
    list.dataset.filterActive = String(Boolean(filterTokens.length && filterMatches));
    for (const entry of entries) {
      const item = element('li', '');
      item.append(artifactRowButton(entry, { withPath: true }));
      list.append(item);
    }
    return list;
  }

  function renderCollection() {
    collectionHost.replaceChildren(element('h3', '', 'Collection index'));
    const navContext = element('p', 'meta evidence-nav');
    navContext.dataset.testid = 'evidence-nav';
    const filtered = Boolean(filterTokens.length && filterMatches);
    const total = filtered ? filterMatches.length : lastPage?.total ?? 0;
    navContext.textContent = `${navLabelOf(currentNav)} · ${total} artifact${total === 1 ? '' : 's'}`
      + (filtered
        ? ` matching "${filterQuery}" of ${lastPage?.total ?? '?'} indexed in this scope`
        : total === 0 ? ' — exact zero, not a hidden set' : '');
    if (currentNav && currentNav.scope !== 'global') {
      const out = button(`Open the ${currentNav.scope} context`, () =>
        callbacks.onNavigateOut?.(structuredClone(currentNav)));
      out.dataset.navOut = currentNav.scope;
      out.dataset.navOutId = currentNav.id ?? '';
      navContext.append(' ', out);
    }
    collectionHost.append(navContext);

    if (lastPage === null) {
      if (pageLoadError) {
        const retry = button('Retry the page load', () => navigate(structuredClone(currentNav ?? { scope: 'global' })));
        retry.dataset.testid = 'evidence-retry';
        collectionHost.append(emptyState({ icon: 'search', title: 'The index page did not load',
          detail: `page load failed (${pageLoadError}) — no fabricated rows render. Retry loads the honest page again.`, action: retry }));
        return;
      }
      collectionHost.append(skeleton({ lines: 6, testid: 'evidence-loading', label: 'Loading the index page' }),
        element('p', 'meta', 'Loading the honest page from the artifact package — no zero-as-value placeholder renders meanwhile.'));
      return;
    }

    const pagination = element('div', 'cluster evidence-pagination');
    pagination.dataset.testid = 'evidence-pagination';
    const pageCount = filtered ? filterPageCountValue() : lastPage.page_count;
    const currentPage = filtered ? filterPage : lastPage.page;
    const previous = button('Previous page', () => (filtered ? setFilterPage(filterPage - 1) : setPage(lastPage.page - 1)));
    previous.dataset.pageAction = 'prev';
    previous.disabled = currentPage <= 1;
    const indicator = element('span', 'meta evidence-page-indicator',
      `${filtered ? 'Filter page' : 'Page'} ${currentPage} of ${pageCount}`);
    indicator.dataset.testid = 'evidence-page-indicator';
    const next = button('Next page', () => (filtered ? setFilterPage(filterPage + 1) : setPage(lastPage.page + 1)));
    next.dataset.pageAction = 'next';
    next.disabled = filtered ? filterPage >= pageCount : !lastPage.has_next;
    pagination.append(previous, indicator, next);
    collectionHost.append(pagination);

    const shown = displayedEntries();
    const totals = element('p', 'meta evidence-totals');
    totals.dataset.testid = 'evidence-totals';
    totals.textContent = filtered
      ? `index total ${lastPage.total} · filter matches ${filterMatches.length} · filter page ${filterPage} of ${filterPageCountValue()} · page size ${lastPage.page_size} · showing ${shown.length}`
      : `total ${lastPage.total} · page size ${lastPage.page_size} · showing ${lastPage.entries.length} · truncation ${lastPage.truncated ? 'yes' : 'none'}`;
    collectionHost.append(totals);

    const coverage = element('p', 'meta evidence-coverage');
    coverage.dataset.testid = 'evidence-coverage';
    const byStatus = lastPage.coverage?.by_status
      ?? Object.fromEntries(STATUSES.map(name => [name, 0]));
    coverage.textContent = `scope coverage: ${STATUSES.map(name => `${name} ${byStatus[name] ?? 0}`).join(' · ')}`;
    collectionHost.append(coverage);
    if (filtered) {
      const filterCoverage = Object.fromEntries(STATUSES.map(name => [name, 0]));
      for (const entry of filterMatches) filterCoverage[entry.status] = (filterCoverage[entry.status] ?? 0) + 1;
      const line = element('p', 'meta evidence-filter-coverage');
      line.dataset.testid = 'evidence-filter-coverage';
      line.textContent = `filter coverage: ${STATUSES.map(name => `${name} ${filterCoverage[name]}`).join(' · ')}`;
      collectionHost.append(line);
    }

    if (filterTokens.length && !filterMatches) {
      collectionHost.append(element('p', 'meta', 'Collecting this scope\'s recorded pages for the filter — the unfiltered page stays visible below.'));
    }
    if (!shown.length) {
      collectionHost.append(element('p', 'meta', filterTokens.length
        ? `No artifacts in this scope match "${filterQuery}" — an exact zero for the filter; the index total ${lastPage.total} is unchanged.`
        : 'No artifacts in this scope — an exact zero, never a silent blank.'));
    }
    collectionHost.append(currentMode === 'list' ? renderIndexList(shown) : renderIndexTable(shown));
  }

  function previewBlockNode(block) {
    // Inert by construction: every artifact byte renders through textContent.
    if (block.type === 'heading') return element(`h${Math.min(6, 3 + (block.level ?? 1))}`, 'evidence-preview-heading', block.text);
    if (block.type === 'quote') return element('blockquote', 'evidence-preview-quote', block.text);
    if (block.type === 'list_item') return element('li', '', block.text);
    if (block.type === 'code') {
      const pre = element('pre', 'evidence-preview-code');
      pre.append(element('code', '', block.text));
      return pre;
    }
    return element('p', 'evidence-preview-paragraph', block.text);
  }

  function renderPreviewBody(previewArea, preview) {
    previewArea.dataset.previewKind = String(preview?.kind ?? 'none');
    previewArea.dataset.previewAvailable = String(Boolean(preview?.available));
    if (!preview) {
      previewArea.append(element('p', 'meta', 'No preview requested yet. Select an artifact to read its safe preview.'));
      return;
    }
    previewArea.append(element('p', 'meta', `original file: ${preview.original?.link ?? preview.source_path ?? 'unknown'}`));
    if (!preview.available) {
      previewArea.append(element('p', 'meta evidence-preview-unavailable', `preview unavailable — reason: ${preview.reason ?? 'unknown'}`));
      return;
    }
    if (preview.kind === 'markdown') {
      const body = element('div', 'evidence-preview-markdown stack');
      const listItems = [];
      for (const block of preview.blocks ?? []) {
        if (block.type === 'list_item') { listItems.push(block); continue; }
        if (listItems.length) {
          const list = element('ul', 'evidence-preview-list');
          for (const item of listItems.splice(0)) list.append(previewBlockNode(item));
          body.append(list);
        }
        body.append(previewBlockNode(block));
      }
      if (listItems.length) {
        const list = element('ul', 'evidence-preview-list');
        for (const item of listItems) list.append(previewBlockNode(item));
        body.append(list);
      }
      previewArea.append(body);
      const report = preview.sanitization ?? { removed_html_tags: 0, removed_script_blocks: 0, removed_js_urls: 0, links: [] };
      const linksKept = (report.links ?? []).map(link => `${link.text} → ${link.href}`).join(' · ');
      previewArea.append(element('p', 'meta evidence-preview-sanitization',
        `sanitization report: ${report.removed_script_blocks} script block${report.removed_script_blocks === 1 ? '' : 's'} removed · ${report.removed_html_tags} tag${report.removed_html_tags === 1 ? '' : 's'} stripped · ${report.removed_js_urls} unsafe URL${report.removed_js_urls === 1 ? '' : 's'} removed${linksKept ? ` · links kept as text: ${linksKept}` : ''} · sanitized by the artifact package, rendered as text`));
      return;
    }
    if (preview.kind === 'image' && preview.image) {
      const image = element('img', 'evidence-preview-image');
      image.setAttribute('src', preview.image.data_url);
      image.setAttribute('alt', `screenshot preview of ${preview.source_path}`);
      previewArea.append(image);
      previewArea.append(element('p', 'meta', `image ${preview.image.bytes} bytes · sha256 ${preview.image.sha256?.slice(0, 12)}… · data URL from the artifact package (fixed mime allowlist)`));
      return;
    }
    if (preview.kind === 'json') {
      const pre = element('pre', 'evidence-preview-code');
      pre.append(element('code', '', preview.json?.canonical ?? preview.text?.content ?? ''));
      previewArea.append(pre);
      previewArea.append(element('p', 'meta', preview.json
        ? `canonical JSON · truncated: ${preview.json.truncated ? `yes — ${preview.json.canonical.length} of ${preview.json.total_bytes} bytes` : 'no'}`
        : 'invalid JSON — rendered as text data'));
      return;
    }
    const content = preview.text?.content ?? '';
    const pre = element('pre', 'evidence-preview-code');
    pre.append(element('code', '', content));
    previewArea.append(pre);
    if (preview.text) {
      previewArea.append(element('p', 'meta', preview.text.truncated
        ? `truncated at ${preview.text.content.length} of ${preview.text.total_bytes} bytes — preview truncation is always flagged`
        : `${preview.text.total_bytes} bytes · complete`));
    }
  }

  function renderInspector() {
    inspector.replaceChildren(element('h3', '', 'Reading pane'));
    const entry = selectedArtifactId ? entryOf(selectedArtifactId) : null;
    if (!entry) {
      inspector.append(element('p', 'meta', 'Select an index row to read its applicability, digest provenance and safe preview.'));
      const placeholder = element('div', 'evidence-preview stack');
      placeholder.dataset.testid = 'evidence-preview';
      placeholder.dataset.previewKind = 'none';
      placeholder.append(element('p', 'meta', 'No preview requested yet.'));
      inspector.append(placeholder);
      return;
    }
    const headSpan = element('span', 'cluster');
    headSpan.append(element('code', 'evidence-row-id', entry.id));
    headSpan.append(statusChip({ state: CHIP_STATES[entry.status] ?? 'unavailable', label: entry.stateSentence }));
    inspector.append(headSpan);
    inspector.append(element('code', 'evidence-row-path', entry.path));
    inspector.append(element('p', 'meta', entry.appliesTo));
    inspector.append(element('p', 'meta', `${entry.provenance}${entry.registered ? ` · registered by ${entry.registered.producer}` : ''}${entry.origins.length ? ` · origins: ${entry.origins.join('+')}` : ''}`));
    const versions = element('span', 'cluster evidence-versions evidence-pane-versions');
    for (const version of entry.versions ?? []) versions.append(versionChip(version));
    if (versions.childNodes.length) inspector.append(versions);

    const previewArea = element('div', 'evidence-preview stack');
    previewArea.dataset.testid = 'evidence-preview';
    if (previewCache.has(entry.id)) {
      renderPreviewBody(previewArea, previewCache.get(entry.id));
    } else {
      previewArea.dataset.previewKind = 'loading';
      previewArea.append(skeleton({ lines: 4, testid: 'evidence-preview-loading', label: 'Loading the safe preview' }));
      previewArea.append(element('p', 'meta',
        previewRequestedFor === entry.id ? 'Loading safe preview…' : 'Select again to load this artifact\'s safe preview.'));
    }
    inspector.append(previewArea);
  }

  async function loadPreviewFor(entry) {
    const revision = ++previewRevision;
    const previewArea = () => inspector.querySelector('[data-testid="evidence-preview"]');
    if (previewCache.has(entry.id)) {
      const area = previewArea();
      if (area) {
        area.replaceChildren();
        renderPreviewBody(area, previewCache.get(entry.id));
      }
      return previewCache.get(entry.id);
    }
    try {
      const reply = await loadPreview(structuredClone(entry));
      if (revision !== previewRevision) return reply ?? null; // a newer selection superseded this reply
      // A loader that explicitly resolves nothing is a request that found no
      // recorded preview — recorded as such, never as "not requested yet".
      const preview = reply ?? { artifact_id: entry.id, available: false, reason: 'preview_not_recorded' };
      previewCache.set(entry.id, structuredClone(preview));
      const area = previewArea();
      if (area) {
        area.replaceChildren();
        renderPreviewBody(area, preview);
      }
      return preview;
    } catch (error) {
      if (revision !== previewRevision) return null;
      const area = previewArea();
      if (area) {
        area.replaceChildren();
        area.dataset.previewKind = 'error';
        area.dataset.previewAvailable = 'false';
        area.append(element('p', 'meta evidence-preview-unavailable',
          `preview unavailable: ${error?.code ?? error?.message ?? 'unknown error'}`));
      }
      return null;
    }
  }

  function renderResearch() {
    researchHost.replaceChildren(element('h3', '', 'Research records'),
      element('p', 'meta evidence-research-assertion',
        'A research note documents a question and its sources. Saving it never grants verification and never accepts a requirement — promotion happens only through a proposal, which this view links to but never accepts.'));
    if (!currentFixture.research.length) {
      researchHost.append(element('p', 'meta', 'No research recorded for this project — exact zero.'));
      return;
    }
    for (const finding of currentFixture.research) {
      const article = element('article', 'evidence-finding stack');
      article.dataset.researchId = finding.id;
      article.append(element('h4', '', finding.question ?? finding.id));
      const sources = element('ul', 'evidence-finding-sources');
      for (const source of finding.sources ?? []) {
        const item = element('li', '');
        const local = finding.external_sources.includes(source) ? null : entryOf(`artifact:${source}`);
        if (local) {
          const control = button(source, () => { select(local.id); });
          control.dataset.sourceArtifactId = local.id;
          item.append(control);
        } else {
          // Honest by shape: only URL-scheme sources read as external; a local
          // path the index never recorded says so instead of wearing the
          // external label.
          const external = /^[a-z]+:\/\//i.test(source);
          item.append(element('code', '', source), document.createTextNode(external
            ? ' (external URL — inert text, never fetched)'
            : ' (local path not present in this index — inert text)'));
        }
        sources.append(item);
      }
      article.append(element('p', 'meta', `captured ${finding.captured_at ?? 'unknown'}`), sources);
      if (finding.findings) article.append(element('p', '', `Findings: ${finding.findings}`));
      if (finding.uncertainty) article.append(element('p', 'meta', `Uncertainty: ${finding.uncertainty}`));
      if (finding.recommendation) article.append(element('p', '', `Recommendation: ${finding.recommendation}`));

      const promotion = element('div', 'evidence-promotion stack');
      promotion.dataset.promotionStatus = finding.promotion.status;
      promotion.dataset.proposalId = finding.promotion.proposal_id ?? '';
      promotion.dataset.grantsVerification = 'false';
      promotion.dataset.acceptsRequirement = 'false';
      promotion.dataset.promotionPath = finding.promotion.promotion_path;
      promotion.append(element('span', 'meta', `promotion: ${finding.promotion.status}${finding.promotion.proposal_id ? ` · proposal ${finding.promotion.proposal_id} (${finding.promotion.proposal_state ?? 'unknown state'})` : ' · no proposal linked'}`));
      if (finding.promotion.proposal_id) {
        // The research-to-proposal affordance: one action, routed through
        // onOpenItem (the shell's item-tab route). It opens the proposal
        // flow; it never accepts, verifies or edits from here.
        const link = button(`Open proposal ${finding.promotion.proposal_id} in the proposal flow`, () => {
          const payload = { kind: 'proposal', proposalId: finding.promotion.proposal_id,
            researchId: finding.id, source: 'evidence', grants: 'nothing' };
          if (typeof callbacks.onOpenItem === 'function') {
            callbacks.onOpenItem(payload);
            statusNote = `asked the shell to open proposal ${finding.promotion.proposal_id} from research ${finding.id} — opening grants nothing.`;
          } else if (typeof callbacks.onOpenProposal === 'function') {
            callbacks.onOpenProposal({ proposalId: finding.promotion.proposal_id, researchId: finding.id });
            statusNote = `asked the host to open proposal ${finding.promotion.proposal_id} — opening grants nothing.`;
          } else {
            statusNote = `the proposal flow is not connected in this surface — proposal ${finding.promotion.proposal_id} was NOT opened, and nothing was granted.`;
          }
          viewRevision += 1;
          fullRender();
        });
        link.dataset.proposalId = finding.promotion.proposal_id;
        link.dataset.researchId = finding.id;
        link.dataset.opensVia = typeof callbacks.onOpenItem === 'function' ? 'onOpenItem' : 'none';
        promotion.append(link);
      }
      promotion.append(element('span', 'meta evidence-promotion-assertion',
        'grants verification: no · accepts a requirement: no · a finding reaches project content only through this proposal'));
      article.append(promotion);
      researchHost.append(article);
    }
  }

  function renderRefusals() {
    refusalsHost.replaceChildren(element('h3', '', 'Registration refusals'),
      element('p', 'meta', 'Typed refusals from the registration route — nothing was registered for these paths.'));
    if (!currentFixture.refusals.length) {
      refusalsHost.append(element('p', 'meta', 'No registration refusals recorded.'));
      return;
    }
    const list = element('ul', 'evidence-refusal-list');
    for (const refusal of currentFixture.refusals) {
      const item = element('li', 'stack');
      item.dataset.refusalPath = refusal.path;
      item.dataset.refusalCode = refusal.code;
      item.append(element('code', '', refusal.path),
        element('span', 'meta', `${refusal.code}${refusal.detail ? ` — ${refusal.detail}` : ''} · registered: no`));
      list.append(item);
    }
    refusalsHost.append(list);
  }

  function fullRender() {
    validateFixture(currentFixture);
    headerTitle.textContent = currentFixture.title;
    headerSubtitle.textContent = currentFixture.subtitle;
    renderProjectLine();
    renderScopes();
    renderCollection();
    renderResearch();
    renderRefusals();
    renderInspector();
    root.dataset.mode = currentMode;
    root.dataset.navScope = currentNav ? currentNav.scope : '';
    root.dataset.navKey = currentNav ? navKeyOf(currentNav) : '';
    root.dataset.filterActive = String(Boolean(filterTokens.length && filterMatches));
    const scope = currentNav ? navLabelOf(currentNav) : 'pending';
    const totals = filterTokens.length && filterMatches
      ? `scope ${scope} · filter "${filterQuery}" matches ${filterMatches.length} of ${lastPage?.total ?? '?'} · filter page ${filterPage} of ${filterPageCountValue()}`
      : lastPage
        ? `scope ${scope} · page ${lastPage.page} of ${lastPage.page_count} · total ${lastPage.total}`
        : `scope ${scope} · loading the honest page`;
    status.textContent = `${totals}${selectedArtifactId ? ` · selected ${selectedArtifactId}` : ''} · mode ${currentMode} · view revision ${viewRevision}${statusNote ? ` — ${statusNote}` : ''}`;
    for (const control of root.querySelectorAll('.evidence-row')) {
      control.setAttribute('aria-pressed', String(control.dataset.artifactId === selectedArtifactId));
    }
    for (const control of root.querySelectorAll('[data-scope-key]')) {
      control.setAttribute('aria-pressed', String(Boolean(currentNav) && control.dataset.scopeKey === navKeyOf(currentNav)));
    }
  }

  function visibleRows() {
    return [...root.querySelectorAll('.evidence-row')];
  }

  function refreshFilterAfterData() {
    if (!filterTokens.length) return Promise.resolve();
    const apply = () => {
      filterMatches = computeFilterMatches(currentNav);
      filterPage = Math.min(Math.max(1, filterPage), filterPageCountValue() ?? 1);
      viewRevision += 1;
      fullRender();
    };
    return Promise.resolve(ensureScopeIndex(currentNav)).then(apply, apply);
  }

  function navigate(input) {
    if (input === null || typeof input !== 'object' || !NAVIGATION_SCOPES.includes(input.scope)) {
      statusNote = `unsupported navigation scope ${JSON.stringify(input?.scope ?? null)} — the view stayed on ${navLabelOf(currentNav ?? { scope: 'global' })}.`;
      status.textContent += ` — ${statusNote}`;
      callbacks.onNavigateRefused?.({ input });
      return Promise.resolve(null);
    }
    const target = input.scope === 'global' ? { scope: 'global', id: null } : { scope: input.scope, id: input.id };
    currentNav = target;
    requestedPage = 1;
    filterPage = 1;
    previewRevision += 1;
    if (lastPage === null || pageLoadError) {
      // first paint or recovery: the skeleton/error frame shows while loading
      viewRevision += 1;
      fullRender();
    } else {
      statusNote = `loading ${navLabelOf(target)} page 1…`;
      viewRevision += 1;
      fullRender();
    }
    const outcome = fetchPageSync(target, 1);
    const finish = () => {
      requestedPage = lastPage ? lastPage.page : 1;
      statusNote = '';
      viewRevision += 1;
      fullRender();
      renderInspector();
      callbacks.onNavigate?.(structuredClone(target));
      return refreshFilterAfterData().then(() => structuredClone(target));
    };
    return Promise.resolve(outcome).then(finish, finish);
  }

  function setPage(nextPage) {
    if (!lastPage) return Promise.resolve(null);
    const requested = Number.isSafeInteger(nextPage) ? nextPage : 1;
    const outcome = fetchPageSync(currentNav, requested);
    const finish = () => {
      requestedPage = lastPage ? lastPage.page : 1;
      viewRevision += 1;
      fullRender();
      callbacks.onPageChange?.({ nav: structuredClone(currentNav), page: requestedPage });
      return requestedPage;
    };
    return Promise.resolve(outcome).then(finish, finish);
  }

  function setFilterPage(nextPage) {
    if (!filterMatches) return Promise.resolve(null);
    const pageCount = filterPageCountValue();
    const requested = Math.min(Math.max(1, Number.isSafeInteger(nextPage) ? nextPage : 1), pageCount);
    filterPage = requested;
    viewRevision += 1;
    fullRender();
    callbacks.onFilterChange?.({ query: filterQuery, matches: filterMatches.length, page: filterPage });
    return Promise.resolve(filterPage);
  }

  // The filter is a lens over the scope's recorded pages. Turning it on
  // collects those pages through the injected loader (the only source of
  // entries); a collection failure leaves the unfiltered page visible with a
  // typed note rather than an invented result set.
  function setFilter(query) {
    const bounded = String(query ?? '').slice(0, FILTER_LIMIT);
    if (bounded === filterQuery) return Promise.resolve(filterQuery);
    filterQuery = bounded;
    filterTokens = tokenizeFilter(bounded);
    filterPage = 1;
    if (!filterTokens.length) {
      filterMatches = null;
      viewRevision += 1;
      fullRender();
      callbacks.onFilterChange?.({ query: filterQuery, matches: null, page: null });
      return Promise.resolve(filterQuery);
    }
    if (!currentNav || !lastPage) return Promise.resolve(filterQuery);
    const apply = () => {
      filterMatches = computeFilterMatches(currentNav);
      filterPage = 1;
      viewRevision += 1;
      fullRender();
      callbacks.onFilterChange?.({ query: filterQuery, matches: filterMatches ? filterMatches.length : null, page: filterPage });
      return filterQuery;
    };
    const fail = error => {
      statusNote = `the filter could not collect this scope's pages (${error?.code ?? error?.message ?? 'unknown error'}) — the unfiltered index stays visible.`;
      filterMatches = null;
      viewRevision += 1;
      fullRender();
      return filterQuery;
    };
    return Promise.resolve(ensureScopeIndex(currentNav)).then(apply, fail);
  }

  function select(id) {
    if (id != null && !entryOf(id)) return Promise.resolve(null);
    selectedArtifactId = id;
    previewRequestedFor = id;
    for (const control of root.querySelectorAll('.evidence-row')) {
      control.setAttribute('aria-pressed', String(control.dataset.artifactId === selectedArtifactId));
    }
    renderInspector();
    callbacks.onSelect?.({ artifactId: id, nav: structuredClone(currentNav) });
    if (id == null) return Promise.resolve(null);
    return Promise.resolve(loadPreviewFor(entryOf(id)));
  }

  function setMode(nextMode) {
    const value = MODES.includes(nextMode) ? nextMode : 'table';
    if (value === currentMode) return;
    currentMode = value;
    modeSegmented.setCurrent(value);
    viewRevision += 1;
    fullRender();
    callbacks.onModeChange?.({ mode: currentMode });
  }

  root.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    const row = event.target.classList?.contains('evidence-row') ? event.target : null;
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(row.dataset.artifactId);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = visibleRows();
      const index = rows.indexOf(row);
      if (index === -1) return;
      event.preventDefault();
      rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return;
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      if (filterTokens.length && filterMatches) setFilterPage(filterPage + (event.key === 'PageDown' ? 1 : -1));
      else setPage((lastPage?.page ?? 1) + (event.key === 'PageDown' ? 1 : -1));
    }
  });

  /** Simulated polling tick: re-render from the next fixture while preserving
   *  navigation scope, page (clamped to the honest page count), filter lens,
   *  selection and mode. A scope that no longer exists degrades to the global
   *  index with a visible note; a selection that vanished is released
   *  honestly. */
  function applyUpdate(nextFixture) {
    const preserved = { nav: structuredClone(currentNav), page: requestedPage, mode: currentMode,
      selectedArtifactId, scopeKey: currentNav ? navKeyOf(currentNav) : null,
      filterQuery, filterPage };
    currentFixture = structuredClone(validateFixture(nextFixture));
    previewCache.clear();
    scopeIndexCache.clear();
    scopeIndexPending = null;
    previewRevision += 1;
    previewRequestedFor = null;
    const scopeStillExists = preserved.scopeKey
      && currentFixture.scopes.some(scope => scope.key === preserved.scopeKey);
    const fallback = scopeStillExists ? null : 'global';
    currentNav = fallback ? { scope: 'global', id: null } : preserved.nav;
    if (fallback) statusNote = `scope ${preserved.scopeKey} no longer exists in the update — returned to the global index.`;
    const targetPage = fallback ? 1 : preserved.page;
    viewRevision += 1;
    lastPage = null;
    const selectedPreserved = preserved.selectedArtifactId == null
      || Boolean(entryOf(preserved.selectedArtifactId));
    if (!selectedPreserved) selectedArtifactId = null;
    const update = { ...preserved, navPreserved: !fallback, pageRequested: targetPage,
      selectedPreserved, filterPreserved: Boolean(filterTokens.length), viewRevision };
    const outcome = fetchPageSync(currentNav, targetPage);
    const finish = () => {
      requestedPage = lastPage ? lastPage.page : 1;
      update.pageApplied = lastPage ? lastPage.page : null;
      update.total = lastPage ? lastPage.total : null;
      // The published update record is final only once the honest page of the
      // refreshed fixture has actually landed (a load failure leaves the
      // failure markers, never a fabricated page number).
      lastUpdate = structuredClone(update);
      callbacks.onUpdate?.(structuredClone(lastUpdate));
      fullRender();
      renderInspector();
      refreshFilterAfterData();
      return structuredClone(lastUpdate);
    };
    return Promise.resolve(outcome).then(finish, finish);
  }

  // Boot through the same navigation path; synchronous loaders finish before
  // createEvidenceView returns, promise loaders settle through `ready`.
  const ready = Promise.resolve(navigate(nav));
  ready.then(() => renderInspector());

  return {
    element: root,
    ready,
    navigate,
    setPage,
    select,
    setMode,
    setFilter,
    applyUpdate,
    focusRow(id) {
      const target = root.querySelector(`[data-artifact-id="${id}"]`);
      if (target) target.focus();
      return Boolean(target);
    },
    getStats() {
      return {
        docId: currentFixture.docId,
        nav: structuredClone(currentNav),
        page: lastPage ? lastPage.page : null,
        mode: currentMode,
        selectedArtifactId,
        viewRevision,
        totals: lastPage ? { total: lastPage.total, page_count: lastPage.page_count,
          page_size: lastPage.page_size } : null,
        filter: { query: filterQuery, active: Boolean(filterTokens.length && filterMatches),
          matches: filterMatches ? filterMatches.length : null, page: filterTokens.length ? filterPage : null },
        scopeKeys: currentFixture.scopes.map(scope => scope.key),
        researchIds: currentFixture.research.map(finding => finding.id),
        refusalCodes: currentFixture.refusals.map(refusal => refusal.code),
        lastUpdate,
      };
    },
    getFixture() { return structuredClone(currentFixture); },
  };
}
