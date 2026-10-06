import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArtifactIndex, classifyArtifact } from '../artifacts/index.mjs';
import { ARTIFACT_FILE_LIMIT, PREVIEW_TEXT_LIMIT } from '../artifacts/paths.mjs';
import { renderArtifactPreview, sanitizeMarkdown } from '../artifacts/preview.mjs';
import { prepareArtifactRegistration } from '../artifacts/register.mjs';
import {
  assertResearchGrantsNothing, composeResearchFindings, researchPromotionView, researchSourcePaths,
} from '../artifacts/research.mjs';
import {
  artifactsForFeature, artifactsForGate, artifactsForPlan, artifactsForTask, coverageOf, paginate,
} from '../artifacts/query.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:artifact-index';
const ACTOR = 'local:t12';

const sha = value => createHash('sha256').update(value).digest('hex');
const byId = (records, id) => {
  const value = records.find(record => record.id === id);
  assert.ok(value, `Missing record ${id}`);
  return value;
};
const entryByPath = (index, path) => {
  const value = index.entries.find(entry => entry.path === path);
  assert.ok(value, `Missing indexed artifact at ${path}`);
  return value;
};

function put(root, path, content, options = {}) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content, { mode: options.mode ?? 0o644 });
}

function fileRecord(path) {
  const stat = lstatSync(path, { bigint: true });
  assert.ok(stat.isFile(), `Expected regular fixture file: ${path}`);
  return { sha256: sha(readFileSync(path)), bytes: Number(stat.size), inode: stat.ino.toString() };
}

function manifest(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) files[path.slice(root.length + 1)] = { symlink: true };
      else files[path.slice(root.length + 1)] = fileRecord(path);
    }
  }
  visit(root);
  return files;
}

function invoke(root, action, input, options = {}) {
  const args = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID,
    '--actor', options.actor ?? ACTOR];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false, timeout: 25000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => resolve({
      code, signal,
      stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    }));
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

function parseSuccess(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '', 'Successful CLI operations should not emit hidden warnings');
  return JSON.parse(result.stdout);
}

function assertFailure(result, code) {
  assert.equal(result.signal, null);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '', 'Rejected input must not yield an accepted snapshot');
  if (code) assert.match(result.stderr, code);
}

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

const REPORT_MD = `# Release verification report

The suite passed with **no failures** across 3 scenarios.

<script>alert('T12-PWNED-MARKER')</script>
Also an inline <img src=x onerror=alert(1)> image tag.

* [malicious](javascript:alert('T12-JS-URL'))
* [external spec](https://example.com/spec)

\`\`\`text
fenced data keeps <script>raw-tags</script> as text
\`\`\`

## Notes

Plain paragraph with a <b>bold</b> tag.
`;

const RESEARCH_MD = `# Research: offline storage

Which local store should the notes use?

<script>alert('T12-RESEARCH-PWNED')</script>
`;

const SUMMARY_JSON = JSON.stringify({ total: 1, tests: [{ status: 'pass', name: 'a' }] }) + '\n';
const BETA_JSON = JSON.stringify({ beta: true, suites: ['unit'] }) + '\n';
const SUBMISSION_ONE = Buffer.from('archived evidence submission one\n');
const SUBMISSION_TWO_CURRENT = Buffer.from('archived evidence submission two (current bytes)\n');
const SUBMISSION_TWO_ORIGINAL = Buffer.from('archived evidence submission two (original bytes)\n');
const LONG_TEXT_BYTES = 70 * 1024;
const REQUIREMENTS_MD = `# Requirements

## feature:notes — Personal notes

The product provides personal notes.

## requirement:offline — Work without a network

Cloud sign-in is not a prerequisite.
`;
const ALPHA_PLAN_MD = '# Alpha plan\n\nDeliver the alpha milestone.\n';

function seedEvidenceTree(root) {
  put(root, '.lazybuddy/runs/run-alpha/state.json', JSON.stringify({
    schema_version: '2', run_id: 'run-alpha', dashboard_project_id: 'native:t12',
    created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
    objective: 'Seed the T12 evidence tree', status: 'verifying', plan_reference: 'docs/plans/alpha.md',
    tasks: [
      { id: 'task-impl', title: 'Implement', status: 'done', evidence: ['.lazybuddy/runs/run-alpha/evidence/run-log.txt'] },
      { id: 'task-check', title: 'Check', status: 'done', evidence: ['evidence/summary.json'] },
    ],
    progress: { total_checkboxes: 0, completed_checkboxes: 0 },
    verification_gates: [{ name: 'gate:tests', status: 'passed' }, { name: 'gate:build', status: 'pending' }],
    review_status: 'not_started', iteration: {}, last_checkpoint: null, budget: {}, session_ids: [],
  }) + '\n');
  put(root, '.lazybuddy/runs/run-alpha/evidence/report.md', REPORT_MD);
  put(root, '.lazybuddy/runs/run-alpha/evidence/run-log.txt', '2026-10-05 run started\n2026-10-05 run finished\n');
  put(root, '.lazybuddy/runs/run-alpha/evidence/shot.png', PNG_BYTES);
  put(root, '.lazybuddy/runs/run-alpha/evidence/summary.json', SUMMARY_JSON);
  put(root, '.lazybuddy/runs/run-alpha/verification/gate-report.md', '# Gate report\n\nBoth gates inspected.\n');
  put(root, '.lazybuddy/runs/run-alpha/artifacts/blob.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]));
  put(root, '.lazybuddy/runs/run-alpha/review/notes.md', '# Review note outside the indexed evidence directories\n');

  put(root, '.lazybuddy/runs/run-beta/state.json', JSON.stringify({
    schema_version: 1, run_id: 'run-beta', dashboard_project_id: 'native:t12', revision: 7, plan_revision: 3,
    tasks: [{
      id: 'task-verify', title: 'Verify',
      criteria: [{ id: 'crit:e2e', version: 2, requirement: 'The flow works', applicability: 'required',
        verification: 'unverified', scenarios: [], result_ids: [], history: [] }],
      attempts: [{
        id: 'attempt-1', task_id: 'task-verify', criterion_id: 'crit:e2e', criterion_version: 2,
        plan_revision: 3, consumed_plan_revision: 3, worker_id: 'worker:a', parent_task_id: null,
        source_revision: null, execution: 'finished', verification: 'unverified',
        started_at: null, finished_at: null,
        evidence: [{ path: '.lazybuddy/runs/run-beta/evidence/beta-summary.json', sha256: null, provenance: 'worker:a' }],
        provenance: { source_id: 'src:1', generation: 'g1', source_event_id: 'evt:1', line: 1, kind: 'runtime', timestamp: null },
      }],
    }],
    evidence_submissions: [
      { evidence: { path: 'docs/one.txt', sha256: null, provenance: 'worker:a' },
        archived_path: 'artifacts/submission-1', archived_sha256: sha(SUBMISSION_ONE) },
      { evidence: { path: 'docs/two.txt', sha256: null, provenance: 'worker:a' },
        archived_path: 'artifacts/submission-2', archived_sha256: sha(SUBMISSION_TWO_ORIGINAL) },
    ],
  }) + '\n');
  put(root, '.lazybuddy/runs/run-beta/evidence/beta-summary.json', BETA_JSON);
  put(root, '.lazybuddy/runs/run-beta/artifacts/submission-1', SUBMISSION_ONE);
  put(root, '.lazybuddy/runs/run-beta/artifacts/submission-2', SUBMISSION_TWO_CURRENT);

  mkdirSync(join(root, '.lazybuddy/runs/run-gamma/artifacts'), { recursive: true });
  put(root, '.lazybuddy/runs/run-gamma/evidence/moved-report.md', '# Moved report\n\nOriginal body.\n');
  put(root, '.lazybuddy/runs/run-gamma/evidence/gone.md', '# Gone\n\nThis file will be deleted.\n');
  put(root, '.lazybuddy/runs/run-gamma/evidence/redact-note.md', '# Note\n\nsecret token ABC123\n');
  put(root, '.lazybuddy/runs/run-gamma/evidence/huge.log', Buffer.alloc(ARTIFACT_FILE_LIMIT + 1, 0x2e));
  put(root, 'docs/redir/target.md', '# Redirect target\n');
  mkdirSync(dirname(join(root, '.lazybuddy/runs/run-gamma/evidence/link.md')), { recursive: true });
  symlinkSync('../../../../docs/redir/target.md', join(root, '.lazybuddy/runs/run-gamma/evidence/link.md'));

  for (let index = 0; index < 60; index += 1) {
    put(root, `.lazybuddy/runs/run-delta/evidence/bulk-${String(index).padStart(2, '0')}.log`, `bulk line ${index}\n`);
  }
  put(root, '.lazybuddy/runs/run-delta/evidence/long.txt', Buffer.alloc(LONG_TEXT_BYTES, 0x61));

  put(root, '.lazybuddy/runs/run-broken/state.json', '{ this is not json\n');
  put(root, '.lazybuddy/runs/run-broken/evidence/orphan.md', '# Orphan\n\nRun state unparseable; file still indexed.\n');

  put(root, 'docs/project/requirements.md', REQUIREMENTS_MD);
  put(root, 'docs/plans/alpha.md', ALPHA_PLAN_MD);
  put(root, 'research/notes/q1.md', RESEARCH_MD);
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazybuddy-artifact-index-')));
  seedEvidenceTree(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    snapshot: null,
    sequence: 0,
    statePath: join(root, '.lazybuddy/project/state.json'),
    async init() { this.snapshot = parseSuccess(await invoke(root, 'init')); return this.snapshot; },
    async read() { this.snapshot = parseSuccess(await invoke(root, 'read')); return this.snapshot; },
    command(operation, payload, overrides = {}) {
      return {
        schema_version: 1,
        command_id: `t12:${++this.sequence}`,
        project_id: PROJECT_ID,
        expected_revision: this.snapshot.revision,
        operation,
        payload,
        ...overrides,
      };
    },
    async send(operation, payload, overrides = {}) {
      const command = this.command(operation, payload, overrides);
      const result = parseSuccess(await invoke(root, 'command', command));
      assert.equal(result.receipt.status, 'saved');
      this.snapshot = result.snapshot;
      return { ...result, command };
    },
    async reject(operation, payload, overrides = {}) {
      return invoke(root, 'command', this.command(operation, payload, overrides));
    },
    persisted() { return JSON.parse(readFileSync(this.statePath, 'utf8')); },
  };
}

// The registration-bearing tests share one real CLI project so the suite stays within
// one bridge-transaction budget; the fixture lives until process exit.
let sharedProject = null;
async function project() {
  if (sharedProject) return sharedProject;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazybuddy-artifact-project-')));
  seedEvidenceTree(root);
  const f = {
    root,
    snapshot: null,
    sequence: 0,
    statePath: join(root, '.lazybuddy/project/state.json'),
    async init() { this.snapshot = parseSuccess(await invoke(root, 'init')); return this.snapshot; },
    async read() { this.snapshot = parseSuccess(await invoke(root, 'read')); return this.snapshot; },
    command(operation, payload, overrides = {}) {
      return {
        schema_version: 1,
        command_id: `t12:${++this.sequence}`,
        project_id: PROJECT_ID,
        expected_revision: this.snapshot.revision,
        operation,
        payload,
        ...overrides,
      };
    },
    async send(operation, payload, overrides = {}) {
      const command = this.command(operation, payload, overrides);
      const result = parseSuccess(await invoke(root, 'command', command));
      assert.equal(result.receipt.status, 'saved');
      this.snapshot = result.snapshot;
      return { ...result, command };
    },
    async reject(operation, payload, overrides = {}) {
      return invoke(root, 'command', this.command(operation, payload, overrides));
    },
    persisted() { return JSON.parse(readFileSync(this.statePath, 'utf8')); },
  };
  await f.init();
  await f.send('register_source', { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements' });
  await f.send('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: { source_id: 'source:requirements', sha256: sha(REQUIREMENTS_MD), anchor_id: 'heading:feature:notes — Personal notes' } },
    { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
      source: { source_id: 'source:requirements', sha256: sha(REQUIREMENTS_MD), anchor_id: 'heading:requirement:offline — Work without a network' } },
  ] });
  await f.send('register_source', { id: 'source:alpha', path: 'docs/plans/alpha.md', role: 'plan' });
  await f.send('register_plan', {
    id: 'plan:alpha',
    source: { source_id: 'source:alpha', sha256: sha(ALPHA_PLAN_MD), anchor_id: 'document' },
    declared_lifecycle: 'planned',
    baseline_refs: [{ item_id: 'feature:notes', item_revision: 1 }, { item_id: 'requirement:offline', item_revision: 1 }],
  });
  await f.send('link_native_run', { plan_id: 'plan:alpha', native_project_id: 'native:t12', run_id: 'run-alpha' });

  const registrations = [
    { id: 'artifact:alpha-report', path: '.lazybuddy/runs/run-alpha/evidence/report.md' },
    { id: 'artifact:gamma-moved', path: '.lazybuddy/runs/run-gamma/evidence/moved-report.md' },
    { id: 'artifact:gamma-gone', path: '.lazybuddy/runs/run-gamma/evidence/gone.md' },
    { id: 'artifact:gamma-redact', path: '.lazybuddy/runs/run-gamma/evidence/redact-note.md' },
    { id: 'artifact:research-q1', path: 'research/notes/q1.md' },
  ];
  for (const registration of registrations) {
    const prepared = await prepareArtifactRegistration(f.root, {
      project_id: PROJECT_ID, expected_revision: f.snapshot.revision,
      command_id: `t12:register:${registration.id}`, producer: 'producer:t12-suite', path: registration.path,
      id: registration.id,
    });
    await f.send('artifact.register', prepared.command.payload);
  }

  await f.send('record_baseline_proposal', {
    id: 'proposal:t12', summary: 'Adopt the researched local storage choice',
    patches: [{ source_id: 'source:requirements', anchor_id: 'document',
      current_sha256: sha(REQUIREMENTS_MD), proposed_text: REQUIREMENTS_MD.replace('Cloud sign-in is not a prerequisite.', 'Notes storage stays local-first.') }],
    options: [], impact: { item_ids: ['requirement:offline'], plan_ids: [], architecture_ids: [] },
    evidence_observation_ids: [],
  });
  await f.send('record_research_findings', { findings: [{
    id: 'research:q1', question: 'Which local store should the notes use?',
    sources: ['research/notes/q1.md', 'https://example.com/lazyseries/spec'],
    captured_at: '2026-10-05T00:00:00Z', findings: 'SQLite is embedded and offline-capable.',
    uncertainty: 'Concurrency under multi-window edits was not measured.', recommendation: 'Adopt SQLite behind the notes repository.',
  }] });
  await f.send('record_research_findings', { findings: [{
    id: 'research:q2', question: 'Does the export path need cloud sync?',
    sources: ['https://example.com/other'], captured_at: '2026-10-05T00:00:00Z',
    findings: 'No: exports are local files.', recommendation: 'Keep exports local.',
    promotion_proposal_id: 'proposal:t12',
  }] });

  renameSync(join(f.root, '.lazybuddy/runs/run-gamma/evidence/moved-report.md'),
    join(f.root, '.lazybuddy/runs/run-gamma/artifacts/moved-report.md'));
  rmSync(join(f.root, '.lazybuddy/runs/run-gamma/evidence/gone.md'));
  writeFileSync(join(f.root, '.lazybuddy/runs/run-gamma/evidence/redact-note.md'), '# Note\n\n[REDACTED]\n');
  await f.read();
  sharedProject = f;
  process.on('exit', () => rmSync(root, { recursive: true, force: true }));
  return f;
}
test('shared project fixture seeds once through the real CLI route', async () => {
  const f = await project();
  assert.ok(f.snapshot.revision >= 13);
  assert.equal(f.persisted().artifacts.length, 5);
  assert.equal(f.persisted().research.length, 2);
});

test('scan of the real native evidence tree classifies files, binds run relationships and never writes', async t => {
  const f = fixture(t);
  const before = manifest(f.root);
  const index = await buildArtifactIndex(f.root, {});
  assert.deepEqual(manifest(f.root), before, 'A scan must not create, move or rewrite any file');
  assert.equal(existsSync(join(f.root, '.lazyseries')), false, 'No neutral registry may appear from a scan');

  assert.deepEqual(index.scan.directories, ['artifacts', 'evidence', 'verification']);
  assert.equal(index.scan.runs_discovered, 5);
  assert.equal(index.entries.some(entry => entry.path === '.lazybuddy/runs/run-alpha/review/notes.md'), false,
    'Files outside the three evidence directories are not part of the evidence index');
  assert.ok(index.scan.notes.some(note => note.run_id === 'run-broken' && note.reason === 'state_unparseable'),
    'An unparseable run state must be reported, not silently dropped');

  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/evidence/report.md'), 'design_note');
  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/verification/gate-report.md'), 'verification_report');
  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/evidence/shot.png'), 'screenshot');
  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/evidence/run-log.txt'), 'log');
  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/evidence/summary.json'), 'test_summary');
  assert.equal(classifyArtifact('.lazybuddy/runs/run-alpha/artifacts/blob.bin'), null);
  assert.equal(classifyArtifact('research/notes/q1.md'), 'research');

  const report = entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/report.md');
  assert.deepEqual(report.origins, ['scan']);
  assert.equal(report.producer, 'run:run-alpha');
  assert.equal(report.sha256, sha(REPORT_MD));
  assert.equal(report.status, 'available');
  assert.equal(report.preview.kind, 'markdown');
  assert.equal(report.applicability.run_id, 'run-alpha');
  assert.deepEqual(report.applicability.task_ids, []);
  assert.equal(report.applicability.run_revision, null);

  const runLog = entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/run-log.txt');
  assert.deepEqual(runLog.applicability.task_ids, ['task-impl'], 'Repository-relative evidence references bind tasks');
  const summary = entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/summary.json');
  assert.deepEqual(summary.applicability.task_ids, ['task-check'], 'Run-relative evidence references bind tasks');

  const gate = entryByPath(index, '.lazybuddy/runs/run-alpha/verification/gate-report.md');
  assert.deepEqual(gate.applicability.gate_names.sort(), ['gate:build', 'gate:tests']);
  assert.equal(gate.type, 'verification_report');

  const beta = entryByPath(index, '.lazybuddy/runs/run-beta/evidence/beta-summary.json');
  assert.equal(beta.applicability.run_revision, 7);
  assert.equal(beta.applicability.plan_revision, 3);
  assert.deepEqual(beta.applicability.task_ids, ['task-verify']);
  assert.deepEqual(beta.applicability.attempt_ids, ['attempt-1']);
  assert.deepEqual(beta.applicability.criterion_versions, [{ id: 'crit:e2e', version: 2 }]);

  const submissionOne = entryByPath(index, '.lazybuddy/runs/run-beta/artifacts/submission-1');
  assert.equal(submissionOne.sha256, sha(SUBMISSION_ONE));
  assert.equal(submissionOne.expected_sha256, sha(SUBMISSION_ONE));
  assert.equal(submissionOne.status, 'unsupported', 'An archived submission without preview kind is honestly unsupported');
  assert.equal(submissionOne.preview.available, false);
  assert.equal(submissionOne.preview.reason, 'unsupported_preview_kind');
  const submissionTwo = entryByPath(index, '.lazybuddy/runs/run-beta/artifacts/submission-2');
  assert.equal(submissionTwo.status, 'redacted', 'Current bytes differing from the archived digest are redacted');
  assert.equal(submissionTwo.sha256, sha(SUBMISSION_TWO_CURRENT));
  assert.equal(submissionTwo.expected_sha256, sha(SUBMISSION_TWO_ORIGINAL));

  assert.equal(entryByPath(index, '.lazybuddy/runs/run-alpha/artifacts/blob.bin').status, 'unsupported');
  const huge = entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/huge.log');
  assert.equal(huge.status, 'unsupported');
  assert.equal(huge.preview.reason, 'file_too_large');
  assert.equal(huge.sha256, null, 'An oversized artifact cannot claim a digest it never read');
  const link = entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/link.md');
  assert.equal(link.status, 'inaccessible');
  assert.equal(link.preview.reason, 'symlink_refused');
  assert.equal(entryByPath(index, '.lazybuddy/runs/run-broken/evidence/orphan.md').status, 'available');

  const coverage = coverageOf(index.entries);
  assert.equal(coverage.total, index.entries.length);
  assert.equal(Object.values(coverage.by_status).reduce((sum, count) => sum + count, 0), index.entries.length);
  assert.ok(coverage.by_status.inaccessible >= 1 && coverage.by_status.unsupported >= 3 && coverage.by_status.redacted >= 1);
  t.diagnostic(JSON.stringify({ entries: index.entries.length, coverage: coverage.by_status,
    runs: index.scan.runs_discovered, writes: 0 }));
});

test('safe previews render markdown, image, JSON and text as data with original-file links', async t => {
  const f = fixture(t);
  const index = await buildArtifactIndex(f.root, {});
  const report = entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/report.md');

  const markdown = await renderArtifactPreview(f.root, report);
  assert.equal(markdown.kind, 'markdown');
  assert.equal(markdown.available, true);
  assert.equal(markdown.sanitized, true);
  assert.equal(markdown.original.link, '.lazybuddy/runs/run-alpha/evidence/report.md');
  assert.ok(markdown.sanitization.removed_script_blocks >= 1, 'The embedded script block must be removed');
  assert.ok(markdown.sanitization.removed_html_tags >= 2, 'The img and b tags must be stripped');
  assert.equal(markdown.sanitization.removed_js_urls, 1);
  assert.ok(markdown.sanitization.links.some(link => link.text === 'external spec' && link.href === 'https://example.com/spec'));
  assert.ok(markdown.sanitization.links.every(link => !/^javascript:/i.test(link.href)));
  for (const block of markdown.blocks) {
    assert.equal(typeof block.text, 'string');
    if (block.type === 'code') continue;
    assert.ok(!block.text.includes('<script'), 'No raw script markup may survive outside verbatim code data');
    assert.ok(!block.text.includes('T12-PWNED-MARKER'), 'The script payload must not survive');
    assert.ok(!block.text.includes('onerror'), 'Stripped tag attributes must not survive');
    assert.ok(!block.text.includes('javascript:'), 'Stripped link targets must not survive');
  }
  const code = markdown.blocks.find(block => block.type === 'code');
  assert.ok(code && code.text.includes('<script>raw-tags</script>'), 'Fenced code stays data, untouched by HTML stripping');
  const heading = markdown.blocks.find(block => block.type === 'heading' && block.level === 1);
  assert.equal(heading.text, 'Release verification report');
  assert.ok(markdown.blocks.some(block => block.type === 'paragraph' && block.text.includes('bold')));

  const image = await renderArtifactPreview(f.root, entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/shot.png'));
  assert.equal(image.kind, 'image');
  assert.equal(image.available, true);
  assert.equal(image.image.mime, 'image/png');
  assert.equal(image.image.bytes, PNG_BYTES.length);
  assert.match(image.image.data_url, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);

  const json = await renderArtifactPreview(f.root, entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/summary.json'));
  assert.equal(json.kind, 'json');
  assert.equal(json.available, true);
  assert.equal(json.json.canonical, '{"tests":[{"name":"a","status":"pass"}],"total":1}');
  assert.deepEqual(JSON.parse(json.json.canonical), JSON.parse(SUMMARY_JSON));
  assert.equal(json.json.truncated, false);

  const text = await renderArtifactPreview(f.root, entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/run-log.txt'));
  assert.equal(text.kind, 'text');
  assert.equal(text.available, true);
  assert.equal(text.text.truncated, false);
  assert.equal(text.text.content, '2026-10-05 run started\n2026-10-05 run finished\n');

  const long = await renderArtifactPreview(f.root, entryByPath(index, '.lazybuddy/runs/run-delta/evidence/long.txt'));
  assert.equal(long.text.truncated, true, 'Preview truncation is always flagged, never silent');
  assert.equal(long.text.total_bytes, LONG_TEXT_BYTES);
  assert.ok(long.text.content.length <= PREVIEW_TEXT_LIMIT);

  const movedShape = { ...entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/huge.log') };
  const unsupported = await renderArtifactPreview(f.root, movedShape);
  assert.equal(unsupported.available, false);
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.original.link, movedShape.path);

  const unit = sanitizeMarkdown('<script>alert("x")</script>\n# Heading\n');
  assert.equal(unit.blocks.length, 1);
  assert.equal(unit.blocks[0].text, 'Heading');
  assert.equal(unit.sanitization.removed_script_blocks, 1);
  t.diagnostic(JSON.stringify({ markdown_blocks: markdown.blocks.length,
    removed_script_blocks: markdown.sanitization.removed_script_blocks,
    removed_html_tags: markdown.sanitization.removed_html_tags,
    removed_js_urls: markdown.sanitization.removed_js_urls,
    kept_links: markdown.sanitization.links.length, image_bytes: image.image.bytes,
    json_canonical_bytes: json.json.canonical.length, text_truncated: long.text.truncated }));
});

test('registration goes through the real CLI command route with digest, size and path refusals', async t => {
  const f = await project();
  const persistedBefore = f.persisted();
  const artifactCount = persistedBefore.artifacts.length;

  const refusals = [
    [{ producer: 'producer:t12-suite', path: '../../outside/secrets.md' }],
    [{ producer: 'producer:t12-suite', path: '.lazybuddy/dashboard/credential' }],
    [{ producer: 'producer:t12-suite', path: '.lazyseries/project.json' }],
    [{ producer: 'producer:t12-suite', path: '.lazybuddy/runs/run-gamma/evidence/link.md' }],
    [{ producer: 'producer:t12-suite', path: '.lazybuddy/runs/run-gamma/evidence/huge.log' }],
    [{ producer: 'producer:t12-suite', path: 'docs/missing.md' }],
    [{ producer: 'producer:t12-suite', path: '.lazybuddy/runs/run-alpha/evidence/report.md',
      expected_sha256: sha(Buffer.from('wrong digest')) }],
    [{ producer: 'producer:t12-suite', path: '.lazybuddy/runs/run-beta/artifacts/submission-1' }],
  ];
  // A `.lazyseries` registration surfaces PROTECTED_REGISTRY_PATH, not
  // PROTECTED_ARTIFACT_PATH: assertRegistrableArtifactPath applies the shared
  // contract's relative-source rules first, and the contract-level registry
  // namespace protection (T06) precedes the compose-layer artifact rule (T12).
  // The `.lazybuddy/{dashboard,project}` native storage stays PROTECTED_SOURCE_PATH.
  const expectedCodes = ['UNSAFE_SOURCE_PATH', 'PROTECTED_SOURCE_PATH', 'PROTECTED_REGISTRY_PATH',
    'ARTIFACT_SYMLINK_REFUSED', 'ARTIFACT_TOO_LARGE', 'ARTIFACT_MISSING', 'ARTIFACT_DIGEST_MISMATCH',
    'ARTIFACT_TYPE_REQUIRED'];
  for (let index = 0; index < refusals.length; index += 1) {
    await assert.rejects(prepareArtifactRegistration(f.root, {
      project_id: PROJECT_ID, expected_revision: f.snapshot.revision,
      command_id: `t12:refusal:${index}`, ...refusals[index][0],
    }), error => {
      assert.equal(error.code, expectedCodes[index]);
      return true;
    });
  }
  assert.deepEqual(f.persisted(), persistedBefore, 'Refused registrations must not touch the accepted project');

  assertFailure(await f.reject('artifact.register', {
    id: 'artifact:traversal', type: 'log', producer: 'producer:t12-suite', path: '../../outside/secrets.md',
  }), /^UNSAFE_SOURCE_PATH\n$/);
  assertFailure(await f.reject('artifact.register', {
    id: 'artifact:credential', type: 'log', producer: 'producer:t12-suite', path: '.lazybuddy/dashboard/credential',
  }), /^PROTECTED_SOURCE_PATH\n$/);
  assert.deepEqual(f.persisted(), persistedBefore, 'The real command route refuses unsafe and protected paths without writes');

  const persisted = f.persisted();
  assert.equal(persisted.artifacts.length, artifactCount);
  const registered = byId(persisted.artifacts, 'artifact:alpha-report');
  assert.equal(registered.path, '.lazybuddy/runs/run-alpha/evidence/report.md');
  assert.equal(registered.sha256, sha(REPORT_MD));
  assert.equal(registered.type, 'design_note');
  assert.equal(registered.producer, 'producer:t12-suite');
  const research = byId(persisted.artifacts, 'artifact:research-q1');
  assert.equal(research.type, 'research');
  assert.equal(research.sha256, sha(RESEARCH_MD));
  for (const record of persisted.artifacts) assert.match(record.sha256, /^[a-f0-9]{64}$/);
  t.diagnostic(JSON.stringify({ typed_refusals: expectedCodes.length, cli_route_refusals: 2,
    registered_artifacts: persisted.artifacts.length, digest_verified: true }));
});

test('moved, missing and redacted registered artifacts have distinct visible states', async t => {
  const f = await project();
  const index = await buildArtifactIndex(f.root, { snapshot: f.snapshot });

  const moved = entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/moved-report.md');
  assert.deepEqual(moved.origins, ['registered']);
  assert.equal(moved.status, 'moved');
  assert.equal(moved.moved_to, '.lazybuddy/runs/run-gamma/artifacts/moved-report.md');
  assert.equal(moved.sha256, null);
  const relocated = entryByPath(index, '.lazybuddy/runs/run-gamma/artifacts/moved-report.md');
  assert.equal(relocated.status, 'available');
  assert.equal(relocated.sha256, moved.expected_sha256);

  const gone = entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/gone.md');
  assert.equal(gone.status, 'missing');
  assert.equal(gone.moved_to, null);

  const redacted = entryByPath(index, '.lazybuddy/runs/run-gamma/evidence/redact-note.md');
  assert.equal(redacted.status, 'redacted');
  assert.equal(redacted.expected_sha256, sha('# Note\n\nsecret token ABC123\n'));
  assert.equal(redacted.sha256, sha('# Note\n\n[REDACTED]\n'));
  assert.notEqual(redacted.sha256, redacted.expected_sha256);

  const report = entryByPath(index, '.lazybuddy/runs/run-alpha/evidence/report.md');
  assert.deepEqual(report.origins, ['scan', 'registered']);
  assert.equal(report.status, 'available');
  assert.equal(report.registered.id, 'artifact:alpha-report');
  assert.equal(report.applicability.project_revision, f.snapshot.revision);
  assert.deepEqual(report.applicability.plan_ids, ['plan:alpha']);
  assert.deepEqual(report.applicability.feature_ids, ['feature:notes']);
  assert.equal(report.applicability.content_revision, sha(REPORT_MD));

  const researchEntry = entryByPath(index, 'research/notes/q1.md');
  assert.equal(researchEntry.type, 'research');
  assert.deepEqual(researchEntry.applicability.research_ids, ['research:q1']);

  const statuses = new Set(index.entries.map(entry => entry.status));
  for (const status of ['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible']) {
    assert.ok(statuses.has(status), `The fixture must exercise the ${status} state`);
  }
  t.diagnostic(JSON.stringify({ moved_to: moved.moved_to, missing: gone.status, redacted: redacted.status,
    both_origin: report.origin, plan_ids: report.applicability.plan_ids,
    feature_ids: report.applicability.feature_ids, research_ids: researchEntry.applicability.research_ids }));
});

test('pagination reports honest totals and coverage beyond one page', async t => {
  const f = await project();
  const index = await buildArtifactIndex(f.root, { snapshot: f.snapshot });
  const total = index.entries.length;
  assert.ok(total > 50, 'The fixture must contain more artifacts than one default page');

  const first = paginate(index.entries, {});
  assert.equal(first.page, 1);
  assert.equal(first.page_size, 50);
  assert.equal(first.total, total);
  assert.equal(first.entries.length, 50);
  assert.equal(first.has_next, true);
  assert.equal(first.page_count, Math.ceil(total / 50));
  assert.equal(first.truncated, false);

  const second = paginate(index.entries, { page: 2 });
  assert.equal(second.total, total);
  assert.equal(second.entries.length, total - 50);
  assert.equal(second.has_next, false);

  const combined = [...first.entries, ...second.entries].map(entry => entry.id).sort();
  assert.deepEqual(combined, index.entries.map(entry => entry.id).sort(), 'Pages must cover every artifact exactly once');

  const beyond = paginate(index.entries, { page: 999 });
  assert.equal(beyond.total, total);
  assert.deepEqual(beyond.entries, []);
  assert.equal(beyond.has_next, false);

  assert.equal(first.coverage.total, total);
  assert.equal(Object.values(first.coverage.by_status).reduce((sum, count) => sum + count, 0), total);
  assert.deepEqual(first.coverage.by_status, coverageOf(index.entries).by_status);

  await assert.rejects(async () => paginate(index.entries, { page: 0 }), error => error.code === 'INVALID_QUERY');
  await assert.rejects(async () => paginate(index.entries, { page_size: 0 }), error => error.code === 'INVALID_QUERY');
  t.diagnostic(JSON.stringify({ total, page_count: first.page_count, coverage: first.coverage.by_status }));
});

test('artifacts are queryable from task, gate, plan, feature and the global index', async t => {
  const f = await project();
  const index = await buildArtifactIndex(f.root, { snapshot: f.snapshot });

  const taskImpl = artifactsForTask(index, 'task-impl');
  assert.ok(taskImpl.entries.every(entry => entry.applicability.task_ids.includes('task-impl')));
  assert.ok(taskImpl.entries.some(entry => entry.path === '.lazybuddy/runs/run-alpha/evidence/run-log.txt'));
  assert.ok(!taskImpl.entries.some(entry => entry.path === '.lazybuddy/runs/run-alpha/evidence/report.md'));
  const taskVerify = artifactsForTask(index, 'task-verify');
  assert.ok(taskVerify.entries.some(entry => entry.path === '.lazybuddy/runs/run-beta/evidence/beta-summary.json'));
  assert.deepEqual(artifactsForTask(index, 'task-unknown'), { entries: [], total: 0, coverage: coverageOf([]) });

  const gates = artifactsForGate(index, 'gate:tests');
  assert.deepEqual(gates.entries.map(entry => entry.path), ['.lazybuddy/runs/run-alpha/verification/gate-report.md']);
  assert.deepEqual(artifactsForGate(index, 'gate:none').entries, []);

  const plans = artifactsForPlan(index, 'plan:alpha');
  assert.equal(plans.total, 6);
  assert.ok(plans.entries.every(entry => entry.applicability.plan_ids.includes('plan:alpha')));
  assert.deepEqual(plans.entries.map(entry => entry.path).sort(), [
    '.lazybuddy/runs/run-alpha/artifacts/blob.bin',
    '.lazybuddy/runs/run-alpha/evidence/report.md',
    '.lazybuddy/runs/run-alpha/evidence/run-log.txt',
    '.lazybuddy/runs/run-alpha/evidence/shot.png',
    '.lazybuddy/runs/run-alpha/evidence/summary.json',
    '.lazybuddy/runs/run-alpha/verification/gate-report.md',
  ]);

  const features = artifactsForFeature(index, 'feature:notes');
  assert.equal(features.total, plans.total);
  assert.deepEqual(features.entries.map(entry => entry.id).sort(), plans.entries.map(entry => entry.id).sort());
  assert.deepEqual(artifactsForFeature(index, 'feature:unknown').entries, []);

  const global = paginate(index.entries, { page_size: 500 });
  assert.equal(global.total, index.entries.length);
  assert.equal(global.entries.length, index.entries.length);
  t.diagnostic(JSON.stringify({ task_impl: taskImpl.total, task_verify: taskVerify.total,
    gate_tests: gates.total, plan_alpha: plans.total, feature_notes: features.total, global: global.total }));
});

test('research records promotion links fail-closed and grant no verification or requirement', async t => {
  const f = await project();
  const persisted = f.persisted();
  const itemsBefore = persisted.items.map(item => ({ id: item.id, state: item.state, revision: item.revision }));

  const unknownPromotion = composeResearchFindings({
    command_id: 't12:research-unknown', project_id: PROJECT_ID, expected_revision: f.snapshot.revision,
    findings: [{ id: 'research:q3', question: 'Unknown proposal link?', sources: ['https://example.com/x'],
      captured_at: '2026-10-05T00:00:00Z', findings: 'n/a', promotion_proposal_id: 'proposal:missing' }],
  });
  assertFailure(await invoke(f.root, 'command', unknownPromotion), /^INVALID_REFERENCE\n$/);
  const smuggled = composeResearchFindings({
    command_id: 't12:research-smuggle', project_id: PROJECT_ID, expected_revision: f.snapshot.revision,
    findings: [{ id: 'research:q4', question: 'Smuggle acceptance?', sources: ['https://example.com/x'],
      captured_at: '2026-10-05T00:00:00Z', findings: 'n/a', accepted: true, verification: 'verified' }],
  });
  assertFailure(await invoke(f.root, 'command', smuggled), /^UNKNOWN_FIELD\n$/);
  assert.deepEqual(f.persisted().items.map(item => ({ id: item.id, state: item.state, revision: item.revision })), itemsBefore,
    'Refused research commands must not touch baseline items');

  const view = researchPromotionView(f.snapshot);
  const q1 = byId(view, 'research:q1');
  assert.equal(q1.promotion.status, 'unlinked');
  assert.equal(q1.promotion.proposal_id, null);
  assert.equal(q1.promotion.grants_verification, false);
  assert.equal(q1.promotion.accepts_requirement, false);
  assert.equal(q1.promotion.promotion_path, 'proposal_only');
  const q2 = byId(view, 'research:q2');
  assert.equal(q2.promotion.status, 'linked_proposed');
  assert.equal(q2.promotion.proposal_id, 'proposal:t12');
  assert.equal(q2.promotion.proposal_state, 'proposed');
  assert.equal(q2.promotion.grants_verification, false);
  assert.ok(view.every(finding => finding.promotion.grants_verification === false && finding.promotion.accepts_requirement === false));

  const authority = assertResearchGrantsNothing(f.snapshot);
  assert.equal(authority.research_count, 2);
  assert.equal(authority.grants_verification, false);
  assert.equal(authority.accepts_requirement, false);
  assert.deepEqual(authority.accepted_requirement_ids, ['requirement:offline']);

  const after = f.persisted();
  assert.deepEqual(after.items.map(item => ({ id: item.id, state: item.state, revision: item.revision })), itemsBefore,
    'Saving research notes must not accept requirements or change baseline state');
  assert.equal(after.items.length, 2);
  assert.equal(after.proposals.length, 1);
  assert.equal(after.proposals[0].state, 'proposed', 'A promotion link leaves the proposal unaccepted');
  assert.equal(after.revision, f.snapshot.revision, 'Research refusals must not advance the revision');

  const paths = researchSourcePaths(byId(f.snapshot.research, 'research:q1'));
  assert.deepEqual(paths.paths, ['research/notes/q1.md']);
  assert.deepEqual(paths.rejected, ['https://example.com/lazyseries/spec']);
  t.diagnostic(JSON.stringify({ research_records: authority.research_count,
    promotion_statuses: view.map(finding => finding.promotion.status),
    grants_verification: false, accepts_requirement: false,
    accepted_requirements_unchanged: authority.accepted_requirement_ids }));
});

test('composeResearchFindings refuses malformed requests with typed INVALID_RESEARCH_REQUEST (T12-R1)', async t => {
  await assert.rejects(async () => composeResearchFindings({ project_id: 'project:artifact-index', expected_revision: 1 }),
    error => {
      assert.equal(error.name, 'Error', 'The refusal must be a plain Error, never a raw TypeError');
      assert.equal(error.code, 'INVALID_RESEARCH_REQUEST');
      assert.match(error.message, /INVALID_RESEARCH_REQUEST/);
      return true;
    });
  t.diagnostic('code=INVALID_RESEARCH_REQUEST present on the Error');
});

test('composeResearchFindings refuses empty findings with typed EMPTY_CHANGE (T12-R1)', async t => {
  await assert.rejects(async () => composeResearchFindings({
    command_id: 't12:r1-empty', project_id: 'project:artifact-index', expected_revision: 1, findings: [],
  }), error => {
    assert.equal(error.name, 'Error', 'The refusal must be a plain Error, never a raw TypeError');
    assert.equal(error.code, 'EMPTY_CHANGE');
    assert.match(error.message, /EMPTY_CHANGE/);
    return true;
  });
  t.diagnostic('code=EMPTY_CHANGE present on the Error');
});

test('researchPromotionView refuses unknown promotion links with typed UNKNOWN_PROPOSAL (T12-R1)', async t => {
  await assert.rejects(async () => researchPromotionView({
    proposals: [{ id: 'proposal:known', state: 'proposed' }],
    research: [{ id: 'research:r1', promotion_proposal_id: 'proposal:missing' }],
  }), error => {
    assert.equal(error.name, 'Error', 'The refusal must be a plain Error, never a raw TypeError');
    assert.equal(error.code, 'UNKNOWN_PROPOSAL');
    assert.match(error.message, /UNKNOWN_PROPOSAL/);
    return true;
  });
  t.diagnostic('code=UNKNOWN_PROPOSAL present on the Error');
});

test('assertResearchGrantsNothing refuses smuggled authority with typed RESEARCH_AUTHORITY_LEAK naming the key (T12-R1)', async t => {
  await assert.rejects(async () => assertResearchGrantsNothing({
    research: [{ id: 'research:r1', question: 'Smuggle acceptance?', verification: 'verified' }],
  }), error => {
    assert.equal(error.name, 'Error', 'The refusal must be a plain Error, never a raw TypeError');
    assert.equal(error.code, 'RESEARCH_AUTHORITY_LEAK');
    assert.match(error.message, /RESEARCH_AUTHORITY_LEAK: verification$/, 'The message must name the smuggled key');
    return true;
  });
  t.diagnostic('code=RESEARCH_AUTHORITY_LEAK present; smuggled key named in the message');
});
