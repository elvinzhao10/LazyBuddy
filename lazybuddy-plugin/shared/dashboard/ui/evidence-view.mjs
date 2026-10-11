// T19 evidence and research view — DOM presentation over the T19 evidence
// fixture (built by evidence-model.mjs through the real T12 packages). The
// view receives honest pages from an injected loadPage (T12's paginate output)
// and safe preview data from an injected loadPreview (T12's
// renderArtifactPreview output); it owns no pagination math and never touches
// the filesystem. Every rendered byte of artifact or research content lands
// through textContent — markup in artifact bytes is inert text data here even
// before T12's own sanitization is considered. Navigation inputs are the
// read-only shape { scope: global|task|gate|plan|feature, id }.
import { button, element, statusChip } from './components.mjs';

const NAVIGATION_SCOPES = ['global', 'task', 'gate', 'plan', 'feature'];
const STATUSES = ['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible'];
const CHIP_STATES = { available: 'active', missing: 'failed', moved: 'stale', redacted: 'attention',
  unsupported: 'unavailable', inaccessible: 'unavailable' };
const MODES = ['cards', 'list'];

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
const sameNav = (left, right) => navKeyOf(left) === navKeyOf(right);

const isThenable = value => value !== null && typeof value === 'object' && typeof value.then === 'function';

export function createEvidenceView({ fixture: initialFixture, nav = { scope: 'global' }, page = 1,
  mode = 'cards', loadPage, loadPreview, callbacks = {} }) {
  let currentFixture = structuredClone(validateFixture(initialFixture));
  let currentNav = null;
  let requestedPage = Math.max(1, Number.isSafeInteger(page) ? page : 1);
  let currentMode = MODES.includes(mode) ? mode : 'cards';
  let selectedArtifactId = null;
  let previewRequestedFor = null;
  let lastPage = null;
  let viewRevision = 0;
  let lastUpdate = null;
  let statusNote = 'Evidence view ready.';
  let previewRevision = 0;
  const previewCache = new Map();

  const root = element('section', 'evidence-view stack');
  root.dataset.testid = 'evidence-view';
  root.dataset.docId = currentFixture.docId;

  const status = element('p', 'meta evidence-status', statusNote);
  status.dataset.testid = 'evidence-status';
  status.setAttribute('role', 'status');

  const inspector = element('aside', 'panel evidence-inspector stack');
  inspector.dataset.testid = 'evidence-inspector';
  inspector.tabIndex = 0;
  inspector.setAttribute('role', 'region');
  inspector.setAttribute('aria-label', 'Artifact detail and safe preview');

  const entryOf = id => currentFixture.entries.find(entry => entry.id === id) ?? null;

  function scopePageCount(targetNav) {
    const scope = currentFixture.scopes.find(candidate => candidate.key === navKeyOf(targetNav));
    return scope ? scope.page_count : 1;
  }

  // Applies the honest page from the injected loader (T12 paginate output).
  // The loader always receives the CURRENT fixture, so a polling update pages
  // the new data, never the fixture the caller originally bound. Clamping uses
  // the fixture's recorded page counts, so a request beyond the last page is
  // clamped BEFORE loading and the visible page always reflects what is shown.
  // Sync loaders complete synchronously; promise loaders chain.
  function fetchPageSync(targetNav, targetPage) {
    const requested = Math.max(1, Number.isSafeInteger(targetPage) ? targetPage : 1);
    const pageCount = scopePageCount(targetNav);
    const clamped = Math.min(requested, pageCount);
    if (clamped !== requested) {
      statusNote = `requested page ${requested} is beyond the last page ${pageCount} — clamped to ${clamped}; totals stay honest.`;
    }
    const apply = composed => {
      lastPage = composed;
      return composed.page;
    };
    const result = loadPage(currentFixture, targetNav, clamped);
    return isThenable(result) ? result.then(apply) : apply(result);
  }

  function renderHeader() {
    const head = element('header', 'evidence-head stack');
    head.append(element('h2', '', currentFixture.title), element('p', 'meta evidence-subtitle', currentFixture.subtitle));
    const projectLine = element('p', 'meta evidence-project');
    projectLine.dataset.testid = 'evidence-project';
    projectLine.textContent = `project revision ${currentFixture.projectRevision ?? 'none'} · scan ${currentFixture.scan.runs_indexed ?? '?'} runs · ${currentFixture.scan.files_seen ?? '?'} files seen · indexed ${currentFixture.total} artifacts`
      + (currentFixture.scan.history_status === 'unavailable' ? ` · native history unavailable: ${currentFixture.scan.history_reason}` : '');
    head.append(projectLine);

    const toolbar = element('div', 'cluster evidence-toolbar');
    const modeGroup = element('div', 'view-switcher cluster evidence-mode-switcher');
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Presentation mode');
    for (const value of MODES) {
      const control = button(value === 'cards' ? 'Cards' : 'List', () => setMode(value));
      control.dataset.modeValue = value;
      control.setAttribute('aria-pressed', String(value === currentMode));
      modeGroup.append(control);
    }
    modeGroup.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const controls = [...modeGroup.querySelectorAll('button')];
      const index = controls.indexOf(event.target);
      if (index === -1) return;
      event.preventDefault();
      controls[(index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length].focus();
    });
    toolbar.append(modeGroup);
    const legend = element('ul', 'cluster evidence-legend');
    legend.setAttribute('aria-label', 'State legend');
    const item = element('li', '');
    item.append(element('span', 'meta',
      'distinct states: available · missing · moved · redacted · unsupported · inaccessible — totals and truncation always shown'));
    legend.append(item);
    toolbar.append(legend);
    head.append(toolbar);
    return head;
  }

  function renderScopes() {
    const panel = element('section', 'panel evidence-scopes stack');
    panel.dataset.testid = 'evidence-scopes';
    panel.append(element('h3', '', 'Collection scope'),
      element('p', 'meta', 'Navigate the indexed collection from a task, gate, plan, feature or globally. Scope switching is a read-only query; the exact filtered set comes from the artifact index.'));
    const list = element('div', 'cluster evidence-scope-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Collection scopes');
    for (const scope of currentFixture.scopes) {
      const control = button(`${scope.label} (${scope.total})`, () => navigate(structuredClone(scope.nav)));
      control.dataset.scopeKey = scope.key;
      control.dataset.scopeTotal = String(scope.total);
      control.setAttribute('aria-pressed', String(currentNav && sameNav(currentNav, scope.nav)));
      list.append(control);
    }
    panel.append(list);
    return panel;
  }

  function artifactRow(entry) {
    const control = button('');
    control.className = `evidence-row${currentMode === 'list' ? ' evidence-row-list' : ''}`;
    control.dataset.artifactId = entry.id;
    control.dataset.status = entry.status;
    control.setAttribute('aria-pressed', 'false');
    const head = element('span', 'cluster evidence-row-head');
    head.append(element('code', '', entry.id));
    head.append(statusChip({ state: CHIP_STATES[entry.status] ?? 'unavailable', label: entry.stateSentence }));
    if (entry.type) head.append(element('span', 'meta evidence-row-type', entry.type));
    control.append(head);
    control.append(element('code', 'evidence-row-path', entry.path));
    const applies = element('span', 'meta evidence-applies', entry.appliesTo);
    control.append(applies);
    control.append(element('span', 'meta evidence-provenance', entry.provenance));
    control.addEventListener('click', () => select(entry.id));
    return control;
  }

  function renderCollection() {
    const panel = element('section', 'panel evidence-collection stack');
    panel.dataset.testid = 'evidence-collection';
    const heading = element('h3', '', 'Collection');
    const navContext = element('p', 'meta evidence-nav');
    navContext.dataset.testid = 'evidence-nav';
    const total = lastPage?.total ?? 0;
    navContext.textContent = `${navLabelOf(currentNav)} · ${total} artifact${total === 1 ? '' : 's'}${total === 0 ? ' — exact zero, not a hidden set' : ''}`;
    if (currentNav && currentNav.scope !== 'global') {
      const out = button(`Open the ${currentNav.scope} context`, () =>
        callbacks.onNavigateOut?.(structuredClone(currentNav)));
      out.dataset.navOut = currentNav.scope;
      out.dataset.navOutId = currentNav.id ?? '';
      navContext.append(' ', out);
    }
    panel.append(heading, navContext);

    const pagination = element('div', 'cluster evidence-pagination');
    pagination.dataset.testid = 'evidence-pagination';
    const previous = button('Previous page', () => setPage((lastPage?.page ?? 1) - 1));
    previous.dataset.pageAction = 'prev';
    previous.disabled = !lastPage || lastPage.page <= 1;
    const indicator = element('span', 'meta evidence-page-indicator',
      lastPage ? `Page ${lastPage.page} of ${lastPage.page_count}` : 'Page — of —');
    indicator.dataset.testid = 'evidence-page-indicator';
    const next = button('Next page', () => setPage((lastPage?.page ?? 1) + 1));
    next.dataset.pageAction = 'next';
    next.disabled = !lastPage || !lastPage.has_next;
    pagination.append(previous, indicator, next);
    panel.append(pagination);

    const totals = element('p', 'meta evidence-totals');
    totals.dataset.testid = 'evidence-totals';
    totals.textContent = lastPage
      ? `total ${lastPage.total} · page size ${lastPage.page_size} · showing ${lastPage.entries.length} · truncation ${lastPage.truncated ? 'yes' : 'none'}`
      : 'total — · page size — · showing — · truncation none';
    panel.append(totals);

    const coverage = element('p', 'meta evidence-coverage');
    coverage.dataset.testid = 'evidence-coverage';
    const byStatus = lastPage?.coverage?.by_status
      ?? Object.fromEntries(STATUSES.map(name => [name, 0]));
    coverage.textContent = STATUSES.map(name => `${name} ${byStatus[name] ?? 0}`).join(' · ');
    panel.append(coverage);

    const rows = currentMode === 'list' ? element('ol', 'evidence-list') : element('div', 'evidence-cards');
    for (const entry of lastPage?.entries ?? []) rows.append(artifactRow(entry));
    if (!rows.childNodes.length) {
      rows.append(element('p', 'meta', 'No artifacts in this scope — an exact zero, never a silent blank.'));
    }
    panel.append(rows);
    return panel;
  }

  function previewBlockNode(block) {
    // Inert by construction: every artifact byte renders through textContent.
    if (block.type === 'heading') return element(`h${Math.min(6, 3 + (block.level ?? 1))}`, 'evidence-preview-heading', block.text);
    if (block.type === 'quote') return element('blockquote', 'evidence-preview-quote', block.text);
    if (block.type === 'list_item') {
      const item = element('li', '', block.text);
      return item;
    }
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
      previewArea.append(element('p', 'meta', 'No preview requested yet. Select an artifact to load its safe preview.'));
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
    inspector.replaceChildren();
    inspector.append(element('h3', '', 'Artifact detail and safe preview'));
    const entry = selectedArtifactId ? entryOf(selectedArtifactId) : null;
    if (!entry) {
      inspector.append(element('p', 'meta', 'Select an artifact row to inspect its applicability, digest provenance and safe preview.'));
      const placeholder = element('div', 'evidence-preview stack');
      placeholder.dataset.testid = 'evidence-preview';
      placeholder.dataset.previewKind = 'none';
      placeholder.append(element('p', 'meta', 'No preview requested yet.'));
      inspector.append(placeholder);
      return;
    }
    const head = element('span', 'cluster');
    head.append(element('code', '', entry.id));
    head.append(statusChip({ state: CHIP_STATES[entry.status] ?? 'unavailable', label: entry.stateSentence }));
    inspector.append(head);
    inspector.append(element('code', 'evidence-row-path', entry.path));
    inspector.append(element('p', 'meta', entry.appliesTo));
    inspector.append(element('p', 'meta', `${entry.provenance}${entry.registered ? ` · registered by ${entry.registered.producer}` : ''}${entry.origins.length ? ` · origins: ${entry.origins.join('+')}` : ''}`));

    const previewArea = element('div', 'evidence-preview stack');
    previewArea.dataset.testid = 'evidence-preview';
    if (previewCache.has(entry.id)) {
      renderPreviewBody(previewArea, previewCache.get(entry.id));
    } else {
      previewArea.dataset.previewKind = 'loading';
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
      if (area && revision === previewRevision) {
        area.replaceChildren();
        renderPreviewBody(area, previewCache.get(entry.id));
      }
      return previewCache.get(entry.id);
    }
    try {
      const preview = await loadPreview(structuredClone(entry));
      if (revision !== previewRevision) return preview; // a newer selection superseded this reply
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
    const panel = element('section', 'panel evidence-research stack');
    panel.dataset.testid = 'evidence-research';
    panel.append(element('h3', '', 'Research records'),
      element('p', 'meta evidence-research-assertion',
        'A research note documents a question and its sources. Saving it never grants verification and never accepts a requirement — promotion happens only through a proposal, which this view links to but never accepts.'));
    if (!currentFixture.research.length) {
      panel.append(element('p', 'meta', 'No research recorded for this project — exact zero.'));
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
          const control = button(source, () => {
            navigate({ scope: 'global' });
            select(local.id);
          });
          control.dataset.sourceArtifactId = local.id;
          item.append(control);
        } else {
          item.append(element('code', '', source), document.createTextNode(' (external URL — inert text, never fetched)'));
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
        const link = button(`Open proposal ${finding.promotion.proposal_id}`, () =>
          callbacks.onOpenProposal?.({ proposalId: finding.promotion.proposal_id, researchId: finding.id }));
        link.dataset.proposalId = finding.promotion.proposal_id;
        promotion.append(link);
      }
      promotion.append(element('span', 'meta evidence-promotion-assertion',
        'grants verification: no · accepts a requirement: no · a finding reaches project content only through this proposal'));
      article.append(promotion);
      panel.append(article);
    }
    return panel;
  }

  function renderRefusals() {
    const panel = element('section', 'panel evidence-refusals stack');
    panel.dataset.testid = 'evidence-refusals';
    panel.append(element('h3', '', 'Registration refusals'),
      element('p', 'meta', 'Typed refusals from the registration route — nothing was registered for these paths.'));
    if (!currentFixture.refusals.length) {
      panel.append(element('p', 'meta', 'No registration refusals recorded.'));
      return panel;
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
    panel.append(list);
    return panel;
  }

  function fullRender() {
    validateFixture(currentFixture);
    const main = element('div', 'evidence-main stack');
    main.append(renderScopes(), renderCollection());
    const columns = element('div', 'evidence-columns');
    columns.dataset.testid = 'evidence-body';
    columns.append(main, inspector);
    root.replaceChildren(renderHeader(), status, columns, renderResearch(), renderRefusals());
    root.dataset.mode = currentMode;
    root.dataset.navScope = currentNav ? currentNav.scope : '';
    root.dataset.navKey = currentNav ? navKeyOf(currentNav) : '';
    const totals = lastPage
      ? `scope ${navLabelOf(currentNav)} · page ${lastPage.page} of ${lastPage.page_count} · total ${lastPage.total}`
      : 'scope pending';
    status.textContent = `${totals}${selectedArtifactId ? ` · selected ${selectedArtifactId}` : ''} · mode ${currentMode} · view revision ${viewRevision}${statusNote ? ` — ${statusNote}` : ''}`;
    for (const control of root.querySelectorAll('.evidence-row')) {
      control.setAttribute('aria-pressed', String(control.dataset.artifactId === selectedArtifactId));
    }
    for (const control of root.querySelectorAll('[data-scope-key]')) {
      control.setAttribute('aria-pressed', String(currentNav && control.dataset.scopeKey === navKeyOf(currentNav)));
    }
    for (const control of root.querySelectorAll('[data-mode-value]')) {
      control.setAttribute('aria-pressed', String(control.dataset.modeValue === currentMode));
    }
  }

  function visibleRows() {
    return [...root.querySelectorAll('.evidence-row')];
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
    previewRevision += 1;
    const outcome = fetchPageSync(target, 1);
    const finish = () => {
      requestedPage = lastPage ? lastPage.page : 1;
      statusNote = '';
      viewRevision += 1;
      fullRender();
      callbacks.onNavigate?.(structuredClone(target));
      return structuredClone(target);
    };
    return isThenable(outcome) ? outcome.then(finish) : finish();
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
    return isThenable(outcome) ? outcome.then(finish) : finish();
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
    const value = MODES.includes(nextMode) ? nextMode : 'cards';
    if (value === currentMode) return;
    currentMode = value;
    viewRevision += 1;
    fullRender();
    callbacks.onModeChange?.({ mode: currentMode });
  }

  root.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    const row = event.target.classList?.contains('evidence-row') ? event.target : null;
    if (row) {
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
        setPage((lastPage?.page ?? 1) + (event.key === 'PageDown' ? 1 : -1));
      }
    }
  });

  /** Simulated polling tick: re-render from the next fixture while preserving
   *  navigation scope, page (clamped to the honest page count), selection and
   *  mode. A scope that no longer exists degrades to the global index with a
   *  visible note; a selection that vanished is released honestly. */
  function applyUpdate(nextFixture) {
    const preserved = { nav: structuredClone(currentNav), page: requestedPage, mode: currentMode,
      selectedArtifactId, scopeKey: currentNav ? navKeyOf(currentNav) : null };
    currentFixture = structuredClone(validateFixture(nextFixture));
    previewCache.clear();
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
      selectedPreserved, viewRevision };
    const outcome = fetchPageSync(currentNav, targetPage);
    const finish = () => {
      requestedPage = lastPage ? lastPage.page : 1;
      update.pageApplied = lastPage ? lastPage.page : null;
      update.total = lastPage ? lastPage.total : null;
      fullRender();
      return update;
    };
    const completed = isThenable(outcome) ? outcome.then(finish) : finish();
    lastUpdate = structuredClone(update);
    callbacks.onUpdate?.(structuredClone(lastUpdate));
    return isThenable(completed) ? completed.then(() => structuredClone(lastUpdate)) : structuredClone(lastUpdate);
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
        scopeKeys: currentFixture.scopes.map(scope => scope.key),
        researchIds: currentFixture.research.map(finding => finding.id),
        refusalCodes: currentFixture.refusals.map(refusal => refusal.code),
        lastUpdate,
      };
    },
    getFixture() { return structuredClone(currentFixture); },
  };
}
