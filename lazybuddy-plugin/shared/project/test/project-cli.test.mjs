import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const FIXTURES = new URL('./fixtures/offline-notebook/', import.meta.url);
const PROJECT_ID = 'project:test';
const ACTOR = 'local:test';
const SOURCES = [
  { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements', fixture: 'requirements.md' },
  { id: 'source:principles', path: 'docs/project/principles.md', role: 'principles', fixture: 'principles.md' },
  { id: 'source:foundation', path: '.omo/plans/foundation.md', role: 'plan', fixture: 'plans/foundation.md' },
  { id: 'source:search', path: '.omo/plans/search.md', role: 'plan', fixture: 'plans/search.md' },
  { id: 'source:export', path: '.omo/plans/export.md', role: 'plan', fixture: 'plans/export.md' },
  { id: 'source:followup', path: '.omo/plans/followup.md', role: 'plan', fixture: 'plans/followup.md' },
];
const ITEM_DEFINITIONS = [
  { id: 'feature:notes', kind: 'feature', sourceId: 'source:requirements', heading: 'feature:notes — Personal notes' },
  { id: 'requirement:offline', kind: 'requirement', sourceId: 'source:requirements', heading: 'requirement:offline — Work without a network' },
  { id: 'principle:local-first', kind: 'principle', sourceId: 'source:principles', heading: 'principle:local-first — Preserve local ownership' },
];

const hash = value => createHash('sha256').update(value).digest('hex');
const byId = (records, id) => {
  const value = records.find(record => record.id === id);
  assert.ok(value, `Missing record ${id}`);
  return value;
};

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, content, { mode: 0o600 });
}

function fileRecord(path) {
  const stat = lstatSync(path, { bigint: true });
  assert.ok(stat.isFile(), `Expected regular fixture file: ${path}`);
  return {
    sha256: hash(readFileSync(path)),
    bytes: Number(stat.size),
    inode: stat.ino.toString(),
    mtime_ns: stat.mtimeNs.toString(),
    mode: Number(stat.mode & 0o777n),
  };
}

function manifest(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path).split('\\').join('/')] = fileRecord(path);
    }
  }
  visit(root);
  return files;
}

function originalManifest(root) {
  return Object.fromEntries(SOURCES.map(source => [source.path, fileRecord(join(root, source.path))]));
}

function invoke(root, action, input, options = {}) {
  const args = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID, '--actor', options.actor ?? ACTOR];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      timeout: 25000,
    });
    const output = []; const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    }));
    child.stdin.end(options.rawInput ?? (input === undefined ? '' : JSON.stringify(input)));
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

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazybuddy-project-cli-')));
  for (const source of SOURCES) put(root, source.path, readFileSync(new URL(source.fixture, FIXTURES)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    snapshot: null,
    sequence: 0,
    statePath: join(root, '.lazybuddy/project/state.json'),
    async init() {
      this.snapshot = parseSuccess(await invoke(root, 'init'));
      return this.snapshot;
    },
    async read() {
      this.snapshot = parseSuccess(await invoke(root, 'read'));
      return this.snapshot;
    },
    command(operation, payload, overrides = {}) {
      return {
        schema_version: 1,
        command_id: `cli:${++this.sequence}`,
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
    persisted() { return JSON.parse(readFileSync(this.statePath, 'utf8')); },
  };
}

function sourcePayload(source) {
  return { id: source.id, path: source.path, role: source.role };
}

function reference(f, sourceId, anchor = 'document') {
  const source = SOURCES.find(record => record.id === sourceId);
  assert.ok(source, `Missing fixture source ${sourceId}`);
  return { source_id: sourceId, sha256: hash(readFileSync(join(f.root, source.path))), anchor_id: anchor };
}

function baselinePayload(f, definitions = ITEM_DEFINITIONS) {
  return { items: definitions.map(item => ({
    id: item.id, kind: item.kind, state: 'accepted',
    source: reference(f, item.sourceId, `heading:${item.heading}`),
  })) };
}

function planPayload(f, id, sourceId, lifecycle) {
  return {
    id,
    source: reference(f, sourceId),
    declared_lifecycle: lifecycle,
    baseline_refs: ITEM_DEFINITIONS.map(item => ({ item_id: item.id, item_revision: byId(f.snapshot.items, item.id).revision })),
  };
}

async function seedContinuity(f) {
  await f.init();
  for (const source of SOURCES.slice(0, 5)) await f.send('register_source', sourcePayload(source));
  await f.send('record_baseline_items', baselinePayload(f));
  await f.send('register_plan', planPayload(f, 'plan:foundation', 'source:foundation', 'completed'));
  await f.send('register_plan', planPayload(f, 'plan:search', 'source:search', 'active'));
  await f.send('register_plan', planPayload(f, 'plan:export', 'source:export', 'planned'));
}

test('read before init changes no fixture files; init creates a persistent project without a native run', async t => {
  const f = fixture(t);
  const before = manifest(f.root);
  const uninitialized = await invoke(f.root, 'read');
  assertFailure(uninitialized, /^PROJECT_NOT_INITIALIZED\n$/);
  assert.deepEqual(manifest(f.root), before);
  assert.equal(existsSync(join(f.root, '.lazybuddy')), false);

  const initial = await f.init();
  assert.equal(initial.project_id, PROJECT_ID);
  assert.equal(initial.runtime, 'LazyBuddy');
  assert.equal(initial.revision, 0);
  assert.equal(initial.baseline_revision, 0);
  assert.equal(initial.summary.plan_count, 0);
  assert.deepEqual(initial.plans, []);
  assert.deepEqual(initial.items, []);
  assert.deepEqual(f.persisted().receipts, []);
  assert.equal(existsSync(join(f.root, '.lazybuddy/runs')), false);
  assert.deepEqual(originalManifest(f.root), before);

  const nativeBeforeReload = fileRecord(f.statePath);
  const reloaded = await f.read();
  assert.equal(reloaded.repository_key, initial.repository_key);
  assert.equal(reloaded.revision, 0);
  assert.deepEqual(fileRecord(f.statePath), nativeBeforeReload);
  await f.init();
  assert.deepEqual(fileRecord(f.statePath), nativeBeforeReload, 'Repeated init must not reset or rewrite the accepted project');
  t.diagnostic(JSON.stringify({ before_files: Object.keys(before).length, after_read_files: Object.keys(before).length,
    initial_revision: initial.revision, native_runs_created: false, state_sha256: nativeBeforeReload.sha256 }));
});

test('real CLI persistence retains one feature and principle across several plans and a fresh process', async t => {
  const f = fixture(t);
  const originals = originalManifest(f.root);
  await seedContinuity(f);
  const saved = fileRecord(f.statePath);
  const reloaded = await f.read();
  assert.deepEqual(fileRecord(f.statePath), saved);
  assert.equal(reloaded.summary.accepted_features, 1);
  assert.equal(reloaded.summary.accepted_principles, 1);
  assert.equal(reloaded.summary.accepted_requirements, 1);
  assert.equal(reloaded.summary.plan_count, 3);
  const contributors = ['plan:export', 'plan:foundation', 'plan:search'];
  for (const id of ['feature:notes', 'requirement:offline', 'principle:local-first']) {
    assert.deepEqual([...byId(reloaded.items, id).contributing_plan_ids].sort(), contributors);
    assert.equal(byId(reloaded.items, id).revision, 1);
  }
  assert.equal(byId(reloaded.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.equal(byId(reloaded.plans, 'plan:search').declared_lifecycle, 'active');
  assert.equal(byId(reloaded.plans, 'plan:export').declared_lifecycle, 'planned');
  assert.ok(reloaded.plans.every(plan => plan.alignment === 'unassessed'));
  assert.ok(reloaded.sources.every(source => source.observation.status === 'current'));

  await f.send('register_source', sourcePayload(SOURCES[5]));
  await f.send('register_plan', planPayload(f, 'plan:followup', 'source:followup', 'draft'));
  const after = await f.read();
  assert.equal(after.summary.plan_count, 4);
  assert.equal(after.summary.accepted_features, 1);
  assert.equal(after.summary.accepted_principles, 1);
  assert.deepEqual([...byId(after.items, 'feature:notes').contributing_plan_ids].sort(), [...contributors, 'plan:followup'].sort());
  assert.equal(byId(after.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.deepEqual(originalManifest(f.root), originals, 'Source registration and reload must preserve original Markdown bytes and metadata');
  const persisted = f.persisted();
  assert.equal(persisted.receipts.length, 11);
  assert.equal(persisted.revision, 11);
  t.diagnostic(JSON.stringify({ original_files_unchanged: Object.keys(originals).length, plans_before: 3, plans_after: after.summary.plan_count,
    persistent_feature_id: byId(after.items, 'feature:notes').id, persisted_revision: persisted.revision, receipt_count: persisted.receipts.length }));
});

test('two actual competing CLI processes yield one saved command and one CAS conflict', async t => {
  const f = fixture(t);
  const originals = originalManifest(f.root);
  await f.init();
  const initialState = fileRecord(f.statePath);
  const commands = [
    f.command('register_source', sourcePayload(SOURCES[0])),
    f.command('register_source', sourcePayload(SOURCES[1])),
  ];
  assert.equal(commands[0].expected_revision, commands[1].expected_revision);
  const raw = await Promise.all(commands.map(command => invoke(f.root, 'command', command)));
  const results = raw.map(parseSuccess);
  assert.deepEqual(results.map(result => result.receipt.status).sort(), ['conflict', 'saved']);
  const winner = commands[results.findIndex(result => result.receipt.status === 'saved')];
  const persisted = f.persisted();
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.sources.length, 1);
  assert.equal(persisted.sources[0].id, winner.payload.id);
  assert.equal(persisted.receipts.length, 1);
  assert.equal(persisted.receipts[0].command.command_id, winner.command_id);
  const finalState = fileRecord(f.statePath);
  assert.notEqual(finalState.sha256, initialState.sha256);
  assert.equal((await f.read()).revision, 1);
  assert.deepEqual(fileRecord(f.statePath), finalState);
  assert.deepEqual(originalManifest(f.root), originals);
  t.diagnostic(JSON.stringify({ statuses: results.map(result => result.receipt.status).sort(), before_revision: 0,
    after_revision: persisted.revision, receipt_count: persisted.receipts.length, state_sha256: finalState.sha256 }));
});

test('same-ID replay after the source moves returns the original receipt without another write', async t => {
  const f = fixture(t);
  await f.init();
  const accepted = await f.send('register_source', sourcePayload(SOURCES[0]));
  await f.send('register_source', sourcePayload(SOURCES[1]));
  const original = join(f.root, SOURCES[0].path);
  const moved = join(f.root, 'docs/project/requirements-moved.md');
  renameSync(original, moved);
  const before = manifest(f.root);
  const storedBefore = fileRecord(f.statePath);
  const replay = parseSuccess(await invoke(f.root, 'command', accepted.command));
  assert.deepEqual(replay.receipt, accepted.receipt);
  assert.equal(replay.snapshot.revision, 2, 'Replay must retain newer accepted work');
  assert.equal(byId(replay.snapshot.sources, 'source:requirements').observation.status, 'missing');
  assert.deepEqual(fileRecord(f.statePath), storedBefore, 'Replay rewrote the atomic state file');
  assert.deepEqual(manifest(f.root), before, 'Replay must not recreate or relocate original documents');
  assert.equal(f.persisted().receipts.length, 2);

  const mismatch = await invoke(f.root, 'command', {
    ...accepted.command, payload: { ...accepted.command.payload, role: 'overview' },
  });
  assertFailure(mismatch, /^IDEMPOTENCY_CONFLICT\n$/);
  assert.deepEqual(manifest(f.root), before);
  t.diagnostic(JSON.stringify({ source_status: 'missing', before_revision: 2, after_revision: replay.snapshot.revision,
    state_sha256_before: storedBefore.sha256, state_sha256_after: fileRecord(f.statePath).sha256,
    state_inode_unchanged: fileRecord(f.statePath).inode === storedBefore.inode }));
});

test('actual source edits remain observations until accepted and only affected baseline references become stale', async t => {
  const f = fixture(t);
  await seedContinuity(f);
  const originals = originalManifest(f.root);
  const stateBeforeEdit = fileRecord(f.statePath);
  const oldBaseline = f.snapshot.baseline_revision;
  const requirementPath = join(f.root, SOURCES[0].path);
  const revisedContent = readFileSync(requirementPath, 'utf8').replace(
    'Cloud sign-in is not a prerequisite.',
    'Optional cloud sign-in must never block local reading or search.',
  );
  writeFileSync(requirementPath, revisedContent);
  const editedOriginal = fileRecord(requirementPath);
  const observed = await f.read();
  assert.equal(byId(observed.sources, 'source:requirements').observation.status, 'changed');
  assert.match(byId(observed.items, 'requirement:offline').text, /Cloud sign-in is not a prerequisite/);
  assert.equal(byId(observed.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.deepEqual(fileRecord(f.statePath), stateBeforeEdit, 'A read must not accept or persist the external change');

  await f.send('register_source', sourcePayload(SOURCES[0]));
  const amended = await f.send('record_baseline_items', { items: baselinePayload(f, ITEM_DEFINITIONS.slice(0, 2)).items
    .map(item => item.id === 'requirement:offline'
      ? { ...item, authority: 'user decision 2026-10-06: cloud sign-in stays optional' } : item) });
  assert.ok(amended.receipt.invalidations.some(fact => fact.item_id === 'requirement:offline'),
    'an authority-bearing meaning change emits the amendment invalidation receipt');
  const accepted = await f.read();
  assert.equal(accepted.baseline_revision, oldBaseline + 1);
  assert.equal(byId(accepted.items, 'requirement:offline').revision, 2);
  assert.equal(byId(accepted.items, 'feature:notes').revision, 1);
  assert.equal(byId(accepted.items, 'principle:local-first').revision, 1);
  assert.match(byId(accepted.items, 'requirement:offline').text, /Optional cloud sign-in/);
  for (const plan of accepted.plans) {
    assert.equal(plan.baseline_reference_status, 'stale');
    assert.deepEqual(plan.stale_item_ids, ['requirement:offline']);
    assert.equal(plan.alignment, 'unassessed');
  }
  assert.equal(byId(accepted.plans, 'plan:foundation').declared_lifecycle, 'completed');
  assert.deepEqual(fileRecord(requirementPath), editedOriginal, 'Accepting the source must not rewrite the externally edited original');
  const afterOriginals = originalManifest(f.root);
  for (const source of SOURCES.slice(1)) assert.deepEqual(afterOriginals[source.path], originals[source.path]);
  t.diagnostic(JSON.stringify({ source_sha256_before: originals[SOURCES[0].path].sha256, source_sha256_after: editedOriginal.sha256,
    baseline_before: oldBaseline, baseline_after: accepted.baseline_revision, requirement_revision: 2, feature_revision: 1,
    historical_lifecycle: byId(accepted.plans, 'plan:foundation').declared_lifecycle }));
});

test('an unknown project directory collision is preserved rather than adopted or overwritten', async t => {
  const f = fixture(t);
  put(f.root, '.lazybuddy/project/state.json', '{"belongs_to":"another application"}\n');
  put(f.root, '.lazybuddy/project/keep.txt', 'Caller-owned project directory.\n');
  const before = manifest(f.root);
  const result = await invoke(f.root, 'init');
  assertFailure(result, /^PROJECT_DIRECTORY_COLLISION\n$/);
  assert.deepEqual(manifest(f.root), before);
  assert.equal(existsSync(join(f.root, '.lazybuddy/project/owner.json')), false);
  t.diagnostic(JSON.stringify({ collision: 'PROJECT_DIRECTORY_COLLISION', caller_files_unchanged: Object.keys(before).length }));
});

test('unrelated native files survive init and commands; a linked native done claim grants no verification', async t => {
  const f = fixture(t);
  put(f.root, '.lazybuddy/state.json', '{"legacy_state":"preserve"}\n');
  put(f.root, '.lazybuddy/decisions/ledger.jsonl', '{"decision":"preserve"}\n');
  // A real created-run shape (create-run.sh) with its journaled events; the
  // self-asserted done/verified claims inside are data, never authority.
  put(f.root, '.lazybuddy/runs/existing-run/state.json', JSON.stringify({
    schema_version: '2', run_id: 'existing-run', created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
    objective: 'Legacy run', status: 'done', dashboard_project_id: 'native:test', verification: 'verified',
    plan_reference: '.omo/plans/search.md',
    tasks: [{ id: 'legacy-task', status: 'done', verification: 'verified' }],
    progress: { total_checkboxes: 0, completed_checkboxes: 0 }, verification_gates: [],
    review_status: 'not_started', iteration: { count: 0, max: 500, mode: 'normal' }, last_checkpoint: null,
    budget: { max_tokens: null, max_cost_usd: null }, session_ids: [], runtime_fingerprints: [],
  }) + '\n');
  put(f.root, '.lazybuddy/runs/existing-run/events.jsonl',
    '{"ts":"2026-10-05T00:00:00Z","run_id":"existing-run","event":"run_created","objective":"Legacy run"}\n');
  const nativePaths = ['.lazybuddy/state.json', '.lazybuddy/decisions/ledger.jsonl', '.lazybuddy/runs/existing-run/state.json'];
  const nativeBefore = Object.fromEntries(nativePaths.map(path => [path, fileRecord(join(f.root, path))]));
  await seedContinuity(f);
  const result = await f.send('link_native_run', { plan_id: 'plan:search', native_project_id: 'native:test', run_id: 'existing-run' });
  const plan = byId(result.snapshot.plans, 'plan:search');
  assert.equal(plan.declared_lifecycle, 'active');
  assert.equal(plan.native_runs.length, 1);
  assert.equal(plan.native_runs[0].run_id, 'existing-run');
  assert.deepEqual(plan.native_observations, [], 'An identity link cannot fabricate execution or session observations');
  assert.equal(plan.alignment, 'unassessed');
  assert.ok(!Object.hasOwn(plan, 'verification'));
  assert.ok(!Object.hasOwn(result.snapshot.summary, 'active_agents'));
  assert.ok(!Object.hasOwn(result.snapshot.summary, 'verified_features'));
  assert.deepEqual(readdirSync(join(f.root, '.lazybuddy/runs')), ['existing-run']);
  for (const path of nativePaths) assert.deepEqual(fileRecord(join(f.root, path)), nativeBefore[path]);
  t.diagnostic(JSON.stringify({ native_files_preserved: nativePaths.length, native_runs_before: 1, native_runs_after: 1,
    linked_run: plan.native_runs[0].run_id, execution_observations: plan.native_observations.length, verification_granted: false }));
});

test('wrong identity, unknown command fields and imported verification are rejected without state writes', async t => {
  const f = fixture(t);
  await seedContinuity(f);
  const before = manifest(f.root);
  const rejected = [
    f.command('register_source', { ...sourcePayload(SOURCES[5]), arbitrary_write: true }),
    f.command('register_plan', { ...planPayload(f, 'plan:forged', 'source:export', 'completed'), verification: 'verified' }),
    f.command('record_baseline_items', { items: [{ ...baselinePayload(f).items[0], verified: true }] }),
    f.command('set_verified', { plan_id: 'plan:foundation' }),
    f.command('register_source', sourcePayload(SOURCES[5]), { actor: 'administrator' }),
  ];
  for (const command of rejected) {
    assertFailure(await invoke(f.root, 'command', command));
    assert.deepEqual(manifest(f.root), before);
  }
  assertFailure(await invoke(f.root, 'read', undefined, { projectId: 'project:other' }), /^PROJECT_IDENTITY_MISMATCH\n$/);
  assert.deepEqual(manifest(f.root), before);
  const reloaded = await f.read();
  const completed = byId(reloaded.plans, 'plan:foundation');
  assert.equal(completed.declared_lifecycle, 'completed');
  assert.ok(!Object.hasOwn(completed, 'verification'));
  assert.deepEqual(completed.native_observations, []);
  assert.deepEqual(manifest(f.root), before);
  t.diagnostic(JSON.stringify({ rejected_commands: rejected.length, project_revision_unchanged: reloaded.revision,
    state_sha256: fileRecord(f.statePath).sha256, verification_granted: false }));
});

test('corrupted retained command digest rejects real CLI read and command while preserving the corrupted file', async t => {
  const f = fixture(t);
  await f.init();
  await f.send('register_source', sourcePayload(SOURCES[0]));
  const accepted = fileRecord(f.statePath);
  const corrupted = f.persisted();
  assert.equal(corrupted.receipts.length, 1);
  corrupted.receipts[0].sha256 = '0'.repeat(64);
  writeFileSync(f.statePath, JSON.stringify(corrupted) + '\n', { mode: 0o600 });
  const before = manifest(f.root);
  const corruptRecord = fileRecord(f.statePath);
  assert.equal(corruptRecord.mode, 0o600);
  assert.notEqual(corruptRecord.sha256, accepted.sha256);

  assertFailure(await invoke(f.root, 'read'), /^INVALID_HISTORY\n$/);
  assert.deepEqual(manifest(f.root), before);
  const next = f.command('register_source', sourcePayload(SOURCES[1]));
  assertFailure(await invoke(f.root, 'command', next), /^INVALID_HISTORY\n$/);
  assert.deepEqual(manifest(f.root), before);
  t.diagnostic(JSON.stringify({ retained_digest: 'intentionally corrupted', read_rejected: 'INVALID_HISTORY',
    command_rejected: 'INVALID_HISTORY', state_sha256_before: corruptRecord.sha256,
    state_sha256_after: fileRecord(f.statePath).sha256, state_mode: '0600' }));
});

test('raw duplicate JSON keys are rejected before top-level or nested authority can be collapsed', async t => {
  const f = fixture(t);
  await f.init();
  const before = manifest(f.root);
  const command = f.command('register_source', sourcePayload(SOURCES[0]));
  const ordinary = JSON.stringify(command);
  const variants = [
    ordinary.replace('"operation":"register_source"', '"operation":"set_verified","operation":"register_source"'),
    ordinary.replace('"id":"source:requirements"', '"id":"source:forged","id":"source:requirements"'),
  ];
  for (const rawInput of variants) {
    assert.notEqual(rawInput, ordinary, 'The fixture must contain actual duplicate keys on stdin');
    assertFailure(await invoke(f.root, 'command', undefined, { rawInput }), /^INVALID_JSON\n$/);
    assert.deepEqual(manifest(f.root), before);
  }
  assert.equal(f.persisted().revision, 0);
  assert.deepEqual(f.persisted().receipts, []);
  t.diagnostic(JSON.stringify({ raw_duplicate_cases: variants.length, expected_error: 'INVALID_JSON',
    revision_unchanged: 0, receipt_count: 0, state_sha256: fileRecord(f.statePath).sha256 }));
});
