'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  prepareProductRoot,
  promoteRelease,
  stageRelease,
} = require('../scripts/lifecycle');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'lazybuddy-lifecycle.js');
const ORIGIN = 'https://github.com/elvinzhao10/LazyBuddy.git';
const COMMON_FIELDS = [
  'schema_version',
  'product',
  'command',
  'status',
  'package_readiness',
  'host_readiness',
  'install_root',
  'project_root',
];

function run(args, options = {}) {
  return spawnSync(process.execPath, [options.cli || CLI, ...args], {
    cwd: options.cwd || PLUGIN_ROOT,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function json(result) {
  assert.notEqual(result.stdout, '', result.stderr);
  return JSON.parse(result.stdout);
}

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy lifecycle cli '));
  const installRoot = path.join(sandbox, 'durable root with spaces');
  const projectRoot = path.join(sandbox, 'project with spaces');
  const sourceRoot = path.join(sandbox, 'source checkout');
  const packageRoot = path.join(sourceRoot, 'lazybuddy-plugin');
  fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, '.codebuddy-plugin'), { recursive: true });
  fs.cpSync(path.join(PLUGIN_ROOT, 'scripts', 'lifecycle'), path.join(packageRoot, 'scripts', 'lifecycle'), { recursive: true });
  fs.copyFileSync(CLI, path.join(packageRoot, 'scripts', 'lazybuddy-lifecycle.js'));
  fs.writeFileSync(
    path.join(packageRoot, '.codebuddy-plugin', 'plugin.json'),
    '{"name":"lazybuddy","version":"1.0.3"}\n',
  );
  fs.mkdirSync(projectRoot);
  const paths = prepareProductRoot({ installRoot, product: 'LazyBuddy' });
  const commitSha = 'a'.repeat(40);
  const staged = stageRelease(paths, { sourceRoot, version: '1.0.3', commitSha });
  const promoted = promoteRelease(paths, {
    ...staged,
    commitSha,
    entrypoint: 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js',
    manifestRelativePath: 'lazybuddy-plugin/.codebuddy-plugin/plugin.json',
    origin: ORIGIN,
    runtimePath: process.execPath,
    version: '1.0.3',
  });
  return { installRoot, paths, projectRoot, promoted, sandbox, sourceRoot };
}

function lifecycleArgs(f, command, extra = []) {
  return [
    command,
    '--install-root', f.installRoot,
    '--project', f.projectRoot,
    '--json',
    ...extra,
  ];
}

test('help is Node-only and documents exactly the durable lifecycle commands', (t) => {
  // Given: a PATH containing Node but no Bash.
  const nodeOnlyPath = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy node only '));
  t.after(() => fs.rmSync(nodeOnlyPath, { recursive: true }));
  fs.symlinkSync(process.execPath, path.join(nodeOnlyPath, 'node'));

  // When: the lifecycle help is invoked through Node.
  const result = run(['--help'], { env: { ...process.env, PATH: nodeOnlyPath } });

  // Then: it succeeds and exposes only the four lifecycle operations.
  assert.equal(result.status, 0, result.stderr);
  for (const command of ['onboard', 'update', 'status', 'offboard']) {
    assert.match(result.stdout, new RegExp(`^  ${command}\\b`, 'm'));
  }
  assert.doesNotMatch(result.stdout, /^\s+(init|sync|uninstall)\b/m);
});

test('invalid official source fails before creating durable state', (t) => {
  // Given: an absent spaced install root and an unsupported repository URL.
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy lifecycle invalid source '));
  const installRoot = path.join(sandbox, 'install root');
  const projectRoot = path.join(sandbox, 'project root');
  fs.mkdirSync(projectRoot);
  t.after(() => fs.rmSync(sandbox, { recursive: true }));

  // When: onboarding is attempted against the unsupported origin.
  const result = run([
    'onboard',
    '--install-root', installRoot,
    '--project', projectRoot,
    '--source', 'https://github.com/example/LazyBuddy',
    '--json',
  ]);

  // Then: origin validation fails without creating the durable root.
  assert.equal(result.status, 1);
  assert.equal(json(result).error.code, 'INVALID_ORIGIN');
  assert.equal(fs.existsSync(installRoot), false);
});

test('installed bundle survives source deletion and reports the common ready envelope', (t) => {
  // Given: a promoted bundle whose original source checkout is deleted.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));
  fs.rmSync(f.sourceRoot, { recursive: true });

  // When: status runs through the durable launcher from an unrelated directory.
  const result = run(lifecycleArgs(f, 'status'), { cli: f.paths.launcher, cwd: f.sandbox });
  const output = json(result);

  // Then: package readiness is proven while host readiness remains pending.
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(output).filter((key) => COMMON_FIELDS.includes(key)).sort(), [...COMMON_FIELDS].sort());
  assert.equal(output.status, 'ready');
  assert.deepEqual(output.package_readiness, {
    status: 'ready',
    bundle: {
      release_id: f.promoted.releaseId,
      version: '1.0.3',
      launcher: f.paths.launcher,
    },
  });
  assert.deepEqual(output.host_readiness, { status: 'pending' });
});

test('status distinguishes a stale runtime with the shared blocked exit meaning', (t) => {
  // Given: active state points at a Node runtime which has moved.
  const f = fixture();
  t.after(() => fs.rmSync(f.sandbox, { recursive: true }));
  const active = JSON.parse(fs.readFileSync(f.paths.active, 'utf8'));
  const missingRuntime = path.join(f.sandbox, 'moved-node');
  active.runtime_path = missingRuntime;
  active.release_metadata[active.active_release].runtime_path = missingRuntime;
  fs.writeFileSync(f.paths.active, JSON.stringify(active, null, 2) + '\n');

  // When: source status inspects the durable bundle.
  const result = run(lifecycleArgs(f, 'status'));
  const output = json(result);

  // Then: it refuses with a machine-readable stale-runtime result.
  assert.equal(result.status, 1);
  assert.equal(output.status, 'blocked');
  assert.equal(output.package_readiness.issues[0].code, 'STALE_RUNTIME');
  assert.deepEqual(output.host_readiness, { status: 'pending' });
});

test('offboard plans first, preserves modified content, and is repeatable after exact removal', (t) => {
  // Given: one clean installation.
  const clean = fixture();
  t.after(() => fs.rmSync(clean.sandbox, { recursive: true }));

  // When: offboard is requested without confirmation.
  const planned = run(lifecycleArgs(clean, 'offboard'));
  const plan = json(planned);

  // Then: it emits a non-mutating action plan with exit 2.
  assert.equal(planned.status, 2);
  assert.equal(plan.status, 'confirmation_required');
  assert.match(plan.action, /rerun with --yes/);
  assert.equal(fs.existsSync(clean.paths.productRoot), true);

  // Given: a separate installation whose receipt-owned entrypoint was modified.
  const modified = fixture();
  t.after(() => fs.rmSync(modified.sandbox, { recursive: true }));
  const installedEntry = path.join(
    modified.paths.releases,
    modified.promoted.releaseId,
    'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js',
  );
  fs.appendFileSync(installedEntry, '// caller change\n');

  // When/Then: confirmed offboard refuses and preserves the modified installation.
  const refused = run(lifecycleArgs(modified, 'offboard', ['--yes']));
  assert.equal(refused.status, 1);
  assert.equal(json(refused).error.code, 'OWNERSHIP_REFUSED');
  assert.match(fs.readFileSync(installedEntry, 'utf8'), /caller change/);

  // When: the clean installation is confirmed and then offboarded again.
  const removed = run(lifecycleArgs(clean, 'offboard', ['--yes']));
  const repeated = run(lifecycleArgs(clean, 'offboard', ['--yes']));

  // Then: exact removal succeeds and the repeat reports an already-absent success.
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(json(removed).status, 'removed');
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(json(repeated).status, 'absent');
});
