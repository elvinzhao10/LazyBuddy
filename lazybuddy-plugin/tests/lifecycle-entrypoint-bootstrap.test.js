'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

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
