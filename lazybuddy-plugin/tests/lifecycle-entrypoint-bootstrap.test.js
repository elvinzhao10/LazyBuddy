'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-lifecycle.js');
const OFFICIAL = 'https://github.com/elvinzhao10/LazyBuddy.git';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy lifecycle bootstrap cli '));
  const source = path.join(sandbox, 'source');
  const remote = path.join(sandbox, 'official.git');
  const packageRoot = path.join(source, 'lazybuddy-plugin');
  const scripts = path.join(packageRoot, 'scripts');
  const shimRoot = path.join(sandbox, 'node-only-bin');
  fs.mkdirSync(path.join(packageRoot, '.codebuddy-plugin'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, '.workbuddy-plugin'), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(shimRoot);
  fs.cpSync(path.join(PLUGIN_ROOT, 'scripts', 'lifecycle'), path.join(scripts, 'lifecycle'), { recursive: true });
  for (const name of ['lazybuddy-lifecycle.js', 'lifecycle-self-test.js']) {
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', name), path.join(scripts, name));
  }
  for (const host of ['.codebuddy-plugin', '.workbuddy-plugin']) {
    fs.copyFileSync(path.join(PLUGIN_ROOT, host, 'plugin.json'), path.join(packageRoot, host, 'plugin.json'));
  }
  fs.cpSync(path.join(PLUGIN_ROOT, 'contracts'), path.join(packageRoot, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'README.md'), 'first\n');
  git(source, ['init']);
  git(source, ['config', 'user.email', 'fixture@example.invalid']);
  git(source, ['config', 'user.name', 'Lifecycle Fixture']);
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'first']);
  git(source, ['branch', '-M', 'main']);
  git(sandbox, ['clone', '--bare', source, remote]);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(shimRoot, 'git'), `#!${process.execPath}
'use strict';
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2).map((value) => value === ${JSON.stringify(OFFICIAL)} ? ${JSON.stringify(remote)} : value);
const result = spawnSync(${JSON.stringify(realGit)}, args, { encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status === null ? 1 : result.status);
`, { mode: 0o755 });
  return {
    installRoot: path.join(sandbox, 'install root'),
    projectRoot: source,
    remote,
    sandbox,
    shimRoot,
    source,
  };
}

function run(f, command, extra = []) {
  const result = spawnSync(process.execPath, [
    CLI,
    command,
    '--install-root', f.installRoot,
    '--project', f.projectRoot,
    '--json',
    '--source', 'https://github.com/elvinzhao10/LazyBuddy/tree/main',
    ...extra,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: f.shimRoot },
  });
  return { ...result, output: JSON.parse(result.stdout) };
}

async function waitForPath(target, timeoutMs = 5_000) {
  const started = Date.now();
  while (!fs.existsSync(target)) {
    if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for ${target}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function startOnboard({ environment, installRoot, projectRoot }) {
  const child = spawn(process.execPath, [
    CLI, 'onboard', '--source', OFFICIAL,
    '--install-root', installRoot, '--project', projectRoot, '--json',
  ], { env: environment });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stderr, stdout }));
  });
}

test('fresh onboard prerequisite failure leaves no lifecycle scaffold', (t) => {
  // Given: fresh spaced project/install roots and a PATH without Git.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy prerequisite failure '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const emptyPath = path.join(sandbox, 'empty path');
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(emptyPath);

  // When: the real lifecycle CLI attempts a fresh onboard.
  const result = spawnSync(process.execPath, [
    CLI, 'onboard', '--source', OFFICIAL,
    '--install-root', installRoot, '--project', projectRoot, '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyPath },
  });

  // Then: the prerequisite error is reported without creating product state.
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
  assert.equal(fs.existsSync(path.join(installRoot, 'LazyBuddy')), false);
});

test('failed onboard preserves a caller-owned exact empty lifecycle scaffold', (t) => {
  // Given: a caller-created product root with the exact five empty lifecycle directories.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy caller scaffold '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const emptyPath = path.join(sandbox, 'empty path');
  const directories = ['releases', 'receipts', 'staging', 'locks', 'rollback'];
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(emptyPath);
  for (const directory of directories) fs.mkdirSync(path.join(productRoot, directory), { recursive: true });
  const identities = new Map(
    ['', ...directories].map((directory) => {
      const stat = fs.lstatSync(path.join(productRoot, directory));
      return [directory, { dev: stat.dev, ino: stat.ino }];
    }),
  );

  // When: the real lifecycle CLI fails because Git is unavailable.
  const result = spawnSync(process.execPath, [
    CLI, 'onboard', '--source', OFFICIAL,
    '--install-root', installRoot, '--project', projectRoot, '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyPath },
  });

  // Then: structured failure preserves every caller-owned directory identity.
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
  for (const [directory, identity] of identities) {
    const stat = fs.lstatSync(path.join(productRoot, directory));
    assert.deepEqual({ dev: stat.dev, ino: stat.ino }, identity);
  }
});

test('two concurrent fresh prerequisite failures leave no lifecycle scaffold', { timeout: 15_000 }, async (t) => {
  // Given: two real CLI processes paused on opposite sides of first-process cleanup.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy concurrent failure '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const emptyPath = path.join(sandbox, 'empty path');
  const hook = path.join(sandbox, 'concurrency-hook.js');
  const firstEntered = path.join(sandbox, 'first-entered');
  const releaseFirst = path.join(sandbox, 'release-first');
  const secondEntered = path.join(sandbox, 'second-entered');
  const releaseSecond = path.join(sandbox, 'release-second');
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(emptyPath);
  fs.writeFileSync(hook, `'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const wait = (target) => {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) throw new Error('barrier timed out: ' + target);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
};
if (process.env.BOOTSTRAP_ROLE === 'first') {
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (command !== 'git') return realSpawnSync(command, args, options);
    fs.writeFileSync(process.env.FIRST_ENTERED, '');
    wait(process.env.RELEASE_FIRST);
    const error = new Error('spawnSync git ENOENT');
    error.code = 'ENOENT';
    return { error, status: null, stderr: '', stdout: '' };
  };
}
if (process.env.BOOTSTRAP_ROLE === 'second') {
  const realMkdirSync = fs.mkdirSync;
  let blocked = false;
  fs.mkdirSync = (target, options) => {
    if (!blocked && target === process.env.BLOCKED_DIRECTORY) {
      blocked = true;
      fs.writeFileSync(process.env.SECOND_ENTERED, '');
      wait(process.env.RELEASE_SECOND);
    }
    return realMkdirSync(target, options);
  };
}
`);
  const common = {
    ...process.env,
    NODE_OPTIONS: `--require=${JSON.stringify(hook)}`,
    PATH: emptyPath,
  };
  const first = startOnboard({
    environment: {
      ...common,
      BOOTSTRAP_ROLE: 'first',
      FIRST_ENTERED: firstEntered,
      RELEASE_FIRST: releaseFirst,
    },
    installRoot,
    projectRoot,
  });
  await waitForPath(firstEntered);
  const second = startOnboard({
    environment: {
      ...common,
      BLOCKED_DIRECTORY: path.join(productRoot, 'releases'),
      BOOTSTRAP_ROLE: 'second',
      RELEASE_SECOND: releaseSecond,
      SECOND_ENTERED: secondEntered,
    },
    installRoot,
    projectRoot,
  });
  await waitForPath(secondEntered);

  // When: the first process fails and cleans before the second resumes its preparation.
  fs.writeFileSync(releaseFirst, '');
  const firstResult = await first;
  await waitForPath(path.dirname(productRoot));
  assert.equal(fs.existsSync(productRoot), false);
  fs.writeFileSync(releaseSecond, '');
  const secondResult = await second;

  // Then: both errors are structured and the shared fresh scaffold is absent.
  for (const result of [firstResult, secondResult]) {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
  assert.equal(fs.existsSync(productRoot), false, 'concurrent failures left an empty LazyBuddy scaffold');
});

test('update emits revision confirmation while releasing its lifecycle lock', (t) => {
  // Given: an installed release and a different commit at the same version.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));
  assert.equal(run(f, 'onboard').status, 0);
  fs.appendFileSync(path.join(f.source, 'README.md'), 'second\n');
  git(f.source, ['add', 'README.md']);
  git(f.source, ['commit', '-m', 'second']);
  git(f.source, ['push', '--force', f.remote, 'main']);
  const secondSha = git(f.source, ['rev-parse', 'HEAD']);

  // When: update runs without the new revision confirmation.
  const pending = run(f, 'update');

  // Then: it requests the exact SHA with exit 2 and releases the operation lock.
  assert.equal(pending.status, 2, pending.stderr);
  assert.equal(pending.output.status, 'revision_confirmation_required');
  assert.equal(pending.output.required_confirmation, secondSha);
  assert.equal(fs.existsSync(path.join(f.installRoot, 'LazyBuddy', 'locks', 'lifecycle.lock')), false);

  // When: the exact confirmation is supplied and update is repeated.
  const updated = run(f, 'update', ['--confirm-revision', secondSha]);
  const unchanged = run(f, 'update');

  // Then: promotion succeeds once and the repeat is idempotent.
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(updated.output.status, 'ready');
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(unchanged.output.status, 'unchanged');
});
