const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { assessCompletion } = require('../scripts/completion-assessment');
const EXPECTED_MUTATION_REASONS = require('../contracts/fixtures/v120/completion-assessment-reasons.json');

const VERSION = '1.2.0';
const STATE = '.lazybuddy/runs/run-1/completion-authority.json';
const FIXTURE_ROOTS = new Set();
test.after(() => { for (const root of FIXTURE_ROOTS) fs.rmSync(root, { recursive: true, force: true }); });
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function write(root, relative, value) {
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}
function git(root, ...args) {
  const done = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(done.status, 0, done.stderr); return done.stdout.trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-completion-v120-'));
  FIXTURE_ROOTS.add(root);
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'completion@example.invalid'); git(root, 'config', 'user.name', 'Completion Fixture');
  write(root, '.gitignore', '.lazybuddy/\n'); write(root, 'tracked.txt', 'current\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
  const head = git(root, 'rev-parse', 'HEAD');
  const plan = '# Plan\n\n## TODOs\n- [x] [criterion-1] observable outcome\n';
  const artifact = 'observable proof\n';
  const review = { verdict: 'approved', verifier: { identity: 'verifier-1' } };
  write(root, '.lazybuddy/runs/run-1/plan.md', plan); write(root, '.lazybuddy/runs/run-1/evidence/artifact.txt', artifact); write(root, '.lazybuddy/runs/run-1/review/review.json', review);
  const evidence = {
    schema_version: 'lazyseries.completion-evidence.v1', run_id: 'run-1', task_id: 'task-1', criterion_id: 'criterion-1', repo_head: head,
    package_version: VERSION, command: 'node --test completion', exit_code: 0, started_at: '2026-08-27T10:00:00Z', finished_at: '2026-08-27T10:00:01Z',
    artifact: { path: '.lazybuddy/runs/run-1/evidence/artifact.txt', sha256: sha(artifact) }, executor: { identity: 'executor-1' }, verifier: { identity: 'verifier-1' },
    review: { verdict: 'approved', source_sha256: sha(`${JSON.stringify(review, null, 2)}\n`) },
  };
  write(root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', evidence);
  const authority = {
    schema_version: 'lazyseries.completion-authority.v1', run_id: 'run-1', repo_head: head, package_version: VERSION,
    plan: { id: 'plan-1', path: '.lazybuddy/runs/run-1/plan.md', sha256: sha(plan) },
    criteria: [{ criterion_id: 'criterion-1', task_id: 'task-1', applicable: true, status: 'complete', evidence_path: '.lazybuddy/runs/run-1/evidence/criterion-1.json', review_path: '.lazybuddy/runs/run-1/review/review.json' }],
  };
  write(root, STATE, authority); return { root, authority, evidence };
}
function assess(root) { return assessCompletion(root, { authorityPath: STATE, packageVersion: VERSION, remediationCommand: 'show_run_status' }); }

test('five-state precedence is fail-closed', () => {
  const f = fixture();
  const table = [
    ['uninitialized', 'AUTHORITY_MALFORMED', () => write(f.root, STATE, '{')],
    ['stale', 'REPO_HEAD_STALE', () => write(f.root, STATE, { ...f.authority, repo_head: '0'.repeat(40), criteria: [] })],
    ['not-applicable', 'NO_APPLICABLE_CRITERIA', () => write(f.root, STATE, { ...f.authority, criteria: [] })],
    ['blocked', 'CRITERION_UNFINISHED', () => write(f.root, STATE, { ...f.authority, criteria: [{ ...f.authority.criteria[0], status: 'failed' }] })],
    ['ready', 'READY', () => write(f.root, STATE, f.authority)],
  ];
  for (const [state, code, arrange] of table) { arrange(); const output = assess(f.root); assert.deepEqual([output.status, output.reason_code], [state, code]); }
});

test('current evidence is ready and required mutations are non-ready', () => {
  const mutations = [
    ['blocked', 'REVIEW_NOT_INDEPENDENT', f => { const review = { verdict: 'approved', verifier: { identity: 'executor-1' } }; write(f.root, '.lazybuddy/runs/run-1/review/review.json', review); write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, verifier: { identity: 'executor-1' }, review: { verdict: 'approved', source_sha256: sha(`${JSON.stringify(review, null, 2)}\n`) } }); }],
    ['stale', 'REPO_HEAD_STALE', f => write(f.root, STATE, { ...f.authority, repo_head: '0'.repeat(40) })],
    ['stale', 'PACKAGE_VERSION_STALE', f => write(f.root, STATE, { ...f.authority, package_version: '9.9.9' })],
    ['stale', 'PLAN_DIGEST_STALE', f => write(f.root, '.lazybuddy/runs/run-1/plan.md', 'changed plan\n')],
    ['stale', 'EVIDENCE_REPO_HEAD_STALE', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, repo_head: '0'.repeat(40) })],
    ['stale', 'EVIDENCE_PACKAGE_VERSION_STALE', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, package_version: '9.9.9' })],
    ['blocked', 'EVIDENCE_IDENTITY_MISMATCH', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, run_id: 'other-run' })],
    ['blocked', 'EVIDENCE_IDENTITY_MISMATCH', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, task_id: 'other-task' })],
    ['blocked', 'EVIDENCE_IDENTITY_MISMATCH', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, criterion_id: 'other-criterion' })],
    ['blocked', 'CRITERION_UNCHECKED', f => { const plan = '# Plan\n\n## TODOs\n- [ ] [criterion-1] observable outcome\n'; write(f.root, '.lazybuddy/runs/run-1/plan.md', plan); write(f.root, STATE, { ...f.authority, plan: { ...f.authority.plan, sha256: sha(plan) } }); }],
    ['blocked', 'REVIEW_MISSING', f => fs.unlinkSync(path.join(f.root, '.lazybuddy/runs/run-1/review/review.json'))],
    ['blocked', 'EVIDENCE_MISSING', f => fs.unlinkSync(path.join(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json'))],
    ['blocked', 'REVIEW_TAMPERED', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, review: { ...f.evidence.review, source_sha256: '0'.repeat(64) } })],
    ['blocked', 'RESIDUAL_RISK_NON_AUTHORITATIVE', f => write(f.root, '.lazybuddy/runs/run-1/review/review.json', {
      kind: 'residual-risk', scope: 'criterion-1', revision: f.authority.repo_head, authoritative_for_completion: false,
    })],
    ['blocked', 'REVIEW_UNAPPROVED', f => write(f.root, '.lazybuddy/runs/run-1/review/review.json', { verdict: 'needs-fix', verifier: { identity: 'verifier-1' } })],
    ['blocked', 'ARTIFACT_TAMPERED', f => write(f.root, '.lazybuddy/runs/run-1/evidence/artifact.txt', 'tampered\n')],
    ['blocked', 'COMMAND_FAILED', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', { ...f.evidence, exit_code: 9 })],
    ['blocked', 'RESIDUAL_RISK_NON_AUTHORITATIVE', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', {
      kind: 'residual-risk', scope: 'criterion-1', revision: f.authority.repo_head, authoritative_for_completion: false,
    })],
    ['blocked', 'RESIDUAL_RISK_MALFORMED', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', {
      kind: 'residual-risk', scope: 'criterion-1', revision: f.authority.repo_head, authoritative_for_completion: true,
    })],
    ['blocked', 'RESIDUAL_RISK_MALFORMED', f => write(f.root, '.lazybuddy/runs/run-1/evidence/criterion-1.json', {
      kind: 'residual-risk', scope: 'criterion-1', revision: 'stale-revision', authoritative_for_completion: false,
    })],
    ['blocked', 'WORKTREE_DIRTY', f => write(f.root, 'untracked.txt', 'dirty\n')],
  ];
  const current = assess(fixture().root);
  assert.deepEqual([current.status, current.reason_code], ['ready', 'READY']);
  const observedReasons = [current.reason_code];
  for (const [state, code, mutate] of mutations) { const f = fixture(); mutate(f); const output = assess(f.root); assert.equal(output.status, state); assert.equal(output.reason_code, code); assert.match(output.remediation, /show_run_status/); const surface = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/completion-assessment.js'), '--root', f.root, '--authority', STATE, '--package-version', VERSION, '--remediation', 'show_run_status'], { encoding: 'utf8' }); assert.equal(surface.status, 1); assert.deepEqual([JSON.parse(surface.stdout).status, JSON.parse(surface.stdout).reason_code], [state, code]); observedReasons.push(output.reason_code); }
  assert.deepEqual(observedReasons, EXPECTED_MUTATION_REASONS);
});

test('absent authority and legacy path-only evidence never report ready', () => {
  const f = fixture(); fs.unlinkSync(path.join(f.root, STATE)); write(f.root, '.lazybuddy/runs/run-1/state.json', { status: 'complete', tasks: [{ status: 'done', evidence_paths: ['evidence/artifact.txt'] }] });
  assert.deepEqual([assess(f.root).status, assess(f.root).reason_code], ['uninitialized', 'AUTHORITY_ABSENT']);
});

test('nine failed criteria and unchecked plan cannot reproduce false-ready', () => {
  const f = fixture(); const plan = `# Plan\n\n## TODOs\n${Array.from({ length: 9 }, (_, i) => `- [ ] [criterion-${i + 1}] failure`).join('\n')}\n`;
  const criteria = Array.from({ length: 9 }, (_, i) => ({ ...f.authority.criteria[0], criterion_id: `criterion-${i + 1}`, task_id: `task-${i + 1}`, status: 'failed' }));
  write(f.root, '.lazybuddy/runs/run-1/plan.md', plan); write(f.root, STATE, { ...f.authority, plan: { ...f.authority.plan, sha256: sha(plan) }, criteria });
  assert.deepEqual([assess(f.root).status, assess(f.root).reason_code], ['blocked', 'CRITERION_UNFINISHED']);
  const surface = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/completion-assessment.js'), '--root', f.root, '--authority', STATE, '--package-version', VERSION, '--remediation', 'show_run_status'], { encoding: 'utf8' });
  assert.deepEqual([surface.status, JSON.parse(surface.stdout).reason_code], [1, 'CRITERION_UNFINISHED']);
});

test('CLI validator and MCP status expose the same ready assessment', () => {
  const f = fixture();
  write(f.root, '.lazybuddy/runs/run-1/state.json', { run_id: 'run-1', status: 'complete', objective: 'fixture', tasks: [], verification_gates: [], review_status: 'accepted' });
  const script = path.resolve(__dirname, '../scripts/completion-assessment.js');
  const cli = spawnSync(process.execPath, [script, '--root', f.root, '--authority', STATE, '--package-version', VERSION, '--remediation', 'show_run_status'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.deepEqual([JSON.parse(cli.stdout).status, JSON.parse(cli.stdout).reason_code], ['ready', 'READY']);

  const server = path.resolve(__dirname, '../mcp/status-dashboard/server.sh');
  const pluginRoot = path.resolve(__dirname, '..');
  const request = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_run_status', arguments: { run_id: 'run-1' } } })}\n`;
  const mcp = spawnSync('bash', [server], { input: request, encoding: 'utf8', env: { ...process.env, CWD: f.root, CODEBUDDY_PROJECT_DIR: f.root, CODEBUDDY_PLUGIN_ROOT: pluginRoot } });
  assert.equal(mcp.status, 0, mcp.stderr || mcp.stdout);
  const assessment = JSON.parse(mcp.stdout).result.completion_assessment;
  assert.deepEqual([assessment.status, assessment.reason_code], ['ready', 'READY']);
});
