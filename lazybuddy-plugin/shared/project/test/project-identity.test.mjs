import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectRegistry } from '../contract.mjs';

// T04 interface under test: the runtime-neutral `.lazyseries/project.json` repository
// identity, worktree-aware resolution over real `git worktree list --porcelain -z`
// facts, and the additive migration of a legacy canonical-path store.
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:identity';
const ACTOR = 'local:identity-test';
const REQUIREMENTS = '# Requirements\n\n## feature:test — A feature\n\nOriginal source content.\n';
const PLAN = '# Legacy plan\n\n- [x] Historical work\n';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => {
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted) + '\n';
};

function put(root, path, content, mode = 0o600) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content, { mode });
  return target;
}

function storeInventory(root) {
  const files = {};
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[path] = hash(readFileSync(path));
    }
  };
  const store = join(root, '.lazybuddy/project');
  if (existsSync(store)) visit(store);
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
    child.stdin.end(input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input));
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

function reducer(payload) {
  const result = spawnSync(process.execPath, [CLI, '--reduce'], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr ?? result.stdout);
  return result.stdout;
}

function fixture(t, name) {
  const root = join(realpathSync(tmpdir()), `lazybuddy-project-identity-${process.pid}-${name}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function command(snapshot, operation, payload, overrides = {}) {
  return { schema_version: 1, command_id: `identity:${snapshot.revision + 1}`, project_id: PROJECT_ID,
    expected_revision: snapshot.revision, operation, payload, ...overrides };
}

async function registerSource(root, snapshot, id, path, role) {
  const result = parseSuccess(await invoke(root, 'command', command(snapshot, 'register_source', { id, path, role })));
  assert.equal(result.receipt.status, 'saved');
  return result.snapshot;
}

// IO-1 extended to the neutral registry: no `.lazyseries/` and no `.lazybuddy/` may
// appear as a side effect of a read or a rejected command.
test('pre-init reads create no neutral registry and no native store', async t => {
  const root = fixture(t, 'io1');
  put(root, 'docs/requirements.md', REQUIREMENTS);
  const before = storeInventory(root);

  const read = await invoke(root, 'read');
  assertFailure(read, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(existsSync(join(root, '.lazyseries')), false, 'A read must not create the neutral registry');
  assert.equal(existsSync(join(root, '.lazybuddy')), false, 'A read must not create the native store');

  const rejected = await invoke(root, 'command', {
    schema_version: 1, command_id: 'identity:pre-init', project_id: PROJECT_ID, expected_revision: 0,
    operation: 'register_source', payload: { id: 'source:req', path: 'docs/requirements.md', role: 'requirements' },
  });
  assertFailure(rejected, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(existsSync(join(root, '.lazyseries')), false);
  assert.deepEqual(storeInventory(root), before);
  t.diagnostic(JSON.stringify({ refusal: 'PROJECT_NOT_INITIALIZED', lazyseries_created: false, lazybuddy_created: false }));
});

test('init creates the neutral registry with a generated stable key that survives a moved root', async t => {
  const root = fixture(t, 'moved');
  put(root, 'docs/requirements.md', REQUIREMENTS);
  let snapshot = parseSuccess(await invoke(root, 'init'));
  snapshot = await registerSource(root, snapshot, 'source:req', 'docs/requirements.md', 'requirements');

  const registryPath = join(root, '.lazyseries/project.json');
  assert.ok(existsSync(registryPath), 'Explicit init must create the neutral registry');
  const registry = assertProjectRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
  assert.equal(registry.project_id, PROJECT_ID);
  assert.match(registry.repository_key, /^repo:[a-f0-9]{64}$/);
  assert.notEqual(registry.repository_key, `repo:${hash(root)}`, 'The key must be generated, not path-derived');
  assert.deepEqual(registry.sources, [{ id: 'source:req', role: 'requirements', path: 'docs/requirements.md' }],
    'Registered sources mirror into the registry pointer list');

  assert.equal(snapshot.repository_key, registry.repository_key);
  assert.equal(snapshot.identity.basis, 'registry');
  assert.equal(snapshot.identity.legacy_repository_key, null);
  const receiptsBefore = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8')).receipts;

  const moved = `${root}-relocated`;
  t.after(() => rmSync(moved, { recursive: true, force: true }));
  renameSync(root, moved);
  const afterMove = parseSuccess(await invoke(moved, 'read'));
  assert.equal(afterMove.repository_key, registry.repository_key, 'A moved root resolves to the same project identity');
  assert.equal(afterMove.identity.basis, 'registry');
  assert.equal(afterMove.revision, snapshot.revision);
  assert.equal(afterMove.receipts instanceof Array, false, 'Snapshots do not expose retained receipts');
  const persisted = JSON.parse(readFileSync(join(moved, '.lazybuddy/project/state.json'), 'utf8'));
  assert.deepEqual(persisted.receipts, receiptsBefore, 'Retained command history is untouched by the move');
  assert.equal(afterMove.sources[0].observation.status, 'current');
  t.diagnostic(JSON.stringify({ registry_key: registry.repository_key, moved_root_identity_stable: true,
    revision: afterMove.revision, registry_sources: registry.sources.length }));
});

test('a real linked worktree shares the registry identity and keeps separate working revisions', async t => {
  const root = fixture(t, 'git-main');
  put(root, 'docs/requirements.md', REQUIREMENTS);
  git(['init', '-q', '-b', 'main', root], root);
  git(['config', 'user.email', 'identity@test.local'], root);
  git(['config', 'user.name', 'identity-test'], root);
  git(['add', '-A'], root);
  git(['commit', '-qm', 'fixture baseline'], root);
  const mainSnapshot = parseSuccess(await invoke(root, 'init'));

  const worktree = `${root}-linked`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  git(['worktree', 'add', '-q', '-b', 'feature-wt', worktree], root);

  const uninitialized = await invoke(worktree, 'read');
  assertFailure(uninitialized, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.equal(existsSync(join(worktree, '.lazybuddy')), false, 'No worktree store before its own explicit init');
  assert.equal(existsSync(join(worktree, '.lazyseries')), false, 'The shared registry lives at the main root');

  const worktreeSnapshot = parseSuccess(await invoke(worktree, 'init'));
  assert.equal(worktreeSnapshot.repository_key, mainSnapshot.repository_key,
    'Linked worktrees share the project identity');
  assert.equal(worktreeSnapshot.identity.basis, 'registry');
  assert.ok(existsSync(join(worktree, '.lazybuddy/project/owner.json')), 'The worktree keeps its own native store');
  const worktreeOwner = JSON.parse(readFileSync(join(worktree, '.lazybuddy/project/owner.json'), 'utf8'));
  const mainOwner = JSON.parse(readFileSync(join(root, '.lazybuddy/project/owner.json'), 'utf8'));
  assert.equal(worktreeOwner.repository_key, mainOwner.repository_key,
    'Both stores bind the same shared registry identity');
  assert.ok(existsSync(join(worktree, '.lazybuddy/project/state.json')), 'The worktree store is independent of the main store');

  // Honest worktree facts: observed shape must equal the real porcelain output.
  const list = git(['worktree', 'list', '--porcelain', '-z'], worktree);
  const observedRoots = [...list.matchAll(/worktree (.+?)\0/g)].map(match => match[1]);
  assert.deepEqual(worktreeSnapshot.worktrees.entries.map(entry => entry.root), observedRoots);
  assert.deepEqual(worktreeSnapshot.worktrees.entries.map(entry => entry.kind), ['main', 'linked']);
  assert.deepEqual(worktreeSnapshot.worktrees.entries.map(entry => entry.current), [false, true]);
  assert.equal(worktreeSnapshot.worktrees.identity.shared, true);
  assert.equal(worktreeSnapshot.worktrees.identity.repository_key, mainSnapshot.repository_key);
  const current = worktreeSnapshot.worktrees.entries.find(entry => entry.current);
  assert.equal(current.head, git(['rev-parse', 'HEAD'], worktree).trim());
  assert.equal(current.branch, 'refs/heads/feature-wt');

  // Separate working document revisions: the same source id accepted at different
  // content in each worktree, each honestly current in its own store.
  writeFileSync(join(worktree, 'docs/requirements.md'), REQUIREMENTS.replace('Original', 'Worktree-local'));
  git(['add', '-A'], worktree);
  git(['commit', '-qm', 'worktree-local revision'], worktree);
  let mainAt = await registerSource(root, mainSnapshot, 'source:req', 'docs/requirements.md', 'requirements');
  let worktreeAt = await registerSource(worktree, worktreeSnapshot, 'source:req', 'docs/requirements.md', 'requirements');
  assert.notEqual(mainAt.sources[0].accepted_sha256, worktreeAt.sources[0].accepted_sha256,
    'Worktrees carry separate working document revisions');
  assert.equal(mainAt.sources[0].observation.status, 'current');
  assert.equal(worktreeAt.sources[0].observation.status, 'current');

  mainAt = parseSuccess(await invoke(root, 'read'));
  worktreeAt = parseSuccess(await invoke(worktree, 'read'));
  assert.equal(mainAt.sources[0].observation.status, 'current', 'The main worktree does not observe worktree edits');
  assert.equal(worktreeAt.sources[0].observation.status, 'current');
  const refreshed = worktreeAt.worktrees.entries;
  assert.notEqual(refreshed.find(entry => entry.current).head, refreshed.find(entry => !entry.current).head,
    'Separate code snapshots are distinguishable in the worktree facts');
  assert.equal((JSON.parse(readFileSync(join(root, '.lazyseries/project.json'), 'utf8')).sources).length, 1,
    'The worktree does not cross-write the shared registry');
  t.diagnostic(JSON.stringify({ worktrees: observedRoots, shared_identity: worktreeSnapshot.identity.basis,
    separate_source_revisions: true, registry_owner: 'main worktree root' }));
});

test('an unregistered linked worktree initialized first anchors the registry at the main root', async t => {
  const root = fixture(t, 'git-linked-first');
  put(root, 'docs/requirements.md', REQUIREMENTS);
  git(['init', '-q', '-b', 'main', root], root);
  git(['config', 'user.email', 'identity@test.local'], root);
  git(['config', 'user.name', 'identity-test'], root);
  git(['add', '-A'], root);
  git(['commit', '-qm', 'fixture baseline'], root);
  const worktree = `${root}-linked`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  git(['worktree', 'add', '-q', '-b', 'feature-wt', worktree], root);

  const first = parseSuccess(await invoke(worktree, 'init'));
  assert.ok(existsSync(join(root, '.lazyseries/project.json')),
    'The shared registry is anchored at the main worktree root');
  assert.equal(existsSync(join(worktree, '.lazyseries')), false, 'The linked worktree keeps no private registry copy');

  const mainUninitialized = await invoke(root, 'read');
  assertFailure(mainUninitialized, /^PROJECT_NOT_INITIALIZED\n$/);
  const mainSnapshot = parseSuccess(await invoke(root, 'init'));
  assert.equal(mainSnapshot.repository_key, first.repository_key,
    'A later main-root init adopts the same repository identity');
  t.diagnostic(JSON.stringify({ anchored_at: 'main worktree root', shared_key: mainSnapshot.repository_key }));
});

test('a legacy canonical-path store migrates additively with byte-identical history', async t => {
  const root = fixture(t, 'legacy');
  put(root, 'docs/requirements.md', REQUIREMENTS);
  put(root, '.omo/plans/legacy-plan.md', PLAN);
  const legacyKey = `repo:${hash(root)}`;
  const captures = [
    { source_id: 'source:req', path: 'docs/requirements.md', sha256: hash(REQUIREMENTS), content: REQUIREMENTS },
    { source_id: 'source:plan', path: '.omo/plans/legacy-plan.md', sha256: hash(PLAN), content: PLAN },
  ];
  const context = { actor: 'local:legacy-author', occurredAt: '2026-09-01T00:00:00.000Z',
    capturedSources: captures, capturedRuns: [] };
  let legacy = reducer({ action: 'create', options: { projectId: PROJECT_ID, runtime: 'LazyBuddy',
    repositoryKey: legacyKey, createdAt: '2026-09-01T00:00:00.000Z' } });
  const apply = (operation, payload) => {
    legacy = reducer({ action: 'command', state: legacy, command: {
      schema_version: 1, command_id: `legacy:${legacy.revision}`, project_id: PROJECT_ID,
      expected_revision: legacy.revision, operation, payload }, context }).state;
  };
  apply('register_source', { id: 'source:req', path: 'docs/requirements.md', role: 'requirements' });
  apply('register_source', { id: 'source:plan', path: '.omo/plans/legacy-plan.md', role: 'plan' });
  apply('record_baseline_items', { items: [{ id: 'feature:test', kind: 'feature', state: 'accepted',
    source: { source_id: 'source:req', sha256: hash(REQUIREMENTS), anchor_id: 'heading:feature:test — A feature' } }] });
  apply('register_plan', { id: 'plan:legacy', source: { source_id: 'source:plan', sha256: hash(PLAN), anchor_id: 'document' },
    declared_lifecycle: 'completed', baseline_refs: [{ item_id: 'feature:test', item_revision: 1 }] });

  const statePath = join(root, '.lazybuddy/project/state.json');
  put(root, '.lazybuddy/project/owner.json', canonical({
    schema_version: 1, owner: 'LazyBuddy/project', project_id: PROJECT_ID, repository_key: legacyKey }));
  put(root, '.lazybuddy/project/state.json', canonical(legacy));
  const stateBytesBefore = readFileSync(statePath);
  const receiptsBefore = JSON.parse(JSON.stringify(legacy.receipts));

  // Before migration the legacy store still reads through the canonical-path identity.
  const beforeMigration = parseSuccess(await invoke(root, 'read'));
  assert.equal(beforeMigration.repository_key, legacyKey);
  assert.equal(existsSync(join(root, '.lazyseries')), false);

  const migrated = parseSuccess(await invoke(root, 'init'));
  assert.notEqual(migrated.repository_key, legacyKey);
  assert.equal(migrated.identity.basis, 'registry');
  assert.equal(migrated.identity.legacy_repository_key, legacyKey);
  assert.equal(migrated.identity.repository_key, migrated.repository_key);
  const registry = assertProjectRegistry(JSON.parse(readFileSync(join(root, '.lazyseries/project.json'), 'utf8')));
  assert.equal(registry.repository_key, migrated.repository_key);
  assert.deepEqual(registry.sources.map(source => source.id), ['source:req', 'source:plan'],
    'Migration backfills the registry source pointers additively');

  // Old native receipts and command history remain verifiable byte-for-byte.
  assert.equal(readFileSync(statePath).compare(stateBytesBefore), 0,
    'Migration must not rewrite the legacy state document');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).receipts, receiptsBefore);
  const owner = JSON.parse(readFileSync(join(root, '.lazybuddy/project/owner.json'), 'utf8'));
  assert.equal(owner.registry.legacy_repository_key, legacyKey, 'The native store records its registry link');

  // A completed old plan keeps its historical result while current alignment is unassessed.
  const completed = migrated.plans.find(plan => plan.id === 'plan:legacy');
  assert.equal(completed.declared_lifecycle, 'completed');
  assert.equal(completed.alignment, 'unassessed');
  assert.equal(completed.baseline_reference_status, 'current');
  assert.equal(migrated.revision, legacy.revision);

  // The migrated store is now portable: a moved root keeps the same identity and the
  // old command ids still replay their original receipts.
  const moved = `${root}-relocated`;
  t.after(() => rmSync(moved, { recursive: true, force: true }));
  renameSync(root, moved);
  const afterMove = parseSuccess(await invoke(moved, 'read'));
  assert.equal(afterMove.repository_key, migrated.repository_key);
  const replay = parseSuccess(await invoke(moved, 'command', {
    schema_version: 1, command_id: 'legacy:3', project_id: PROJECT_ID, expected_revision: 3,
    operation: 'register_plan', payload: {
      id: 'plan:legacy', source: { source_id: 'source:plan', sha256: hash(PLAN), anchor_id: 'document' },
      declared_lifecycle: 'completed', baseline_refs: [{ item_id: 'feature:test', item_revision: 1 }] } }));
  assert.equal(replay.receipt.status, 'saved');
  assert.deepEqual(replay.receipt.changed_ids, ['plan:legacy']);
  assert.equal(replay.snapshot.revision, legacy.revision, 'Replay returns the original receipt without a new revision');
  t.diagnostic(JSON.stringify({ legacy_key: legacyKey, registry_key: migrated.repository_key,
    state_bytes_unchanged: true, receipts_preserved: receiptsBefore.length,
    historical_lifecycle: completed.declared_lifecycle, current_alignment: completed.alignment }));
});

test('a second checkout with a different identity does not collide; foreign or corrupt registries refuse closed', async t => {
  const first = fixture(t, 'checkout-a');
  const second = fixture(t, 'checkout-b');
  put(first, 'docs/requirements.md', REQUIREMENTS);
  put(second, 'docs/requirements.md', REQUIREMENTS);
  const firstSnapshot = parseSuccess(await invoke(first, 'init'));
  let secondSnapshot = parseSuccess(await invoke(second, 'init'));
  assert.notEqual(firstSnapshot.repository_key, secondSnapshot.repository_key,
    'Independent checkouts generate independent identities');
  secondSnapshot = await registerSource(second, secondSnapshot, 'source:req', 'docs/requirements.md', 'requirements');
  const reread = parseSuccess(await invoke(first, 'read'));
  assert.equal(reread.revision, 0, 'A different identity in another checkout cannot collide with this store');

  // A foreign registry claiming a different key is a typed identity refusal.
  const firstRegistry = readFileSync(join(first, '.lazyseries/project.json'), 'utf8');
  writeFileSync(join(first, '.lazyseries/project.json'), readFileSync(join(second, '.lazyseries/project.json'), 'utf8'));
  const storeBefore = storeInventory(first);
  assertFailure(await invoke(first, 'read'), /^PROJECT_IDENTITY_MISMATCH\n$/);
  assertFailure(await invoke(first, 'init'), /^PROJECT_IDENTITY_MISMATCH\n$/);
  assert.deepEqual(storeInventory(first), storeBefore, 'A refused identity must not touch the native store');

  // A corrupt registry is a typed parse refusal, still preserving the store.
  writeFileSync(join(first, '.lazyseries/project.json'), '{broken registry\n');
  assertFailure(await invoke(first, 'read'), /^INVALID_JSON\n$/);
  assert.deepEqual(storeInventory(first), storeBefore);

  // Restoring the bound registry restores service.
  writeFileSync(join(first, '.lazyseries/project.json'), firstRegistry);
  assert.equal(parseSuccess(await invoke(first, 'read')).repository_key, firstSnapshot.repository_key);

  // A failed init leaves no half-created registry behind (rollback to pre-init state).
  const collision = fixture(t, 'collision');
  put(collision, 'docs/requirements.md', REQUIREMENTS);
  put(collision, '.lazybuddy/project/state.json', '{"belongs_to":"another application"}\n');
  assertFailure(await invoke(collision, 'init'), /^PROJECT_DIRECTORY_COLLISION\n$/);
  assert.equal(existsSync(join(collision, '.lazyseries')), false,
    'A refused init must not leave a created neutral registry behind');
  t.diagnostic(JSON.stringify({ distinct_identities: true, foreign_registry: 'PROJECT_IDENTITY_MISMATCH',
    corrupt_registry: 'INVALID_JSON', failed_init_rollback: true }));
});
