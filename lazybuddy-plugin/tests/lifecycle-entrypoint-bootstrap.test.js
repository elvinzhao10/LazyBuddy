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

test('fresh onboard prerequisite failure leaves a reusable fail-closed scaffold', (t) => {
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

  // Then: the prerequisite error is reported with only the reusable scaffold retained.
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  assert.deepEqual(fs.readdirSync(productRoot).sort(), ['locks', 'receipts', 'releases', 'rollback', 'staging']);
  for (const entry of fs.readdirSync(productRoot)) assert.deepEqual(fs.readdirSync(path.join(productRoot, entry)), []);
});

test('onboard preserves an unverified workspace with a structured refusal', (t) => {
  // Given: a caller-owned workspace already occupies the lifecycle product path.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy preserved workspace '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const sentinel = path.join(productRoot, 'caller-owned.txt');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(productRoot, { recursive: true });
  fs.writeFileSync(sentinel, 'retain me\n');
  const before = fs.lstatSync(productRoot);

  // When: the real lifecycle CLI attempts onboard against that path.
  const result = spawnSync(process.execPath, [
    CLI, 'onboard', '--source', OFFICIAL,
    '--install-root', installRoot, '--project', projectRoot, '--json',
  ], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);

  // Then: refusal is machine-readable and the workspace remains byte- and identity-exact.
  assert.equal(result.status, 1, result.stderr);
  assert.equal(report.status, 'error');
  assert.equal(report.error.code, 'WORKSPACE_PRESERVED');
  assert.deepEqual(report.preservation, {
    status: 'recovery_required',
    public_workspace: productRoot,
    retained_artifacts: [],
  });
  assert.equal(report.package_readiness.status, 'blocked');
  assert.equal(report.host_readiness.status, 'pending');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'retain me\n');
  const after = fs.lstatSync(productRoot);
  assert.deepEqual({ dev: after.dev, ino: after.ino }, { dev: before.dev, ino: before.ino });
  assert.deepEqual(fs.readdirSync(productRoot), ['caller-owned.txt']);
});

test('collision-preserved bootstrap lock is surfaced and recovered through the real lifecycle CLI', (t) => {
  // Given: a real CLI whose new product root is replaced when its private bootstrap lock opens.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy swapped caller scaffold '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const hook = path.join(sandbox, 'swap-hook.js');
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(hook, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const realOpenSync = fs.openSync;
let swapped = false;
fs.openSync = (target, flags, mode) => {
  if (!swapped && target === process.env.BLOCKED_LOCK) {
    swapped = true;
    fs.rmSync(process.env.PRODUCT_ROOT, { recursive: true });
    for (const directory of ['releases', 'receipts', 'staging', 'locks', 'rollback']) {
      fs.mkdirSync(path.join(process.env.PRODUCT_ROOT, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(process.env.PRODUCT_ROOT, 'sentinel.txt'), 'caller-owned\\n');
  }
  return realOpenSync(target, flags, mode);
};
`);

  // When: lifecycle detects the changed root after creating only its private lock.
  const result = spawnSync(process.execPath, [
    CLI, 'onboard', '--source', OFFICIAL,
    '--install-root', installRoot, '--project', projectRoot, '--json',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BLOCKED_LOCK: path.join(installRoot, '.LazyBuddy.bootstrap.lock'),
      NODE_OPTIONS: `--require=${JSON.stringify(hook)}`,
      PRODUCT_ROOT: productRoot,
    },
  });
  const report = JSON.parse(result.stdout);

  // Then: the recovery report enumerates retained lifecycle artifacts and the sentinel stays exact.
  assert.equal(result.status, 1, result.stderr);
  assert.equal(report.error.code, 'WORKSPACE_PRESERVED');
  assert.deepEqual(report.preservation, {
    status: 'recovery_required',
    public_workspace: productRoot,
    retained_artifacts: [
      { kind: 'lifecycle_lock', last_known_path: path.join(installRoot, '.LazyBuddy.bootstrap.lock') },
    ],
  });
  assert.equal(fs.readFileSync(path.join(productRoot, 'sentinel.txt'), 'utf8'), 'caller-owned\n');
  assert.deepEqual(fs.readdirSync(path.join(productRoot, 'locks')), []);

  // When: the real status and explicit recovery commands inspect the retained sibling lock.
  const status = spawnSync(process.execPath, [
    CLI, 'status', '--install-root', installRoot, '--project', projectRoot, '--json',
  ], { encoding: 'utf8' });
  const recovered = spawnSync(process.execPath, [
    CLI, 'recover-bootstrap-lock', '--install-root', installRoot, '--project', projectRoot, '--yes', '--json',
  ], { encoding: 'utf8' });

  // Then: status names the sibling lock, recovery removes only it, and the caller workspace stays untouched.
  assert.equal(status.status, 1, status.stderr);
  assert.ok(JSON.parse(status.stdout).package_readiness.issues.some((issue) => (
    issue.code === 'BOOTSTRAP_LOCK_PRESENT' && issue.path === path.join(installRoot, '.LazyBuddy.bootstrap.lock')
  )));
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, 'bootstrap_lock_recovered');
  assert.equal(fs.existsSync(path.join(installRoot, '.LazyBuddy.bootstrap.lock')), false);
  assert.equal(fs.readFileSync(path.join(productRoot, 'sentinel.txt'), 'utf8'), 'caller-owned\n');
  assert.equal(fs.existsSync(path.join(productRoot, 'locks', 'lifecycle.lock')), false);
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

test('failed onboard preserves a caller-owned scaffold with a forged valid bootstrap marker', (t) => {
  // Given: a caller-created exact scaffold and a marker matching the public bootstrap schema.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy forged bootstrap marker '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const emptyPath = path.join(sandbox, 'empty path');
  const directories = ['releases', 'receipts', 'staging', 'locks', 'rollback'];
  const marker = path.join(productRoot, '.bootstrap-owner.json');
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(emptyPath);
  for (const directory of directories) fs.mkdirSync(path.join(productRoot, directory), { recursive: true });
  fs.writeFileSync(marker, '{"nonce":"00000000-0000-4000-8000-000000000000","product":"LazyBuddy","schema_version":1}\n');
  const snapshots = new Map(
    ['', ...directories, '.bootstrap-owner.json'].map((entry) => {
      const target = path.join(productRoot, entry);
      const stat = fs.lstatSync(target);
      return [entry, {
        bytes: stat.isFile() ? fs.readFileSync(target) : null,
        dev: stat.dev,
        ino: stat.ino,
        mode: stat.mode,
        nlink: stat.nlink,
      }];
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

  // Then: structured failure preserves every caller-owned byte, type, and identity.
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
  for (const [entry, snapshot] of snapshots) {
    const target = path.join(productRoot, entry);
    const stat = fs.lstatSync(target);
    assert.deepEqual({
      bytes: stat.isFile() ? fs.readFileSync(target) : null,
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      nlink: stat.nlink,
    }, snapshot);
  }
});

test('fresh root creator retries after a concurrent failure acquires its lifecycle lock', { timeout: 15_000 }, async (t) => {
  // Given: the root creator is paused while a second process acquires the new root's lock.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy creator lock race '));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project with spaces');
  const installRoot = path.join(sandbox, 'install root');
  const productRoot = path.join(installRoot, 'LazyBuddy');
  const emptyPath = path.join(sandbox, 'empty path');
  const hook = path.join(sandbox, 'creator-lock-hook.js');
  const ownerWaiting = path.join(sandbox, 'owner-waiting');
  const releaseOwner = path.join(sandbox, 'release-owner');
  const ownerContended = path.join(sandbox, 'owner-contended');
  const contenderEntered = path.join(sandbox, 'contender-entered');
  const releaseContender = path.join(sandbox, 'release-contender');
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
if (process.env.BOOTSTRAP_ROLE === 'owner') {
  const realOpenSync = fs.openSync;
  let paused = false;
  fs.openSync = (target, flags, mode) => {
    if (!paused && target === process.env.BLOCKED_LOCK) {
      paused = true;
      fs.writeFileSync(process.env.OWNER_WAITING, '');
      wait(process.env.RELEASE_OWNER);
    }
    try {
      return realOpenSync(target, flags, mode);
    } catch (error) {
      if (target === process.env.BLOCKED_LOCK && error && error.code === 'EEXIST') {
        fs.writeFileSync(process.env.OWNER_CONTENDED, '');
      }
      throw error;
    }
  };
}
if (process.env.BOOTSTRAP_ROLE === 'contender') {
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (command !== 'git') return realSpawnSync(command, args, options);
    fs.writeFileSync(process.env.CONTENDER_ENTERED, '');
    wait(process.env.RELEASE_CONTENDER);
    const error = new Error('spawnSync git ENOENT');
    error.code = 'ENOENT';
    return { error, status: null, stderr: '', stdout: '' };
  };
}
`);
  const common = {
    ...process.env,
    NODE_OPTIONS: `--require=${JSON.stringify(hook)}`,
    PATH: emptyPath,
  };
  const owner = startOnboard({
    environment: {
      ...common,
      BLOCKED_LOCK: path.join(installRoot, '.LazyBuddy.bootstrap.lock'),
      BOOTSTRAP_ROLE: 'owner',
      OWNER_CONTENDED: ownerContended,
      OWNER_WAITING: ownerWaiting,
      RELEASE_OWNER: releaseOwner,
    },
    installRoot,
    projectRoot,
  });
  await waitForPath(ownerWaiting);
  const contender = startOnboard({
    environment: {
      ...common,
      BOOTSTRAP_ROLE: 'contender',
      CONTENDER_ENTERED: contenderEntered,
      RELEASE_CONTENDER: releaseContender,
    },
    installRoot,
    projectRoot,
  });
  await waitForPath(contenderEntered);

  // When: the creator observes contention before the contender releases the lock.
  fs.writeFileSync(releaseOwner, '');
  await waitForPath(ownerContended);
  fs.writeFileSync(releaseContender, '');
  const results = await Promise.all([owner, contender]);

  // Then: both failures are structured and leave only a reusable unlocked scaffold.
  for (const result of results) {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
  assert.equal(fs.existsSync(productRoot), true);
  assert.deepEqual(fs.readdirSync(path.join(productRoot, 'locks')), []);
});

test('two concurrent fresh prerequisite failures leave a reusable lifecycle scaffold', { timeout: 15_000 }, async (t) => {
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
  const realOpenSync = fs.openSync;
  let blocked = false;
  fs.openSync = (target, ...args) => {
    if (!blocked && target === process.env.BLOCKED_LOCK) {
      blocked = true;
      fs.writeFileSync(process.env.SECOND_ENTERED, '');
      wait(process.env.RELEASE_SECOND);
    }
    return realOpenSync(target, ...args);
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
      BLOCKED_LOCK: path.join(installRoot, '.LazyBuddy.bootstrap.lock'),
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
  assert.equal(fs.existsSync(productRoot), true);
  assert.deepEqual(fs.readdirSync(path.join(productRoot, 'locks')), []);
  fs.writeFileSync(releaseSecond, '');
  const secondResult = await second;

  // Then: both errors are structured and the shared fresh scaffold remains reusable.
  for (const result of [firstResult, secondResult]) {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'PREREQUISITE_MISSING');
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
  assert.equal(fs.existsSync(productRoot), true);
  assert.deepEqual(fs.readdirSync(path.join(productRoot, 'locks')), []);
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
