'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = childProcess;
const test = require('node:test');
const {
  LifecycleError,
  bootstrapProduct,
  bootstrapRelease,
  parseOfficialSource,
  prepareBootstrapProductRoot,
  prepareProductRoot,
  productPaths,
  quarantineEmptyProductRoot,
} = require('../scripts/lifecycle');

const OFFICIAL = 'https://github.com/elvinzhao10/LazyBuddy.git';
const FIXTURE_CONTRACTS = path.resolve(__dirname, '..', 'contracts');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeFixtureFiles(root, selfTest = "process.stdout.write('self-test-ok\\n');\n") {
  const packageRoot = path.join(root, 'lazybuddy-plugin');
  const contracts = path.join(packageRoot, 'contracts');
  fs.mkdirSync(path.join(packageRoot, '.codebuddy-plugin'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, '.workbuddy-plugin'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(contracts, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, '.codebuddy-plugin', 'plugin.json'), '{"name":"lazybuddy","version":"1.2.1"}\n');
  fs.writeFileSync(path.join(packageRoot, '.workbuddy-plugin', 'plugin.json'), '{"name":"lazybuddy","version":"1.2.1"}\n');
  fs.writeFileSync(path.join(packageRoot, 'scripts', 'lazybuddy-lifecycle.js'), "console.log('fixture-launch-ok')\n");
  fs.writeFileSync(path.join(packageRoot, 'scripts', 'lifecycle-self-test.js'), selfTest);
  for (const name of ['lazy-harness-lifecycle.v1.schema.json', 'lazy-harness-lifecycle.v1.example.json']) {
    const bytes = fs.readFileSync(path.join(FIXTURE_CONTRACTS, name));
    fs.writeFileSync(path.join(contracts, name), bytes);
    fs.writeFileSync(
      path.join(contracts, `${name}.sha256`),
      `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
    );
  }
}

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy bootstrap '));
  const remote = path.join(sandbox, 'official fixture.git');
  const source = path.join(sandbox, 'source');
  fs.mkdirSync(source);
  git(source, ['init']);
  git(source, ['config', 'user.email', 'fixture@example.invalid']);
  git(source, ['config', 'user.name', 'Lifecycle Fixture']);
  writeFixtureFiles(source);
  git(source, ['add', 'lazybuddy-plugin']);
  git(source, ['commit', '-m', 'fixture v1']);
  git(source, ['branch', '-M', 'main']);
  git(source, ['tag', 'v1.2.1']);
  git(sandbox, ['clone', '--bare', source, remote]);
  return {
    paths: prepareProductRoot({ installRoot: path.join(sandbox, 'durable root'), product: 'LazyBuddy' }),
    remote,
    sandbox,
    source,
  };
}

function bootstrap(f, overrides = {}) {
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => realSpawnSync(
    command,
    args.map((arg) => arg === OFFICIAL ? f.remote : arg),
    options,
  );
  try {
    return bootstrapRelease(f.paths, {
      sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
      ...overrides,
    });
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof LifecycleError && error.code === code);
}

function exactScaffold(root) {
  for (const directory of ['releases', 'receipts', 'staging', 'locks', 'rollback']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
}

function identity(target) {
  const stat = fs.lstatSync(target);
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode, nlink: stat.nlink };
}

function treeSnapshot(root) {
  const entries = [];
  const visit = (target, relative = '') => {
    const stat = fs.lstatSync(target);
    entries.push({
      relative,
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      nlink: stat.nlink,
      sha256: stat.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null,
    });
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) visit(path.join(target, name), path.join(relative, name));
    }
  };
  visit(root);
  return entries;
}

test('parses only canonical official HTTPS source forms for the selected product', () => {
  const accepted = [
    ['https://github.com/elvinzhao10/LazyBuddy', 'v1.2.1'],
    ['https://github.com/elvinzhao10/LazyBuddy.git', 'v1.2.1'],
    ['https://github.com/elvinzhao10/LazyBuddy/tree/release/v1.2.1', 'release/v1.2.1'],
  ];
  const rejected = [
    'http://github.com/elvinzhao10/LazyBuddy',
    'https://github.com/elvinzhao10/LazyBuddy/',
    'https://github.com/elvinzhao10/LazyBuddy?ref=v1.2.1',
    'https://github.com/elvinzhao10/LazyBuddy#readme',
    'https://user@github.com/elvinzhao10/LazyBuddy',
    'https://github.com:443/elvinzhao10/LazyBuddy',
    'https://github.com/elvinzhao10/LazyTrae',
    'https://github.com/private/LazyBuddy',
    'git@github.com:elvinzhao10/LazyBuddy.git',
    '/tmp/LazyBuddy',
    'https://github.com/elvinzhao10/LazyBuddy/tree/../../main',
    'https://github.com/elvinzhao10/LazyBuddy\n--upload-pack=owned',
  ];
  for (const [input, ref] of accepted) {
    assert.deepEqual(parseOfficialSource(input, 'LazyBuddy'), {
      canonicalOrigin: OFFICIAL,
      product: 'LazyBuddy',
      ref,
      repository: 'elvinzhao10/LazyBuddy',
    });
  }
  for (const input of rejected) expectCode(() => parseOfficialSource(input, 'LazyBuddy'), 'INVALID_ORIGIN');
});

test('resolves, verifies, self-tests, and promotes a local fixture under an official identity', () => {
  const f = fixture();
  const expectedSha = git(f.source, ['rev-parse', 'HEAD']);
  const result = bootstrap(f);
  fs.rmSync(f.source, { recursive: true });
  fs.rmSync(f.remote, { recursive: true });
  const launched = spawnSync(process.execPath, [f.paths.launcher], { encoding: 'utf8' });
  assert.deepEqual({
    canonical_origin: result.canonical_origin,
    commit_sha: result.commit_sha,
    status: result.status,
    test_status: result.test.status,
    version: result.version,
  }, {
    canonical_origin: OFFICIAL,
    commit_sha: expectedSha,
    status: 'ready',
    test_status: 'passed',
    version: '1.2.1',
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout.trim(), 'fixture-launch-ok');
  assert.match(result.prerequisites.git, /^git version /);
  assert.match(result.prerequisites.node, /^v\d+\./);
});

test('repo, tag, branch, and full-SHA sources resolve through Git to the same immutable commit', () => {
  const sources = [
    'https://github.com/elvinzhao10/LazyBuddy',
    'https://github.com/elvinzhao10/LazyBuddy/tree/v1.2.1',
    'https://github.com/elvinzhao10/LazyBuddy/tree/main',
  ];
  for (const sourceUrl of sources) {
    const f = fixture();
    const expectedSha = git(f.source, ['rev-parse', 'HEAD']);
    assert.equal(bootstrap(f, { sourceUrl }).commit_sha, expectedSha);
  }
  const f = fixture();
  const expectedSha = git(f.source, ['rev-parse', 'HEAD']);
  assert.equal(bootstrap(f, {
    sourceUrl: `https://github.com/elvinzhao10/LazyBuddy/tree/${expectedSha}`,
  }).commit_sha, expectedSha);
});

test('same version at a different SHA requires an exact revision confirmation', () => {
  const f = fixture();
  const first = bootstrap(f);
  fs.appendFileSync(path.join(f.source, 'lazybuddy-plugin', 'scripts', 'lazybuddy-lifecycle.js'), "// v2\n");
  git(f.source, ['add', 'lazybuddy-plugin']);
  git(f.source, ['commit', '-m', 'fixture v2']);
  git(f.source, ['push', '--force', f.remote, 'main']);
  const secondSha = git(f.source, ['rev-parse', 'HEAD']);
  const activeBefore = fs.readFileSync(f.paths.active);
  const pending = bootstrap(f);
  assert.equal(pending.status, 'revision_confirmation_required');
  assert.equal(pending.required_confirmation, secondSha);
  assert.equal(pending.test.status, 'not_run');
  assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);
  const promoted = bootstrap(f, { confirmRevision: secondSha });
  assert.equal(promoted.status, 'ready');
  assert.equal(promoted.commit_sha, secondSha);
  assert.notEqual(promoted.release_id, first.release_id);
});

test('manifest, checksum, self-test, prerequisite, and clone failures preserve active state', async (t) => {
  for (const scenario of [
    ['missing manifest', (f) => fs.rmSync(path.join(f.source, 'lazybuddy-plugin/.codebuddy-plugin/plugin.json')), 'INVALID_MANIFEST'],
    ['host manifest mismatch', (f) => fs.writeFileSync(path.join(f.source, 'lazybuddy-plugin/.workbuddy-plugin/plugin.json'), '{"name":"lazybuddy","version":"1.0.2"}\n'), 'INVALID_MANIFEST'],
    ['bad checksum', (f) => fs.writeFileSync(path.join(f.source, 'lazybuddy-plugin/contracts/lazy-harness-lifecycle.v1.schema.json.sha256'), `${'0'.repeat(64)}  lazy-harness-lifecycle.v1.schema.json\n`), 'CHECKSUM_MISMATCH'],
    ['misleading self-test success', (f) => fs.writeFileSync(path.join(f.source, 'lazybuddy-plugin/scripts/lifecycle-self-test.js'), "console.log('PASS'); process.exit(7);\n"), 'SELF_TEST_FAILED'],
  ]) {
    await t.test(scenario[0], () => {
      const f = fixture();
      const first = bootstrap(f);
      fs.appendFileSync(path.join(f.source, 'README.md'), 'second revision\n');
      scenario[1](f);
      git(f.source, ['add', '.']);
      git(f.source, ['commit', '-m', scenario[0]]);
      git(f.source, ['push', '--force', f.remote, 'main']);
      const activeBefore = fs.readFileSync(f.paths.active);
      expectCode(() => bootstrap(f, { confirmRevision: git(f.source, ['rev-parse', 'HEAD']) }), scenario[2]);
      assert.deepEqual(fs.readFileSync(f.paths.active), activeBefore);
      assert.equal(JSON.parse(activeBefore).active_release, first.release_id);
      assert.deepEqual(fs.readdirSync(f.paths.staging), []);
    });
  }

  await t.test('missing Git', () => {
    const f = fixture();
    expectCode(() => bootstrap(f, { gitPath: path.join(f.sandbox, 'missing-git') }), 'PREREQUISITE_MISSING');
    assert.equal(fs.existsSync(f.paths.active), false);
  });

  await t.test('missing Node', () => {
    const f = fixture();
    expectCode(() => bootstrap(f, { runtimePath: path.join(f.sandbox, 'missing-node') }), 'PREREQUISITE_MISSING');
    assert.equal(fs.existsSync(f.paths.active), false);
  });

  await t.test('failed clone', () => {
    const f = fixture();
    fs.rmSync(f.remote, { recursive: true });
    expectCode(() => bootstrap(f), 'GIT_FAILED');
    assert.equal(fs.existsSync(f.paths.active), false);
    assert.deepEqual(fs.readdirSync(f.paths.staging), []);
  });

  for (const [name, source] of [
    ['hung self-test', 'setInterval(() => {}, 1000);\n'],
    ['interrupted self-test', "process.kill(process.pid, 'SIGTERM');\n"],
  ]) {
    await t.test(name, () => {
      const f = fixture();
      fs.writeFileSync(path.join(f.source, 'lazybuddy-plugin/scripts/lifecycle-self-test.js'), source);
      git(f.source, ['add', '.']);
      git(f.source, ['commit', '-m', name]);
      git(f.source, ['push', '--force', f.remote, 'main']);
      expectCode(() => bootstrap(f, { timeoutMs: 1_000 }), 'SELF_TEST_FAILED');
      assert.equal(fs.existsSync(f.paths.active), false);
      assert.deepEqual(fs.readdirSync(f.paths.staging), []);
    });
  }
});

test('failed fresh bootstrap leaves a reusable scaffold for a later successful bootstrap', () => {
  const f = fixture();
  fs.rmSync(f.paths.productRoot, { recursive: true });
  const missingGit = path.join(f.sandbox, 'missing-git');
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => realSpawnSync(
    command,
    args.map((arg) => arg === OFFICIAL ? f.remote : arg),
    options,
  );
  let laterResult;
  try {
    // When: missing-Git failure cleanup overlaps the second real bootstrap.
    expectCode(() => bootstrapProduct(f.paths, 'onboard', {
      gitPath: missingGit,
      sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    }), 'PREREQUISITE_MISSING');
    laterResult = bootstrapProduct(f.paths, 'onboard', {
      sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    });
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }

  // Then: fail-closed preservation remains reusable without hidden cleanup roots.
  assert.equal(laterResult.status, 'ready');
  assert.equal(fs.existsSync(f.paths.active), true);
  assert.equal(fs.existsSync(f.paths.launcher), true);
  assert.deepEqual(fs.readdirSync(f.paths.installRoot).filter((entry) => entry.startsWith('.LazyBuddy-')), []);
});

test('failed bootstrap preserves a caller replacement installed before creator ownership capture', (t) => {
  const f = fixture();
  fs.rmSync(f.paths.productRoot, { recursive: true });
  const caller = path.join(f.sandbox, 'capture caller');
  exactScaffold(caller);
  const callerIdentity = identity(caller);
  const realMkdtempSync = fs.mkdtempSync;
  const realMkdirSync = fs.mkdirSync;
  const realRenameSync = fs.renameSync;
  let callerTarget;
  const replace = (target) => {
    fs.rmSync(target, { recursive: true, force: true });
    realRenameSync(caller, target);
    callerTarget = target;
  };
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const created = realMkdtempSync(...args);
    if (!callerTarget && path.basename(created).startsWith('.LazyBuddy-bootstrap-')) replace(created);
    return created;
  });
  t.mock.method(fs, 'mkdirSync', (target, ...args) => {
    const result = realMkdirSync(target, ...args);
    if (!callerTarget && target === f.paths.productRoot) replace(target);
    return result;
  });

  expectCode(() => bootstrapProduct(f.paths, 'onboard', {
    gitPath: path.join(f.sandbox, 'missing-git'),
    sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
  }), 'PREREQUISITE_MISSING');

  assert.ok(callerTarget, 'test seam did not install the caller root');
  assert.deepEqual(identity(callerTarget), callerIdentity);
});

test('post-lock root replacement stops before bootstrap descendants and remains exact', (t) => {
  // Given: a creator lock and a caller tree swapped after the final preparation identity read.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));
  fs.rmSync(f.paths.productRoot, { recursive: true });
  const caller = path.join(f.sandbox, 'late caller');
  exactScaffold(caller);
  fs.writeFileSync(path.join(caller, 'sentinel.txt'), 'caller-owned\n');
  const expectedTree = treeSnapshot(caller);
  const realLstatSync = fs.lstatSync;
  const realRenameSync = fs.renameSync;
  const realSpawnSync = childProcess.spawnSync;
  let rootReadsAfterLock = 0;
  let replacementRootReads = 0;
  let swapped = false;
  let spawnCountAfterSwap = 0;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    const stat = realLstatSync(target, ...args);
    if (swapped && target === f.paths.productRoot) replacementRootReads += 1;
    if (!swapped && target === f.paths.productRoot && fs.existsSync(f.paths.bootstrapLock)) {
      rootReadsAfterLock += 1;
      if (rootReadsAfterLock === 7) {
        fs.rmSync(f.paths.productRoot, { recursive: true });
        realRenameSync(caller, f.paths.productRoot);
        swapped = true;
      }
    }
    return stat;
  });
  t.mock.method(childProcess, 'spawnSync', (...args) => {
    if (swapped) spawnCountAfterSwap += 1;
    return realSpawnSync(...args);
  });

  // When: bootstrap reaches the post-lock boundary.
  let error;
  try {
    bootstrapProduct(f.paths, 'onboard', {
      gitPath: path.join(f.sandbox, 'missing-git'),
      sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    });
  } catch (caught) {
    error = caught;
  }

  // Then: preservation is primary, no later command runs, and the caller tree is identity-exact.
  assert.deepEqual({
    code: error && error.code,
    preservation: error && error.preservation,
    replacementRootReads,
    spawnCountAfterSwap,
    swapped,
    tree: treeSnapshot(f.paths.productRoot),
  }, {
    code: 'WORKSPACE_PRESERVED',
    preservation: {
      status: 'recovery_required',
      public_workspace: f.paths.productRoot,
      retained_artifacts: [
        { kind: 'lifecycle_lock', last_known_path: f.paths.bootstrapLock },
      ],
    },
    replacementRootReads: 1,
    spawnCountAfterSwap: 0,
    swapped: true,
    tree: expectedTree,
  });
});

test('lock-acquisition collision retains the private lock without touching replacement descendants', (t) => {
  // Given: a caller root ready to replace the creator immediately after the private lock write.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));
  fs.rmSync(f.paths.productRoot, { recursive: true });
  const caller = path.join(f.sandbox, 'copied lock caller');
  exactScaffold(caller);
  fs.writeFileSync(path.join(caller, 'sentinel.txt'), 'caller-owned\n');
  const realFsyncSync = fs.fsyncSync;
  const realRenameSync = fs.renameSync;
  let expectedTree;
  const descendantAccesses = [];
  let monitorDescendants = false;
  let swapped = false;
  const realLstatSync = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (monitorDescendants && typeof target === 'string' && target.startsWith(`${f.paths.productRoot}${path.sep}`)) {
      descendantAccesses.push(target);
    }
    return realLstatSync(target, ...args);
  });
  t.mock.method(fs, 'fsyncSync', (descriptor) => {
    const result = realFsyncSync(descriptor);
    if (!swapped && fs.existsSync(f.paths.bootstrapLock)) {
      fs.rmSync(f.paths.productRoot, { recursive: true });
      realRenameSync(caller, f.paths.productRoot);
      expectedTree = treeSnapshot(f.paths.productRoot);
      swapped = true;
      monitorDescendants = true;
    }
    return result;
  });

  // When: lock acquisition detects that the public root identity changed.
  let error;
  try {
    bootstrapProduct(f.paths, 'onboard', {
      gitPath: path.join(f.sandbox, 'missing-git'),
      sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    });
  } catch (caught) {
    error = caught;
  }

  // Then: root identity loss is recoverable and no descendant of the caller root is accessed.
  monitorDescendants = false;
  assert.deepEqual({
    code: error && error.code,
    descendantAccesses,
    preservation: error && error.preservation,
    swapped,
    tree: treeSnapshot(f.paths.productRoot),
  }, {
    code: 'WORKSPACE_PRESERVED',
    descendantAccesses: [],
    preservation: {
      status: 'recovery_required',
      public_workspace: f.paths.productRoot,
      retained_artifacts: [
        { kind: 'lifecycle_lock', last_known_path: f.paths.bootstrapLock },
      ],
    },
    swapped: true,
    tree: expectedTree,
  });
});

test('bootstrap refuses an exact-empty caller product root without changing it', (t) => {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy empty caller '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const installRoot = path.join(sandbox, 'install root');
  const paths = productPaths({ installRoot, product: 'LazyBuddy' });
  fs.mkdirSync(paths.productRoot, { recursive: true });
  const before = identity(paths.productRoot);

  expectCode(() => prepareBootstrapProductRoot({ installRoot, product: 'LazyBuddy', timeoutMs: 50 }), 'WORKSPACE_PRESERVED');

  assert.deepEqual(identity(paths.productRoot), before);
  assert.deepEqual(fs.readdirSync(paths.productRoot), []);
});

test('cleanup never relocates either caller when a second caller occupies the public root', (t) => {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy two callers '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const paths = productPaths({ installRoot: sandbox, product: 'LazyBuddy' });
  exactScaffold(paths.productRoot);
  fs.writeFileSync(paths.lock, '{}');
  const ownership = identity(paths.productRoot);
  const callerA = path.join(sandbox, 'caller-a');
  const callerB = path.join(sandbox, 'caller-b');
  exactScaffold(callerA);
  exactScaffold(callerB);
  const callerAIdentity = identity(callerA);
  const callerBIdentity = identity(callerB);
  const realRenameSync = fs.renameSync;
  let injected = false;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (!injected && source === paths.productRoot && path.basename(target).startsWith('.LazyBuddy-cleanup-')) {
      injected = true;
      fs.rmSync(source, { recursive: true });
      realRenameSync(callerA, source);
      realRenameSync(source, target);
      realRenameSync(callerB, source);
      return;
    }
    return realRenameSync(source, target);
  });

  assert.equal(quarantineEmptyProductRoot(paths, ownership), null);
  assert.equal(injected, false, 'cleanup attempted to relocate a public root');
  assert.deepEqual(identity(callerA), callerAIdentity);
  assert.deepEqual(identity(callerB), callerBIdentity);
  assert.deepEqual(identity(paths.productRoot), ownership);
  assert.deepEqual(fs.readdirSync(sandbox).filter((entry) => entry.startsWith('.LazyBuddy-cleanup-')), []);
});

test('bootstrap preparation collision retry is bounded by its timeout', (t) => {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy collision timeout '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const modulePath = require.resolve('../scripts/lifecycle');
  const program = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const realMkdirSync = fs.mkdirSync;
const realRenameSync = fs.renameSync;
const root = process.argv[1];
fs.mkdirSync = (target, ...args) => {
  if (target === path.join(root, 'LazyBuddy')) { const error = new Error('collision'); error.code = 'EEXIST'; throw error; }
  return realMkdirSync(target, ...args);
};
fs.renameSync = (source, target) => {
  if (target === path.join(root, 'LazyBuddy')) { const error = new Error('collision'); error.code = 'EEXIST'; throw error; }
  return realRenameSync(source, target);
};
try {
  require(${JSON.stringify(modulePath)}).prepareBootstrapProductRoot({ installRoot: root, product: 'LazyBuddy', timeoutMs: 40 });
  process.exitCode = 2;
} catch (error) {
  process.stdout.write(String(error.code));
  process.exitCode = error.code === 'LOCKED' ? 0 : 3;
}`;

  const result = spawnSync(process.execPath, ['-e', program, path.join(sandbox, 'install root')], {
    encoding: 'utf8',
    timeout: 500,
  });
  assert.equal(result.status, 0, result.error ? result.error.message : result.stderr);
  assert.equal(result.stdout, 'LOCKED');
});

test('dirty source bytes, local transport bypass, and mismatched confirmations fail closed', () => {
  const f = fixture();
  const entrypoint = path.join(f.source, 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js');
  fs.writeFileSync(entrypoint, "console.log('dirty-untrusted')\n");
  const clean = bootstrap(f);
  const installed = path.join(f.paths.releases, clean.release_id, 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js');
  assert.doesNotMatch(fs.readFileSync(installed, 'utf8'), /dirty-untrusted/);
  const bypass = fixture();
  expectCode(() => bootstrapRelease(bypass.paths, {
    sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    transportRemote: bypass.remote,
  }), 'INVALID_ORIGIN');
  fs.appendFileSync(path.join(bypass.source, 'README.md'), 'new revision\n');
  git(bypass.source, ['add', '.']);
  git(bypass.source, ['commit', '-m', 'new revision']);
  git(bypass.source, ['push', '--force', bypass.remote, 'main']);
  expectCode(() => bootstrap(bypass, { confirmRevision: 'f'.repeat(40) }), 'REVISION_CONFIRMATION_MISMATCH');
  assert.equal(fs.existsSync(bypass.paths.active), false);
});

test('exported bootstrap rejects caller-enabled local transport before Git access', () => {
  const f = fixture();
  const marker = path.join(f.sandbox, 'git-accessed');
  const gitPath = path.join(f.sandbox, 'hostile-git');
  fs.writeFileSync(gitPath, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'accessed\\n');\n`, {
    mode: 0o755,
  });
  expectCode(() => bootstrapRelease(f.paths, {
    allowLocalFixture: true,
    gitPath,
    sourceUrl: 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    transportRemote: f.remote,
  }), 'INVALID_ORIGIN');
  assert.equal(fs.existsSync(marker), false);
});

test('a mutable ref changing after resolution is rejected before package verification', () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.source, 'README.md'), 'moved revision\n');
  git(f.source, ['add', '.']);
  git(f.source, ['commit', '-m', 'moved revision']);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const shim = path.join(f.sandbox, 'git shim');
  fs.writeFileSync(shim, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realGit)}, args, { encoding: 'utf8' });
if (args.includes('ls-remote') && args.includes('--tags')) {
  spawnSync(${JSON.stringify(realGit)}, ['-C', ${JSON.stringify(f.source)}, 'push', '--force', ${JSON.stringify(f.remote)}, 'main']);
}
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status === null ? 1 : result.status);
`, { mode: 0o755 });
  expectCode(() => bootstrap(f, { gitPath: shim }), 'REVISION_CHANGED');
  assert.equal(fs.existsSync(f.paths.active), false);
  assert.deepEqual(fs.readdirSync(f.paths.staging), []);
});
