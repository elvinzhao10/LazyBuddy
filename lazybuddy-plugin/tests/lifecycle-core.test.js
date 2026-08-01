'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LifecycleError,
  acquireLock,
  offboardProduct,
  prepareProductRoot,
  promoteRelease,
  pruneRollback,
  recoverBootstrapLock,
  recoverStaleLock,
  recoveryReport,
  resolveInstallRoot,
  rollbackRelease,
  stageRelease,
} = require('../scripts/lifecycle');

const PRODUCTS = {
  LazyTrae: 'https://github.com/elvinzhao10/LazyTrae.git',
  LazyBuddy: 'https://github.com/elvinzhao10/LazyBuddy.git',
};

function fixture(product = 'LazyBuddy') {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazy lifecycle '));
  const installRoot = path.join(sandbox, 'durable root');
  const sourceRoot = path.join(sandbox, 'source checkout');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ version: '1.0.3' }) + '\n');
  fs.writeFileSync(path.join(sourceRoot, 'entry.js'), "console.log('durable-launch-ok')\n");
  return {
    sandbox,
    sourceRoot,
    paths: prepareProductRoot({ installRoot, product }),
    product,
  };
}

function release(f, shaCharacter, extra = {}) {
  const commitSha = shaCharacter.repeat(40);
  const staged = stageRelease(f.paths, {
    sourceRoot: f.sourceRoot,
    version: '1.0.3',
    commitSha,
  });
  return promoteRelease(f.paths, {
    ...staged,
    commitSha,
    entrypoint: 'entry.js',
    manifestRelativePath: 'package.json',
    origin: PRODUCTS[f.product],
    runtimePath: process.execPath,
    version: '1.0.3',
    ...extra,
  });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof LifecycleError && error.code === code);
}

test('resolves explicit and platform durable roots without accepting ambiguous paths', () => {
  // Given: platform-specific environment fixtures and an explicit spaced root.
  const home = path.join(path.parse(process.cwd()).root, 'Users', 'Example Person');
  const explicit = path.join(home, 'durable install');

  // When: each supported platform root is resolved.
  // Then: the result is absolute, deterministic, and rejects relative/root paths.
  assert.equal(resolveInstallRoot({ installRoot: explicit }), path.resolve(explicit));
  assert.equal(resolveInstallRoot({ platform: 'darwin', home }), path.join(home, 'Library', 'Application Support', 'LazySeries'));
  assert.equal(resolveInstallRoot({ platform: 'linux', home, environment: {} }), path.join(home, '.local', 'share', 'lazyseries'));
  assert.equal(resolveInstallRoot({ platform: 'linux', home, environment: { XDG_DATA_HOME: path.join(home, 'xdg') } }), path.join(home, 'xdg', 'lazyseries'));
  assert.equal(resolveInstallRoot({ platform: 'win32', environment: { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' } }), 'C:\\Users\\Example\\AppData\\Local\\LazySeries');
  expectCode(() => resolveInstallRoot({ installRoot: 'relative' }), 'INVALID_ROOT');
  expectCode(() => resolveInstallRoot({ installRoot: path.parse(process.cwd()).root }), 'INVALID_ROOT');
});

test('promotes two releases transactionally and launches after source deletion', () => {
  // Given: a spaced durable root and two immutable source revisions.
  const f = fixture();
  const first = release(f, 'a');
  fs.writeFileSync(path.join(f.sourceRoot, 'entry.js'), "console.log('durable-launch-v2')\n");
  const second = release(f, 'b');
  expectCode(() => release(f, 'c'), 'ROLLBACK_FULL');

  // When: the source checkout is deleted and the stable launcher is invoked.
  fs.rmSync(f.sourceRoot, { recursive: true });
  const output = require('node:child_process').execFileSync(process.execPath, [f.paths.launcher], { encoding: 'utf8' });

  // Then: active state points at v2, retains exactly v1, and runs from durable state.
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  assert.equal(active.active_release, second.releaseId);
  assert.equal(active.previous_release, first.releaseId);
  assert.equal(output.trim(), 'durable-launch-v2');
});

test('lock contention and stale recovery require explicit confirmation', () => {
  // Given: a live lifecycle lock.
  const f = fixture();
  const lock = acquireLock(f.paths, 'install');

  // When/Then: a competitor and an unconfirmed recovery both refuse.
  expectCode(() => acquireLock(f.paths, 'update'), 'LOCKED');
  expectCode(() => recoverStaleLock(f.paths), 'CONFIRMATION_REQUIRED');
  lock.release();
  fs.writeFileSync(f.paths.lock, JSON.stringify({
    pid: 99999999,
    host: os.hostname(),
    started_at: '2000-01-01T00:00:00.000Z',
    operation: 'update',
    nonce: '00000000-0000-4000-8000-000000000000',
  }));
  expectCode(() => acquireLock(f.paths, 'update'), 'LOCKED');
  recoverStaleLock(f.paths, 'recover-stale-lock');
  assert.equal(fs.existsSync(f.paths.lock), false);
});

test('bootstrap stale-lock recovery rejects malformed, linked, and replaced siblings', (t) => {
  const f = fixture();
  const record = {
    pid: 99999999,
    host: os.hostname(),
    started_at: '2000-01-01T00:00:00.000Z',
    operation: 'onboard',
    nonce: '00000000-0000-4000-8000-000000000000',
    lock_kind: 'bootstrap',
    product: f.product,
  };
  fs.writeFileSync(f.paths.bootstrapLock, '{}\n');
  expectCode(() => recoverBootstrapLock(f.paths, 'recover-stale-bootstrap-lock'), 'OWNERSHIP_REFUSED');
  fs.rmSync(f.paths.bootstrapLock);
  const linkedTarget = path.join(f.sandbox, 'linked-lock');
  fs.writeFileSync(linkedTarget, JSON.stringify(record));
  fs.symlinkSync(linkedTarget, f.paths.bootstrapLock);
  expectCode(() => recoverBootstrapLock(f.paths, 'recover-stale-bootstrap-lock'), 'OWNERSHIP_REFUSED');
  fs.rmSync(f.paths.bootstrapLock);
  fs.writeFileSync(f.paths.bootstrapLock, JSON.stringify(record));
  const replacement = JSON.stringify({ ...record, nonce: '11111111-1111-4111-8111-111111111111' });
  const replacementPath = path.join(f.sandbox, 'replacement-lock');
  const lstatSync = fs.lstatSync;
  let lockStats = 0;
  t.mock.method(fs, 'lstatSync', (target) => {
    if (target === f.paths.bootstrapLock && ++lockStats === 2) {
      fs.writeFileSync(replacementPath, replacement);
      fs.renameSync(replacementPath, target);
    }
    return lstatSync(target);
  });
  expectCode(() => recoverBootstrapLock(f.paths, 'recover-stale-bootstrap-lock'), 'OWNERSHIP_REFUSED');
  assert.equal(fs.readFileSync(f.paths.bootstrapLock, 'utf8'), replacement);
});

test('cross-device promotion failure leaves the old active release readable', (t) => {
  // Given: one active release and a second valid same-volume stage.
  const f = fixture();
  const first = release(f, 'a');
  const commitSha = 'b'.repeat(40);
  const staged = stageRelease(f.paths, { sourceRoot: f.sourceRoot, version: '1.0.3', commitSha });
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === staged.stagingPath) {
      const error = new Error('cross-device');
      error.code = 'EXDEV';
      throw error;
    }
    return rename(source, target);
  });

  // When: the filesystem refuses the staging promotion.
  // Then: the documented refusal is returned and the old active JSON remains readable.
  expectCode(() => promoteRelease(f.paths, {
    ...staged, commitSha, entrypoint: 'entry.js', manifestRelativePath: 'package.json',
    origin: PRODUCTS.LazyBuddy, runtimePath: process.execPath, version: '1.0.3',
  }), 'CROSS_DEVICE');
  assert.equal(JSON.parse(fs.readFileSync(f.paths.active, 'utf8')).active_release, first.releaseId);
});

test('rollback is single-use and pruning requires explicit confirmation', () => {
  // Given: two verified releases.
  const f = fixture();
  const first = release(f, 'a');
  const second = release(f, 'b');

  // When: rollback is consumed once.
  const rolledBack = rollbackRelease(f.paths);

  // Then: v1 is active, v2 is retained once, and pruning is confirmation-gated.
  assert.equal(rolledBack.active_release, first.releaseId);
  assert.equal(rolledBack.previous_release, null);
  expectCode(() => rollbackRelease(f.paths), 'NO_ROLLBACK');
  expectCode(() => pruneRollback(f.paths), 'CONFIRMATION_REQUIRED');
  pruneRollback(f.paths, 'prune-rollback');
  assert.equal(fs.existsSync(path.join(f.paths.releases, second.releaseId)), false);
});

test('recovery is report-only for malformed state, locks, and staging leftovers', () => {
  // Given: malformed active state, an operation lock, and an abandoned stage.
  const f = fixture();
  fs.writeFileSync(f.paths.active, '{not-json}\n');
  fs.writeFileSync(f.paths.lock, '{}\n');
  fs.mkdirSync(path.join(f.paths.staging, 'abandoned'));

  // When: crash recovery is inspected.
  const report = recoveryReport(f.paths);

  // Then: all hazards are reported and none is deleted.
  assert.deepEqual(new Set(report.issues.map((issue) => issue.code)), new Set(['MALFORMED_ACTIVE', 'LOCK_PRESENT', 'STAGING_PRESENT']));
  assert.equal(fs.existsSync(f.paths.lock), true);
  assert.equal(fs.existsSync(path.join(f.paths.staging, 'abandoned')), true);
});

test('stable launcher refuses an absent recorded runtime without changing active state', () => {
  // Given: a promoted release whose recorded Node runtime was moved.
  const f = fixture();
  release(f, 'a');
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  active.runtime_path = path.join(f.sandbox, 'missing-node');
  fs.writeFileSync(f.paths.active, JSON.stringify(active, null, 2) + '\n');
  const before = fs.readFileSync(f.paths.active);

  // When: the stable launcher is invoked.
  const result = require('node:child_process').spawnSync(process.execPath, [f.paths.launcher]);

  // Then: it exits nonzero and leaves the selected release unchanged.
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(f.paths.active), before);
});

test('offboard removes only exact receipt-owned product state', async (t) => {
  await t.test('preserves the sibling product', () => {
    const f = fixture();
    release(f, 'a');
    const buddy = prepareProductRoot({ installRoot: f.paths.installRoot, product: 'LazyTrae' });
    fs.writeFileSync(path.join(buddy.productRoot, 'caller-owned'), 'keep\n');
    offboardProduct(f.paths, 'offboard-product');
    assert.equal(fs.readFileSync(path.join(buddy.productRoot, 'caller-owned'), 'utf8'), 'keep\n');
    assert.equal(fs.existsSync(f.paths.productRoot), false);
  });

  for (const unsafe of ['modified', 'unknown', 'unknown-release', 'receipt-symlink', 'receipt-hardlink', 'release-symlink', 'release-hardlink', 'malformed', 'absent']) {
    await t.test(`refuses ${unsafe} state without deleting it`, () => {
      const f = fixture();
      const promoted = release(f, 'a');
      if (unsafe === 'modified') fs.appendFileSync(path.join(f.paths.releases, promoted.releaseId, 'entry.js'), '// edited\n');
      if (unsafe === 'unknown') fs.writeFileSync(path.join(f.paths.productRoot, 'unknown'), 'keep\n');
      if (unsafe === 'unknown-release') fs.mkdirSync(path.join(f.paths.releases, 'caller-owned'));
      if (unsafe === 'malformed') fs.writeFileSync(promoted.receiptPath, '{bad-json}\n');
      if (unsafe === 'receipt-symlink') {
        const target = path.join(f.sandbox, 'outside');
        fs.writeFileSync(target, 'outside\n');
        fs.rmSync(promoted.receiptPath);
        fs.symlinkSync(target, promoted.receiptPath);
      }
      if (unsafe === 'receipt-hardlink') {
        const target = path.join(f.sandbox, 'receipt-copy');
        fs.linkSync(promoted.receiptPath, target);
      }
      if (unsafe === 'release-symlink') {
        const file = path.join(f.paths.releases, promoted.releaseId, 'entry.js');
        const target = path.join(f.sandbox, 'outside-release');
        fs.writeFileSync(target, 'outside\n');
        fs.rmSync(file);
        fs.symlinkSync(target, file);
      }
      if (unsafe === 'release-hardlink') {
        const file = path.join(f.paths.releases, promoted.releaseId, 'entry.js');
        fs.linkSync(file, path.join(f.sandbox, 'release-hardlink'));
      }
      if (unsafe === 'absent') fs.renameSync(f.paths.productRoot, `${f.paths.productRoot}.moved`);
      expectCode(() => offboardProduct(f.paths, 'offboard-product'), 'OWNERSHIP_REFUSED');
      assert.equal(fs.existsSync(unsafe === 'absent' ? `${f.paths.productRoot}.moved` : f.paths.productRoot), true);
      if (unsafe === 'unknown-release') assert.equal(fs.existsSync(path.join(f.paths.releases, promoted.releaseId, 'entry.js')), true);
    });
  }
});

test('offboard preserves project declarations unless their exact receipt entry remains available', async (t) => {
  for (const state of ['exact', 'modified', 'moved', 'missing']) {
    await t.test(state, () => {
      const f = fixture('LazyTrae');
      const projectRoot = path.join(f.sandbox, 'registered project');
      const declarationPath = path.join(projectRoot, '.trae', 'mcp.json');
      fs.mkdirSync(path.dirname(declarationPath), { recursive: true });
      fs.writeFileSync(declarationPath, '{"mcpServers":{"lazytrae":{}}}\n');
      release(f, 'd', {
        registeredProjectDeclarations: [{
          project_root: projectRoot,
          path: '.trae/mcp.json',
          mode: '0644',
          managed_entry_sha256: crypto.createHash('sha256').update(fs.readFileSync(declarationPath)).digest('hex'),
          ownership_scope: 'managed-entry-only',
        }],
      });
      if (state === 'modified') fs.appendFileSync(declarationPath, '\n');
      if (state === 'moved') fs.renameSync(projectRoot, `${projectRoot}.moved`);
      if (state === 'missing') fs.rmSync(projectRoot, { recursive: true });
      if (state === 'exact') {
        offboardProduct(f.paths, 'offboard-product');
        assert.equal(fs.readFileSync(declarationPath, 'utf8'), '{"mcpServers":{"lazytrae":{}}}\n');
      } else {
        expectCode(() => offboardProduct(f.paths, 'offboard-product'), 'OWNERSHIP_REFUSED');
        assert.equal(fs.existsSync(f.paths.productRoot), true);
      }
    });
  }
});
