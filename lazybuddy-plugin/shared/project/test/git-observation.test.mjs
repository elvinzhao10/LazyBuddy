import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectState } from '../contract.mjs';
import { recordObservations } from '../model.mjs';
import { collectLocalGitFacts, parseStatusPorcelainZ, statusSampleChanged } from '../git-observation/local.mjs';
import { collectRemoteFacts, mapPullRequest, parseRemoteUrl } from '../git-observation/remote.mjs';
import {
  dirtyContentBindings, localObservationRecords, remoteObservationRecords, sameBinding,
  worktreeProjectionObservations,
} from '../git-observation/records.mjs';

// T11 interface under test: one deterministic, coverage-explicit collector
// interface for local Git/worktree facts and best-effort gh PR observation,
// recorded through the existing T02 observation route without schema edits.
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:git-observation';
const ACTOR = 'local:t11-test';
const SCOPE = ['docs/', 'src/'];

const git = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};

const fixture = { root: null, linked: null };

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(target, content);
}

function invokeCLI(root, action, input) {
  const args = [CLI, action, '--project-root', root, '--project-id', PROJECT_ID, '--actor', ACTOR];
  const result = spawnSync(process.execPath, args,
    { cwd: root, input: input === undefined ? '' : input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return { code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function reduceCLI(action, state, context) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, '--reduce'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, timeout: 30000 });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      if (code !== 0) reject(new Error(`--reduce ${action} failed: ${Buffer.concat(errors).toString('utf8')}`));
      else resolve(JSON.parse(Buffer.concat(output).toString('utf8')));
    });
    child.stdin.end(JSON.stringify({ action, state, context }));
  });
}

test.before(async () => {
  fixture.root = mkdtempSync(join(realpathSync(tmpdir()), 'git-observation-'));
  git(['init', '-q', '-b', 'main', fixture.root]);
  git(['config', 'user.email', 't11@test.local'], fixture.root);
  git(['config', 'user.name', 't11-test'], fixture.root);
  git(['config', 'commit.gpgsign', 'false'], fixture.root);
  put(fixture.root, 'README.md', '# Fixture\n');
  put(fixture.root, 'docs/requirements.md', '# Requirements\n\n## Offline\n\nWork without a network.\n');
  put(fixture.root, 'src/app.js', 'export const app = 1;\n');
  put(fixture.root, 'src/blob.bin', Buffer.from([0, 1, 2, 3]));
  put(fixture.root, '.gitignore', '.env\n');
  put(fixture.root, '.env', 'SECRET_TOKEN=not-recorded\n');
  git(['add', '-A'], fixture.root);
  git(['commit', '-qm', 'base'], fixture.root);

  // A real merge commit: parent OIDs must be recorded from git log.
  git(['checkout', '-q', '-b', 'merge-side'], fixture.root);
  put(fixture.root, 'merge-extra.txt', 'side\n');
  git(['add', 'merge-extra.txt'], fixture.root);
  git(['commit', '-qm', 'side work'], fixture.root);
  git(['checkout', '-q', 'main'], fixture.root);
  git(['merge', '-q', '--no-ff', 'merge-side', '-m', 'merge: side work'], fixture.root);

  // A real linked worktree on its own branch.
  fixture.linked = `${fixture.root}-linked`;
  git(['worktree', 'add', '-q', fixture.linked, '-b', 'feature-old'], fixture.root);

  // Dirty state in the main worktree: staged+unstaged on one file, a moved
  // (renamed) tracked file, an unstaged edit, untracked content, ignored
  // content, and a modified binary.
  put(fixture.root, 'src/app.js', 'export const app = 1;\n// staged edit\n');
  git(['add', 'src/app.js'], fixture.root);
  put(fixture.root, 'src/app.js', 'export const app = 1;\n// staged edit\n// unstaged edit\n');
  git(['mv', 'docs/requirements.md', 'docs/requirements-v2.md'], fixture.root);
  put(fixture.root, 'README.md', '# Fixture\n# unstaged main edit\n');
  put(fixture.root, 'notes/new.md', 'untracked note\n');
  put(fixture.root, 'src/blob.bin', Buffer.from([0, 9, 9]));
  put(fixture.root, '.env', 'SECRET_TOKEN=still-never-collected\n');

  // Dirty state in the linked worktree, including the same README.md path as
  // the main worktree (advisory concurrent-edit overlap, not a Git conflict).
  put(fixture.linked, 'README.md', '# Fixture\n# unstaged linked edit\n');
  put(fixture.linked, 'src/app.js', 'export const app = 1;\n// linked staged edit\n');
  git(['add', 'src/app.js'], fixture.linked);
  put(fixture.linked, 'linked-note.txt', 'linked untracked\n');
});

test.after(() => {
  const receipt = [];
  if (fixture.root && existsSync(fixture.linked)) {
    try { git(['worktree', 'remove', '--force', fixture.linked], fixture.root); receipt.push('worktree-removed'); }
    catch { rmSync(fixture.linked, { recursive: true, force: true }); receipt.push('worktree-rm-sync'); }
  }
  if (fixture.root && existsSync(fixture.root)) {
    rmSync(fixture.root, { recursive: true, force: true });
    receipt.push('root-removed');
  }
  assert.equal(existsSync(fixture.root), false);
  process.stdout.write(`cleanup receipt: ${receipt.join(',')}\n`);
});

test('collects mandated local facts across two linked worktrees with union path counting', async () => {
  const result = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  assert.equal(result.status, 'observed');
  assert.equal(result.collector, 'git-observation/local@1');
  assert.ok(result.commands.some(command => command.argv.join(' ') ===
    '--no-optional-locks status --porcelain=v2 -z --branch'), 'the mandated status argv must be the fact source');
  assert.ok(result.commands.some(command => command.argv.join(' ') ===
    '--no-optional-locks worktree list --porcelain -z'), 'the mandated worktree argv must be the fact source');

  assert.equal(result.worktrees.length, 2);
  const main = result.worktrees.find(worktree => worktree.current);
  const linked = result.worktrees.find(worktree => !worktree.current);
  assert.equal(main.kind, 'main');
  assert.equal(linked.kind, 'linked');

  // Branch label and commit identity stay distinct fields.
  const headOid = git(['rev-parse', 'HEAD'], fixture.root).trim();
  assert.equal(main.head, headOid);
  assert.equal(main.branch, 'main');
  assert.match(main.head, /^[0-9a-f]{40}$/);

  // Classification: the staged+unstaged file appears in both classes but the
  // union counts it once; the moved file carries rename provenance.
  assert.deepEqual(main.changed.staged.paths.map(entry => entry.path).sort(),
    ['docs/requirements-v2.md', 'src/app.js']);
  const rename = main.changed.staged.paths.find(entry => entry.path === 'docs/requirements-v2.md');
  assert.equal(rename.rename_from, 'docs/requirements.md');
  assert.deepEqual(main.changed.unstaged.paths.map(entry => entry.path).sort(),
    ['README.md', 'src/app.js', 'src/blob.bin']);
  assert.deepEqual(main.changed.untracked.paths, ['notes/']);
  assert.deepEqual(main.changed.unmerged.paths, []);
  assert.equal(main.changed.union_total, 5, 'src/app.js must count once in the union');

  assert.ok(linked.changed.staged.paths.some(entry => entry.path === 'src/app.js'));
  assert.ok(linked.changed.unstaged.paths.some(entry => entry.path === 'README.md'));
  assert.deepEqual(linked.changed.untracked.paths, ['linked-note.txt']);

  // Ignored content is never recorded, even though .env exists.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('.env'), false, 'ignored/unregistered content must not reach the facts');
  assert.equal(result.limits.ignored_paths_excluded, true);

  // Binary diffs are honestly unavailable, with the binary paths labeled.
  assert.ok(main.binary_paths.includes('src/blob.bin'));
  assert.equal(result.binary_diff_counts.status, 'unavailable');
  assert.equal(result.binary_diff_counts.reason, 'BINARY_LINE_COUNTS_UNAVAILABLE');

  // Commit parents: the merge commit at HEAD records both parent OIDs.
  const merge = result.commits.observed[0];
  assert.equal(merge.oid, headOid);
  assert.equal(merge.parent_oids.length, 2);
  assert.deepEqual(merge.parent_oids,
    git(['rev-parse', 'HEAD^1', 'HEAD^2'], fixture.root).split('\n').map(value => value.trim()).filter(Boolean));
  const total = Number(git(['rev-list', '--count', 'HEAD'], fixture.root).trim());
  assert.deepEqual(result.commits.coverage, { reported: result.commits.observed.length, total });

  assert.equal(result.capture.stable, true);
  fixture.local = result;
});

test('dirty-content binding covers only the declared scope and stales on relevant same-HEAD edits', async () => {
  const first = fixture.local;
  const main = first.worktrees.find(worktree => worktree.current);
  const relevant = main.binding.relevant_changed_paths.map(entry => entry.path).sort();
  assert.deepEqual(relevant, ['docs/requirements-v2.md', 'src/app.js', 'src/blob.bin']);
  assert.equal(main.binding.head_oid, main.head);
  assert.deepEqual(main.binding.source_scope, SCOPE);
  assert.equal(main.binding.unrelated_changed_path_count, 2);

  // Determinism: a second collection at the same state produces the same digest.
  const second = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const mainSecond = second.worktrees.find(worktree => worktree.current);
  assert.ok(sameBinding(main.binding, mainSecond.binding), 'identical facts must produce an identical binding');

  // A relevant same-HEAD edit (src/app.js already dirty) must stale the binding.
  put(fixture.root, 'src/app.js', 'export const app = 1;\n// staged edit\n// unstaged edit\n// further relevant edit\n');
  const third = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const mainThird = third.worktrees.find(worktree => worktree.current);
  assert.equal(mainThird.head, main.head, 'HEAD is unchanged');
  assert.equal(mainThird.binding.head_oid, main.binding.head_oid, 'HEAD unchanged');
  assert.equal(sameBinding(main.binding, mainThird.binding), false,
    'a relevant same-HEAD edit must change the binding digest');

  // An irrelevant edit does not stale in-scope proof.
  put(fixture.root, 'README.md', '# Fixture\n# unstaged main edit\n# more irrelevant\n');
  const fourth = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const mainFourth = fourth.worktrees.find(worktree => worktree.current);
  assert.ok(sameBinding(mainThird.binding, mainFourth.binding),
    'an out-of-scope edit must not change the relevant binding');

  // A new untracked in-scope path is relevant presence even though untracked
  // content is never hashed.
  put(fixture.root, 'docs/new-untracked.md', 'new in-scope content\n');
  const fifth = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const mainFifth = fifth.worktrees.find(worktree => worktree.current);
  assert.ok(mainFifth.binding.relevant_changed_paths.some(entry => entry.path === 'docs/new-untracked.md'));
  assert.equal(sameBinding(mainFourth.binding, mainFifth.binding), false);
  assert.equal(JSON.stringify(mainFifth.binding).includes('new in-scope content'), false,
    'untracked content bytes are never recorded');
  fixture.latestMainBinding = mainFifth.binding;
});

test('a branch rename changes the label but invents no content changes', async () => {
  const before = await collectLocalGitFacts({ repositoryRoot: fixture.linked, sourceScope: SCOPE });
  const linkedBefore = before.worktrees.find(worktree => worktree.current);
  assert.equal(linkedBefore.branch, 'feature-old');
  assert.equal(linkedBefore.kind, 'linked');

  git(['branch', '-m', 'feature-new'], fixture.linked);
  const after = await collectLocalGitFacts({ repositoryRoot: fixture.linked, sourceScope: SCOPE });
  const linkedAfter = after.worktrees.find(worktree => worktree.current);

  assert.equal(linkedAfter.branch, 'feature-new', 'the moving label is observed');
  assert.equal(linkedAfter.head, linkedBefore.head, 'commit identity is unchanged');
  assert.deepEqual(linkedAfter.changed.staged.paths, linkedBefore.changed.staged.paths);
  assert.deepEqual(linkedAfter.changed.unstaged.paths, linkedBefore.changed.unstaged.paths);
  assert.deepEqual(linkedAfter.changed.untracked.paths, linkedBefore.changed.untracked.paths);
  assert.equal(linkedAfter.changed.union_total, linkedBefore.changed.union_total);
  assert.ok(sameBinding(linkedBefore.binding, linkedAfter.binding),
    'a branch rename with no content change must not stale proof');
});

test('an actual unmerged index stays distinct from predicted, overlap, and semantic classes', async () => {
  // A real merge conflict in the linked worktree.
  git(['checkout', '-q', '-b', 'tmp-conflict'], fixture.linked);
  put(fixture.linked, 'conflict.txt', 'feature side\n');
  git(['add', 'conflict.txt'], fixture.linked);
  git(['commit', '-qm', 'feature side'], fixture.linked);
  git(['checkout', '-q', 'feature-new'], fixture.linked);
  put(fixture.linked, 'conflict.txt', 'main side\n');
  git(['add', 'conflict.txt'], fixture.linked);
  git(['commit', '-qm', 'main side'], fixture.linked);
  const mergeResult = spawnSync('git', ['merge', 'tmp-conflict'], { cwd: fixture.linked, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(mergeResult.status, 0, 'the fixture merge must actually conflict');

  const result = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: SCOPE });
  const linked = result.worktrees.find(worktree => worktree.current === false && worktree.status === 'observed');
  assert.deepEqual(linked.changed.unmerged.paths, [{ path: 'conflict.txt', xy: 'AA' }]);

  const conflicts = result.conflicts;
  assert.equal(conflicts.actual_unmerged_index.status, 'observed');
  assert.deepEqual(conflicts.actual_unmerged_index.paths,
    [{ path: 'conflict.txt', xy: 'AA', worktree_root: realpathSync(fixture.linked) }]);

  assert.equal(conflicts.predicted_merge_conflict.status, 'unavailable');
  assert.equal(conflicts.predicted_merge_conflict.reason, 'MERGE_SIMULATION_EXCLUDED');

  assert.equal(conflicts.concurrent_edit_overlap.advisory, true);
  assert.equal(conflicts.concurrent_edit_overlap.classification, 'inferred');
  const overlapPaths = conflicts.concurrent_edit_overlap.overlaps.map(overlap => overlap.path);
  assert.ok(overlapPaths.includes('README.md'), 'the shared dirty path is advisory overlap');
  assert.ok(overlapPaths.includes('src/app.js'), 'the shared dirty source path is advisory overlap');
  assert.equal(overlapPaths.includes('conflict.txt'), false,
    'path overlap alone can never become an actual Git conflict');

  assert.equal(conflicts.semantic_plan_conflict.status, 'unavailable');
  assert.equal(conflicts.semantic_plan_conflict.owned_by, 'project reconciliation');
  fixture.conflicted = result;
});

test('unavailable stays typed: non-repository roots, missing git, and bounded timeouts', async () => {
  const empty = mkdtempSync(join(realpathSync(tmpdir()), 'git-observation-empty-'));
  try {
    const notARepo = await collectLocalGitFacts({ repositoryRoot: empty, sourceScope: SCOPE });
    assert.equal(notARepo.status, 'unavailable');
    assert.equal(notARepo.reason, 'NOT_A_REPOSITORY');
  } finally { rmSync(empty, { recursive: true, force: true }); }

  const missingBinary = await collectLocalGitFacts({ repositoryRoot: fixture.root, gitBinary: '/nonexistent/git' });
  assert.equal(missingBinary.status, 'unavailable');
  assert.equal(missingBinary.reason, 'GIT_UNAVAILABLE');

  // Bounded execution against a real subprocess that never answers.
  const sleepy = join(realpathSync(tmpdir()), `git-observation-sleep-${process.pid}.sh`);
  writeFileSync(sleepy, '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
  try {
    const timed = await collectLocalGitFacts({ repositoryRoot: fixture.root, gitBinary: sleepy, timeoutMs: 750 });
    assert.equal(timed.status, 'unavailable');
    assert.equal(timed.reason, 'COMMAND_TIMEOUT');
    assert.equal(timed.commands.length > 0, true);
  } finally { rmSync(sleepy, { force: true }); }
});

test('status sample comparison detects capture instability', () => {
  const first = git(['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch'], fixture.root);
  assert.equal(statusSampleChanged(first, first), false);
  assert.equal(statusSampleChanged(first, `${first}\0# extra\0`), true);
  const parsed = parseStatusPorcelainZ(Buffer.from(first, 'utf8'));
  assert.equal(parsed.header.branch_label, 'main');
});

test('remote gh observation is best-effort and typed-unavailable without a usable remote', async () => {
  // No remote configured: typed unavailable, never zero PRs.
  const noRemote = await collectRemoteFacts({ repositoryRoot: fixture.root });
  assert.equal(noRemote.status, 'unavailable');
  assert.equal(noRemote.reason, 'NO_REMOTE');

  // A configured GitHub remote the caller cannot observe (repository does not
  // exist for this identity): still typed unavailable with an honest reason.
  git(['remote', 'add', 'origin', 'https://github.com/octocat/git-observation-no-such-repo.git'], fixture.root);
  const unreachable = await collectRemoteFacts({ repositoryRoot: fixture.root, timeoutMs: 20000 });
  assert.equal(unreachable.status, 'unavailable');
  assert.ok(['GH_COMMAND_FAILED', 'GH_UNAUTHENTICATED', 'GH_RATE_LIMITED', 'GH_NETWORK_UNAVAILABLE',
    'GH_UNAVAILABLE', 'COMMAND_TIMEOUT'].includes(unreachable.reason),
  `expected a typed reason, got ${unreachable.reason}`);

  // Pure URL and PR mapping checks: the PR head never absorbs a merge SHA.
  assert.deepEqual(parseRemoteUrl('https://github.com/elvinzhao10/LazyBuddy.git'),
    { host: 'github.com', owner: 'elvinzhao10', repo: 'LazyBuddy' });
  assert.deepEqual(parseRemoteUrl('git@github.com:elvinzhao10/LazyBuddy.git'),
    { host: 'github.com', owner: 'elvinzhao10', repo: 'LazyBuddy' });
  const mapped = mapPullRequest({ number: 7, title: 't', state: 'OPEN', isDraft: false, url: 'u',
    headRefName: 'feat', headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'b'.repeat(40) });
  assert.equal(mapped.head.oid, 'a'.repeat(40));
  assert.equal(mapped.base.oid, 'b'.repeat(40));
  assert.notEqual(mapped.head.oid, mapped.base.oid);
  assert.equal(mapped.tested_subject.status, 'unavailable');
  assert.equal(mapped.test_merge.reason, 'TEST_MERGE_SHA_NOT_OBSERVED');
  assert.equal(mapped.checks.status, 'unavailable');
  fixture.remote = unreachable;
});

test('observations record through the real command path into the existing T02 model', async () => {
  // Real store creation through the real CLI and native bridge.
  const init = invokeCLI(fixture.root, 'init');
  assert.equal(init.code, 0, init.stderr);
  assert.ok(existsSync(join(fixture.root, '.lazyseries/project.json')), 'explicit init creates the neutral registry');
  assert.ok(existsSync(join(fixture.root, '.lazybuddy/project/state.json')), 'the native store exists');

  // A real accepted command through the same route registers a source.
  const register = invokeCLI(fixture.root, 'command', JSON.stringify({
    schema_version: 1, command_id: 't11:register-spec', project_id: PROJECT_ID, expected_revision: 0,
    operation: 'register_source',
    payload: { id: 'source:spec', path: 'docs/requirements-v2.md', role: 'requirements' },
  }));
  assert.equal(register.code, 0, register.stderr);
  const registered = JSON.parse(register.stdout);
  assert.equal(registered.receipt.status, 'saved');

  // The real persisted state feeds the existing observation-recording route.
  const realState = JSON.parse(readFileSync(join(fixture.root, '.lazybuddy/project/state.json'), 'utf8'));
  const localRecords = localObservationRecords(fixture.conflicted ?? fixture.local,
    { idPrefix: 'observation:git' });
  const remoteRecords = remoteObservationRecords(fixture.remote, { idPrefix: 'observation:git-remote' });
  const allRecords = [...localRecords, ...remoteRecords];
  const { state: observed, recorded } = recordObservations(realState, allRecords);
  assert.deepEqual(recorded, allRecords.map(record => record.id));
  assert.equal(observed.observation_revision, allRecords.length);
  assert.equal(observed.observations.length, allRecords.length);
  assertProjectState(observed);

  const gitRecord = observed.observations.find(record => record.subject.kind === 'git' && record.id.startsWith('observation:git:'));
  assert.equal(gitRecord.provenance.kind, 'collector');
  assert.equal(gitRecord.observed_by, 'git-observation/local@1');
  assert.ok(gitRecord.content_revision.match(/^[0-9a-f]{40}$/));
  const payload = JSON.parse(gitRecord.text);
  assert.equal(payload.conflicts.actual_unmerged_index.paths.length, 1);

  const remoteRecord = observed.observations.find(record => record.id === 'observation:git-remote:gh');
  assert.equal(JSON.parse(remoteRecord.text).status, 'unavailable', 'unavailability is observed, never zero');
  assert.equal(remoteRecord.content_revision, null);

  // Bindings are exposed for downstream stale checks (T13/UI consume later).
  const bindings = dirtyContentBindings(fixture.conflicted ?? fixture.local);
  assert.equal(bindings.length, 2);
  assert.ok(bindings.every(binding => binding.digest.match(/^[a-f0-9]{64}$/)));

  // The observation-augmented state flows through the real CLI reducer entry
  // point and surfaces worktrees through the existing projection options.
  const worktreeObservations = worktreeProjectionObservations(fixture.conflicted ?? fixture.local);
  assert.equal(worktreeObservations.filter(entry => entry.current).length, 1);
  const snapshot = await reduceCLI('snapshot', observed, { worktreeObservations });
  assert.equal(snapshot.worktrees.status, 'observed');
  assert.equal(snapshot.worktrees.entries.length, 2);
  assert.equal(snapshot.observation_revision, allRecords.length);
  assert.equal(snapshot.observations.length, allRecords.length);
});
