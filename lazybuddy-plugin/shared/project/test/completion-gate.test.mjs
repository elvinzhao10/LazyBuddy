import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// F-03 regression: the full external-verification cheat sequence through the
// REAL bridge and CLI. A fabricated two-field run file cannot link; a real
// created run cannot reach lifecycle `completed` without the native completion
// authority the dashboard itself trusts (current repo head, applicable finished
// criteria, worker != verifier, approved review).
const PLUGIN = fileURLToPath(new URL('../../..', import.meta.url));
const CLI = join(PLUGIN, 'shared/project/cli.mjs');
const CREATE_RUN = join(PLUGIN, 'scripts/state/create-run.sh');
const PROJECT_ID = 'project:completion-gate';
const ACTOR = 'mcp:status-dashboard';
const REQUIREMENTS = '# Requirements\n\n## Offline operation\n\nAll primary workflows work without a network.\n';
const PLAN = '# Search plan\n\n## Tasks\n\n- [ ] [C1] Keep results local\n';

const hash = value => createHash('sha256').update(value).digest('hex');
const put = (root, relative, content) => {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

function gitFixture(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `lazybuddy-completion-gate-${name}-`)));
  put(root, 'docs/requirements.md', REQUIREMENTS);
  put(root, 'plans/search.md', PLAN);
  put(root, '.gitignore', '.lazybuddy/\n.lazyseries/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'gate@test']);
  git(root, ['config', 'user.name', 'gate']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
  return root;
}

function invoke(root, action, input) {
  const result = spawnSync(process.execPath, [CLI, action, '--project-root', root, '--project-id', PROJECT_ID,
    '--actor', ACTOR], { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input),
    timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return { ...result, code: result.status, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}

function command(root, id, operation, payload) {
  const revision = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8')).revision;
  return { schema_version: 1, command_id: id, project_id: PROJECT_ID, expected_revision: revision, operation, payload };
}

const change = (operation, payload) => ({ change: { operation, payload } });

function seedProject(root) {
  assert.equal(invoke(root, 'init').code, 0);
  const steps = [
    ['register_source', { id: 'src:req', path: 'docs/requirements.md', role: 'requirements' }],
    ['register_source', { id: 'src:plan', path: 'plans/search.md', role: 'plan' }],
    ['record_baseline_items', { items: [{ id: 'req:offline', kind: 'requirement', state: 'accepted',
      source: { source_id: 'src:req', sha256: hash(REQUIREMENTS), anchor_id: 'heading:Offline operation' } }] }],
    ['plan.create', { id: 'plan:search', declared_lifecycle: 'planned',
      source: { source_id: 'src:plan', sha256: hash(PLAN), anchor_id: 'document' },
      baseline_refs: [{ item_id: 'req:offline', item_revision: 1 }] }],
  ];
  for (const [index, [operation, payload]] of steps.entries()) {
    const result = invoke(root, 'command', command(root, `seed:${index}`,
      operation === 'plan.create' ? operation : 'project.change.apply',
      operation === 'plan.create' ? payload : change(operation, payload)));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.receipt.status, 'saved', result.stdout);
  }
}

function createdRun(root, runId) {
  // The real producer route: create-run.sh initializes the run directory, the
  // schema-2 state and the journaled event log; the dashboard binding adds the
  // project identity exactly as the native runtime records it.
  const created = spawnSync('bash', [CREATE_RUN, runId, 'Gate fixture objective'], {
    encoding: 'utf8', cwd: root, env: { ...process.env, CWD: root }, timeout: 30000,
  });
  assert.equal(created.status, 0, created.stderr);
  const statePath = join(root, `.lazybuddy/runs/${runId}/state.json`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.dashboard_project_id = 'native:gate';
  writeFileSync(statePath, JSON.stringify(state));
  return state;
}

// The completion chain the dashboard trusts, bound to the fixture's HEAD.
function completionRecords(root, runId, { worker = 'executor:1', verifier = 'reviewer:1', verdict = 'approved' } = {}) {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const run = `.lazybuddy/runs/${runId}`;
  const review = { verdict, verifier: { identity: verifier } };
  const evidence = { schema_version: 'lazyseries.completion-evidence.v1', run_id: runId, task_id: 'T',
    criterion_id: 'C1', repo_head: head, package_version: '1.4.0', command: 'fixture-gate', exit_code: 0,
    started_at: '2026-10-06T10:00:00Z', finished_at: '2026-10-06T10:00:01Z',
    artifact: { path: `${run}/actual.txt`, sha256: hash('observable\n') },
    executor: { identity: worker }, verifier: { identity: verifier },
    review: { verdict, source_sha256: hash(JSON.stringify(review)) } };
  const authority = { schema_version: 'lazyseries.completion-authority.v1', run_id: runId, repo_head: head,
    package_version: '1.4.0', plan: { id: 'plan-1', path: `${run}/plan.md`, sha256: hash(PLAN) },
    criteria: [{ task_id: 'T', criterion_id: 'C1', applicable: true, status: 'complete',
      evidence_path: `${run}/receipts/evidence.json`, review_path: `${run}/review/review.json` }] };
  put(root, `${run}/actual.txt`, 'observable\n');
  put(root, `${run}/receipts/evidence.json`, JSON.stringify(evidence));
  put(root, `${run}/review/review.json`, JSON.stringify(review));
  put(root, `${run}/completion-authority.json`, JSON.stringify(authority));
  return { head, authority };
}

test('a fabricated run file cannot link and completion needs the trusted authority (F-03)', async t => {
  const root = gitFixture('cheat');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seedProject(root);

  // The cheat sequence's first step: a two-field hand-written run file.
  put(root, '.lazybuddy/runs/fake-run/state.json',
    JSON.stringify({ run_id: 'fake-run', dashboard_project_id: 'anything' }));
  const fakeLink = invoke(root, 'command', command(root, 'cheat:link', 'project.change.apply',
    change('link_native_run', { plan_id: 'plan:search', native_project_id: 'anything', run_id: 'fake-run' })));
  assert.notEqual(fakeLink.code, 0);
  assert.match(fakeLink.stderr, /^NATIVE_RUN_MALFORMED\n$/);
  const revisionAfterRefusal = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8')).revision;
  assert.equal(revisionAfterRefusal, 4, 'the refused link saves nothing');

  // A real created run links and activates; activation was never the gap.
  createdRun(root, 'gate-run');
  for (const [id, operation, payload] of [
    ['gate:link', 'project.change.apply', change('link_native_run',
      { plan_id: 'plan:search', native_project_id: 'native:gate', run_id: 'gate-run' })],
    ['gate:active', 'plan.transition', { plan_id: 'plan:search', to_lifecycle: 'active' }],
  ]) {
    const result = invoke(root, 'command', command(root, id, operation, payload));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.receipt.status, 'saved', result.stdout);
  }

  // Without any authority record the completion transition refuses typed.
  const unbacked = invoke(root, 'command', command(root, 'gate:done-unbacked', 'plan.transition',
    { plan_id: 'plan:search', to_lifecycle: 'completed' }));
  assert.notEqual(unbacked.code, 0);
  assert.match(unbacked.stderr, /^COMPLETION_AUTHORITY_REQUIRED\n$/);

  // An authority whose verifier is its own worker is not trusted: same typed
  // refusal, exactly like the dashboard's REVIEW_NOT_INDEPENDENT.
  completionRecords(root, 'gate-run', { worker: 'executor:1', verifier: 'executor:1' });
  const notIndependent = invoke(root, 'command', command(root, 'gate:done-self-verified', 'plan.transition',
    { plan_id: 'plan:search', to_lifecycle: 'completed' }));
  assert.notEqual(notIndependent.code, 0);
  assert.match(notIndependent.stderr, /^COMPLETION_AUTHORITY_REQUIRED\n$/);

  // A stale authority (repository moved past its recorded head) is not current.
  completionRecords(root, 'gate-run');
  put(root, 'docs/requirements.md', `${REQUIREMENTS}\nA later external change moves the head.\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'move head']);
  const stale = invoke(root, 'command', command(root, 'gate:done-stale', 'plan.transition',
    { plan_id: 'plan:search', to_lifecycle: 'completed' }));
  assert.notEqual(stale.code, 0);
  assert.match(stale.stderr, /^COMPLETION_AUTHORITY_REQUIRED\n$/);

  // An unapproved review never completes a criterion.
  git(root, ['reset', '-q', '--hard', 'HEAD~1']);
  completionRecords(root, 'gate-run', { verdict: 'changes-requested' });
  const unapproved = invoke(root, 'command', command(root, 'gate:done-unapproved', 'plan.transition',
    { plan_id: 'plan:search', to_lifecycle: 'completed' }));
  assert.notEqual(unapproved.code, 0);
  assert.match(unapproved.stderr, /^COMPLETION_AUTHORITY_REQUIRED\n$/);

  // The real chain: applicable finished criterion, distinct worker and
  // verifier, approved review, current head — the transition saves.
  completionRecords(root, 'gate-run');
  const done = invoke(root, 'command', command(root, 'gate:done', 'plan.transition',
    { plan_id: 'plan:search', to_lifecycle: 'completed' }));
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.json.receipt.status, 'saved', done.stdout);
  const plan = done.json.snapshot.plans.find(entry => entry.id === 'plan:search');
  assert.equal(plan.declared_lifecycle, 'completed');
  assert.deepEqual(plan.native_observations, []);
  t.diagnostic(JSON.stringify({ fake_link_refused: 'NATIVE_RUN_MALFORMED', unbacked_refused: 'COMPLETION_AUTHORITY_REQUIRED',
    self_verified_refused: true, stale_head_refused: true, unapproved_review_refused: true,
    trusted_transition: 'saved' }));
});
