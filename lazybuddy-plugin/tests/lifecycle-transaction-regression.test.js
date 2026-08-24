'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LifecycleError,
  acquireLock,
  prepareProductRoot,
  promoteRelease,
  pruneRollback,
  recoverStaleLock,
  rollbackRelease,
  stageRelease,
} = require('../scripts/lifecycle');

const ORIGIN = 'https://github.com/elvinzhao10/LazyBuddy.git';
const { receiptFor } = require('../scripts/lifecycle/receipt');

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazy lifecycle regression '));
  const sourceRoot = path.join(sandbox, 'source');
  fs.mkdirSync(sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{"version":"1.0.3"}\n');
  fs.writeFileSync(path.join(sourceRoot, 'entry.js'), "console.log('entry-v1')\n");
  return {
    sandbox,
    sourceRoot,
    paths: prepareProductRoot({ installRoot: path.join(sandbox, 'install'), product: 'LazyBuddy' }),
  };
}

function stage(f, character) {
  const commitSha = character.repeat(40);
  return {
    commitSha,
    ...stageRelease(f.paths, { sourceRoot: f.sourceRoot, version: '1.0.3', commitSha }),
  };
}

function promote(f, staged, overrides = {}) {
  return promoteRelease(f.paths, {
    ...staged,
    entrypoint: 'entry.js',
    manifestRelativePath: 'package.json',
    origin: ORIGIN,
    runtimePath: process.execPath,
    version: '1.0.3',
    ...overrides,
  });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof LifecycleError && error.code === code);
}

test('characterizes legacy v1 receipt reads as immutable ownership evidence', () => {
  // Given: a release installed by the existing v1 lifecycle writer.
  const f = fixture();
  const promoted = promote(f, stage(f, 'a'));
  const legacy = JSON.parse(fs.readFileSync(promoted.receiptPath, 'utf8'));
  legacy.$schema = 'lazy-harness-lifecycle.v1.schema.json';
  legacy.schema_version = 1;
  delete legacy.created_files_scope;
  fs.writeFileSync(promoted.receiptPath, JSON.stringify(legacy, null, 2) + '\n');
  const before = fs.readFileSync(promoted.receiptPath);

  // When: the ownership reader verifies the installed release.
  const verified = receiptFor(f.paths, promoted.releaseId);

  // Then: it returns the v1 evidence without rewriting the receipt.
  assert.equal(verified.receipt.schema_version, 2);
  assert.deepEqual(fs.readFileSync(promoted.receiptPath), before);
});

test('rejects entrypoint traversal before promotion', () => {
  // Given: a valid stage and an entrypoint outside that release.
  const f = fixture();
  const staged = stage(f, 'a');
  const outside = path.join(f.sandbox, 'outside.js');
  fs.writeFileSync(outside, "console.log('outside')\n");

  // When: promotion is requested with parent traversal.
  // Then: it refuses before rename and preserves both stage and outside file.
  for (const entrypoint of ['../outside.js', '/tmp/outside.js', 'C:\\outside.js']) {
    expectCode(() => promote(f, staged, { entrypoint }), 'INVALID_ENTRYPOINT');
  }
  assert.equal(fs.existsSync(staged.stagingPath), true);
  assert.equal(fs.existsSync(path.join(f.paths.releases, staged.releaseId)), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), "console.log('outside')\n");
});

test('validates manifest and receipt metadata before staging rename', () => {
  // Given: an active release and a second staged release.
  const f = fixture();
  promote(f, stage(f, 'a'));
  const activeBefore = fs.readFileSync(f.paths.active);
  const staged = stage(f, 'b');

  // When: its manifest or generated receipt metadata is invalid.
  // Then: promotion refuses without an orphan release or active-state change.
  expectCode(() => promote(f, staged, { manifestRelativePath: 'missing.json' }), 'INVALID_MANIFEST');
  assert.equal(fs.existsSync(staged.stagingPath), true);
  assert.equal(fs.existsSync(path.join(f.paths.releases, staged.releaseId)), false);
  assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);

  expectCode(() => promote(f, staged, {
    registeredProjectDeclarations: [{ project_root: '../relative' }],
  }), 'INVALID_RECEIPT');
  assert.equal(fs.existsSync(staged.stagingPath), true);
  assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);
});

test('stale lock recovery removes only a valid owned lock proven stale', () => {
  // Given: a live owned lock, malformed lock, and valid dead-process lock in turn.
  const f = fixture();
  const live = acquireLock(f.paths, 'update');

  // When/Then: live and malformed locks refuse recovery and remain untouched.
  expectCode(() => recoverStaleLock(f.paths, 'recover-stale-lock'), 'LOCK_LIVE');
  assert.equal(fs.existsSync(f.paths.lock), true);
  live.release();
  fs.writeFileSync(f.paths.lock, '{}\n');
  expectCode(() => recoverStaleLock(f.paths, 'recover-stale-lock'), 'OWNERSHIP_REFUSED');
  assert.equal(fs.readFileSync(f.paths.lock, 'utf8'), '{}\n');

  const stale = {
    pid: 99999999,
    host: os.hostname(),
    started_at: '2000-01-01T00:00:00.000Z',
    operation: 'update',
    nonce: '00000000-0000-4000-8000-000000000000',
  };
  fs.writeFileSync(f.paths.lock, JSON.stringify({ ...stale, host: 'different-host.invalid' }) + '\n');
  expectCode(() => recoverStaleLock(f.paths, 'recover-stale-lock'), 'LOCK_STALENESS_UNPROVEN');
  assert.equal(fs.existsSync(f.paths.lock), true);
  fs.writeFileSync(f.paths.lock, JSON.stringify(stale) + '\n');
  recoverStaleLock(f.paths, 'recover-stale-lock');
  assert.equal(fs.existsSync(f.paths.lock), false);
});

test('rollback restores the selected release entrypoint', () => {
  // Given: two releases with different entrypoints.
  const f = fixture();
  fs.writeFileSync(path.join(f.sourceRoot, 'first.js'), "console.log('first-entry')\n");
  promote(f, stage(f, 'a'), { entrypoint: 'first.js' });
  fs.writeFileSync(path.join(f.sourceRoot, 'second.js'), "console.log('second-entry')\n");
  promote(f, stage(f, 'b'), { entrypoint: 'second.js' });

  // When: the previous release is selected and the stable launcher runs.
  const active = rollbackRelease(f.paths);
  const output = require('node:child_process').execFileSync(process.execPath, [f.paths.launcher], { encoding: 'utf8' });

  // Then: active metadata and execution both use the first release entrypoint.
  assert.equal(active.entrypoint, 'first.js');
  assert.equal(output.trim(), 'first-entry');
});

test('prune refusal leaves the previous release pointer intact', () => {
  // Given: two releases where the retained previous release was modified.
  const f = fixture();
  const first = promote(f, stage(f, 'a'));
  promote(f, stage(f, 'b'));
  fs.appendFileSync(path.join(f.paths.releases, first.releaseId, 'entry.js'), '// modified\n');

  // When: confirmed pruning validates ownership.
  // Then: it refuses without clearing the rollback pointer.
  expectCode(() => pruneRollback(f.paths, 'prune-rollback'), 'OWNERSHIP_REFUSED');
  assert.equal(JSON.parse(fs.readFileSync(f.paths.active, 'utf8')).previous_release, first.releaseId);
});
