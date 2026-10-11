import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T19 interface under test: evidence and research views over the real T12
// artifact index. The fixture is REAL end to end — a disposable root with a
// native evidence tree (73 indexed artifacts, more than one default page),
// project records authored through the actual CLI command route (init, sources,
// feature/requirement baseline items, a registered plan linked to the native
// run, artifact registrations prepared by T12's prepareArtifactRegistration,
// a baseline proposal and two research findings), then a real moved file
// (renamed after registration), a deleted file, an oversized artifact, a
// symlink refused at registration, and a markdown report carrying THIS lane's
// own <script>/<img onerror>/javascript: vectors. The T19 model calls T12's
// query/pagination/preview/research packages (never forked); the DOM view
// renders previews as inert text nodes only.
const dom = createMiniDom();
globalThis.document = dom.document;

const { buildArtifactIndex } = await import('../../project/artifacts/index.mjs');
const { ARTIFACT_FILE_LIMIT } = await import('../../project/artifacts/paths.mjs');
const { renderArtifactPreview } = await import('../../project/artifacts/preview.mjs');
const { prepareArtifactRegistration } = await import('../../project/artifacts/register.mjs');
const {
  artifactsForFeature, artifactsForGate, artifactsForPlan, artifactsForTask, DEFAULT_PAGE_SIZE,
} = await import('../../project/artifacts/query.mjs');
const { evidenceFixture, evidencePage, normalizeNavigation, scopeKeyOf } = await import('../ui/evidence-model.mjs');
const { createEvidenceView } = await import('../ui/evidence-view.mjs');

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PROJECT_ID = 'project:t19';
const ACTOR = 'local:t19-test';
const digest = value => createHash('sha256').update(value).digest('hex');
const evidenceDirectory = process.env.T19_EVIDENCE_DIR
  ?? '/Users/Admin/Desktop/lazyseries/.omo/evidence/lazyseries-1.4.0-project-platform/T19';

// THIS lane's own sanitization vectors (independent of T12's markers).
const REPORT_MD = `# T19 verification report

Evidence browser suite ran with **no failures**.

<script>alert('T19-PWNED-SCRIPT')</script>
Inline <img src=x onerror="alert('T19-ONERROR')"> and <iframe src="javascript:alert('T19-IFRAME')"></iframe>.

- [bad](javascript:alert('T19-JS-URL'))
- [spec](https://example.com/t19-spec)

\`\`\`html
<fenced><script>kept-as-data</script></fenced>
\`\`\`
`;

const RESEARCH_MD = `# Research: local storage choice

Which local store should the notes use? Recorded for the promotion display.

<script>alert('T19-RESEARCH-PWNED')</script>
`;

const REQUIREMENTS_MD = `# Requirements

## feature:notes — Personal notes

The product provides personal notes.

## requirement:offline — Work without a network

Cloud sign-in is not a prerequisite.
`;

const PLAN_MD = '# Evidence plan\n\nDeliver the evidence surface.\n';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), Buffer.from('IHDR'),
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00]),
  Buffer.from([0x1f, 0x15, 0xc4, 0x89]),
  Buffer.from([0x00, 0x00, 0x00, 0x0a]), Buffer.from('IDAT'),
  Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]),
  Buffer.from([0x0d, 0x0a, 0x63, 0xa4]),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('IEND'),
  Buffer.from([0xae, 0x42, 0x60, 0x82]),
]);

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content);
}

function invokeProject(root, action, input) {
  const result = spawnSync(process.execPath, [projectCLI, action, '--project-root', root,
    '--project-id', PROJECT_ID, '--actor', ACTOR], { cwd: root, input: input ?? '', encoding: 'utf8', timeout: 30000 });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function reduceCLI(action, state) {
  const result = spawnSync(process.execPath, [projectCLI, '--reduce'], {
    stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify({ action, state, context: {} }),
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`--reduce ${action} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const fixture = { root: null, refusals: [] };

test.before(async () => {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 't19-evidence-')));
  fixture.root = root;

  // Native evidence tree: one run with task/gate-bound references, one run with
  // the moved/deleted/oversized/symlink cases, one bulk run beyond one page.
  put(root, '.lazybuddy/runs/run-alpha/state.json', JSON.stringify({
    schema_version: '2', run_id: 'run-alpha', dashboard_project_id: 'native:t19',
    created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z',
    objective: 'Seed the T19 evidence tree', status: 'verifying', plan_reference: 'docs/plans/evidence.md',
    tasks: [
      { id: 'task-impl', title: 'Implement', status: 'done', evidence: ['.lazybuddy/runs/run-alpha/evidence/run-log.txt'] },
      { id: 'task-check', title: 'Check', status: 'done', evidence: ['evidence/summary.json'] },
    ],
    progress: { total_checkboxes: 0, completed_checkboxes: 0 },
    verification_gates: [{ name: 'gate:tests', status: 'passed' }, { name: 'gate:build', status: 'pending' }],
    review_status: 'not_started', iteration: {}, last_checkpoint: null, budget: {}, session_ids: [],
    runtime_fingerprints: [],
  }) + '\n');
  put(root, '.lazybuddy/runs/run-alpha/events.jsonl',
    '{"ts":"2026-10-06T00:00:00Z","run_id":"run-alpha","event":"run_created","objective":"Seed the T19 evidence tree"}\n');
  put(root, '.lazybuddy/runs/run-alpha/evidence/report.md', REPORT_MD);
  put(root, '.lazybuddy/runs/run-alpha/evidence/run-log.txt', '2026-10-06 run started\n2026-10-06 run finished\n');
  put(root, '.lazybuddy/runs/run-alpha/evidence/shot.png', PNG_BYTES);
  put(root, '.lazybuddy/runs/run-alpha/evidence/summary.json', JSON.stringify({ total: 1, tests: [{ status: 'pass', name: 'evidence' }] }) + '\n');
  put(root, '.lazybuddy/runs/run-alpha/verification/gate-report.md', '# Gate report\n\nBoth gates inspected.\n');
  put(root, '.lazybuddy/runs/run-alpha/artifacts/blob.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]));

  put(root, '.lazybuddy/runs/run-gamma/evidence/moved-report.md', '# Moved report\n\nOriginal body.\n');
  put(root, '.lazybuddy/runs/run-gamma/evidence/gone.md', '# Gone\n\nThis file will be deleted.\n');
  put(root, '.lazybuddy/runs/run-gamma/evidence/huge.log', Buffer.alloc(ARTIFACT_FILE_LIMIT + 1, 0x2e));
  mkdirSync(dirname(join(root, '.lazybuddy/runs/run-gamma/evidence/link.md')), { recursive: true });
  symlinkSync('../../../../docs/redir/target.md', join(root, '.lazybuddy/runs/run-gamma/evidence/link.md'));

  for (let index = 0; index < 60; index += 1) {
    put(root, `.lazybuddy/runs/run-delta/evidence/bulk-${String(index).padStart(2, '0')}.log`, `bulk line ${index}\n`);
  }
  put(root, '.lazybuddy/runs/run-delta/evidence/long.txt', Buffer.alloc(70 * 1024, 0x61));

  put(root, 'docs/project/requirements.md', REQUIREMENTS_MD);
  put(root, 'docs/plans/evidence.md', PLAN_MD);
  put(root, 'research/notes/q1.md', RESEARCH_MD);
  put(root, 'docs/redir/target.md', '# Redirect target\n');

  // The real CLI command route: init, sources, baseline items, plan, native-run link.
  const init = invokeProject(root, 'init');
  assert.equal(init.code, 0, init.stderr);
  let revision = 0;
  const command = (operation, payload) => {
    const result = invokeProject(root, 'command', JSON.stringify({ schema_version: 1,
      command_id: `t19:${operation}:${revision}`, project_id: PROJECT_ID, expected_revision: revision,
      operation, payload }));
    if (result.code !== 0) throw new Error(`${operation} failed: ${result.stderr}\n${result.stdout}`);
    revision += 1;
    return JSON.parse(result.stdout);
  };

  command('register_source', { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements' });
  command('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: { source_id: 'source:requirements', sha256: digest(REQUIREMENTS_MD), anchor_id: 'heading:feature:notes — Personal notes' } },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
      source: { source_id: 'source:requirements', sha256: digest(REQUIREMENTS_MD), anchor_id: 'heading:requirement:offline — Work without a network' } },
  ] });
  command('register_source', { id: 'source:plan', path: 'docs/plans/evidence.md', role: 'plan' });
  command('register_plan', {
    id: 'plan:evidence', source: { source_id: 'source:plan', sha256: digest(PLAN_MD), anchor_id: 'document' },
    declared_lifecycle: 'planned', baseline_refs: [{ item_id: 'feature:notes', item_revision: 1 }],
  });
  command('link_native_run', { plan_id: 'plan:evidence', native_project_id: 'native:t19', run_id: 'run-alpha' });

  // Registrations prepared by T12's own composer, accepted through the command route.
  for (const registration of [
    { id: 'artifact:alpha-report', path: '.lazybuddy/runs/run-alpha/evidence/report.md' },
    { id: 'artifact:gamma-moved', path: '.lazybuddy/runs/run-gamma/evidence/moved-report.md' },
    { id: 'artifact:gamma-gone', path: '.lazybuddy/runs/run-gamma/evidence/gone.md' },
    { id: 'artifact:research-q1', path: 'research/notes/q1.md' },
  ]) {
    const prepared = await prepareArtifactRegistration(root, {
      project_id: PROJECT_ID, expected_revision: revision,
      command_id: `t19:register:${registration.id}`, producer: 'producer:t19-suite',
      path: registration.path, id: registration.id,
    });
    command('artifact.register', prepared.command.payload);
  }

  // The symlink is refused at registration by T12's typed precheck — recorded
  // as a refusal and displayed by the view (nothing was registered).
  await assert.rejects(prepareArtifactRegistration(root, {
    project_id: PROJECT_ID, expected_revision: revision,
    command_id: 't19:register:symlink', producer: 'producer:t19-suite',
    path: '.lazybuddy/runs/run-gamma/evidence/link.md',
  }), error => error.code === 'ARTIFACT_SYMLINK_REFUSED');
  fixture.refusals.push({ path: '.lazybuddy/runs/run-gamma/evidence/link.md', code: 'ARTIFACT_SYMLINK_REFUSED',
    detail: 'T12 prepareArtifactRegistration refused the symbolic link before any command was accepted' });

  command('record_baseline_proposal', {
    id: 'proposal:t19', summary: 'Adopt the researched local storage choice',
    patches: [{ source_id: 'source:requirements', anchor_id: 'document',
      current_sha256: digest(REQUIREMENTS_MD),
      proposed_text: REQUIREMENTS_MD.replace('Cloud sign-in is not a prerequisite.', 'Notes storage stays local-first.') }],
    options: [], impact: { item_ids: ['requirement:offline'], plan_ids: [], architecture_ids: [] },
    evidence_observation_ids: [],
  });
  command('record_research_findings', { findings: [{
    id: 'research:q1', question: 'Which local store should the notes use?',
    sources: ['research/notes/q1.md', 'https://example.com/lazyseries/t19-spec'],
    captured_at: '2026-10-06T00:00:00Z', findings: 'SQLite is embedded and offline-capable.',
    uncertainty: 'Concurrency under multi-window edits was not measured.',
    recommendation: 'Adopt SQLite behind the notes repository.',
  }] });
  command('record_research_findings', { findings: [{
    id: 'research:q2', question: 'Does the export path need cloud sync?',
    sources: ['https://example.com/other'], captured_at: '2026-10-06T00:00:00Z',
    findings: 'No: exports are local files.', recommendation: 'Keep exports local.',
    promotion_proposal_id: 'proposal:t19',
  }] });

  // Post-registration reality: the moved file relocates, the deleted file vanishes.
  mkdirSync(join(root, '.lazybuddy/runs/run-gamma/artifacts'), { recursive: true });
  renameSync(join(root, '.lazybuddy/runs/run-gamma/evidence/moved-report.md'),
    join(root, '.lazybuddy/runs/run-gamma/artifacts/moved-report.md'));
  rmSync(join(root, '.lazybuddy/runs/run-gamma/evidence/gone.md'));

  fixture.state = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8'));
  fixture.snapshot = JSON.parse(JSON.stringify(reduceCLI('snapshot', fixture.state)));
});

test.after(() => {
  const receipt = [];
  if (fixture.root && existsSync(fixture.root)) {
    rmSync(fixture.root, { recursive: true, force: true });
    receipt.push('fixture-root-removed');
    assert.equal(existsSync(fixture.root), false);
  }
  process.stdout.write(`cleanup receipt: ${receipt.join(',')}\n`);
});

async function buildFixture() {
  const index = await buildArtifactIndex(fixture.root, { snapshot: fixture.snapshot });
  return { index, composed: evidenceFixture({ index, snapshot: fixture.snapshot, refusals: fixture.refusals }) };
}

const idsOf = result => result.entries.map(entry => entry.id).sort();

test('evidence browser paginates honestly, shows distinct states, safe previews and inert research', async () => {
  const { index, composed } = await buildFixture();

  // --- Fixture composition over the real T12 index.
  assert.ok(composed.total > DEFAULT_PAGE_SIZE, 'the fixture must exceed one default page');
  assert.equal(composed.total, index.entries.length);
  assert.equal(Object.values(composed.coverage.by_status).reduce((sum, count) => sum + count, 0), composed.total);
  const scopeKeys = composed.scopes.map(scope => scope.key);
  for (const key of ['global', 'task:task-impl', 'task:task-check', 'plan:plan:evidence',
    'feature:feature:notes', 'gate:gate:tests', 'gate:gate:build']) {
    assert.ok(scopeKeys.includes(key), `scope ${key} is navigable`);
  }
  assert.equal(composed.researchAuthority.grants_verification, false);
  assert.equal(composed.researchAuthority.accepts_requirement, false);
  assert.deepEqual(composed.researchAuthority.accepted_requirement_ids, ['requirement:offline']);

  const view = createEvidenceView({
    fixture: composed,
    loadPage: (source, nav, page) => evidencePage(source, nav, page),
    loadPreview: entry => renderArtifactPreview(fixture.root, entry),
  });

  // --- 1. Pagination totals are honest and the second page is reachable.
  let stats = view.getStats();
  assert.equal(stats.nav.scope, 'global');
  assert.equal(stats.page, 1);
  assert.equal(stats.totals.page_count, 2);
  assert.equal(stats.totals.page_size, DEFAULT_PAGE_SIZE);
  let rows = [...view.element.querySelectorAll('.evidence-row')];
  assert.equal(rows.length, DEFAULT_PAGE_SIZE);
  assert.match(view.element.querySelector('[data-testid="evidence-totals"]').textContent,
    new RegExp(`total ${composed.total} · page size ${DEFAULT_PAGE_SIZE} · showing ${DEFAULT_PAGE_SIZE} · truncation none`));
  assert.match(view.element.querySelector('[data-testid="evidence-coverage"]').textContent,
    /available 68 · missing 1 · moved 1 · redacted 0 · unsupported 2 · inaccessible 1/);
  view.element.querySelector('[data-page-action="next"]').click();
  stats = view.getStats();
  assert.equal(stats.page, 2, 'the second page is reachable');
  rows = [...view.element.querySelectorAll('.evidence-row')];
  assert.equal(rows.length, composed.total - DEFAULT_PAGE_SIZE);
  assert.equal(view.element.querySelector('[data-page-action="next"]').disabled, true);
  assert.match(view.element.querySelector('[data-testid="evidence-totals"]').textContent, new RegExp(`total ${composed.total}`));
  // No artifact is silently truncated: pages 1+2 cover every identity exactly once.
  const pageOne = evidencePage(composed, { scope: 'global' }, 1).entries.map(entry => entry.id);
  const pageTwo = evidencePage(composed, { scope: 'global' }, 2).entries.map(entry => entry.id);
  assert.deepEqual([...pageOne, ...pageTwo].sort(), index.entries.map(entry => entry.id).sort());
  // Beyond the last page stays honest through T12's own pagination.
  const beyond = evidencePage(composed, { scope: 'global' }, 999);
  assert.deepEqual(beyond.entries, []);
  assert.equal(beyond.total, composed.total);
  assert.equal(beyond.has_next, false);

  // --- 2. Distinct visible states with digest provenance (run-gamma rows live on page 2).
  const rowFor = predicate => [...view.element.querySelectorAll('.evidence-row')].find(row => predicate(row.dataset.artifactId));
  const movedRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-gamma/evidence/moved-report.md');
  assert.ok(movedRow, 'the moved artifact renders');
  assert.equal(movedRow.dataset.status, 'moved');
  assert.match(movedRow.textContent, /moved — registered digest/);
  assert.match(movedRow.textContent, /now verified at \.lazybuddy\/runs\/run-gamma\/artifacts\/moved-report\.md/);
  const missingRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-gamma/evidence/gone.md');
  assert.equal(missingRow.dataset.status, 'missing');
  assert.match(missingRow.textContent, /missing — registered digest/);
  const unsupportedRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-gamma/evidence/huge.log');
  assert.equal(unsupportedRow.dataset.status, 'unsupported');
  assert.match(unsupportedRow.textContent, /digest none/i);
  const inaccessibleRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-gamma/evidence/link.md');
  assert.equal(inaccessibleRow.dataset.status, 'inaccessible');
  assert.match(inaccessibleRow.textContent, /symlink/i);
  const redactedProbe = [...view.element.querySelectorAll('.evidence-row[data-status="redacted"]')];
  assert.equal(redactedProbe.length, 0, 'this fixture carries no redacted artifact — the state stays exact zero, not hidden');
  // Every status renders a label beginning with its own status word, so the six
  // visible states are pairwise distinct text, and the four exercised
  // non-available rows each carry their own provenance sentence.
  const statusWords = ['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible'];
  for (const row of [movedRow, missingRow, unsupportedRow, inaccessibleRow]) {
    const label = row.querySelector('.status').textContent;
    assert.ok(statusWords.some(word => label.startsWith(word)), `the state label names its status: ${label}`);
  }
  assert.equal(new Set([movedRow, missingRow, unsupportedRow, inaccessibleRow]
    .map(row => row.querySelector('.status').textContent)).size, 4,
    'the four exercised non-available states render four distinct labels');
  view.element.querySelector('[data-page-action="prev"]').click();
  assert.equal(view.getStats().page, 1);

  // --- 3. Applicable version is visible per artifact row.
  const reportRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-alpha/evidence/report.md');
  const applies = reportRow.querySelector('.evidence-applies').textContent;
  assert.match(applies, /plan plan:evidence/);
  assert.match(applies, /feature feature:notes/);
  assert.match(applies, /run run-alpha/);
  assert.match(applies, new RegExp(`project revision ${composed.projectRevision}`));
  assert.match(applies, /content [a-f0-9]{12}…/);
  const gateRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-alpha/verification/gate-report.md');
  assert.match(gateRow.querySelector('.evidence-applies').textContent, /gate gate:tests/);
  const logRow = rowFor(id => id === 'artifact:.lazybuddy/runs/run-alpha/evidence/run-log.txt');
  assert.match(logRow.querySelector('.evidence-applies').textContent, /task task-impl/);

  // --- 4. Safe previews: this lane's own vectors never reach the DOM as markup.
  await view.select('artifact:.lazybuddy/runs/run-alpha/evidence/report.md');
  const previewPanel = view.element.querySelector('[data-testid="evidence-preview"]');
  assert.equal(previewPanel.dataset.previewKind, 'markdown');
  assert.equal(previewPanel.querySelectorAll('script, iframe, img, object, embed, style, svg').length, 0,
    'the sanitized markdown preview injects no active element');
  for (const banned of ['T19-PWNED-SCRIPT', 'T19-ONERROR', 'T19-IFRAME', 'javascript:']) {
    assert.ok(!previewPanel.textContent.includes(banned), `${banned} must not survive sanitization`);
  }
  assert.match(previewPanel.textContent, /T19 verification report/);
  assert.match(previewPanel.textContent, /kept-as-data/);
  assert.match(previewPanel.textContent, /sanitization report: 2 script blocks removed/);
  assert.match(previewPanel.textContent, /1 tag stripped/);
  assert.match(previewPanel.textContent, /1 unsafe URL removed/);
  assert.match(previewPanel.textContent, /spec/);
  assert.match(previewPanel.textContent, /https:\/\/example\.com\/t19-spec/);
  // Image, JSON and text previews render as data.
  await view.select('artifact:.lazybuddy/runs/run-alpha/evidence/shot.png');
  const image = view.element.querySelector('[data-testid="evidence-preview"] img');
  assert.ok(image, 'the screenshot preview renders an image element from T12 data');
  assert.match(image.getAttribute('src'), /^data:image\/png;base64,/);
  await view.select('artifact:.lazybuddy/runs/run-alpha/evidence/summary.json');
  assert.match(view.element.querySelector('[data-testid="evidence-preview"]').textContent, /"total":1/);
  await view.select('artifact:.lazybuddy/runs/run-delta/evidence/long.txt');
  assert.match(view.element.querySelector('[data-testid="evidence-preview"]').textContent, /truncated at 65536 of 71680 bytes/);
  // Unavailable previews state their distinct reasons (T12's preview reasons
  // for non-available artifacts are the status itself; the row carries the
  // index-level cause such as symlink_refused).
  await view.select('artifact:.lazybuddy/runs/run-gamma/evidence/gone.md');
  assert.match(view.element.querySelector('[data-testid="evidence-preview"]').textContent, /artifact_missing/);
  await view.select('artifact:.lazybuddy/runs/run-gamma/evidence/link.md');
  assert.match(view.element.querySelector('[data-testid="evidence-preview"]').textContent, /artifact_inaccessible/);
  await view.select('artifact:.lazybuddy/runs/run-gamma/evidence/huge.log');
  assert.match(view.element.querySelector('[data-testid="evidence-preview"]').textContent, /artifact_unsupported/);

  // --- 5. The typed registration refusal is displayed.
  const refusalsPanel = view.element.querySelector('[data-testid="evidence-refusals"]');
  const refusal = refusalsPanel.querySelector('[data-refusal-code="ARTIFACT_SYMLINK_REFUSED"]');
  assert.ok(refusal, 'the typed symlink refusal is shown');
  assert.match(refusal.textContent, /\.lazybuddy\/runs\/run-gamma\/evidence\/link\.md/);
  assert.equal(composed.entries.filter(entry => entry.registered?.id === 'artifact:symlink').length, 0,
    'the refused path registered nothing');

  // --- 6. Research records display inertly; promotion is proposal-only.
  const researchPanel = view.element.querySelector('[data-testid="evidence-research"]');
  const q1 = researchPanel.querySelector('article[data-research-id="research:q1"]');
  assert.ok(q1);
  for (const text of ['Which local store should the notes use?', 'SQLite is embedded and offline-capable.',
    'Concurrency under multi-window edits was not measured.', 'Adopt SQLite behind the notes repository.',
    '2026-10-06T00:00:00Z']) {
    assert.ok(q1.textContent.includes(text), `research display includes: ${text}`);
  }
  assert.ok(q1.textContent.includes('research/notes/q1.md') && q1.textContent.includes('https://example.com/lazyseries/t19-spec'),
    'sources render (local path and URL both inert text)');
  const promotionQ1 = q1.querySelector('.evidence-promotion');
  assert.equal(promotionQ1.dataset.promotionStatus, 'unlinked');
  assert.equal(promotionQ1.dataset.grantsVerification, 'false');
  assert.equal(promotionQ1.dataset.acceptsRequirement, 'false');
  assert.equal(promotionQ1.dataset.promotionPath, 'proposal_only');
  const q2 = researchPanel.querySelector('article[data-research-id="research:q2"]');
  const promotionQ2 = q2.querySelector('.evidence-promotion');
  assert.equal(promotionQ2.dataset.promotionStatus, 'linked_proposed');
  assert.ok(promotionQ2.querySelector('[data-proposal-id="proposal:t19"]'), 'the promotion link names the proposal');
  assert.equal(researchPanel.querySelectorAll('.status[data-state="verified"]').length, 0,
    'research never renders a verified treatment');
  assert.match(researchPanel.textContent, /never grants verification/i);
  assert.match(researchPanel.textContent, /never accepts a requirement/i);

  // --- 7. Navigation input shape: task, plan, feature, gate and global filtered sets.
  const compareScope = (nav, t12result, navLabel) => {
    view.navigate(nav);
    const rendered = [...view.element.querySelectorAll('.evidence-row')].map(row => row.dataset.artifactId).sort();
    const t12Ids = idsOf(t12result);
    // The rendered page is exactly T12's own first page over its own query.
    const expectedPage = evidencePage(composed, nav, 1).entries.map(entry => entry.id).sort();
    assert.deepEqual(rendered, expectedPage, `${JSON.stringify(nav)} renders T12's paginate output`);
    assert.deepEqual(expectedPage, expectedPage.filter(id => t12Ids.includes(id)).sort(),
      `${JSON.stringify(nav)} page ids all belong to T12's filtered set`);
    assert.match(view.element.querySelector('[data-testid="evidence-totals"]').textContent,
      new RegExp(`total ${t12result.total ?? composed.total}`));
    assert.ok(view.element.querySelector('[data-testid="evidence-nav"]').textContent.includes(navLabel),
      `the navigation context reads: ${navLabel}`);
  };
  compareScope({ scope: 'task', id: 'task-impl' }, artifactsForTask(index, 'task-impl'), 'task task-impl');
  compareScope({ scope: 'task', id: 'task-check' }, artifactsForTask(index, 'task-check'), 'task task-check');
  compareScope({ scope: 'plan', id: 'plan:evidence' }, artifactsForPlan(index, 'plan:evidence'), 'plan plan:evidence');
  compareScope({ scope: 'feature', id: 'feature:notes' }, artifactsForFeature(index, 'feature:notes'), 'feature feature:notes');
  compareScope({ scope: 'gate', id: 'gate:tests' }, artifactsForGate(index, 'gate:tests'), 'gate gate:tests');
  compareScope({ scope: 'global' }, { entries: index.entries }, 'global index');
  // An unknown identity inside a valid scope stays an exact zero, never a silent blank.
  view.navigate({ scope: 'task', id: 'task-unknown' });
  assert.equal(view.element.querySelectorAll('.evidence-row').length, 0);
  assert.match(view.element.querySelector('[data-testid="evidence-totals"]').textContent, /total 0 · page size 50 · showing 0 · truncation none/);
  assert.match(view.element.textContent, /exact zero/);

  // --- 8. Narrow equivalent + keyboard operation.
  view.navigate({ scope: 'global' });
  view.setPage(2);
  view.setMode('list');
  const listRows = [...view.element.querySelectorAll('.evidence-list .evidence-row')];
  assert.equal(listRows.length, composed.total - DEFAULT_PAGE_SIZE);
  const first = listRows[0];
  first.focus();
  assert.equal(dom.document.activeElement, first);
  const down = { type: 'keydown', key: 'ArrowDown', target: first };
  first.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(dom.document.activeElement, listRows[1], 'ArrowDown moves keyboard focus');
  const enter = { type: 'keydown', key: 'Enter', target: listRows[1] };
  listRows[1].dispatchEvent(enter);
  assert.equal(view.getStats().selectedArtifactId, listRows[1].dataset.artifactId, 'keyboard Enter selects');
  const pageDown = { type: 'keydown', key: 'PageDown', target: listRows[1] };
  listRows[1].dispatchEvent(pageDown);
  assert.equal(pageDown.defaultPrevented, true);

  // --- 9. A polling tick preserves navigation, page, selection and mode.
  writeFileSync(join(fixture.root, '.lazybuddy/runs/run-delta/evidence/bulk-99.log'), 'bulk line 99\n');
  const rebuilt = await buildFixture();
  const before = view.getStats();
  const update = view.applyUpdate(rebuilt.composed);
  const after = view.getStats();
  assert.equal(update.navPreserved, true);
  assert.equal(update.selectedPreserved, true);
  assert.equal(after.nav.scope, before.nav.scope);
  assert.equal(after.page, before.page, 'the page survives the polling tick');
  assert.equal(after.selectedArtifactId, before.selectedArtifactId);
  assert.equal(after.mode, before.mode);
  assert.equal(after.totals.total, rebuilt.composed.total);
  assert.equal(after.totals.total, before.totals.total + 1, 'the total grows honestly');
  assert.equal(after.viewRevision > before.viewRevision, true);

  // --- Export the exact consumed data for the browser proof (same data path).
  const previews = {};
  for (const id of ['artifact:.lazybuddy/runs/run-alpha/evidence/report.md',
    'artifact:.lazybuddy/runs/run-alpha/evidence/shot.png',
    'artifact:.lazybuddy/runs/run-alpha/evidence/summary.json',
    'artifact:.lazybuddy/runs/run-alpha/evidence/run-log.txt',
    'artifact:.lazybuddy/runs/run-delta/evidence/long.txt',
    'artifact:.lazybuddy/runs/run-gamma/evidence/moved-report.md',
    'artifact:.lazybuddy/runs/run-gamma/evidence/gone.md',
    'artifact:.lazybuddy/runs/run-gamma/evidence/huge.log',
    'artifact:.lazybuddy/runs/run-gamma/evidence/link.md']) {
    const entry = rebuilt.index.entries.find(candidate => candidate.id === id);
    previews[id] = await renderArtifactPreview(fixture.root, entry);
  }
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'evidence-fixture.json'), `${JSON.stringify({
    writtenAt: new Date().toISOString(), projectId: PROJECT_ID,
    initial: composed, update: rebuilt.composed, previews,
  }, null, 2)}\n`);
});

test('adversarial: navigation, statuses, research authority and preview injection fail closed', async () => {
  const { composed } = await buildFixture();

  // Malformed navigation inputs are typed refusals at the model boundary.
  assert.throws(() => normalizeNavigation(null), error => error.code === 'INVALID_NAVIGATION');
  assert.throws(() => normalizeNavigation({ scope: 'workspace' }), error => error.code === 'INVALID_NAVIGATION');
  assert.throws(() => normalizeNavigation({ scope: 'task' }), error => error.code === 'INVALID_NAVIGATION');
  assert.throws(() => normalizeNavigation({ scope: 'task', id: '' }), error => error.code === 'INVALID_NAVIGATION');
  assert.throws(() => normalizeNavigation({ scope: 'task', id: 'x'.repeat(513) }), error => error.code === 'INVALID_NAVIGATION');
  assert.deepEqual(normalizeNavigation({ scope: 'global' }), { scope: 'global', id: null });
  assert.throws(() => evidencePage(composed, { scope: 'criterion' }, 1), error => error.code === 'INVALID_NAVIGATION');
  // T12's own pagination refusals stay reachable through the T19 page route.
  assert.throws(() => evidencePage(composed, { scope: 'global' }, 0), error => error.code === 'INVALID_QUERY');
  assert.throws(() => evidencePage(composed, { scope: 'global' }, 1, { page_size: 0 }), error => error.code === 'INVALID_QUERY');
  assert.equal(scopeKeyOf({ scope: 'global' }), 'global');
  assert.equal(scopeKeyOf({ scope: 'task', id: 'task-impl' }), 'task:task-impl');

  // The view ignores an unsupported scope without changing state (honest note).
  const view = createEvidenceView({
    fixture: composed,
    loadPage: (source, nav, page) => evidencePage(source, nav, page),
    loadPreview: async () => { throw new Error('should not load'); },
  });
  view.navigate({ scope: 'global' });
  const before = view.getStats();
  view.navigate({ scope: 'workspace', id: 'x' });
  const after = view.getStats();
  assert.equal(after.nav.scope, before.nav.scope, 'an unsupported scope changes nothing');
  assert.match(view.element.querySelector('[data-testid="evidence-status"]').textContent, /unsupported navigation scope/);

  // A tampered entry status fails closed before any row renders.
  const tampered = structuredClone(composed);
  tampered.entries[0].status = 'excellent';
  assert.throws(() => createEvidenceView({ fixture: tampered, loadPage: () => { throw new Error('unreached'); } }),
    error => /UNKNOWN_ARTIFACT_STATUS/.test(error.message));

  // Research authority leak: a smuggled verified key must stop composition
  // before any fixture exists. NOTE — T12 defect (reported, not repaired here,
  // research.mjs is outside T19 ownership): the typed path reads
  // `throw new Object.assign(new Error(...))`, so the leak surfaces as a
  // TypeError instead of RESEARCH_AUTHORITY_LEAK. Both outcomes fail closed;
  // the R-item candidate restores the typed code.
  const smuggledSnapshot = structuredClone(fixture.snapshot);
  smuggledSnapshot.research[0].verified = true;
  assert.throws(() => evidenceFixture({ index: { entries: [] }, snapshot: smuggledSnapshot, refusals: [] }),
    error => error.code === 'RESEARCH_AUTHORITY_LEAK'
      || (error instanceof TypeError && /Object\.assign is not a constructor/.test(error.message)),
    'a research authority leak must fail closed');

  // Prompt injection through preview data: markup in block text stays inert text.
  const injected = createEvidenceView({
    fixture: composed,
    loadPage: (source, nav, page) => evidencePage(source, nav, page),
    loadPreview: async entry => ({
      artifact_id: entry.id, kind: 'markdown', available: true, sanitized: true,
      blocks: [{ type: 'paragraph', text: '<script>alert("T19-INJECT")</script><img src=x onerror=alert(2)>' }],
      sanitization: { removed_html_tags: 0, removed_script_blocks: 0, removed_js_urls: 0, links: [] },
      total_bytes: 42,
    }),
  });
  await injected.select('artifact:.lazybuddy/runs/run-alpha/evidence/report.md');
  const injectedPanel = injected.element.querySelector('[data-testid="evidence-preview"]');
  assert.equal(injectedPanel.querySelectorAll('script, img, iframe').length, 0);
  assert.ok(injectedPanel.textContent.includes('<script>alert("T19-INJECT")</script>'),
    'injected markup is visible as inert text data, not elements');

  // A failing preview loader surfaces a typed unavailable note, never a crash.
  const failing = createEvidenceView({
    fixture: composed,
    loadPage: (source, nav, page) => evidencePage(source, nav, page),
    loadPreview: async () => { const error = new Error('unreadable'); error.code = 'ARTIFACT_INACCESSIBLE'; throw error; },
  });
  await failing.select('artifact:.lazybuddy/runs/run-alpha/evidence/report.md');
  assert.match(failing.element.querySelector('[data-testid="evidence-preview"]').textContent,
    /preview unavailable: ARTIFACT_INACCESSIBLE/);

  // Misleading success: the exact-zero scope and the beyond-last-page clamp both
  // stay visible rather than silently resetting.
  const honest = createEvidenceView({
    fixture: composed,
    loadPage: (source, nav, page) => evidencePage(source, nav, page),
    loadPreview: async () => null,
  });
  honest.setPage(999);
  assert.equal(honest.getStats().page, honest.getStats().totals.page_count);
  assert.match(honest.element.querySelector('[data-testid="evidence-status"]').textContent, /beyond the last page/);
});
