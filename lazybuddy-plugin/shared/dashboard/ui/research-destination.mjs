import { button, element, statusChip } from './components.mjs';
import { createDocumentView } from './document-view.mjs';
import { emptyState, list } from './project-view-primitives.mjs';
export function createResearchView(project, { adapter, onOpenEvidence }) {
  const root = element('section', 'plan-browser research-browser');
  const index = element('aside', 'panel stack plan-index');
  const detail = element('section', 'panel stack plan-detail');
  let selectedId = project.research?.[0]?.id ?? null;
  let sourceRequest = 0;
  let selectedSourcePath = null;
  let sourceView = null;
  let loadedSourceKey = null;
  const filters = element('div', 'stack plan-filters');
  const searchLabel = element('label', 'stack', 'Find research');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Question, finding or source'; searchLabel.append(search);
  const coverageLabel = element('label', 'stack', 'Evidence coverage'); const coverage = element('select');
  for (const [value, title] of [['all', 'All findings'], ['retained', 'Registered evidence'], ['missing', 'Unregistered sources'], ['uncertain', 'Has uncertainty']]) {
    const option = element('option', '', title); option.value = value; coverage.append(option);
  }
  coverage.value = 'all'; coverageLabel.append(coverage);
  const clear = button('Clear research filters', () => { search.value = ''; coverage.value = 'all'; renderIndex(); search.focus(); });
  const count = element('p', 'meta'); count.setAttribute('role', 'status'); const results = element('div');
  filters.append(searchLabel, coverageLabel, clear); index.append(element('h2', '', 'Research'), filters, count, results);
  search.addEventListener('input', renderIndex); coverage.addEventListener('change', renderIndex);
  const retained = finding => finding.sources.filter(path => project.artifacts?.some(artifact => artifact.path === path)).length;

  const capture = element('details', 'panel stack research-capture'); capture.append(element('summary', '', 'Capture a research finding'));
  const form = element('form', 'stack'); const fields = {};
  const webSource = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  for (const [key, title, multiline, required] of [['question', 'Question', false, true], ['sources', 'Sources (URL or relative path, one per line)', true, false],
    ['findings', 'Findings', true, true], ['uncertainty', 'Uncertainty', true, false], ['recommendation', 'Recommendation', true, false]]) {
    const label = element('label', 'stack', title); const input = element(multiline ? 'textarea' : 'input');
    input.required = required; input.maxLength = key === 'findings' ? 1048576 : 8192;
    if (multiline) input.rows = key === 'findings' ? 6 : 3;
    fields[key] = input; label.append(input); form.append(label);
  }
  const save = button('Save finding', null); save.type = 'submit';
  const saveStatus = element('p', 'meta', 'Saved findings preserve context; acceptance and verification require their own evidence.'); saveStatus.setAttribute('role', 'status');
  form.append(save, saveStatus); capture.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return;
    const question = fields.question.value.trim(); const findings = fields.findings.value.trim();
    if (!question || !findings) { saveStatus.textContent = 'Enter a question and findings.'; return; }
    const sources = [...new Set(fields.sources.value.split('\n').map(path => path.trim()).filter(Boolean))];
    if (sources.length > 64 || sources.some(path => !webSource(path) && (path.startsWith('/') || path.includes(':') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.')))) {
      saveStatus.textContent = 'Use up to 64 web URLs without credentials or relative project paths, one per line.'; return;
    }
    const saveFocused = document.activeElement === save;
    save.disabled = true; saveStatus.textContent = 'Saving finding…';
    const submitted = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
    const identity = `research:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    try {
      const result = await adapter.command({ schema_version: 1, command_id: `capture:${identity}`, project_id: project.project_id,
        expected_revision: project.revision, operation: 'record_research_findings', payload: { findings: [{ id: identity,
          question, sources, captured_at: new Date().toISOString(), findings,
          uncertainty: fields.uncertainty.value.trim() || null, recommendation: fields.recommendation.value.trim() || null, promotion_proposal_id: null }] } });
      if (result.receipt?.status !== 'saved') throw new Error(result.receipt?.reason ?? 'FINDING_NOT_SAVED');
      for (const [key, input] of Object.entries(fields)) if (input.value === submitted[key]) input.value = '';
      saveStatus.textContent = 'Finding saved. Source files and artifacts must be registered separately to retain evidence.';
      if (typeof adapter.read === 'function') {
        try { const next = await adapter.read(); if (next) { selectedId = identity; update(next); } }
        catch { saveStatus.textContent = 'Finding saved; refresh is unavailable. It will appear after reconnection.'; }
      }
    } catch (error) { saveStatus.textContent = `Not saved · ${error.code ?? error.message}. Your draft is retained; refresh and retry if the project changed.`; }
    finally { save.disabled = false; if (saveFocused && document.activeElement === document.body) save.focus(); }
  });

  const findingOf = id => project.research?.find(finding => finding.id === id) ?? null;
  function renderIndex() {
    const focused = results.contains(document.activeElement) ? document.activeElement?.dataset?.researchId : null;
    const query = search.value.trim().toLowerCase();
    const matches = (project.research ?? []).filter(finding => `${finding.question}\n${finding.findings}\n${finding.sources.join('\n')}`.toLowerCase().includes(query)
      && (coverage.value === 'all' || coverage.value === 'retained' && retained(finding) > 0
        || coverage.value === 'missing' && (finding.sources.length === 0 || retained(finding) < finding.sources.length)
        || coverage.value === 'uncertain' && Boolean(finding.uncertainty)));
    count.textContent = `${matches.length} of ${project.research?.length ?? 0} findings`;
    clear.hidden = !query && coverage.value === 'all'; results.replaceChildren();
    if (!project.research?.length) {
      results.append(element('p', 'meta', 'No findings yet. Capture a question, sources and findings to preserve research.'));
      return;
    }
    if (!matches.length) results.append(element('p', 'meta', 'No research matches these filters.'));
    results.append(list(matches, finding => {
      const control = button(finding.question, () => {
        if (finding.id !== selectedId) { selectedSourcePath = null; sourceView = null; loadedSourceKey = null; }
        open(finding.id);
      });
      control.dataset.researchId = finding.id;
      control.setAttribute('aria-pressed', String(finding.id === selectedId));
      control.append(element('span', 'meta', `${retained(finding)}/${finding.sources.length} evidence references${finding.uncertainty ? ' · uncertainty' : ''}`));
      return control;
    }));
    if (focused) ([...results.querySelectorAll('[data-research-id]')].find(control => control.dataset.researchId === focused) ?? search).focus();
  }

  async function openSource(sourcePath, host, status) {
    const source = project.sources?.find(candidate => candidate.path === sourcePath);
    if (!source) { status.textContent = 'This research source is not registered with the native source authority.'; return; }
    const own = ++sourceRequest; status.textContent = `Loading ${sourcePath}…`;
    try {
      const capture = await adapter.source(source.id);
      if (own !== sourceRequest) return;
      sourceView = createDocumentView({ markdown: capture.content, title: capture.path, headingOffset: 2 });
      selectedSourcePath = sourcePath;
      loadedSourceKey = `${source.id}\n${source.accepted_sha256 ?? source.observation?.sha256 ?? capture.sha256}`;
      host.replaceChildren(sourceView.element);
      status.textContent = `Registered source ${source.id}`;
    } catch (error) {
      if (own === sourceRequest) status.textContent = `Source unavailable · ${error.message}`;
    }
  }

  function open(id) {
    selectedId = id; sourceRequest += 1; renderIndex(); detail.replaceChildren();
    const finding = findingOf(id);
    if (!finding) { detail.append(emptyState('Finding unavailable', 'The selected finding is absent from the current project revision.')); return; }
    detail.append(element('p', 'meta', `Research / ${finding.id}`), element('h2', '', finding.question),
      element('p', 'meta', `captured ${finding.captured_at} · revision ${finding.revision} · recorded by ${finding.recorded_by}`));
    detail.append(element('p', 'meta', `${retained(finding)}/${finding.sources.length} sources registered as artifacts · ${finding.promotion_proposal_id ? 'Proposal linked' : 'No proposal linked'}`));
    for (const [title, value] of [['Findings', finding.findings], ['Uncertainty', finding.uncertainty],
      ['Recommendation', finding.recommendation]]) {
      const section = element('details', 'stack research-field'); section.open = title === 'Findings';
      section.append(element('summary', '', title), element('p', '', value ?? 'Not recorded.')); detail.append(section);
    }
    if (finding.promotion_proposal_id) detail.append(element('p', 'meta', `Linked proposal ${finding.promotion_proposal_id}; research alone grants no acceptance or verification.`));
    const sources = element('section', 'stack research-sources');
    sources.append(element('h3', '', 'Sources'));
    const sourceHost = element('div', 'research-source-host');
    const sourceStatus = element('p', 'meta', 'Select a registered source to read it here, or open a retained artifact in Evidence.');
    sourceStatus.setAttribute('role', 'status');
    sources.append(list(finding.sources, sourcePath => {
      const row = element('div', 'stack research-source'); row.append(element('code', '', sourcePath));
      const actions = element('div', 'cluster');
      const url = webSource(sourcePath);
      if (url) {
        const link = element('a', '', 'Open web source'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        actions.append(link, element('span', 'meta', 'Reference only; register a versioned local artifact to preserve a copy.'));
      }
      if (project.sources?.some(source => source.path === sourcePath)) {
        actions.append(button('Read registered source', () => openSource(sourcePath, sourceHost, sourceStatus)));
        if (!project.artifacts?.some(artifact => artifact.path === sourcePath)) {
          const register = button('Register evidence reference', async () => {
            const registerFocused = document.activeElement === register;
            register.disabled = true; sourceStatus.textContent = 'Registering hash-bound evidence reference…';
            try {
              const source = project.sources.find(entry => entry.path === sourcePath);
              const captured = await adapter.source(source.id);
              if (!/^[a-f0-9]{64}$/.test(captured.sha256 ?? '')) throw new Error('SOURCE_HASH_UNAVAILABLE');
              const identity = `artifact:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
              const result = await adapter.command({ schema_version: 1, command_id: `register:${identity}`, project_id: project.project_id,
                expected_revision: project.revision, operation: 'artifact.register', payload: { id: identity, type: 'research', producer: `research:${finding.id}`,
                  path: sourcePath, sha256: captured.sha256 } });
              if (result.receipt?.status !== 'saved') throw new Error(result.receipt?.reason ?? 'ARTIFACT_NOT_REGISTERED');
              sourceStatus.textContent = 'Evidence reference registered. Keep this source at a versioned path to preserve its contents.';
              if (typeof adapter.read === 'function') {
                try { const next = await adapter.read(); if (next) update(next); }
                catch { sourceStatus.textContent = 'Evidence reference registered; reconnect to refresh its view.'; }
              }
            } catch (error) { sourceStatus.textContent = `Evidence reference unavailable · ${error.code ?? error.message}. Refresh and retry.`; }
            finally {
              register.disabled = false;
              if (registerFocused && document.activeElement === document.body) {
                ([...detail.querySelectorAll('[data-evidence-path]')].find(control => control.dataset.evidencePath === sourcePath) ?? register).focus();
              }
            }
          });
          actions.append(register);
        }
      }
      if (project.artifacts?.some(artifact => artifact.path === sourcePath)) {
        const evidence = button('Open in Evidence', () => onOpenEvidence(sourcePath));
        evidence.dataset.evidencePath = sourcePath; actions.append(evidence);
      }
      if (!actions.children.length) actions.append(element('span', 'meta', 'No registered source or retained artifact is available.'));
      row.append(actions); return row;
    }), sourceStatus, sourceHost);
    if (selectedSourcePath && finding.sources.includes(selectedSourcePath) && sourceView) {
      const source = project.sources?.find(candidate => candidate.path === selectedSourcePath);
      const currentKey = source ? `${source.id}\n${source.accepted_sha256 ?? source.observation?.sha256 ?? ''}` : null;
      sourceHost.append(sourceView.element);
      sourceStatus.textContent = `Registered source ${source?.id ?? selectedSourcePath}`;
      if (currentKey !== loadedSourceKey) openSource(selectedSourcePath, sourceHost, sourceStatus);
    }
    detail.append(sources);
  }

  function update(next) {
    const unchanged = JSON.stringify([project.research, project.artifacts, project.sources.map(source => [source.id, source.accepted_sha256, source.observation?.sha256, source.observation?.status])])
      === JSON.stringify([next.research, next.artifacts, next.sources.map(source => [source.id, source.accepted_sha256, source.observation?.sha256, source.observation?.status])]);
    project = next;
    if (unchanged) return;
    if (!findingOf(selectedId)) selectedId = project.research?.[0]?.id ?? null;
    renderIndex();
    if (selectedId) open(selectedId);
    else detail.replaceChildren(emptyState('Research unavailable', 'No research findings are registered in the native project record.'));
  }
  renderIndex();
  if (selectedId) open(selectedId);
  else detail.append(emptyState('Research unavailable', 'No research findings are registered in the native project record.'));
  const workspace = element('div', 'stack research-workspace'); workspace.append(capture, detail);
  root.append(index, workspace);
  return { element: root, update, open };
}

// V2-T4 Health destination — the workspace-level health view composes from
// the sibling module ui/health-view.mjs (exact contract:
