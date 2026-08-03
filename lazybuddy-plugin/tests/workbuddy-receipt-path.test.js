'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { prepareProductRoot, promoteRelease, stageRelease } = require('../scripts/lifecycle');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SERVERS = ['run-ledger', 'verification', 'status-dashboard', 'context-graph', 'code-intel', 'docs'];

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lazybuddy-private-receipt-'));
  const sourceRoot = path.join(sandbox, 'source');
  const projectRoot = path.join(sandbox, 'project');
  const installRoot = path.join(sandbox, 'install');
  fs.cpSync(PLUGIN_ROOT, path.join(sourceRoot, 'lazybuddy-plugin'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.codebuddy-plugin'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, '..', '.codebuddy-plugin', 'marketplace.json'), path.join(sourceRoot, '.codebuddy-plugin', 'marketplace.json'));
  fs.mkdirSync(projectRoot);
  const paths = prepareProductRoot({ installRoot, product: 'LazyBuddy' });
  const commitSha = 'c'.repeat(40);
  const staged = stageRelease(paths, { sourceRoot, version: '1.0.3', commitSha });
  const promoted = promoteRelease(paths, {
    ...staged,
    commitSha,
    entrypoint: 'lazybuddy-plugin/scripts/lazybuddy-lifecycle.js',
    manifestRelativePath: 'lazybuddy-plugin/.codebuddy-plugin/plugin.json',
    origin: 'https://github.com/elvinzhao10/LazyBuddy.git',
    runtimePath: process.execPath,
    version: '1.0.3',
  });
  const releaseRoot = path.join(paths.releases, promoted.releaseId);
  const manifest = path.join(releaseRoot, 'lazybuddy-plugin', '.workbuddy-plugin', 'plugin.json');
  return { installRoot, paths, projectRoot, releaseRoot, sandbox, manifest };
}

function receipt(f) {
  return {
    schema_version: 1,
    type: 'workbuddy-marketplace-full-plugin',
    source: {
      route: 'workbuddy-marketplace',
      release_root: f.releaseRoot,
      manifest: 'lazybuddy-plugin/.workbuddy-plugin/plugin.json',
      manifest_sha256: crypto.createHash('sha256').update(fs.readFileSync(f.manifest)).digest('hex'),
      plugin: 'lazybuddy',
      version: '1.0.3',
    },
    host: 'workbuddy',
    build: 'build:current',
    session_id: 'session:current',
    observed_at: new Date().toISOString(),
    capabilities: {
      skill: { id: 'lazy-programming', status: 'loaded' },
      command: { id: 'lazy-status', status: 'loaded' },
      agent: { id: 'lazybuddy-verifier', status: 'loaded' },
      hook: { id: 'SessionStart', status: 'loaded' },
      mcp: Object.fromEntries(SERVERS.map((name) => [name, 'connected'])),
    },
  };
}

test('real CLI refuses a private WorkBuddy receipt reached through a public parent symlink', (t) => {
  // Given: a valid current receipt physically below .workbuddy and a public parent-directory symlink to it.
  const f = fixture();
  const privateDirectory = path.join(f.sandbox, '.workbuddy', 'receipts');
  const publicDirectory = path.join(f.sandbox, 'apparently-public');
  fs.mkdirSync(privateDirectory, { recursive: true });
  fs.symlinkSync(privateDirectory, publicDirectory, 'dir');
  fs.writeFileSync(path.join(privateDirectory, 'receipt.json'), `${JSON.stringify(receipt(f))}\n`);
  t.after(() => fs.rmSync(f.sandbox, { recursive: true, force: true }));

  // When: the promoted lifecycle CLI receives only the apparently public spelling.
  const result = spawnSync(process.execPath, [
    f.paths.launcher,
    'status', '--install-root', f.installRoot, '--project', f.projectRoot,
    '--host', 'workbuddy', '--host-build', 'build:current', '--host-session', 'session:current',
    '--observation-receipt', path.join(publicDirectory, 'receipt.json'), '--json',
  ], { encoding: 'utf8' });
  const output = JSON.parse(result.stdout);

  // Then: canonical private location wins over caller spelling and readiness stays pending.
  assert.notEqual(result.status, 0);
  assert.deepEqual(output.host_readiness, { status: 'pending' });
  assert.equal(output.error.code, 'OBSERVATION_RECEIPT_INVALID');
});
