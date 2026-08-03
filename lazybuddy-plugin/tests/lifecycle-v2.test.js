'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LAUNCHER,
  LEGACY_LAUNCHER_V1,
  LifecycleError,
  offboardProduct,
  prepareProductRoot,
  promoteRelease,
  readActive,
  rollbackRelease,
  stageRelease,
} = require('../scripts/lifecycle');
const { normalizeReceipt, receiptFor } = require('../scripts/lifecycle/receipt');
const { normalizeActive } = require('../scripts/lifecycle/state');

const ORIGIN = 'https://github.com/elvinzhao10/LazyBuddy.git';

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy lifecycle v2 '));
  const sourceRoot = path.join(sandbox, 'source');
  fs.mkdirSync(sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{"version":"1.0.3"}\n');
  fs.writeFileSync(path.join(sourceRoot, 'entry.js'), "console.log('lifecycle-v2')\n");
  return {
    sandbox,
    sourceRoot,
    paths: prepareProductRoot({ installRoot: path.join(sandbox, 'install'), product: 'LazyBuddy' }),
  };
}

function promote(f, character) {
  const commitSha = character.repeat(40);
  return promoteRelease(f.paths, {
    ...stageRelease(f.paths, { sourceRoot: f.sourceRoot, version: '1.0.3', commitSha }),
    commitSha,
    entrypoint: 'entry.js',
    manifestRelativePath: 'package.json',
    origin: ORIGIN,
    runtimePath: process.execPath,
    version: '1.0.3',
  });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof LifecycleError && error.code === code);
}

function downgradeToV1(f, promoted) {
  const receipt = JSON.parse(fs.readFileSync(promoted.receiptPath, 'utf8'));
  receipt.$schema = 'lazy-harness-lifecycle.v1.schema.json';
  receipt.schema_version = 1;
  delete receipt.created_files_scope;
  fs.writeFileSync(promoted.receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  delete active.$schema;
  active.schema_version = 1;
  fs.writeFileSync(f.paths.active, JSON.stringify(active, null, 2) + '\n');
  fs.writeFileSync(f.paths.launcher, LEGACY_LAUNCHER_V1, { mode: 0o755 });
}

test('new lifecycle writers emit only v2 state and release-scoped receipts', () => {
  // Given: a clean product root and staged release.
  const f = fixture();

  // When: the release is promoted.
  const promoted = promote(f, 'a');
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(promoted.receiptPath, 'utf8'));

  // Then: both active artifacts are v2 and no receipt claims the shared launcher.
  assert.equal(active.schema_version, 2);
  assert.equal(active.$schema, 'lazy-harness-active.v2.schema.json');
  assert.equal(receipt.schema_version, 2);
  assert.equal(receipt.$schema, 'lazy-harness-lifecycle.v2.schema.json');
  assert.equal(receipt.created_files_scope, 'release-only');
  assert.equal(receipt.created_files.every((item) => item.path.startsWith(`releases/${promoted.releaseId}`)), true);
});

test('v1 normalizers preserve raw evidence and cover both historical created_files shapes', () => {
  // Given: equivalent v1 receipts with and without the historical Trae launcher claim.
  const f = fixture();
  const promoted = promote(f, 'a');
  downgradeToV1(f, promoted);
  const buddy = JSON.parse(fs.readFileSync(promoted.receiptPath, 'utf8'));
  const trae = structuredClone(buddy);
  trae.created_files.unshift({ path: 'launcher.js', type: 'file', mode: '0755', sha256: 'a'.repeat(64) });
  const buddyBefore = structuredClone(buddy);
  const traeBefore = structuredClone(trae);
  const tampered = structuredClone(buddy);
  tampered.created_files.unshift({ path: 'active.json', type: 'file', mode: '0600', sha256: 'b'.repeat(64) });

  // When: both historical shapes are normalized in memory.
  const normalizedBuddy = normalizeReceipt(f.paths, buddy);
  const normalizedTrae = normalizeReceipt(f.paths, trae);

  // Then: ownership inventories converge without mutating either v1 record.
  assert.deepEqual(normalizedTrae.created_files, normalizedBuddy.created_files);
  assert.deepEqual(buddy, buddyBefore);
  assert.deepEqual(trae, traeBefore);
  expectCode(() => normalizeReceipt(f.paths, tampered), 'OWNERSHIP_REFUSED');
});

test('mixed v1 and v2 releases boot, roll back, and offboard without rewriting v1 receipts', () => {
  // Given: a v1 release upgraded by the v2 writer.
  const f = fixture();
  const first = promote(f, 'a');
  downgradeToV1(f, first);
  const v1Bytes = fs.readFileSync(first.receiptPath);
  fs.writeFileSync(path.join(f.sourceRoot, 'entry.js'), "console.log('lifecycle-v2-upgrade')\n");
  promote(f, 'b');

  // When: the mixed install boots and rolls back to the legacy-owned release.
  const boot = require('node:child_process').execFileSync(process.execPath, [f.paths.launcher], { encoding: 'utf8' });
  const rolledBack = rollbackRelease(f.paths);

  // Then: state remains v2 while the original v1 receipt bytes remain immutable through offboard.
  assert.equal(boot.trim(), 'lifecycle-v2-upgrade');
  assert.equal(rolledBack.schema_version, 2);
  assert.deepEqual(fs.readFileSync(first.receiptPath), v1Bytes);
  offboardProduct(f.paths, 'offboard-product');
  assert.equal(fs.existsSync(f.paths.productRoot), false);
});

test('unknown and schema-tampered active or receipt versions refuse without mutation', () => {
  // Given: valid v2 state and receipt bytes.
  const f = fixture();
  const promoted = promote(f, 'a');
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(promoted.receiptPath, 'utf8'));

  // When/Then: unknown and mismatched version markers fail closed at each reader.
  for (const invalid of [{ ...active, schema_version: 3 }, { ...active, $schema: 'lazy-harness-active.v1.schema.json' }]) {
    fs.writeFileSync(f.paths.active, JSON.stringify(invalid, null, 2) + '\n');
    const before = fs.readFileSync(f.paths.active);
    expectCode(() => readActive(f.paths), 'MALFORMED_ACTIVE');
    assert.deepEqual(fs.readFileSync(f.paths.active), before);
  }
  fs.writeFileSync(f.paths.active, JSON.stringify(active, null, 2) + '\n');
  for (const invalid of [{ ...receipt, schema_version: 3 }, { ...receipt, $schema: 'lazy-harness-lifecycle.v1.schema.json' }]) {
    fs.writeFileSync(promoted.receiptPath, JSON.stringify(invalid, null, 2) + '\n');
    const before = fs.readFileSync(promoted.receiptPath);
    expectCode(() => receiptFor(f.paths, promoted.releaseId), 'OWNERSHIP_REFUSED');
    assert.deepEqual(fs.readFileSync(promoted.receiptPath), before);
  }
});

test('interrupted state promotion restores the prior launcher and retries cleanly', (t) => {
  // Given: a bootable v1 install and a staged v2 release.
  const f = fixture();
  const first = promote(f, 'a');
  downgradeToV1(f, first);
  const launcherBefore = fs.readFileSync(f.paths.launcher);
  const activeBefore = fs.readFileSync(f.paths.active);
  const renameSync = fs.renameSync;
  let interruptions = 2;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.paths.active && interruptions > 0) {
      interruptions -= 1;
      throw new Error('simulated state interruption');
    }
    return renameSync(source, target);
  });

  // When: launcher replacement succeeds but active-state promotion is interrupted.
  assert.throws(() => promote(f, 'b'), /simulated state interruption/);

  // Then: prior boot bytes are restored and a later retry can promote v2.
  assert.deepEqual(fs.readFileSync(f.paths.launcher), launcherBefore);
  assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);
  assert.throws(() => promote(f, 'b'), /simulated state interruption/);
  assert.deepEqual(fs.readFileSync(f.paths.launcher), launcherBefore);
  assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);
  t.mock.restoreAll();
  const retried = promote(f, 'b');
  assert.equal(JSON.parse(fs.readFileSync(f.paths.active, 'utf8')).schema_version, 2);
  assert.equal(fs.readFileSync(f.paths.launcher, 'utf8'), LAUNCHER);
  assert.equal(fs.existsSync(retried.receiptPath), true);
});

test('v1-only and v2-only launcher states remain bootable', () => {
  // Given: one promoted release represented as v1 and then v2 active state.
  const f = fixture();
  const promoted = promote(f, 'a');
  downgradeToV1(f, promoted);

  // When: the legacy launcher boots v1, then the dual-reader launcher boots normalized v2.
  const v1Boot = require('node:child_process').spawnSync(process.execPath, [f.paths.launcher]);
  fs.writeFileSync(f.paths.launcher, LAUNCHER, { mode: 0o755 });
  const normalized = normalizeActive(f.paths, JSON.parse(fs.readFileSync(f.paths.active, 'utf8')));
  normalized.updated_at = new Date().toISOString();
  fs.writeFileSync(f.paths.active, JSON.stringify(normalized, null, 2) + '\n');
  const v2Boot = require('node:child_process').spawnSync(process.execPath, [f.paths.launcher]);

  // Then: both paths exit successfully.
  assert.equal(v1Boot.status, 0, v1Boot.stderr.toString());
  assert.equal(v2Boot.status, 0, v2Boot.stderr.toString());
});
