'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LifecycleError,
  offboardProduct,
  prepareProductRoot,
  promoteRelease,
  stageRelease,
} = require('../scripts/lifecycle');

const MATRIX = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'contracts', 'fixtures', 'lifecycle-v2', 'upgrade-ownership.json',
), 'utf8'));

test('upgrade ownership fixture covers the required lifecycle and preservation matrix', () => {
  assert.deepEqual(MATRIX.sequence, ['install', 'upgrade', 'soft_offboard', 'reinstall', 'receipt_owned_uninstall']);
  assert.deepEqual(new Set(MATRIX.preserve), new Set([
    'foreign_mcp_entry', 'unrelated_host_settings', 'soft_state',
    'modified_owned_file', 'unknown_file', 'sibling_product_root',
  ]));
});

function lifecycleFixture(t) {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy v120 ownership '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const sourceRoot = path.join(sandbox, 'source');
  fs.mkdirSync(sourceRoot);
  return {
    paths: prepareProductRoot({ installRoot: path.join(sandbox, 'install'), product: MATRIX.product }),
    sandbox,
    sourceRoot,
  };
}

function promote(fixture, version, marker) {
  fs.writeFileSync(path.join(fixture.sourceRoot, 'package.json'), `${JSON.stringify({ version })}\n`);
  fs.writeFileSync(path.join(fixture.sourceRoot, 'entry.js'), `console.log(${JSON.stringify(version)})\n`);
  const commitSha = marker.repeat(40);
  const staged = stageRelease(fixture.paths, { sourceRoot: fixture.sourceRoot, version, commitSha });
  return promoteRelease(fixture.paths, {
    ...staged,
    commitSha,
    entrypoint: 'entry.js',
    manifestRelativePath: 'package.json',
    origin: 'https://github.com/elvinzhao10/LazyBuddy.git',
    runtimePath: process.execPath,
    version,
  });
}

function expectOwnershipRefusal(action, state) {
  assert.throws(action, (error) => (
    error instanceof LifecycleError && error.code === MATRIX.refusals[state]
  ));
}

test('v1.1 install upgrades to v1.2, soft-offboards, reinstalls, and removes only LazyBuddy', (t) => {
  const fixture = lifecycleFixture(t);
  const first = promote(fixture, MATRIX.from_version, 'a');
  const second = promote(fixture, MATRIX.to_version, 'b');
  const sibling = prepareProductRoot({ installRoot: fixture.paths.installRoot, product: 'LazyTrae' });
  const siblingSentinel = path.join(sibling.productRoot, 'caller-owned');
  const settings = path.join(fixture.sandbox, 'codebuddy-settings.json');
  const softState = path.join(fixture.sandbox, '.codebuddy-state');
  fs.writeFileSync(siblingSentinel, 'sibling\n');
  fs.writeFileSync(settings, '{"mcpServers":{"foreign":{}}}\n');
  fs.writeFileSync(softState, 'preserve\n');

  assert.equal(JSON.parse(fs.readFileSync(fixture.paths.active)).active_release, second.releaseId);
  assert.equal(fs.existsSync(first.receiptPath), true);
  offboardProduct(fixture.paths, 'offboard-product');
  assert.equal(fs.readFileSync(siblingSentinel, 'utf8'), 'sibling\n');
  assert.equal(fs.readFileSync(settings, 'utf8'), '{"mcpServers":{"foreign":{}}}\n');
  assert.equal(fs.readFileSync(softState, 'utf8'), 'preserve\n');

  fixture.paths = prepareProductRoot({ installRoot: fixture.paths.installRoot, product: MATRIX.product });
  promote(fixture, MATRIX.to_version, 'c');
  offboardProduct(fixture.paths, 'offboard-product');
  assert.equal(fs.existsSync(fixture.paths.productRoot), false);
});

test('v1.2 offboard reports modified, unknown, mismatched, and cross-product state without deletion', async (t) => {
  for (const state of ['modified_owned_file', 'unknown_file', 'mismatched_receipt', 'cross_product_root']) {
    await t.test(state, () => {
      const fixture = lifecycleFixture(t);
      const installed = promote(fixture, MATRIX.to_version, 'd');
      if (state === 'modified_owned_file') {
        fs.appendFileSync(path.join(fixture.paths.releases, installed.releaseId, 'entry.js'), '// caller change\n');
      } else if (state === 'unknown_file') {
        fs.writeFileSync(path.join(fixture.paths.productRoot, 'unknown'), 'caller\n');
      } else if (state === 'mismatched_receipt') {
        const receipt = JSON.parse(fs.readFileSync(installed.receiptPath, 'utf8'));
        receipt.product = 'LazyTrae';
        fs.writeFileSync(installed.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      } else {
        fixture.paths.product = 'LazyTrae';
      }
      expectOwnershipRefusal(() => offboardProduct(fixture.paths, 'offboard-product'), state);
      assert.equal(fs.existsSync(fixture.paths.productRoot), true);
    });
  }
});

test('removal documentation separates CodeBuddy package, daemon, and optional state scopes', () => {
  const removal = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '08-safe-removal.md'), 'utf8');
  assert.match(removal, /CodeBuddy Code package removal/);
  assert.match(removal, /codebuddy daemon uninstall/);
  assert.match(removal, /does not remove the CodeBuddy Code package/);
  assert.match(removal, /optional state cleanup/);
});
