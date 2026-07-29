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
  bootstrapRelease,
  parseOfficialSource,
  prepareProductRoot,
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
  fs.writeFileSync(path.join(packageRoot, '.codebuddy-plugin', 'plugin.json'), '{"name":"lazybuddy","version":"1.0.3"}\n');
  fs.writeFileSync(path.join(packageRoot, '.workbuddy-plugin', 'plugin.json'), '{"name":"lazybuddy","version":"1.0.3"}\n');
  fs.writeFileSync(path.join(packageRoot, 'scripts', 'lifecycle.js'), "console.log('fixture-launch-ok')\n");
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
  git(source, ['tag', 'v1.0.3']);
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

test('parses only canonical official HTTPS source forms for the selected product', () => {
  const accepted = [
    ['https://github.com/elvinzhao10/LazyBuddy', 'v1.0.3'],
    ['https://github.com/elvinzhao10/LazyBuddy.git', 'v1.0.3'],
    ['https://github.com/elvinzhao10/LazyBuddy/tree/release/v1.0.3', 'release/v1.0.3'],
  ];
  const rejected = [
    'http://github.com/elvinzhao10/LazyBuddy',
    'https://github.com/elvinzhao10/LazyBuddy/',
    'https://github.com/elvinzhao10/LazyBuddy?ref=v1.0.3',
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
    version: '1.0.3',
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout.trim(), 'fixture-launch-ok');
  assert.match(result.prerequisites.git, /^git version /);
  assert.match(result.prerequisites.node, /^v\d+\./);
});

test('repo, tag, branch, and full-SHA sources resolve through Git to the same immutable commit', () => {
  const sources = [
    'https://github.com/elvinzhao10/LazyBuddy',
    'https://github.com/elvinzhao10/LazyBuddy/tree/v1.0.3',
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
  fs.appendFileSync(path.join(f.source, 'lazybuddy-plugin', 'scripts', 'lifecycle.js'), "// v2\n");
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

test('dirty source bytes, local transport bypass, and mismatched confirmations fail closed', () => {
  const f = fixture();
  const entrypoint = path.join(f.source, 'lazybuddy-plugin/scripts/lifecycle.js');
  fs.writeFileSync(entrypoint, "console.log('dirty-untrusted')\n");
  const clean = bootstrap(f);
  const installed = path.join(f.paths.releases, clean.release_id, 'lazybuddy-plugin/scripts/lifecycle.js');
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
