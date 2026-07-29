'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inventory } = require('../scripts/lifecycle/files');
const {
  LifecycleError,
  prepareProductRoot,
  resolveInstallRoot,
} = require('../scripts/lifecycle');

test('parses the Windows durable root fixture without claiming Windows host readiness', () => {
  // Given: a Windows LOCALAPPDATA value containing a space.
  const localAppData = 'C:\\Users\\Example Person\\AppData\\Local';

  // When: the platform fixture crosses the install-root boundary.
  const root = resolveInstallRoot({
    platform: 'win32',
    environment: { LOCALAPPDATA: localAppData },
  });

  // Then: Windows path semantics preserve the documented durable root.
  assert.equal(root, 'C:\\Users\\Example Person\\AppData\\Local\\LazySeries');
});

test('probes host case behavior and accepts a bounded long durable path', (t) => {
  // Given: a real host filesystem fixture with a bounded 180-character component.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazy lifecycle platform '));
  t.after(() => fs.rmSync(sandbox, { force: true, recursive: true }));
  const caseProbe = path.join(sandbox, 'CaseProbe');
  const boundedRoot = path.join(sandbox, 'x'.repeat(180));
  fs.mkdirSync(caseProbe);

  // When: case behavior is observed and the durable layout is prepared.
  const lowerCaseAliasExists = fs.existsSync(path.join(sandbox, 'caseprobe'));
  const paths = prepareProductRoot({ installRoot: boundedRoot, product: 'LazyBuddy' });

  // Then: the fixture follows this filesystem's case behavior and keeps the full bounded path.
  if (lowerCaseAliasExists) {
    const original = fs.statSync(caseProbe);
    const alias = fs.statSync(path.join(sandbox, 'caseprobe'));
    assert.deepEqual([alias.dev, alias.ino], [original.dev, original.ino]);
  } else {
    assert.equal(fs.existsSync(path.join(sandbox, 'caseprobe')), false);
  }
  assert.equal(paths.productRoot, path.join(boundedRoot, 'LazyBuddy'));
  assert.equal(fs.lstatSync(paths.productRoot).isDirectory(), true);
});

test('refuses POSIX symlink and hardlink inventory fixtures', {
  skip: process.platform === 'win32',
}, (t) => {
  // Given: separate source trees containing a symlink and a multiply linked file.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazy lifecycle links '));
  t.after(() => fs.rmSync(sandbox, { force: true, recursive: true }));
  const symlinkRoot = path.join(sandbox, 'symlink');
  const hardlinkRoot = path.join(sandbox, 'hardlink');
  fs.mkdirSync(symlinkRoot);
  fs.mkdirSync(hardlinkRoot);
  fs.writeFileSync(path.join(sandbox, 'target'), 'fixture\n');
  fs.symlinkSync(path.join(sandbox, 'target'), path.join(symlinkRoot, 'entry'));
  fs.writeFileSync(path.join(hardlinkRoot, 'entry'), 'fixture\n');
  fs.linkSync(path.join(hardlinkRoot, 'entry'), path.join(sandbox, 'linked-entry'));

  // When/Then: both linked ownership fixtures are refused at the observable inventory boundary.
  for (const root of [symlinkRoot, hardlinkRoot]) {
    assert.throws(
      () => inventory(root),
      (error) => error instanceof LifecycleError && error.code === 'OWNERSHIP_REFUSED',
    );
  }
});
